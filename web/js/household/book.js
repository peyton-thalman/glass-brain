// The Book X-ray: 4,000 households re-scored by the Book Brain every time the market moves, with red flags,
// opportunities a drop opens up, and the real engine one click away to check any answer.

import { BookBrain } from './bookbrain.js';
import { applyMarket, features, balances, growth, HEADS, EQUITY, BONDS } from './book-model.js';
import { toPlan } from './families.js';
import * as P from '../vendor/planner.js';
import { headEvents } from './book-model.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const compact = (n) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}k` : `${s}$${Math.round(a)}`;
};
const pctS = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`;
const NH = HEADS.length;

// ---------------------------------------------------------------- engine worker (for checks)

const worker = new Worker(new URL('./xray-worker.js', import.meta.url), { type: 'module' });
const waiting = new Map();
let seq = 0;
worker.onmessage = ({ data }) => { const r = waiting.get(data.id); if (r && data.type !== 'progress') { waiting.delete(data.id); r(data.out); } };
const engine = (msg) => new Promise((res) => { const id = ++seq; waiting.set(id, res); worker.postMessage({ ...msg, id }); });

// ---------------------------------------------------------------- state

const S = { book: [], brain: null, eps: [], ep: 0, i: 0, spx: 0, playing: false, probs: null, p0: null, order: [], sel: null, tab: 'flags', checks: [], last: 0, ms: 0 };

async function boot() {
  $('#stats').innerHTML = '<div class="bk-stat"><span class="l">loading the book and the brain…</span></div>';
  const [book, brain, spx] = await Promise.all(['book', 'bookbrain', 'spx'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())));
  S.book = book.households;
  S.trials = book.trials;
  S.brain = new BookBrain(brain);
  S.stats = brain.stats;
  S.eps = spx.episodes;
  S.source = spx.source;
  S.inv0 = S.book.map((f) => invested(f));
  S.risky = S.book.map((f) => f.accounts.ira.reduce((t, x) => t + x, 0) + f.accounts.roth + f.accounts.taxable);
  startPool(brain);
  await score(0);
  S.p0 = S.probs.slice();
  S.order = S.book.map((_, i) => i).sort((a, b) => S.p0[b * NH] - S.p0[a * NH] || a - b);
  S.cellOf = new Int32Array(S.book.length);
  S.order.forEach((h, c) => (S.cellOf[h] = c));
  renderEps();
  setEpisode(S.eps.findIndex((e) => e.id === 'lastyear'), true);
  renderTrust();
  window.addEventListener('resize', drawField);
}

/** Investments after the market move, without copying the household. */
const investedAt = (i) => S.inv0[i] + S.risky[i] * (growth(S.book[i], S.spx, S.bond) - 1);

function invested(f) {
  const a = f.accounts;
  return a.ira.reduce((s, x) => s + x, 0) + a.roth + a.taxable + a.cash;
}


// ---------------------------------------------------------------- the Book Brain, split across worker threads

const pool = [];
let poolSeq = 0;
function startPool(brainJson) {
  const n = S.book.length, W = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)), per = Math.ceil(n / W);
  for (let w = 0; w < W; w++) {
    const lo = w * per, hi = Math.min(n, lo + per);
    const slice = S.book.slice(lo, hi);
    const X = new Float32Array(slice.flatMap((f) => features(f)));
    const B = new Float32Array(slice.flatMap((f) => balances(f)));
    const EQ = new Float32Array(slice.map((f) => EQUITY[f.invest.portfolio]));
    const BD = new Float32Array(slice.map((f) => BONDS[f.invest.portfolio]));
    const wk = new Worker(new URL('./bookbrain-worker.js', import.meta.url), { type: 'module' });
    wk.postMessage({ init: true, layers: brainJson.layers, X, B, EQ, BD });
    pool.push({ wk, lo, hi });
  }
}

/** Run the Book Brain over every household at this market (all workers in parallel). */
async function score(spx, bond = 0) {
  const t0 = performance.now(), id = ++poolSeq, n = S.book.length;
  const parts = await Promise.all(pool.map(({ wk, lo }) => new Promise((res) => {
    const on = ({ data }) => { if (data.id === id) { wk.removeEventListener('message', on); res([lo, data.out]); } };
    wk.addEventListener('message', on);
    wk.postMessage({ spx, bond, id });
  })));
  const probs = new Float32Array(n * NH);
  for (const [lo, out] of parts) probs.set(out, lo * NH);
  S.probs = probs;
  S.ms = performance.now() - t0;
  S.spx = spx; S.bond = bond;
}

const pOf = (i, h = 0) => S.probs[i * NH + h];
const p0Of = (i) => S.p0[i * NH];

// ---------------------------------------------------------------- the market

function renderEps() {
  $('#eps').innerHTML = S.eps.map((e, k) => `<button data-ep="${k}">${esc(e.label)}</button>`).join('');
}
$('#eps').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ep]');
  if (!b) return;
  setEpisode(+b.dataset.ep);
  play(true);
});

function setEpisode(k, atEnd) {
  S.ep = k; S.i = atEnd ? S.eps[k].close.length - 1 : 0; S.playing = false; S.manual = false;
  document.querySelectorAll('#eps button').forEach((b) => b.classList.toggle('on', +b.dataset.ep === k));
  $('#epNote').textContent = S.eps[k].note;
  $('#play').textContent = '▶';
  frame();
}

function epSpx(k, i) {
  const c = S.eps[k].close;
  return c[i] / c[0] - 1;
}

function play(fromStart, stopAt) {
  if (S.manual) setEpisode(S.ep);
  const e = S.eps[S.ep];
  if (fromStart || S.i >= e.close.length - 1) S.i = 0;
  S.playing = true;
  $('#play').textContent = '❚❚';
  const stride = Math.max(1, Math.round(e.close.length / 140));
  const tick = async () => {
    if (!S.playing) return;
    const end = stopAt ?? e.close.length - 1;
    S.i = Math.min(end, S.i + stride);
    await frame();
    if (S.i >= end) { pause(); return; }
    setTimeout(tick, 16);
  };
  setTimeout(tick, 16);
}
function pause() {
  S.playing = false;
  $('#play').textContent = '▶';
  spotCheck();
}
$('#play').addEventListener('click', () => (S.playing ? pause() : play(false)));

$('#spx').addEventListener('input', (e) => {
  S.playing = false; S.manual = true;
  $('#play').textContent = '▶';
  document.querySelectorAll('#eps button').forEach((b) => b.classList.remove('on'));
  $('#epNote').textContent = 'Plans made today, then the S&P moves this much at once. Stocks only: bonds and cash held flat.';
  frame(+e.target.value / 100);
});
$('#spx').addEventListener('change', () => spotCheck());

let busy = false, queued = null;
async function frame(manualSpx) {
  if (busy) { queued = manualSpx ?? null; return; }
  busy = true;
  const spx = manualSpx != null ? manualSpx : epSpx(S.ep, S.i), bond = manualSpx != null ? 0 : S.eps[S.ep].bond[S.i];
  await score(spx, bond);
  busy = false;
  if (manualSpx == null) $('#spx').value = Math.round(spx * 100);
  renderMarket();
  renderStats();
  drawField();
  const now = performance.now();
  if (!S.playing || now - S.last > 300) { S.last = now; renderList(); if (S.sel != null) renderDetail(); }
  if (queued != null && !S.playing) { const q = queued; queued = null; frame(q); }
}

function renderMarket() {
  const e = S.eps[S.ep], spx = S.spx;
  const el = $('#spxMove');
  el.textContent = pctS(spx);
  el.style.color = spx < -0.1 ? 'var(--coral)' : spx < 0 ? 'var(--amber)' : spx > 0 ? 'var(--good)' : 'var(--text)';
  $('#spxDate').textContent = S.manual ? 'S&P 500, moved by hand (bonds held flat)' : `S&P 500 on ${fmtDate(e.dates[S.i])}, since ${fmtDate(e.dates[0])} · bonds ${pctS(e.bond[S.i])} (10-year yield ${e.yield10[S.i].toFixed(2)}%)`;
  const c = e.close, W = 600, H = 90, lo = Math.min(...c), hi = Math.max(...c);
  const X = (i) => (i / (c.length - 1)) * W, Y = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const pts = c.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const done = c.slice(0, S.i + 1).map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  $('#spark').innerHTML = `
    <line x1="0" x2="${W}" y1="${Y(c[0])}" y2="${Y(c[0])}" stroke="var(--line-2)" stroke-dasharray="3 4"/>
    <polyline points="${pts}" fill="none" stroke="var(--faint)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
    ${S.manual ? '' : `<polyline points="${done}" fill="none" stroke="var(--amber)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <line x1="${X(S.i)}" x2="${X(S.i)}" y1="0" y2="${H}" stroke="var(--amber)" stroke-width="1" vector-effect="non-scaling-stroke"/>`}`;
}
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ---------------------------------------------------------------- flags

function flagsFor(i) {
  const f = S.book[i], e = f.engine, out = [];
  const k = growth(f, S.spx, S.bond);
  const p = pOf(i), p0 = p0Of(i);
  if (p < 75) out.push({ kind: 'red', short: p0 >= 75 ? 'Fell below 75%' : 'Below 75%' });
  let worst = null;
  for (let h = 1; h < NH; h++) {
    const v = S.probs[i * NH + h];
    if ((HEADS[h].id === 'death0' || HEADS[h].id === 'death1') && f.people.length < 2) continue;
    if (!worst || v < worst.v) worst = { h, v };
  }
  if (worst && p - worst.v >= 15) out.push({ kind: 'amber', short: `${headName(f, worst.h)}: ${Math.round(worst.v)}%`, worst });
  const ira = f.accounts.ira.reduce((s, x) => s + x, 0) * k;
  if (S.spx <= -0.1 && e.rate > 0 && e.rate <= 0.22 && e.room >= 10000 && ira > 10000 && e.irmaaRoom > 10000) {
    const amt = Math.floor(Math.min(e.room, e.irmaaRoom - 5000, ira) / 1000) * 1000;
    if (amt >= 10000) out.push({ kind: 'green', short: `Roth window ${compact(amt)}`, roth: amt, k, rate: e.rate });
  }
  if (e.draw > 0 && p < 90 && f.feelings.cutOk !== 'no' && investedAt(i) < S.inv0[i] / 1.2) out.push({ kind: 'amber', short: 'Guardrail check-in', guard: true });
  if (e.irmaaRoom > 0 && e.irmaaRoom < 15000) out.push({ kind: 'plain', short: `${compact(e.irmaaRoom)} under IRMAA`, irmaa: true });
  return out;
}

function headName(f, h) {
  const id = HEADS[h].id;
  if (id === 'death0') return `If ${f.people[0].first} dies`;
  if (id === 'death1') return `If ${f.people[1].first} dies`;
  if (id === 'ltc') return `If ${f.people[0].first} needs care`;
  if (id === 'crash') return 'Another crash';
  if (id === 'ssCut') return 'SS cut 23%';
  return 'Hotter inflation';
}

function renderStats() {
  const n = S.book.length;
  let below = 0, below0 = 0, money = 0, roth = 0, rothAmt = 0, guard = 0;
  for (let i = 0; i < n; i++) {
    const p = pOf(i);
    if (p < 75) { below++; money += investedAt(i); }
    if (p0Of(i) < 75) below0++;
    if (S.spx <= -0.1 || S.spx < 0) {
      const fl = flagsFor(i);
      const r = fl.find((x) => x.roth);
      if (r) { roth++; rothAmt += r.roth; }
      if (fl.some((x) => x.guard)) guard++;
    }
  }
  const d = below - below0;
  $('#stats').innerHTML = `
    <div class="bk-stat ${d > 0 ? 'alarm' : ''}"><span class="l">Plans below 75%</span><b>${below.toLocaleString()}</b><div class="d">${d > 0 ? `+${d.toLocaleString()} since the plans were made` : d < 0 ? `−${Math.abs(d).toLocaleString()} since the plans were made` : 'same as the day the plans were made'}</div></div>
    <div class="bk-stat ${d > 0 ? 'alarm' : ''}"><span class="l">Money in those plans</span><b>${compact(money)}</b><div class="d">across ${below.toLocaleString()} households</div></div>
    <div class="bk-stat ${roth ? 'good' : ''}"><span class="l">Roth conversion windows open</span><b>${roth.toLocaleString()}</b><div class="d">${roth ? `${compact(rothAmt)} could convert at today's prices` : 'they open when stocks are down 10%+'}</div></div>
    <div class="bk-stat"><span class="l">Guardrail check-ins due</span><b>${guard.toLocaleString()}</b><div class="d">withdrawal rate up 20% or more</div></div>`;
}

// ---------------------------------------------------------------- the field

const COLS = 100;
function colorOf(p) {
  const stops = [[0, [255, 106, 85]], [50, [255, 140, 74]], [75, [255, 176, 74]], [88, [196, 214, 140]], [97, [159, 230, 184]]];
  let a = stops[0], b = stops[stops.length - 1];
  for (let s = 0; s < stops.length - 1; s++) if (p >= stops[s][0] && p <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; }
  const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (p - a[0]) / (b[0] - a[0])));
  return `rgb(${a[1].map((v, j) => Math.round(v + t * (b[1][j] - v))).join(',')})`;
}

function drawField() {
  const cv = $('#field'), n = S.book.length;
  const w = cv.clientWidth, cw = w / COLS, rows = Math.ceil(n / COLS), h = rows * cw;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const gap = cw > 6 ? 1 : 0.5;
  for (let c = 0; c < n; c++) {
    const i = S.order[c], p = pOf(i);
    const x = (c % COLS) * cw, y = Math.floor(c / COLS) * cw;
    g.fillStyle = colorOf(p);
    g.globalAlpha = p < 75 && p0Of(i) >= 75 ? 1 : 0.82;
    g.fillRect(x, y, cw - gap, cw - gap);
  }
  g.globalAlpha = 1;
  if (S.sel != null) {
    const c = S.cellOf[S.sel];
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.strokeRect((c % COLS) * cw - 1, Math.floor(c / COLS) * cw - 1, cw + 1, cw + 1);
  }
  $('#fieldKey').innerHTML = `<span><i style="background:${colorOf(97)}"></i>95%+</span><span><i style="background:${colorOf(85)}"></i>75–90%</span><span><i style="background:${colorOf(70)}"></i>60–75%</span><span><i style="background:${colorOf(45)}"></i>below 60%</span><span>brighter cells fell below 75% since the plan date</span>`;
}

function cellAt(e) {
  const cv = $('#field'), r = cv.getBoundingClientRect(), cw = r.width / COLS;
  const c = Math.floor((e.clientY - r.top) / cw) * COLS + Math.floor((e.clientX - r.left) / cw);
  return c >= 0 && c < S.book.length ? S.order[c] : null;
}
$('#field').addEventListener('mousemove', (e) => {
  const i = cellAt(e);
  if (i == null) return hideTip();
  const f = S.book[i];
  showTip(e, `<b>${esc(f.name)}</b><br>${Math.round(pOf(i))}% now <span class="m">· ${Math.round(p0Of(i))}% at the plan date</span><br><span class="m">${esc(summary(f))}</span>`);
});
$('#field').addEventListener('mouseleave', hideTip);
$('#field').addEventListener('click', (e) => { const i = cellAt(e); if (i != null) select(i); });

function showTip(e, html) {
  const t = $('#tip');
  t.innerHTML = html; t.hidden = false;
  t.style.left = Math.min(window.innerWidth - t.offsetWidth - 12, e.clientX + 14) + 'px';
  t.style.top = e.clientY + 16 + 'px';
}
function hideTip() { $('#tip').hidden = true; }

function summary(f) {
  const ppl = f.people.map((p) => `${p.first} ${p.age}`).join(' · ');
  const pen = f.pensions.filter((p) => p.endAge == null);
  const penTxt = pen.length ? ` · pension ${compact(pen.reduce((s, p) => s + p.monthly, 0))}/mo${f.people.length === 2 && pen.some((p) => p.survivorPct === 0) ? ' (single-life)' : ''}` : '';
  return `${ppl} · ${compact(invested(f))} saved · ${compact(f.spending.core)}/mo${penTxt}`;
}

// ---------------------------------------------------------------- lists

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  renderList();
});

/** Engine answers for this exact market, keyed by household: { p } for the plan, { h, v } for its worst event. */
const confirmed = () => (S.conf && S.conf.spx === S.spx ? S.conf.map : null);

function flagRows() {
  const n = S.book.length, rows = [], conf = confirmed();
  for (let i = 0; i < n; i++) {
    const fl = flagsFor(i), c = conf && conf.get(i);
    const p = c && c.p != null ? c.p : pOf(i), w = fl.find((x) => x.worst);
    const wv = c && c.v != null ? c.v : w ? w.worst.v : null;
    const fell = p < 75 && p0Of(i) >= 75, hidden = p >= 75 && wv != null && wv < 40;
    if (!fell && !hidden && !(p < 75)) continue;
    rows.push({ i, fl, c, p, tier: fell ? 0 : hidden ? 1 : 2, score: (fell ? 3000 : hidden ? 2000 : 0) + (p0Of(i) - p) * 3 + (100 - (hidden ? wv : p)) });
  }
  return rows.sort((a, b) => b.score - a.score);
}

function renderList() {
  const n = S.book.length;
  let rows = [];
  if (S.tab === 'flags') rows = flagRows();
  else for (let i = 0; i < n; i++) {
    const fl = flagsFor(i), r = fl.find((x) => x.roth), g = fl.find((x) => x.guard);
    if (!r && !g) continue;
    rows.push({ i, fl, score: (r ? r.roth : 0) + (g ? 1 : 0) });
  }
  if (S.tab !== 'flags') rows.sort((a, b) => b.score - a.score);
  const shown = rows.slice(0, 50), conf = confirmed();
  const head = S.tab === 'flags'
    ? `<div class="bk-empty">${rows.filter((r) => r.tier === 0).length.toLocaleString()} fell below 75% since the plans were made · ${rows.filter((r) => r.tier === 1).length.toLocaleString()} look fine but are one event from trouble · ${rows.filter((r) => r.tier === 2).length.toLocaleString()} were already below 75%.</div>`
    : `<div class="bk-empty">${rows.length ? `${rows.length.toLocaleString()} households could come out ahead of this market.` : 'Roth windows open when stocks fall 10% or more. Play a crash.'}</div>`;
  const note = S.tab === 'flags' ? (conf ? `<div class="bk-empty">✓ The top ${conf.size} were re-checked on the engine at this market; their numbers are the engine's.</div>` : S.playing ? '<div class="bk-empty">Brain estimates while the market moves. The engine re-checks the top flags when it pauses.</div>' : '') : '';
  $('#flagList').innerHTML = head + note + shown.map(({ i, fl, c }) => {
    const f = S.book[i], p = Math.round(c && c.p != null ? c.p : pOf(i)), p0 = Math.round(p0Of(i));
    const roth = fl.find((x) => x.roth);
    const why = S.tab === 'opps' && roth
      ? `Convert ${compact(roth.roth)} at today's prices: fills the ${Math.round(roth.rate * 100)}% bracket and stays under IRMAA. If stocks recover, about ${compact(roth.roth * (1 / roth.k - 1))} of the rebound lands tax-free.`
      : esc(summary(f));
    return `<button class="bk-row ${S.sel === i ? 'sel' : ''}" data-i="${i}">
      <div class="bk-row-h"><b>${esc(f.name)}</b><span class="bk-row-p">${p0}% → <i class="${p >= 75 ? 'ok' : ''}">${p}%</i>${c ? ' ✓' : ''}</span></div>
      <div class="why">${why}</div>
      <div class="bk-chips">${fl.map((x) => `<span class="bk-chip ${x.kind}">${esc(x.short)}</span>`).join('')}</div>
    </button>`;
  }).join('');
}
$('#flagList').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) select(+b.dataset.i); });

// ---------------------------------------------------------------- one household

function select(i) {
  S.sel = i; S.engineHeads = null;
  renderDetail(); drawField(); renderList();
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** What moves this household: realistic changes, each scored by the brain at today's market. */
function levers(f) {
  const base = S.brain.predict(f)[0], out = [];
  const tryIt = (name, g) => { const q = JSON.parse(JSON.stringify(f)); if (g(q) === false) return; out.push({ name, pts: S.brain.predict(q)[0] - base }); };
  tryIt('Spend 10% less', (q) => { q.spending.core *= 0.9; });
  tryIt('10% more saved', (q) => { q.accounts.ira = q.accounts.ira.map((x) => x * 1.1); q.accounts.roth *= 1.1; q.accounts.taxable *= 1.1; q.accounts.cash *= 1.1; });
  f.people.forEach((p, k) => { if (p.claimAge > p.age && p.claimAge < 70) tryIt(`${p.first} claims Social Security a year later`, (q) => { q.people[k].claimAge += 1; }); });
  if (f.invest.portfolio > 1) tryIt('One step safer mix', (q) => { q.invest.portfolio -= 1; });
  if (f.invest.portfolio < 5) tryIt('One step riskier mix', (q) => { q.invest.portfolio += 1; });
  tryIt('Fees 0.5% lower', (q) => { q.invest.fees = Math.max(0, q.invest.fees - 0.5); });
  if (f.spending.wants.length) tryIt('Drop the travel and goals', (q) => { q.spending.wants = []; });
  if (f.spending.gifts) tryIt('Stop the gifts', (q) => { q.spending.gifts = 0; });
  tryIt('Stocks fall another 10%', (q) => Object.assign(q, applyMarket(q, -0.1)));
  out.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  return { base, list: out.filter((x) => Math.abs(x.pts) >= 0.5) };
}

function renderDetail() {
  const i = S.sel, f = S.book[i], el = $('#detail');
  el.hidden = false;
  const lv = levers(applyMarket(f, S.spx, S.bond));
  const maxPts = Math.max(5, ...lv.list.map((p) => Math.abs(p.pts)));
  const eng = S.engineHeads && S.engineHeads.spx === S.spx ? S.engineHeads.p : null;
  const fl = flagsFor(i);
  const roth = fl.find((x) => x.roth);
  const heads = HEADS.map((h, k) => {
    if ((h.id === 'death0' || h.id === 'death1') && f.people.length < 2) return '';
    const v = S.probs[i * NH + k];
    const col = v >= 75 ? 'var(--good)' : v >= 60 ? 'var(--amber)' : 'var(--coral)';
    return `<div class="bk-head"><span>${esc(k === 0 ? 'The plan as it is' : headName(f, k))}</span>
      <div class="t"><i style="width:${v}%;background:${col}"></i>${eng && eng[k] != null ? `<u style="left:calc(${eng[k]}% - 1px)"></u>` : ''}</div>
      <span class="v">${Math.round(v)}%${eng && eng[k] != null ? ` <small>engine ${eng[k]}%</small>` : ''}</span></div>`;
  }).join('');
  el.innerHTML = `
    <div class="hx-kicker"><span class="n">${esc(f.named ? 'Named family' : 'Household ' + f.id.slice(1))}</span> at S&amp;P ${pctS(S.spx)}</div>
    <h2>${esc(f.name)}</h2>
    <p class="hx-lede">${esc(summary(f))}</p>
    <div class="bk-det">
      <div>
        <div class="hx-kicker">What the brain says</div>
        <div class="bk-heads">${heads}</div>
        ${roth ? `<p class="fx-cost">Roth window: converting <b>${compact(roth.roth)}</b> this year fills the ${Math.round(roth.rate * 100)}% bracket and stays under the first IRMAA tier (from the engine's ledger). At today's prices that buys ${(1 / roth.k).toFixed(2)}× the shares it would have on the plan date.</p>` : ''}
        <div class="bk-actions">
          <button class="btn" id="checkBtn">${eng ? 'Checked against the engine ✓' : 'Check all of these with the engine'}</button>
          <a class="btn primary" href="household.html#book:${f.id}:${Math.round(S.spx * 1000) / 1000}:${Math.round((S.bond || 0) * 1000) / 1000}">Open the full X-ray →</a>
        </div>
      </div>
      <div>
        <div class="hx-kicker">What would move it</div>
        <p class="hx-lede" style="margin-top:0">Each change below is scored by the brain at today's market, a few microseconds each. From <b>${Math.round(lv.base)}%</b>, the biggest movers first.</p>
        <div class="bk-why">${lv.list.slice(0, 7).map((p) => {
          const w = (Math.abs(p.pts) / maxPts) * 50;
          return `<div class="bk-why-r"><span>${esc(p.name)}</span><div class="t"><span class="mid"></span><i style="${p.pts < 0 ? `right:50%` : `left:50%`};width:${w}%;background:${p.pts < 0 ? 'var(--coral)' : 'var(--good)'}"></i></div><span class="v ${p.pts < 0 ? 'neg' : 'pos'}">${p.pts > 0 ? '+' : '−'}${Math.abs(p.pts).toFixed(0)} pts</span></div>`;
        }).join('') || '<p class="bk-empty">Nothing here moves it more than half a point: the plan is settled either way.</p>'}</div>
      </div>
    </div>`;
  $('#checkBtn').onclick = checkOne;
}

async function checkOne() {
  const i = S.sel, f = applyMarket(S.book[i], S.spx, S.bond), spx = S.spx;
  $('#checkBtn').textContent = 'Running 7 × 1,000 markets on the engine…';
  const t0 = performance.now();
  const p = await engine({ type: 'heads', plan: toPlan(P, f), evs: headEvents(f) });
  S.engineHeads = { spx, p };
  S.checks.push(...p.map((v, k) => (v == null ? null : Math.abs(v - S.probs[i * NH + k]))).filter((x) => x != null));
  S.engineMs = (performance.now() - t0) / p.filter((x) => x != null).length;
  if (S.sel === i) renderDetail();
  renderTrust();
}

// ---------------------------------------------------------------- trust

/** The brain nominates, the engine decides: re-run the top red flags on the engine at this market. */
async function confirmFlags() {
  const spx = S.spx, bond = S.bond, top = flagRows().filter((r) => r.tier < 2).slice(0, 16);
  if (!top.length) { S.conf = { spx, map: new Map() }; return; }
  const items = top.map(({ i, tier, fl }) => {
    const f = applyMarket(S.book[i], spx, bond), w = fl.find((x) => x.worst);
    return tier === 1 && w ? { plan: toPlan(P, f), ev: headEvents(f)[w.worst.h], i, h: w.worst.h } : { plan: toPlan(P, f), ev: {}, i };
  });
  const ps = await engine({ type: 'checkEv', items: items.map(({ plan, ev }) => ({ plan, ev })) });
  if (S.spx !== spx) return;
  const map = new Map();
  items.forEach((x, k) => map.set(x.i, x.h != null ? { v: ps[k], h: x.h } : { p: ps[k] }));
  S.conf = { spx, map };
  const gaps = items.map((x, k) => Math.abs(ps[k] - (x.h != null ? S.probs[x.i * NH + x.h] : pOf(x.i))));
  S.flagCheck = { spx, n: gaps.length, mean: gaps.reduce((t, x) => t + x, 0) / gaps.length, kept: flagRows().filter((r) => r.c && r.tier < 2).length };
  renderList();
  renderTrust();
}

async function spotCheck() {
  await confirmFlags();
  const n = S.book.length, pick = [];
  const flagged = [];
  for (let i = 0; i < n; i++) if (pOf(i) < 75) flagged.push(i);
  for (let k = 0; k < 6 && flagged.length; k++) pick.push(flagged[Math.floor(Math.random() * flagged.length)]);
  while (pick.length < 12) pick.push(Math.floor(Math.random() * n));
  const spx = S.spx, bond = S.bond;
  const t0 = performance.now();
  const plans = pick.map((i) => toPlan(P, applyMarket(S.book[i], spx, bond)));
  const ps = await engine({ type: 'check', plans });
  S.engineMs = (performance.now() - t0) / plans.length;
  const gaps = ps.map((p, k) => Math.abs(p - S.probs[pick[k] * NH]));
  S.lastCheck = { spx, n: plans.length, mean: gaps.reduce((s, x) => s + x, 0) / gaps.length, max: Math.max(...gaps) };
  S.checks.push(...gaps);
  renderTrust();
}

function renderTrust() {
  const st = S.stats, n = S.book.length;
  let gap = 0;
  const gaps = [];
  for (let i = 0; i < n; i++) { const g = Math.abs(p0Of(i) - S.book[i].engine.p); gap += g; gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const p90 = gaps[Math.floor(gaps.length * 0.9)];
  const engineMin = S.engineMs ? (S.engineMs * n * NH) / 60000 : null;
  const lc = S.lastCheck;
  $('#trust').innerHTML = `
    <div class="hx-kicker"><span class="n">Trust</span> How much to believe the brain</div>
    <h2>A neural network you can <em>check</em>.</h2>
    <p class="hx-lede">The Book Brain learned the planning engine from ${st.households.toLocaleString()} made-up households, each run through the engine under all seven scenarios (${st.trials} markets each). It never decides anything on its own: every number above can be checked against the engine with one click.</p>
    <div class="bk-tgrid">
      <div class="bk-stat"><span class="l">Error on ${st.testHouseholds.toLocaleString()} households it never saw</span><b>${st.testMAE[0].toFixed(1)} pts</b><div class="d">average; ${st.testMAE.slice(1).map((v) => v.toFixed(1)).join(' / ')} on the six life events</div></div>
      <div class="bk-stat"><span class="l">This whole book at the plan date, against the engine at ${S.trials.toLocaleString()} markets each</span><b>${(gap / n).toFixed(1)} pts</b><div class="d">average gap over all ${n.toLocaleString()} households; 90% within ${p90.toFixed(1)} pts</div></div>
      <div class="bk-stat"><span class="l">Speed</span><b>${S.ms.toFixed(0)} ms</b><div class="d">for ${n.toLocaleString()} households × 7 scenarios here${engineMin ? `. The engine in this browser: about ${engineMin.toFixed(0)} minutes` : ''}</div></div>
    </div>
    ${lc ? `<p class="hx-lede" style="margin-top:14px">Last live spot check, at S&amp;P ${pctS(lc.spx)}: the engine re-ran ${lc.n} households picked at random (half of them below 75%), and the brain was off by <b>${lc.mean.toFixed(1)} pts</b> on average, ${lc.max.toFixed(0)} at most.${S.flagCheck ? ` It also re-ran the top ${S.flagCheck.n} red flags. There the brain was off by ${S.flagCheck.mean.toFixed(1)} pts on average: the biggest drops are where its rare misses gather, which is why the list shows the engine's numbers once the market pauses.` : ''}</p>` : '<p class="hx-lede" style="margin-top:14px">Every time a replay pauses, the engine re-runs a dozen random households and the top red flags at that market, so the brain is checked live.</p>'}`;
}

// ---------------------------------------------------------------- Monday-morning brief

function opener(f, row) {
  const first = f.people.map((p) => p.first).join(' and ');
  const w = row.fl.find((x) => x.worst), drop = Math.round(p0Of(row.i) - (row.c && row.c.p != null ? row.c.p : pOf(row.i)));
  if (row.tier === 0) return `"Hi ${first}, with the market where it is I wanted to walk through your plan before you have to wonder about it. It moved about ${drop} points, ${(row.c && row.c.p != null ? row.c.p : pOf(row.i)) < 50 ? 'it needs some changes, and I want to make them with you rather than wait' : "it's still workable, and I have two or three ideas to shore it up"}."`;
  const id = w && HEADS[w.worst.h].id;
  if (id === 'death0' || id === 'death1') {
    const k = id === 'death0' ? 0 : 1, gone = f.people[k].first, surv = f.people[1 - k].first;
    return `"I'd like to go over what ${surv}'s income would look like if something happened to ${gone}. Your plan handles the markets fine; that's the one scenario it isn't ready for."`;
  }
  if (id === 'ltc') return `"Your plan holds up well in the markets. The gap is care: if you ever needed it, how would we pay for it? Let's look at the options while it's an easy conversation."`;
  if (id === 'crash') return `"Your plan is fine today, but another drop from here would hurt. Let's agree now, while it's calm, on what we'd adjust if it happens."`;
  return `"Let's spend twenty minutes on your plan. It's in good shape, and there's one scenario worth getting ahead of."`;
}

function mondayBrief() {
  const rows = flagRows().filter((r) => r.tier < 2).slice(0, 3);
  const opps = [];
  for (let i = 0; i < S.book.length; i++) { const r = flagsFor(i).find((x) => x.roth); if (r) opps.push({ i, r }); }
  opps.sort((a, b) => b.r.roth - a.r.roth);
  const top = opps.slice(0, 3), e = S.eps[S.ep];
  const when = S.manual ? 'this market' : fmtDate(e.dates[S.i]);
  const assets = rows.reduce((t, r) => t + investedAt(r.i), 0);
  const rebound = top.reduce((t, o) => t + o.r.roth * (1 / o.r.k - 1), 0);
  const call = (r, n) => {
    const f = S.book[r.i], p = Math.round(r.c && r.c.p != null ? r.c.p : pOf(r.i)), w = r.fl.find((x) => x.worst);
    const why = r.tier === 0 ? `Plan fell from ${Math.round(p0Of(r.i))}% to ${p}% since it was made.` : `Plan looks fine at ${p}%, but ${w ? headName(f, w.worst.h).replace(/^./, (c) => c.toLowerCase()) : 'one event'} would take it to ${w ? Math.round(r.c && r.c.v != null ? r.c.v : w.worst.v) : '?'}%.`;
    return `<div class="mb-item"><div class="mb-n">${n}</div><div><div class="mb-name">${esc(f.name)}${r.c ? ' <span class="mb-ok">✓ engine-checked</span>' : ''}</div>
      <div class="mb-why">${esc(why)} ${esc(summary(f))}</div><div class="mb-say">${esc(opener(f, r))}</div>
      <a class="mb-link" href="household.html#book:${f.id}:${Math.round(S.spx * 1000) / 1000}:${Math.round((S.bond || 0) * 1000) / 1000}">Open the X-ray to bring to the call →</a></div></div>`;
  };
  const opp = (o, n) => {
    const f = S.book[o.i];
    return `<div class="mb-item"><div class="mb-n">${n}</div><div><div class="mb-name">${esc(f.name)}</div>
      <div class="mb-why">Convert <b>${compact(o.r.roth)}</b> to Roth this year: it fills the ${Math.round(o.r.rate * 100)}% bracket and stays under IRMAA. At today's prices that buys ${(1 / o.r.k).toFixed(2)}× the shares it would have at the plan date.</div>
      <div class="mb-say">"Prices are down, which makes this a good year to move some of your IRA to a Roth: same tax bill, more shares, and the rebound on them is never taxed."</div></div></div>`;
  };
  const html = `
    <div class="mt-name">Your week · ${esc(when)}</div>
    <div class="mb-head">Three calls, ${top.length ? 'three opportunities, ' : ''}and what to say.</div>
    <p class="mb-sum">These three households cover <b>${compact(assets)}</b> of client assets.${top.length ? ` The three Roth conversions move <b>${compact(top.reduce((t, o) => t + o.r.roth, 0))}</b> into tax-free growth; if stocks recover to where they were, about <b>${compact(rebound)}</b> of rebound lands there untaxed.` : ' Roth windows open when stocks are down 10% or more.'}</p>
    <div class="mt-k">Calls to make</div>${rows.map((r, n) => call(r, n + 1)).join('') || '<p class="mb-why">No red flags this week.</p>'}
    ${top.length ? `<div class="mt-k">Opportunities</div>${top.map((o, n) => opp(o, n + 1)).join('')}` : ''}
    <p class="mb-fine">Ranked by the Book Brain; the top flags are re-checked on the planning engine when the market pauses (✓). Made-up households. Decision support, not advice.</p>`;
  $('#monday').innerHTML = `<button class="mt-x" data-mb-close>Close ✕</button><button class="btn mb-print" data-mb-print>Print</button>${html}`;
  $('#monday').hidden = false;
  document.body.classList.add('meeting');
  S.mondayHtml = html;
}
$('#mondayBtn').addEventListener('click', () => { S.playing = false; mondayBrief(); });
$('#monday').addEventListener('click', (e) => {
  if (e.target.closest('[data-mb-close]')) { $('#monday').hidden = true; document.body.classList.remove('meeting'); }
  if (e.target.closest('[data-mb-print]')) {
    $('#mbrief').innerHTML = S.mondayHtml;
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }
});

// ---------------------------------------------------------------- story mode

const story = { run: 0, skip: false };
const on = (id) => story.run === id;
const wait = (ms, id) => new Promise((res) => {
  const t0 = performance.now();
  const tick = () => (!on(id) ? res(false) : story.skip ? ((story.skip = false), res(true)) : performance.now() - t0 >= ms ? res(true) : setTimeout(tick, 60));
  tick();
});
const until = (cond, id, ms = 60000) => new Promise((res) => {
  const t0 = performance.now();
  const tick = () => (!on(id) ? res(false) : cond() || performance.now() - t0 > ms ? res(true) : setTimeout(tick, 80));
  tick();
});
function say(k, n, html) {
  $('#story').hidden = false;
  $('#storyText').innerHTML = html;
  $('#storyStep').textContent = `${k} / ${n}`;
  $('#storyProg').style.width = `${(k / n) * 100}%`;
}
function spot(sel) {
  document.querySelectorAll('.spot').forEach((x) => x.classList.remove('spot'));
  const el = $(sel); el.classList.add('spot'); el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function endStory() { story.run++; S.playing = false; $('#story').hidden = true; document.querySelectorAll('.spot').forEach((x) => x.classList.remove('spot')); }
$('#storyNext').addEventListener('click', () => (story.skip = true));
$('#storyEnd').addEventListener('click', endStory);
$('#storyBtn').addEventListener('click', () => startStory());

function counts() {
  let below = 0, below0 = 0, roth = 0, rothAmt = 0;
  for (let i = 0; i < S.book.length; i++) {
    if (pOf(i) < 75) below++;
    if (p0Of(i) < 75) below0++;
    const r = flagsFor(i).find((x) => x.roth);
    if (r) { roth++; rothAmt += r.roth; }
  }
  return { below, below0, roth, rothAmt };
}

async function startStory() {
  await until(() => S.brain, story.run);
  const id = ++story.run, N = 5;
  const covid = S.eps.findIndex((e) => e.id === 'covid');
  setEpisode(covid);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  spot('.bk-field');
  say(1, N, `An advisor's whole book: <b>4,000 households</b>, every cell a family. February 19, 2020: the S&P closes at an all-time high. ${counts().below0.toLocaleString()} plans are below 75%.`);
  if (!(await wait(6000, id))) return;

  const e = S.eps[covid];
  const trough = e.close.indexOf(Math.min(...e.close));
  spot('.bk-market');
  say(2, N, 'Now the next 23 trading days, one frame per day. A neural network trained on the planning engine re-scores all 4,000 households under seven scenarios every frame.');
  if (!(await wait(2500, id))) return;
  play(true, trough);
  await until(() => !S.playing, id);
  if (!on(id)) return;
  spot('#stats');
  const c = counts();
  say(3, N, `March 23, 2020, S&P <b>${pctS(S.spx)}</b>. <b>${(c.below - c.below0).toLocaleString()} more plans</b> fell below 75%. And <b>${c.roth.toLocaleString()} households</b> had a Roth window open: ${compact(c.rothAmt)} that could have been converted at the bottom, so the rebound on those dollars grows tax-free.`);
  if (!(await wait(10000, id))) return;

  S.tab = 'flags'; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'flags'));
  renderList();
  const first = $('#flagList [data-i]');
  if (first) select(+first.dataset.i);
  await wait(600, id);
  spot('#detail');
  say(4, N, 'Click any red flag: the brain\'s seven answers, what would move the plan most (each change scored in microseconds), and the real engine one click away to check it. It\'s checking itself right now.');
  $('#checkBtn')?.click();
  if (!(await wait(9000, id))) return;

  spot('.bk-market');
  say(5, N, 'Then the recovery.');
  play(false);
  await until(() => !S.playing, id);
  if (!on(id)) return;
  const c2 = counts();
  spot('#trust');
  say(5, N, `By August the S&P was back, and ${c2.below.toLocaleString()} plans were below 75%. The calls that mattered were the ones made in March. That's the point: <b>see it while it's happening</b>, household by household, with the engine checking every answer.`);
}

boot().then(() => { if (new URLSearchParams(location.search).has('story')) setTimeout(startStory, 600); });
