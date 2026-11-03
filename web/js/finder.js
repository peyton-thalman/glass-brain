// Tab 08: Money Finder. Every household in the book gets, in about a millisecond each:
//   · Roth Autopilot: a learned optimizer's conversion schedule, valued in exact lifetime dollars
//   · β, the reliability index: how many standard deviations of bad markets it takes to break the plan
//   · a replay of every real 30-ish-year window since 1928
import { makeModel, run, optimize, fillBracket } from './roth.js';
import { Autopilot, householdParams } from './autopilot.js';
import { makeStress, designPoint, monteCarlo, importanceSample, history, describePath } from './stress.js';

const $ = (s, r = document) => r.querySelector(s);
const k$ = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`);
const M$ = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FIRST = ['Ruth', 'Dale', 'Marisol', 'Glenn', 'Priya', 'Walt', 'Joan', 'Kenji', 'Deb', 'Arturo', 'Lena', 'Frank', 'Nadia', 'Curtis', 'Ingrid', 'Ray', 'Yolanda', 'Hal', 'Beatrice', 'Omar', 'Carol', 'Stan', 'Mei', 'Luis', 'Janet', 'Victor', 'Gwen', 'Ted', 'Rosa', 'Earl', 'Anita', 'Doug', 'Helen', 'Raj', 'Marge', 'Phil', 'Ines', 'Bud', 'Thea', 'Sal'];
const LAST = ['Okafor', 'Hendricks', 'Moretti', 'Nakamura', 'Alvarez', 'Lindqvist', 'Brennan', 'Castellano', 'Whitfield', 'Ramaswamy', 'Kowalski', 'Delacroix', 'Abernathy', 'Fontaine', 'Gallagher', 'Haddad', 'Iverson', 'Jablonski', 'Kessler', 'Larkin', 'Mbeki', 'Novak', 'Petrov', 'Quintero', 'Rasmussen', 'Sorensen', 'Takahashi', 'Underwood', 'Valdez', 'Weatherby', 'Yamada', 'Zielinski', 'Ashworth', 'Beaumont', 'Carmichael', 'Dunleavy', 'Ellison', 'Fairbanks', 'Greenberg', 'Holloway'];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Finder {
  constructor(els, data) {
    this.els = els;
    this.auto = new Autopilot(data.policy);
    this.hist = data.history;
    this.c = els.chart; this.g = this.c.getContext('2d');
    this.sel = null;
    this.makeBook(4000);
    new ResizeObserver(() => this.resize()).observe(this.c.parentElement);
    this.c.addEventListener('mousemove', (e) => this.onMove(e));
    this.c.addEventListener('click', () => { if (this.hover) this.select(this.hover); else if (this.sel) this.select(null); });
    this.renderLeft();
    this.renderRight();
  }
  activate() { this.active = true; this.resize(); if (!this.scanned && !this.scanning) this.scan(); }
  deactivate() { this.active = false; }

  makeBook(n) {
    const r = rng(8080);
    const normal = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    this.hh = Array.from({ length: n }, (_, k) => {
      const age = 60 + Math.floor(r() * 15);
      const ira = clamp(Math.exp(Math.log(650e3) + 0.85 * normal()), 80e3, 5e6);
      const roth = r() < 0.4 ? 0 : clamp(Math.exp(Math.log(110e3) + normal()), 0, 1.5e6);
      const taxable = r() < 0.3 ? 0 : clamp(Math.exp(Math.log(220e3) + normal()), 0, 2.5e6);
      const ss = r() < 0.05 ? 0 : clamp(42000 + 15000 * normal(), 12000, 95000);
      const other = r() < 0.75 ? 0 : clamp(Math.abs(25000 * normal()), 0, 90000);
      const W = ira + roth + taxable;
      const spend = clamp(ss + other + W * clamp(Math.exp(Math.log(0.031) + 0.3 * normal()), 0.012, 0.075), 40000, 260000);
      const f1 = Math.floor(r() * FIRST.length), f2 = (f1 + 1 + Math.floor(r() * (FIRST.length - 1))) % FIRST.length;
      return {
        k, name: `${FIRST[f1]} & ${FIRST[f2]} ${LAST[Math.floor(r() * LAST.length)]}`,
        age, ira, roth, taxable, ss, other, spend,
        equity: clamp(0.55 + 0.15 * normal(), 0.15, 0.9),
        heirRate: [0.12, 0.22, 0.22, 0.24, 0.24, 0.32][Math.floor(r() * 6)],
        growth: 0.045, W, done: false,
      };
    });
    this.aum = this.hh.reduce((s, h) => s + h.W, 0);
  }

  // Everything about one household: stress first (it sets how much the IRA must fund), then Roth.
  analyze(h) {
    const m = makeStress(h, this.hist.stats);
    const dp = designPoint(m);
    const hs = history(m, dp, this.hist);
    h.beta = dp.beta; h.pForm = dp.pFORM;
    h.histFail = hs.filter((w) => w.failed).length; h.histN = hs.length;
    h.draw = clamp(m.phi * m.x, 0, h.ira * 0.06);
    const p = householdParams(h);
    const model = makeModel(p);
    const conv = this.auto.schedule(p);
    h.none = run(model, new Array(p.years).fill(0)).objective;
    h.autoObj = run(model, conv).objective;
    h.ruleObj = Math.min(...[0.12, 0.22, 0.24].map((x) => run(model, fillBracket(model, x)).objective));
    h.found = Math.max(0, h.none - h.autoObj);
    h.beyond = h.ruleObj - h.autoObj;
    h.conv = conv;
    h.done = true;
  }

  async scan() {
    this.scanning = true;
    const t0 = performance.now();
    let i = 0;
    while (i < this.hh.length) {
      const end = Math.min(this.hh.length, i + 120);
      for (; i < end; i++) this.analyze(this.hh[i]);
      this.scanMs = performance.now() - t0;
      this.progress = i / this.hh.length;
      this.renderLeft(); this.draw();
      await new Promise((r) => setTimeout(r, 0));
    }
    this.scanning = false; this.scanned = true;
    this.renderLeft(); this.renderRight(); this.draw();
  }

  renderLeft() {
    const L = this.els.left, D = this.hh.filter((h) => h.done);
    const sum = (f) => D.reduce((s, h) => s + f(h), 0);
    const fragile = D.filter((h) => h.beta < 1), watch = D.filter((h) => h.beta >= 1 && h.beta < 2), solid = D.filter((h) => h.beta >= 2);
    const hfail = D.filter((h) => h.histFail > 0);
    L.innerHTML = `<div class="panel-head"><h2>Money Finder</h2><p>Every household in the book: an instant Roth plan from a learned optimizer, and a stress test that finds the market that would break it.</p></div>
      ${this.scanning ? `<div class="scanbar"><i style="width:${(this.progress * 100).toFixed(0)}%"></i></div><p class="lawnote">Scanning ${D.length.toLocaleString()} / ${this.hh.length.toLocaleString()} households…</p>` : ''}
      <div class="stat"><span>Lifetime tax Roth Autopilot found</span><b class="good">${M$(sum((h) => h.found))}</b><em>vs. no conversions · ${M$(sum((h) => Math.max(0, h.beyond)))} more than the best fill-the-bracket rule for each family</em></div>
      <div class="stat"><span>Fragile: under 1σ of bad luck breaks the plan</span><b class="warn">${fragile.length.toLocaleString()} households</b><em>${M$(fragile.reduce((s, h) => s + h.W, 0))} in assets · ${watch.length.toLocaleString()} more between 1σ and 2σ</em></div>
      <div class="stat"><span>Would have run out in at least one real era since 1928</span><b>${hfail.length.toLocaleString()} households</b><em>replayed against every historical window, using actual returns and inflation</em></div>
      <div class="stat"><span>Whole book analyzed in</span><b>${((this.scanMs || 0) / 1000).toFixed(1)} s</b><em>${D.length ? `${((this.scanMs || 0) / D.length).toFixed(2)} ms per household: Roth plan + exact valuation + β + ${D[0].histN} historical replays` : ''}</em></div>
      <div class="lab-how"><div class="sec-label">How to read the map</div><p><b>Across:</b> β, the reliability index. It's how many standard deviations of bad markets it takes to break the plan. <b>Up:</b> lifetime tax a Roth plan would save. Top-left is the call list: fragile, with money on the table.</p></div>`;
  }

  // ---------- map ----------
  resize() {
    const p = this.c.parentElement.getBoundingClientRect();
    if (!p.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = p.width; this.h = p.height;
    this.c.width = p.width * dpr; this.c.height = p.height * dpr; this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }
  geo() {
    const padL = 64, padR = 24, padT = 70, padB = 44;
    const X = (b) => padL + ((clamp(b, -1, 5) + 1) / 6) * (this.w - padL - padR);
    const Y = (v) => padT + (1 - Math.log10(Math.max(v, 1000) / 1000) / 4) * (this.h - padT - padB); // $1k → $10M
    const R = (h) => 1.3 + 4.5 * Math.sqrt(h.W / 6e6);
    return { X, Y, R, padL, padR, padT, padB };
  }
  onMove(e) {
    if (this.sel) { this.hover = null; return; }
    const r = this.c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const { X, Y } = this.geo();
    let best = null, bd = 64;
    for (const h of this.hh) { if (!h.done) continue; const d = (X(h.beta) - x) ** 2 + (Y(h.found) - y) ** 2; if (d < bd) { bd = d; best = h; } }
    this.hover = best; this.c.style.cursor = best ? 'pointer' : 'default';
    this.draw();
  }
  draw() {
    if (!this.active || !this.w) return;
    if (this.sel) return this.drawDetail();
    const g = this.g, { X, Y, R, padL, padR, padT, padB } = this.geo(), W = this.w, H = this.h;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'left'; g.font = 'italic 400 24px "Instrument Serif", serif'; g.fillStyle = '#ece7dc';
    g.fillText(`${this.hh.length.toLocaleString()} households · ${M$(this.aum)}`, 20, 32);
    g.font = '400 10px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText('ACROSS: HOW HARD IT IS TO BREAK THE PLAN (β) · UP: LIFETIME TAX A ROTH PLAN SAVES · CLICK ANY FAMILY', 20, 52);
    // zones
    g.fillStyle = 'rgba(255,106,85,0.07)'; g.fillRect(X(-1), padT, X(1) - X(-1), H - padT - padB);
    g.fillStyle = 'rgba(255,176,74,0.04)'; g.fillRect(X(1), padT, X(2) - X(1), H - padT - padB);
    g.font = '500 10px "Geist Mono", monospace'; g.textAlign = 'center';
    g.fillStyle = 'rgba(255,140,120,0.85)'; g.fillText('FRAGILE', (X(-1) + X(1)) / 2, padT + 14);
    g.fillStyle = 'rgba(255,190,110,0.75)'; g.fillText('WATCH', (X(1) + X(2)) / 2, padT + 14);
    g.fillStyle = 'rgba(159,230,184,0.7)'; g.fillText('SOLID', (X(2) + X(5)) / 2, padT + 14);
    // axes
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let b = -1; b <= 5; b++) { g.textAlign = 'center'; g.fillText(`${b}σ`, X(b), H - padB + 18); g.beginPath(); g.moveTo(X(b), padT); g.lineTo(X(b), H - padB); g.stroke(); }
    for (const v of [1e3, 1e4, 1e5, 1e6, 1e7]) { g.textAlign = 'right'; g.fillText(k$(v), padL - 8, Y(v) + 3); g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke(); }
    g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText('← breaks easily        reliability index β        survives almost anything →', (padL + W - padR) / 2, H - 10);
    // dots
    g.globalCompositeOperation = 'lighter';
    for (const h of this.hh) {
      if (!h.done) continue;
      const col = h.beta < 1 ? '255,106,85' : h.beta < 2 ? '255,176,74' : '241,216,166';
      g.fillStyle = `rgba(${col},${h.histFail ? 0.8 : 0.45})`;
      g.beginPath(); g.arc(X(h.beta), Y(h.found), R(h), 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    if (this.hover) {
      const h = this.hover, x = X(h.beta), y = Y(h.found);
      g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, R(h) + 4, 0, Math.PI * 2); g.stroke();
      const lines = [h.name, `${h.age} · ${k$(h.W)} · β ${h.beta.toFixed(2)} · Roth ${k$(h.found)}`, h.histFail ? `would have failed in ${h.histFail} of ${h.histN} real eras` : 'survived every real era since 1928'];
      g.font = '500 12px Geist, sans-serif';
      const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 24;
      const bx = x + 14 + w > W ? x - w - 14 : x + 14;
      g.fillStyle = 'rgba(12,14,20,0.95)'; g.strokeStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.roundRect(bx, y - 30, w, 62, 8); g.fill(); g.stroke();
      g.textAlign = 'left'; g.font = 'italic 400 17px "Instrument Serif", serif'; g.fillStyle = '#ece7dc'; g.fillText(lines[0], bx + 12, y - 10);
      g.font = '400 10.5px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText(lines[1], bx + 12, y + 7);
      g.fillStyle = h.histFail ? '#ff8a6a' : '#9fe6b8'; g.fillText(lines[2], bx + 12, y + 22);
    }
  }

  // ---------- one household ----------
  select(h) {
    this.sel = h;
    this.hover = null;
    if (h) {
      const m = makeStress(h, this.hist.stats);
      const dp = designPoint(m);
      const hs = history(m, dp, this.hist);
      const p = householdParams(h);
      const model = makeModel(p);
      let last; const t0 = performance.now();
      for (const it of optimize(model, 200)) last = it;
      this.detail = { lev: this.levers(h), m, dp, hs, mc: monteCarlo(m, 6000), is: dp.beta > 0 ? importanceSample(m, dp, 2000) : null, shape: describePath(dp), opt: last.obj, optConv: last.conv, optMs: performance.now() - t0, p, model };
    }
    this.renderRight();
    this.draw();
  }

  drawDetail() {
    const g = this.g, W = this.w, H = this.h, { m, dp, hs } = this.detail, h = this.sel;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'left'; g.font = 'italic 400 24px "Instrument Serif", serif'; g.fillStyle = '#ece7dc';
    g.fillText(`${h.name}: the market that breaks this plan`, 20, 32);
    g.font = '400 10px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText('REAL (AFTER-INFLATION) GROWTH OF $1 IN THEIR PORTFOLIO · THICK = THE NIGHTMARE (DESIGN POINT) · THIN = REAL HISTORY · CLICK TO GO BACK', 20, 50);
    // top: cumulative paths
    const top = 66, mid = H * 0.56, padL = 56, padR = 24;
    const T = m.T, e = h.equity;
    const cum = (rets) => { let v = 1; return [1, ...rets.map((r) => (v *= 1 + r))]; };
    const histPaths = hs.map((w) => {
      const i = this.hist.years.findIndex((y) => y[0] === w.start);
      return { w, c: cum(this.hist.years.slice(i, i + T).map(([, s, b]) => e * s + (1 - e) * b)) };
    });
    const design = cum(dp.path);
    const avg = cum(new Array(T).fill(m.mu));
    const all = [...histPaths.flatMap((p) => p.c), ...design];
    const lo = Math.log(Math.max(0.2, Math.min(...all))), hi = Math.log(Math.min(40, Math.max(...all, ...avg)));
    const X = (t) => padL + (t / T) * (W - padL - padR);
    const Y = (v) => top + 20 + (1 - (Math.log(clamp(v, 0.2, 40)) - lo) / (hi - lo)) * (mid - top - 40);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.textAlign = 'right';
    for (const v of [0.5, 1, 2, 4, 8, 16]) { if (Math.log(v) < lo || Math.log(v) > hi) continue; g.fillText(`${v}×`, padL - 8, Y(v) + 3); g.strokeStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke(); }
    const line = (c, style, w) => { g.beginPath(); c.forEach((v, t) => (t ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v)))); g.strokeStyle = style; g.lineWidth = w; g.stroke(); g.lineWidth = 1; };
    histPaths.forEach((p) => line(p.c, p.w.failed ? 'rgba(255,106,85,0.45)' : 'rgba(255,255,255,0.09)', 1));
    const worst = histPaths.slice().sort((a, b) => b.w.severity - a.w.severity).slice(0, 3);
    worst.forEach((p) => { line(p.c, p.w.failed ? 'rgba(255,140,120,0.95)' : 'rgba(255,255,255,0.6)', 1.4); g.fillStyle = 'rgba(255,255,255,0.7)'; g.textAlign = 'left'; g.font = '400 10px "Geist Mono", monospace'; g.fillText(`${p.w.start}`, X(T) - 30, Y(p.c[T]) - 4); });
    line(avg, 'rgba(159,230,184,0.6)', 1.2);
    g.shadowColor = '#ffb04a'; g.shadowBlur = 14; line(design, '#ffb04a', 3); g.shadowBlur = 0;
    g.fillStyle = '#ffb04a'; g.textAlign = 'left'; g.font = '500 11px "Geist Mono", monospace'; g.fillText(`NIGHTMARE · β = ${dp.beta.toFixed(2)}σ`, X(1), Y(design[1]) + 22);
    g.fillStyle = 'rgba(159,230,184,0.8)'; g.fillText('average market', X(T * 0.62), Y(avg[Math.round(T * 0.62)]) - 8);
    // bottom: severity bars per historical start year
    const bt = mid + 36, bb = H - 34;
    g.textAlign = 'left'; g.font = 'italic 400 19px "Instrument Serif", serif'; g.fillStyle = '#ece7dc';
    g.fillText('Every real era since 1928, measured in this plan\'s breaking direction', 20, mid + 20);
    const maxS = Math.max(dp.beta + 0.5, ...hs.map((w) => w.severity)) * 1.05, minS = Math.min(-1, ...hs.map((w) => w.severity));
    const BX = (i) => padL + (i / hs.length) * (W - padL - padR), bw = (W - padL - padR) / hs.length;
    const BY = (s) => bt + (1 - (s - minS) / (maxS - minS)) * (bb - bt);
    hs.forEach((w, i) => {
      g.fillStyle = w.failed ? 'rgba(255,106,85,0.9)' : 'rgba(241,216,166,0.35)';
      const y0 = BY(0), y1 = BY(w.severity);
      g.fillRect(BX(i) + 0.5, Math.min(y0, y1), Math.max(1, bw - 1), Math.abs(y1 - y0));
      if (w.start % 10 === 0) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.textAlign = 'center'; g.font = '400 10px "Geist Mono", monospace'; g.fillText(`${w.start}`, BX(i) + bw / 2, bb + 16); }
    });
    if (dp.beta > minS) {
      g.setLineDash([5, 4]); g.strokeStyle = '#ffb04a'; g.beginPath(); g.moveTo(padL, BY(dp.beta)); g.lineTo(W - padR, BY(dp.beta)); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffb04a'; g.textAlign = 'right'; g.font = '500 10px "Geist Mono", monospace'; g.fillText(`β = ${dp.beta.toFixed(2)}: the breaking line`, W - padR, BY(dp.beta) - 5);
    }
    g.strokeStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(padL, BY(0)); g.lineTo(W - padR, BY(0)); g.stroke();
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = '400 10px "Geist Mono", monospace';
    g.fillText('red = actually ran out when replayed', W - padR, bb + 30);
  }

  // What makes the plan solid: the spending that reaches β = 2, and the stock mix with the highest β.
  levers(h) {
    const B = (x) => designPoint(makeStress({ ...h, ...x }, this.hist.stats), 40).beta;
    const target = 2;
    let spendTo = null;
    if (B({}) < target) {
      let lo = Math.max(10000, h.ss * 0.5), hi = h.spend;
      if (B({ spend: lo }) >= target) {
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (B({ spend: m }) >= target) lo = m; else hi = m; }
        spendTo = Math.floor(lo / 500) * 500;
      }
    }
    let bestEq = h.equity, bestB = B({});
    for (let e = 0.1; e <= 0.951; e += 0.05) { const b = B({ equity: e }); if (b > bestB + 0.02) { bestB = b; bestEq = e; } }
    return { spendTo, bestEq, bestB };
  }

  brief(h, d) {
    const dp = d.dp, fails = d.hs.filter((w) => w.failed), worst = d.hs.slice().sort((a, b) => b.severity - a.severity)[0];
    const risk = d.is && d.is.p < 0.01 ? `about 1 in ${Math.round(1 / Math.max(d.is.p, 1e-9)).toLocaleString()}` : `about ${Math.round((d.is ? d.is.p : d.mc) * 100)}%`;
    const conv = h.conv.map((c, t) => [h.age + t, c]).filter(([, c]) => c > 1000);
    const firstYears = conv.slice(0, 3).map(([a, c]) => `${k$(c)} at ${a}`).join(', ');
    const lines = [
      `${h.name} (${h.age}) · ${k$(h.W)} invested · spending ${k$(h.spend)}/yr`,
      '',
      `RISK: ${dp.beta < 1 ? 'Fragile' : dp.beta < 2 ? 'Watch' : 'Solid'}. It takes a ${dp.beta.toFixed(1)}-sigma bad market to run out by 95 (chance ${risk}).`,
      fails.length
        ? `Replaying real history since 1928, it would have run out in ${fails.length} of ${d.hs.length} eras, including ${fails.slice(-3).map((w) => w.start).join(', ')}.`
        : `It survived all ${d.hs.length} real eras since 1928. The closest call was ${worst.start}-${worst.end}.`,
      `The market that breaks it: about ${(d.shape.first * 100).toFixed(1)}%/yr after inflation for the first ${d.shape.k} years.`,
      '',
      h.found > 5000
        ? `ROTH: Converting ${firstYears}${conv.length > 3 ? ', then tapering' : ''} cuts lifetime tax (incl. IRMAA and heirs) by about ${k$(h.found)}${h.beyond > 5000 ? `, ${k$(h.beyond)} more than filling a bracket` : ''}.`
        : 'ROTH: Little to gain from conversions at these numbers.',
      '',
      `PROPOSE: ${dp.beta < 2 && d.lev.spendTo ? `Bring spending to about ${k$(d.lev.spendTo)}/yr to reach a 2-sigma cushion. ` : dp.beta < 1 ? 'Revisit spending or add guardrails before anything else. ' : ''}${dp.beta < 2 && Math.abs(d.lev.bestEq - h.equity) > 0.04 ? `Consider a ${Math.round(d.lev.bestEq * 100)}% stock mix. ` : ''}${h.found > 5000 ? `Start this year's conversion (${k$(conv[0] ? conv[0][1] : 0)}).` : 'Review again next year.'}`,
    ];
    return lines.join('\n');
  }

  renderRight() {
    const R = this.els.right;
    if (!this.sel) {
      const D = this.hh.filter((h) => h.done);
      const calls = D.filter((h) => h.beta < 1.5).sort((a, b) => b.found - a.found).slice(0, 10);
      const money = D.slice().sort((a, b) => b.beyond - a.beyond).slice(0, 6);
      R.innerHTML = `<div class="book-head"><h2>This week's calls</h2><p>Fragile plans (β under 1.5) with the most lifetime tax on the table.</p></div>
        <div class="calls">${calls.map((h) => `<div class="call" data-k="${h.k}"><span class="nm">${h.name}</span><span class="pr">β ${h.beta.toFixed(1)}</span><span class="meta">${h.age} · ${k$(h.W)} · fails in ${h.histFail}/${h.histN} eras</span><span class="fix">Roth plan saves ${k$(h.found)}</span></div>`).join('') || '<p class="lawnote">Scanning…</p>'}</div>
        <div class="book-head" style="margin-top:18px"><h2>Where the rules of thumb fail most</h2><p>The biggest gaps between Autopilot and the best fill-the-bracket rule.</p></div>
        <div class="calls">${money.map((h) => `<div class="call" data-k="${h.k}"><span class="nm">${h.name}</span><span class="pr good">+${k$(h.beyond)}</span><span class="meta">${h.age} · IRA ${k$(h.ira)} · heirs ${Math.round(h.heirRate * 100)}%</span><span class="fix"></span></div>`).join('')}</div>`;
      R.querySelectorAll('[data-k]').forEach((d) => { d.onclick = () => this.select(this.hh[+d.dataset.k]); });
      return;
    }
    const h = this.sel, d = this.detail, dp = d.dp;
    const fails = d.hs.filter((w) => w.failed);
    const worst = d.hs.slice().sort((a, b) => b.severity - a.severity)[0];
    const agree = d.hs.filter((w) => w.failed === w.predicted).length;
    const verdict = dp.beta < 0 ? 'This plan fails even in an average market.'
      : `It takes a market <b>${dp.beta.toFixed(2)} standard deviations</b> bad, in its worst direction, to run this plan out of money by 95.`;
    const eraLine = worst ? (worst.failed ? `The real ${worst.start}–${worst.end} sequence would have done it.` : `The worst real era for this plan, ${worst.start}–${worst.end}, got ${Math.round((worst.severity / Math.max(dp.beta, 0.01)) * 100)}% of the way there.`) : '';
    const sched = d.optConv.map((c, t) => (c > 500 ? `<span><i>${h.age + t}</i>${k$(c)}</span>` : '')).join('');
    const auto = h.conv.map((c, t) => (c > 500 ? `<span><i>${h.age + t}</i>${k$(c)}</span>` : '')).join('');
    R.innerHTML = `<button class="chip" data-back>← Whole book</button>
      <div class="ins-name" style="margin-top:12px">${h.name}</div>
      <p class="muted" style="font-size:12px;margin:0 0 14px">${h.age} · IRA ${k$(h.ira)} · Roth ${k$(h.roth)} · taxable ${k$(h.taxable)} · spends ${k$(h.spend)}/yr · Social Security ${k$(h.ss)} · ${Math.round(h.equity * 100)}% stocks</p>
      <div class="sec-label">Distance to ruin</div>
      <div class="tx-big" style="font:italic 400 64px/1 var(--serif);margin:6px 0">${dp.beta.toFixed(2)}<small style="font-size:28px;color:var(--muted)">σ</small></div>
      <p class="xr-note">${verdict} ${eraLine}</p>
      <div class="truth" style="margin-top:12px">
        <div class="truth-row"><span>FORM estimate, Φ(−β)</span><b>${(dp.pFORM * 100).toFixed(1)}%</b></div>
        <div class="truth-row"><span>Importance sampling at the nightmare (2,000 paths)</span><b>${d.is ? (d.is.p < 0.01 ? `1 in ${Math.round(1 / Math.max(d.is.p, 1e-9)).toLocaleString()}` : `${(d.is.p * 100).toFixed(1)}% ± ${(d.is.se * 100).toFixed(1)}`) : '—'}</b></div>
        <div class="truth-row"><span>Plain Monte Carlo (6,000 paths)</span><b>${d.mc === 0 ? 'saw 0 failures' : `${(d.mc * 100).toFixed(1)}%`}</b></div>
        <div class="truth-row"><span>Real eras that broke it</span><b class="${fails.length ? 'warn' : 'ok'}">${fails.length} of ${d.hs.length}</b></div>
        <div class="truth-row"><span>β's prediction matched the replay</span><b>${agree} of ${d.hs.length} eras</b></div>
        <div class="truth-row"><span>Nightmare: first ${d.shape.k} years</span><b>${(d.shape.first * 100).toFixed(1)}%/yr real</b></div>
      </div>
      ${fails.length ? `<p class="muted" style="font-size:11.5px">Eras that broke it: ${fails.map((w) => w.start).join(', ')}</p>` : ''}
      ${dp.beta < 2 ? `<div class="gp" style="margin-top:12px"><div class="sec-label">What makes it solid (β ≥ 2)</div><ul>
        ${d.lev.spendTo ? `<li>Spend <b>${k$(d.lev.spendTo)}/yr</b> instead of ${k$(h.spend)} (${k$(h.spend - d.lev.spendTo)} less)</li>` : '<li>No spending level alone gets there</li>'}
        ${Math.abs(d.lev.bestEq - h.equity) > 0.04 ? `<li>Best stock mix for this plan: <b>${Math.round(d.lev.bestEq * 100)}%</b> (β ${d.lev.bestB.toFixed(2)} vs ${dp.beta.toFixed(2)})</li>` : '<li>Its stock mix is already about as safe as it gets</li>'}
      </ul></div>` : ''}
      <div class="sec-label" style="display:block;margin-top:16px">Roth plan</div>
      <table class="kt lab-t" style="margin-top:6px"><tbody>
        <tr><td>No conversions</td><td>${k$(h.none)}</td></tr>
        <tr class="rule"><td>Best bracket rule</td><td>${k$(h.ruleObj)}</td></tr>
        <tr class="grad"><td>Roth Autopilot (instant)</td><td>${k$(h.autoObj)}</td></tr>
        <tr><td>Exact optimizer (${d.optMs.toFixed(0)} ms)</td><td>${k$(d.opt)}</td></tr>
      </tbody></table>
      <p class="muted" style="font-size:11.5px;margin-top:-8px">lifetime federal tax + IRMAA + heirs' tax. Autopilot captures ${Math.round(((h.none - h.autoObj) / Math.max(1, h.none - d.opt)) * 100)}% of the optimizer's savings.</p>
      <div class="brief"><div class="sec-label">Call brief</div><pre data-brief>${this.brief(h, d)}</pre><button class="chip" data-copy>Copy</button></div>
      <div class="tx-card"><div class="sec-label">Autopilot schedule</div><div class="sched">${auto || '<span>no conversions</span>'}</div>
      <div class="sec-label" style="margin-top:10px">Exact optimizer</div><div class="sched">${sched || '<span>no conversions</span>'}</div></div>`;
    $('[data-back]', R).onclick = () => this.select(null);
    $('[data-copy]', R).onclick = async (e) => {
      const txt = $('[data-brief]', R).textContent;
      try { await navigator.clipboard.writeText(txt); e.target.textContent = 'Copied'; }
      catch (_) { const r = document.createRange(); r.selectNodeContents($('[data-brief]', R)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); e.target.textContent = 'Selected, press ⌘C'; }
    };
  }
}
