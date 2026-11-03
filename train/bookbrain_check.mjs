// The Book Brain against the planning engine on households it has never seen, split by the facts that are easiest to
// get wrong: widow(er)s on a late spouse's Social Security record, care policies (on the "three years of care" head)
// and planned downsizing. Each household is scored on the engine with 1,000 trials, the way the X-ray does.
//   node train/bookbrain_check.mjs [per segment=150] [brain=web/data/bookbrain.json]
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import fs from 'fs';
import * as P from '../web/js/vendor/planner.js';
import { toPlan } from '../web/js/household/families.js';
import { prob, eventsFrom } from '../web/js/household/xray-core.js';
import { rng, sampleHousehold, features, headEvents, HEADS } from '../web/js/household/book-model.js';
import { BookBrain } from '../web/js/household/bookbrain.js';

const SEGMENTS = [
  ['Widow(er), late spouse’s benefit is larger', (f) => f.marital === 'widowed' && f.late.ssMonthly > f.people[0].ssMonthly, 'base'],
  ['Has a care policy', (f) => f.ltc.has === 'yes', 'ltc'],
  ['Plans to downsize', (f) => f.home.downsize, 'base'],
  ['None of these', (f) => f.marital !== 'widowed' && f.ltc.has !== 'yes' && !f.home.downsize, 'base'],
];

if (isMainThread) {
  const per = +(process.argv[2] || 150), brainFile = process.argv[3] || 'web/data/bookbrain.json';
  // A seed none of the training or demo data uses, so every household here is new to the brain.
  const r = rng(31337), picked = SEGMENTS.map(() => []);
  for (let i = 0; picked.some((p) => p.length < per); i++) {
    const f = sampleHousehold(r, 'c' + i, [0.012, 0.05]);
    SEGMENTS.forEach(([, test], s) => { if (picked[s].length < per && test(f)) picked[s].push(f); });
  }
  const jobs = picked.flatMap((fs_, s) => fs_.map((f) => ({ f, head: SEGMENTS[s][2], s })));
  const cores = Math.max(1, os.cpus().length - 1), n = Math.ceil(jobs.length / cores);
  const engine = (await Promise.all(Array.from({ length: cores }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: jobs.slice(w * n, (w + 1) * n) });
    wk.on('message', res); wk.on('error', rej);
  })))).flat();
  const brain = new BookBrain(JSON.parse(fs.readFileSync(brainFile, 'utf8')));
  console.log(`${brainFile} vs the planning engine (1,000 trials), ${per} new households per segment`);
  SEGMENTS.forEach(([name, , head], s) => {
    const h = HEADS.findIndex((x) => x.id === head);
    const err = jobs.map((j, i) => [j, i]).filter(([j]) => j.s === s).map(([j, i]) => Math.abs(brain.predict(j.f)[h] - engine[i])).sort((a, b) => a - b);
    const mean = err.reduce((t, e) => t + e, 0) / err.length;
    console.log(`  ${name.padEnd(46)} ${HEADS[h].label.padEnd(26)} mean ${mean.toFixed(2)} pts   90% within ${err[Math.floor(err.length * 0.9)].toFixed(1)}   worst ${err.at(-1).toFixed(1)}`);
  });
} else {
  parentPort.postMessage(workerData.map(({ f, head }) => {
    const ev = headEvents(f)[HEADS.findIndex((x) => x.id === head)];
    return prob(P, toPlan(P, f), eventsFrom(ev), 1000);
  }));
}
