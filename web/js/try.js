// Try it on your family: seven short screens of questions, then the planning engine (in a worker, in this tab)
// answers in plain words. The answers become the same "facts" object the Household X-ray edits, so
// "See the full X-ray" hands them over through sessionStorage and nothing ever leaves the browser.

import * as P from './vendor/planner.js';
import { toPlan, NOW } from './household/families.js';
import { eventCatalog } from './household/xray-core.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const num = (s) => { const v = parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(v) ? v : 0; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const KEY = 'gb-try';

// A typical retired couple, so someone can click straight through and then change what's different for them.
const PERSON = { first: '', age: 67, sex: 'M', ss: 2400, claimed: true, claimAge: 67, working: false, workSet: false, pay: 70000, save: 6000, retireAt: 65, ssEdited: false };
const A = {
  couple: true,
  people: [{ ...PERSON }, { ...PERSON, age: 65, sex: 'F', ss: 1500, claimAge: 65 }],
  pension: { has: false, monthly: 1500, owner: 0, survivor: -1 },
  ira: 450000, roth: 0, other: 100000, cash: 40000, mix: 3,
  core: 5500, fun: 8000, funYears: 10,
  cutOk: 'some', worry: 'running-out',
};
try {
  const saved = JSON.parse(sessionStorage.getItem(KEY + '-answers') || 'null');
  if (saved) { Object.assign(A, saved); A.people = A.people.map((p, i) => ({ ...PERSON, ...(i ? { sex: 'F' } : {}), ...p })); }
} catch {}

const who = () => (A.couple ? A.people : A.people.slice(0, 1));
const nameOf = (i) => A.people[i].first.trim() || (A.couple ? (i ? 'Your partner' : 'You') : 'You');
const shortName = (i) => A.people[i].first.trim() || (i ? 'Partner' : 'You');
const anyWorking = () => who().some((p) => p.working);

/** A rough Social Security estimate from pay, using the 2026 benefit formula (bend points $1,286 and $7,749). */
function estimateSS(pay) {
  const aime = Math.min(pay, 184500) / 12;
  return Math.round((0.9 * Math.min(aime, 1286) + 0.32 * Math.max(0, Math.min(aime, 7749) - 1286) + 0.15 * Math.max(0, aime - 7749)) / 10) * 10;
}

// ---------------------------------------------------------------- the questions

const seg = (k, val, opts, cls = '') => `<div class="t-seg ${cls}" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(v) === String(val)}" data-seg="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
const moneyIn = (k, val, label, hint = '', per = '') => `<label class="t-field"><span>${label}</span><div class="t-money"><i>$</i><input inputmode="numeric" data-k="${k}" data-t="money" value="${val ? Math.round(val).toLocaleString('en-US') : ''}" placeholder="0">${per ? `<em>${per}</em>` : ''}</div>${hint ? `<small>${hint}</small>` : ''}</label>`;
const ageIn = (k, val, label) => `<label class="t-field sm"><span>${label}</span><input inputmode="numeric" data-k="${k}" data-t="int" value="${val || ''}" placeholder="67"></label>`;
const ageSel = (k, val, from, to, label) => `<label class="t-field"><span>${label}</span><select data-k="${k}" data-t="int">${Array.from({ length: to - from + 1 }, (_, j) => from + j).map((a) => `<option ${a === val ? 'selected' : ''}>${a}</option>`).join('')}</select></label>`;

const STEPS = [
  {
    title: () => 'Who is this plan for?',
    sub: () => 'You, your parents, anyone. Names are optional; they just make the results easier to read.',
    body: () => `${seg('couple', A.couple, [[false, 'One person'], [true, 'A couple']], 'lg')}
      <div class="t-people ${A.couple ? '' : 'one'}">${who().map((p, i) => `<div class="t-person">
        <label class="t-field"><span>${A.couple ? (i ? 'Second person' : 'First person') : 'First name'}</span><input data-k="people.${i}.first" value="${esc(p.first)}" placeholder="Optional" maxlength="24"></label>
        <div class="t-row">${ageIn(`people.${i}.age`, p.age, 'Age')}<div class="t-field"><span>&nbsp;</span>${seg(`people.${i}.sex`, p.sex, [['F', 'Woman'], ['M', 'Man']])}</div></div>
      </div>`).join('')}</div>`,
    check: () => {
      if (!who().every((p) => p.age >= 20 && p.age <= 95)) return 'Ages from 20 to 95 work here.';
      // Guess who is still working from their age, until someone answers that question themselves.
      who().forEach((p) => { if (!p.workSet) p.working = p.age < 62; if (p.retireAt <= p.age) p.retireAt = Math.min(75, Math.max(p.age + 1, 65)); });
      return true;
    },
  },
  {
    title: () => (A.couple ? 'Are they still working?' : 'Still working?'),
    sub: () => 'If someone is still working, tell us roughly what they earn and save. Glass Brain will plan for the years until they stop.',
    body: () => `<div class="t-people ${A.couple ? '' : 'one'}">${who().map((p, i) => `<div class="t-person">
      <b class="t-who">${esc(nameOf(i))}</b>
      ${seg(`people.${i}.working`, p.working, [[false, 'Retired'], [true, 'Still working']])}
      ${p.working ? `${moneyIn(`people.${i}.pay`, p.pay, 'Yearly pay, before taxes', '', 'a year')}
        ${moneyIn(`people.${i}.save`, p.save, 'Saved each year', 'Into a 401(k), IRA or other savings, counting any employer match', 'a year')}
        ${ageSel(`people.${i}.retireAt`, p.retireAt, Math.min(75, p.age + 1), 75, 'Plans to stop working at')}` : ''}
    </div>`).join('')}</div>`,
    after: () => who().forEach((p) => { p.workSet = true; if (p.working && !p.ssEdited) { p.ss = estimateSS(p.pay); p.claimed = false; p.claimAge = Math.max(p.claimAge, 62, Math.min(70, p.retireAt)); } }),
  },
  {
    title: () => 'Social Security',
    sub: () => anyWorking() ? 'For anyone still working, we estimated it from their pay, in today\'s dollars. Change it if you know the real number from ssa.gov.' : 'The monthly check. A guess is fine; the yearly statement at ssa.gov has the real number.',
    body: () => `<div class="t-people ${A.couple ? '' : 'one'}">${who().map((p, i) => `<div class="t-person">
      <b class="t-who">${esc(nameOf(i))}</b>
      ${moneyIn(`people.${i}.ss`, p.ss, p.claimed ? 'Monthly check' : 'Expected monthly check', p.working && !p.ssEdited ? 'Estimated from pay' : '', 'a month')}
      ${p.working ? '' : `<div class="t-field"><span>Getting it already?</span>${seg(`people.${i}.claimed`, p.claimed, [[true, 'Yes'], [false, 'Not yet']])}</div>`}
      ${p.claimed && !p.working ? '' : ageSel(`people.${i}.claimAge`, p.claimAge, Math.max(62, Math.min(70, p.age)), 70, 'Plans to start it at')}
    </div>`).join('')}</div>`,
    after: () => who().forEach((p) => { if (p.working && p.ss !== estimateSS(p.pay)) p.ssEdited = true; }),
  },
  {
    title: () => 'Is there a pension?',
    sub: () => 'A monthly check for life from an employer. Most people don\'t have one, and that\'s fine.',
    body: () => `${seg('pension.has', A.pension.has, [[false, 'No pension'], [true, 'Yes']], 'lg')}
      ${A.pension.has ? `<div class="t-people one"><div class="t-person">
        ${moneyIn('pension.monthly', A.pension.monthly, 'Monthly pension', '', 'a month')}
        ${A.couple ? `<div class="t-field"><span>Whose pension is it?</span>${seg('pension.owner', A.pension.owner, [[0, esc(shortName(0))], [1, esc(shortName(1))]])}</div>
        <div class="t-field"><span>If ${esc(shortName(A.pension.owner))} dies first, does it keep paying ${esc(shortName(1 - A.pension.owner))}?</span>${seg('pension.survivor', A.pension.survivor, [[0, 'No, it stops'], [50, 'Half'], [100, 'All of it'], [-1, 'Not sure']])}<small>This one choice can matter more than anything else.</small></div>` : ''}
      </div></div>` : ''}`,
  },
  {
    title: () => 'What\'s been saved so far?',
    sub: () => 'Rough totals are fine. Add up every account of each kind.',
    body: () => `<div class="t-grid">
      ${moneyIn('ira', A.ira, '401(k)s and IRAs', 'Taxed when the money comes out')}
      ${moneyIn('roth', A.roth, 'Roth accounts', 'Already taxed, comes out tax free')}
      ${moneyIn('other', A.other, 'Other investments', 'A regular brokerage account')}
      ${moneyIn('cash', A.cash, 'Bank and CDs', 'Checking, savings, CDs')}
    </div>
    <div class="t-field"><span>How is it invested?</span>${seg('mix', A.mix, [[2, 'Mostly safe'], [3, 'A balance'], [5, 'Mostly stocks']])}</div>`,
  },
  {
    title: () => (anyWorking() ? 'What will retirement cost?' : 'What do they spend?'),
    sub: () => anyWorking() ? 'A normal month once retired, in today\'s dollars. Not sure? Many people plan on about 75% of what they spend now.' : 'Everything that leaves the checking account in a normal month: bills, groceries, insurance, taxes, fun.',
    body: () => `<div class="t-grid">
      ${moneyIn('core', A.core, 'A normal month', '', 'a month')}
      ${moneyIn('fun', A.fun, anyWorking() ? 'Extra for travel once retired' : 'Extra for travel and big plans', 'On top of the normal month', 'a year')}
    </div>
    ${A.fun > 0 ? `<label class="t-field sm"><span>For how many years?</span><input inputmode="numeric" data-k="funYears" data-t="int" value="${A.funYears}"></label>` : ''}`,
    check: () => A.core >= 500 || 'That looks too low for a month. What would normally leave the checking account?',
  },
  {
    title: () => 'Last one: what matters?',
    sub: () => 'This decides which fixes Glass Brain is allowed to suggest.',
    body: () => `<div class="t-field"><span>In a bad year for the market, could ${A.couple ? 'they' : 'you'} spend a bit less?</span>${seg('cutOk', A.cutOk, [['yes', 'Yes, easily'], ['some', 'A little'], ['no', 'Not really']])}</div>
      <div class="t-field"><span>What's the biggest worry?</span>${seg('worry', A.worry, [['running-out', 'Running out of money'], ['market', 'A market crash'], ['care', 'Paying for care'], ...(A.couple ? [['survivor', 'Leaving a spouse short']] : [])], 'wrap')}</div>`,
  },
];

let step = 0;

function setPath(path, v) {
  const ks = path.split('.');
  let o = A;
  ks.slice(0, -1).forEach((k) => (o = o[k]));
  o[ks[ks.length - 1]] = v;
}
const parseSeg = (v) => (v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? +v : v);

function readInputs() {
  $('#flow').querySelectorAll('[data-k]').forEach((el) => {
    const t = el.dataset.t, v = t === 'money' ? num(el.value) : t === 'int' ? Math.round(num(el.value)) : el.value;
    setPath(el.dataset.k, v);
  });
}

function renderStep(dir = 0) {
  const s = STEPS[step];
  $('#prog i').style.width = `${((step + 1) / (STEPS.length + 1)) * 100}%`;
  const f = $('#flow');
  f.innerHTML = `<div class="t-card ${dir ? (dir > 0 ? 'fwd' : 'back') : ''}">
    <p class="t-step">${step + 1} of ${STEPS.length}</p>
    <h1 class="gb-h t-title">${s.title()}</h1>
    <p class="t-sub">${s.sub()}</p>
    <div class="t-body">${s.body()}</div>
    <p class="t-err" id="err" role="alert"></p>
    <div class="t-nav">
      ${step ? '<button type="button" class="gb-btn lg ghost" id="back">Back</button>' : '<span></span>'}
      <button type="submit" class="gb-btn lg" id="next">${step === STEPS.length - 1 ? 'Show me the plan' : 'Continue'}</button>
    </div>
  </div>`;
}

$('#flow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-seg]');
  if (b) { readInputs(); setPath(b.dataset.seg, parseSeg(b.dataset.v)); renderStep(); return; }
  if (e.target.closest('#back')) { readInputs(); step--; renderStep(-1); scrollTo({ top: 0 }); }
});
$('#flow').addEventListener('focusout', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.t === 'money') el.value = num(el.value) ? Math.round(num(el.value)).toLocaleString('en-US') : '';
});
$('#flow').addEventListener('input', (e) => {
  if (e.target.dataset.k === 'fun') { const had = A.fun > 0; readInputs(); if (had !== A.fun > 0) { const pos = e.target.selectionStart; renderStep(); const el = $('[data-k="fun"]'); el.focus(); el.setSelectionRange(pos, pos); } }
});
$('#flow').addEventListener('submit', (e) => {
  e.preventDefault();
  readInputs();
  const ok = STEPS[step].check ? STEPS[step].check() : true;
  if (ok !== true) { $('#err').textContent = ok; return; }
  STEPS[step].after && STEPS[step].after();
  try { sessionStorage.setItem(KEY + '-answers', JSON.stringify(A)); } catch {}
  if (step < STEPS.length - 1) { step++; renderStep(1); scrollTo({ top: 0 }); return; }
  showResult();
});

// ---------------------------------------------------------------- answers → the X-ray's facts

function facts() {
  const ppl = who().map((p, i) => {
    const age = Math.round(p.age), work = p.working && p.retireAt > age;
    return {
      first: shortName(i), age, sex: p.sex, health: 'good',
      planTo: Math.max(age + 6, p.sex === 'F' ? 95 : 93), retiredAt: work ? p.retireAt : age, salary: work ? Math.round(p.pay) : 0,
      ssMonthly: Math.round(p.ss), claimAge: p.claimed && !work ? Math.min(age, 70) : Math.max(62, p.claimAge, Math.min(age, 70)),
    };
  });
  const lead = who()[0], retireYear = NOW + (lead.working ? Math.max(0, lead.retireAt - lead.age) : 0);
  const names = ppl.map((p) => p.first);
  return {
    id: 'mine', name: names.join(' & '), tagline: 'From Try it', story: 'Entered on the Try it page. Nothing left this browser.',
    people: ppl, marital: A.couple ? 'married' : 'single',
    pensions: A.pension.has && A.pension.monthly > 0 ? [{ name: 'Pension', owner: A.couple ? A.pension.owner : 0, monthly: Math.round(A.pension.monthly), cola: false, survivorPct: A.couple ? A.pension.survivor : 0 }] : [],
    accounts: { ira: ppl.map((_, i) => (i ? 0 : Math.round(A.ira))), save: who().map((p) => (p.working ? Math.round(p.save) : 0)), roth: Math.round(A.roth), taxable: Math.round(A.other), basis: Math.round(A.other * 0.7), cash: Math.round(A.cash) },
    home: { value: 0, open: false, downsize: false, downsizeYear: 2032, netProceeds: 0 },
    spending: { core: Math.round(A.core), survivorPct: A.couple ? 80 : 100, wants: A.fun > 0 ? [{ name: 'Travel and big plans', yearly: Math.round(A.fun), years: Math.max(1, A.funYears || 10), startYear: retireYear }] : [], gifts: 0, legacy: 0 },
    invest: { portfolio: A.mix, fees: 1 },
    feelings: { cutOk: A.cutOk, priority: 'spend', worry: A.worry },
    ltc: { has: 'unsure' },
  };
}

// ---------------------------------------------------------------- the engine

function makeWorker() {
  const w = new Worker(new URL('./household/xray-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let seq = 0;
  w.onmessage = ({ data }) => { const p = pending.get(data.id); if (p && data.type !== 'progress') { pending.delete(data.id); p(data.out); } };
  return (msg) => new Promise((res) => { const id = ++seq; pending.set(id, res); w.postMessage({ ...msg, id }); });
}
const w1 = makeWorker(), w2 = makeWorker();

const zone = (p) => (p >= 85 ? ['good', 'That\'s safe.'] : p >= 75 ? ['good', 'That\'s OK, with a little room to spare.'] : p >= 60 ? ['amber', 'That\'s on the edge.'] : ['coral', 'That\'s a real risk.']);
const colorFor = (p) => (p >= 75 ? css('--good') : p >= 60 ? css('--amber') : css('--coral'));

function plainEvent(e, f) {
  const p = f.people;
  if (e.kind === 'death') {
    const d = p[e.who], s = p[1 - e.who], pen = f.pensions.find((x) => x.owner === e.who);
    const stops = pen && pen.survivorPct === 0 ? ` and the ${money(pen.monthly)} pension stops` : pen && pen.survivorPct > 0 && pen.survivorPct < 100 ? ` and the pension drops to ${pen.survivorPct}%` : '';
    return { label: `If ${d.first} dies at ${e.def}`, short: `${d.first} dying at ${e.def}`, why: `One Social Security check goes away${stops}, but most bills don't shrink for ${s.first}.` };
  }
  if (e.kind === 'ltc') return { label: `If ${p[0].first} needs care at ${e.def}`, short: `${p[0].first} needing care at ${e.def}`, why: 'Three years of care at about $110,000 a year, paid from savings.' };
  if (e.kind === 'crash') return { label: 'If stocks crash right away', short: 'a crash in the first two years', why: 'Two bad years at the start, while money is coming out, hurt the most.' };
  if (e.kind === 'inflation') return { label: 'If prices rise faster', short: 'prices rising faster', why: 'Inflation one point higher every year from here.' };
  return { label: 'If Social Security is cut', short: 'a Social Security cut', why: 'Checks about 23% smaller from 2033, if Congress does nothing.' };
}

function dots(p) {
  const n = Math.round(p);
  let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rank = Array.from({ length: 100 }, (_, i) => i).sort(() => r() - 0.5);
  return `<div class="h-dots t-dots">${rank.map((k) => `<i class="${k >= n ? 'bad' : ''}"></i>`).join('')}</div>`;
}
function ring(p, color) {
  const r = 80, c = 2 * Math.PI * r;
  return `<div class="h-ring"><svg viewBox="0 0 180 180"><circle class="track" cx="90" cy="90" r="${r}"/><circle class="val" cx="90" cy="90" r="${r}" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg><b>${Math.round(p)}</b></div>`;
}

async function showResult() {
  const f = facts(), plan = toPlan(P, f), names = f.people.map((p) => p.first);
  const mine = A.people.slice(0, f.people.length).some((p) => p.first.trim());
  try { sessionStorage.setItem(KEY, JSON.stringify(f)); } catch {}
  $('#flow').hidden = true; $('#prog i').style.width = '100%';
  const R = $('#result');
  R.hidden = false;
  R.innerHTML = `<div class="t-wait"><div class="t-spin" aria-hidden="true">${Array.from({ length: 12 }, () => '<i></i>').join('')}</div><h2 class="gb-h">Living out 1,000 retirements…</h2><p>Every real market since 1928, with taxes, Medicare and Social Security done right. Right here in this tab.</p></div>`;
  scrollTo({ top: 0 });

  const cat = eventCatalog(plan, f);
  const t0 = performance.now();
  const [v, evs] = await Promise.all([w1({ type: 'verdict', plan, ev: {} }), w2({ type: 'events', plan, facts: f, ages: {} })]);
  const fixP = v.probability < 85 ? w1({ type: 'fix', plan, ev: {}, facts: f }) : null;
  await new Promise((r) => setTimeout(r, Math.max(0, 900 - (performance.now() - t0))));

  const p = v.probability, [zc, zl] = zone(p);
  const runs = v.history.filter((h) => !h.wraps), ok = runs.filter((h) => h.ok).length;
  const events = cat.map((e) => ({ ...e, ...plainEvent(e, f), p: (evs.find((x) => x.id === e.id) || {}).p })).filter((e) => e.p != null).sort((a, b) => a.p - b.p);
  const worst = events[0];
  const subj = mine ? names.join(' and ') : 'This family';
  const poss = mine ? `${names.join(' and ')}'s` : 'their';

  R.innerHTML = `
  <section class="t-r1 rv">
    <p class="gb-eyebrow">${mine ? esc(names.join(' & ')) : 'Your answers'}</p>
    <h1 class="gb-h t-head">In <span class="${zc}">${Math.round(p)} out of 100</span> futures,<br>the money lasts.</h1>
    <p class="t-sub">${zl} Glass Brain played out ${poss} plan 1,000 different ways: good markets and bad, long lives and short.</p>
    ${dots(p)}
    <p class="t-legend"><i class="ok"></i>money lasted <i class="bad"></i>ran out before they did</p>
  </section>

  ${worst ? `<section class="t-sec rv">
    <h2 class="gb-h">What would hurt most</h2>
    <p class="t-sub">Each row is one thing that could happen. A shorter bar means it would hurt more.</p>
    <div class="t-bars">
      <div class="t-bar base"><div class="t-bl"><b>As planned</b></div><div class="t-track"><i style="--w:${p}%;--c:${colorFor(p)}"></i></div><b class="t-bv">${Math.round(p)}</b></div>
      ${events.map((e) => `<div class="t-bar"><div class="t-bl"><b>${esc(e.label)}</b><span>${esc(e.why)}</span></div><div class="t-track"><i style="--w:${e.p}%;--c:${colorFor(e.p)}"></i></div><b class="t-bv">${Math.round(e.p)}</b></div>`).join('')}
    </div>
    ${worst.p < p - 10 ? `<p class="t-call">The one to talk about: <b>${esc(worst.short)}</b>. It takes ${poss} plan from ${Math.round(p)} to ${Math.round(worst.p)}.</p>` : ''}
  </section>` : ''}

  <section class="t-sec rv">
    <h2 class="gb-h">Through real history</h2>
    <p class="t-sub">Each square is a real year since 1928. We started this plan in that year and used the real markets and prices that followed. The money lasted in <b>${ok} of ${runs.length}</b>.</p>
    <div class="t-years">${runs.map((h) => `<i class="${h.ok ? 'ok' : 'bad'}" title="${h.year}: ${h.ok ? 'money lasted' : 'ran out' + (h.runOutYear ? ' around ' + (h.runOutYear - 2026 + h.year) : '')}"></i>`).join('')}</div>
    <div class="t-yaxis"><span>${runs[0].year}</span><span>${runs[runs.length - 1].year}</span></div>
    ${v.diagnosis.failed && anyWorking() ? `<p class="t-note">Same plan, same savings. The only difference between a green square and a red one is which years the markets happened to be good or bad.</p>` : v.diagnosis.failed ? `<p class="t-note">The red years have one thing in common: a rough first ten years for the market${v.diagnosis.eras.length ? `, like ${v.diagnosis.eras[0].name}` : ''}. Bad luck early hurts far more than bad luck later.</p>` : '<p class="t-note">The money lasted in every real starting year. That\'s a strong plan.</p>'}
  </section>

  <section class="t-sec rv" id="tFix">
    <h2 class="gb-h">${fixP ? 'The easiest fix' : 'No fix needed'}</h2>
    ${fixP ? `<p class="t-sub">Glass Brain tried the changes you said would be OK, and kept the smallest ones that help the most.</p><div class="h-fix t-fixbox"><span class="sk w80"></span><span class="sk w60"></span></div>`
    : `<p class="t-sub">The plan is already above 85 out of 100. Just keep an eye on the risks above.</p>`}
  </section>

  <section class="t-sec t-next rv">
    <h2 class="gb-h">Want to see everything?</h2>
    <p class="t-sub">The full view shows the money year by year, the taxes, and every what if, with your answers filled in.</p>
    <div class="t-nav center">
      <a class="gb-btn lg" href="household.html#mine">See the full view</a>
      <button type="button" class="gb-btn lg ghost" id="edit">Change an answer</button>
    </div>
    <p class="t-private">Nothing you typed left this browser.</p>
  </section>`;

  R.querySelectorAll('.t-years i').forEach((el, k) => (el.style.transitionDelay = `${k * 12}ms`));
  R.querySelectorAll('.t-dots i').forEach((el, k) => (el.style.transitionDelay = `${k * 8}ms`));
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -8% 0px' });
  R.querySelectorAll('.rv').forEach((el) => io.observe(el));
  if (!reduce) {
    // bars grow in when seen
    const bo = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('go'), bo.unobserve(e.target))), { rootMargin: '0px 0px -15% 0px' });
    R.querySelectorAll('.t-bars, .t-years, .t-dots').forEach((el) => bo.observe(el));
  } else R.querySelectorAll('.t-bars, .t-years, .t-dots').forEach((el) => el.classList.add('go'));

  $('#edit').addEventListener('click', () => { R.hidden = true; $('#flow').hidden = false; step = 0; renderStep(); scrollTo({ top: 0 }); });

  if (fixP) {
    const r = await fixP;
    const box = R.querySelector('.t-fixbox');
    const moves = r.changes.map((c) => `<div class="mv"><b>${esc(c.what)}</b>${c.detail ? `<span>${esc(c.detail[0].toUpperCase() + c.detail.slice(1))}</span>` : ''}</div>`).join('');
    box.innerHTML = `<div class="h-fix-side"><span class="h-fix-tag">Today</span>${ring(r.before, colorFor(r.before))}</div>
      <div class="h-fix-mid"><div class="h-fix-moves">${moves || '<p class="note">None of the changes they said they could live with helps enough. This is one to talk through with an advisor.</p>'}
      <p class="note">In real history, ${r.histAfter.ok} of ${r.histAfter.of} starting years now work, up from ${r.histBefore.ok}.</p></div></div>
      <div class="h-fix-side"><span class="h-fix-tag good">With the fix</span>${ring(r.after, colorFor(r.after))}</div>`;
  }
}

renderStep(1);
