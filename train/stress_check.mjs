// Reliability index (FORM) vs Monte Carlo vs real history, for a few households.
import fs from 'fs';
import { makeStress, designPoint, monteCarlo, importanceSample, history, describePath } from '../web/js/stress.js';
const H = JSON.parse(fs.readFileSync(new URL('../web/data/history.json', import.meta.url)));
const cases = [
  { name: '4% rule couple', age: 65, ira: 700000, roth: 100000, taxable: 200000, spend: 80000, ss: 45000, other: 0, equity: 0.6 },
  { name: 'Overspender', age: 62, ira: 900000, roth: 0, taxable: 100000, spend: 95000, ss: 40000, other: 0, equity: 0.6 },
  { name: 'Comfortable', age: 68, ira: 1500000, roth: 300000, taxable: 500000, spend: 110000, ss: 60000, other: 10000, equity: 0.5 },
  { name: 'Aggressive & rich', age: 61, ira: 5000000, roth: 0, taxable: 900000, spend: 260000, ss: 42000, other: 0, equity: 0.9 },
  { name: 'All bonds', age: 65, ira: 700000, roth: 100000, taxable: 200000, spend: 80000, ss: 45000, other: 0, equity: 0.1 },
];
for (const h of cases) {
  const t0 = performance.now();
  const m = makeStress(h, H.stats);
  const dp = designPoint(m);
  const ms = performance.now() - t0;
  const mc = monteCarlo(m, 20000);
  const hs = history(m, dp, H);
  const failed = hs.filter((w) => w.failed), agree = hs.filter((w) => w.failed === w.predicted).length;
  const d = describePath(dp);
  console.log(`\n${h.name}: withdraw $${Math.round(m.x).toLocaleString()}/yr (tax $${Math.round(m.taxAtX).toLocaleString()}), ${m.T} yrs`);
  const is = dp.beta > 0 ? importanceSample(m, dp, 2000) : { p: NaN, se: NaN };
  console.log(`  β = ${dp.beta.toFixed(2)}  FORM ${(dp.pFORM * 100).toFixed(1)}%  importance sampling (2k) ${(is.p * 100).toFixed(1)}% ± ${(is.se * 100).toFixed(1)}  plain Monte Carlo (20k) ${(mc * 100).toFixed(1)}%  (${ms.toFixed(1)} ms)`);
  console.log(`  design point: first ${d.k} yrs ${(d.first * 100).toFixed(1)}%/yr real, then ${d.rest === null ? '-' : (d.rest * 100).toFixed(1) + '%/yr'}`);
  console.log(`  history: ${failed.length}/${hs.length} windows failed: ${failed.map((w) => w.start).join(' ')}`);
  console.log(`  projection rule agrees with exact replay in ${agree}/${hs.length} windows; top severities: ${hs.slice().sort((a, b) => b.severity - a.severity).slice(0, 5).map((w) => `${w.start}:${w.severity.toFixed(2)}${w.failed ? '✗' : ''}`).join(' ')}`);
}
