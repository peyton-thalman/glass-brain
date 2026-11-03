// Judge Roth Autopilot in dollars on held-out households: its schedule (and a 25-step refinement) through the
// exact model, against the exact optimizer and the best fill-the-bracket rule.
import fs from 'fs';
import { makeModel, run } from '../web/js/roth.js';
import { Autopilot } from '../web/js/autopilot.js';
const D = JSON.parse(fs.readFileSync(new URL('./roth_data.json', import.meta.url)));
const pol = JSON.parse(fs.readFileSync(new URL('../web/data/rothpolicy.json', import.meta.url)));
const A = new Autopilot(pol);
let sOpt = 0, sRule = 0, sAuto = 0, sRef = 0, beatRule = 0, refBeatRule = 0, n = 0, tAuto = 0, tRef = 0;
for (const i of pol.test) {
  const row = D.rows[i];
  const [age, ira, ss, other, heirRate, draw, growth] = row.p;
  const p = { age, ira, ss, other, heirRate, draw, growth, years: 95 - age, rmdAge: age <= 66 ? 75 : 73, irmaa: true };
  const m = makeModel(p);
  let t0 = performance.now();
  const conv = A.schedule(p);
  const auto = run(m, conv).objective;
  tAuto += performance.now() - t0;
  t0 = performance.now();
  const ref = A.refine(p, conv).obj;
  tRef += performance.now() - t0;
  sOpt += row.none - row.opt; sRule += row.none - row.rule; sAuto += row.none - auto; sRef += row.none - ref;
  if (auto <= row.rule) beatRule++;
  if (ref <= row.rule) refBeatRule++;
  n++;
}
console.log(`${n} held-out households`);
console.log(`lifetime $ saved vs no conversions (sum): exact optimizer $${(sOpt / 1e6).toFixed(1)}M · best rule $${(sRule / 1e6).toFixed(1)}M · autopilot $${(sAuto / 1e6).toFixed(1)}M · autopilot+refine $${(sRef / 1e6).toFixed(1)}M`);
console.log(`autopilot captures ${(100 * sAuto / sOpt).toFixed(1)}% of the optimizer's savings in one pass (${(tAuto / n).toFixed(2)} ms each); with refinement ${(100 * sRef / sOpt).toFixed(1)}% (${(tRef / n).toFixed(1)} ms)`);
console.log(`beats the best rule of thumb: autopilot ${beatRule}/${n}, refined ${refBeatRule}/${n}`);
console.log(`extra $ vs best rule (sum): optimizer $${((sOpt - sRule) / 1e6).toFixed(1)}M · autopilot $${((sAuto - sRule) / 1e6).toFixed(1)}M · refined $${((sRef - sRule) / 1e6).toFixed(1)}M`);
