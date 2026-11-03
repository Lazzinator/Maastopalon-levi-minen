const test = require('node:test');
const assert = require('node:assert/strict');
const { createSimulation, decodeMap, Fuel, FUELS, State } = require('../js/sim.js');
const korvaharju = require('../data/korvaharju.js');

function runUntilOut(sim, max = 3000) {
  for (let i = 0; i < max && sim.burning.length; i++) sim.step();
  return sim.stats();
}

test('Korvaharjun datatiedosto asettaa globaalin muuttujan', () => {
  assert.equal(globalThis.FIRESIM_MAPS.korvaharju, korvaharju);
  assert.equal(korvaharju.crs, 'EPSG:3067');
  const [e0, n0, e1, n1] = korvaharju.bbox;
  assert.equal((e1 - e0) / korvaharju.cellSize, korvaharju.width);
  assert.equal((n1 - n0) / korvaharju.cellSize, korvaharju.height);
});

test('Korvaharjun kartta purkautuu oikean kokoiseksi ja järkeväksi', () => {
  const m = decodeMap(korvaharju);
  assert.equal(m.width, 200);
  assert.equal(m.height, 150);
  assert.equal(m.fuel.length, 200 * 150);
  let min = Infinity, max = -Infinity;
  for (const e of m.elevation) { if (e < min) min = e; if (e > max) max = e; }
  // Kuopion seudun maasto: n. 80–200 m mpy, korkeusero kymmeniä metrejä.
  assert.ok(min > 80 && max < 200, `korkeus ${min}–${max}`);
  assert.ok(max - min > 20);
  const counts = new Array(FUELS.length).fill(0);
  for (const f of m.fuel) counts[f]++;
  for (const k of ['WATER', 'CONIFER', 'MIXED', 'BOG', 'URBAN']) assert.ok(counts[Fuel[k]] > 200, `${k}: ${counts[Fuel[k]]}`);
  assert.equal(counts[Fuel.FIREBREAK], 0);
});

test('lampien pinta on tasainen eikä ympäröivä maasto ole sitä alempana', () => {
  const m = decodeMap(korvaharju);
  const { width: w, height: h } = m;
  const seen = new Uint8Array(w * h);
  let lakes = 0;
  for (let s = 0; s < w * h; s++) {
    if (m.fuel[s] !== Fuel.WATER || seen[s]) continue;
    const cells = [], q = [s];
    seen[s] = 1;
    while (q.length) {
      const k = q.pop();
      cells.push(k);
      const x = k % w, y = (k - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (m.fuel[j] === Fuel.WATER && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    if (cells.length < 100) continue;
    lakes++;
    const el = cells.map((k) => m.elevation[k]);
    const lo = Math.min(...el), hi = Math.max(...el);
    assert.ok(hi - lo < 1, `lammen pinnan vaihtelu ${hi - lo} m`);
    // Maa 3–5 ruudun (30–50 m) päässä rannasta
    const inLake = new Set(cells);
    let sum = 0, n = 0;
    for (const k of cells) {
      const x = k % w, y = (k - x) / w;
      for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!inLake.has(j) && m.fuel[j] !== Fuel.WATER) { sum += m.elevation[j]; n++; }
      }
    }
    assert.ok(sum / n >= lo, `ympäristö ${(sum / n).toFixed(1)} m, vesi ${lo} m`);
  }
  assert.ok(lakes >= 2, `lampia ${lakes}`);
});

test('simulaatio luodaan valmiista kartasta eri kokoisena kuin oletus', () => {
  const sim = createSimulation({ map: korvaharju });
  assert.equal(sim.width, 200);
  assert.equal(sim.height, 150);
  assert.equal(sim.map.id, 'korvaharju');
  assert.deepEqual(sim.fuel, decodeMap(korvaharju).fuel);
  const c = sim.cellToMap(0, 0);
  assert.deepEqual(c, { e: korvaharju.bbox[0] + 5, n: korvaharju.bbox[3] - 5 });
});

test('palo leviää oikealla kartalla ja on toistettava', () => {
  const run = () => {
    const sim = createSimulation({ map: korvaharju, seed: 3 });
    // Sytytetään havumetsäruutu lähimpänä keskustaa.
    let best = -1, bd = Infinity;
    for (let i = 0; i < sim.fuel.length; i++) {
      if (sim.fuel[i] !== Fuel.CONIFER) continue;
      const x = i % sim.width, y = (i - x) / sim.width;
      const d = (x - 100) ** 2 + (y - 75) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    sim.ignite(best % sim.width, Math.floor(best / sim.width), 2);
    for (let i = 0; i < 60; i++) sim.step();
    return sim;
  };
  const a = run(), b = run();
  assert.deepEqual(a.state, b.state);
  assert.ok(a.stats().burnt + a.stats().burning > 50);
  for (let i = 0; i < a.fuel.length; i++) if (a.fuel[i] === Fuel.WATER) assert.equal(a.state[i], State.UNBURNED);
});

test('tie / rakennettu syttyy huonosti', () => {
  const sim = createSimulation({ width: 40, height: 40, generate: false, fillFuel: Fuel.URBAN, params: { spotting: false } });
  sim.ignite(20, 20, 0);
  const st = runUntilOut(sim);
  assert.ok(st.burnt < 10, `palanut ${st.burnt}`);
});

test('virheellinen kartta hylätään', () => {
  assert.throws(() => decodeMap({ width: 2, height: 2, elevation: [0, 0, 0, 0], fuel: [0, 0, 0] }));
  assert.throws(() => decodeMap({ width: 1, height: 1, elevation: [0], fuel: [99] }));
  const m = decodeMap({ width: 2, height: 1, elevation: [1, 2], fuel: [Fuel.WATER, Fuel.BOG] });
  assert.equal(m.elevation[1], 2);
});
