// Is every brain, and every precomputed number, still the planning engine's answer? Checks that
//   1. the bundles in web/js/vendor/ match ~/moneyguide/src (skipped when that folder isn't here),
//   2. each file in web/data/ was labeled by the engine build the site now runs, and
//   3. the Book Brain was trained on the same household facts the site encodes.
// Exits non-zero with what to rebuild when any of them fails. The pages run checks 2 and 3 too (web/js/provenance.js).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { ENGINE } from './engine.mjs';
import { FEATURE_NAMES, HEADS } from '../web/js/household/book-model.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data', f), 'utf8'));
let bad = 0;
const fail = (msg) => { bad++; console.log(`  ✗ ${msg}`); };

if (fs.existsSync(path.join(process.env.MONEYGUIDE || path.join(os.homedir(), 'moneyguide'), 'src'))) {
  try { console.log('  ✓ ' + execFileSync('node', [path.join(ROOT, 'train/vendor/build.mjs'), '--check']).toString().trim()); }
  catch (e) { fail(e.stdout.toString().trim()); }
} else console.log('  · ~/moneyguide not found: skipping the source check');

// file, what rebuilds it
const BRAINS = [
  ['bookbrain.json', 'node train/bookdata.mjs 50000 400 0.5 && node train/bookdata.mjs 25000 400 1 train/book_data_shock.json 9000 && python3 train/booktrain.py'],
  ['book.json', 'node train/bookprep.mjs'],
  ['mgbrain.json', 'node train/mgdata.mjs 60000 500 && python3 train/mgtrain.py'],
  ['taxbrain.json', 'node train/taxdata.mjs && python3 train/taxtrain.py 96 40 3'],
  ['taxbrain_no-senior.json', 'node train/taxdata.mjs 3000000 no-senior && python3 train/taxtrain.py 96 40 3 no-senior'],
  ['rothpolicy.json', 'node train/rothdata.mjs && python3 train/rothtrain.py'],
];
for (const [f, how] of BRAINS) {
  const d = read(f);
  if (d.engine === ENGINE) console.log(`  ✓ ${f} labeled by engine ${ENGINE}`);
  else fail(`${f} labeled by engine ${d.engine || 'unknown'}, site runs ${ENGINE}. Rebuild: ${how}`);
}

const bb = read('bookbrain.json');
if ((bb.features || []).join('|') !== FEATURE_NAMES.join('|')) fail(`bookbrain.json reads ${bb.features ? bb.features.length : '?'} facts, book-model.js encodes ${FEATURE_NAMES.length}. Retrain the Book Brain.`);
else if (bb.layers[0].W[0].length !== FEATURE_NAMES.length) fail(`bookbrain.json's first layer takes ${bb.layers[0].W[0].length} inputs, not ${FEATURE_NAMES.length}.`);
else console.log(`  ✓ Book Brain reads the ${FEATURE_NAMES.length} facts book-model.js encodes`);
if (bb.heads.join('|') !== HEADS.map((h) => h.id).join('|')) fail('bookbrain.json heads differ from HEADS in book-model.js. Retrain the Book Brain.');

if (bad) { console.log(`${bad} provenance problem${bad > 1 ? 's' : ''}`); process.exit(1); }
