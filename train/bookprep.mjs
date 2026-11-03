// The demo book for the Book X-ray: the four named families plus 3,996 made-up households, each with the
// engine's own answer at the plan date (to check the Book Brain against) and this year's tax picture from the
// engine's ledger (bracket, room left in it, distance to the first Medicare IRMAA tier), plus the engine's answer at
// each of the watch list's reference markets (WATCH_MARKETS in book-model.js).
//   node train/bookprep.mjs   → web/data/book.json
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import fs from 'fs';
import * as P from '../web/js/vendor/planner.js';
import { FAMILIES, toPlan } from '../web/js/household/families.js';
import { makeBook, applyMarket, WATCH_MARKETS } from '../web/js/household/book-model.js';
import { ENGINE } from './engine.mjs';

const N = 4000, TRIALS = 1000;

if (isMainThread) {
  const book = [...FAMILIES.map((f) => ({ ...f, named: true })), ...makeBook(N - FAMILIES.length)];
  const cores = Math.max(1, os.cpus().length - 1), per = Math.ceil(book.length / cores);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: cores }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { book: book.slice(w * per, (w + 1) * per) } });
    wk.on('message', res);
    wk.on('error', rej);
  })));
  const extra = parts.flat();
  const households = book.map((f, i) => ({ ...f, engine: extra[i] }));
  fs.writeFileSync('web/data/book.json', JSON.stringify({ engine: ENGINE, trials: TRIALS, households }));
  const ps = extra.map((e) => e.p);
  console.log(`${book.length} households in ${((Date.now() - t0) / 1000).toFixed(0)}s; below 75%: ${ps.filter((p) => p < 75).length}`);
} else {
  parentPort.postMessage(workerData.book.map((f) => {
    const plan = toPlan(P, f);
    const p = P.probability(plan, { trials: TRIALS, lite: true });
    const row = P.simulate(plan, { trials: 1, lite: true }).rows[0];
    const t = row.tax;
    const filing = row.alive[0] && row.alive[1] ? 'mfj' : 'single';
    const pRef = WATCH_MARKETS.map(([spx, bond]) => P.probability(toPlan(P, applyMarket(f, spx, bond)), { trials: TRIALS, lite: true }));
    return {
      p, pRef,
      rate: t ? t.bracketRate : 0,
      room: t ? Math.round(t.bracketRoom) : 0,
      magi: t ? Math.round(t.magi) : 0,
      irmaaRoom: t ? Math.round(P.IRMAA.tiers[filing][0] - t.magi) : 0,
      draw: Math.round(row.fromCash + row.fromTaxable + row.fromDeferred + row.fromRoth + row.rmd),
    };
  }));
}
