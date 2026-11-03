import { Brain } from './brain.js';
import { simulate } from './sim.js';
import { BrainView } from './viz-brain.js';
import { LivesView } from './viz-lives.js';
import { CHALLENGES, prepareEval, measure, baseline } from './challenges.js';
import { Book } from './book.js';
import { TaxTab } from './taxtab.js';
import { MGTab } from './mgtab.js';
import { LabTab } from './labtab.js';
import { Finder } from './finder.js';
import { checkProvenance } from './provenance.js';

const $ = (s) => document.querySelector(s);
const FEAT = ['age', 'portfolio', 'spending', 'income', 'equity', 'early', 'flex', 'health'];

const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 2).replace(/\.?0+$/, '')}M` : `$${Math.round(v / 1e3)}k`);
const healthWord = (h) => (h < -0.6 ? 'Poor' : h < -0.2 ? 'Below average' : h <= 0.2 ? 'Average' : h <= 0.6 ? 'Good' : 'Excellent');
const FMT = {
  age: (v) => `${Math.round(v)}`,
  portfolio: money,
  spending: (v) => `${money(v)}/yr`,
  income: (v) => (v < 500 ? 'none' : `${money(v)}/yr`),
  equity: (v) => `${Math.round(v * 100)}% stocks`,
  early: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%/yr`,
  flex: (v) => (v < 0.005 ? 'none' : `cut ≤ ${Math.round(v * 100)}%`),
  health: healthWord,
};
const SLIDERS = [
  { f: 'age', name: 'Age today', note: 'Retiring now.' },
  { f: 'portfolio', name: 'Portfolio', note: 'Invested savings.' },
  { f: 'spending', name: 'Spending', note: 'What they live on, after inflation.' },
  { f: 'income', name: 'Social Security & pensions', note: 'Guaranteed income each year.' },
  { f: 'equity', name: 'Stock allocation', note: 'The rest is bonds.' },
  { f: 'early', name: 'Markets, first 5 years', note: 'Stocks after inflation. Long-run average is +6.5%.' },
  { f: 'flex', name: 'Spending flexibility', note: 'Willing to cut in a downturn.' },
  { f: 'health', name: 'Health', note: 'Shifts life expectancy ±5 years.' },
];
const SHORT = { age: 'Age', portfolio: 'Portfolio', spending: 'Spending', income: 'Pension / SS', equity: 'Stocks', early: 'Early markets', flex: 'Flexibility', health: 'Health' };
const PRESETS = [
  ['The 4% retiree', { age: 65, portfolio: 1e6, spending: 60e3, income: 20e3, equity: 0.6, early: 0.065, flex: 0, health: 0 }],
  ['Crash on day one', { age: 65, portfolio: 1e6, spending: 60e3, income: 20e3, equity: 0.6, early: -0.09, flex: 0, health: 0 }],
  ['Retired at 56, spends big', { age: 56, portfolio: 1.6e6, spending: 115e3, income: 0, equity: 0.7, early: 0.065, flex: 0, health: 0.6 }],
  ['Pension-backed', { age: 67, portfolio: 280e3, spending: 62e3, income: 48e3, equity: 0.35, early: 0.065, flex: 0.1, health: 0 }],
  ['The big estate', { age: 72, portfolio: 4.5e6, spending: 160e3, income: 45e3, equity: 0.5, early: 0.065, flex: 0.1, health: 0.3 }],
  ['Too cautious', { age: 62, portfolio: 1.1e6, spending: 72e3, income: 14e3, equity: 0.08, early: 0.065, flex: 0, health: 0.7 }],
];

const state = {
  client: { ...PRESETS[0][1] },
  mode: 'think',
  sel: null,
  pins: {},
  challenge: 'fearless',
  hintShown: false,
};

let brain, probe, names, evalSet, base, view, lives, dead, scales, data, book;
let truth = null, simMs = 0, brainUs = 0;

async function boot() {
  const [d, p, n, e] = await Promise.all(['brain', 'probe', 'names', 'eval'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())));
  data = d; probe = p; names = n;
  brain = new Brain(d);
  evalSet = prepareEval(brain, e);
  base = baseline(brain, evalSet);
  dead = new Set(probe.neurons.filter((x) => x.fire === 0).map((x) => `${x.layer}:${x.index}`));
  const lives_ = (d.trainExamples * d.pathsPerExample / 1e6).toFixed(0);
  $('#livesCount').textContent = `${lives_} million`;

  // Brightness scale per hidden neuron: its 95th-percentile activation across held-out clients.
  scales = d.sizes.slice(1, -1).map((sz, li) => {
    const vals = Array.from({ length: sz }, () => []);
    evalSet.X.forEach((x) => { const a = brain.forward(x)[li + 1]; a.forEach((v, i) => vals[i].push(v)); });
    return vals.map((v) => { v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.95)] || 1; });
  });

  view = new BrainView($('#brainCanvas'), $('#labels'), $('#tooltip'), {
    inputNames: FEAT.map((f) => SHORT[f]),
    outputNames: ['Will the money last?', 'Median legacy', 'Years broke'],
    layerCaps: ['8 facts', 'Layer 1<br>perception', 'Layer 2<br>concepts', 'Layer 3<br>judgement', '3 answers'],
    nameOf,
    onSelect: select,
    bottomPad: () => (state.mode === 'birth' ? 110 : 40),
  });
  view.dead = dead;
  view.scales = scales;
  lives = new LivesView($('#livesCanvas'));
  book = new Book($('#bookCanvas'), $('#bookStats'), brain, { simulate, onOpen: openClient, onOpenEngine: openEngineClient });

  buildSliders();
  buildModes();
  buildSurgery();
  buildBirth();
  $('#aboutBtn').onclick = () => { $('#about').hidden = false; };
  $('#tourBtn').onclick = () => startTour();
  $('#aboutTour').onclick = () => { $('#about').hidden = true; startTour(); };
  $('#aboutExplore').onclick = () => { $('#about').hidden = true; };
  $('#tourEnd').onclick = () => endTour();
  $('#tourNext').onclick = () => { tour.skip = true; };
  $('#aboutX').onclick = () => { $('#about').hidden = true; };
  $('#about').onclick = (ev) => { if (ev.target.id === 'about') $('#about').hidden = true; };
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { $('#about').hidden = true; select(null); if (tour.on) endTour(); }
    if (ev.key === 'ArrowRight' && tour.on) tour.skip = true;
  });
  update(true);
  setTimeout(() => $('#boot').classList.add('gone'), 250);
  setTimeout(() => $('#boot').remove(), 1300);
  try { if (!localStorage.getItem('gb-seen')) { $('#about').hidden = false; localStorage.setItem('gb-seen', '1'); } } catch (_) {}
}

// ---------- naming ----------
function neuronName(li, ni) {
  const k = `${li}:${ni}`;
  if (names[k]) return names[k];
  return [`Neuron ${li + 1}·${ni}`, ''];
}
function nameOf(L, i) {
  const last = brain.sizes.length - 1;
  if (L === 0) return [SLIDERS[i].name, `input · ${FMT[FEAT[i]](state.client[FEAT[i]])}`];
  if (L === last) return [['Will the money last?', 'Median legacy', 'Expected years broke'][i], 'output'];
  const pr = probe.neurons.find((n) => n.layer === L - 1 && n.index === i);
  const [nm] = neuronName(L - 1, i);
  return [nm, `layer ${L} · fires for ${Math.round(pr.fire * 100)}% of clients`];
}

// ---------- client sliders ----------
const sliderEls = {};
function toSlider(f, v) {
  const s = data.features.find((x) => x.name === f);
  if (s.scale === 'log') return (Math.log(v) - Math.log(s.lo)) / (Math.log(s.hi) - Math.log(s.lo));
  return (v - s.lo) / (s.hi - s.lo);
}
function fromSlider(f, u) {
  const s = data.features.find((x) => x.name === f);
  if (s.scale === 'log') return Math.exp(Math.log(s.lo) + u * (Math.log(s.hi) - Math.log(s.lo)));
  return s.lo + u * (s.hi - s.lo);
}
function buildSliders() {
  const wrap = $('#sliders');
  SLIDERS.forEach(({ f, name, note }) => {
    const d = document.createElement('div');
    d.className = 'slider';
    d.innerHTML = `<div class="slider-top"><span class="slider-name">${name}</span><span class="slider-val"></span></div>
      <input type="range" min="0" max="1000" step="1"><div class="slider-note">${note}</div>`;
    const inp = d.querySelector('input');
    inp.oninput = () => {
      let v = fromSlider(f, inp.value / 1000);
      if (f === 'portfolio') v = Math.round(v / 5e3) * 5e3;
      if (f === 'spending' || f === 'income') v = Math.round(v / 1e3) * 1e3;
      state.client[f] = v;
      update(false);
    };
    inp.onchange = () => update(true);
    sliderEls[f] = { inp, val: d.querySelector('.slider-val') };
    wrap.appendChild(d);
  });
  const pw = $('#presets');
  PRESETS.forEach(([label, c]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { state.client = { ...c }; update(true); };
    pw.appendChild(b);
  });
}
function syncSliders() {
  FEAT.forEach((f) => {
    const { inp, val } = sliderEls[f];
    const u = Math.max(0, Math.min(1, toSlider(f, state.client[f])));
    if (document.activeElement !== inp) inp.value = Math.round(u * 1000);
    inp.style.setProperty('--p', `${u * 100}%`);
    val.textContent = FMT[f](state.client[f]);
  });
}

export function openClient(c) {
  state.client = { ...c };
  setMode('think');
  update(true);
}

// ---------- the main update ----------
let simTimer = null;
function activeBrain() { return state.mode === 'birth' ? birth.brain : brain; }

function update(big) {
  syncSliders();
  const B = activeBrain();
  const t0 = performance.now();
  let pred;
  for (let k = 0; k < 200; k++) pred = B.predict(state.client);
  brainUs = ((performance.now() - t0) / 200) * 1000;
  view.set(B, pred.acts);
  if (big) view.bump();
  $('#vBrain').textContent = (pred.success * 100).toFixed(0);
  $('#vLegacy').textContent = money(pred.legacy);
  $('#vBroke').textContent = pred.brokeYears < 0.05 ? '0' : pred.brokeYears.toFixed(1);
  view.setLabelValues(
    FEAT.map((f) => FMT[f](state.client[f])),
    [`${(pred.success * 100).toFixed(0)}%`, money(pred.legacy), pred.brokeYears.toFixed(1)],
    state.pins,
  );
  renderWhy(B);
  renderThought(B, pred);
  renderPaths(B, pred.success);
  renderOperated();
  renderTruthRow(pred);
  clearTimeout(simTimer);
  simTimer = setTimeout(() => runTruth(big), big ? 0 : 60);
  if (state.sel) renderInspector();
}

function runTruth(animate) {
  const t0 = performance.now();
  truth = simulate(state.client, 2000, 500);
  simMs = performance.now() - t0;
  lives.set(truth, state.client.age, animate);
  renderTruthRow(activeBrain().predict(state.client));
}

function renderTruthRow(pred) {
  if (!truth) return;
  $('#vTruth').textContent = `${(truth.success * 100).toFixed(0)}%`;
  const d = (pred.success - truth.success) * 100;
  const el = $('#vDelta');
  el.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts`;
  el.className = Math.abs(d) > 6 ? 'warn' : Math.abs(d) < 3 ? 'ok' : '';
  const x = Math.round((simMs * 1000) / Math.max(brainUs, 0.5));
  $('#vSpeed').textContent = `${brainUs < 10 ? brainUs.toFixed(1) : Math.round(brainUs)} µs (${x.toLocaleString()}× faster)`;
}

function renderWhy(B) {
  const rows = attributions(B, state.client).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const max = Math.max(0.15, ...rows.map((r) => Math.abs(r.d)));
  $('#whyBars').innerHTML = rows.map((r) => {
    const w = (Math.abs(r.d) / max) * 50;
    return `<div class="wbar"><span class="n">${r.label} <i>${r.val}</i></span><span class="t"><i class="f ${r.d >= 0 ? 'pos' : 'neg'}" style="width:${w}%"></i></span><span class="d">${r.d >= 0 ? '+' : '−'}${Math.abs(r.d * 100).toFixed(0)}</span></div>`;
  }).join('');
}

// Counterfactuals against a reference retiree: a standard 4% plan, average markets, 60/40, average health, 65.
function counterfactuals(c) {
  const need = Math.max(0, c.spending - c.income), wr = need / c.portfolio;
  return [
    { key: 'wr', label: 'Withdrawal rate', val: `${(wr * 100).toFixed(1)}%`, ref: '4%', story: `a <b>${(wr * 100).toFixed(1)}%</b> withdrawal rate`,
      cf: { ...c, spending: c.income + 0.04 * c.portfolio } },
    { key: 'early', label: 'Early markets', val: FMT.early(c.early), ref: '+6.5%', story: `early markets at <b>${FMT.early(c.early)}</b>`, cf: { ...c, early: 0.065 } },
    { key: 'equity', label: 'Stock mix', val: `${Math.round(c.equity * 100)}%`, ref: '60%', story: `a <b>${Math.round(c.equity * 100)}%</b> stock mix`, cf: { ...c, equity: 0.6 } },
    { key: 'flex', label: 'Flexibility', val: FMT.flex(c.flex), ref: 'none', story: `willingness to cut <b>${Math.round(c.flex * 100)}%</b> in a downturn`, cf: { ...c, flex: 0 } },
    { key: 'health', label: 'Health', val: healthWord(c.health), ref: 'avg', story: `<b>${healthWord(c.health).toLowerCase()}</b> health`, cf: { ...c, health: 0 } },
    { key: 'age', label: 'Age', val: `${Math.round(c.age)}`, ref: '65', story: `retiring at <b>${Math.round(c.age)}</b>`, cf: { ...c, age: 65 } },
  ];
}
function attributions(B, c) {
  const p0 = B.predict(c).success;
  return counterfactuals(c).map((k) => {
    const cf = { ...k.cf, spending: Math.min(300e3, Math.max(25e3, k.cf.spending)) };
    return { ...k, cf, d: p0 - B.predict(cf).success };
  });
}

// The brain explains itself. For the inputs moving its answer most, find the neuron that carries
// each one by activation patching: give one neuron at a time the value it would have had if that
// input were neutral, and see which single neuron recovers the most of the difference.
function carrier(B, x, xc) {
  const p0 = Brain.decode(B.forward(x).at(-1)).success;
  const cf = B.forward(xc);
  const pc = Brain.decode(cf.at(-1)).success;
  if (Math.abs(pc - p0) < 0.01) return null;
  let best = null;
  probe.neurons.forEach((n) => {
    const li = n.layer, ni = n.index;
    if (dead.has(`${li}:${ni}`)) return;
    const clamp = { [li]: { [ni]: cf[li + 1][ni] } };
    const p = Brain.decode(B.forward(x, { clamp }).at(-1)).success;
    const share = (p - p0) / (pc - p0);
    if (!best || share > best.share) best = { li, ni, share };
  });
  return best && best.share > 0.08 ? best : null;
}

function renderThought(B, pred) {
  const el = $('#thought');
  if (state.mode === 'birth' || state.mode === 'book') { el.innerHTML = ''; return; }
  const p = pred.success, c = state.client;
  const x = B.encode(c);
  const attr = attributions(B, c);
  const hurt = attr.filter((a) => a.d < -0.02).sort((a, b) => a.d - b.d)[0];
  const help = attr.filter((a) => a.d > 0.02).sort((a, b) => b.d - a.d)[0];
  const nm = (d) => `<button class="nref" data-l="${d.li}" data-i="${d.ni}">${neuronName(d.li, d.ni)[0]}</button>`;
  const what = (a) => a.story;
  const need = Math.max(0, c.spending - c.income);
  const wr = need / c.portfolio;
  const life = Math.max(1, Math.round(88 + 5 * c.health - c.age));
  const mood = p >= 0.9 ? 'I\'m calm about this one.' : p >= 0.75 ? 'Mostly fine, but something is nagging me.'
    : p >= 0.5 ? 'This makes me nervous.' : p >= 0.25 ? 'I don\'t think this works.' : 'This plan is in serious trouble.';
  let s = `<p class="t-mood">${mood}</p><p>`;
  s += need === 0
    ? 'Their guaranteed income covers everything, so the portfolio barely has to work. '
    : `They need ${money(need)} a year from ${money(c.portfolio)} for a likely <b>${life} more years</b>. `;
  if (hurt) {
    const k = carrier(B, x, B.encode(hurt.cf));
    s += `What hurts most is ${what(hurt)}: −${Math.abs(hurt.d * 100).toFixed(0)} pts against a standard plan`;
    s += k ? `. I feel it mostly through my ${nm(k)}, which carries ${Math.round(Math.min(1, k.share) * 100)}% of that worry. ` : '. ';
  }
  if (help) {
    const k = carrier(B, x, B.encode(help.cf));
    s += `${hurt ? 'Holding me up' : 'Helping most'}: ${what(help)} (+${(help.d * 100).toFixed(0)} pts)`;
    s += k ? `, read by my ${nm(k)}.` : '.';
  }
  if (!hurt && !help) s += p >= 0.9 ? 'Nothing here moves me more than a couple of points from a standard 4% plan. Comfortable.' : 'Nothing here stands out from a standard plan, which is itself the risk.';
  s += '</p>';
  el.innerHTML = `<div class="sec-label">In its own words</div>${s}<div class="t-foot">traced by activation patching across ${probe.neurons.length - dead.size} live neurons</div>`;
  el.querySelectorAll('.nref').forEach((b) => {
    b.onclick = () => select({ L: +b.dataset.l + 1, i: +b.dataset.i });
    b.onmouseenter = () => { view.hover = { L: +b.dataset.l + 1, i: +b.dataset.i }; };
    b.onmouseleave = () => { view.hover = null; };
  });
}

// Smallest change on each lever that reaches the target, found by bisection on the brain.
const TARGET = 0.9;
function renderPaths(B, p0) {
  const el = $('#paths');
  if (state.mode === 'book') return;
  const c0 = state.client;
  const P = (c) => Brain.decode(B.forward(B.encode(c)).at(-1)).success;
  const solve = (f, lo, hi, up) => {
    // find the value closest to the current one that reaches TARGET; `up` = lever helps as it increases
    const ok = (v) => P({ ...c0, [f]: v }) >= TARGET;
    const far = up ? hi : lo;
    if (!ok(far)) return null;
    let a = c0[f], b = far;
    for (let i = 0; i < 22; i++) { const m = (a + b) / 2; if (ok(m)) b = m; else a = m; }
    return b;
  };
  let rows = [];
  let head;
  if (p0 < TARGET) {
    head = `Paths to ${TARGET * 100}%`;
    const sp = solve('spending', Math.max(25e3, c0.income * 0.5), c0.spending, false);
    rows.push(['Spend less', sp === null ? null : `−${money(c0.spending - sp)}/yr`]);
    const fx = c0.flex < 0.3 ? solve('flex', c0.flex, 0.3, true) : null;
    rows.push(['Agree to cut in downturns', fx === null ? null : `up to ${Math.ceil(fx * 100)}%`]);
    const pf = solve('portfolio', c0.portfolio, 6e6, true);
    rows.push(['Save more first', pf === null ? null : `+${money(pf - c0.portfolio)}`]);
    const inc = solve('income', c0.income, 90e3, true);
    rows.push(['More guaranteed income', inc === null ? null : `+${money(inc - c0.income)}/yr`]);
    let bestEq = c0.equity, bestP = p0;
    for (let e = 0; e <= 1.0001; e += 0.05) { const p = P({ ...c0, equity: e }); if (p > bestP + 0.002) { bestP = p; bestEq = e; } }
    rows.push(['Change the mix', bestP >= TARGET ? `${Math.round(bestEq * 100)}% stocks` : (bestEq !== c0.equity && bestP - p0 > 0.01 ? `${Math.round(bestEq * 100)}% stocks gets ${Math.round(bestP * 100)}%` : null)]);
  } else {
    head = 'Room to spare';
    const ok = (v) => P({ ...c0, spending: v }) >= TARGET;
    let a = c0.spending, b = 300e3;
    if (ok(b)) a = b; else for (let i = 0; i < 22; i++) { const m = (a + b) / 2; if (ok(m)) a = m; else b = m; }
    rows.push([`Could spend more and stay above ${TARGET * 100}%`, a - c0.spending > 500 ? `+${money(a - c0.spending)}/yr` : 'right at the edge']);
    const pf = (() => { const okp = (v) => P({ ...c0, portfolio: v }) >= TARGET; let lo = 150e3, hi = c0.portfolio; if (okp(lo)) return lo; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (okp(m)) hi = m; else lo = m; } return hi; })();
    rows.push(['Portfolio it actually needs', money(pf)]);
  }
  el.innerHTML = `<div class="sec-label">${head}</div><div class="sec-sub">each on its own, solved by asking the brain ~100 questions in ${'<'}1 ms</div>` +
    rows.map(([k, v]) => `<div class="path ${v === null ? 'no' : ''}"><span>${k}</span><b>${v === null ? 'not enough alone' : v}</b></div>`).join('');
}

function renderOperated() {
  const n = brain.editCount();
  const el = $('#operated');
  el.hidden = !n || state.mode === 'birth';
  if (!n) return;
  el.querySelector('[data-op]').textContent = `You've operated on this brain · ${n} weights edited`;
  el.querySelector('[data-op-reset]').onclick = () => { brain.reset(); state.pins = {}; edited(); renderInspector(); };
}

// ---------- inspector ----------
function select(n) {
  if (n && state.mode === 'birth') return;
  state.sel = n;
  view.sel = n;
  $('#hint').style.opacity = n ? 0 : 1;
  renderInspector();
  update(false);
}

function renderInspector() {
  const el = $('#inspector');
  const n = state.sel;
  document.body.classList.toggle('inspecting', !!n);
  if (!n) { el.classList.remove('open'); el.innerHTML = ''; el.dataset.key = ''; return; }
  const wasOpen = el.dataset.key === `${n.L}:${n.i}`;
  el.dataset.key = `${n.L}:${n.i}`;
  const last = brain.sizes.length - 1;
  if (n.L === 0) inputInspector(el, n.i, wasOpen);
  else if (n.L === last) outputInspector(el, n.i, wasOpen);
  else neuronInspector(el, n.L - 1, n.i, wasOpen);
  el.classList.add('open');
}

function closeBtn() { return `<button class="ins-x" data-x>×</button>`; }
function wireClose(el) { el.querySelector('[data-x]').onclick = () => select(null); }

function neuronInspector(el, li, ni, keep) {
  const pr = probe.neurons.find((x) => x.layer === li && x.index === ni);
  const [nm, desc] = neuronName(li, ni);
  const isDead = dead.has(`${li}:${ni}`);
  const act = brain.predict(state.client).acts[li + 1][ni];
  // live vote for this client: silence it and see
  const g0 = brain.gain[li][ni];
  brain.gain[li][ni] = 0;
  const pOff = brain.predict(state.client).success;
  brain.gain[li][ni] = g0;
  const pOn = brain.predict(state.client).success;
  const live = (pOff - pOn) * 100;
  const corr = Object.entries(pr.corr).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);

  if (!keep) {
    el.innerHTML = `
      <div class="ins-top"><div><div class="sec-label">Layer ${li + 1} · neuron ${ni}</div><div class="ins-name">${nm}</div>
      <div class="ins-meta" data-meta></div></div>${closeBtn()}</div>
      <div class="ins-desc ${isDead ? 'dead' : ''}">${desc}</div>
      ${isDead ? '' : `<div class="sec-label">What makes it fire</div>
      <div class="field"><canvas data-field width="320" height="200"></canvas><div class="ax" data-ax></div></div>
      <div class="sec-label" style="margin-bottom:6px">Correlates with</div>
      <div>${corr.map(([k, v]) => `<div class="cbar"><span class="n">${k}</span><span class="t"><i style="width:${Math.abs(v) * 100}%;background:${v >= 0 ? 'var(--amber)' : 'var(--ice)'}"></i></span><span class="d">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}</span></div>`).join('')}</div>
      <div class="vote"><div><span>Silencing it, on average</span><b>${pr.vote >= 0 ? '+' : '−'}${Math.abs(pr.vote * 100).toFixed(1)} pts</b></div>
      <div><span>For this client</span><b data-live></b></div></div>
      <div class="ctl">
        <div class="slider"><div class="slider-top"><span class="slider-name">Dial</span><span class="slider-val" data-gv></span></div>
        <input type="range" data-gain min="0" max="300" step="5"></div>
        <div class="slider"><div class="slider-top"><span class="slider-name">Bias</span><span class="slider-val" data-bv></span></div>
        <input type="range" data-bias min="-300" max="300" step="5"></div>
        <div class="ctl-row">
          <button class="chip" data-freeze>Freeze at average</button>
          <button class="chip warn" data-silence>Silence</button>
          <button class="chip" data-reset>Reset neuron</button>
        </div>
      </div>`}`;
    wireClose(el);
    if (!isDead) {
      const gi = el.querySelector('[data-gain]');
      gi.oninput = () => { brain.gain[li][ni] = gi.value / 100; edited(); };
      const bi = el.querySelector('[data-bias]');
      bi.oninput = () => { brain.layers[li].b[ni] = brain.original[li].b[ni] + bi.value / 100; edited(); };
      el.querySelector('[data-freeze]').onclick = () => {
        brain.freeze[li][ni] = isNaN(brain.freeze[li][ni]) ? pr.mean : NaN; edited();
      };
      el.querySelector('[data-silence]').onclick = () => { brain.gain[li][ni] = brain.gain[li][ni] === 0 ? 1 : 0; edited(); };
      el.querySelector('[data-reset]').onclick = () => {
        brain.gain[li][ni] = 1; brain.freeze[li][ni] = NaN; brain.layers[li].b[ni] = brain.original[li].b[ni]; edited();
      };
    }
  }
  el.querySelector('[data-meta]').textContent = `fires for ${Math.round(pr.fire * 100)}% of clients · now ${act.toFixed(2)}`;
  if (isDead) return;
  el.querySelector('[data-live]').textContent = `${live >= 0 ? '+' : '−'}${Math.abs(live).toFixed(1)} pts`;
  const gi = el.querySelector('[data-gain]');
  if (document.activeElement !== gi) gi.value = brain.gain[li][ni] * 100;
  gi.style.setProperty('--p', `${(brain.gain[li][ni] / 3) * 100}%`);
  el.querySelector('[data-gv]').textContent = `${Math.round(brain.gain[li][ni] * 100)}%`;
  const bd = brain.layers[li].b[ni] - brain.original[li].b[ni];
  const bi = el.querySelector('[data-bias]');
  if (document.activeElement !== bi) bi.value = bd * 100;
  bi.style.setProperty('--p', `${((bd + 3) / 6) * 100}%`);
  el.querySelector('[data-bv]').textContent = `${bd >= 0 ? '+' : '−'}${Math.abs(bd).toFixed(2)}`;
  el.querySelector('[data-freeze]').classList.toggle('on', !isNaN(brain.freeze[li][ni]));
  el.querySelector('[data-silence]').classList.toggle('on', brain.gain[li][ni] === 0);
  drawField(el, li, ni);
}

// Heatmap of the neuron's activation over the two inputs it is most sensitive to, for this client.
function drawField(el, li, ni) {
  const cv = el.querySelector('[data-field]');
  if (!cv) return;
  const x = brain.encode(state.client);
  const range = FEAT.map((_, j) => {
    let lo = Infinity, hi = -Infinity;
    for (let s = -1; s <= 1.001; s += 0.25) {
      const xx = x.slice(); xx[j] = s;
      const v = brain.forward(xx)[li + 1][ni];
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return hi - lo;
  });
  const order = range.map((r, j) => [r, j]).sort((a, b) => b[0] - a[0]);
  const ja = order[0][1], jb = order[1][1];
  const W = 64, H = 40;
  const img = new ImageData(W, H);
  const vals = new Float32Array(W * H);
  let mx = 1e-6;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const xx = x.slice();
    xx[ja] = -1 + (2 * c) / (W - 1);
    xx[jb] = 1 - (2 * r) / (H - 1);
    const v = brain.forward(xx)[li + 1][ni];
    vals[r * W + c] = v; mx = Math.max(mx, v);
  }
  for (let k = 0; k < W * H; k++) {
    const u = Math.pow(vals[k] / mx, 0.8);
    // ink → ember → amber → cream
    const R = 10 + 245 * Math.min(1, u * 1.4), G = 12 + 200 * Math.max(0, u - 0.25) * 1.2, Bc = 20 + 180 * Math.max(0, u - 0.7) * 2.5;
    img.data[k * 4] = R; img.data[k * 4 + 1] = Math.min(240, G); img.data[k * 4 + 2] = Math.min(220, Bc); img.data[k * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  tmp.getContext('2d').putImageData(img, 0, 0);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, 0, 0, cv.width, cv.height);
  const cx = ((x[ja] + 1) / 2) * cv.width, cy = ((1 - x[jb]) / 2) * cv.height;
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - 12, cy); g.lineTo(cx - 8, cy); g.moveTo(cx + 8, cy); g.lineTo(cx + 12, cy);
  g.moveTo(cx, cy - 12); g.lineTo(cx, cy - 8); g.moveTo(cx, cy + 8); g.lineTo(cx, cy + 12); g.stroke();
  g.font = '500 11px "Geist Mono", monospace';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(`↑ ${SHORT[FEAT[jb]]}`, 8, 16);
  const s = data.features;
  const lo = (j) => FMT[FEAT[j]](fromSlider(FEAT[j], 0)), hi = (j) => FMT[FEAT[j]](fromSlider(FEAT[j], 1));
  el.querySelector('[data-ax]').innerHTML = `<span>${lo(ja)}</span><span>${SHORT[FEAT[ja]]} →</span><span>${hi(ja)}</span>`;
  void s;
}

function inputInspector(el, j, keep) {
  const f = FEAT[j];
  const l0 = brain.layers[0];
  const ws = Array.from({ length: l0.rows }, (_, r) => brain.original[0].W[r * l0.cols + j]);
  const mx = Math.max(...ws.map(Math.abs));
  const pinned = state.pins[j] !== undefined;
  if (!keep) {
    el.innerHTML = `
      <div class="ins-top"><div><div class="sec-label">Input · one of 8 facts</div><div class="ins-name">${SLIDERS[j].name}</div>
      <div class="ins-meta" data-meta></div></div>${closeBtn()}</div>
      <div class="ins-desc">This fact flows into all 24 first-layer neurons. These are the 24 trained weights it feeds, amber for excite and blue for inhibit:</div>
      <div class="wlist">${ws.map((w) => `<i class="${w < 0 ? 'n' : ''}" style="--h:${(Math.abs(w) / mx) * 50}%;--c:${w >= 0 ? 'var(--amber)' : 'var(--ice)'}"></i>`).join('')}</div>
      <div class="ins-desc" style="margin-top:14px">Pinning cuts all 24 connections and folds the value they carried into each neuron's bias. The brain then believes this fact is always the pinned value, whatever the client says. That's 48 weight edits.</div>
      <div class="ctl"><div class="slider"><div class="slider-top"><span class="slider-name">Pin at</span><span class="slider-val" data-pv></span></div>
      <input type="range" data-pin min="0" max="1000" step="1"></div>
      <div class="ctl-row"><button class="chip" data-pinbtn></button></div></div>`;
    wireClose(el);
    const pi = el.querySelector('[data-pin]');
    pi.value = Math.round(toSlider(f, state.client[f]) * 1000);
    pi.oninput = () => {
      el.querySelector('[data-pv]').textContent = FMT[f](fromSlider(f, pi.value / 1000));
      if (state.pins[j] !== undefined) { unpin(j); pin(j, pi.value / 1000 * 2 - 1); edited(); }
    };
    el.querySelector('[data-pinbtn]').onclick = () => {
      if (state.pins[j] !== undefined) unpin(j); else pin(j, pi.value / 1000 * 2 - 1);
      edited();
    };
  }
  const pi = el.querySelector('[data-pin]');
  pi.style.setProperty('--p', `${pi.value / 10}%`);
  el.querySelector('[data-pv]').textContent = FMT[f](fromSlider(f, pi.value / 1000));
  el.querySelector('[data-meta]').textContent = `client: ${FMT[f](state.client[f])}${pinned ? ' · PINNED' : ''}`;
  const b = el.querySelector('[data-pinbtn]');
  b.textContent = pinned ? 'Unpin (restore 24 weights)' : 'Pin this input';
  b.classList.toggle('on', pinned);
}

function pin(j, enc) { state.pins[j] = enc; brain.pinInput(j, enc); }
function unpin(j) {
  const enc = state.pins[j];
  const l = brain.layers[0], o = brain.original[0];
  for (let r = 0; r < l.rows; r++) {
    l.b[r] -= o.W[r * l.cols + j] * enc;
    l.W[r * l.cols + j] = o.W[r * l.cols + j];
  }
  delete state.pins[j];
}

function outputInspector(el, i, keep) {
  const L = brain.layers.length - 1;
  const titles = ['Will the money last?', 'Median legacy', 'Expected years broke'];
  const descs = [
    'The final readout. Twelve judgement neurons vote, and their weighted sum goes through a sigmoid to become a probability. Raising or lowering its bias moves every answer at once.',
    'The median of what\'s left at death, in today\'s dollars. The brain predicts it on a log scale.',
    'The average number of years spent with an empty portfolio, living on guaranteed income alone.',
  ];
  if (!keep) {
    el.innerHTML = `
      <div class="ins-top"><div><div class="sec-label">Output</div><div class="ins-name">${titles[i]}</div>
      <div class="ins-meta">12 incoming weights + 1 bias</div></div>${closeBtn()}</div>
      <div class="ins-desc">${descs[i]}</div>
      <div class="ctl"><div class="slider"><div class="slider-top"><span class="slider-name">Bias</span><span class="slider-val" data-bv></span></div>
      <input type="range" data-bias min="-300" max="300" step="5"></div>
      <div class="ctl-row"><button class="chip" data-reset>Reset</button></div></div>`;
    wireClose(el);
    const bi = el.querySelector('[data-bias]');
    bi.oninput = () => { brain.layers[L].b[i] = brain.original[L].b[i] + bi.value / 100; edited(); };
    el.querySelector('[data-reset]').onclick = () => { brain.layers[L].b[i] = brain.original[L].b[i]; edited(); };
  }
  const bd = brain.layers[L].b[i] - brain.original[L].b[i];
  const bi = el.querySelector('[data-bias]');
  if (document.activeElement !== bi) bi.value = bd * 100;
  bi.style.setProperty('--p', `${((bd + 3) / 6) * 100}%`);
  el.querySelector('[data-bv]').textContent = `${bd >= 0 ? '+' : '−'}${Math.abs(bd).toFixed(2)}`;
}

// ---------- surgery ----------
let measureTimer = null;
function edited() {
  update(false);
  renderEdits();
  clearTimeout(measureTimer);
  measureTimer = setTimeout(checkChallenge, 140);
}

function best(id) { try { return +localStorage.getItem(`gb-best-${id}`) || null; } catch (_) { return null; } }
function setBest(id, v) { try { localStorage.setItem(`gb-best-${id}`, v); } catch (_) {} }

function buildSurgery() {
  const el = $('#surgeryPanel');
  el.innerHTML = `
    <div class="edits"><div><span>Weights edited</span><br><b data-ec>0</b></div><span data-ep></span></div>
    <div class="chal-list" data-list></div>
    <div class="chal" data-card></div>`;
  renderChallengeList();
  renderChallenge();
  renderEdits();
}
function renderChallengeList() {
  $('#surgeryPanel [data-list]').innerHTML = CHALLENGES.map((c, k) => {
    const b = best(c.id);
    return `<button data-id="${c.id}" class="${c.id === state.challenge ? 'on' : ''} ${b ? 'done' : ''}">${c.title}<span>${b ? `✓ ${b} edits` : `par ${c.par}`}</span></button>`;
  }).join('');
  $('#surgeryPanel [data-list]').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { state.challenge = b.dataset.id; state.hintShown = false; renderChallengeList(); renderChallenge(); };
  });
}
function renderChallenge() {
  const c = CHALLENGES.find((x) => x.id === state.challenge);
  const card = $('#surgeryPanel [data-card]');
  card.innerHTML = `<div class="sec-label">Challenge ${CHALLENGES.indexOf(c) + 1} of ${CHALLENGES.length}</div>
    <h3>${c.title}</h3><p>${c.brief}</p><p class="con">${c.constraint}</p>
    <div data-checks></div>
    <div class="hint-text ${state.hintShown ? 'show' : ''}">${c.hint}</div>
    <div class="solved" data-solved><b>Surgery successful</b><span data-sv></span></div>
    <div class="chal-foot"><span class="par">par ${c.par} edits${best(c.id) ? ` · your best ${best(c.id)}` : ''}</span>
    <span><button class="chip" data-hint>Hint</button> <button class="chip warn" data-rs>Reset brain</button></span></div>`;
  card.querySelector('[data-hint]').onclick = () => { state.hintShown = true; card.querySelector('.hint-text').classList.add('show'); };
  card.querySelector('[data-rs]').onclick = () => { brain.reset(); state.pins = {}; edited(); renderInspector(); };
  checkChallenge();
}
function renderEdits() {
  const n = brain.editCount(), t = brain.totalWeights() + brain.layers.reduce((s, l) => s + l.b.length, 0);
  $('#surgeryPanel [data-ec]').textContent = n.toLocaleString();
  $('#surgeryPanel [data-ep]').textContent = `of ${t.toLocaleString()} · ${((n / t) * 100).toFixed(1)}%`;
}
function checkChallenge() {
  if (state.mode !== 'surgery') return;
  const c = CHALLENGES.find((x) => x.id === state.challenge);
  const m = measure(brain, evalSet);
  const rows = c.check(m, base, brain, dead);
  const card = $('#surgeryPanel [data-card]');
  card.querySelector('[data-checks]').innerHTML = rows.map((r) =>
    `<div class="check ${r.ok ? 'ok' : ''}"><i class="dot"></i><span>${r.label}</span><span class="v">${r.value}<small>${r.goal}</small></span></div>`).join('');
  const n = brain.editCount();
  const ok = rows.every((r) => r.ok) && n > 0;
  const sv = card.querySelector('[data-solved]');
  if (ok) {
    const prev = best(c.id);
    if (!prev || n < prev) { setBest(c.id, n); renderChallengeList(); }
    const vs = n < c.par ? `${c.par - n} under par. You beat the search algorithm.` : n === c.par ? 'Exactly par.' : `${n - c.par} over par. Can you do it in fewer?`;
    card.querySelector('[data-sv]').textContent = `${n} weights edited · ${vs}`;
    sv.classList.add('show');
  } else sv.classList.remove('show');
}

// ---------- birth ----------
const birth = { brain: null, pos: 0, playing: false, flat: null };
function buildBirth() {
  birth.brain = new Brain(data);
  const ck = data.checkpoints;
  birth.flat = ck.map((c) => c.layers.map((l) => ({ W: Float32Array.from(l.W.flat()), b: Float32Array.from(l.b) })));
  const r = $('#birthRange');
  r.max = (ck.length - 1) * 100;
  r.oninput = () => { birth.playing = false; $('#birthPlay').classList.remove('on'); setBirth(r.value / 100); };
  $('#birthPlay').onclick = () => {
    birth.playing = !birth.playing;
    if (birth.playing && birth.pos >= ck.length - 1.01) birth.pos = 0;
    $('#birthPlay').classList.toggle('on', birth.playing);
  };
  let last = performance.now();
  const tick = (t) => {
    const dt = (t - last) / 1000; last = t;
    if (birth.playing && state.mode === 'birth') {
      birth.pos = Math.min(ck.length - 1, birth.pos + dt * 4.2);
      if (birth.pos >= ck.length - 1) { birth.playing = false; $('#birthPlay').classList.remove('on'); }
      setBirth(birth.pos);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setBirth(0);
}
function setBirth(pos) {
  const ck = data.checkpoints;
  birth.pos = pos;
  const i = Math.min(ck.length - 2, Math.floor(pos)), u = pos - i;
  const A = birth.flat[i], Bf = birth.flat[i + 1];
  birth.brain.layers.forEach((l, k) => {
    for (let j = 0; j < l.W.length; j++) l.W[j] = A[k].W[j] + (Bf[k].W[j] - A[k].W[j]) * u;
    for (let j = 0; j < l.b.length; j++) l.b[j] = A[k].b[j] + (Bf[k].b[j] - A[k].b[j]) * u;
  });
  const mae = ck[i].mae + (ck[i + 1].mae - ck[i].mae) * u;
  const step = Math.round(ck[i].step + (ck[i + 1].step - ck[i].step) * u);
  $('#birthRange').value = Math.round(pos * 100);
  $('#birthRange').style.setProperty('--p', `${(pos / (ck.length - 1)) * 100}%`);
  $('#birthStep').textContent = `step ${step.toLocaleString()} · ${Math.round((step * 512) / 1000).toLocaleString()}k clients seen`;
  $('#birthErr').textContent = `off by ${(mae * 100).toFixed(1)} pts`;
  const [t, s] = mae > 0.25 ? ['Static', 'random weights, random opinions']
    : mae > 0.12 ? ['First instinct', 'more money, more safety']
    : mae > 0.05 ? ['Finding the ratio', 'spending against savings']
    : mae > 0.02 ? ['Learning to fear', 'crashes, longevity, pensions']
    : ['Wisdom', 'within a point of the truth'];
  $('#birthPhase').innerHTML = `${t} <small>· ${s}</small>`;
  drawLoss(pos);
  if (state.mode === 'birth') update(false);
}
function drawLoss(pos) {
  const cv = $('#lossCanvas');
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ck = data.checkpoints;
  const lo = Math.log(0.008), hi = Math.log(Math.max(...ck.map((c) => c.mae)));
  const X = (k) => (k / (ck.length - 1)) * r.width;
  const Y = (m) => 4 + (r.height - 8) * (1 - (Math.log(m) - lo) / (hi - lo));
  g.beginPath();
  ck.forEach((c, k) => (k ? g.lineTo(X(k), Y(c.mae)) : g.moveTo(X(k), Y(c.mae))));
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.2; g.stroke();
  g.save(); g.beginPath(); g.rect(0, 0, X(pos), r.height); g.clip();
  g.beginPath();
  ck.forEach((c, k) => (k ? g.lineTo(X(k), Y(c.mae)) : g.moveTo(X(k), Y(c.mae))));
  g.strokeStyle = '#ffb04a'; g.lineWidth = 1.6; g.shadowColor = '#ffb04a'; g.shadowBlur = 8; g.stroke();
  g.restore();
}

// ---------- tax brain (loaded on first visit) ----------
let taxTab = null;
async function openTax() {
  if (!taxTab) {
    const d = await fetch('data/taxbrain.json').then((r) => r.json());
    checkProvenance([{ label: 'The Tax Brain', data: d }]);
    taxTab = new TaxTab({ left: $('#taxLeft'), right: $('#taxRight'), chart: $('#taxChart'), net: $('#taxNet') }, d);
  }
  if (state.mode === 'tax') taxTab.activate();
}

async function attachEngineToBook() {
  if (book.mg) return;
  const [{ MGBrain }, M, { makePlan }, d] = await Promise.all([import('./mgbrain.js'), import('./vendor/moneyguide.js'), import('./mgplan.js'), fetch('data/mgbrain.json').then((r) => r.json())]);
  checkProvenance([{ label: 'The Engine Brain', data: d }]);
  book.setEngine(new MGBrain(d), (f) => M.simulate(makePlan(M, f), { trials: 500, lite: true }).probability);
  if (state.mode === 'book') book.renderStats(true);
}
async function openEngineClient(f) {
  setMode('mg');
  await openMG();
  mgTab.f = { ...f }; mgTab.sync(); mgTab.update(true);
}

let mgTab = null;
let labTab = null;
let finder = null;
async function openFinder() {
  if (!finder) {
    const [policy, history] = await Promise.all(['rothpolicy', 'history'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())));
    checkProvenance([{ label: 'Roth Autopilot', data: policy }]);
    finder = new Finder({ left: $('#finderLeft'), right: $('#finderRight'), chart: $('#finderChart') }, { policy, history });
  }
  if (state.mode === 'finder') finder.activate();
}
async function openMG() {
  if (!mgTab) {
    const d = await fetch('data/mgbrain.json').then((r) => r.json());
    checkProvenance([{ label: 'The Engine Brain', data: d }]);
    mgTab = new MGTab({ left: $('#mgLeft'), right: $('#mgRight'), chart: $('#mgChart') }, d);
  }
  if (state.mode === 'mg') mgTab.activate();
}

// ---------- modes ----------
function buildModes() {
  document.querySelectorAll('#modes button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
}
// One plain sentence per experiment, shown under the tabs.
function modeCaption(m) {
  return {
  think: 'A small brain that learned to judge retirement plans. Each dot is a neuron: move a slider on the left and watch which ones light up, and what it decides on the right.',
  birth: 'Press play and watch the brain go from random guesses to expert answers as it studies 102 million practice retirements.',
  surgery: 'Switch neurons off and see if it still gets the answer right. That is how we know it learned real ideas, not tricks.',
  book: 'The same brain judging 4,000 families at once, in a blink. Drag the market and watch every one of them move.',
  tax: 'A second brain learned 2026 tax law from 3 million returns. Its bends land on the real tax brackets, within a few dollars.',
  mg: 'A third brain learned the whole planning engine: taxes, Social Security, Medicare. It is checked live against the real thing.',
  lab: 'Try Roth conversions on a family and see what they save in taxes, year by year.',
  finder: 'The brain scans a whole book of clients for money left on the table, in about ten seconds.',
  }[m] || '';
}
function setMode(m) {
  state.mode = m;
  if ($('#modeCap')) $('#modeCap').textContent = modeCaption(m);
  document.body.dataset.mode = m;
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  if (m === 'birth') {
    select(null);
    $('.verdict-label').textContent = 'The newborn brain says';
    setBirth(birth.pos);
    if (birth.pos === 0) setTimeout(() => { birth.playing = true; $('#birthPlay').classList.add('on'); }, 500);
  } else {
    birth.playing = false;
    $('#birthPlay').classList.remove('on');
    $('.verdict-label').textContent = 'The brain says';
  }
  if (m === 'book') { book.activate(); attachEngineToBook(); } else book.deactivate();
  if (m === 'tax') openTax(); else if (taxTab) taxTab.deactivate();
  if (m === 'mg') openMG(); else if (mgTab) mgTab.deactivate();
  if (m === 'finder') openFinder(); else if (finder) finder.deactivate();
  if (m === 'lab') { labTab = labTab || new LabTab({ left: $('#labLeft'), right: $('#labRight'), chart: $('#labChart') }); labTab.activate(); } else if (labTab) labTab.deactivate();
  if (m === 'surgery') { renderChallenge(); renderEdits(); }
  requestAnimationFrame(() => { view.resize(); update(false); drawLoss(birth.pos); });
}

// ---------- the tour: the app drives itself ----------
const tour = { on: false, run: 0, skip: false };
const sleep = (ms, id) => new Promise((res) => {
  const t0 = performance.now();
  const tick = () => {
    if (tour.run !== id) return res(false);
    if (tour.skip) { tour.skip = false; return res('skip'); }
    if (performance.now() - t0 >= ms) return res(true);
    setTimeout(tick, 40);
  };
  tick();
});
function tween(ms, id, fn) {
  return new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      if (tour.run !== id) return res(false);
      const u = tour.skip ? 1 : Math.min(1, (performance.now() - t0) / ms), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      fn(e);
      if (u < 1) setTimeout(tick, 16); else res(true);
    };
    tick();
  });
}
function spot(sel) {
  document.querySelectorAll('.spot').forEach((e) => e.classList.remove('spot'));
  if (sel) document.querySelectorAll(sel).forEach((e) => e.classList.add('spot'));
}
function caption(i, n, html) {
  $('#tourText').innerHTML = html;
  $('#tourText').classList.remove('in'); void $('#tourText').offsetWidth; $('#tourText').classList.add('in');
  $('#tourStep').textContent = `${i} / ${n}`;
  $('#tourProg').style.width = `${(i / n) * 100}%`;
}
function endTour() {
  tour.on = false; tour.run++;
  $('#tour').hidden = true;
  spot(null);
  document.body.classList.remove('touring');
}
async function startTour() {
  const id = ++tour.run;
  tour.on = true; tour.skip = false;
  $('#tour').hidden = false;
  document.body.classList.add('touring');
  brain.reset(); state.pins = {};
  const base4 = PRESETS[0][1];
  const N = 21;
  const steps = [
    async () => {
      setMode('think'); select(null); state.client = { ...base4 }; update(true);
      caption(1, N, 'This is a neural network: about <b>1,100 connections</b>. Nobody ever taught it a single rule about retirement.');
      return sleep(6500, id);
    },
    async () => {
      caption(2, N, 'It learned by watching <b>102 million simulated retirements</b>. Every pulse you see is real signal moving through a real trained weight.');
      return sleep(6500, id);
    },
    async () => {
      spot('.verdict');
      caption(3, N, 'A 65-year-old with $1M, spending $60k. The brain says <b>97%</b>. A full Monte Carlo agrees, but the brain answered <b>thousands of times faster</b>.');
      return sleep(7500, id);
    },
    async () => {
      spot('#sliders .slider:nth-child(6)');
      caption(4, N, 'Now crash the market in their first five years.');
      const from = state.client.early;
      await tween(2600, id, (e) => { state.client.early = from + (-0.09 - from) * e; update(false); });
      update(true);
      return sleep(1800, id);
    },
    async () => {
      spot('#thought');
      caption(5, N, 'It drops to <b>69%</b>, and it can say <i>why</i>. It traces the damage to one specific neuron inside itself.');
      return sleep(7500, id);
    },
    async () => {
      spot(null);
      select({ L: 1, i: 15 });
      caption(6, N, 'Nobody programmed this neuron. During training it <b>invented a fear of early crashes</b> on its own. The heatmap shows what makes it fire.');
      return sleep(8500, id);
    },
    async () => {
      select(null); setMode('birth');
      birth.pos = 0; setBirth(0); birth.playing = true; $('#birthPlay').classList.add('on');
      caption(7, N, 'It wasn\'t born knowing any of this. Here\'s its whole education, from random static to expert, in about fifteen seconds.');
      const t0 = performance.now();
      while (birth.playing && tour.run === id && performance.now() - t0 < 16000) {
        if ((await sleep(200, id)) === 'skip') { birth.playing = false; $('#birthPlay').classList.remove('on'); setBirth(data.checkpoints.length - 1); return true; }
      }
      return sleep(1500, id);
    },
    async () => {
      setMode('surgery'); state.challenge = 'fearless'; renderChallengeList(); renderChallenge();
      spot('#surgeryPanel');
      caption(8, N, 'Because it\'s made of glass, you can <b>operate on it</b>. Cut one input, 48 weights out of 1,155, and it forgets that crashes exist.');
      await sleep(3000, id);
      select({ L: 0, i: 5 });
      pin(5, brain.encode({ ...state.client, early: 0.065 })[5]); edited(); renderInspector();
      await sleep(5500, id);
      brain.reset(); state.pins = {}; edited(); select(null);
      return true;
    },
    async () => {
      spot(null); setMode('book'); book.setShock(0.065);
      caption(9, N, 'And because it thinks in microseconds, it can watch an advisor\'s <b>entire book</b> at once: 4,000 families. Watch what a crash does.');
      await sleep(3500, id);
      await tween(3500, id, (e) => book.setShock(0.065 + (-0.09 - 0.065) * e));
      return sleep(2500, id);
    },
    async () => {
      spot('#bookCalls');
      caption(10, N, 'Every family that needs a call this week, and the smallest change that fixes each plan. All of it scored in about <b>20 milliseconds</b>.');
      await sleep(8000, id);
      book.setShock(0.065);
      return true;
    },
    async () => {
      spot(null); setMode('tax'); await openTax();
      caption(11, N, 'Brain #2 learned the <b>US tax code</b> from 3 million returns computed by a real planning engine. White is the law. Amber is the brain.');
      return sleep(8000, id);
    },
    async () => {
      spot('#taxRight .kt');
      caption(12, N, 'Every amber bend is one neuron. Read its weights and you get a dollar amount, and they land on the law\'s real bracket edges. The 24%→32% edge: <b>$3 off</b>.');
      return sleep(8500, id);
    },
    async () => {
      spot('#taxNet');
      caption(13, N, 'Then we wrote a brain by hand, straight from the statute: <b>40 neurons, exact to the penny</b> on a million returns. No training at all.');
      return sleep(8000, id);
    },
    async () => {
      spot('#taxLeft [data-diff]');
      document.querySelector('#taxLeft [data-y="2025"]')?.click();
      caption(14, N, 'So a change in the law is a change in the weights. Congress\'s entire 2025 → 2026 update: <b>11 edits</b>.');
      await sleep(8000, id);
      document.querySelector('#taxLeft [data-y="2026"]')?.click();
      return true;
    },
    async () => {
      spot(null); setMode('mg'); await openMG();
      caption(15, N, 'Brain #3 learned the <b>entire planning engine</b>, with taxes, RMDs, IRMAA and Social Security, from 60,000 real plans. White dots: the engine itself. Amber: the brain, over a thousand times faster.');
      return sleep(10000, id);
    },
    async () => {
      spot('#mgRight .xr');
      caption(16, N, 'Ask it what a dollar is worth in an IRA versus a Roth. It worked out the tax drag on its own, and the engine lands <b>within a cent or two</b>.');
      return sleep(8500, id);
    },
    async () => {
      spot(null); setMode('lab');
      caption(17, N, 'And since the tax code is now a neural network, you can do <b>calculus on it</b>. Gradient descent finds a Roth conversion plan that beats every rule of thumb.');
      return sleep(10000, id);
    },
    async () => {
      spot(null); setMode('finder'); await openFinder();
      caption(18, N, 'Then a brain learned from <b>40,000 exact solutions</b>. Roth Autopilot writes a near-optimal plan in 0.2 ms, so it can scan an entire book. Watch it find the money.');
      return sleep(14000, id);
    },
    async () => {
      spot('#finderLeft .stat');
      caption(19, N, 'Every dot is a family. Across: how many standard deviations of bad markets it takes to break the plan, borrowed from how engineers test bridges. Up: the tax a Roth plan saves.');
      return sleep(9000, id);
    },
    async () => {
      spot(null);
      const first = finder.hh.filter((h) => h.done && h.beta < 1.5).sort((a, b) => b.found - a.found)[0];
      if (first) finder.select(first);
      caption(20, N, 'Click a family to see the <b>exact market that would break them</b>, every real era since 1928 measured against it, and a call brief ready to paste.');
      return sleep(10000, id);
    },
    async () => {
      if (finder) finder.select(null);
      spot(null); setMode('think'); state.client = { ...base4 }; update(true);
      caption(21, N, 'Glass Brain: AI you can read, operate on, audit, write by hand, and put to work on every client. <b>Your turn.</b>');
      return sleep(6000, id);
    },
  ];
  for (const step of steps) {
    if (tour.run !== id) return;
    await step();
  }
  if (tour.run === id) { setMode('think'); state.client = { ...base4 }; update(true); endTour(); }
}

boot();
