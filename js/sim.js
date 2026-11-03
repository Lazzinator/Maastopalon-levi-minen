/*
 * Maastopalon leviämissimulaattori – simulaatiomalli.
 *
 * Soluautomaatti (cellular automaton), jossa jokaisella ruudulla on
 * polttoainetyyppi, korkeus, kosteus ja palotila. Palo leviää palavasta
 * ruudusta naapureihin todennäköisyydellä
 *
 *   p = p_fuel * f_moisture * f_wind * f_slope * f_diag * (1 - wet)
 *
 * Tuuli- ja rinnekertoimet noudattavat Alexandridis ym. (2008) mallia:
 *   f_wind  = exp(c1 * V) * exp(V * c2 * (cos θ - 1))
 *   f_slope = exp(a * θ_s)
 *
 * Moduuli toimii sekä selaimessa (window.FireSim) että Node.js:ssä.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FireSim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const State = Object.freeze({ UNBURNED: 0, BURNING: 1, BURNT: 2 });

  // pBurn: syttymistodennäköisyys ihanneoloissa, burnTime: palamisaika (askelta),
  // spot: kipinälennon lähdeteho (latvuspalo).
  const FUELS = Object.freeze([
    { id: 0, key: 'water',     name: 'Vesi',            color: [59, 110, 165],  pBurn: 0.0,  burnTime: 0,  spot: 0 },
    { id: 1, key: 'rock',      name: 'Kallio',          color: [168, 166, 158], pBurn: 0.03, burnTime: 1,  spot: 0 },
    { id: 2, key: 'grass',     name: 'Niitty / heinikko', color: [196, 200, 104], pBurn: 0.8, burnTime: 2,  spot: 0.1 },
    { id: 3, key: 'shrub',     name: 'Pensaikko',       color: [140, 165, 80],  pBurn: 0.65, burnTime: 4,  spot: 0.3 },
    { id: 4, key: 'conifer',   name: 'Havumetsä',       color: [46, 98, 58],    pBurn: 0.6,  burnTime: 9,  spot: 1.0 },
    { id: 5, key: 'mixed',     name: 'Sekametsä',       color: [82, 130, 70],   pBurn: 0.42, burnTime: 7,  spot: 0.5 },
    { id: 6, key: 'bog',       name: 'Suo',             color: [150, 132, 92], pBurn: 0.14, burnTime: 5,  spot: 0 },
    { id: 7, key: 'firebreak', name: 'Palokuja',        color: [150, 110, 72],  pBurn: 0.0,  burnTime: 0,  spot: 0 },
  ]);
  const Fuel = Object.freeze(Object.fromEntries(FUELS.map((f) => [f.key.toUpperCase(), f.id])));

  // Alexandridis ym. 2008
  const C1 = 0.045;
  const C2 = 0.131;
  const SLOPE_A = 0.078;
  const DIAG_FACTOR = 0.75;
  const MOISTURE_OF_EXTINCTION = 35; // %

  const NEIGHBORS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  // ---------- Satunnaisluvut ja kohina ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeValueNoise(rand) {
    const size = 256;
    const perm = new Uint8Array(size * 2);
    const vals = new Float32Array(size);
    for (let i = 0; i < size; i++) { perm[i] = i; vals[i] = rand(); }
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < size; i++) perm[i + size] = perm[i];
    const lattice = (ix, iy) => vals[perm[(perm[ix & 255] + iy) & 511]];
    const fade = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = fade(x - ix), fy = fade(y - iy);
      const a = lattice(ix, iy), b = lattice(ix + 1, iy);
      const c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
  }

  function fbm(noise, x, y, octaves) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // ---------- Fysiikka ----------

  /** Tuulen menosuunnan yksikkövektori ruudukossa (y kasvaa etelään). */
  function windVector(dirFromDeg) {
    const r = (dirFromDeg * Math.PI) / 180;
    return [-Math.sin(r), Math.cos(r)];
  }

  function windFactor(speed, cosTheta) {
    return Math.exp(C1 * speed) * Math.exp(speed * C2 * (cosTheta - 1));
  }

  function slopeFactor(dElev, dist) {
    const deg = (Math.atan2(dElev, dist) * 180) / Math.PI;
    return Math.exp(SLOPE_A * deg);
  }

  function moistureFactor(moisturePct) {
    const r = 1 - moisturePct / MOISTURE_OF_EXTINCTION;
    return r <= 0 ? 0 : Math.pow(r, 1.3);
  }

  // ---------- Simulaatio ----------

  const DEFAULT_PARAMS = {
    windSpeed: 6,     // m/s
    windDir: 225,     // mistä tuulee, astetta (225 = lounaasta)
    moisture: 10,     // polttoaineen kosteus %
    spotting: true,   // kipinälento
    slope: true,      // rinteen vaikutus
  };

  function createSimulation(opts = {}) {
    const width = opts.width || 160;
    const height = opts.height || 110;
    const cellSize = opts.cellSize || 10; // metriä
    const n = width * height;

    const sim = {
      width, height, cellSize,
      seed: opts.seed ?? 1,
      params: Object.assign({}, DEFAULT_PARAMS, opts.params),
      elevation: new Float32Array(n),
      fuel: new Uint8Array(n),
      state: new Uint8Array(n),
      burnLeft: new Uint8Array(n),
      wet: new Float32Array(n),
      burning: [],
      time: 0,
      history: [],
      rand: mulberry32(opts.seed ?? 1),
    };

    sim.index = (x, y) => y * width + x;
    sim.inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

    sim.generate = function (seed) {
      sim.seed = seed >>> 0;
      const rand = mulberry32(sim.seed);
      const elevNoise = makeValueNoise(rand);
      const vegNoise = makeValueNoise(rand);
      const wetNoise = makeValueNoise(rand);
      const s = 1 / 28;
      const waterLevel = 0.36;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const e = fbm(elevNoise, x * s, y * s, 5);
          const v = fbm(vegNoise, x * s * 1.7 + 50, y * s * 1.7, 4);
          const w = fbm(wetNoise, x * s * 2.3, y * s * 2.3 + 90, 3);
          sim.elevation[i] = Math.max(e, waterLevel) * 120; // metriä
          let f;
          if (e < waterLevel) f = Fuel.WATER;
          else if (e < waterLevel + 0.05 && w > 0.45) f = Fuel.BOG;
          else if (e > 0.68 && v < 0.5) f = Fuel.ROCK;
          else if (w > 0.66 && e < 0.55) f = Fuel.BOG;
          else if (v < 0.33) f = Fuel.GRASS;
          else if (v < 0.42) f = Fuel.SHRUB;
          else if (v < 0.6) f = Fuel.CONIFER;
          else f = Fuel.MIXED;
          sim.fuel[i] = f;
        }
      }
      sim.rand = mulberry32(sim.seed ^ 0x9e3779b9);
      sim.resetFire();
    };

    sim.fill = function (fuelId, elevation = 0) {
      sim.fuel.fill(fuelId);
      sim.elevation.fill(elevation);
      sim.resetFire();
    };

    sim.resetFire = function () {
      sim.state.fill(State.UNBURNED);
      sim.burnLeft.fill(0);
      sim.wet.fill(0);
      sim.burning = [];
      sim.time = 0;
      sim.history = [];
      sim.rand = mulberry32(sim.seed ^ 0x9e3779b9);
    };

    function igniteCell(i) {
      if (sim.state[i] !== State.UNBURNED) return false;
      const f = FUELS[sim.fuel[i]];
      if (f.pBurn <= 0) return false;
      sim.state[i] = State.BURNING;
      sim.burnLeft[i] = f.burnTime;
      sim.wet[i] = 0;
      sim.burning.push(i);
      return true;
    }

    function forDisc(cx, cy, r, fn) {
      const r2 = r * r;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (!sim.inBounds(x, y)) continue;
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) fn(y * width + x, x, y);
        }
      }
    }

    /** Sytytä palo pisteeseen (x, y) säteellä r. Palauttaa syttyneiden ruutujen määrän. */
    sim.ignite = function (x, y, r = 0) {
      let count = 0;
      forDisc(x, y, r, (i) => { if (igniteCell(i)) count++; });
      return count;
    };

    /** Muuta maastotyyppiä (esim. palokuja). Palavia ruutuja ei muuteta. */
    sim.paintFuel = function (x, y, r, fuelId) {
      forDisc(x, y, r, (i) => {
        if (sim.state[i] === State.BURNING) return;
        sim.fuel[i] = fuelId;
        if (FUELS[fuelId].pBurn <= 0) sim.state[i] = State.UNBURNED;
      });
    };

    /** Vesipommitus: sammuttaa palavat ruudut ja kastelee maaston. */
    sim.waterDrop = function (x, y, r) {
      let extinguished = 0;
      forDisc(x, y, r, (i) => {
        if (sim.state[i] === State.BURNING) {
          sim.state[i] = State.BURNT;
          sim.burnLeft[i] = 0;
          extinguished++;
        }
        sim.wet[i] = 1;
      });
      if (extinguished) sim.burning = sim.burning.filter((i) => sim.state[i] === State.BURNING);
      return extinguished;
    };

    /** Todennäköisyys, että palava ruutu `from` sytyttää naapurin `to` yhden askeleen aikana. */
    sim.spreadProbability = function (from, to, dx, dy) {
      const f = FUELS[sim.fuel[to]];
      if (f.pBurn <= 0 || sim.state[to] !== State.UNBURNED) return 0;
      const P = sim.params;
      const diag = dx !== 0 && dy !== 0;
      const dist = (diag ? Math.SQRT2 : 1);
      const [wx, wy] = windVector(P.windDir);
      const cos = (dx * wx + dy * wy) / dist;
      let p = f.pBurn * moistureFactor(P.moisture) * windFactor(P.windSpeed, cos);
      if (P.slope) p *= slopeFactor(sim.elevation[to] - sim.elevation[from], dist * cellSize);
      if (diag) p *= DIAG_FACTOR;
      p *= 1 - sim.wet[to];
      return p > 1 ? 1 : p;
    };

    /** Etene yksi aika-askel (1 minuutti). */
    sim.step = function () {
      const P = sim.params;
      const rand = sim.rand;
      const newly = [];
      const mf = moistureFactor(P.moisture);
      const [wx, wy] = windVector(P.windDir);

      for (const i of sim.burning) {
        const x = i % width;
        const y = (i - x) / width;
        for (const [dx, dy] of NEIGHBORS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (sim.state[j] !== State.UNBURNED) continue;
          const p = sim.spreadProbability(i, j, dx, dy);
          if (p > 0 && rand() < p) newly.push(j);
        }

        // Kipinälento: voimakas tuuli kuljettaa kekäleitä myötätuuleen.
        const spot = FUELS[sim.fuel[i]].spot;
        if (P.spotting && spot > 0 && P.windSpeed > 4 && mf > 0) {
          const chance = 0.004 * spot * mf * (P.windSpeed - 4);
          if (rand() < chance) {
            const dist = 2 + rand() * P.windSpeed * 1.2;
            const spread = (rand() - 0.5) * 0.6;
            const ax = wx * Math.cos(spread) - wy * Math.sin(spread);
            const ay = wx * Math.sin(spread) + wy * Math.cos(spread);
            const tx = Math.round(x + ax * dist);
            const ty = Math.round(y + ay * dist);
            if (sim.inBounds(tx, ty)) {
              const j = ty * width + tx;
              const tf = FUELS[sim.fuel[j]];
              if (sim.state[j] === State.UNBURNED && rand() < tf.pBurn * mf * (1 - sim.wet[j])) newly.push(j);
            }
          }
        }
      }

      // Palavat ruudut hiipuvat.
      const still = [];
      for (const i of sim.burning) {
        if (sim.burnLeft[i] > 1) {
          sim.burnLeft[i]--;
          still.push(i);
        } else {
          sim.burnLeft[i] = 0;
          sim.state[i] = State.BURNT;
        }
      }
      sim.burning = still;
      for (const j of newly) igniteCell(j);

      // Kastelu haihtuu hiljalleen.
      const evap = 0.002 * (1 + P.windSpeed / 10) * (1 - P.moisture / 40);
      if (evap > 0) {
        for (let i = 0; i < n; i++) if (sim.wet[i] > 0) sim.wet[i] = Math.max(0, sim.wet[i] - evap);
      }

      sim.time++;
      const st = sim.stats();
      sim.history.push({ t: sim.time, burning: st.burning, burnt: st.burnt });
      return st;
    };

    sim.stats = function () {
      let burnt = 0, burnable = 0;
      for (let i = 0; i < n; i++) {
        if (sim.state[i] === State.BURNT) burnt++;
        if (FUELS[sim.fuel[i]].pBurn > 0) burnable++;
      }
      const burning = sim.burning.length;
      const haPerCell = (cellSize * cellSize) / 10000;
      return {
        time: sim.time,
        burning,
        burnt,
        burnable,
        affectedHa: (burning + burnt) * haPerCell,
        burntHa: burnt * haPerCell,
        burnablePct: burnable ? ((burning + burnt) / burnable) * 100 : 0,
        active: burning > 0,
      };
    };

    if (opts.generate === false) sim.fill(opts.fillFuel ?? Fuel.GRASS);
    else sim.generate(sim.seed);
    return sim;
  }

  return {
    State, FUELS, Fuel, DEFAULT_PARAMS,
    createSimulation, windVector, windFactor, slopeFactor, moistureFactor, mulberry32,
  };
});
