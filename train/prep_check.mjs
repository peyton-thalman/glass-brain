// Meeting prep, judged against answer keys: runs the real agent (Claude through serve.py's relay, the engine in this
// process) on each sample meeting in web/data/meetings/ and checks the facts it heard, what it flagged, that ID
// numbers never reached Claude, that no number in the packet was typed by the model, and that every engine call
// replays exactly. It calls Claude's API, so it costs money (about $0.15–$0.40 a meeting on Opus 5.5).
//   node train/prep_check.mjs                       all five, Claude Opus 5.5
//   node train/prep_check.mjs --model claude-sonnet-5-5 --only kowalski,alvarez
// Skips (exit 0) when there is no ANTHROPIC_API_KEY in the environment or .env.local.
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import * as P from '../web/js/vendor/planner.js';
import * as S from '../web/js/vendor/scenario.js';
import { session, replay } from '../web/js/prep/tools.js';
import { runAgent, redact } from '../web/js/prep/agent.js';

const ROOT = new URL('..', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const model = arg('--model', 'claude-opus-5-5');
const only = arg('--only', '');

const hasKey = process.env.ANTHROPIC_API_KEY || (fs.existsSync(path.join(ROOT, '.env.local')) && /^ANTHROPIC_API_KEY=.+/m.test(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')));
if (!hasKey) { console.log('  · no ANTHROPIC_API_KEY: skipping the Meeting prep check (it calls Claude’s API)'); process.exit(0); }

// The same relay the page uses, on a free port.
const port = await new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = spawn('uv', ['run', '--quiet', '--with', 'anthropic', 'serve.py'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { server.stdout.once('data', res); server.once('exit', (c) => rej(new Error(`serve.py exited (${c})`))); });
const send = (body) => fetch(`http://localhost:${port}/api/claude`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const plainText = (toks) => toks.map((t) => t.s).join('');
const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/meetings/index.json'), 'utf8')).meetings.map((m) => m.id).filter((id) => !only || only.split(',').includes(id));
let failed = 0, cost = 0;
try {
  for (const id of ids) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, `web/data/meetings/${id}.json`), 'utf8'));
    const k = m.key;
    const checks = [];
    const ok = (pass, what) => checks.push({ pass: !!pass, what });
    const { text: notes, removed } = redact(m.notes);
    ok(removed === k.removed, `ID numbers removed before sending: ${removed} (expected ${k.removed})`);
    for (const s of k.forbid) if (/\d/.test(s)) ok(!notes.includes(s), `"${s}" never reaches Claude`);
    const s = session(P, S);
    const t0 = Date.now();
    let res;
    try {
      res = await runAgent({ notes, model, send, runTool: async (n, i) => s.run(n, i), getRefs: async () => s.refs });
    } catch (e) {
      console.log(`\n${m.title}: FAILED to finish (${e.message})`);
      failed++;
      continue;
    }
    const { packet, usage } = res;
    cost += usage.cost;
    const f = s.facts, src = s.sources;
    const get = (p) => p.split('.').reduce((o, x) => (o == null ? o : o[x]), f);
    for (const [p, want] of Object.entries(k.facts)) {
      const got = get(p);
      ok(typeof got === 'number' && Math.abs(got - want) <= Math.max(1, Math.abs(want) * 0.02), `${p} = ${want} (heard ${got})`);
    }
    for (const p of k.unclear) ok(['unclear', 'assumed'].includes(src[p]?.source) || get(p) === -1, `${p} flagged as unclear (${src[p]?.source || 'no source'}, value ${get(p)})`);
    const asks = packet.asks.map((a) => plainText(a.question) + ' ' + plainText(a.why)).join(' \n');
    for (const re of k.asks) ok(new RegExp(re, 'i').test(asks), `asks mention /${re}/`);
    const topics = s.calls.filter((c) => c.name === 'plan_check').map((c) => c.input.topic);
    for (const re of k.topics) ok(topics.some((t) => new RegExp(re).test(t)), `plan_check asked about /${re}/ (asked: ${topics.join(', ') || 'none'})`);
    const all = [packet.client_summary, packet.file_note, ...packet.todos.flatMap((t) => [t.what, t.when]), ...packet.asks.flatMap((a) => [a.question, a.why])].map(plainText).join('\n');
    for (const str of k.forbid) ok(!all.toLowerCase().includes(str.toLowerCase()), `packet never says "${str}"`);
    for (const re of k.note_mentions || []) ok(new RegExp(re, 'i').test(plainText(packet.file_note)), `file note mentions /${re}/`);
    ok(packet.ok && packet.problems.length === 0, `number audit: 0 typed numbers, ${packet.refsUsed.length} filled in by code`);
    ok(packet.refsUsed.includes('xray.score'), 'the client summary gives the engine’s score');
    const r = replay(P, S, s.calls);
    ok(r.diffs.length === 0, `replay: ${r.checked - r.diffs.length} of ${r.checked} engine calls reproduced exactly`);
    const bad = checks.filter((c) => !c.pass);
    if (bad.length) failed++;
    console.log(`\n${m.title} (${id}): ${checks.length - bad.length}/${checks.length} checks, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${usage.calls} Claude calls, $${usage.cost.toFixed(2)}`);
    for (const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.what}`);
  }
} finally {
  server.kill();
}
console.log(`\n${ids.length - failed} of ${ids.length} meetings passed on ${model}, about $${cost.toFixed(2)} in all`);
process.exit(failed ? 1 : 0);
