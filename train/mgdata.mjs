// Training data for the MoneyGuide Brain: real plans run through the real MoneyGuide engine
// (train/mg/moneyguide.mjs, bundled from ~/moneyguide/src). A retired married couple built on the engine's
// own Chen sample household, varied across ten facts. Each plan gets a 500-trial Monte Carlo under 2026 law.
// Runs across all CPU cores with worker threads.
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import fs from 'fs';

export const FEATURES = [
  // name, lo, hi
  ['age', 60, 75],
  ['spouseGap', -6, 2],
  ['ira', 0, 4_000_000],
  ['roth', 0, 1_500_000],
  ['taxable', 0, 2_000_000],
  ['spending', 40_000, 220_000],
  ['pia', 1_000, 4_200],
  ['claimAge', 62, 70],
  ['portfolio', 1, 6],
  ['stateRate', 0, 0.093],
];

export function makePlan(M, f) {
  const base = M.sampleHouseholds().find((h) => /Chen/.test(h.name)).current;
  const plan = JSON.parse(JSON.stringify(base));
  const now = 2026;
  const age = Math.round(f.age), sAge = Math.round(f.age + f.spouseGap);
  Object.assign(plan.client, { birthYear: now - age, retirementAge: age, acceptableRetirementAge: age, salary: 0, ssPia: f.pia, ssClaimAge: Math.max(age, Math.round(f.claimAge)) });
  Object.assign(plan.spouse, { birthYear: now - sAge, retirementAge: sAge, acceptableRetirementAge: sAge, salary: 0, ssPia: Math.round(f.pia * 0.45), ssClaimAge: Math.max(sAge, 67) });
  const cash = 0.04 * (f.ira + f.roth + f.taxable);
  const acct = (type, owner, balance, basis) => ({ id: type + owner, name: type, owner, type, balance, basis, annualSavings: 0, savingsIncrease: 0 });
  plan.accounts = [acct('deferred', 'client', f.ira, 0), acct('roth', 'client', f.roth, 0), acct('taxable', 'joint', f.taxable, f.taxable * 0.6), acct('cash', 'joint', cash, cash)];
  plan.goals = plan.goals.filter((g) => g.type === 'retirement').map((g) => ({ ...g, amount: f.spending, acceptable: f.spending }));
  plan.assumptions = { ...plan.assumptions, stateRate: f.stateRate, preRetPortfolio: Math.round(f.portfolio), postRetPortfolio: Math.round(f.portfolio) };
  return M.normalizePlan(plan);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleFacts(r) {
  const f = {};
  for (const [k, lo, hi] of FEATURES) f[k] = lo + r() * (hi - lo);
  // Balances: skewed toward realistic sizes, with some empty accounts.
  f.ira = r() < 0.08 ? 0 : Math.pow(r(), 1.4) * 4_000_000;
  f.roth = r() < 0.3 ? 0 : Math.pow(r(), 1.8) * 1_500_000;
  f.taxable = r() < 0.2 ? 0 : Math.pow(r(), 1.6) * 2_000_000;
  f.stateRate = [0, 0, 0.03, 0.05, 0.093][Math.floor(r() * 5)];
  f.portfolio = 1 + Math.floor(r() * 6);
  f.claimAge = 62 + Math.floor(r() * 9);
  // Spending scaled to what the money can plausibly support, so labels span 0–100%.
  const total = f.ira * 0.8 + f.roth + f.taxable;
  const ss = f.pia * 12 * 1.45;
  f.spending = Math.min(220_000, Math.max(40_000, ss + total * (0.015 + r() * 0.085)));
  return f;
}

if (isMainThread) {
  const n = +(process.argv[2] || 60000);
  const trials = +(process.argv[3] || 500);
  const cores = Math.max(1, os.cpus().length - 1);
  const per = Math.ceil(n / cores);
  const t0 = Date.now();
  let done = 0;
  const results = await Promise.all(Array.from({ length: cores }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { start: w * per, count: Math.min(per, n - w * per), trials, seed: 1000 + w } });
    wk.on('message', (m) => {
      if (m.progress) { done += m.progress; if (done % 5000 < m.progress) console.log(`  ${done.toLocaleString()} / ${n.toLocaleString()} plans  ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
      else res(m);
    });
    wk.on('error', rej);
  })));
  const rows = results.flatMap((r) => r.rows);
  fs.writeFileSync(new URL('./mg_data.json', import.meta.url), JSON.stringify({ features: FEATURES.map((x) => x[0]), trials, rows }));
  console.log(`${rows.length.toLocaleString()} plans in ${((Date.now() - t0) / 1000).toFixed(0)}s on ${cores} cores`);
} else {
  const M = await import('./mg/moneyguide.mjs');
  const { count, trials, seed } = workerData;
  const r = rng(seed);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const f = sampleFacts(r);
    const res = M.simulate(makePlan(M, f), { trials, lite: true });
    rows.push([...FEATURES.map(([k]) => +f[k].toFixed(4)), res.probability, Math.round(res.lifetimeTax || 0), Math.round(res.afterTaxLegacy || 0)]);
    if ((i + 1) % 500 === 0) parentPort.postMessage({ progress: 500 });
  }
  parentPort.postMessage({ rows });
}
