// Audit both tax brains against candidate laws, from their hinges.
import fs from 'fs';
import { TaxBrain, audit } from '../web/js/taxread.js';
for (const f of ['taxbrain', 'taxbrain_no-senior']) {
  const p = new URL(`../web/data/${f}.json`, import.meta.url);
  if (!fs.existsSync(p)) continue;
  const B = new TaxBrain(JSON.parse(fs.readFileSync(p)));
  console.log(`\n${f}`);
  for (const r of audit(B)) console.log(`  ${r.score.toFixed(3)}  kinks ${r.matched}/${r.count}  coverage ${(r.coverage * 100).toFixed(0)}%  stray ${r.stray}  err $${Math.round(r.err)}   ${r.name}`);
}
