// The same retirement Monte Carlo the brain was trained on (train/sim.py), in JS.
// It is the "ground truth" the brain is compared against, and it draws the lifelines.

export const MAX_AGE = 110;
const STOCK_MU = 0.065, STOCK_SD = 0.17;
const BOND_MU = 0.018, BOND_SD = 0.065;
const CORR = 0.10;
const EARLY_YEARS = 5;
const MODE = 88, DISP = 9.5;

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  next.normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u === 0) u = next();
    const v = next(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return next;
}

// c: { age, portfolio, spending, income, equity, early, flex, health }
// Returns aggregate stats plus `keep` paths of yearly wealth for drawing.
export function simulate(c, paths = 2000, keep = 500, seed = 12345) {
  const r = rng(seed);
  const Y = MAX_AGE - Math.floor(c.age);
  const need = Math.max(0, c.spending - c.income);
  const mode = MODE + 5 * c.health;
  const k = Math.exp((c.age - mode) / DISP);
  let ok = 0, broke = 0;
  const legacies = new Float64Array(paths);
  const lines = [];
  const stock = new Float64Array(Y);
  for (let p = 0; p < paths; p++) {
    let u = r(); if (u < 1e-7) u = 1e-7;
    const death = Math.min(MAX_AGE, c.age + DISP * Math.log1p(-Math.log(u) / k));
    const bondZ = new Float64Array(Y);
    for (let y = 0; y < Y; y++) {
      const z1 = r.normal(), z2 = r.normal();
      stock[y] = STOCK_MU + STOCK_SD * z1;
      bondZ[y] = CORR * z1 + Math.sqrt(1 - CORR * CORR) * z2;
    }
    let m = 0;
    for (let y = 0; y < EARLY_YEARS; y++) m += stock[y];
    m /= EARLY_YEARS;
    for (let y = 0; y < EARLY_YEARS; y++) stock[y] = stock[y] - m + c.early;

    let w = c.portfolio, survived = true, brokeYears = 0, legacy = 0;
    const line = p < keep ? [w] : null;
    for (let y = 0; y < Y; y++) {
      const a = c.age + y;
      if (a >= death) break;
      const ret = Math.max(-0.95, c.equity * stock[y] + (1 - c.equity) * (BOND_MU + BOND_SD * bondZ[y]));
      const dd = Math.min(1, Math.max(0, (1 - w / c.portfolio) / 0.4));
      w = (w - need * (1 - c.flex * dd)) * (1 + ret);
      if (w <= 0) { if (survived && need > 0) survived = false; if (need > 0) brokeYears++; w = 0; }
      if (a + 1 >= death) legacy = w;
      if (line) line.push(w);
    }
    if (survived) ok++;
    broke += brokeYears;
    legacies[p] = legacy;
    if (line) lines.push({ w: line, survived, death });
  }
  legacies.sort();
  return {
    success: ok / paths,
    legacy: legacies[Math.floor(paths / 2)],
    brokeYears: broke / paths,
    lines,
  };
}
