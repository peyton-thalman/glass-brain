// The Household X-ray's numbers for each sample family, straight from the engine (node train/xray_check.mjs).
import * as P from '../web/js/vendor/planner.js';
import { FAMILIES, toPlan } from '../web/js/household/families.js';
import * as X from '../web/js/household/xray-core.js';

const pct = (x) => (x * 100).toFixed(1) + '%';
for (const f of FAMILIES) {
  const plan = toPlan(P, f);
  const v = X.verdict(P, plan, {});
  const d = v.diagnosis;
  console.log(`\n${f.name}: ${v.probability}% Monte Carlo, ${d.tested - d.failed}/${d.tested} real start years`);
  if (d.failed) console.log(`  failed years, first decade ${pct(d.badFirst10)}/yr real vs ${pct(d.goodFirst10)} when it worked; after year 10 ${pct(d.badAfter10)} vs ${pct(d.goodAfter10)}`);
  for (const e of X.eventCatalog(plan, f)) console.log(`  ${e.label}${e.def != null ? ' ' + e.def : ''}: ${X.prob(P, plan, X.eventsFrom({ [e.id]: e.def ?? true }))}%`);
  const fx = X.gentlestFix(P, plan, {}, f);
  console.log(`  gentlest fix ${fx.before}% -> ${fx.after}%: ${fx.changes.map((c) => c.what).join('; ') || 'none needed'}`);
}
