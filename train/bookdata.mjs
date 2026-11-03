// Training data for the Book Brain: made-up households run through the MoneyGuide engine under seven scenarios,
// using the same functions as the Household X-ray (xray-core.js), so every label is what the X-ray would show.
// Half the households get a random market move first, so the brain sees plans after crashes and rallies.
//   node train/bookdata.mjs [households=40000] [trials=300] [shockShare=0.5] [out=train/book_data.json] [seed=7000]
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import fs from 'fs';
import * as P from '../web/js/vendor/planner.js';
import { toPlan } from '../web/js/household/families.js';
import { prob, eventsFrom } from '../web/js/household/xray-core.js';
import { rng, sampleHousehold, applyMarket, features, headEvents, HEADS } from '../web/js/household/book-model.js';

if (isMainThread) {
  const n = +(process.argv[2] || 40000), trials = +(process.argv[3] || 300), shock = +(process.argv[4] ?? 0.5);
  const outFile = process.argv[5] || 'train/book_data.json', seed0 = +(process.argv[6] || 7000);
  const cores = Math.max(1, os.cpus().length - 1), per = Math.ceil(n / cores);
  const t0 = Date.now();
  let done = 0;
  const parts = await Promise.all(Array.from({ length: cores }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { count: Math.min(per, n - w * per), trials, shock, seed: seed0 + w } });
    wk.on('message', (m) => {
      if (m.progress) { done += m.progress; if (done % 4000 < m.progress) console.log(`  ${done.toLocaleString()} / ${n.toLocaleString()}  ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
      else res(m.rows);
    });
    wk.on('error', rej);
  })));
  const rows = parts.flat();
  fs.writeFileSync(outFile, JSON.stringify({ heads: HEADS.map((h) => h.id), trials, rows }));
  console.log(`${rows.length.toLocaleString()} households in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outFile}`);
} else {
  const { count, trials, shock, seed } = workerData;
  const r = rng(seed), rows = [];
  for (let i = 0; i < count; i++) {
    let f = sampleHousehold(r, 'x');
    if (r() < shock) f = applyMarket(f, -0.5 + r() * 0.7);
    const plan = toPlan(P, f);
    const y = headEvents(f).map((e) => (e ? prob(P, plan, eventsFrom(e), trials) : -1));
    rows.push([features(f).map((v) => Math.round(v * 1e4) / 1e4), y]);
    if ((i + 1) % 100 === 0) parentPort.postMessage({ progress: 100 });
  }
  parentPort.postMessage({ rows });
}
