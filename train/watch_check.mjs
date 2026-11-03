// Does the Book page's watch list catch the brain's big misses? Builds the list exactly as book.js does (brain vs the
// engine's stored answers at WATCH_MARKETS), then replays four other markets on the engine (300 trials) for every
// household in the demo book, and counts the misses the list covers.
//   node train/watch_check.mjs
import fs from 'fs';
import * as P from '../web/js/vendor/planner.js';
import { toPlan } from '../web/js/household/families.js';
import { applyMarket, WATCH_MARKETS, WATCH_GAP } from '../web/js/household/book-model.js';
import { BookBrain } from '../web/js/household/bookbrain.js';

const brain = new BookBrain(JSON.parse(fs.readFileSync(new URL('../web/data/bookbrain.json', import.meta.url), 'utf8')));
const book = JSON.parse(fs.readFileSync(new URL('../web/data/book.json', import.meta.url), 'utf8')).households;
const watch = new Set();
book.forEach((f, i) => WATCH_MARKETS.forEach(([s, b], k) => { if (Math.abs(brain.predict(applyMarket(f, s, b))[0] - f.engine.pRef[k]) > WATCH_GAP) watch.add(i); }));
console.log(`watch list: ${watch.size} of ${book.length.toLocaleString()} households`);
for (const [s, b] of [[-0.34, 0.07], [-0.25, -0.17], [-0.1, 0], [-0.45, -0.05]]) {
  let big = 0, bigW = 0, hid = 0, hidW = 0;
  book.forEach((f, i) => {
    const g = applyMarket(f, s, b), br = brain.predict(g)[0], en = P.probability(toPlan(P, g), { trials: 300, lite: true });
    if (Math.abs(br - en) > 20) { big++; if (watch.has(i)) bigW++; }
    if (en < 65 && br >= 75) { hid++; if (watch.has(i)) hidW++; }
  });
  console.log(`  S&P ${(s * 100).toFixed(0)}%, bonds ${(b * 100).toFixed(0)}%: misses over 20 pts ${bigW}/${big} on the list · red flags the brain hides (engine < 65%, brain ≥ 75%) ${hidW}/${hid} on the list`);
}
