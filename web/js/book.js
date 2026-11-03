// Book X-ray: an advisor's whole book of business scored by the brain in milliseconds.
// Drag a market shock and every household re-scores live; the call list writes itself.

const LAST = ['Okafor', 'Hendricks', 'Moretti', 'Nakamura', 'Alvarez', 'Lindqvist', 'Brennan', 'Castellano', 'Whitfield', 'Ramaswamy',
  'Kowalski', 'Delacroix', 'Abernathy', 'Fontaine', 'Gallagher', 'Haddad', 'Iverson', 'Jablonski', 'Kessler', 'Larkin', 'Mbeki',
  'Novak', "O'Rourke", 'Petrov', 'Quintero', 'Rasmussen', 'Sorensen', 'Takahashi', 'Underwood', 'Valdez', 'Weatherby', 'Yamada',
  'Zielinski', 'Ashworth', 'Beaumont', 'Carmichael', 'Dunleavy', 'Ellison', 'Fairbanks', 'Greenberg', 'Holloway', 'Ishikawa',
  'Montgomery', 'Pemberton', 'Stanhope', 'Thornbury', 'Vance', 'Winslow', 'Achebe', 'Bianchi', 'Coleman', 'Duarte', 'Engstrom'];

const FIRST = ['Ruth', 'Dale', 'Marisol', 'Glenn', 'Priya', 'Walt', 'Joan', 'Kenji', 'Deb', 'Arturo', 'Lena', 'Frank', 'Nadia',
  'Curtis', 'Ingrid', 'Ray', 'Yolanda', 'Hal', 'Beatrice', 'Omar', 'Carol', 'Stan', 'Mei', 'Luis', 'Janet', 'Victor', 'Gwen',
  'Ted', 'Rosa', 'Earl', 'Anita', 'Doug', 'Helen', 'Raj', 'Marge', 'Phil', 'Ines', 'Bud', 'Thea', 'Sal'];

const SHOCKS = [
  ['Normal', 0.065], ['Lost decade', -0.02], ['Stagflation', -0.045], ['Crash', -0.09], ['Boom', 0.12],
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const k$ = (v) => `$${Math.round(v / 1000)}k`;
const money = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`);

export class Book {
  constructor(canvas, stats, brain, opts) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.stats = stats;
    this.brain = brain;
    this.opts = opts;
    this.shock = 0.065;
    this.active = false;
    this.hover = null;
    this.makeHouseholds(4000);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; });
    canvas.addEventListener('click', () => { if (this.hover) (this.engineMode ? this.opts.onOpenEngine : this.opts.onOpen)(this.clientOf(this.hover)); });
    requestAnimationFrame((t) => this.frame(t));
  }

  makeHouseholds(n) {
    const r = rng(2026);
    const normal = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    this.hh = Array.from({ length: n }, (_, k) => {
      const age = 58 + r() * 22;
      const portfolio = clamp(Math.exp(Math.log(850e3) + 0.85 * normal()), 160e3, 5.8e6);
      const income = clamp(32e3 + 14e3 * normal(), 0, 88e3) * (r() > 0.06 ? 1 : 0);
      const wr = clamp(Math.exp(Math.log(0.036) + 0.4 * normal()), 0.012, 0.12);
      const spending = clamp(income + wr * portfolio, 26e3, 295e3);
      const f1 = Math.floor(r() * FIRST.length), f2 = (f1 + 1 + Math.floor(r() * (FIRST.length - 1))) % FIRST.length;
      const last = LAST[Math.floor(r() * LAST.length)];
      return {
        k, name: r() < 0.72 ? `${FIRST[f1]} & ${FIRST[f2]} ${last}` : `${FIRST[f1]} ${last}`,
        age, portfolio, income, spending,
        equity: clamp(0.55 + 0.17 * normal(), 0.05, 0.95),
        flex: [0, 0, 0.1, 0.2][Math.floor(r() * 4)],
        health: clamp(0.5 * normal(), -1, 1),
        jx: r() - 0.5,
        p: 0.5, shown: null,
      };
    });
    this.aum = this.hh.reduce((s, h) => s + h.portfolio, 0);
  }

  // ---------- MoneyGuide-engine mode: households with real account structure, scored by the Engine Brain ----------
  setEngine(mg, engineRun) {
    this.mg = mg;
    this.engineRun = engineRun;
    const r = rng(7070);
    const normal = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    this.hhE = Array.from({ length: 4000 }, (_, k) => {
      const age = 60 + Math.floor(r() * 16);
      const ira = clamp(Math.exp(Math.log(700e3) + 0.9 * normal()), 0, 4e6) * (r() < 0.06 ? 0 : 1);
      const roth = r() < 0.4 ? 0 : clamp(Math.exp(Math.log(120e3) + 1.0 * normal()), 0, 1.5e6);
      const taxable = r() < 0.25 ? 0 : clamp(Math.exp(Math.log(250e3) + 1.0 * normal()), 0, 2e6);
      const pia = clamp(2600 + 650 * normal(), 1000, 4200);
      const total = ira * 0.8 + roth + taxable;
      const spending = clamp(pia * 12 * 1.45 + total * clamp(Math.exp(Math.log(0.034) + 0.3 * normal()), 0.015, 0.08), 40e3, 200e3);
      const f1 = Math.floor(r() * FIRST.length), f2 = (f1 + 1 + Math.floor(r() * (FIRST.length - 1))) % FIRST.length;
      const f = { age, spouseGap: Math.round(-6 + r() * 8), ira, roth, taxable, spending, pia, claimAge: Math.max(age, [62, 65, 66, 67, 67, 68, 70][Math.floor(r() * 7)]),
        portfolio: [2, 3, 3, 3, 4, 4, 5][Math.floor(r() * 7)], stateRate: [0, 0, 0.03, 0.05, 0.05, 0.093][Math.floor(r() * 6)] };
      return { k, name: `${FIRST[f1]} & ${FIRST[f2]} ${LAST[Math.floor(r() * LAST.length)]}`, f, age, portfolio: ira + roth + taxable, jx: r() - 0.5, p: 0.5, shown: null };
    });
    this.aumE = this.hhE.reduce((s, h) => s + h.portfolio, 0);
  }

  get engineMode() { return this.mode === 'engine' && this.mg; }
  get list() { return this.engineMode ? this.hhE : this.hh; }

  setMode(m) {
    this.mode = m;
    this.shown0 = undefined;
    this.whatIf = 'none';
    this.score();
    this.renderStats(true);
    if (m === 'engine') this.spotCheck();
  }

  // Book-wide what-ifs, applied to every household's facts before scoring.
  applyWhatIf(f) {
    const w = this.whatIf;
    if (w === 'ss70') return { ...f, claimAge: 70 };
    if (w === 'trim') return { ...f, spending: f.spending * 0.92 };
    if (w === 'moderate') return { ...f, portfolio: Math.max(f.portfolio, 4) };
    return f;
  }

  bestAction(h) {
    const P = (f) => this.mg.success(f) / 100, base = P(h.f);
    const acts = [];
    if (h.f.claimAge < 70) acts.push(['Delay Social Security to 70', { ...h.f, claimAge: 70 }]);
    acts.push([`Trim spending ${k$(h.f.spending * 0.08)}/yr`, { ...h.f, spending: h.f.spending * 0.92 }]);
    if (h.f.portfolio < 4) acts.push(['Move to moderately aggressive', { ...h.f, portfolio: 4 }]);
    if (h.f.portfolio > 3) acts.push(['Move to moderate', { ...h.f, portfolio: 3 }]);
    let best = null;
    for (const [label, f] of acts) { const d = P(f) - base; if (!best || d > best.d) best = { label, d }; }
    return best;
  }

  async spotCheck() {
    if (!this.engineRun || this.spot) return;
    const r = rng(99), picks = Array.from({ length: 24 }, () => this.hhE[Math.floor(r() * this.hhE.length)]);
    this.spot = { n: 0, err: 0, ms: 0 };
    for (const h of picks) {
      await new Promise((res) => setTimeout(res, 0));
      const t0 = performance.now();
      const pe = this.engineRun(h.f);
      this.spot.ms += performance.now() - t0;
      this.spot.err += Math.abs(this.mg.success(h.f) - pe);
      this.spot.n++;
      if (this.active && this.engineMode) this.renderStats(false);
    }
  }

  clientOf(h) {
    if (this.engineMode) return { ...h.f };
    return { age: Math.round(h.age), portfolio: h.portfolio, spending: h.spending, income: h.income,
      equity: h.equity, early: this.shock, flex: h.flex, health: h.health };
  }

  score() {
    const B = this.brain;
    const t0 = performance.now();
    if (this.engineMode) {
      for (const h of this.hhE) h.p = this.mg.success(this.applyWhatIf(h.f)) / 100;
    } else {
      for (const h of this.hh) {
        const a = B.forward(B.encode(this.clientOf(h)));
        h.p = 1 / (1 + Math.exp(-a[a.length - 1][0]));
      }
    }
    this.scoreMs = performance.now() - t0;
    if (this.shown0 === undefined) this.list.forEach((h) => { h.shown = h.p; });
    this.shown0 = true;
  }

  // Smallest spending cut (in $/yr) that brings this household to 80%, found by bisection on the brain.
  fix(h) {
    const B = this.brain, target = 0.8;
    const p = (cut) => {
      const c = this.clientOf(h); c.spending = Math.max(26e3, h.spending - cut);
      const a = B.forward(B.encode(c)); return 1 / (1 + Math.exp(-a[a.length - 1][0]));
    };
    const maxCut = Math.max(0, h.spending - Math.max(26e3, h.income * 0.9));
    if (p(maxCut) < target) return null;
    let lo = 0, hi = maxCut;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (p(m) >= target) hi = m; else lo = m; }
    return Math.ceil(hi / 500) * 500;
  }

  setShock(v) {
    if (this.mode === 'engine') { this.mode = 'world'; this.shown0 = undefined; this.score(); this.renderStats(true); }
    this.shock = v;
    const s = this.stats.querySelector('[data-shock]');
    if (s) s.value = Math.round(v * 1000);
    this.score();
    this.renderStats(false);
  }

  activate() {
    this.active = true;
    if (!this.mcMs) {
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) this.opts.simulate(this.clientOf(this.hh[i]), 2000, 0, 7 + i);
      this.mcMs = (performance.now() - t0) / 3;
    }
    this.resize();
    this.score();
    this.renderStats(true);
  }

  deactivate() { this.active = false; }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  geom() {
    const padL = 56, padR = 28, padT = 86, padB = 40;
    return {
      X: (h) => padL + ((h.age - 57 + h.jx * 0.9) / 24) * (this.w - padL - padR),
      Y: (p) => padT + (1 - p) * (this.h - padT - padB),
      R: (h) => 1.4 + 5 * Math.sqrt(h.portfolio / 5.8e6),
      padL, padR, padT, padB,
    };
  }

  onMove(e) {
    if (!this.active) return;
    const r = this.c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const { X, Y, R } = this.geom();
    let best = null, bd = 100;
    for (const h of this.list) {
      const d = (X(h) - x) ** 2 + (Y(h.shown) - y) ** 2;
      if (d < Math.max(bd, R(h) ** 2) && d < bd) { bd = d; best = h; }
    }
    this.hover = best;
    this.c.style.cursor = best ? 'pointer' : 'default';
  }

  color(p, a) {
    // coral → amber → cream
    const s = clamp((p - 0.35) / 0.6, 0, 1);
    const r = 255, gg = Math.round(106 + (232 - 106) * s), b = Math.round(85 + (190 - 85) * Math.pow(s, 2));
    return `rgba(${r},${gg},${b},${a})`;
  }

  frame() {
    requestAnimationFrame((t) => this.frame(t));
    if (this.active && this.w) this.draw();
  }

  draw() {
    const g = this.g, { X, Y, R, padL, padR, padT, padB } = this.geom();
    g.clearRect(0, 0, this.w, this.h);
    let moving = false;
    for (const h of this.list) {
      const d = h.p - h.shown;
      if (Math.abs(d) > 0.0005) { h.shown += d * 0.12; moving = true; } else h.shown = h.p;
    }
    // danger zone
    const y70 = Y(0.7);
    const grd = g.createLinearGradient(0, y70, 0, this.h - padB);
    grd.addColorStop(0, 'rgba(255,106,85,0.07)'); grd.addColorStop(1, 'rgba(255,106,85,0.0)');
    g.fillStyle = grd; g.fillRect(padL, y70, this.w - padL - padR, this.h - padB - y70);
    g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,106,85,0.45)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, y70); g.lineTo(this.w - padR, y70); g.stroke(); g.setLineDash([]);
    // axes
    g.fillStyle = 'rgba(255,255,255,0.32)';
    [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
      g.textAlign = 'right'; g.fillText(`${p * 100}%`, padL - 10, Y(p) + 3);
      g.strokeStyle = 'rgba(255,255,255,0.04)'; g.beginPath(); g.moveTo(padL, Y(p)); g.lineTo(this.w - padR, Y(p)); g.stroke();
    });
    g.textAlign = 'center';
    for (let a = 60; a <= 80; a += 5) g.fillText(`age ${a}`, padL + ((a - 57) / 24) * (this.w - padL - padR), this.h - 14);
    // title
    g.textAlign = 'left';
    g.font = 'italic 400 26px "Instrument Serif", serif'; g.fillStyle = '#ece7dc';
    g.fillText(`${this.list.length.toLocaleString()} households · ${money(this.engineMode ? this.aumE : this.aum)}${this.engineMode ? ' · MoneyGuide engine' : ''}`, 22, 38);
    g.font = '400 10.5px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText(this.w > 760 ? 'EVERY DOT IS A HOUSEHOLD · SIZE = ASSETS · HEIGHT = CHANCE THE MONEY LASTS' : 'DOT = HOUSEHOLD · SIZE = ASSETS', 22, 58);

    g.globalCompositeOperation = 'lighter';
    for (const h of this.list) {
      const x = X(h), y = Y(h.shown), r = R(h);
      g.fillStyle = this.color(h.shown, h.shown < 0.7 ? 0.75 : 0.42);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.font = '500 10px "Geist Mono", monospace'; g.textAlign = 'left';
    const lbl = 'BELOW 70% · CALL THIS WEEK', lw = g.measureText(lbl).width + 14;
    g.fillStyle = 'rgba(6,7,11,0.85)'; g.beginPath(); g.roundRect(padL + 6, y70 - 9, lw, 18, 9); g.fill();
    g.strokeStyle = 'rgba(255,106,85,0.5)'; g.stroke();
    g.fillStyle = 'rgba(255,140,120,0.95)'; g.fillText(lbl, padL + 13, y70 + 3.5);
    if (this.hover) {
      const h = this.hover, x = X(h), y = Y(h.shown);
      g.strokeStyle = '#fff'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, R(h) + 4, 0, Math.PI * 2); g.stroke();
      const sp = h.f ? h.f.spending : h.spending;
      const lines = [h.name, `${Math.round(h.age)} · ${money(h.portfolio)} · spends ${money(sp)}/yr`, `${Math.round(h.p * 100)}% · click to open in the brain`];
      g.font = '500 12px Geist, sans-serif';
      const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 22;
      const bx = x + 14 + w > this.w ? x - w - 14 : x + 14, by = y - 30;
      g.fillStyle = 'rgba(12,14,20,0.94)'; g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.beginPath(); g.roundRect(bx, by, w, 62, 8); g.fill(); g.stroke();
      g.textAlign = 'left';
      g.font = 'italic 400 17px "Instrument Serif", serif'; g.fillStyle = '#ece7dc'; g.fillText(lines[0], bx + 11, by + 20);
      g.font = '400 10.5px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(lines[1], bx + 11, by + 37);
      g.fillStyle = this.color(h.p, 1); g.fillText(lines[2], bx + 11, by + 52);
    }
    void moving;
  }

  renderStats(rebuild) {
    if (this.engineMode) return this.renderEngineStats(rebuild);
    if (rebuild) this.stats.dataset.v = '';
    return this.renderWorldStats(rebuild);
  }

  modeSeg() {
    return `<div class="seg" data-bm><button data-m="world" class="${this.engineMode ? '' : 'on'}">Simulated world</button><button data-m="engine" class="${this.engineMode ? 'on' : ''}" ${this.mg ? '' : 'disabled'}>MoneyGuide engine</button></div>`;
  }
  wireSeg() {
    this.stats.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => this.setMode(b.dataset.m); });
  }

  setCallsHeader() {
    const p = document.querySelector('#bookCalls .book-head p');
    if (p) p.textContent = this.engineMode
      ? 'The households with the most money at risk, and the single move that helps each one most: Social Security timing, spending, or portfolio. The Engine Brain tests every option.'
      : 'The households with the most money at risk, and the smallest spending change that gets each one back to 80%. Found by asking the brain a few dozen questions per family.';
  }

  renderEngineStats(rebuild) {
    this.setCallsHeader();
    const L = this.list, at = L.filter((h) => h.p < 0.7);
    const atAum = at.reduce((s, h) => s + h.portfolio, 0);
    if (rebuild || this.stats.dataset.v !== 'engine') {
      this.stats.dataset.v = 'engine';
      this.stats.innerHTML = `${this.modeSeg()}
        <div class="shock"><div class="slider-name" style="margin-bottom:8px">What if every household…</div>
        <div class="shock-presets">${[['none', 'As planned'], ['ss70', 'Delays Social Security to 70'], ['trim', 'Trims spending 8%'], ['moderate', 'Takes a bit more risk']].map(([k, l]) => `<button class="chip ${this.whatIf === k ? 'on' : ''}" data-w="${k}">${l}</button>`).join('')}</div>
        <div class="slider-note" style="margin-top:8px">Each click re-scores all 4,000 plans through the Engine Brain.</div></div>
        <div class="stat"><span>Below 70%</span><b class="warn" data-at></b><em data-ataum></em></div>
        <div class="stat"><span>The Engine Brain scored the whole book in</span><b data-ms></b><em data-mc></em></div>
        <div class="stat"><span>Spot-check against the real engine</span><b data-spot>…</b><em data-spot2></em></div>`;
      this.wireSeg();
      this.stats.querySelectorAll('[data-w]').forEach((b) => {
        b.onclick = () => { this.whatIf = b.dataset.w; this.stats.querySelectorAll('[data-w]').forEach((x) => x.classList.toggle('on', x === b)); this.score(); this.renderStats(false); };
      });
    }
    this.stats.querySelector('[data-at]').textContent = `${at.length.toLocaleString()} households`;
    this.stats.querySelector('[data-ataum]').textContent = `${money(atAum)} in assets · ${((at.length / L.length) * 100).toFixed(0)}% of the book`;
    this.stats.querySelector('[data-ms]').textContent = `${this.scoreMs.toFixed(0)} ms`;
    const per = this.spot && this.spot.n ? this.spot.ms / this.spot.n : 35;
    this.stats.querySelector('[data-mc]').textContent = `The real engine at 500 trials each: ~${Math.round((per * L.length) / 1000)} s · ${Math.round((per * L.length) / this.scoreMs).toLocaleString()}× slower`;
    if (this.spot && this.spot.n) {
      this.stats.querySelector('[data-spot]').textContent = `${(this.spot.err / this.spot.n).toFixed(1)} pts`;
      this.stats.querySelector('[data-spot2]').textContent = `average gap over ${this.spot.n} random households run through the real engine just now`;
    }
    const calls = at.slice().sort((a, b) => b.portfolio * (0.8 - b.p) - a.portfolio * (0.8 - a.p)).slice(0, 12);
    const el = document.querySelector('#bookCalls [data-calls]');
    el.innerHTML = calls.map((h) => {
      const a = this.whatIf === 'none' ? this.bestAction(h) : null;
      return `<div class="call" data-k="${h.k}"><span class="nm">${h.name}</span><span class="pr">${Math.round(h.p * 100)}%</span>
        <span class="meta">${Math.round(h.age)} · ${money(h.portfolio)} · ${money(h.f.spending)}/yr</span>
        <span class="fix">${a && a.d > 0.01 ? `${a.label} → +${Math.round(a.d * 100)}` : ''}</span></div>`;
    }).join('') || '<div class="meta" style="color:var(--muted);font-size:12px">Nobody below 70%.</div>';
    el.querySelectorAll('.call').forEach((d) => { d.onclick = () => this.opts.onOpenEngine(this.clientOf(this.hhE[+d.dataset.k])); });
  }

  renderWorldStats(rebuild) {
    this.setCallsHeader();
    const at = this.hh.filter((h) => h.p < 0.7);
    const atAum = at.reduce((s, h) => s + h.portfolio, 0);
    const mcTotal = (this.mcMs * this.hh.length) / 1000;
    if (rebuild || !this.stats.querySelector('[data-shock]')) {
      this.stats.innerHTML = `${this.modeSeg()}
        <div class="shock"><div class="slider"><div class="slider-top"><span class="slider-name">Markets, next 5 years</span><span class="slider-val" data-sv></span></div>
        <input type="range" data-shock min="-120" max="160" step="1"><div class="slider-note">Average stock return after inflation. Drag it and watch the book react.</div></div>
        <div class="shock-presets">${SHOCKS.map(([l, v]) => `<button class="chip" data-v="${v}">${l}</button>`).join('')}</div></div>
        <div class="stat"><span>Below 70%</span><b class="warn" data-at></b><em data-ataum></em></div>
        <div class="stat"><span>The brain scored the whole book in</span><b data-ms></b><em data-mc></em></div>
        <div class="stat"><span>Versus a normal market</span><b data-delta></b><em>households pushed below 70% by this scenario</em></div>`;
      this.wireSeg();
      const s = this.stats.querySelector('[data-shock]');
      s.value = Math.round(this.shock * 1000);
      s.oninput = () => { this.shock = s.value / 1000; this.score(); this.renderStats(false); };
      this.stats.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => { this.shock = +b.dataset.v; s.value = Math.round(this.shock * 1000); this.score(); this.renderStats(false); };
      });
    }
    const s = this.stats.querySelector('[data-shock]');
    s.style.setProperty('--p', `${((s.value - s.min) / (s.max - s.min)) * 100}%`);
    this.stats.querySelector('[data-sv]').textContent = `${this.shock >= 0 ? '+' : '−'}${Math.abs(this.shock * 100).toFixed(1)}%/yr`;
    this.stats.querySelector('[data-at]').textContent = `${at.length.toLocaleString()} households`;
    this.stats.querySelector('[data-ataum]').textContent = `${money(atAum)} in assets · ${((at.length / this.hh.length) * 100).toFixed(0)}% of the book`;
    this.stats.querySelector('[data-ms]').textContent = `${this.scoreMs.toFixed(1)} ms`;
    this.stats.querySelector('[data-mc]').textContent = `Monte Carlo at 2,000 lives each: ~${mcTotal.toFixed(0)} s on this machine · ${Math.round((mcTotal * 1000) / this.scoreMs).toLocaleString()}× slower`;
    const calls = at.slice().sort((a, b) => b.portfolio * (0.8 - b.p) - a.portfolio * (0.8 - a.p)).slice(0, 12);
    if (this.normalAt === undefined) {
      const keep = this.hh.map((h) => h.p), s0 = this.shock;
      this.shock = 0.065; this.score(); this.normalAt = this.hh.filter((h) => h.p < 0.7).length;
      this.shock = s0; this.score(); void keep;
    }
    const dlt = at.length - this.normalAt;
    this.stats.querySelector('[data-delta]').textContent = `${dlt >= 0 ? '+' : '−'}${Math.abs(dlt).toLocaleString()}`;
    const el = document.querySelector('#bookCalls [data-calls]');
    el.innerHTML = calls.map((h) => {
      const f = this.fix(h);
      return `<div class="call" data-k="${h.k}"><span class="nm">${h.name}</span><span class="pr">${Math.round(h.p * 100)}%</span>
        <span class="meta">${Math.round(h.age)} · ${money(h.portfolio)} · ${money(h.spending)}/yr</span>
        <span class="fix">${f === null ? 'needs a bigger rethink' : f === 0 ? '' : `trim ${money(f)}/yr → 80%`}</span></div>`;
    }).join('') || '<div class="meta" style="color:var(--muted);font-size:12px">Nobody below 70%. Quiet week.</div>';
    el.querySelectorAll('.call').forEach((d) => { d.onclick = () => this.opts.onOpen(this.clientOf(this.hh[+d.dataset.k])); });
  }
}
