// The Household X-ray page: a real household in, and out comes what breaks the plan, why, and the gentlest fix.
// The intake edits a plain "facts" object; every change re-runs the planning engine in two workers.

import * as P from '../vendor/planner.js';
import { FAMILIES, toPlan, PORTFOLIO_NAMES, NOW } from './families.js';
import { eventCatalog, eventsFrom, anyEvent } from './xray-core.js';
import { applyMarket } from './book-model.js';
import { checkProvenance } from '../provenance.js';

const $ = (s) => document.querySelector(s);
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const compact = (n) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}k` : `${s}$${Math.round(a)}`;
};
const pct = (x, d = 1) => `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`;
const names = (f) => f.people.map((p) => p.first);
const joinNames = (f) => names(f).join(' & ');

// ---------------------------------------------------------------- state + workers

const S = { fam: null, facts: null, active: {}, ages: {}, r: {}, gen: 0, selYear: null };

function makeWorker() {
  const w = new Worker(new URL('./xray-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let seq = 0;
  w.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    if (data.type === 'progress') return p.progress && p.progress(data.out);
    pending.delete(data.id);
    p.resolve(data.out);
  };
  return (msg, progress) => new Promise((resolve) => { const id = ++seq; pending.set(id, { resolve, progress }); w.postMessage({ ...msg, id }); });
}
const fast = makeWorker(), slow = makeWorker();

function plan() { return toPlan(P, S.facts); }
function events() { return eventsFrom(S.active); }

let timer = null;
function schedule(scope = 'facts', ms = 280) {
  clearTimeout(timer);
  timer = setTimeout(() => runScoped(scope), ms);
}

async function run(scope) {
  const gen = ++S.gen;
  const pl = plan(), ev = events(), facts = S.facts;
  const live = () => gen === S.gen;
  document.querySelectorAll('.hx-xray .hx-card').forEach((c) => c.classList.add('busy'));

  fast({ type: 'verdict', plan: pl, ev }).then((v) => {
    if (!live()) return;
    S.r.verdict = v;
    if (!anyEvent(ev)) { S.baseP = v.probability; S.baseVerdict = v; }
    renderVerdict(); renderBreaks(); renderFamilies(); renderMath();
    if (!anyEvent(ev)) renderEvents();
    renderMeeting();
  });
  const deaths = ev.death.map((a, i) => (a != null ? i : null)).filter((x) => x != null);
  if (deaths.length) fast({ type: 'cliff', plan: pl, ev, who: deaths[0] }).then((c) => { if (live()) { S.r.cliff = { ...c, who: deaths[0] }; renderCliff(); renderMeeting(); } });
  else { S.r.cliff = null; renderCliff(); }

  if (scope === 'facts' || scope === 'ages') slow({ type: 'events', plan: pl, facts, ages: S.ages }).then((e) => { if (live() || scope === 'ages') { S.r.events = Object.fromEntries(e.map((x) => [x.id, x.p])); renderEvents(); renderMeeting(); } });
  S.r.fix = null; S.r.fixStep = 0; renderFix();
  slow({ type: 'fix', plan: pl, ev, facts }, (s) => { if (live()) { S.r.fixStep = s.step; S.r.fixP = s.p; renderFix(); } }).then((f) => { if (live()) { S.r.fix = f; renderFix(); renderMeeting(); } });
  slow({ type: 'sens', plan: pl, ev }).then((s) => { if (live()) { S.r.sens = s; renderSens(); } });
  if (scope === 'facts') slow({ type: 'insights', plan: pl }).then((i) => { if (live()) { S.r.insights = i; renderInsights(); } });
  if (scope === 'facts') fast({ type: 'questions', facts }).then((q) => { if (live()) { S.r.questions = q; renderAsk(); } });
}

// ---------------------------------------------------------------- families

const famP = {};
function renderFamilies() {
  if (S.r.verdict && !anyEvent(events()) && S.fam) famP[S.fam] = S.r.verdict.probability;
  $('#families').innerHTML = FAMILIES.map((f) => `
    <button class="hx-fam ${f.id === S.fam ? 'on' : ''}" data-fam="${f.id}">
      <div class="hx-fam-name">${esc(f.name)}</div>
      <div class="hx-fam-tag">${esc(f.tagline)}</div>
      <div class="hx-fam-p">${famP[f.id] != null ? `plan says <b>${famP[f.id]}%</b>` : '&nbsp;'}</div>
    </button>`).join('');
}
$('#families').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fam]');
  if (b) load(b.dataset.fam);
});

/** Load a named family by id, or any household's facts (from the book) with the hash that brings it back. */
function load(id, facts, hash, note) {
  const f = facts || FAMILIES.find((x) => x.id === id);
  S.fam = facts ? null : id; S.facts = clone(f); S.note = note || '';
  S.active = {}; S.ages = {}; S.r = {}; S.selYear = null; S.baseP = null; S.baseVerdict = null; S.mathYear = null;
  try { history.replaceState(null, '', '#' + (hash || id)); } catch {}
  renderFamilies(); renderIntake(); renderEvents();
  run('facts');
}

// ---------------------------------------------------------------- intake

const HEALTH = [['poor', 'Poor'], ['average', 'Average'], ['good', 'Good'], ['excellent', 'Excellent']];
const SURV = [[-1, 'Not sure yet'], [0, 'Stops at death (single-life)'], [50, '50% to survivor'], [75, '75% to survivor'], [100, '100% to survivor']];

const field = (label, path, value, kind = 'num', extra = '') => {
  const input = `<input data-k="${path}" data-t="${kind}" type="${kind === 'text' ? 'text' : 'number'}" value="${esc(value ?? '')}" ${extra}>`;
  return `<label class="in-f"><span>${label}</span>${kind === 'money' ? `<div class="money">${input}</div>` : input}</label>`;
};
const select = (label, path, value, opts, kind = 'text') => `<label class="in-f"><span>${label}</span><select data-k="${path}" data-t="${kind}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
const seg = (label, path, value, opts) => `<div class="in-q"><span>${label}</span><div class="seg">${opts.map(([v, l]) => `<button data-seg="${path}" data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
const sec = (title, sum, body, open = false) => `<details class="in-sec" ${open ? 'open' : ''}><summary>${title}<span class="sum">${sum}</span></summary><div class="in-body">${body}</div></details>`;

function renderIntake() {
  const f = S.facts, ppl = f.people, two = ppl.length === 2;
  const openState = [...document.querySelectorAll('.in-sec')].map((d) => d.open);
  const nm = names(f);
  const totalSave = f.accounts.ira.reduce((s, x) => s + x, 0) + f.accounts.roth + f.accounts.taxable + f.accounts.cash;
  const people = ppl.map((p, i) => `
    <div class="in-person">
      <div class="in-person-h"><input data-k="people.${i}.first" data-t="text" value="${esc(p.first)}" aria-label="Name">${i === 1 ? '<button class="in-x" data-act="rmSpouse" title="Remove">×</button>' : ''}</div>
      <div class="in-row three">${field('Age', `people.${i}.age`, p.age)}${field('Plan to age', `people.${i}.planTo`, p.planTo)}${select('Health', `people.${i}.health`, p.health, HEALTH)}</div>
      <div class="in-row three">${field('Retired at', `people.${i}.retiredAt`, p.retiredAt)}${field('SS at full age /mo', `people.${i}.ssMonthly`, p.ssMonthly, 'money')}${field(p.claimAge <= p.age ? 'Claimed at' : 'Will claim at', `people.${i}.claimAge`, p.claimAge)}</div>
    </div>`).join('') + (two ? '' : `
    ${seg('Marital status', 'marital', f.marital || 'single', [['single', 'Single'], ['widowed', 'Widowed'], ['divorced', 'Divorced']])}
    ${f.marital === 'widowed' ? `<div class="in-item"><div class="in-item-h"><span class="in-req">Late spouse</span></div>
      <div class="in-row three">${field('First name', 'late.first', f.late?.first ?? '', 'text')}${field('Born (year)', 'late.born', f.late?.born ?? '', 'opt')}${field('Died (year)', 'late.died', f.late?.died ?? '', 'opt')}</div>
      <div class="in-row">${field('Their SS at full age /mo', 'late.ssMonthly', f.late?.ssMonthly ?? '', 'opt', 'placeholder="needed"')}${select('Survivor benefit', 'late.taking', f.late?.taking ?? 'unsure', [['unsure', 'Not sure'], ['yes', 'Taking it now'], ['no', 'Not yet']])}</div>
      <div class="in-hint">A widow(er) can take the larger of their own benefit and the survivor benefit on the late spouse's record. The engine uses the larger.</div></div>` : ''}
    <button class="in-add" data-act="addSpouse">+ Add a spouse</button>`);
  const pensions = f.pensions.map((x, i) => `
    <div class="in-item">
      <div class="in-item-h"><input data-k="pensions.${i}.name" data-t="text" value="${esc(x.name)}" aria-label="Income name"><button class="in-x" data-act="rmPension" data-i="${i}" title="Remove">×</button></div>
      <div class="in-row">${field('Monthly', `pensions.${i}.monthly`, x.monthly, 'money')}${select('Whose', `pensions.${i}.owner`, x.owner, ppl.map((p, j) => [j, esc(p.first)]), 'num')}</div>
      <div class="in-row">${select('If they die first', `pensions.${i}.survivorPct`, x.survivorPct, SURV, 'num')}${field('Ends at age', `pensions.${i}.endAge`, x.endAge ?? '', 'opt', 'placeholder="lifetime"')}</div>
      <label class="in-check"><input type="checkbox" data-k="pensions.${i}.cola" data-t="bool" ${x.cola ? 'checked' : ''}> Rises with inflation (COLA)</label>
    </div>`).join('') + '<button class="in-add" data-act="addPension">+ Add a pension, annuity or part-time job</button>';
  const wants = f.spending.wants.map((w, i) => `
    <div class="in-item">
      <div class="in-item-h"><input data-k="spending.wants.${i}.name" data-t="text" value="${esc(w.name)}" aria-label="Goal name"><button class="in-x" data-act="rmWant" data-i="${i}" title="Remove">×</button></div>
      <div class="in-row">${field('Per year', `spending.wants.${i}.yearly`, w.yearly, 'money')}${field('For how many years', `spending.wants.${i}.years`, w.years)}</div>
    </div>`).join('') + '<button class="in-add" data-act="addWant">+ Add a goal</button>';
  const fe = f.feelings;
  const html = `
    <div class="in-story"><h3>${esc(f.name)}</h3>${S.note ? `<div class="hx-kicker" style="margin:2px 0 6px"><span class="n">${esc(S.note)}</span></div>` : ''}${esc(f.story)}</div>
    <div class="in-ask" id="ask"></div>
    ${sec('People', ppl.map((p) => `${esc(p.first)} ${p.age}`).join(' · '), people, true)}
    ${sec('Income', f.pensions.length ? compact(f.pensions.reduce((s, x) => s + x.monthly, 0)) + '/mo + SS' : 'Social Security only', pensions)}
    ${sec('Savings', compact(totalSave), `
      <div class="in-row">${ppl.map((p, i) => field(`${esc(p.first)}’s IRA / 401(k)`, `accounts.ira.${i}`, f.accounts.ira[i] ?? 0, 'money')).join('')}</div>
      <div class="in-row">${field('Roth IRA', 'accounts.roth', f.accounts.roth, 'money')}${field('Cash & CDs', 'accounts.cash', f.accounts.cash, 'money')}</div>
      <div class="in-row">${field('Brokerage', 'accounts.taxable', f.accounts.taxable, 'money')}${field('…of which is cost basis', 'accounts.basis', f.accounts.basis, 'money')}</div>`)}
    ${sec('Home', compact(f.home.value), `
      ${field('Home value', 'home.value', f.home.value, 'money')}
      <label class="in-check"><input type="checkbox" data-k="home.downsize" data-t="bool" ${f.home.downsize ? 'checked' : ''}> Planning to downsize</label>
      <label class="in-check"><input type="checkbox" data-k="home.open" data-t="bool" ${f.home.open ? 'checked' : ''}> Would consider it if the plan needed it</label>
      <div class="in-row">${field('In year', 'home.downsizeYear', f.home.downsizeYear)}${field('Cash it would free up', 'home.netProceeds', f.home.netProceeds, 'money')}</div>`)}
    ${sec('Spending', compact(f.spending.core) + '/mo', `
      ${field('Everyday spending per month (after tax)', 'spending.core', f.spending.core, 'money')}
      ${two ? field('If one of you is gone, spending falls to (%)', 'spending.survivorPct', f.spending.survivorPct) : ''}
      ${wants}
      <div class="in-row">${field('Gifts to family per year', 'spending.gifts', f.spending.gifts, 'money')}${field('Want to leave heirs', 'spending.legacy', f.spending.legacy, 'money')}</div>
      <div class="in-hint">Medicare premiums and taxes are added by the engine. Don't include them here.</div>`)}
    ${sec('Long-term care', f.ltc?.has === 'yes' ? `policy ${'$'}${f.ltc.daily || 0}/day` : f.ltc?.has === 'no' ? 'no policy' : 'not asked yet', `
      ${seg(`Does ${esc(nm[0])} have long-term-care insurance?`, 'ltc.has', f.ltc?.has || 'unsure', [['no', 'No'], ['yes', 'Yes'], ['unsure', 'Not sure']])}
      ${f.ltc?.has === 'yes' ? `<div class="in-row three">${field('Daily benefit', 'ltc.daily', f.ltc.daily ?? 200, 'money')}${field('Benefit years', 'ltc.years', f.ltc.years ?? 3)}<label class="in-check" style="align-self:end"><input type="checkbox" data-k="ltc.rider" data-t="bool" ${f.ltc.rider ? 'checked' : ''}> 3% inflation rider</label></div>
      <div class="in-hint">Care is modeled at $110,000 a year in today's dollars, rising 5% a year. The policy pays its daily benefit for up to its benefit years; without a rider, that benefit buys less every year.</div>` : ''}`)}
    ${sec('Investments', `${PORTFOLIO_NAMES[f.invest.portfolio]} · ${f.invest.fees}%`, `
      <div class="in-row">${select('Mix', 'invest.portfolio', f.invest.portfolio, PORTFOLIO_NAMES.map((n, i) => [i, n]).slice(1), 'num')}${field('All-in fees (%/yr)', 'invest.fees', f.invest.fees, 'num', 'step="0.05"')}</div>
      <div class="in-hint">All-in means advisory fee plus fund expenses.</div>`)}
    ${sec('What matters to them', '', `
      ${seg('If markets fall, could you trim spending for a year or two?', 'feelings.cutOk', fe.cutOk, [['no', 'No'], ['some', 'A little'], ['yes', 'Yes, if needed']])}
      ${seg('What matters most?', 'feelings.priority', fe.priority, [['spend', 'Enjoying it now'], ...(two ? [['spouse', `Making sure ${esc(nm[1])} is OK`]] : []), ['legacy', 'Leaving something behind']])}
      ${seg('Biggest worry?', 'feelings.worry', fe.worry, [['running-out', 'Running out'], ['care', 'Paying for care'], ['market', 'A market crash'], ...(two ? [['survivor', 'Being left alone']] : [])])}
      <div class="in-hint">These change which fixes the search prefers and which life events it flags.</div>`, true)}
  `;
  $('#intake').innerHTML = html;
  renderAsk();
  document.querySelectorAll('.in-sec').forEach((d, i) => { if (openState[i] != null) d.open = openState[i]; });
}

// The facts worth confirming first, ranked by how much the answer could move the plan (scored on the engine).
function renderAsk() {
  const el = $('#ask'), qs = S.r.questions;
  if (!el || !qs) return;
  const conf = S.facts.confirmed || {}, open = qs.filter((q) => !conf[q.id] && q.swing >= 3), done = qs.filter((q) => conf[q.id]).length;
  const pct = qs.length ? Math.round(((done + qs.filter((q) => q.swing < 3).length) / qs.length) * 100) : 100;
  el.innerHTML = `
    <div class="ask-h"><span>Ask these first</span><span class="ask-m">${pct}% of what matters confirmed</span></div>
    <div class="ask-bar"><i style="width:${pct}%"></i></div>
    ${open.slice(0, 2).map((q) => `<div class="ask-q">
      <div class="ask-t">${esc(q.q)}</div>
      <div class="ask-s">The answer moves the plan between <b>${q.lo}%</b> and <b>${q.hi}%</b>. ${esc(q.why)}</div>
      <button class="ask-ok" data-confirm="${q.id}">Confirmed ✓</button>
    </div>`).join('') || '<div class="ask-s">Everything that could move this plan by 3 points or more is confirmed.</div>'}`;
}
$('#intake').addEventListener('click', (e) => {
  const b = e.target.closest('[data-confirm]');
  if (!b) return;
  (S.facts.confirmed ??= {})[b.dataset.confirm] = true;
  renderAsk();
});

function setPath(obj, path, v) {
  const k = path.split('.');
  let o = obj;
  for (let i = 0; i < k.length - 1; i++) o = o[k[i]] ??= {};
  o[k[k.length - 1]] = v;
}

$('#intake').addEventListener('input', (e) => {
  const el = e.target.closest('[data-k]');
  if (!el) return;
  const t = el.dataset.t;
  let v = t === 'bool' ? el.checked : el.value;
  if (t === 'num' || t === 'money') { v = parseFloat(v); if (!Number.isFinite(v)) return; }
  if (t === 'opt') v = el.value === '' ? undefined : parseFloat(el.value);
  setPath(S.facts, el.dataset.k, v);
  if (el.dataset.k.endsWith('.first')) renderEventsShell();
  schedule('facts');
});
$('#intake').addEventListener('change', (e) => {
  if (e.target.matches('select, input[type=checkbox]')) renderIntake();
});
$('#intake').addEventListener('click', (e) => {
  const s = e.target.closest('[data-seg]');
  const a = e.target.closest('[data-act]');
  const f = S.facts;
  if (s) { setPath(f, s.dataset.seg, s.dataset.v); renderIntake(); renderEventsShell(); schedule('facts', 50); return; }
  if (!a) return;
  const i = +a.dataset.i;
  switch (a.dataset.act) {
    case 'addPension': f.pensions.push({ name: 'Pension', owner: 0, monthly: 1000, cola: false, survivorPct: 50 }); break;
    case 'rmPension': f.pensions.splice(i, 1); break;
    case 'addWant': f.spending.wants.push({ name: 'Travel', yearly: 10000, years: 10 }); break;
    case 'rmWant': f.spending.wants.splice(i, 1); break;
    case 'addSpouse':
      f.people.push({ first: 'Spouse', age: f.people[0].age - 2, sex: f.people[0].sex === 'M' ? 'F' : 'M', health: 'good', planTo: 95, retiredAt: 62, ssMonthly: 1200, claimAge: 67 });
      f.accounts.ira.push(0); f.spending.survivorPct = 75; break;
    case 'rmSpouse':
      f.people.splice(1); f.accounts.ira.splice(1); f.pensions = f.pensions.filter((p) => p.owner === 0);
      if (f.feelings.priority === 'spouse') f.feelings.priority = 'spend';
      if (f.feelings.worry === 'survivor') f.feelings.worry = 'running-out';
      S.active = {}; S.ages = {}; break;
  }
  renderIntake(); renderEvents(); schedule('facts', 50);
});

// ---------------------------------------------------------------- 00 · verdict

function zone(p) {
  return p >= 90 ? ['good', 'Above the confidence zone'] : p >= 75 ? ['good', 'In the confidence zone'] : p >= 60 ? ['ok', 'Below the confidence zone'] : ['bad', 'At real risk'];
}

function eventLabels() {
  const f = S.facts, nm = names(f), out = [];
  for (const [id, v] of Object.entries(S.active)) {
    if (v == null || v === false) continue;
    if (id.startsWith('death')) out.push([id, `${nm[+id.slice(5)]} dies at ${v}`]);
    else if (id === 'ltc') out.push([id, `${nm[0]} needs care at ${v}`]);
    else if (id === 'crash') out.push([id, 'Crash in years 1–2']);
    else if (id === 'inflation') out.push([id, 'Inflation +1%']);
    else if (id === 'ssCut') out.push([id, 'Social Security cut 23%']);
  }
  return out;
}

function renderVerdict() {
  const v = S.r.verdict, f = S.facts;
  if (!v) return;
  const d = v.diagnosis, [zc, zl] = zone(v.probability);
  const ev0 = events();
  const ages = f.people.map((p, i) => `${p.first} ${ev0.death[i] ?? p.planTo}`).join(', ');
  const ok = d.tested - d.failed;
  const head = d.failed === 0
    ? `It holds in <em>${v.probability}%</em> of simulated markets, and in <em>every</em> real retirement since 1928.`
    : `It holds in <em>${v.probability}%</em> of simulated markets, and in ${ok} of ${d.tested} real retirements since 1928.`;
  const ev = eventLabels();
  $('#verdict').innerHTML = `
    <div>
      <div class="v-num">${v.probability}<small>%</small></div>
      <div class="v-cap">chance the money lasts<br>through ${esc(ages)}${f.spending.legacy > 0 ? `<br>and still leaves ${compact(f.spending.legacy)} to heirs` : ''}</div>
      <span class="v-zone ${zc}">${zl}</span>
      <div><button class="btn" data-brief style="margin-top:14px">Print review brief</button></div>
    </div>
    <div>
      <div class="hx-kicker">${esc(joinNames(f))} · ${anyEvent(ev0) ? 'the plan if…' : 'the plan today'}</div>
      <p class="v-head">${head}</p>
      <div class="v-stats">
        <div class="v-stat"><b>${compact(v.legacy)}</b><span>left to heirs after tax, average markets</span></div>
        <div class="v-stat"><b>${compact(v.lifetimeTax)}</b><span>lifetime income tax, today's dollars</span></div>
        <div class="v-stat"><b>${compact(v.lifetimeMedicare)}</b><span>lifetime Medicare premiums</span></div>
      </div>
    </div>
    ${ev.length ? `<div class="v-events">Showing the plan if: ${ev.map(([id, l]) => `<span class="chip">${esc(l)} <button data-off="${id}" aria-label="Remove">×</button></span>`).join('')}</div>` : ''}`;
  $('#verdict').classList.remove('busy');
}
$('#verdict').addEventListener('click', (e) => {
  const b = e.target.closest('[data-off]');
  if (b) { delete S.active[b.dataset.off]; renderEvents(); schedule('events', 0); }
});

// ---------------------------------------------------------------- 01 · what breaks it

function renderBreaks() {
  const v = S.r.verdict, f = S.facts;
  if (!v) return;
  const d = v.diagnosis;
  const seq = d.failed > 0 && d.badFirst10 < d.goodFirst10 - 0.015;
  const later = seq && d.badAfter10 >= d.goodAfter10 - 0.005;
  const inflDriven = d.failed > 0 && d.badInfl - d.goodInfl > 0.02;
  let title, lede, say = '';
  if (d.failed === 0) {
    const c = d.closest;
    title = 'No real market since 1928 <em>has broken this plan.</em>';
    lede = `The closest call was retiring into <b>${c.year}</b>: the portfolio averaged ${pct(c.first10)} a year after inflation for the first decade and still had <b>${compact(c.endReal)}</b> (today's dollars) at the end. The bars show what was left in each start year.`;
  } else {
    title = seq ? 'It isn\'t the average return. <em>It\'s the first ten years.</em>' : inflDriven ? 'What breaks it is <em>inflation</em>.' : 'Where this plan <em>breaks</em>.';
    const eraTxt = d.eras.map((e) => `${e.name} (${e.from === e.to ? e.from : `${e.from}–${e.to}`})`).join(', ');
    lede = `Replayed through every start year since 1928, with real returns and real inflation. It failed <b>${d.failed} times</b>: ${esc(eraTxt)}.`;
    if (seq) say = `In the years this plan failed, the portfolio <em>${d.badFirst10 < 0 ? 'lost' : 'earned only'} ${pct(Math.abs(d.badFirst10))} a year</em> after inflation for the first decade, against ${pct(d.goodFirst10)} in the years it worked.${later ? ` After year ten, those same failed retirements earned <em>${pct(d.badAfter10)} a year, more</em> than the ones that worked. It was too late: the withdrawals had already come out of a shrinking pile.` : ''}`;
    else if (inflDriven) say = `In the failing years inflation averaged <em>${pct(d.badInfl)}</em> for the first decade, against ${pct(d.goodInfl)} when it worked. Spending rises with prices, and fixed income doesn't.`;
  }
  const worst = d.worst;
  if (S.selYear == null || !v.history.some((y) => y.year === S.selYear)) S.selYear = (worst || d.closest).year;
  const bars = (seq || inflDriven || d.failed === 0) ? `
    <div class="diag">
      <div class="diag-box"><h4>Portfolio return after inflation</h4>
        ${cmpRows([['First 10 years', d.badFirst10, d.goodFirst10], ['Years 11+', d.badAfter10, d.goodAfter10]], d.failed > 0)}
      </div>
      <div class="diag-box"><h4>Inflation, first 10 years</h4>
        ${cmpRows([['Inflation', d.badInfl, d.goodInfl]], d.failed > 0)}
        <div class="key"><span><i style="background:var(--coral)"></i>start years that failed</span><span><i style="background:var(--good)"></i>start years that worked</span></div>
      </div>
    </div>` : '';
  $('#breaks').innerHTML = `
    <div class="hx-kicker"><span class="n">01</span> What breaks this plan</div>
    <h2>${title}</h2>
    <p class="hx-lede">${lede}</p>
    ${strip(v)}
    ${pathPanel(v)}
    ${bars}
    ${say ? `<p class="say">${say}</p>` : ''}`;
  $('#breaks').classList.remove('busy');
}

function cmpRows(rows, hasBad) {
  const all = rows.flatMap(([, a, b]) => [a, b]).filter((x) => x != null);
  const lo = Math.min(0, ...all), hi = Math.max(0.01, ...all), X = (x) => ((x - lo) / (hi - lo)) * 100;
  const bar = (x, c) => x == null ? '' : `<i style="left:${Math.min(X(0), X(x))}%;width:${Math.abs(X(x) - X(0))}%;background:${c}"></i>`;
  return `<div class="cmp">${rows.map(([l, a, b]) => `
    ${hasBad ? `<span>${l}</span><div class="track"><span class="zero" style="left:${X(0)}%"></span>${bar(a, 'var(--coral)')}</div><span class="v neg">${a == null ? '—' : pct(a)}</span>` : ''}
    <span>${hasBad ? '' : l}</span><div class="track"><span class="zero" style="left:${X(0)}%"></span>${bar(b, 'var(--good)')}</div><span class="v pos">${b == null ? '—' : pct(b)}</span>`).join('')}</div>`;
}

function strip(v) {
  const ys = v.history, n = ys.length, W = 900, H = 170, mid = 104, bw = W / n;
  const maxEnd = Math.max(...ys.map((y) => y.endReal), 1);
  const lastYear = NOW + Math.max(...ys.map((y) => y.path.length)) - 1;
  const maxShort = Math.max(...ys.filter((y) => !y.ok).map((y) => lastYear - (y.runOutYear ?? lastYear)), 8);
  const bars = ys.map((y, i) => {
    const x = i * bw + 0.5, sel = y.year === S.selYear;
    if (y.ok) {
      const h = Math.max(3, Math.sqrt(y.endReal / maxEnd) * (mid - 14));
      return `<rect class="bar" data-y="${y.year}" x="${x}" y="${mid - h}" width="${bw - 1.5}" height="${h}" rx="1.5" fill="var(--good)" opacity="${y.wraps ? 0.25 : sel ? 1 : 0.62}"/>`;
    }
    const short = y.runOutYear ? lastYear - y.runOutYear : 1;
    const h = Math.max(4, (short / maxShort) * (H - mid - 30));
    return `<rect class="bar" data-y="${y.year}" x="${x}" y="${mid + 2}" width="${bw - 1.5}" height="${h}" rx="1.5" fill="var(--coral)" opacity="${y.wraps ? 0.3 : sel ? 1 : 0.85}"/>`;
  }).join('');
  const selI = ys.findIndex((y) => y.year === S.selYear);
  const ticks = ys.map((y, i) => (y.year % 10 === 0 ? `<text x="${i * bw + bw / 2}" y="${H - 4}" fill="var(--faint)" font-size="10" font-family="Geist Mono" text-anchor="middle">${y.year}</text>` : '')).join('');
  return `<svg class="strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="Outcome for each retirement start year since 1928">
    <text x="0" y="12" fill="var(--muted)" font-size="11" font-family="Geist Mono">MONEY LEFT AT THE END ↑</text>
    <text x="0" y="${H - 22}" fill="var(--muted)" font-size="11" font-family="Geist Mono">YEARS SHORT ↓</text>
    <line x1="0" x2="${W}" y1="${mid + 1}" y2="${mid + 1}" stroke="var(--line-2)"/>
    ${selI >= 0 ? `<rect x="${selI * bw - 1}" y="18" width="${bw + 0.5}" height="${H - 40}" fill="none" stroke="var(--amber)" stroke-width="1.2" rx="2"/>` : ''}
    ${bars}${ticks}
  </svg>`;
}

function pathPanel(v) {
  const y = v.history.find((h) => h.year === S.selYear);
  if (!y) return '';
  const f = S.facts, W = 900, H = 150, n = y.path.length;
  const max = Math.max(...y.path, ...v.p50.slice(0, n), 1);
  const X = (i) => (i / (n - 1)) * (W - 10) + 5, Y = (val) => H - 18 - (Math.max(0, val) / max) * (H - 30);
  const line = (arr, c, w, dash = '') => `<polyline fill="none" stroke="${c}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${arr.slice(0, n).map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(' ')}"/>`;
  const ages = f.people.map((p) => p.age);
  const ageAt = (yr) => f.people.filter((p) => p.age + (yr - NOW) <= p.planTo).map((p) => `${p.first} ${p.age + (yr - NOW)}`).join(', ');
  const ticks = [0, 5, 10, 15, 20, 25, 30].filter((i) => i < n).map((i) => `<text x="${X(i)}" y="${H - 3}" fill="var(--faint)" font-size="10" font-family="Geist Mono" text-anchor="middle">${f.people[0].first[0]}${ages[0] + i}</text>`).join('');
  const head = y.ok
    ? `Retiring into <b>${y.year}</b>: ended with <b>${compact(y.endReal)}</b> in today's dollars`
    : `Retiring into <b>${y.year}</b>: money runs out in <b>${y.runOutYear}</b>${y.runOutYear ? ` (${esc(ageAt(y.runOutYear))})` : ''}`;
  return `<div class="hx-path">
    <div class="hx-path-h"><span>${head}</span><span>first decade ${pct(y.first10)}/yr after inflation · click any bar</span></div>
    <svg class="strip" viewBox="0 0 ${W} ${H}">
      ${line(v.p50, 'var(--faint)', 1.2, '4 4')}
      ${line(y.path, y.ok ? 'var(--good)' : 'var(--coral)', 2)}
      ${ticks}
    </svg>
    <div class="key"><span><i style="background:${y.ok ? 'var(--good)' : 'var(--coral)'}"></i>investments in ${y.year}'s markets, today's dollars</span><span><i style="background:var(--faint)"></i>median simulated market</span></div>
  </div>`;
}

$('#breaks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-y]');
  if (b) { S.selYear = +b.dataset.y; renderBreaks(); }
});
$('#breaks').addEventListener('mousemove', (e) => {
  const b = e.target.closest('[data-y]');
  if (!b) return hideTip();
  const y = S.r.verdict.history.find((h) => h.year === +b.dataset.y);
  showTip(e, `<b>Retire in ${y.year}</b><br>${y.ok ? `Ends with ${compact(y.endReal)}` : `Runs out in ${y.runOutYear}`}<br><span class="m">First 10 yrs: ${pct(y.first10)}/yr real · inflation ${pct(y.infl10)}${y.wraps ? '<br>Wraps past 2025 back to 1928' : ''}</span>`);
});
$('#breaks').addEventListener('mouseleave', hideTip);

function showTip(e, html) {
  const t = $('#tip');
  t.innerHTML = html; t.hidden = false;
  const x = Math.min(window.innerWidth - t.offsetWidth - 12, e.clientX + 14);
  t.style.left = x + 'px'; t.style.top = e.clientY + 16 + 'px';
}
function hideTip() { $('#tip').hidden = true; }

// ---------------------------------------------------------------- 02 · life events

function flagged(e) {
  const fe = S.facts.feelings;
  if (fe.worry === 'care' && e.kind === 'ltc') return 'Their biggest worry';
  if (fe.worry === 'market' && e.kind === 'crash') return 'Their biggest worry';
  if (fe.worry === 'running-out' && e.kind === 'inflation') return 'Their biggest worry';
  if ((fe.worry === 'survivor' || fe.priority === 'spouse') && e.id === 'death0') return fe.worry === 'survivor' ? 'Their biggest worry' : 'What matters most to them';
  return '';
}

function renderEventsShell() { renderEvents(); }

function renderEvents() {
  if (!S.facts) return;
  const cat = eventCatalog(plan(), S.facts);
  const base = S.baseP ?? null;
  const ps = S.r.events || {};
  $('#events').innerHTML = `
    <div class="hx-kicker"><span class="n">02</span> Life events</div>
    <h2>What could happen <em>to them</em></h2>
    <p class="hx-lede">Turn anything on and the whole page re-runs as if it happened. Each card shows what that event does to the plan on its own.</p>
    <div class="ev-grid">${cat.map((e) => {
      const on = S.active[e.id] != null && S.active[e.id] !== false;
      const age = S.ages[e.id] ?? e.def;
      const p = ps[e.id];
      const why = flagged(e);
      return `<div class="ev ${on ? 'on' : ''} ${why ? 'flag' : ''}">
        <div class="ev-h">
          <input type="checkbox" id="ev-${e.id}" data-ev="${e.id}" ${on ? 'checked' : ''}>
          <label for="ev-${e.id}">${esc(e.label)}${e.def != null ? ` <b>${age}</b>` : ''}</label>
          <span class="ev-p">${p != null && base != null ? `${base}% → <b class="${p > base ? 'up' : ''}">${p}%</b>` : '…'}</span>
        </div>
        ${e.def != null ? `<div class="ev-age"><span>${e.min}</span><input type="range" min="${e.min}" max="${e.max}" value="${age}" data-age="${e.id}" aria-label="Age"><span>${e.max}</span></div>` : ''}
        ${e.note ? `<div class="ev-note">${esc(e.note)}</div>` : ''}
        ${why ? `<div class="ev-why">${why}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  $('#events').classList.remove('busy');
}

$('#events').addEventListener('change', (e) => {
  const c = e.target.closest('[data-ev]');
  if (!c) return;
  const id = c.dataset.ev;
  const cat = eventCatalog(plan(), S.facts).find((x) => x.id === id);
  if (c.checked) S.active[id] = cat.def != null ? (S.ages[id] ?? cat.def) : true;
  else delete S.active[id];
  renderEvents();
  schedule('events', 0);
});
$('#events').addEventListener('input', (e) => {
  const r = e.target.closest('[data-age]');
  if (!r) return;
  const id = r.dataset.age;
  S.ages[id] = +r.value;
  r.closest('.ev').querySelector('label b').textContent = r.value;
  if (S.active[id] != null) S.active[id] = +r.value;
  schedule(S.active[id] != null ? 'ages' : 'agesOnly', 250);
});

// agesOnly: a slider moved on an event that isn't on, so only its badge changes
async function runScoped(scope) {
  if (scope !== 'agesOnly') return run(scope);
  const e = await slow({ type: 'events', plan: plan(), facts: S.facts, ages: S.ages });
  S.r.events = Object.fromEntries(e.map((x) => [x.id, x.p]));
  renderEvents();
}

// ---------------------------------------------------------------- survivor cliff

function renderCliff() {
  const c = S.r.cliff, el = $('#cliff'), f = S.facts;
  if (!c) { el.hidden = true; return; }
  el.hidden = false;
  const nm = names(f), dead = nm[c.who], surv = nm[1 - c.who];
  const drop = (a, b) => (a > 0 ? (b - a) / a : 0);
  const incD = drop(c.incomeBefore, c.incomeAfter), spD = drop(c.spendBefore, c.spendAfter);
  const lost = f.pensions.filter((p) => p.owner === c.who && (p.endAge == null || f.people[c.who].age + (c.year - NOW) < p.endAge));
  const notes = [];
  lost.forEach((p) => notes.push(p.survivorPct === 0 ? `${esc(dead)}'s ${esc(p.name.toLowerCase())} (${money(p.monthly)}/mo) stops completely: it was taken as single-life.` : `${esc(dead)}'s ${esc(p.name.toLowerCase())} drops to ${p.survivorPct}%.`));
  notes.push(`One Social Security check goes away. ${esc(surv)} keeps whichever of the two was larger.`);
  if (c.rateAfter > c.rateBefore) notes.push(`From ${c.year + 1} ${esc(surv)} files single: the top bracket jumps from ${pct(c.rateBefore, 0)} to <b>${pct(c.rateAfter, 0)}</b> on less income.`);
  else notes.push(`From ${c.year + 1} ${esc(surv)} files single, with brackets half as wide. The bracket stays at ${pct(c.rateAfter, 0)} here.`);
  if (c.irmaaAfter > c.irmaaBefore) notes.push(`Medicare IRMAA surcharges start within a few years: single filers hit the tiers at half the income.`);
  const max = Math.max(c.before.spend + c.before.tax, c.after.spend + c.after.tax, c.incomeBefore + c.iraBefore, c.incomeAfter + c.iraAfter);
  const seg = (v, col) => `<i style="width:${(v / max) * 100}%;background:${col}"></i>`;
  const stack = (r, savings) => `${seg(r.ss, 'var(--ice)')}${seg(r.pension, 'var(--good)')}${seg(savings, 'var(--amber)')}`;
  el.innerHTML = `
    <div class="hx-kicker">Survivor's view · ${c.year}</div>
    <h2>If ${esc(dead)} dies, ${esc(surv)}'s income falls <em>${pct(-incD, 0)}</em>. Spending only falls ${pct(-spD, 0)}.</h2>
    <p class="hx-lede">The last full year together against the first year alone, in today's dollars, on the engine's year-by-year ledger.</p>
    <div class="cliff">
      <div class="cl"><h4>Guaranteed income</h4><div class="cl-big">${compact(c.incomeBefore)}<span class="cl-arrow">→</span>${compact(c.incomeAfter)}</div><div class="cl-delta neg">${pct(incD, 0)} a year</div></div>
      <div class="cl"><h4>Pulled from savings</h4><div class="cl-big">${compact(c.iraBefore)}<span class="cl-arrow">→</span>${compact(c.iraAfter)}</div><div class="cl-delta ${c.iraAfter > c.iraBefore ? 'neg' : 'pos'}">${c.iraAfter >= c.iraBefore ? '+' : '−'}${compact(Math.abs(c.iraAfter - c.iraBefore))} a year</div></div>
      <div class="cl"><h4>Income tax</h4><div class="cl-big">${compact(c.taxBefore)}<span class="cl-arrow">→</span>${compact(c.taxAfter)}</div><div class="cl-delta">${pct(c.rateBefore, 0)} → ${pct(c.rateAfter, 0)} bracket</div></div>
    </div>
    <div class="cl-bars" style="margin-top:16px">
      <div class="cl-bar"><span>${c.year - 1}</span><div>${stack(c.before, c.iraBefore)}</div></div>
      <div class="cl-bar"><span>${c.year + 1}</span><div>${stack(c.after, c.iraAfter)}</div></div>
    </div>
    <div class="key"><span><i style="background:var(--ice)"></i>Social Security</span><span><i style="background:var(--good)"></i>Pensions</span><span><i style="background:var(--amber)"></i>From savings</span></div>
    <ul class="hx-lede" style="margin-top:14px;padding-left:18px">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- 03 · the gentlest fix

function renderFix() {
  const el = $('#fix'), r = S.r.fix, f = S.facts;
  const head = `<div class="hx-kicker"><span class="n">03</span> The gentlest fix</div>`;
  if (!r) {
    el.innerHTML = `${head}<h2>Searching for the least painful way <em>back to 85%</em>…</h2>
      <div class="progress"><i style="width:${Math.min(100, (S.r.fixStep || 0) * 12)}%"></i></div>
      <p class="loading">${S.r.fixStep ? `step ${S.r.fixStep} · ${S.r.fixP}%` : 'asking the engine'}</p>`;
    return;
  }
  el.classList.remove('busy');
  const ev = anyEvent(events());
  if (r.before >= 85 && !r.changes.length) {
    el.innerHTML = `${head}<h2>Nothing to fix <em>${ev ? 'even then' : 'today'}</em>.</h2>
      <p class="hx-lede">At ${r.before}% the plan is already in the confidence zone${ev ? ' with these events' : ''}, and holds in ${r.histBefore.ok} of ${r.histBefore.of} real retirements since 1928. ${ev ? '' : 'Turn on a life event above to see what it would take if something went wrong.'}</p>`;
    return;
  }
  const g = r.changes.some((c) => /guardrails/.test(c.what)) && r.cuts;
  el.innerHTML = `${head}
    <h2>${r.reached ? `The least painful way back to <em>85%</em>` : `The best it can do with moves they'd accept`}</h2>
    <p class="hx-lede">The search tries every move this household said it could live with, weighs each by how much it would hurt <b>them</b> (from “What matters”), and keeps the best one at each step. Every step is checked on the engine.</p>
    <div class="fx-top">
      <div class="fx-pp">${r.before}%<span class="arrow">→</span><span class="to">${r.after}%</span></div>
      <div class="fx-side">Real retirements since 1928 that work<br><b>${r.histBefore.ok} → ${r.histAfter.ok}</b> of ${r.histAfter.of}</div>
    </div>
    ${r.changes.length ? `<ol class="fx-steps">${r.changes.map((c) => `<li><div>${esc(c.what)}${c.detail ? `<div class="d">${esc(c.detail)}</div>` : ''}</div></li>`).join('')}</ol>` : '<p class="hx-lede">No move they listed helps. This one needs a conversation about what else is possible.</p>'}
    ${g ? `<div class="fx-cost">What guardrails cost: in <b>${Math.round(g.cutProbability)}%</b> of markets they'd take at least one 10% cut. In the worst 10% of markets, spending dips to <b>${Math.round(g.floor10 * 100)}%</b> of plan at its lowest.</div>` : ''}
    ${!r.reached ? `<div class="fx-cost">Couldn't reach 85% within what ${esc(joinNames(f))} said they'd accept. Loosen “What matters” to widen the search.</div>` : ''}`;
}

// ---------------------------------------------------------------- show the math

function renderMath() {
  const v = S.r.verdict, el = $('#math'), f = S.facts;
  if (!v) return;
  el.classList.remove('busy');
  const rows = v.rows, sel = S.mathYear ?? rows[0].year;
  const r = rows.find((x) => x.year === sel) || rows[0];
  const ages = (x) => f.people.map((p, i) => (x.alive[i] ? x.ages[i] : '†')).join(' / ');
  const tr = (x) => `<tr class="${x.year === sel ? 'sel' : ''} ${x.shortfall > 1 ? 'short' : ''}" data-my="${x.year}">
    <td>${x.year}</td><td>${ages(x)}</td><td>${compact(x.ss)}</td><td>${compact(x.pension)}</td><td>${compact(x.fromIra + x.fromOther)}</td>
    <td>${compact(x.spend)}</td><td>${compact(x.tax)}</td><td>${Math.round(x.rate * 100)}%</td><td>${x.irmaa ? `tier ${x.irmaa}` : '—'}</td><td>${compact(x.end)}</td></tr>`;
  const t = r.ret, line = (l, val, note = '') => `<div class="mx-l"><span>${l}${note ? `<small>${note}</small>` : ''}</span><b>${val}</b></div>`;
  el.innerHTML = `
    <div class="hx-kicker"><span class="n">05</span> Show the math</div>
    <h2>Every number, <em>all the way down</em>.</h2>
    <p class="hx-lede">The engine's year-by-year ledger for ${esc(joinNames(f))} in average markets, in today's dollars. Click any year for that year's tax return, line by line.</p>
    <div class="mx-badges"><span>✓ 2026 brackets and deductions: IRS Rev. Proc. 2025-32 and P.L. 119-21</span><span>✓ Social Security taxation: IRS Pub 915 worksheet</span><span>✓ RMDs: IRS Uniform Lifetime Table</span><span>✓ Medicare IRMAA: CMS 2026 tiers, 2-year lookback</span><span>✓ Federal tax cross-checked against PolicyEngine-US, an independent model</span></div>
    <div class="mx">
      <div class="mx-table"><table>
        <thead><tr><th>Year</th><th>Ages</th><th>Social Security</th><th>Pensions</th><th>From savings</th><th>Spending</th><th>Income tax</th><th>Bracket</th><th>IRMAA</th><th>Invested</th></tr></thead>
        <tbody>${rows.map(tr).join('')}</tbody></table></div>
      <div class="mx-ret">
        <div class="hx-kicker">${r.year} tax return · filing ${r.filing === 'joint' ? 'jointly' : 'single'}</div>
        ${t ? `${line('Social Security received', money(r.ss))}${line('…of which taxable', money(t.taxableSS), 'Pub 915 provisional-income test')}
        ${line('Pensions', money(r.pension))}${line('IRA withdrawals and RMDs', money(r.fromIra), r.rmd > 1 ? `RMD ${money(r.rmd)}` : '')}${r.conv > 1 ? line('Roth conversion', money(r.conv)) : ''}${r.gains > 1 ? line('Capital gains and qualified dividends', money(r.gains)) : ''}
        ${line('Adjusted gross income', money(t.agi))}${line('Standard deduction', '−' + money(t.std), 'includes the 65+ add-on')}${t.senior > 1 ? line('Senior deduction', '−' + money(t.senior), 'OBBBA, phases out above $150k MAGI') : ''}
        ${line('Taxable income', money(t.taxable))}${line('Tax on ordinary income', money(t.ordinary), `top bracket ${Math.round(r.rate * 100)}%, ${money(t.room)} of room left in it`)}${t.ltcg > 1 ? line('Tax on gains', money(t.ltcg)) : ''}${t.niit > 1 ? line('Net investment income tax', money(t.niit)) : ''}
        ${line('Federal income tax', money(t.federal))}${line('Arizona income tax', money(t.state), '2.5% flat; Social Security exempt')}
        ${line('Medicare premiums', money(r.medicare), r.irmaa ? `IRMAA tier ${r.irmaa}, from MAGI two years earlier` : 'standard Part B and D')}
        <div class="mx-tot">${line('Total tax', money(t.federal + t.state))}</div>` : '<p class="hx-lede">No return this year.</p>'}
      </div>
    </div>`;
}
$('#math').addEventListener('click', (e) => {
  const tr = e.target.closest('[data-my]');
  if (tr) { S.mathYear = +tr.dataset.my; renderMath(); }
});

// ---------------------------------------------------------------- 04 · sensitivity

function renderSens() {
  const s = S.r.sens, el = $('#sens');
  if (!s) return;
  el.classList.remove('busy');
  const top = s.rows[0], ret = s.rows.find((r) => r.label === 'Market returns');
  const ratio = ret && ret.swing > 0 && top !== ret ? top.swing / ret.swing : null;
  const lo = Math.min(...s.rows.map((r) => Math.min(r.lo, r.hi)), s.base), hi = Math.max(...s.rows.map((r) => Math.max(r.lo, r.hi)), s.base);
  const span = Math.max(1, hi - lo), X = (v) => 24 + ((v - lo) / span) * 52;
  el.innerHTML = `
    <div class="hx-kicker"><span class="n">06</span> What it's most sensitive to</div>
    <h2><em>${esc(top.label)}</em> ${ratio && ratio >= 1.3 ? `moves this plan ${ratio.toFixed(1)}× more than market returns.` : 'matters most.'}</h2>
    <p class="hx-lede">Each row is the engine re-run with one thing changed. Longer bars matter more. Center line: ${s.base}% today.</p>
    <div class="tor">${s.rows.map((r) => {
      const bar = (v, lbl) => {
        const a = X(Math.min(v, s.base)), b = X(Math.max(v, s.base)), c = v < s.base ? 'var(--coral)' : 'var(--good)';
        const left = v < s.base;
        return `<i style="left:${a}%;width:${Math.max(0.6, b - a)}%;background:${c};opacity:.85"></i><span class="lbl" style="${left ? `right:${100 - a + 1}%` : `left:${b + 1}%`};color:${c}">${v}%<span class="d"> · ${esc(lbl)}</span></span>`;
      };
      return `<div class="tor-l">${esc(r.label)}</div><div class="tor-t"><span class="mid" style="left:${X(s.base)}%"></span>${bar(r.lo, r.low)}${r.hi !== r.lo ? bar(r.hi, r.high) : ''}</div>`;
    }).join('')}</div>`;
}

// ---------------------------------------------------------------- 05 · insights

function renderInsights() {
  const el = $('#insights');
  // The engine suggests claiming ages even to people who already claimed; those can't be changed.
  const claimed = S.facts.people.every((p) => p.claimAge <= p.age);
  const list = S.r.insights && S.r.insights.filter((i) => !(claimed && i.category === 'Social Security'));
  if (!list) return;
  el.classList.remove('busy');
  el.innerHTML = `
    <div class="hx-kicker"><span class="n">07</span> Also worth a conversation</div>
    <h2>What the engine's own review <em>found</em></h2>
    <p class="hx-lede">The planning engine's scan of this household under today's assumptions: Social Security timing, Roth conversions, IRMAA, the survivor's tax bracket, cash reserves.</p>
    <div class="ins">${list.map((i) => `
      <div class="in-card"><div class="cat ${i.kind}">${esc(i.category)}</div><h4>${esc(i.title)}</h4><p>${esc(i.detail)}</p>${i.impact ? `<div class="imp">${esc(i.impact)}</div>` : ''}</div>`).join('') || '<p class="hx-lede">Nothing flagged.</p>'}</div>`;
}

// ---------------------------------------------------------------- review brief (client one-pager / pre-meeting brief)

function briefQuestions(f, ev) {
  const nm = names(f), q = [];
  const single = f.pensions.filter((p) => p.endAge == null && p.survivorPct === 0 && f.people.length === 2);
  single.forEach((p) => q.push(`Does ${nm[1 - p.owner]} know that ${nm[p.owner]}'s ${p.name.toLowerCase()} stops completely at ${nm[p.owner]}'s death?`));
  if (ev.ltc != null && ev.ltc < (S.baseP ?? 100) - 25) q.push('If care is needed, how would you want to pay for it: savings, the house, insurance, family?');
  f.people.forEach((p) => { if (p.claimAge > p.age) q.push(`${p.first} hasn't claimed Social Security yet. Has anything changed about when?`); });
  if (f.spending.legacy > 0) q.push(`Is leaving ${compact(f.spending.legacy)} a must, or a nice-to-have?`);
  if (S.r.fix && S.r.fix.changes.some((c) => /guardrails/.test(c.what))) q.push('If markets fall, would you be OK trimming spending 10% for a year or two?');
  if (f.home.value > 0 && !f.home.open) q.push('Would you ever consider moving somewhere smaller?');
  q.push('Has anything changed in your health, your family, or what you want to spend on?');
  return q.slice(0, 6);
}

function renderBrief() {
  const f = S.facts, v = S.baseVerdict || S.r.verdict, fx = S.r.fix, evs = S.r.events || {};
  if (!v) return null;
  const d = v.diagnosis, nm = names(f);
  const cat = eventCatalog(plan(), f);
  const worst = cat.map((e) => ({ e, p: evs[e.id] })).filter((x) => x.p != null).sort((a, b) => a.p - b.p).slice(0, 3);
  const evLabel = (e) => `${e.label}${e.def != null ? ' ' + (S.ages[e.id] ?? e.def) : ''}`;
  const ins = (S.r.insights || []).filter((i) => !(f.people.every((p) => p.claimAge <= p.age) && i.category === 'Social Security')).slice(0, 3);
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `
    <div class="br-top"><div><div class="br-k">Plan review brief</div><h1>${esc(f.name)}</h1><div class="br-m">${f.people.map((p) => `${esc(p.first)}, ${p.age}`).join(' · ')} · ${date}</div></div>
      <div class="br-p"><b>${S.baseP ?? v.probability}%</b><span>chance the money lasts</span></div></div>
    <h2>Where the plan stands</h2>
    <p>In 1,000 simulated markets the plan works ${S.baseP ?? v.probability}% of the time. Replayed through every real retirement since 1928, it works in ${d.tested - d.failed} of ${d.tested}.${d.failed ? ` The failures all started with a bad first decade (about ${pct(d.badFirst10)} a year after inflation), even though the years after were good.` : ''}</p>
    <h2>The three things that would hurt most</h2>
    <ol>${worst.map(({ e, p }) => `<li><b>${esc(evLabel(e))}:</b> ${p}%</li>`).join('')}</ol>
    ${fx && fx.changes.length ? `<h2>${anyEvent(events()) ? 'If that happened, the gentlest changes' : 'If we need to strengthen it, the gentlest changes'}</h2><ol>${fx.changes.map((c) => `<li>${esc(c.what)}${c.detail ? ` <span class="br-m">(${esc(c.detail)})</span>` : ''}</li>`).join('')}</ol><p class="br-m">Together: ${fx.before}% → ${fx.after}%${anyEvent(events()) ? `, in the scenario where ${esc(eventLabels().map(([, l]) => l.toLowerCase()).join(' and '))}` : ''}.</p>` : ''}
    ${ins.length ? `<h2>Worth discussing</h2><ul>${ins.map((i) => `<li><b>${esc(i.title)}.</b> ${esc(i.detail)}</li>`).join('')}</ul>` : ''}
    <h2>Questions to ask</h2>
    <ul>${briefQuestions(f, events()).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
    <p class="br-fine">Prepared with the planning engine under 2026 federal law (1,000 simulated markets; historical returns 1928–2025; SSA mortality; Arizona flat tax). Projections are hypothetical, not guarantees. Education and decision support, not personal advice.</p>`;
}

function printBrief() {
  const html = renderBrief();
  if (!html) return;
  $('#brief').innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

$('#verdict').addEventListener('click', (e) => { if (e.target.closest('[data-brief]')) printBrief(); });

// ---------------------------------------------------------------- meeting mode: the client's side of the desk

const MEET_LABEL = {
  death: (e, f) => `If ${f.people[e.who].first} passed away at ${e.age}`,
  ltc: (e, f) => `If ${f.people[0].first} needed care at ${e.age}`,
  crash: () => 'If markets crashed next year',
  inflation: () => 'If prices rose faster',
  ssCut: () => 'If Social Security were cut',
};
const meetAge = (e) => S.ages[e.id] ?? e.def;

function meetingEvent() {
  const id = Object.keys(S.active).find((k) => S.active[k] != null && S.active[k] !== false);
  return id ? eventCatalog(plan(), S.facts).find((e) => e.id === id) : null;
}

function renderMeeting() {
  const el = $('#meeting');
  if (!S.meeting || !S.facts) { el.hidden = true; return; }
  el.hidden = false;
  const f = S.facts, base = S.baseP, v = S.r.verdict, sel = meetingEvent(), ps = S.r.events || {};
  const nm = f.people.map((p) => p.first).join(' and ');
  const through = f.people.filter((p, i) => !(sel && sel.kind === 'death' && sel.who === i)).map((p) => `${p.first} is ${p.planTo}`).join(' and ');
  const now = sel && v ? v.probability : base;
  const tiles = eventCatalog(plan(), f).map((e) => {
    const age = meetAge(e), on = sel && sel.id === e.id, p = ps[e.id];
    return `<button class="mt-tile ${on ? 'on' : ''}" data-meet="${e.id}">
      <span class="mt-q">${esc(MEET_LABEL[e.kind]({ ...e, age }, f))}</span>
      ${e.def != null ? `<span class="mt-age"><i data-meet-age="${e.id}" data-d="-1">−</i>age ${age}<i data-meet-age="${e.id}" data-d="1">+</i></span>` : ''}
      ${p != null && base != null ? `<span class="mt-p">${base} → <b class="${p < 75 ? 'bad' : ''}">${p}</b></span>` : ''}
    </button>`;
  }).join('');
  let story = '';
  if (sel && v) {
    const c = S.r.cliff;
    if (sel.kind === 'death' && c) {
      const surv = f.people[1 - c.who].first;
      story = `<p class="mt-say">${esc(surv)}'s guaranteed income would go from <b>${money(c.incomeBefore / 12)}</b> to <b>${money(c.incomeAfter / 12)}</b> a month. Spending only falls to about ${money(c.spendAfter / 12)}, so the difference comes from savings every month.</p>`;
    } else if (sel.kind === 'ltc') story = `<p class="mt-say">Three years of care at about $110,000 a year, in today's dollars, would come out of savings.</p>`;
    else if (sel.kind === 'crash') story = `<p class="mt-say">A bad start hurts most because withdrawals keep going while prices are down. The order of returns matters more than the average.</p>`;
    else if (sel.kind === 'inflation') story = `<p class="mt-say">Spending rises with prices every year; ${f.pensions.some((p) => !p.cola) ? 'a pension without a cost-of-living raise does not.' : 'savings have to cover the gap.'}</p>`;
    else story = `<p class="mt-say">Benefits would be about a quarter smaller from 2033 if Congress doesn't act before the trust fund runs short.</p>`;
    const fx = S.r.fix;
    story += !fx ? '<p class="mt-wait">Finding what we could do…</p>'
      : fx.changes.length && fx.after > fx.before ? `<div class="mt-fix"><div class="mt-k">What we could do</div><ol>${fx.changes.map((c) => `<li>${esc(c.what)}</li>`).join('')}</ol><div class="mt-fix-p">${fx.before} → <b>${fx.after}</b> out of 100</div></div>`
      : `<div class="mt-fix"><div class="mt-k">What we could do</div><p>${fx.before >= 85 ? 'The plan holds even then. Nothing needs to change.' : 'This one needs a conversation about other options.'}</p></div>`;
  }
  el.innerHTML = `
    <button class="mt-x" data-meet-exit>Exit meeting mode ✕</button>
    <div class="mt-head">
      <div class="mt-name">${esc(nm)}</div>
      <div class="mt-big"><span class="${now != null && now < 75 ? 'bad' : ''}">${now ?? '…'}</span><small> out of 100</small></div>
      <div class="mt-cap">${sel ? esc(MEET_LABEL[sel.kind]({ ...sel, age: meetAge(sel) }, f)) + ', in' : 'In'} ${now ?? '…'} out of 100 possible futures, the money lasts until ${esc(through)}.</div>
      ${sel && base != null ? `<div class="mt-was">Today's plan: ${base} out of 100. <button data-meet="${sel.id}">Back to today</button></div>` : ''}
    </div>
    ${story}
    <div class="mt-k">What if…</div>
    <div class="mt-tiles">${tiles}</div>`;
}

function toggleMeeting(on) {
  S.meeting = on;
  document.body.classList.toggle('meeting', on);
  renderMeeting();
}

$('#meeting').addEventListener('click', (e) => {
  if (e.target.closest('[data-meet-exit]')) return toggleMeeting(false);
  const a = e.target.closest('[data-meet-age]');
  if (a) {
    const cat = eventCatalog(plan(), S.facts).find((x) => x.id === a.dataset.meetAge);
    const age = Math.min(cat.max, Math.max(cat.min, meetAge(cat) + +a.dataset.d));
    S.ages[cat.id] = age;
    if (S.active[cat.id] != null) S.active[cat.id] = age;
    renderMeeting(); renderEvents();
    schedule(S.active[cat.id] != null ? 'ages' : 'agesOnly', 350);
    return;
  }
  const t = e.target.closest('[data-meet]');
  if (!t) return;
  const id = t.dataset.meet, was = S.active[id] != null;
  const cat = eventCatalog(plan(), S.facts).find((x) => x.id === id);
  S.active = was ? {} : { [id]: cat.def != null ? meetAge(cat) : true };
  S.r.fix = null;
  renderEvents(); renderMeeting();
  schedule('events', 0);
});
$('#meetBtn').addEventListener('click', () => toggleMeeting(true));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.meeting) toggleMeeting(false); });

// ---------------------------------------------------------------- story mode: the page drives itself

const story = { run: 0, skip: false };
const stillOn = (id) => story.run === id;
function wait(ms, id) {
  return new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      if (!stillOn(id)) return res(false);
      if (story.skip) { story.skip = false; return res(true); }
      if (performance.now() - t0 >= ms) return res(true);
      setTimeout(tick, 60);
    };
    tick();
  });
}
function until(cond, id, ms = 20000) {
  return new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (!stillOn(id) ? res(false) : cond() || performance.now() - t0 > ms ? res(true) : setTimeout(tick, 80));
    tick();
  });
}
function say(k, n, html) {
  $('#story').hidden = false;
  $('#storyText').innerHTML = html;
  $('#storyStep').textContent = `${k} / ${n}`;
  $('#storyProg').style.width = `${(k / n) * 100}%`;
}
function focusCard(sel) {
  document.querySelectorAll('.spot').forEach((x) => x.classList.remove('spot'));
  const el = $(sel);
  el.classList.add('spot');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function endStory() {
  story.run++;
  $('#story').hidden = true;
  document.querySelectorAll('.spot').forEach((x) => x.classList.remove('spot'));
}
$('#storyNext').addEventListener('click', () => (story.skip = true));
$('#storyEnd').addEventListener('click', endStory);
$('#storyBtn').addEventListener('click', startStory);

async function startStory() {
  const id = ++story.run, N = 6;
  load('kowalski');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  say(1, N, 'Loading Dale and Marilyn Kowalski…');
  await until(() => S.r.verdict && S.r.events && S.r.fix, id);
  if (!stillOn(id)) return;
  const v0 = S.r.verdict, d = v0.diagnosis;
  focusCard('#verdict');
  say(1, N, `Meet <b>Dale and Marilyn Kowalski</b>, 78 and 71. Their plan says <b>${v0.probability}%</b>, inside the confidence zone. Most reviews stop here.`);
  if (!(await wait(6500, id))) return;

  S.selYear = d.worst ? d.worst.year : S.selYear; renderBreaks();
  focusCard('#breaks');
  say(2, N, `Replay every retirement since 1928 with real markets. It fails <b>${d.failed} times</b>, all in ${esc(d.eras.map((e) => e.name).join(' and '))}. In those years the portfolio lost <b>${pct(Math.abs(d.badFirst10))} a year</b> for a decade, then earned <b>more</b> than the good years did. It's the order of returns, not the average.`);
  if (!(await wait(10000, id))) return;

  focusCard('#events');
  say(3, N, 'Dale took the single-life option on his pension because the check was bigger. What if he dies at 82?');
  if (!(await wait(3500, id))) return;
  const box = document.querySelector('[data-ev=death0]');
  const slider = document.querySelector('[data-age=death0]');
  if (slider) { slider.value = 82; S.ages.death0 = 82; }
  if (box && !box.checked) box.click();
  await until(() => S.r.cliff && S.r.verdict && S.r.verdict !== v0, id);
  if (!stillOn(id)) return;
  focusCard('#verdict');
  say(3, N, `The same plan, if Dale dies at 82: <b>${v0.probability}% → ${S.r.verdict.probability}%</b>. Nothing about the market changed.`);
  if (!(await wait(5000, id))) return;

  const c = S.r.cliff;
  focusCard('#cliff');
  say(4, N, `Here's why. Marilyn's guaranteed income falls <b>${pct((c.incomeBefore - c.incomeAfter) / c.incomeBefore, 0)}</b>: the pension stops and one Social Security check goes away. Her spending only falls <b>${pct((c.spendBefore - c.spendAfter) / c.spendBefore, 0)}</b>, so ${compact(c.iraAfter - c.iraBefore)} more comes out of savings every year.`);
  if (!(await wait(9000, id))) return;

  await until(() => S.r.fix, id);
  if (!stillOn(id)) return;
  const fx = S.r.fix;
  focusCard('#fix');
  say(5, N, `Then the engine searches for the least painful fix, weighted by what <b>they</b> said matters: ${esc(fx.changes.map((x) => x.what.toLowerCase()).join(', then '))}. <b>${fx.before}% → ${fx.after}%</b>, checked on the engine. One click prints it as a review brief.`);
  if (!(await wait(9000, id))) return;

  say(6, N, `That's one household, in about a second. Now watch a whole book of 4,000 live through the 2020 crash.<br><a class="btn primary" style="margin-top:12px" href="book.html?story=1">Watch the whole book →</a>`);
}

// ---------------------------------------------------------------- boot

async function boot() {
  ['#verdict', '#breaks', '#fix', '#sens', '#insights'].forEach((s) => ($(s).innerHTML = '<p class="loading">running the engine…</p>'));
  const id = location.hash.slice(1);
  if (id === 'mine') {
    // Answers from the Try it page, handed over in this tab's sessionStorage (they never leave the browser).
    let mine = null;
    try { mine = JSON.parse(sessionStorage.getItem('gb-try') || 'null'); } catch {}
    if (mine) return load(null, mine, 'mine', 'Your family, from Try it');
  }
  const m = id.match(/^book:(h\d+|[a-z]+):(-?[\d.]+)(?::(-?[\d.]+))?$/);
  if (m) {
    const book = await fetch('data/book.json').then((r) => r.json());
    checkProvenance([{ label: 'The book\u2019s precomputed engine numbers', data: book }]);
    const f = book.households.find((h) => h.id === m[1]);
    if (f) {
      const spx = +m[2], bond = +(m[3] || 0);
      const note = `From the book${spx ? ` · S&P ${spx > 0 ? '+' : '−'}${Math.abs(spx * 100).toFixed(1)}% since the plan was made${bond ? `, bonds ${bond > 0 ? '+' : '−'}${Math.abs(bond * 100).toFixed(1)}%` : ''}` : ''}`;
      return load(null, applyMarket(f, spx, bond), id, note);
    }
  }
  load(FAMILIES.some((f) => f.id === id) ? id : FAMILIES[0].id);
  if (new URLSearchParams(location.search).has('story')) setTimeout(startStory, 900);
}
boot();
