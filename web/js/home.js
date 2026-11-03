// The front door. Every number on it is computed live: the planning engine runs the Kowalskis and the Hoffmans
// in a worker, and the Book Brain re-scores the 4,000-household book and the 100,000-household firm as 2020 replays.

import * as P from './vendor/planner.js';
import { FAMILIES, toPlan } from './household/families.js';
import { features, balances, EQUITY, BONDS } from './household/book-model.js';

const $ = (s) => document.querySelector(s);
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pctS = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%`;
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- reveals

const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('.rv').forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 60}ms`; io.observe(el); });

/** Run fn once, the first time el comes within `margin` of the viewport. */
function whenNear(el, fn, margin = '400px') {
  const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { o.disconnect(); fn(); } }, { rootMargin: margin });
  o.observe(el);
}
/** Track whether el is on screen, so animations pause when it isn't. */
function visible(el) {
  const st = { on: false };
  new IntersectionObserver((es) => es.forEach((e) => (st.on = e.isIntersecting))).observe(el);
  return st;
}

// tagline: each word lights up as it crosses the middle of the screen
{
  const p = $('#tagline');
  p.innerHTML = p.textContent.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ');
  const words = [...p.querySelectorAll('.w')];
  const o = new IntersectionObserver((es) => {
    const hit = es.filter((e) => e.isIntersecting).map((e) => e.target).sort((a, b) => words.indexOf(a) - words.indexOf(b));
    hit.forEach((w, k) => { w.style.transitionDelay = `${k * 90}ms`; w.classList.add('on'); o.unobserve(w); });
  }, { rootMargin: '0px 0px -40% 0px' });
  words.forEach((w) => o.observe(w));
}

// ---------------------------------------------------------------- the planning engine, off the main thread

function makeWorker() {
  const w = new Worker(new URL('./household/xray-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let seq = 0;
  w.onmessage = ({ data }) => { const p = pending.get(data.id); if (p && data.type !== 'progress') { pending.delete(data.id); p(data.out); } };
  return (msg) => new Promise((res) => { const id = ++seq; pending.set(id, res); w.postMessage({ ...msg, id }); });
}
const engine = makeWorker(), engine2 = makeWorker();

const KOW = FAMILIES.find((f) => f.id === 'kowalski');
const HOF = FAMILIES.find((f) => f.id === 'hoffman');
const kowPlan = toPlan(P, KOW), hofPlan = toPlan(P, HOF);

// ---------------------------------------------------------------- hero: every real start year since 1928

function fitCanvas(cv, h) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth;
  h = h ?? cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

async function hero() {
  const v = await engine({ type: 'verdict', plan: kowPlan, ev: {} });
  const runs = v.history.filter((h) => !h.wraps);
  const ok = runs.filter((r) => r.ok).length, bad = runs.length - ok;
  const eras = v.diagnosis.eras.map((e) => e.name);
  $('#heroCap').innerHTML = `Each line is one starting year. Their money lasted in <b>${ok} of ${runs.length}</b>. The ${bad} red ones all started with ten rough years for the market${eras.length ? `, like ${eras[0]}` : ''}.`;
  heroPaths.runs = runs;
  drawHero(reduce ? 1 : 0);
  if (!reduce) {
    const t0 = performance.now(), dur = 2600;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur); drawHero(1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  return v;
}
const heroPaths = { runs: [], k: 1 };
function drawHero(k) {
  heroPaths.k = k;
  const cv = $('#heroPaths'), { g, w, h } = fitCanvas(cv);
  const runs = heroPaths.runs;
  if (!runs.length) return;
  const len = Math.max(...runs.map((r) => r.path.length));
  const vals = runs.flatMap((r) => r.path).sort((a, b) => a - b);
  const top = vals[Math.floor(vals.length * 0.97)] || 1;
  const pad = 4, X = (i) => pad + (i / (len - 1)) * (w - pad * 2), Y = (v) => h - pad - Math.min(1, v / top) * (h - pad * 2);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h - pad); g.lineTo(w, h - pad); g.stroke();
  const good = css('--good'), coral = css('--coral');
  const upto = Math.max(2, Math.ceil(len * k));
  for (const pass of [true, false]) {
    for (const r of runs) {
      if (r.ok !== pass) continue;
      g.strokeStyle = r.ok ? good : coral;
      g.globalAlpha = r.ok ? 0.22 : 0.95;
      g.lineWidth = r.ok ? 1 : 1.75;
      g.beginPath();
      r.path.slice(0, upto).forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
      g.stroke();
    }
  }
  g.globalAlpha = 1;
}
addEventListener('resize', () => drawHero(heroPaths.k));

// ---------------------------------------------------------------- what if: 100 futures as 100 dots

const order = (() => { let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: 100 }, (_, i) => i).sort(() => r() - 0.5); })();
const rank = new Array(100); order.forEach((d, k) => (rank[d] = k));
$('#dots').innerHTML = Array.from({ length: 100 }, () => '<i class="wait"></i>').join('');

function setDots(p) {
  const n = Math.round(p);
  [...$('#dots').children].forEach((d, i) => { d.classList.remove('wait'); d.classList.toggle('bad', rank[i] >= n); });
}
function countTo(el, to, ms = 900) {
  const from = +el.dataset.v || 0, t0 = performance.now();
  el.dataset.v = to;
  if (reduce) return (el.textContent = Math.round(to));
  const tick = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function whatIfs(base, evs) {
  const [d, m] = KOW.people, pen = KOW.pensions[0];
  const deathAge = Math.min(d.planTo - 1, d.age + 4), careAge = Math.max(85, d.age + 3);
  const by = Object.fromEntries(evs.map((e) => [e.id, e.p]));
  return [
    { id: 'base', label: 'As planned', p: base, why: `Dale's pension and their two Social Security checks pay for most of their bills. Savings cover the rest.` },
    { id: 'death0', label: `${d.first} dies at ${deathAge}`, p: by.death0, why: `${d.first}'s pension stops when he dies. ${m.first} would lose <b>${money(pen.monthly)} a month</b> and one Social Security check, but most of her bills stay the same.` },
    { id: 'ltc', label: `${d.first} needs care at ${careAge}`, p: by.ltc, why: `Three years in care costs about <b>$110,000 a year</b>. They have no care insurance, so it all comes out of savings.` },
    { id: 'crash', label: 'Stocks crash now', p: by.crash, why: `Two bad years right away hurt the most, because they're selling investments at low prices to pay the bills.` },
    { id: 'ssCut', label: 'Social Security is cut', p: by.ssCut, why: `If Congress does nothing, checks could shrink about <b>23% in 2033</b>. They'd need more from savings every month.` },
  ].filter((x) => x.p != null);
}

async function story(v) {
  const evs = await engine({ type: 'events', plan: kowPlan, facts: KOW, ages: {} });
  const items = whatIfs(v.probability, evs);
  const tabs = $('#whatTabs');
  tabs.innerHTML = items.map((x, i) => `<button role="tab" aria-selected="${i === 0}" data-i="${i}">${x.label}</button>`).join('');
  const pick = (i) => {
    const x = items[i];
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', +b.dataset.i === i));
    countTo($('#whatP'), x.p);
    setDots(x.p);
    $('#whatWhy').innerHTML = x.why;
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { auto.stop = true; pick(+b.dataset.i); } });
  const auto = { stop: false };
  whenNear($('#dots'), async () => {
    pick(0);
    // A gentle nudge: after a moment, show the one that matters most, unless they've already tapped.
    await sleep(2600);
    if (!auto.stop) pick(items.findIndex((x) => x.id === 'ltc'));
  }, '-20% 0px');
}

// ---------------------------------------------------------------- the gentlest fix

function ring(el, p, color) {
  const r = 80, c = 2 * Math.PI * r;
  el.innerHTML = `<svg viewBox="0 0 180 180"><circle class="track" cx="90" cy="90" r="${r}"/><circle class="val" cx="90" cy="90" r="${r}" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg><b data-v="0">0</b>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector('.val').style.strokeDashoffset = c * (1 - p / 100); countTo(el.querySelector('b'), p, 1600); }));
}

async function fix() {
  const r = await engine2({ type: 'fix', plan: hofPlan, ev: {}, facts: HOF });
  whenNear($('#fix'), () => {
    ring($('#ringA'), r.before, r.before >= 75 ? css('--good') : r.before >= 60 ? css('--amber') : css('--coral'));
    setTimeout(() => ring($('#ringB'), r.after, css('--good')), 700);
    const moves = r.changes.map((c) => `<div class="mv"><b>${c.what}</b>${c.detail ? `<span>${c.detail[0].toUpperCase() + c.detail.slice(1)}</span>` : ''}</div>`).join('');
    $('#fixMoves').innerHTML = (moves || '<p class="note">No change needed.</p>') +
      `<p class="note">Replayed through history: ${r.histAfter.ok} of ${r.histAfter.of} real start years now work, up from ${r.histBefore.ok}.</p>`;
  }, '-15% 0px');
}

// ---------------------------------------------------------------- colors shared by the book and the firm

function mixRGB(stops, p) {
  let a = stops[0], b = stops[stops.length - 1];
  for (let s = 0; s < stops.length - 1; s++) if (p >= stops[s][0] && p <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; }
  const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (p - a[0]) / (b[0] - a[0])));
  return `rgb(${a[1].map((v, j) => Math.round(v + t * (b[1][j] - v))).join(',')})`;
}
const CORAL = [242, 101, 90], AMBER = [240, 180, 76], GREEN = [76, 195, 138];
const planColor = (p) => mixRGB([[0, CORAL], [70, CORAL], [76, AMBER], [86, AMBER], [94, GREEN]], p);
const shareColor = (s) => mixRGB([[0, GREEN], [0.12, GREEN], [0.25, AMBER], [0.45, CORAL]], s);

function spark(svg, e, upto) {
  const c = e.close, lo = Math.min(...c), hi = Math.max(...c);
  const X = (i) => (i / (c.length - 1)) * 600, Y = (v) => 56 - ((v - lo) / (hi - lo || 1)) * 52;
  const pts = c.slice(0, upto + 1).map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const all = c.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  svg.innerHTML = `<polyline points="${all}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><polyline points="${pts}" fill="none" stroke="${css('--text')}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
}
function setMarket(el, sub, e, i) {
  const m = e.close[i] / e.close[0] - 1;
  el.textContent = pctS(m);
  el.classList.toggle('dn', m < -0.005); el.classList.toggle('up', m > 0.005);
  sub.textContent = `S&P 500 · ${fmtDate(e.dates[i])}`;
  return m;
}

// ---------------------------------------------------------------- an advisor's book

async function book() {
  const [bk, brain, spx] = await Promise.all(['book', 'bookbrain', 'spx'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())));
  const hh = bk.households, n = hh.length;
  const W = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)), per = Math.ceil(n / W);
  const pool = [];
  for (let w = 0; w < W; w++) {
    const lo = w * per, slice = hh.slice(lo, Math.min(n, lo + per));
    const wk = new Worker(new URL('./household/bookbrain-worker.js', import.meta.url), { type: 'module' });
    wk.postMessage({
      init: true, layers: brain.layers,
      X: new Float32Array(slice.flatMap((f) => features(f))), B: new Float32Array(slice.flatMap((f) => balances(f))),
      EQ: new Float32Array(slice.map((f) => EQUITY[f.invest.portfolio])), BD: new Float32Array(slice.map((f) => BONDS[f.invest.portfolio])),
    });
    pool.push({ wk, lo });
  }
  const heads = brain.heads.length;
  let seq = 0;
  const score = (s, b) => {
    const id = ++seq, out = new Float32Array(n);
    return Promise.all(pool.map(({ wk, lo }) => new Promise((res) => {
      const on = ({ data }) => { if (data.id !== id) return; wk.removeEventListener('message', on); for (let i = 0; i < data.out.length / heads; i++) out[lo + i] = data.out[i * heads]; res(); };
      wk.addEventListener('message', on); wk.postMessage({ spx: s, bond: b, id });
    }))).then(() => out);
  };

  const base = await score(0, 0);
  const sorted = Array.from({ length: n }, (_, i) => i).sort((a, b) => base[b] - base[a]);
  const cv = $('#bkField');
  const draw = (ps) => {
    const w = cv.clientWidth, cols = w < 520 ? 40 : w < 900 ? 80 : 100, cell = w / cols, rows = Math.ceil(n / cols);
    const { g } = fitCanvas(cv, rows * cell);
    cv.style.height = rows * cell + 'px';
    const r = cell * 0.36;
    sorted.forEach((idx, k) => {
      g.fillStyle = planColor(ps[idx]);
      g.beginPath(); g.arc((k % cols) * cell + cell / 2, Math.floor(k / cols) * cell + cell / 2, r, 0, Math.PI * 2); g.fill();
    });
  };
  let last = base;
  draw(base);
  addEventListener('resize', () => draw(last));

  const e = spx.episodes.find((x) => x.id === 'covid') || spx.episodes[0];
  const vis = visible($('.h-book'));
  const below = (ps) => ps.reduce((t, p) => t + (p < 75), 0);
  for (;;) {
    for (let i = 0; i < e.dates.length; i++) {
      while (!vis.on) await sleep(300);
      const t0 = performance.now();
      const m = setMarket($('#bkMove'), $('#bkDate'), e, i);
      last = await score(m, e.bond[i] || 0);
      draw(last); spark($('#bkSpark'), e, i);
      $('#bkBad').textContent = below(last).toLocaleString('en-US');
      await sleep(Math.max(0, (i === 0 ? 1400 : 70) - (performance.now() - t0)));
    }
    await sleep(3200);
  }
}

// ---------------------------------------------------------------- the whole firm

const ADVISORS = 250, PER = 400;
async function firm() {
  const [brain, spx] = await Promise.all(['bookbrain', 'spx'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())));
  $('#fmTiles').innerHTML = '<i></i>'.repeat(ADVISORS);
  const tiles = [...$('#fmTiles').children];
  const W = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)), per = Math.ceil(ADVISORS / W);
  const pool = [];
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise((res) => {
    const lo = w * per, adv = Math.max(0, Math.min(ADVISORS, lo + per) - lo);
    if (!adv) return res();
    const wk = new Worker(new URL('./household/firm-worker.js', import.meta.url), { type: 'module' });
    wk.onmessage = ({ data }) => data.ready && res();
    wk.postMessage({ init: true, layers: brain.layers, seed: 424242 + w, per: PER, adv });
    pool.push({ wk, lo });
  })));
  let seq = 0;
  const score = (s, b) => {
    const id = ++seq, below = new Int32Array(ADVISORS), t0 = performance.now();
    return Promise.all(pool.map(({ wk, lo }) => new Promise((res) => {
      const on = ({ data }) => { if (data.id !== id) return; wk.removeEventListener('message', on); below.set(data.below, lo); res(); };
      wk.addEventListener('message', on); wk.postMessage({ spx: s, bond: b, id });
    }))).then(() => ({ below, ms: performance.now() - t0 }));
  };
  const paint = ({ below }) => {
    tiles.forEach((t, a) => (t.style.background = shareColor(below[a] / PER)));
    $('#fmBad').textContent = below.reduce((t, v) => t + v, 0).toLocaleString('en-US');
  };

  const first = await score(0, 0);
  paint(first);
  const engineHours = (ADVISORS * PER * 0.09) / 3600;
  $('#spdEngine').textContent = `${engineHours.toFixed(1)} hours`;
  $('#spdBrain').textContent = `${(first.ms / 1000).toFixed(1)} seconds`;

  const e = spx.episodes.find((x) => x.id === 'covid') || spx.episodes[0];
  const vis = visible($('.h-firm'));
  for (;;) {
    let i = 0;
    while (i < e.dates.length) {
      while (!vis.on) await sleep(300);
      const m = setMarket($('#fmMove'), $('#fmDate'), e, i);
      const r = await score(m, e.bond[i] || 0);
      paint(r);
      await sleep(i === 0 ? 1400 : 60);
      i += Math.max(1, Math.round(r.ms / 120));
    }
    await sleep(3200);
  }
}

// ---------------------------------------------------------------- boot

(async () => {
  const v = await hero();
  story(v);
  fix();
})();
whenNear($('.h-book'), () => book(), '600px');
whenNear($('.h-firm'), () => firm(), '900px');
