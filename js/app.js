/* Maastopalon leviämissimulaattori – käyttöliittymä ja piirto. */
(function () {
  'use strict';

  const { createSimulation, FUELS, Fuel, State, windVector } = window.FireSim;

  const W = 160, H = 110, SCALE = 6;
  const $ = (id) => document.getElementById(id);

  const sim = createSimulation({ width: W, height: H, seed: randomSeed() });

  // ---------- Piirtopinnat ----------
  const map = $('map');
  map.width = W * SCALE;
  map.height = H * SCALE;
  const ctx = map.getContext('2d');
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const offCtx = off.getContext('2d');
  const img = offCtx.createImageData(W, H);
  let shade = new Float32Array(W * H);

  function randomSeed() { return (Math.random() * 2 ** 32) >>> 0; }

  /** Rinnevarjostus korkeusmallista (valo luoteesta). */
  function computeHillshade() {
    shade = new Float32Array(W * H);
    const lx = -0.6, ly = -0.6, lz = 0.53;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const e = (xx, yy) => sim.elevation[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
        const dzdx = (e(x + 1, y) - e(x - 1, y)) / (2 * sim.cellSize);
        const dzdy = (e(x, y + 1) - e(x, y - 1)) / (2 * sim.cellSize);
        const nx = -dzdx * 3, ny = -dzdy * 3, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        const d = (nx * lx + ny * ly + nz * lz) / len;
        shade[y * W + x] = 0.72 + 0.5 * d;
      }
    }
  }

  function render() {
    const d = img.data;
    const now = performance.now();
    for (let i = 0; i < W * H; i++) {
      const s = sim.state[i];
      let r, g, b;
      if (s === State.BURNING) {
        const f = FUELS[sim.fuel[i]];
        const life = f.burnTime ? sim.burnLeft[i] / f.burnTime : 0;
        const flick = 0.75 + 0.25 * Math.sin(now / 90 + i * 1.7);
        r = 255;
        g = Math.round((70 + 150 * life) * flick);
        b = Math.round(20 * life);
      } else {
        const c = FUELS[sim.fuel[i]].color;
        const k = sim.fuel[i] === Fuel.WATER ? 1 : shade[i];
        r = c[0] * k; g = c[1] * k; b = c[2] * k;
        if (s === State.BURNT) {
          const a = 0.82;
          r = r * (1 - a) + 38 * a; g = g * (1 - a) + 34 * a; b = b * (1 - a) + 32 * a;
        }
        const w = sim.wet[i];
        if (w > 0) {
          const a = 0.45 * w;
          r = r * (1 - a) + 80 * a; g = g * (1 - a) + 150 * a; b = b * (1 - a) + 230 * a;
        }
      }
      const o = i * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, map.width, map.height);
    drawGlow();
    drawBrushPreview();
  }

  /** Savu-/hehkuefekti palorintaman päälle. */
  function drawGlow() {
    if (!sim.burning.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255, 120, 20, 0.10)';
    const step = Math.max(1, Math.floor(sim.burning.length / 1500));
    for (let k = 0; k < sim.burning.length; k += step) {
      const i = sim.burning[k];
      const x = i % W, y = (i - x) / W;
      ctx.beginPath();
      ctx.arc((x + 0.5) * SCALE, (y + 0.5) * SCALE, SCALE * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Kompassi ----------
  const compass = $('compass');
  const cctx = compass.getContext('2d');
  const DIR_NAMES = ['pohjoisesta', 'koillisesta', 'idästä', 'kaakosta', 'etelästä', 'lounaasta', 'lännestä', 'luoteesta'];
  const dirName = (deg) => DIR_NAMES[Math.round(deg / 45) % 8];

  function drawCompass() {
    const s = compass.width, c = s / 2, R = c - 12;
    cctx.clearRect(0, 0, s, s);
    cctx.strokeStyle = '#3a414a';
    cctx.lineWidth = 2;
    cctx.beginPath(); cctx.arc(c, c, R, 0, Math.PI * 2); cctx.stroke();
    cctx.fillStyle = '#9aa0a6';
    cctx.font = '11px system-ui, sans-serif';
    cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    [['P', 0, -1], ['I', 1, 0], ['E', 0, 1], ['L', -1, 0]].forEach(([t, x, y]) => cctx.fillText(t, c + x * (R + 7), c + y * (R + 7)));
    const [wx, wy] = windVector(sim.params.windDir);
    const len = R * (0.35 + 0.65 * Math.min(1, sim.params.windSpeed / 20));
    const tx = c + wx * len, ty = c + wy * len;
    const bx = c - wx * len * 0.6, by = c - wy * len * 0.6;
    cctx.strokeStyle = '#ff7a1a'; cctx.fillStyle = '#ff7a1a'; cctx.lineWidth = 3;
    cctx.beginPath(); cctx.moveTo(bx, by); cctx.lineTo(tx, ty); cctx.stroke();
    const ang = Math.atan2(wy, wx);
    cctx.beginPath();
    cctx.moveTo(tx + Math.cos(ang) * 4, ty + Math.sin(ang) * 4);
    cctx.lineTo(tx + Math.cos(ang + 2.5) * 10, ty + Math.sin(ang + 2.5) * 10);
    cctx.lineTo(tx + Math.cos(ang - 2.5) * 10, ty + Math.sin(ang - 2.5) * 10);
    cctx.closePath(); cctx.fill();
  }

  let compassDrag = false;
  function compassFromPointer(e) {
    const r = compass.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // Osoitin näyttää suunnan, johon tuuli puhaltaa.
    const toDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const fromDeg = Math.round((toDeg + 180 + 360) % 360);
    setParam('windDir', fromDeg);
  }
  compass.addEventListener('pointerdown', (e) => { compassDrag = true; compass.setPointerCapture(e.pointerId); compassFromPointer(e); });
  compass.addEventListener('pointermove', (e) => { if (compassDrag) compassFromPointer(e); });
  compass.addEventListener('pointerup', () => { compassDrag = false; });

  // ---------- Kaavio ----------
  const chart = $('chart');
  const chctx = chart.getContext('2d');
  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const cw = chart.clientWidth || 300, chh = chart.clientHeight || 90;
    if (chart.width !== Math.round(cw * dpr)) { chart.width = Math.round(cw * dpr); chart.height = Math.round(chh * dpr); }
    chctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    chctx.clearRect(0, 0, cw, chh);
    chctx.strokeStyle = '#323840'; chctx.lineWidth = 1;
    chctx.strokeRect(0.5, 0.5, cw - 1, chh - 1);
    const h = sim.history;
    if (h.length < 2) {
      chctx.fillStyle = '#6b7178'; chctx.font = '11px system-ui, sans-serif';
      chctx.fillText('Palanut pinta-ala ajan funktiona', 8, 16);
      return;
    }
    const maxV = Math.max(1, ...h.map((p) => p.burnt + p.burning));
    const maxB = Math.max(1, ...h.map((p) => p.burning));
    const X = (k) => 4 + (k / (h.length - 1)) * (cw - 8);
    const line = (val, max, color, fill) => {
      chctx.beginPath();
      h.forEach((p, k) => { const y = chh - 4 - (val(p) / max) * (chh - 16); k ? chctx.lineTo(X(k), y) : chctx.moveTo(X(k), y); });
      if (fill) { chctx.lineTo(X(h.length - 1), chh - 4); chctx.lineTo(X(0), chh - 4); chctx.closePath(); chctx.fillStyle = fill; chctx.fill(); }
      else { chctx.strokeStyle = color; chctx.lineWidth = 1.5; chctx.stroke(); }
    };
    line((p) => p.burnt + p.burning, maxV, null, 'rgba(160, 160, 160, 0.35)');
    line((p) => p.burning, maxB, '#ff7a1a');
    chctx.font = '11px system-ui, sans-serif';
    chctx.fillStyle = '#c7c7c7'; chctx.fillText('kokonaisala', 8, 14);
    chctx.fillStyle = '#ff7a1a'; chctx.fillText('palorintama', 84, 14);
  }

  // ---------- Tilastot ----------
  const fmtHa = (ha) => (ha < 10 ? ha.toFixed(2) : ha.toFixed(1)).replace('.', ',') + ' ha';
  function fmtTime(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} h ${m} min` : `${m} min`;
  }
  function updateStats() {
    const st = sim.stats();
    const haPerCell = (sim.cellSize * sim.cellSize) / 10000;
    $('sTime').textContent = fmtTime(st.time);
    $('sBurning').textContent = fmtHa(st.burning * haPerCell);
    $('sBurnt').textContent = fmtHa(st.burntHa);
    $('sPct').textContent = st.burnablePct.toFixed(1).replace('.', ',') + ' %';
    drawChart();
  }

  // ---------- Säätimet ----------
  const outputs = {
    windSpeed: (v) => `${String(v).replace('.', ',')} m/s`,
    windDir: (v) => `${v}°`,
    moisture: (v) => `${v} %`,
  };

  function setParam(key, value) {
    sim.params[key] = value;
    const el = $(key);
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
    if (outputs[key]) $(key + 'Out').textContent = outputs[key](value);
    if (key === 'windDir' || key === 'windSpeed') {
      drawCompass();
      compass.title = `Tuulee ${dirName(sim.params.windDir)} ${sim.params.windSpeed} m/s – vedä muuttaaksesi`;
    }
  }

  ['windSpeed', 'windDir', 'moisture'].forEach((key) => {
    $(key).addEventListener('input', (e) => setParam(key, Number(e.target.value)));
    setParam(key, sim.params[key]);
  });
  ['spotting', 'slope'].forEach((key) => {
    $(key).addEventListener('change', (e) => setParam(key, e.target.checked));
    setParam(key, sim.params[key]);
  });

  const speed = $('speed');
  const brush = $('brush');
  const syncOut = () => {
    $('speedOut').textContent = `${speed.value} /s`;
    $('brushOut').textContent = `${brush.value * 2 + 1} ruutua`;
  };
  speed.addEventListener('input', syncOut);
  brush.addEventListener('input', syncOut);
  syncOut();

  // Selite
  $('legend').innerHTML = FUELS.map((f) => `<li><i style="background:rgb(${f.color.join(',')})"></i>${f.name}</li>`).join('')
    + '<li><i style="background:#ff8c14"></i>Palaa</li><li><i style="background:#2a2624"></i>Palanut</li>';

  // ---------- Toisto ----------
  let playing = false;
  let acc = 0;
  let last = performance.now();
  const playBtn = $('play');

  function setPlaying(p) {
    playing = p;
    playBtn.textContent = p ? '⏸ Tauko' : '▶ Käynnistä';
  }
  function doStep() {
    sim.step();
    if (!sim.burning.length) setPlaying(false);
  }

  playBtn.addEventListener('click', () => {
    if (!playing && !sim.burning.length) {
      // Jos paloa ei ole, sytytetään se kartan keskelle lähimpään palavaan kohtaan.
      igniteNearCenter();
    }
    setPlaying(!playing);
  });
  $('step').addEventListener('click', () => { setPlaying(false); doStep(); updateStats(); });
  $('reset').addEventListener('click', () => { setPlaying(false); sim.resetFire(); updateStats(); });
  $('newmap').addEventListener('click', () => {
    setPlaying(false);
    sim.generate(randomSeed());
    computeHillshade();
    updateStats();
  });

  function igniteNearCenter() {
    const cx = W >> 1, cy = H >> 1;
    for (let r = 0; r < Math.max(W, H); r++) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(cx + r * Math.cos(a * Math.PI / 8));
        const y = Math.round(cy + r * Math.sin(a * Math.PI / 8));
        if (sim.inBounds(x, y) && FUELS[sim.fuel[y * W + x]].pBurn > 0.3 && sim.ignite(x, y, 1)) return;
      }
    }
  }

  function loop(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (playing) {
      acc += dt * Number(speed.value);
      let steps = 0;
      while (acc >= 1 && steps < 30) { doStep(); acc -= 1; steps++; }
      if (steps) updateStats();
    } else acc = 0;
    render();
    requestAnimationFrame(loop);
  }

  // ---------- Hiiri / kosketus ----------
  let painting = false;
  let pointer = null;

  function cellFromEvent(e) {
    const r = map.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * W),
      y: Math.floor(((e.clientY - r.top) / r.height) * H),
    };
  }
  const tool = () => document.querySelector('input[name="tool"]:checked').value;

  function applyTool(x, y) {
    const r = Number(brush.value);
    switch (tool()) {
      case 'ignite': sim.ignite(x, y, r); break;
      case 'firebreak': sim.paintFuel(x, y, r, Fuel.FIREBREAK); break;
      case 'water': sim.waterDrop(x, y, r + 2); break;
    }
    updateStats();
  }

  function drawBrushPreview() {
    if (!pointer) return;
    const t = tool();
    const r = Number(brush.value) + (t === 'water' ? 2 : 0);
    ctx.save();
    ctx.strokeStyle = t === 'water' ? '#7fc4ff' : t === 'firebreak' ? '#d9a066' : '#ffb347';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc((pointer.x + 0.5) * SCALE, (pointer.y + 0.5) * SCALE, (r + 0.5) * SCALE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const hover = $('hover');
  function updateHover(c) {
    if (!sim.inBounds(c.x, c.y)) { hover.hidden = true; return; }
    const i = c.y * W + c.x;
    const st = ['ei palanut', 'palaa', 'palanut'][sim.state[i]];
    hover.hidden = false;
    hover.textContent = `${FUELS[sim.fuel[i]].name} · ${Math.round(sim.elevation[i])} m · ${st}`;
  }

  map.addEventListener('pointerdown', (e) => {
    painting = true;
    map.setPointerCapture(e.pointerId);
    const c = cellFromEvent(e);
    applyTool(c.x, c.y);
  });
  map.addEventListener('pointermove', (e) => {
    const c = cellFromEvent(e);
    pointer = c;
    updateHover(c);
    if (painting) applyTool(c.x, c.y);
  });
  map.addEventListener('pointerup', () => { painting = false; });
  map.addEventListener('pointerleave', () => { pointer = null; hover.hidden = true; });

  // ---------- Näppäimet ----------
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
    else if (e.key === 's' || e.key === 'S') $('step').click();
    else if (e.key === 'r' || e.key === 'R') $('reset').click();
    else if (e.key === 'n' || e.key === 'N') $('newmap').click();
    else if (e.key >= '1' && e.key <= '3') {
      document.querySelectorAll('input[name="tool"]')[Number(e.key) - 1].checked = true;
    }
  });

  computeHillshade();
  updateStats();
  requestAnimationFrame(loop);

  window.__sim = sim; // virheenjäljitystä varten
})();
