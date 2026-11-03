// Tab 07: Roth Lab. Gradient descent through the compiled tax code, animated, against the rules of thumb.
import { makeModel, run, optimize, fillBracket } from './roth.js';
import { engineTax, engineIrmaa, LAW } from './taxread.js';

const $ = (s, r = document) => r.querySelector(s);
const k$ = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}k`);
const $$ = (v) => `$${Math.round(v).toLocaleString()}`;

const INPUTS = [
  ['age', 'Age today (both)', 60, 74, 1, (v) => `${v}`],
  ['ira', 'Traditional IRA', 200000, 5000000, 10000, k$],
  ['ss', 'Social Security (couple)', 0, 100000, 1000, (v) => `${k$(v)}/yr`],
  ['other', 'Pension & other income', 0, 150000, 1000, (v) => `${k$(v)}/yr`],
  ['growth', 'Growth after inflation', 0, 0.08, 0.005, (v) => `${(v * 100).toFixed(1)}%`],
  ['heirRate', "Heirs' tax rate on inherited IRA", 0, 0.45, 0.01, (v) => `${Math.round(v * 100)}%`],
];
const STRATS = [['none', 'No conversions'], [0.12, 'Fill 12% bracket'], [0.22, 'Fill 22% bracket'], [0.24, 'Fill 24% bracket']];

export class LabTab {
  constructor(els) {
    this.els = els;
    this.p = { age: 65, ira: 2_000_000, ss: 60000, other: 0, growth: 0.05, heirRate: 0.24, years: 30, rmdAge: 75, irmaa: true };
    this.c = els.chart; this.g = this.c.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(this.c.parentElement);
    this.buildLeft();
    this.setup();
  }
  activate() { this.active = true; this.resize(); if (!this.ran) this.descend(); }
  deactivate() { this.active = false; this.stop = true; }

  buildLeft() {
    const L = this.els.left;
    L.innerHTML = `<div class="panel-head"><h2>Roth Lab</h2><p>A married couple, both the same age, 2026 law held constant in today's dollars. RMDs start at 75. Each year's conversion is a dial, and the tax code is a neural network, so we can <b>descend the gradient</b>.</p></div>
      <div data-in></div><label class="check-row"><input type="checkbox" data-irmaa checked> Count Medicare IRMAA surcharges</label>
      <button class="cta" data-go style="width:100%;margin-top:14px">▶ Descend the gradient</button>
      <div class="lab-how"><div class="sec-label">How it works</div>
      <p>Lifetime cost = federal tax every year + IRMAA + the tax heirs pay on the IRA left at the end. The gradient for a conversion in year <i>t</i> is <b>today's marginal rate</b>, from backprop through the 40-neuron tax network, minus <b>tomorrow's</b>: the RMD taxes and heir taxes that dollar would have triggered, carried back by an adjoint. It converts until those balance.</p></div>`;
    const wrap = $('[data-in]', L);
    this.sl = {};
    INPUTS.forEach(([k, name, lo, hi, step, fmt]) => {
      const d = document.createElement('div');
      d.className = 'slider';
      d.innerHTML = `<div class="slider-top"><span class="slider-name">${name}</span><span class="slider-val"></span></div><input type="range" min="${lo}" max="${hi}" step="${step}" value="${this.p[k]}">`;
      const inp = $('input', d), val = $('.slider-val', d);
      const sync = () => { val.textContent = fmt(this.p[k]); inp.style.setProperty('--p', `${((this.p[k] - lo) / (hi - lo)) * 100}%`); };
      inp.oninput = () => { this.p[k] = +inp.value; if (k === 'age') this.p.years = 95 - this.p.age; sync(); this.setup(); this.draw(); };
      inp.onchange = () => this.descend();
      sync();
      wrap.appendChild(d);
    });
    $('[data-irmaa]', L).onchange = (e) => { this.p.irmaa = e.target.checked; this.setup(); this.descend(); };
    $('[data-go]', L).onclick = () => this.descend();
  }

  setup() {
    this.model = makeModel(this.p);
    const zero = new Array(this.p.years).fill(0);
    this.results = STRATS.map(([key, name]) => {
      const conv = key === 'none' ? zero : fillBracket(this.model, key);
      return { key, name, conv, r: run(this.model, conv) };
    });
    this.conv = zero;
    this.cur = run(this.model, zero);
    this.history = [];
    this.best = null;
    // income levels where the brackets top out and IRMAA tiers start, for this Social Security amount
    const ordFor = (pred) => { let lo = 0, hi = 1_000_000; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (pred(m)) hi = m; else lo = m; } return hi; };
    this.lines = [[0.12, 100800], [0.22, 211400], [0.24, 403550], [0.32, 512450]].map(([r, top]) => ({ label: `${Math.round(r * 100)}% bracket ends`, at: ordFor((m) => engineTax(m, this.p.ss, 0).taxableIncome >= top), kind: 'bracket' }));
    LAW[2026].irmaa.tiers.mfj.slice(0, 3).forEach((t, i) => this.lines.push({ label: `IRMAA tier ${i + 1}`, at: ordFor((m) => engineTax(m, this.p.ss, 0).magi > t), kind: 'irmaa' }));
    this.renderRight();
  }

  async descend() {
    this.ran = true;
    this.stop = false;
    this.setup();
    const gen = optimize(this.model, 260);
    const id = (this.runId = (this.runId || 0) + 1);
    for (const it of gen) {
      if (this.stop || id !== this.runId) return;
      this.conv = it.conv;
      this.cur = run(this.model, it.conv);
      this.history.push(it.obj);
      this.best = it.best;
      this.iter = it.k;
      if (it.k % 3 === 0 || it.done) { this.draw(); this.renderRight(); await new Promise((r) => setTimeout(r, 12)); }
    }
    this.cur = run(this.model, this.best.conv);
    this.conv = this.best.conv;
    this.draw(); this.renderRight();
  }

  renderRight() {
    const R = this.els.right;
    const rows = this.results.map((s) => ({ ...s, total: s.r.objective }));
    const bestRule = rows.slice(1).reduce((a, b) => (a.total < b.total ? a : b));
    const g = this.best ? run(this.model, this.best.conv) : null;
    const save = g ? bestRule.total - g.objective : 0;
    const tr = (name, r, cls = '') => `<tr class="${cls}"><td>${name}</td><td>${k$(r.tax)}</td><td>${k$(r.irmaa)}</td><td>${k$(r.heirs)}</td><td><b>${k$(r.objective)}</b></td></tr>`;
    R.innerHTML = `
      <div class="verdict-label">Gradient descent vs. the best rule of thumb</div>
      <div class="verdict-big"><span>${g ? (save >= 0 ? k$(save).replace('$', '$') : '—') : '…'}</span></div>
      <div class="verdict-cap">${g ? `less lifetime tax than "${bestRule.name.toLowerCase()}", the best of the usual rules for this couple` : 'descending…'}</div>
      <table class="kt lab-t"><thead><tr><th>Strategy</th><th>Tax</th><th>IRMAA</th><th>Heirs</th><th>Total</th></tr></thead><tbody>
        ${rows.map((s) => tr(s.name, s.r, s === bestRule ? 'rule' : '')).join('')}
        ${g ? tr('Gradient', g, 'grad') : ''}
      </tbody></table>
      <div class="tx-card"><div class="sec-label">The schedule it found</div><div class="sched">${g ? this.best.conv.map((c, t) => (c > 500 ? `<span><i>${this.p.age + t}</i>${k$(c)}</span>` : '')).join('') : ''}</div></div>
      <div class="tx-card"><div class="sec-label">Why this is new</div><p>Advisors pick conversions with rules of thumb because the tax code isn't differentiable. Here it is: it's a 40-neuron network that matches the MoneyGuide engine to the penny. So a 30-year schedule can be optimized the way neural networks are trained. The gradients are exact: backprop matches finite differences to three decimals.</p>
      <p class="muted" style="margin-top:8px">Deterministic growth, 2026 law held fixed in today's dollars, no discounting, federal tax only. IRMAA counts in the totals but isn't in the gradient (it's a staircase).</p></div>`;
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
    const top = H * 0.68;
    // ---- yearly income bars ----
    const padL = 58, padR = 24, padT = 78, padB = top - 30;
    const rows = this.cur.rows;
    const maxY = Math.max(...this.lines.filter((l) => l.kind === 'bracket').slice(0, 3).map((l) => l.at), ...rows.map((r) => r.ord)) * 1.08;
    const X = (t) => padL + (t / rows.length) * (W - padL - padR);
    const bw = (W - padL - padR) / rows.length;
    const Y = (v) => padT + (1 - v / maxY) * (padB - padT);
    g.textAlign = 'left';
    g.font = 'italic 400 22px "Instrument Serif", serif'; g.fillStyle = '#ece7dc'; g.fillText(W > 640 ? 'Taxable income each year: what they need, plus what to convert' : 'Income each year, plus conversions', 20, 32);
    g.font = '400 10px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.42)';
    g.fillText(W > 760 ? 'GREY = PENSION + RMDS (FORCED) · AMBER = ROTH CONVERSION (CHOSEN BY GRADIENT DESCENT) · LINES = WHERE THE LAW GETS PRICIER' : 'GREY = PENSION + RMDS · AMBER = CONVERSION', 20, 50);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.fillStyle = 'rgba(255,255,255,0.32)'; g.textAlign = 'right';
    for (let v = 0; v <= maxY; v += maxY > 600000 ? 200000 : 100000) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke(); g.fillText(k$(v), padL - 8, Y(v) + 3); }
    rows.forEach((r, t) => {
      const x = X(t) + bw * 0.15, w = bw * 0.7;
      const base = this.p.other + r.rmd;
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, Y(base), w, Y(0) - Y(base));
      if (r.conv > 0) { g.fillStyle = '#ffb04a'; g.shadowColor = '#ffb04a'; g.shadowBlur = 10; g.fillRect(x, Y(base + r.conv), w, Y(base) - Y(base + r.conv)); g.shadowBlur = 0; }
      if (t % 5 === 0) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.textAlign = 'center'; g.fillText(`${r.age}`, x + w / 2, padB + 16); }
    });
    this.lines.forEach((l) => {
      if (l.at > maxY) return;
      g.setLineDash(l.kind === 'irmaa' ? [2, 4] : [6, 4]);
      g.strokeStyle = l.kind === 'irmaa' ? 'rgba(255,106,85,0.6)' : 'rgba(241,216,166,0.55)';
      g.beginPath(); g.moveTo(padL, Y(l.at)); g.lineTo(W - padR, Y(l.at)); g.stroke(); g.setLineDash([]);
      g.textAlign = 'right'; g.font = '400 9.5px "Geist Mono", monospace';
      g.fillStyle = l.kind === 'irmaa' ? 'rgba(255,140,120,0.85)' : 'rgba(241,216,166,0.8)';
      g.fillText(l.label, W - padR - 4, Y(l.at) - 4);
    });
    // RMD start marker
    const rmdT = this.p.rmdAge - this.p.age;
    if (rmdT > 0 && rmdT < rows.length) {
      g.strokeStyle = 'rgba(116,199,255,0.5)'; g.beginPath(); g.moveTo(X(rmdT), padT); g.lineTo(X(rmdT), padB); g.stroke();
      g.fillStyle = 'rgba(116,199,255,0.85)'; g.textAlign = 'left'; g.fillText('RMDs begin', X(rmdT) + 5, padT + 10);
    }
    // ---- objective curve ----
    const oT = top + 40, oB = H - 30, oL = 58, oR = W - 24;
    const hist = this.history;
    const refs = this.results.map((s) => ({ name: s.name, v: s.r.objective }));
    const vals = [...refs.map((r) => r.v), ...hist];
    const lo = Math.min(...vals) * 0.95, hi = Math.max(...refs.map((r) => r.v)) * 1.02;
    const OY = (v) => oT + (1 - (v - lo) / (hi - lo)) * (oB - oT);
    const OX = (k) => oL + (k / 260) * (oR - oL);
    g.textAlign = 'left'; g.font = 'italic 400 18px "Instrument Serif", serif'; g.fillStyle = '#ece7dc';
    g.fillText('Lifetime cost, step by step', 20, top + 16);
    refs.forEach((r) => {
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(oL, OY(r.v)); g.lineTo(oR, OY(r.v)); g.stroke(); g.setLineDash([]);
      g.font = '400 9.5px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.45)'; g.textAlign = 'right'; g.fillText(`${r.name} · ${k$(r.v)}`, oR, OY(r.v) - 3);
    });
    if (hist.length) {
      g.beginPath(); hist.forEach((v, k) => (k ? g.lineTo(OX(k), OY(v)) : g.moveTo(OX(k), OY(v))));
      g.strokeStyle = '#ffb04a'; g.lineWidth = 2; g.shadowColor = '#ffb04a'; g.shadowBlur = 10; g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
    }
  }
}
