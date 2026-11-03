// Greedy neuron-level solver for the surgery challenges. It proves each challenge is solvable
// and gives a reference edit count. Usage: node train/solve_challenges.mjs fearless
// It only uses dials and freezes; input pinning (the cheaper trick on some) is checked at the end.
import fs from 'fs';
import { Brain } from '../web/js/brain.js';
import { CHALLENGES, prepareEval, measure, baseline } from '../web/js/challenges.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../web/data/${f}.json`, import.meta.url)));
const brain = new Brain(read('brain'));
const ev = prepareEval(brain, read('eval'));
const base = baseline(brain, ev);
const probe = read('probe').neurons;
const dead = new Set(probe.filter((n) => n.fire === 0).map((n) => `${n.layer}:${n.index}`));
const id = process.argv[2] || 'fearless';
const c = CHALLENGES.find((x) => x.id === id);
const num = (s) => parseFloat(String(s).replace('+-', '-').replace(/[^0-9.\-]/g, ''));

function score() {
  let v = 0;
  for (const r of c.check(measure(brain, ev), base, brain, dead)) {
    if (!r.ok) { const g = num(r.goal), x = num(r.value); v += Math.abs(x - g) / Math.max(Math.abs(g), 1) + 0.01; }
  }
  return v;
}

const actions = [];
for (const n of probe) {
  if (dead.has(`${n.layer}:${n.index}`)) continue;
  for (const a of ['freeze', 0, 0.5, 1.5, 2, 3]) actions.push([n.layer, n.index, a, n.mean]);
}
const steps = [];
let cur = score();
for (let step = 0; step < 25 && cur > 0; step++) {
  let best = null;
  for (const [l, i, a, mean] of actions) {
    const g0 = brain.gain[l][i], f0 = brain.freeze[l][i];
    if (a === 'freeze') { if (!isNaN(f0)) continue; brain.freeze[l][i] = mean; } else brain.gain[l][i] = a;
    const s = score();
    if (!best || s < best.s) best = { s, l, i, a, mean };
    brain.gain[l][i] = g0; brain.freeze[l][i] = f0;
  }
  if (best.s >= cur - 1e-4) break;
  if (best.a === 'freeze') brain.freeze[best.l][best.i] = best.mean; else brain.gain[best.l][best.i] = best.a;
  cur = best.s;
  steps.push(`L${best.l + 1}#${best.i}=${best.a}`);
  console.log(`${step + 1}. ${steps.at(-1)}  remaining shortfall ${cur.toFixed(3)}`);
}
const rows = c.check(measure(brain, ev), base, brain, dead);
console.log(`\n${c.title}: ${rows.every((r) => r.ok) ? 'SOLVED' : 'not solved'} with ${brain.editCount()} weight edits`);
rows.forEach((r) => console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}: ${r.value} (goal ${r.goal})`));
