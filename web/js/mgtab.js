// Tab 06: the MoneyGuide Brain, a neural surrogate of the real MoneyGuide planning engine, checked live against it.
import { MGBrain } from './mgbrain.js';
import { makePlan, FEATURES } from './mgplan.js';
import * as M from './vendor/moneyguide.js';

const $ = (s, r = document) => r.querySelector(s);
const k$ = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}k`);
const PORTF = ['', 'Conservative', 'Mod. conservative', 'Moderate', 'Mod. aggressive', 'Aggressive', 'All equity'];
const LABEL = {
  age: ['Client age', (v) => `${Math.round(v)}`], spouseGap: ['Spouse age', (v, f) => `${Math.round(f.age + v)}`],
  ira: ['Traditional IRA', k$], roth: ['Roth IRA', k$], taxable: ['Taxable brokerage', k$],
  spending: ['Spending goal', (v) => `${k$(v)}/yr`], pia: ['Social Security at FRA', (v) => `$${Math.round(v).toLocaleString()}/mo`],
  claimAge: ['Claims at', (v) => `${Math.round(v)}`], portfolio: ['Portfolio', (v) => PORTF[Math.round(v)] || ''],
  stateRate: ['State income tax', (v) => `${(v * 100).toFixed(1)}%`],
};
const STEP = { age: 1, spouseGap: 1, ira: 10000, roth: 10000, taxable: 10000, spending: 1000, pia: 50, claimAge: 1, portfolio: 1, stateRate: 0.001 };
const PRESETS = [
  ['Retiring at 62', { age: 62, spouseGap: -1, ira: 900_000, roth: 100_000, taxable: 200_000, spending: 90_000, pia: 2600, claimAge: 62, portfolio: 3, stateRate: 0 }],
  ['The Chens', { age: 66, spouseGap: -2, ira: 2_070_000, roth: 180_000, taxable: 640_000, spending: 175_000, pia: 3800, claimAge: 70, portfolio: 3, stateRate: 0.093 }],
  ['All in the IRA', { age: 65, spouseGap: -2, ira: 1_800_000, roth: 0, taxable: 0, spending: 95_000, pia: 2900, claimAge: 67, portfolio: 3, stateRate: 0.05 }],
  ['Roth-rich', { age: 65, spouseGap: -2, ira: 300_000, roth: 1_200_000, taxable: 300_000, spending: 95_000, pia: 2900, claimAge: 67, portfolio: 3, stateRate: 0.05 }],
];

function engineP(f, trials = 500) {
  return M.simulate(makePlan(M, f), { trials, lite: true });
}

export class MGTab {
  constructor(els, data) {
    this.els = els;
    this.brain = new MGBrain(data);
    this.stats = data.stats;
    this.f = { ...PRESETS[0][1] };
    this.c = els.chart; this.g = this.c.getContext('2d');
    this.job = 0;
    new ResizeObserver(() => this.resize()).observe(this.c.parentElement);
    this.buildLeft();
    this.update(true);
  }
  activate() { this.active = true; this.resize(); }
  deactivate() { this.active = false; }

  buildLeft() {
    const L = this.els.left;
    L.innerHTML = `<div class="panel-head"><h2>The household</h2><p>A retired couple, run through the <b>real MoneyGuide engine</b>: 2026 tax law, RMDs, IRMAA, Social Security rules.</p></div>
      <div class="presets">${PRESETS.map(([n], i) => `<button data-p="${i}">${n}</button>`).join('')}</div><div data-sliders></div>`;
    L.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { this.f = { ...PRESETS[+b.dataset.p][1] }; this.sync(); this.update(true); }; });
    const wrap = $('[data-sliders]', L);
    this.sl = {};
    FEATURES.forEach(([k, lo, hi]) => {
      const d = document.createElement('div');
      d.className = 'slider';
      d.innerHTML = `<div class="slider-top"><span class="slider-name">${LABEL[k][0]}</span><span class="slider-val"></span></div><input type="range" min="${lo}" max="${hi}" step="${STEP[k]}">`;
      const inp = $('input', d);
      inp.oninput = () => { this.f[k] = +inp.value; this.sync(); this.update(false); };
      inp.onchange = () => this.update(true);
      this.sl[k] = { inp, val: $('.slider-val', d), lo, hi };
      wrap.appendChild(d);
    });
    this.sync();
  }
  sync() {
    for (const [k, s] of Object.entries(this.sl)) {
      if (document.activeElement !== s.inp) s.inp.value = this.f[k];
      s.inp.style.setProperty('--p', `${((this.f[k] - s.lo) / (s.hi - s.lo)) * 100}%`);
      s.val.textContent = LABEL[k][1](this.f[k], this.f);
    }
  }

  // ---- the brain answers instantly; the engine catches up in the background ----
  update(full) {
    const f = this.f;
    const t0 = performance.now();
    let p = 0;
    for (let i = 0; i < 100; i++) p = this.brain.success(f);
    this.brainUs = ((performance.now() - t0) / 100) * 1000;
    this.p = p;
    // brain curves
    this.claimCurve = [];
    for (let a = 62; a <= 70.001; a += 0.25) this.claimCurve.push([a, this.brain.success({ ...f, claimAge: a })]);
    this.spendCurve = [];
    for (let s = 40000; s <= 220000; s += 2000) this.spendCurve.push([s, this.brain.success({ ...f, spending: s })]);
    this.values = this.dollarValues((x) => this.brain.success(x), (x) => this.brain.legacy(x));
    this.path = this.gentlest();
    this.pathEngine = null;
    this.renderRight();
    this.draw();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.runEngine(), full ? 0 : 250);
  }

  // The gentlest path into the confidence zone: try every claim age and portfolio, bisect spending for each,
  // and keep the plan with the least total "pain". Hundreds of plans, searched on the brain in milliseconds.
  gentlest(target = 85) {
    const f = this.f, P = (x) => this.brain.success(x);
    if (P(f) >= target) return { already: true };
    const t0 = performance.now();
    let best = null, tried = 0;
    const all = [];
    const ages = []; for (let a = Math.max(Math.round(f.claimAge), Math.round(f.age)); a <= 70; a++) ages.push(a);
    const ports = [f.portfolio - 1, f.portfolio, f.portfolio + 1, f.portfolio + 2].filter((x) => x >= 1 && x <= 6);
    for (const claimAge of ages) for (const portfolio of ports) {
      const g = { ...f, claimAge, portfolio };
      let lo = 0, hi = f.spending - 40000;
      tried += 2;
      if (P({ ...g, spending: f.spending - hi }) < target) continue;
      if (P(g) >= target) hi = 0;
      for (let i = 0; i < 18 && hi > 0; i++) { const m = (lo + hi) / 2; tried++; if (P({ ...g, spending: f.spending - m }) >= target) hi = m; else lo = m; }
      const cut = Math.ceil(hi / 500) * 500;
      const pain = cut / 1000 + 2.5 * (claimAge - Math.round(f.claimAge)) + 4 * Math.abs(portfolio - f.portfolio);
      const cand = { claimAge, portfolio, cut, pain, plan: { ...g, spending: f.spending - cut } };
      all.push(cand);
      if (!best || pain < best.pain) best = cand;
    }
    // alternatives: the next-gentlest plans that use a different mix of levers
    const sig = (c) => `${c.cut > 0}${c.claimAge !== Math.round(f.claimAge)}${c.portfolio !== f.portfolio}`;
    const alts = [];
    // keep only trades: plans that need a smaller spending cut by pulling a different lever
    all.filter((c) => best && c.cut < best.cut - 1000 && sig(c) !== sig(best))
      .sort((a, b) => a.pain - b.pain)
      .forEach((c) => { if (!alts.some((x) => sig(x) === sig(c)) && alts.length < 2) alts.push(c); });
    return best ? { ...best, alts, tried, ms: performance.now() - t0, p: P(best.plan) } : { impossible: true, tried, ms: performance.now() - t0 };
  }

  dollarValues(P, Leg) {
    const f = this.f, add = 100_000;
    const out = {};
    for (const k of ['ira', 'roth', 'taxable']) {
      const g = { ...f, [k]: f[k] + add };
      out[k] = { dp: P(g) - P(f), dl: Leg ? Leg(g) - Leg(f) : null };
    }
    return out;
  }

  async runEngine() {
    const id = ++this.job, f = { ...this.f };
    const yieldNow = () => new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();
    const r = engineP(f);
    this.engineMs = performance.now() - t0;
    if (id !== this.job) return;
    this.engine = { p: r.probability, legacy: r.afterTaxLegacy };
    if (this.path && this.path.plan) { this.pathEngine = engineP(this.path.plan).probability; }
    this.engineClaim = []; this.engineSpend = []; this.engineValues = null;
    this.renderRight(); this.draw();
    for (let a = 62; a <= 70; a++) {
      await yieldNow(); if (id !== this.job) return;
      if (a < Math.round(f.age)) continue;
      this.engineClaim.push([a, engineP({ ...f, claimAge: a }).probability]); this.draw();
    }
    for (let s = 40000; s <= 220000; s += 15000) {
      await yieldNow(); if (id !== this.job) return;
      this.engineSpend.push([s, engineP({ ...f, spending: s }).probability]); this.draw();
    }
    await yieldNow(); if (id !== this.job) return;
    const cache = new Map();
    const E = (x) => { const key = JSON.stringify(x); if (!cache.has(key)) { const rr = engineP(x); cache.set(key, rr); } return cache.get(key); };
    this.engineValues = this.dollarValues((x) => E(x).probability, (x) => E(x).afterTaxLegacy);
    this.renderRight();
  }

  renderRight() {
    this._renderRight();
    const b = this.els.right.querySelector('[data-apply]');
    if (b) b.onclick = () => { this.f = { ...this.path.plan }; this.sync(); this.update(true); };
  }

  _renderRight() {
    const R = this.els.right, v = this.values, ev = this.engineValues;
    const e = this.engine;
    const rate = (vals, k, key) => (Math.abs(vals.roth[key]) > (key === 'dp' ? 0.4 : 1000) ? vals[k][key] / vals.roth[key] : null);
    const useLegacy = Math.abs(v.roth.dp) < 0.4;
    const key = useLegacy ? 'dl' : 'dp';
    const row = (k, name) => {
      const b = rate(v, k, key), en = ev ? rate(ev, k, key) : null;
      return `<tr><td>${name}</td><td>${b === null ? '—' : `$${b.toFixed(2)}`}</td><td>${en === null ? (ev ? '—' : '<i class="spin"></i>') : `$${en.toFixed(2)}`}</td></tr>`;
    };
    R.innerHTML = `
      <div class="verdict-label">The MoneyGuide Brain says</div>
      <div class="verdict-big"><span>${this.p.toFixed(0)}</span><small>%</small></div>
      <div class="verdict-cap">probability of success, in MoneyGuide's own terms</div>
      <div class="truth">
        <div class="truth-row"><span>The real engine (500 trials)</span><b>${e ? `${e.p.toFixed(0)}%` : '…'}</b></div>
        <div class="truth-row"><span>Brain vs. engine</span><b class="${e && Math.abs(this.p - e.p) < 4 ? 'ok' : ''}">${e ? `${this.p - e.p >= 0 ? '+' : '−'}${Math.abs(this.p - e.p).toFixed(1)} pts` : '…'}</b></div>
        <div class="truth-row"><span>Speed</span><b>${this.brainUs.toFixed(0)} µs vs ${this.engineMs ? `${this.engineMs.toFixed(0)} ms` : '…'}${this.engineMs ? ` (${Math.round((this.engineMs * 1000) / this.brainUs).toLocaleString()}×)` : ''}</b></div>
      </div>
      ${this.pathHtml()}
      <div class="xr">
        <div class="sec-label">What is a dollar worth, by account?</div>
        <p class="sec-sub">${useLegacy ? 'success is maxed out here, so measured in after-tax legacy' : `measured in plan success · add $100k to each`} · in Roth dollars</p>
        <table class="kt xr-t"><thead><tr><th>$1 in…</th><th>Brain</th><th>Engine</th></tr></thead><tbody>
        ${row('roth', 'Roth IRA')}${row('taxable', 'Taxable brokerage')}${row('ira', 'Traditional IRA')}</tbody></table>
        <p class="xr-note">${this.xrSentence(v, key)}</p>
      </div>
      <div class="tx-card"><div class="sec-label">How it was made</div><p>${this.stats.plans.toLocaleString()} plans built on MoneyGuide's own sample household and run through the real engine, ${this.stats.trials} Monte Carlo trials each, across 7 CPU cores. Then a 10→64→64→32 network learned the whole engine. Average error on plans it never saw: <b>${this.stats.testMAE.toFixed(1)} pts</b>.</p></div>`;
  }

  pathHtml() {
    const P = this.path;
    if (!P) return '';
    if (P.already) return `<div class="gp ok"><div class="sec-label">Confidence zone</div><p>Already at 85% or better. Nothing to change.</p></div>`;
    if (P.impossible) return `<div class="gp"><div class="sec-label">Gentlest path to 85%</div><p>No mix of spending, claim age, and portfolio gets there. This needs a bigger conversation.</p></div>`;
    const describe = (c) => {
      const ch = [];
      if (c.cut > 0) ch.push(`Spend <b>${k$(c.cut)}/yr less</b>`);
      if (c.claimAge !== Math.round(this.f.claimAge)) ch.push(`Claim Social Security at <b>${c.claimAge}</b>`);
      if (c.portfolio !== this.f.portfolio) ch.push(`Move to <b>${PORTF[c.portfolio].toLowerCase()}</b>`);
      return ch;
    };
    const ch = describe(P);
    const alts = (P.alts || []).map((c) => `<div class="gp-alt">or: ${describe(c).join(' + ')}</div>`).join('');
    return `<div class="gp"><div class="sec-label">Gentlest path to 85%</div>
      <ul>${ch.map((c) => `<li>${c}</li>`).join('')}</ul>${alts}
      <div class="gp-row"><span>Brain</span><b>${P.p.toFixed(0)}%</b><span>Real engine confirms</span><b class="${this.pathEngine !== null && this.pathEngine >= 82 ? 'ok' : ''}">${this.pathEngine === null ? '<i class="spin"></i>' : `${this.pathEngine.toFixed(0)}%`}</b></div>
      <p class="gp-foot">${P.tried.toLocaleString()} candidate plans searched on the brain in ${P.ms.toFixed(0)} ms. The engine would need about ${Math.round((P.tried * (this.engineMs || 60)) / 1000)} s.</p>
      <button class="chip" data-apply>Apply this plan</button></div>`;
  }

  xrSentence(v, key) {
    const r = v.roth[key];
    if (Math.abs(r) < (key === 'dp' ? 0.4 : 1000)) return 'This plan is insensitive to another $100k here.';
    const ira = v.ira[key] / r, tx = v.taxable[key] / r;
    return `The brain has learned that, for this couple, a dollar in the traditional IRA is worth about <b>${Math.round(ira * 100)}¢</b> of a Roth dollar: the taxes still owed on it, at their bracket, plus RMDs and state tax. Nobody told it that pre-tax money is taxed. It worked it out from the engine.`;
  }

  resize() {
    const p = this.c.parentElement.getBoundingClientRect();
    if (!p.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = p.width; this.h = p.height;
    this.c.width = p.width * dpr; this.c.height = p.height * dpr; this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    if (!this.active || !this.w) return;
    const g = this.g, W = this.w, H = this.h;
    g.clearRect(0, 0, W, H);
    const half = H / 2;
    this.plot(0, half, 'When should they claim Social Security?', 'BRAIN: A CONTINUOUS CURVE IN MICROSECONDS · ENGINE: ONE 500-TRIAL RUN PER DOT',
      62, 70, (a) => `${a}`, this.claimCurve, this.engineClaim, this.f.claimAge);
    this.plot(half, H, 'How much can they spend?', 'SUCCESS VS. ANNUAL SPENDING GOAL', 40000, 220000, (s) => k$(s), this.spendCurve, this.engineSpend, this.f.spending);
  }

  plot(y0, y1, title, sub, lo, hi, fmt, curve, dots, cur) {
    const g = this.g, W = this.w, padL = 52, padR = 26, padT = y0 + 70, padB = y1 - 34;
    const X = (v) => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);
    const Y = (p) => padT + (1 - p / 100) * (padB - padT);
    g.textAlign = 'left';
    g.font = 'italic 400 22px "Instrument Serif", serif'; g.fillStyle = '#ece7dc'; g.fillText(title, 20, y0 + 32);
    g.font = '400 10px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.42)'; g.fillText(W > 720 ? sub : sub.split(' · ')[0], 20, y0 + 50);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.fillStyle = 'rgba(255,255,255,0.32)'; g.textAlign = 'right';
    for (const p of [0, 25, 50, 75, 100]) { g.beginPath(); g.moveTo(padL, Y(p)); g.lineTo(W - padR, Y(p)); g.stroke(); g.fillText(`${p}%`, padL - 8, Y(p) + 3); }
    g.textAlign = 'center';
    const ticks = hi - lo <= 10 ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [40000, 80000, 120000, 160000, 200000];
    ticks.forEach((t) => g.fillText(fmt(t), X(t), padB + 18));
    // confidence zone 75–90
    g.fillStyle = 'rgba(159,230,184,0.05)'; g.fillRect(padL, Y(90), W - padL - padR, Y(75) - Y(90));
    // brain curve
    g.beginPath(); curve.forEach(([x, p], i) => (i ? g.lineTo(X(x), Y(p)) : g.moveTo(X(x), Y(p))));
    g.strokeStyle = '#ffb04a'; g.lineWidth = 2.2; g.shadowColor = '#ffb04a'; g.shadowBlur = 12; g.stroke(); g.shadowBlur = 0;
    // engine dots
    (dots || []).forEach(([x, p]) => { g.beginPath(); g.arc(X(x), Y(p), 4.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#06070b'; g.lineWidth = 1.5; g.stroke(); });
    // cursor
    g.setLineDash([2, 4]); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.moveTo(X(cur), padT); g.lineTo(X(cur), padB); g.stroke(); g.setLineDash([]);
    // legend
    const ly = W > 720 ? y0 + 32 : y0 + 64;
    g.textAlign = 'right'; g.font = '400 10.5px Geist, sans-serif';
    g.fillStyle = '#ffb04a'; g.fillRect(W - padR - 190, ly - 4, 14, 2); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText('MoneyGuide Brain', W - padR - 100, ly);
    g.beginPath(); g.arc(W - padR - 86, ly - 3, 3.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText('real engine', W - padR, ly);
  }
}
