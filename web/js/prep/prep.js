// Meeting prep page: notes in, the packet out. Claude runs through the relay (serve.py /api/claude); the engine
// tools run in prep-worker.js; agent.js holds the loop and the number audit.
import { runAgent, redact, MODELS } from './agent.js';
import { buildRecord, download, DISCLOSURES } from './record.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- the engine, off the main thread

const worker = new Worker(new URL('./prep-worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const waiting = new Map();
worker.onmessage = ({ data }) => { waiting.get(data.id)?.(data.out); waiting.delete(data.id); };
const ask = (msg) => new Promise((res) => { const id = ++seq; waiting.set(id, res); worker.postMessage({ id, ...msg }); });

async function send(body) {
  try {
    const r = await fetch('api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 404 || r.status === 405 || r.status === 501) return { error: 'no_relay', message: 'This page needs the local server with the Claude relay: run  uv run --with anthropic serve.py' };
    return await r.json();
  } catch {
    return { error: 'network', message: 'Couldn’t reach the local server. Is serve.py running?' };
  }
}

// ---------------------------------------------------------------- sample meetings

let samples = [];
async function loadSamples() {
  try { samples = (await fetch('data/meetings/index.json').then((r) => r.json())).meetings; } catch { samples = []; }
  $('#samples').innerHTML = samples.map((m) => `<button type="button" data-sample="${esc(m.id)}" aria-pressed="false" title="${esc(m.blurb)}">${esc(m.title)}</button>`).join('');
}
$('#samples').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sample]');
  if (!b) return;
  const m = await fetch(`data/meetings/${b.dataset.sample}.json`).then((r) => r.json());
  $('#notes').value = m.notes;
  document.querySelectorAll('[data-sample]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});
$('#notes').addEventListener('input', () => document.querySelectorAll('[data-sample]').forEach((x) => x.setAttribute('aria-pressed', 'false')));

// ---------------------------------------------------------------- progress, in plain words

const TOPIC = { roth_conversion: 'a Roth conversion', social_security_timing: 'when to claim Social Security', medicare: 'Medicare premiums', rmd: 'required withdrawals', qcd: 'giving from the IRA' };
function step(html, cls = 'now') {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = `<i class="ph ${cls === 'now' ? 'ph-circle-notch' : cls === 'done' ? 'ph-check-circle' : cls === 'err' ? 'ph-x-circle' : 'ph-warning-circle'}"></i><span>${html}</span>`;
  $('#steps').append(li);
  return li;
}
const finish = (li, html, cls = 'done') => {
  if (!li) return;
  li.className = cls;
  li.querySelector('i').className = `ph ${cls === 'done' ? 'ph-check-circle' : cls === 'err' ? 'ph-x-circle' : 'ph-warning-circle'}`;
  if (html) li.querySelector('span').innerHTML = html;
};

function describeDone(name, input, out) {
  if (out && out.ok === false) return [`The engine sent back a correction for Claude: ${esc(out.error)}`, 'warn'];
  if (name === 'record_facts') return [`Wrote down <b>${esc(out.household)}</b>: ${Object.keys(out.refs).length} facts, ${out.filled_with_typical_values.length} filled with typical values`, 'done'];
  if (name === 'xray') return [`Ran 1,000 futures and every real start year since 1928: <b>${out.score} out of 100</b>, ${esc(out.real_years_lasted)} real years lasted. Hardest hit: ${esc(out.worst_event)}`, 'done'];
  if (name === 'gentlest_fix') return [`Searched for the gentlest fix${out.under !== 'as planned' ? ` if ${esc(/^[A-Z][a-z]+ (dies|needs)/.test(out.under) ? out.under : out.under.charAt(0).toLowerCase() + out.under.slice(1))}` : ''}: <b>${out.before} → ${out.after}</b>${out.changes.length ? ` with ${out.changes.length} change${out.changes.length > 1 ? 's' : ''}` : ', nothing needed'}`, 'done'];
  if (name === 'ask_first') return [`Ranked the unconfirmed facts by how much they move the plan (${out.questions.length})`, 'done'];
  if (name === 'plan_check') return out.status === 'answer' ? [`Asked the engine about ${TOPIC[input.topic] || input.topic}: <b>${esc(out.headline)}</b>`, 'done'] : [`The engine couldn’t answer ${TOPIC[input.topic] || input.topic}: ${esc(out.message)}`, 'warn'];
  return [esc(name), 'done'];
}
const START = { record_facts: 'Writing down the household…', xray: 'Running the plan through 1,000 futures…', gentlest_fix: 'Searching for the gentlest fix…', ask_first: 'Scoring what to confirm first…', plan_check: 'Asking the engine…' };

// ---------------------------------------------------------------- run

let engine = null;
fetch('js/vendor/engine.json').then((r) => r.json()).then((e) => (engine = e));

$('#go').addEventListener('click', async () => {
  const raw = $('#notes').value.trim();
  if (raw.length < 40) { $('#notes').focus(); return; }
  const { text: notes, removed } = redact(raw);
  const red = $('#redacted');
  red.hidden = !removed;
  if (removed) red.innerHTML = `<i class="ph ph-shield-check"></i> Took out ${removed} thing${removed > 1 ? 's' : ''} that looked like an ID or account number before sending. Claude never saw ${removed > 1 ? 'them' : 'it'}.`;
  const model = $('#model').value, effort = 'medium', startedAt = new Date().toISOString();
  $('#go').disabled = true;
  $('#packet').hidden = true;
  $('#progress').hidden = false;
  $('#steps').innerHTML = '';
  await ask({ type: 'reset' });
  const open = new Map();
  let think = step('Reading the notes…');
  try {
    const { packet, usage } = await runAgent({
      notes, model, effort, send,
      runTool: (name, input) => ask({ type: 'run', name, input }),
      getRefs: async () => (await ask({ type: 'state' })).refs,
      onEvent: (e) => {
        if (e.kind === 'thinking' && e.turn > 0 && !think) think = step('Claude is reading the engine’s answers…');
        if (e.kind === 'tool') { if (think) { think.remove(); think = null; } open.set(e.name + JSON.stringify(e.input), step(START[e.name] || 'Working…')); }
        if (e.kind === 'tool_done') { const k = e.name + JSON.stringify(e.input); finish(open.get(k), ...describeDone(e.name, e.input, e.out)); open.delete(k); }
        if (e.kind === 'audit') {
          if (think) { think.remove(); think = null; }
          step(e.ok ? 'Checked every number in the packet: <b>none typed by the AI</b>' : `The number audit sent a draft back: ${esc(e.problems.length)} problem${e.problems.length > 1 ? 's' : ''} (${esc(e.problems[0])})`, e.ok ? 'done' : 'warn');
        }
      },
    });
    const state = await ask({ type: 'state' });
    const record = buildRecord({ notes, removed, model, effort, engine, state, packet, usage, startedAt });
    render(packet, state, record);
  } catch (err) {
    if (think) finish(think, '', 'err');
    step(esc(err.message), 'err');
  } finally {
    $('#go').disabled = false;
  }
});

// ---------------------------------------------------------------- the packet

const KIND = { engine: 'From the engine', said: 'From the notes', notes: 'From the notes', assumed: 'Assumed', unclear: 'Unclear in the notes' };
let tipRefs = {};
function span(tok) {
  if (tok.t !== 'ref') return esc(tok.s);
  const kind = tok.from?.kind === 'said' ? 'notes' : tok.from?.kind || 'engine';
  const id = 'r' + Object.keys(tipRefs).length;
  tipRefs[id] = tok;
  return `<span class="ref ${kind === 'engine' ? '' : kind}" tabindex="0" data-tip="${id}">${esc(tok.s)}</span>`;
}
const inline = (toks) => toks.map(span).join('');
function paragraphs(toks) {
  const html = inline(toks);
  const blocks = html.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[-•]\s/.test(l))) return `<ul>${lines.map((l) => `<li>${l.replace(/^[-•]\s/, '')}</li>`).join('')}</ul>`;
    return `<p>${lines.join('<br>')}</p>`;
  }).join('');
}

const LABEL = {
  age: 'age', sex: 'sex', health: 'health', planTo: 'plan to age', retiredAt: 'retired / retires at', salary: 'pay a year', ssMonthly: 'Social Security a month', claimAge: 'claims Social Security at',
};
function factLabel(path, f) {
  const p = path.split('.');
  const who = (i) => f.people[+i]?.first || `Person ${+i + 1}`;
  if (p[0] === 'people') return `${who(p[1])}: ${LABEL[p[2]] || p[2]}`;
  if (p[0] === 'pensions') { const x = f.pensions[+p[1]]; return `${x?.name || 'Pension'}: ${{ monthly: 'a month', cola: 'rises with inflation', survivorPct: 'survivor keeps', endAge: 'ends at age', owner: 'whose', name: 'name' }[p[2]] || p[2]}`; }
  if (p[0] === 'accounts') return p[1] === 'ira' ? `${who(p[2])}'s IRA / 401(k)` : p[1] === 'save' ? `${who(p[2])} saves a year` : { roth: 'Roth IRA', taxable: 'Brokerage', basis: 'Brokerage cost basis', cash: 'Cash and CDs' }[p[1]];
  if (p[0] === 'spending') return p[1] === 'wants' ? `${f.spending.wants[+p[2]]?.name || 'Goal'}: ${p[3] === 'yearly' ? 'a year' : p[3] === 'years' ? 'for years' : p[3]}` : { core: 'Everyday spending a month', survivorPct: 'Spending for a survivor', gifts: 'Gifts a year', legacy: 'Leave to heirs' }[p[1]] || p[1];
  if (p[0] === 'home') return { value: 'Home value', downsize: 'Plans to downsize', downsizeYear: 'Downsize in', netProceeds: 'Downsizing frees' }[p[1]] || p[1];
  if (p[0] === 'invest') return p[1] === 'portfolio' ? 'Investment mix' : 'All-in fees';
  if (p[0] === 'feelings') return { cutOk: 'Could trim in a bad year', priority: 'What matters most', worry: 'Biggest worry' }[p[1]];
  if (p[0] === 'ltc') return `Long-term-care policy: ${{ has: 'has one', daily: 'a day', years: 'years', rider: 'inflation rider' }[p[1]] || p[1]}`;
  if (p[0] === 'late') return `Late spouse: ${p[1] === 'ssMonthly' ? 'Social Security a month' : p[1]}`;
  return path;
}
const MIX = ['Cash', 'Conservative', 'Moderately conservative', 'Moderate', 'Moderately aggressive', 'Aggressive', 'All stocks'];
function factValue(path, v, refs) {
  if (refs[path]) return esc(refs[path].text);
  if (/portfolio$/.test(path)) return MIX[v] || v;
  if (/survivorPct$/.test(path) && v < 0) return 'Not known yet';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return esc(v);
}
function flat(o, pre = '', out = []) {
  for (const [k, v] of Object.entries(o || {})) {
    const p = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object') flat(v, p, out); else out.push([p, v]);
  }
  return out;
}

function render(packet, state, record) {
  tipRefs = {};
  const f = state.facts;
  const used = packet.refsUsed;
  const fromNotes = used.filter((id) => state.refs[id]?.from?.kind !== 'engine').length;
  const src = state.sources;
  const facts = flat(f).filter(([p]) => !['id', 'name', 'state', 'marital', 'home.open'].includes(p) && !/\.(first|name|owner)$/.test(p));
  const said = facts.filter(([p]) => src[p]?.source === 'said').length;
  const tabs = [
    ['client', 'For the client'], ['note', 'File note'], ['todos', 'To-dos', packet.todos.length], ['asks', 'Ask first', packet.asks.length], ['facts', 'Facts', facts.length], ['record', 'Record'],
  ];
  const mine = (who) => packet.todos.filter((t) => t.who === who);
  const todoList = (xs) => (xs.length ? `<ul>${xs.map((t) => `<li>${inline(t.what)}${t.when.length ? `<span class="when">${inline(t.when)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="pp-fine">Nothing for now.</p>');
  const askSwing = (a) => { const r = a.ref && state.refs[`${a.ref}.swing`]; return r ? `<span class="swing">moves it ${esc(r.text)}</span>` : ''; };

  $('#packet').innerHTML = `
    <div class="pp-top">
      <div><h2>${esc(f.name)}</h2><p class="pp-sub">${f.people.map((p) => `${esc(p.first)}, ${p.age}`).join(' · ')} · prepared ${new Date(record.created).toLocaleString()}</p></div>
      <span class="pp-badge"><i class="ph ph-seal-check"></i>0 numbers typed by the AI · ${used.length - fromNotes} from the engine · ${fromNotes} from the notes</span>
    </div>
    <div class="pp-tabs" role="tablist">${tabs.map(([id, label, n], i) => `<button role="tab" aria-selected="${i === 0}" data-tab="${id}">${label}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>
    <p class="pp-legend"><span>From the engine</span><span class="notes">From the notes</span><span class="assumed">Assumed or unclear</span></p>

    <div class="pp-panel pp-body print" data-panel="client">${paragraphs(packet.client_summary)}<p class="pp-fine">${esc(DISCLOSURES[1])}</p></div>
    <div class="pp-panel pp-body" data-panel="note" hidden>${paragraphs(packet.file_note)}</div>
    <div class="pp-panel pp-body" data-panel="todos" hidden><div class="pp-todo"><div><h3>For you</h3>${todoList(mine('advisor'))}</div><div><h3>For the branch office administrator</h3>${todoList(mine('branch'))}</div></div></div>
    <div class="pp-panel pp-body" data-panel="asks" hidden><ul class="pp-asks">${packet.asks.map((a) => `<li>${askSwing(a)}${inline(a.question)}<span class="why">${inline(a.why)}</span></li>`).join('')}</ul></div>
    <div class="pp-panel" data-panel="facts" hidden>
      <p class="pp-fine" style="margin-top:0">${said} of ${facts.length} facts are quoted from the notes. The rest are assumed or unclear: confirm them before acting.</p>
      <table class="pp-facts"><thead><tr><th>Fact</th><th>Value</th><th>Source</th><th>Quote or why</th></tr></thead><tbody>
      ${facts.map(([p, v]) => {
        const s = src[p] || (state.defaulted.includes(p) ? { source: 'assumed', why: 'Not in the notes; a typical value' } : { source: 'unclear', why: 'No source given' });
        return `<tr><td>${esc(factLabel(p, f))}</td><td>${factValue(p, v, state.refs)}</td><td><span class="src ${esc(s.source)}">${s.source === 'said' ? 'Said' : s.source === 'assumed' ? 'Assumed' : 'Unclear'}</span></td><td>${s.quote ? `<q>${esc(s.quote)}</q>` : ''}${s.why ? `<span class="note"> ${esc(s.why)}</span>` : ''}</td></tr>`;
      }).join('')}
      </tbody></table>
    </div>
    <div class="pp-panel" data-panel="record" hidden>
      <dl class="pp-kv">
        <dt>Created</dt><dd>${esc(record.created)}</dd>
        <dt>Model</dt><dd>${esc(record.model.label)} (${esc(record.model.id)}), effort ${esc(record.model.effort)}, prompt ${esc(record.prompt_version)}</dd>
        <dt>Planning engine</dt><dd>build ${esc(record.engine.fingerprint)}, plan_check ${esc(record.engine.plan_check)}, from source commit ${esc(record.engine.moneyguide_commit)}</dd>
        <dt>Engine calls</dt><dd>${record.calls.length}, every input and output kept</dd>
        <dt>Number audit</dt><dd>${used.length} numbers and engine phrases filled in by code, 0 typed by the model</dd>
        <dt>ID numbers removed</dt><dd>${record.ids_removed} before sending</dd>
        <dt>Claude usage</dt><dd>${record.usage.calls} calls, ${record.usage.input + record.usage.cacheRead + record.usage.cacheWrite} tokens in, ${record.usage.output} out, about $${record.usage.cost.toFixed(2)}</dd>
      </dl>
      <ul class="pp-calls">${record.calls.map((c) => `<li><b>${esc(c.name)}</b> ${esc(JSON.stringify(c.input).slice(0, 120))}${JSON.stringify(c.input).length > 120 ? '…' : ''}</li>`).join('')}</ul>
      <div class="pp-actions"><button class="gb-btn" data-act="replay"><i class="ph ph-arrows-clockwise"></i>Re-run the numbers</button><button class="gb-btn ghost" data-act="download"><i class="ph ph-download-simple"></i>Download the record</button></div>
      <p class="pp-replay" id="replay" aria-live="polite"></p>
      <p class="pp-fine">${DISCLOSURES.map(esc).join(' ')}</p>
    </div>
    <div class="pp-actions">
      <button class="gb-btn" data-act="print"><i class="ph ph-printer"></i>Print the client summary</button>
      <button class="gb-btn ghost" data-act="xray"><i class="ph ph-arrow-square-out"></i>Open in the X-ray</button>
      <button class="gb-btn ghost" data-act="download"><i class="ph ph-download-simple"></i>Download the record</button>
    </div>`;
  $('#packet').hidden = false;
  $('#packet').scrollIntoView({ behavior: 'smooth', block: 'start' });

  $('#packet').onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
      document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
      return;
    }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'print') window.print();
    if (a === 'download') download(record);
    if (a === 'xray') {
      try { sessionStorage.setItem('gb-try', JSON.stringify(f)); } catch {}
      window.open('household.html#mine', '_blank');
    }
    if (a === 'replay') {
      const out = $('#replay');
      out.className = 'pp-replay'; out.textContent = 'Re-running every engine call…';
      const r = await ask({ type: 'replay', calls: record.calls });
      out.className = `pp-replay ${r.diffs.length ? 'bad' : 'ok'}`;
      out.textContent = r.diffs.length ? `${r.diffs.length} of ${r.checked} engine calls came out different: ${r.diffs.map((d) => d.name).join(', ')}` : `All ${r.checked} engine calls reproduced exactly on build ${record.engine.fingerprint}.`;
    }
  };
}

// ---------------------------------------------------------------- where a number came from

const tip = $('#tip');
function showTip(el) {
  const tok = tipRefs[el.dataset.tip];
  if (!tok) return;
  const fr = tok.from || {};
  const kind = fr.kind === 'said' ? 'notes' : fr.kind || 'engine';
  tip.innerHTML = `<span class="k ${kind}">${KIND[fr.kind] || KIND.engine}${fr.tool ? ` · ${esc(fr.tool)}` : ''}</span>${fr.label ? `<b>${esc(fr.label)}</b>` : ''}${fr.quote ? `<q>${esc(fr.quote)}</q>` : ''}${fr.why ? `<div>${esc(fr.why)}</div>` : ''}`;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
}
const hideTip = () => (tip.hidden = true);
document.addEventListener('mouseover', (e) => { const el = e.target.closest('.ref'); el ? showTip(el) : hideTip(); });
document.addEventListener('focusin', (e) => { const el = e.target.closest('.ref'); el ? showTip(el) : hideTip(); });
addEventListener('scroll', hideTip, { passive: true });

loadSamples();
