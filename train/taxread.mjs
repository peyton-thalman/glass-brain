// Print how well the trained Tax Brain's hinges line up with the real law's kinks.
import fs from 'fs';
import { TaxBrain, lawKinks, matchKinks } from '../web/js/taxread.js';
const d = JSON.parse(fs.readFileSync(new URL('../web/data/taxbrain.json', import.meta.url)));
const B = new TaxBrain(d);
const cases = process.argv[2] ? [process.argv.slice(2).map(Number)] : [[0, 0], [40000, 0], [40000, 60000], [70000, 150000]];
for (const [ss, g] of cases) {
  const lk = lawKinks(ss, g);
  const m = matchKinks(lk, B.kinks(ss, g));
  console.log(`\nSS $${ss.toLocaleString()}  gains $${g.toLocaleString()}`);
  for (const k of m) console.log(`  $${Math.round(k.at).toLocaleString().padStart(8)}  ${(k.jump * 100).toFixed(1).padStart(6)}pt  ${k.label.padEnd(46)} ${k.found ? `brain $${Math.round(k.center).toLocaleString()} (${k.err >= 0 ? '+' : ''}${Math.round(k.err).toLocaleString()})  ${Math.round(k.captured * 100)}%` : 'NOT FOUND'}`);
}
