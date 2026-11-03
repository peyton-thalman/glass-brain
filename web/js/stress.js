// Distance to ruin: the Hasofer–Lind reliability index (structural engineering's FORM method) for a retirement plan.
//
// The market is a vector of standard normal shocks z (stocks and bonds, every year to age 95), calibrated to real
// 1928–2025 returns. The plan fails when wealth at 95 drops below zero. HL-RF iteration finds the design point z*,
// the most likely market that breaks the plan. Its length β is how many standard deviations of bad luck it takes.
// FORM says P(fail) ≈ Φ(−β), which we check against Monte Carlo. Every real historical window is projected onto
// the failure direction to say which eras would have broken this plan, and then replayed exactly to check.
import { compileLaw, runCompiled } from './compile.js';
import { LAW } from './taxread.js';

const NET = compileLaw(LAW[2026]);
const tax = (ord, ss) => runCompiled(NET, Math.max(0, ord), ss, 0);

export function normCdf(x) {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// Annual withdrawal x that leaves `spend` after federal tax: x + ss + other − tax(φx + other, ss) = spend.
export function grossWithdrawal(h) {
  const W = h.ira + h.roth + h.taxable;
  const phi = W > 0 ? h.ira / W : 0;
  const net = (x) => x + h.ss + h.other - tax(phi * x + h.other, h.ss);
  if (net(0) >= h.spend) return { x: 0, phi, taxAtX: tax(h.other, h.ss) };
  let x = Math.max(0, h.spend - h.ss - h.other);
  for (let i = 0; i < 30; i++) {
    const f = net(x) - h.spend;
    const m = (tax(phi * (x + 1) + h.other, h.ss) - tax(phi * x + h.other, h.ss)); // marginal per $ of withdrawal
    x -= f / (1 - m);
    if (Math.abs(f) < 0.01) break;
  }
  return { x, phi, taxAtX: tax(phi * x + h.other, h.ss) };
}

export function makeStress(h, stats) {
  const T = Math.max(1, 95 - Math.round(h.age));
  const { x, phi, taxAtX } = grossWithdrawal(h);
  const e = h.equity, s = stats;
  const a1 = e * s.stockSd + (1 - e) * s.bondSd * s.corr;        // d r / d z1
  const a2 = (1 - e) * s.bondSd * Math.sqrt(1 - s.corr * s.corr); // d r / d z2
  const mu = e * s.stockMu + (1 - e) * s.bondMu;
  const W0 = h.ira + h.roth + h.taxable;
  const ret = (z, t) => mu + a1 * z[2 * t] + a2 * z[2 * t + 1];
  // g(z) = wealth at 95 (negative = the money ran out), and its gradient by a backward pass
  const g = (z, withGrad) => {
    const W = new Float64Array(T + 1); W[0] = W0;
    for (let t = 0; t < T; t++) W[t + 1] = (W[t] - x) * (1 + ret(z, t));
    if (!withGrad) return { g: W[T], W };
    const grad = new Float64Array(2 * T);
    let after = 1; // product of (1 + r_k) for k > t
    for (let t = T - 1; t >= 0; t--) {
      const dWdr = (W[t] - x) * after;
      grad[2 * t] = dWdr * a1; grad[2 * t + 1] = dWdr * a2;
      after *= 1 + ret(z, t);
    }
    return { g: W[T], W, grad };
  };
  return { h, T, x, phi, taxAtX, W0, mu, a1, a2, g, ret, stats: s };
}

// HL-RF: z ← [(∇g·z − g) / |∇g|²] ∇g, starting from the average market.
export function designPoint(m, iters = 60) {
  const n = 2 * m.T;
  let z = new Float64Array(n);
  const g0 = m.g(z, false).g;
  for (let k = 0; k < iters; k++) {
    const { g, grad } = m.g(z, true);
    let dot = 0, nn = 0;
    for (let i = 0; i < n; i++) { dot += grad[i] * z[i]; nn += grad[i] * grad[i]; }
    if (nn === 0) break;
    const c = (dot - g) / nn;
    const zn = new Float64Array(n);
    let diff = 0;
    for (let i = 0; i < n; i++) { zn[i] = c * grad[i]; diff += (zn[i] - z[i]) ** 2; }
    z = zn;
    if (diff < 1e-12) break;
  }
  let norm = 0; for (let i = 0; i < n; i++) norm += z[i] * z[i];
  norm = Math.sqrt(norm);
  const beta = g0 >= 0 ? norm : -norm;
  const path = Array.from({ length: m.T }, (_, t) => m.ret(z, t));
  const W = m.g(z, false).W;
  return { z, beta, pFORM: normCdf(-beta), path, W, g0 };
}

function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function monteCarlo(m, n = 4000, seed = 5) {
  const r = rng(seed);
  const z = new Float64Array(2 * m.T);
  let fail = 0;
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < z.length; i++) z[i] = gauss(r);
    if (m.g(z, false).g < 0) fail++;
  }
  return fail / n;
}

// Importance sampling centered on the design point: draw z ~ N(z*, I), weight by φ(z)/φ(z − z*) = exp(−z·z* + β²/2).
// Unbiased for P(fail), and far more efficient than plain Monte Carlo because samples land near the failure boundary.
export function importanceSample(m, dp, n = 2000, seed = 9) {
  const r = rng(seed), zs = dp.z, b2 = Array.from(zs).reduce((s, v) => s + v * v, 0);
  const z = new Float64Array(zs.length);
  let sum = 0, sum2 = 0;
  for (let k = 0; k < n; k++) {
    let dot = 0;
    for (let i = 0; i < z.length; i++) { z[i] = zs[i] + gauss(r); dot += z[i] * zs[i]; }
    const w = m.g(z, false).g < 0 ? Math.exp(-dot + b2 / 2) : 0;
    sum += w; sum2 += w * w;
  }
  const p = sum / n;
  return { p, se: Math.sqrt(Math.max(0, sum2 / n - p * p) / n) };
}

// Replay every real historical window, and project its shocks onto the failure direction.
export function history(m, dp, hist) {
  const s = m.stats, rows = hist.years, T = m.T;
  const u = Array.from(dp.z, (v) => (dp.beta !== 0 ? v / Math.abs(dp.beta) : 0));
  const out = [];
  for (let i = 0; i + T <= rows.length; i++) {
    let W = m.W0, severity = 0, minW = Infinity;
    for (let t = 0; t < T; t++) {
      const [, st, bd] = rows[i + t];
      const r = m.h.equity * st + (1 - m.h.equity) * bd;
      W = (W - m.x) * (1 + r);
      minW = Math.min(minW, W);
      const z1 = (st - s.stockMu) / s.stockSd;
      const z2 = ((bd - s.bondMu) / s.bondSd - s.corr * z1) / Math.sqrt(1 - s.corr * s.corr);
      severity += z1 * u[2 * t] + z2 * u[2 * t + 1];
    }
    out.push({ start: rows[i][0], end: rows[i + T - 1][0], failed: W < 0, endW: W, severity, predicted: dp.beta >= 0 ? severity > dp.beta : true });
  }
  return out;
}

// Plain-English shape of the design point: how bad the early years have to be.
export function describePath(dp) {
  const p = dp.path, k = Math.min(10, p.length);
  const geo = (a) => Math.pow(a.reduce((s, r) => s * (1 + r), 1), 1 / a.length) - 1;
  return { first: geo(p.slice(0, k)), rest: p.length > k ? geo(p.slice(k)) : null, k };
}
