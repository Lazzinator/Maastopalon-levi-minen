const test = require('node:test');
const assert = require('node:assert/strict');
const { createSimulation, Fuel, State, windFactor, moistureFactor, slopeFactor } = require('../js/sim.js');

function runUntilOut(sim, max = 2000) {
  for (let i = 0; i < max && sim.burning.length; i++) sim.step();
  return sim.stats();
}

test('sama siemen tuottaa saman kartan ja saman palon', () => {
  const a = createSimulation({ seed: 42 });
  const b = createSimulation({ seed: 42 });
  assert.deepEqual(a.fuel, b.fuel);
  a.ignite(80, 55, 2); b.ignite(80, 55, 2);
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  assert.deepEqual(a.state, b.state);
});

test('kartalla on useita maastotyyppejä', () => {
  const sim = createSimulation({ seed: 7 });
  assert.ok(new Set(sim.fuel).size >= 4);
});

test('palo ei ylitä vesistöä eikä palokujaa', () => {
  for (const barrier of [Fuel.WATER, Fuel.FIREBREAK]) {
    const sim = createSimulation({ width: 60, height: 40, generate: false, params: { spotting: false, windSpeed: 10, windDir: 270 } });
    for (let y = 0; y < 40; y++) sim.paintFuel(30, y, 0, barrier);
    sim.ignite(10, 20, 1);
    runUntilOut(sim);
    for (let y = 0; y < 40; y++) for (let x = 31; x < 60; x++) assert.equal(sim.state[y * 60 + x], State.UNBURNED);
    assert.ok(sim.stats().burnt > 100);
  }
});

test('palo leviää myötätuuleen nopeammin', () => {
  const sim = createSimulation({ width: 101, height: 101, generate: false, params: { spotting: false, windSpeed: 8, windDir: 270 } });
  sim.ignite(50, 50, 1);
  for (let i = 0; i < 25; i++) sim.step();
  let east = 0, west = 0;
  for (let i = 0; i < sim.state.length; i++) {
    if (sim.state[i] === State.UNBURNED) continue;
    const x = i % 101;
    if (x > 50) east++; else if (x < 50) west++;
  }
  assert.ok(east > west * 2, `itä ${east}, länsi ${west}`);
});

test('liian kostea maasto ei syty leviämään', () => {
  const sim = createSimulation({ width: 40, height: 40, generate: false, params: { moisture: 36 } });
  sim.ignite(20, 20, 0);
  const st = runUntilOut(sim);
  assert.equal(st.burnt, 1);
});

test('vesipommitus sammuttaa palon', () => {
  const sim = createSimulation({ width: 40, height: 40, generate: false });
  sim.ignite(20, 20, 2);
  sim.waterDrop(20, 20, 6);
  assert.equal(sim.burning.length, 0);
});

test('kertoimet käyttäytyvät oikein', () => {
  assert.ok(windFactor(10, 1) > 1 && windFactor(10, -1) < 0.2);
  assert.equal(windFactor(0, -1), 1);
  assert.equal(moistureFactor(40), 0);
  assert.ok(slopeFactor(5, 10) > 1 && slopeFactor(-5, 10) < 1);
});
