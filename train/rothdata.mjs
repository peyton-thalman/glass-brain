// Training data for Roth Autopilot: exact optimal conversion schedules, found by gradient descent through the
// compiled tax network (web/js/roth.js), for tens of thousands of households. Runs on all cores.
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import fs from 'fs';

export const K = 17; // conversion years the autopilot outputs (age 60 → 76 at most)

export function sampleHousehold(r) {
  const age = 60 + Math.floor(r() * 15);
  const ira = Math.exp(Math.log(100_000) + r() * Math.log(50)); // $100k – $5M, log-uniform
  return {
    age, ira,
    ss: r() < 0.08 ? 0 : 15_000 + r() * 85_000,
    other: r() < 0.5 ? 0 : Math.pow(r(), 2) * 120_000,
    heirRate: r() < 0.15 ? 0 : r() * 0.4,
    draw: r() < 0.3 ? 0 : ira * r() * 0.06,
    growth: 0.03 + r() * 0.035,
    years: 95 - age,
    rmdAge: age <= 66 ? 75 : 73,
    irmaa: true,
  };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  const n = +(process.argv[2] || 40000);
  const cores = Math.max(1, os.cpus().length - 1);
  const per = Math.ceil(n / cores);
  const t0 = Date.now();
  let done = 0;
  const parts = await Promise.all(Array.from({ length: cores }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { count: Math.min(per, n - w * per), seed: 500 + w } });
    wk.on('message', (m) => {
      if (m.progress) { done += m.progress; if (done % 4000 < m.progress) console.log(`  ${done.toLocaleString()} / ${n.toLocaleString()}  ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
      else res(m.rows);
    });
    wk.on('error', rej);
  })));
  const rows = parts.flat();
  fs.writeFileSync(new URL('./roth_data.json', import.meta.url), JSON.stringify({ K, rows }));
  console.log(`${rows.length.toLocaleString()} optimal schedules in ${((Date.now() - t0) / 1000).toFixed(0)}s on ${cores} cores`);
} else if (!isMainThread) {
  const { makeModel, run, optimize, fillBracket } = await import('../web/js/roth.js');
  const r = rng(workerData.seed);
  const rows = [];
  for (let i = 0; i < workerData.count; i++) {
    const p = sampleHousehold(r);
    const m = makeModel(p);
    let last;
    for (const it of optimize(m, 200)) last = it;
    const none = run(m, new Array(p.years).fill(0)).objective;
    const rule = Math.min(...[0.12, 0.22, 0.24].map((x) => run(m, fillBracket(m, x)).objective));
    const conv = Array.from({ length: K }, (_, t) => +(last.conv[t] || 0).toFixed(0));
    rows.push({ p: [p.age, p.ira, p.ss, p.other, p.heirRate, p.draw, p.growth].map((v) => +v.toFixed(5)), conv, opt: Math.round(last.obj), rule: Math.round(rule), none: Math.round(none) });
    if ((i + 1) % 500 === 0) parentPort.postMessage({ progress: 500 });
  }
  parentPort.postMessage({ rows });
}
