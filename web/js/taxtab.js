// Tab 05: the Tax Brain. Three things side by side:
//   the law (the 2026 tax engine), a network compiled from the law by hand (exact),
//   and a network trained on 3M returns that never saw the law (and rediscovered its bends).
import { TaxBrain, lawKinks, matchKinks, engineTax, engineIrmaa, LAW, ORD_MAX, audit } from './taxread.js';
import { compileLaw, runCompiled, countCompiled, weightDiff } from './compile.js';
import { checkProvenance } from './provenance.js';

const $ = (s, r = document) => r.querySelector(s);
const money = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString()}`);
const k$ = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : `$${Math.round(v)}`);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === Infinity ? '__inf' : v)), (k, v) => (v === '__inf' ? Infinity : v));

const KIND_COLOR = { bracket: '#f1d8a6', ss: '#ff8a6a', senior: '#c9a0ff', ltcg: '#7fe0c0', niit: '#74c7ff' };

export class TaxTab {
  constructor(els, data) {
    this.els = els;
    this.ours = new TaxBrain(data);
    this.brain = this.ours;
    this.which = 'ours';
    this.stats = data.stats;
    this.audits = new Map();
    this.hh = { ss: 40000, ltcg: 0, ord: 95000 };
    this.lawYear = 2026;
    this.law = clone(LAW[2026]);
    this.base = compileLaw(LAW[2026]);
    this.net = compileLaw(this.law);
    this.hoverNeuron = null;
    this.active = false;
    this.patched = 0;
    this.brainLaw = clone(LAW[2026]);
    this.chart = els.chart; this.g = this.chart.getContext('2d');
    this.netc = els.net; this.ng = this.netc.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(this.chart.parentElement);
    this.chart.addEventListener('mousemove', (e) => this.onChartMove(e));
    this.chart.addEventListener('click', (e) => this.onChartMove(e, true));
    this.netc.addEventListener('mousemove', (e) => this.onNetMove(e));
    this.netc.addEventListener('mouseleave', () => { this.hoverNeuron = null; this.drawNet(); this.renderNeuron(); });
    this.buildLeft();
    this.els.read = $('[data-read]', els.left);
    this.recompute();
  }

  activate() { this.active = true; this.resize(); }
  deactivate() { this.active = false; }

  // ---------- left panel: household + law editor ----------
  buildLeft() {
    const L = this.els.left;
    L.innerHTML = `
      <div class="sec-label" style="display:block;margin-bottom:8px">Brain under examination</div>
      <div class="seg" data-brains><button data-b="ours" class="on">Ours</button><button data-b="vendor">A vendor's model</button></div>
      <p class="lawnote" data-bnote>Trained on 3M returns from the planning engine.</p>
      <div class="panel-head"><h2>The household</h2><p>A married couple, both 65+, filing jointly. The x-axis is their IRA, pension and Roth-conversion income.</p></div>
      <div data-sl="ss"></div><div data-sl="ltcg"></div><div data-sl="ord"></div>
      <div class="txread" data-read></div>
      <div class="sec-label" style="margin:22px 0 10px;display:block">The law</div>
      <div class="seg" data-years><button data-y="2025">2025</button><button data-y="2026" class="on">2026</button><button data-y="custom">Your law</button></div>
      <div class="lawedit" data-lawedit>
        <p class="lawnote">You're Congress. Change the statute, and the compiled brain's weights change with it.</p>
        <div data-sl="top22"></div><div data-sl="std"></div><div data-sl="senior"></div><div data-sl="b2"></div>
      </div>
      <div class="diff" data-diff></div>`;
    const mk = (key, name, min, max, step, get, set, fmt, note) => {
      const d = $(`[data-sl="${key}"]`, L);
      d.className = 'slider';
      d.innerHTML = `<div class="slider-top"><span class="slider-name">${name}</span><span class="slider-val"></span></div><input type="range" min="${min}" max="${max}" step="${step}">${note ? `<div class="slider-note">${note}</div>` : ''}`;
      const inp = $('input', d), val = $('.slider-val', d);
      const sync = () => { inp.value = get(); val.textContent = fmt(get()); inp.style.setProperty('--p', `${((get() - min) / (max - min)) * 100}%`); };
      inp.oninput = () => { set(+inp.value); sync(); };
      this.syncers = this.syncers || [];
      this.syncers.push(sync);
      sync();
    };
    mk('ss', 'Social Security (couple)', 0, 100000, 1000, () => this.hh.ss, (v) => { this.hh.ss = v; this.recompute(); }, (v) => `${k$(v)}/yr`);
    mk('ltcg', 'Capital gains & qualified dividends', 0, 300000, 1000, () => this.hh.ltcg, (v) => { this.hh.ltcg = v; this.recompute(); }, (v) => `${k$(v)}/yr`);
    mk('ord', 'IRA / pension / conversions', 0, ORD_MAX, 500, () => this.hh.ord, (v) => { this.hh.ord = v; this.refreshCursor(); }, (v) => `${k$(v)}/yr`, 'Or hover the chart.');
    const lawSet = (fn) => (v) => { fn(v); this.lawYear = 'custom'; this.syncYears(); this.recompile(); };
    mk('top22', '22% bracket ends at', 150000, 300000, 100, () => this.law.ordinary.mfj[2][0], lawSet((v) => { this.law.ordinary.mfj[2][0] = v; }), (v) => `${k$(v)} taxable`);
    mk('std', 'Standard deduction (couple)', 20000, 50000, 100, () => this.law.standardDeduction.mfj, lawSet((v) => { this.law.standardDeduction.mfj = v; }), k$);
    mk('senior', 'Senior deduction (each)', 0, 12000, 100, () => this.law.senior.amount, lawSet((v) => { this.law.senior.amount = v; }), k$);
    mk('b2', 'SS 85% threshold (since 1993)', 30000, 120000, 1000, () => this.law.ssBase.mfj[1], lawSet((v) => { this.law.ssBase.mfj[1] = Math.max(v, this.law.ssBase.mfj[0] + 1000); }), k$, 'Never indexed for inflation. Try indexing it: about $97k today.');
    L.querySelectorAll('[data-b]').forEach((b) => { b.onclick = () => this.setBrain(b.dataset.b); });
    L.querySelectorAll('[data-y]').forEach((b) => {
      b.onclick = () => {
        const y = b.dataset.y;
        this.lawYear = y === 'custom' ? 'custom' : +y;
        if (y !== 'custom') this.law = clone(LAW[+y]);
        this.syncYears(); this.syncers.forEach((s) => s()); this.recompile();
      };
    });
  }
  syncYears() {
    this.els.left.querySelectorAll('[data-y]').forEach((b) => b.classList.toggle('on', String(this.lawYear) === b.dataset.y));
    this.els.left.querySelector('[data-lawedit]').classList.toggle('open', this.lawYear === 'custom');
  }

  async setBrain(which) {
    if (which === 'vendor' && !this.vendor) {
      const d = await fetch('data/taxbrain_no-senior.json').then((r) => r.json());
      checkProvenance([{ label: 'The vendor Tax Brain', data: d }]);
      this.vendor = new TaxBrain(d);
      this.vendorStats = d.stats;
    }
    this.which = which;
    this.brain = which === 'vendor' ? this.vendor : this.ours;
    this.els.left.querySelectorAll('[data-b]').forEach((b) => b.classList.toggle('on', b.dataset.b === which));
    this.els.left.querySelector('[data-bnote]').innerHTML = which === 'vendor'
      ? 'A black box from "a vendor": the same architecture, trained on someone else\'s tax software. Is it right? Audit it from its weights.'
      : 'Trained on 3M returns from the planning engine.';
    this.recompute();
  }

  auditResult() {
    if (!this.audits.has(this.which)) this.audits.set(this.which, audit(this.brain));
    return this.audits.get(this.which);
  }

  recompile() {
    this.net = compileLaw(this.law);
    this.recompute();
  }

  // ---------- core computation for the current household + law ----------
  recompute() {
    const { ss, ltcg } = this.hh;
    const N = 600;
    this.xs = Array.from({ length: N + 1 }, (_, i) => (i / N) * ORD_MAX);
    const lawM = [], brainM = [], compM = [];
    for (const x of this.xs) {
      const a = engineTax(x, ss, ltcg, this.law).federal, b = engineTax(x + 50, ss, ltcg, this.law).federal;
      lawM.push((b - a) / 50);
      brainM.push(this.brain.marginal(x + 25, ss, ltcg));
      compM.push((runCompiled(this.net, x + 50, ss, ltcg) - runCompiled(this.net, x, ss, ltcg)) / 50);
    }
    this.lawM = lawM; this.brainM = brainM; this.compM = compM;
    this.kinks = matchKinks(lawKinks(ss, ltcg, this.law), this.brain.kinks(ss, ltcg));
    this.hinges = this.brain.kinks(ss, ltcg);
    // IRMAA cliffs along the axis (Medicare looks back two years at this MAGI)
    this.cliffs = [];
    let prev = engineIrmaa(engineTax(0, ss, ltcg, this.law).magi, this.law);
    for (let x = 250; x <= ORD_MAX; x += 250) {
      const v = engineIrmaa(engineTax(x, ss, ltcg, this.law).magi, this.law);
      if (v !== prev) {
        let lo = x - 250, hi = x;
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (engineIrmaa(engineTax(m, ss, ltcg, this.law).magi, this.law) === prev) lo = m; else hi = m; }
        this.cliffs.push({ at: hi, from: prev, to: v });
        prev = v;
      }
    }
    // Torpedo: the stretch where the real marginal rate runs above the bracket rate because SS is being dragged in.
    // Torpedo: where each extra $1 of IRA income also drags Social Security into taxation while tax is owed.
    this.torpedo = null;
    let z0 = null, z1 = null, peak = 0;
    this.xs.forEach((x, i) => {
      const a = engineTax(x, ss, ltcg, this.law), b = engineTax(x + 50, ss, ltcg, this.law);
      const dragging = (b.taxableSS - a.taxableSS) / 50 > 0.05 && lawM[i] > 0.001;
      if (dragging) { if (z0 === null) z0 = x; z1 = x + 50; peak = Math.max(peak, lawM[i]); }
    });
    if (z0 !== null) {
      const t = engineTax((z0 + z1) / 2, ss, ltcg, this.law);
      this.torpedo = { from: z0, to: z1, peak, bracket: t.bracketRate };
    }
    this.renderRight();
    this.renderDiff();
    if (this.active) { this.draw(); this.drawNet(); }
    this.refreshCursor();
  }

  // ---------- trained-brain patching: law changed, move the hinges instead of retraining ----------
  patchBrain() {
    const { ss, ltcg } = this.hh;
    const before = this.errorVsLaw();
    const oldK = lawKinks(ss, ltcg, this.brainLaw), newK = lawKinks(ss, ltcg, this.law);
    const used = new Set();
    let edits = 0;
    for (const ok of oldK) {
      const nk = newK.filter((k) => k.label === ok.label && !used.has(k)).sort((a, b) => Math.abs(a.at - ok.at) - Math.abs(b.at - ok.at))[0];
      if (!nk) continue;
      used.add(nk);
      const delta = nk.at - ok.at;
      if (Math.abs(delta) < 1) continue;
      for (const h of this.brain.kinks(ss, ltcg)) {
        if (Math.abs(h.at - ok.at) < 7000 && Math.sign(h.jump) === Math.sign(ok.jump)) {
          this.brain.b1[h.j] -= this.brain.W1[h.j][0] * (delta / this.brain.range.ord);
          edits++;
        }
      }
    }
    this.patched += edits;
    this.brainLaw = clone(this.law);
    this.recompute();
    const after = this.errorVsLaw();
    this.lastPatch = { edits, before, after };
    this.renderDiff();
  }
  errorVsLaw() {
    const { ss, ltcg } = this.hh;
    let s = 0, n = 0;
    for (let x = 1000; x < ORD_MAX; x += 1000) { s += Math.abs(this.brain.value(x, ss, ltcg) - engineTax(x, ss, ltcg, this.law).federal); n++; }
    return s / n;
  }

  // ---------- right panel ----------
  renderRight() {
    const R = this.els.right;
    const c = countCompiled(this.net);
    const found = this.kinks.filter((k) => k.found && Math.abs(k.err) < 2500);
    const rows = this.kinks.map((k, i) => {
      const off = k.found ? Math.round(k.err) : null;
      const good = k.found && Math.abs(k.err) < 2500;
      return `<tr class="${good ? '' : 'miss'}" data-k="${i}"><td><i style="background:${KIND_COLOR[k.kind]}"></i>${i + 1}</td><td>${k.label}<small>${k.why}</small></td><td>${k$(k.at)}</td><td>${k.found ? `${off >= 0 ? '+' : '−'}$${Math.abs(off).toLocaleString()}` : '—'}</td></tr>`;
    }).join('');
    R.innerHTML = `
      <div class="tx-hero">
        <div class="sec-label">Read straight from the weights</div>
        <div class="tx-big">${found.length}<small>/${this.kinks.length}</small></div>
        <p>bends in the tax law that the <b>trained</b> brain put a hinge on, within $2,500, without ever seeing the law. It learned from ${(this.stats.trainReturns / 1e6).toFixed(0)}M returns, and its average error is ${money(this.stats.taxMeanErr)}.</p>
      </div>
      ${this.torpedo ? `<div class="torp"><b>Tax torpedo, ${k$(this.torpedo.from)}–${k$(this.torpedo.to)} of IRA income.</b> Every extra dollar here also drags Social Security into taxation, so it's taxed at up to <b>${pct(this.torpedo.peak)}</b> while they're "in" the ${Math.round(this.torpedo.bracket * 100)}% bracket. The trained brain found this on its own: its own marginal rate peaks at <b>${pct(this.brainPeak())}</b> in the same stretch.</div>` : ''}
      <table class="kt"><thead><tr><th>#</th><th>Where the law bends</th><th>Law</th><th>Brain</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tx-card">
        <div class="sec-label">The compiled brain</div>
        <p><b>${c.neurons} neurons · ${c.weights} weights · ${c.layers} layers.</b> No training: every weight was written from the statute. Checked against the planning engine on <b>1,000,000 random returns: max error $0.00</b>, for both 2025 and 2026 law.</p>
      </div>
      <div class="tx-card audit" data-audit>${this.auditHtml()}</div>
      <div class="tx-card" data-neuron></div>`;
    R.querySelectorAll('tr[data-k]').forEach((tr) => {
      tr.onmouseenter = () => { this.hiKink = +tr.dataset.k; this.draw(); };
      tr.onmouseleave = () => { this.hiKink = null; this.draw(); };
    });
    this.renderNeuron();
  }

  auditHtml() {
    const res = this.auditResult();
    const best = res[0], max = Math.max(...res.map((r) => r.score), 0.01);
    const correct = best.id === 'law2026';
    return `<div class="sec-label">Audit: which law did this brain learn?</div>
      <p class="muted">Its hinges are compared against four versions of the tax code, without running it on a single client.</p>
      ${res.map((r) => `<div class="hyp ${r === best ? 'best' : ''}"><span>${r.name}</span><i style="width:${Math.max(2, (r.score / max) * 100)}%"></i><b>${(r.coverage * 100).toFixed(0)}% · $${Math.round(r.err)}</b></div>`).join('')}
      <p class="verdict-line ${correct ? 'ok' : 'bad'}">${correct
        ? `Verdict: <b>consistent with 2026 law as enacted.</b> Its bends cover ${(best.coverage * 100).toFixed(0)}% of the law's, and it's off by $${Math.round(best.err)} on average.`
        : `Verdict: <b>this model learned "${best.name}".</b> It's missing the law's 2026 changes. For a couple 65+ it overstates tax by up to $${Math.round(this.maxOverstate()).toLocaleString()} a year.`}</p>`;
  }

  maxOverstate() {
    let m = 0;
    for (let x = 0; x < 300000; x += 2500) for (const ss of [0, 40000]) m = Math.max(m, this.brain.value(x, ss, 0) - engineTax(x, ss, 0, LAW[2026]).federal);
    return m;
  }

  brainPeak() {
    let p = 0;
    this.xs.forEach((x, i) => { if (x >= this.torpedo.from && x <= this.torpedo.to) p = Math.max(p, this.brainM[i]); });
    return p;
  }

  renderNeuron() {
    const el = this.els.right.querySelector('[data-neuron]');
    if (!el) return;
    const n = this.hoverNeuron;
    if (!n) { el.innerHTML = `<div class="sec-label">Hover a neuron in the compiled brain</div><p class="muted">Every neuron below the chart is one clause of the tax code. Hover to read it.</p>`; return; }
    const l = this.net[n.l];
    const terms = l.W[n.i].map((w, k) => (w ? `${w === 1 ? '' : w === -1 ? '−' : `${+w.toFixed(4)}·`}[${l.inNames[k]}]` : null)).filter(Boolean).join(' + ').replace(/\+ −/g, '− ');
    const b = l.b[n.i];
    el.innerHTML = `<div class="sec-label">Layer ${n.l + 1} · ${l.title}</div><div class="ins-name" style="font-size:22px">${l.names[n.i]}</div>
      <p class="muted">${l.why[n.i]}</p><code class="formula">${l.linear ? '' : 'relu( '}${terms}${b ? ` ${b < 0 ? '−' : '+'} ${Math.abs(b).toLocaleString()}` : ''}${l.linear ? '' : ' )'}</code>
      <p class="muted" style="margin-top:8px">Now: <b>${money(this.acts ? this.acts[n.l + 1][n.i] : 0)}</b> for this household.</p>`;
  }

  renderDiff() {
    const el = this.els.left.querySelector('[data-diff]');
    const d = weightDiff(this.base, this.net);
    const err = this.errorVsLaw();
    if (!d.length) { el.innerHTML = this.patched ? `<p class="lawnote">Trained brain patched with ${this.patched} bias edits.</p>` : ''; return; }
    el.innerHTML = `<div class="diffhead"><b>${d.length}</b> weight edits vs. 2026 law</div>
      <div class="difflist">${d.slice(0, 14).map((x) => `<div><span>${x.neuron}</span><span>${x.what === 'bias' ? 'bias' : 'w'} ${fmtW(x.from)} → <b>${fmtW(x.to)}</b></span></div>`).join('')}${d.length > 14 ? `<div><span>…and ${d.length - 14} more</span></div>` : ''}</div>
      <div class="patch"><p>The <b>trained</b> brain doesn't know about this law. It's now off by <b>${money(err)}</b> on average for this household.</p>
      <button class="chip" data-patch>Patch the trained brain's hinges</button>
      ${this.lastPatch ? `<p class="ok">Moved ${this.lastPatch.edits} hinge biases: ${money(this.lastPatch.before)} → <b>${money(this.lastPatch.after)}</b> average error. No retraining.</p>` : ''}
      <button class="chip warn" data-unpatch ${this.patched ? '' : 'hidden'}>Restore the trained brain</button></div>`;
    $('[data-patch]', el).onclick = () => this.patchBrain();
    const u = $('[data-unpatch]', el);
    if (u) u.onclick = () => { this.brain.reset(); this.brainLaw = clone(LAW[2026]); this.patched = 0; this.lastPatch = null; this.recompute(); };
  }

  // ---------- cursor ----------
  refreshCursor() {
    const { ord, ss, ltcg } = this.hh;
    const t = engineTax(ord, ss, ltcg, this.law);
    this.acts = runCompiled(this.net, ord, ss, ltcg, true);
    const tb = this.brain.value(ord, ss, ltcg);
    const mLaw = (engineTax(ord + 100, ss, ltcg, this.law).federal - t.federal) / 100;
    const mBrain = this.brain.marginal(ord, ss, ltcg);
    const next = this.kinks.find((k) => k.at > ord + 1);
    const cliff = this.cliffs.find((c) => c.at > ord);
    const R = this.els.read;
    R.innerHTML = `
      <div><span>IRA / pension income</span><b>${money(ord)}</b></div>
      <div><span>Federal tax · planning engine</span><b>${money(t.federal)}</b></div>
      <div><span>Compiled brain</span><b class="ok">${money(this.acts.at(-1)[0])}</b></div>
      <div><span>Trained brain</span><b>${money(tb)} <small>${tb - t.federal >= 0 ? '+' : '−'}${money(Math.abs(tb - t.federal))}</small></b></div>
      <div><span>Next dollar taxed at</span><b>${pct(mLaw)} <small>brain ${pct(mBrain)} · bracket ${Math.round(t.bracketRate * 100)}%</small></b></div>
      <div><span>Room before the next bend</span><b>${next ? `${money(next.at - ord)} <small>${next.label}</small>` : '—'}</b></div>
      <div><span>Room before an IRMAA cliff</span><b>${cliff ? `${money(cliff.at - ord)} <small>+${money(cliff.to - cliff.from)}/yr Medicare, both of them</small>` : 'past the last tier'}</b></div>`;
    if (this.syncers) this.syncers[2]();
    if (this.active) { this.draw(); this.drawNet(); this.renderNeuron(); }
  }

  onChartMove(e) {
    const r = this.chart.getBoundingClientRect();
    const x = e.clientX - r.left;
    const { padL, padR } = this.geo();
    const ord = Math.max(0, Math.min(ORD_MAX, ((x - padL) / (this.w - padL - padR)) * ORD_MAX));
    this.hh.ord = Math.round(ord / 100) * 100;
    this.refreshCursor();
  }

  // ---------- drawing ----------
  resize() {
    const p = this.chart.parentElement.getBoundingClientRect();
    if (!p.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const ch = Math.round(p.height * 0.58), nh = p.height - ch;
    this.w = p.width; this.ch = ch; this.nh = nh;
    Object.assign(this.chart.style, { top: '0px', height: `${ch}px` });
    Object.assign(this.netc.style, { top: `${ch}px`, height: `${nh}px` });
    this.chart.width = p.width * dpr; this.chart.height = ch * dpr; this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.netc.width = p.width * dpr; this.netc.height = nh * dpr; this.ng.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layoutNet();
    if (this.active) { this.draw(); this.drawNet(); }
  }
  geo() { return { padL: 52, padR: 22, padT: 108, padB: 36 }; }

  draw() {
    const g = this.g, { padL, padR, padT, padB } = this.geo(), W = this.w, H = this.ch;
    if (!W) return;
    g.clearRect(0, 0, W, H);
    const X = (v) => padL + (v / ORD_MAX) * (W - padL - padR);
    const Y = (m) => padT + (1 - Math.min(0.6, Math.max(-0.05, m)) / 0.6) * (H - padT - padB);
    // title
    g.textAlign = 'left';
    g.font = `italic 400 ${W < 640 ? 19 : 24}px "Instrument Serif", serif`; g.fillStyle = '#ece7dc';
    g.fillText(W < 640 ? 'Marginal tax rate: the law vs. two brains' : 'The marginal tax rate, as the law and two brains see it', 20, 32);
    g.font = '400 10.5px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText(`TAX ON THE NEXT $1 OF IRA INCOME · SS ${k$(this.hh.ss)} · GAINS ${k$(this.hh.ltcg)} · ${this.lawYear === 'custom' ? 'YOUR LAW' : `${this.lawYear} LAW`}`, 20, 52);
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.fillStyle = 'rgba(255,255,255,0.32)'; g.textAlign = 'right';
    for (const m of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) { g.beginPath(); g.moveTo(padL, Y(m)); g.lineTo(W - padR, Y(m)); g.stroke(); g.fillText(`${m * 100}%`, padL - 8, Y(m) + 3); }
    g.textAlign = 'center';
    for (let v = 0; v <= ORD_MAX; v += 100000) g.fillText(k$(v), X(v), H - 12);
    // torpedo zone
    if (this.torpedo) {
      g.fillStyle = 'rgba(255,106,85,0.08)';
      g.fillRect(X(this.torpedo.from), padT, X(this.torpedo.to) - X(this.torpedo.from), H - padT - padB);
      g.fillStyle = 'rgba(255,150,130,0.9)'; g.font = '500 10px "Geist Mono", monospace'; g.textAlign = 'center';
      g.fillText('TAX TORPEDO', (X(this.torpedo.from) + X(this.torpedo.to)) / 2, padT + 14);
      g.fillText(`${pct(this.torpedo.peak)} in the ${Math.round(this.torpedo.bracket * 100)}% bracket`, (X(this.torpedo.from) + X(this.torpedo.to)) / 2, padT + 27);
    }
    // IRMAA cliffs
    g.setLineDash([2, 4]);
    for (const c of this.cliffs) {
      g.strokeStyle = 'rgba(255,106,85,0.55)'; g.beginPath(); g.moveTo(X(c.at), padT); g.lineTo(X(c.at), H - padB); g.stroke();
      g.save(); g.translate(X(c.at) + 4, H - padB - 6); g.rotate(-Math.PI / 2);
      g.fillStyle = 'rgba(255,140,120,0.75)'; g.font = '400 9px "Geist Mono", monospace'; g.textAlign = 'left';
      g.fillText(`IRMAA +${k$(c.to - c.from)}`, 0, 0); g.restore();
    }
    g.setLineDash([]);
    // law (step), compiled (dashed), brain (glow)
    const path = (arr, shift = 0) => { g.beginPath(); this.xs.forEach((x, i) => (i ? g.lineTo(X(x), Y(arr[i]) + shift) : g.moveTo(X(x), Y(arr[i]) + shift))); };
    path(this.lawM); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.stroke();
    path(this.compM, 0); g.setLineDash([3, 5]); g.strokeStyle = '#74c7ff'; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
    path(this.brainM); g.strokeStyle = '#ffb04a'; g.lineWidth = 2; g.shadowColor = '#ffb04a'; g.shadowBlur = 12; g.stroke(); g.shadowBlur = 0;
    // brain hinge rug
    for (const h of this.hinges) {
      const a = Math.min(1, Math.abs(h.jump) * 12);
      g.strokeStyle = h.jump > 0 ? `rgba(255,176,74,${0.25 + a * 0.7})` : `rgba(116,199,255,${0.25 + a * 0.7})`;
      g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(h.at), H - padB + 2); g.lineTo(X(h.at), H - padB + 2 + 4 + a * 8); g.stroke();
    }
    // law kink markers
    g.font = '600 9.5px "Geist Mono", monospace'; g.textAlign = 'center';
    this.kinks.forEach((k, i) => {
      const x = X(k.at), hi = this.hiKink === i;
      g.strokeStyle = hi ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, padT - 6); g.lineTo(x, H - padB); g.stroke();
      g.fillStyle = KIND_COLOR[k.kind];
      g.beginPath(); g.arc(x, padT - 14 - (i % 2) * 15, hi ? 9 : 7.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0a0b10'; g.fillText(`${i + 1}`, x, padT - 10.5 - (i % 2) * 15);
      if (k.found && Math.abs(k.err) < 2500) { g.strokeStyle = '#9fe6b8'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, padT - 14 - (i % 2) * 15, hi ? 11 : 9.5, 0, Math.PI * 2); g.stroke(); }
    });
    // cursor
    const cx = X(this.hh.ord);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.setLineDash([1, 3]); g.beginPath(); g.moveTo(cx, padT); g.lineTo(cx, H - padB); g.stroke(); g.setLineDash([]);
    // legend
    g.textAlign = 'left'; g.font = '400 10.5px Geist, sans-serif';
    const lg = W < 640 ? [['Law', 'rgba(255,255,255,0.9)'], ['Compiled', '#74c7ff'], ['Trained', '#ffb04a']]
      : [['The law (planning engine)', 'rgba(255,255,255,0.9)'], ['Compiled brain', '#74c7ff'], ['Trained brain', '#ffb04a']];
    let lx = 20;
    lg.forEach(([t, c]) => { g.fillStyle = c; g.fillRect(lx, 66, 14, 2); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText(t, lx + 20, 70); lx += g.measureText(t).width + 40; });
  }

  // compiled network diagram
  layoutNet() {
    const L = [{ names: ['ordinary income', 'Social Security', 'capital gains'] }, ...this.net];
    const W = this.w, H = this.nh, padX = 60, padT = 30, padB = 18;
    this.npos = L.map((l, li) => {
      const n = l.names.length, x = padX + (li / (L.length - 1)) * (W - 2 * padX);
      const span = Math.min(H - padT - padB, n * 17);
      return l.names.map((_, i) => ({ x, y: padT + (H - padT - padB - span) / 2 + (n === 1 ? span / 2 : (span * i) / (n - 1)) }));
    });
  }

  drawNet() {
    const g = this.ng, W = this.w, H = this.nh;
    if (!W || !this.npos || this.npos.length !== this.net.length + 1) this.layoutNet();
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(0, 0, W, 1);
    g.textAlign = 'left'; g.font = '500 10px "Geist Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText('THE COMPILED BRAIN · THE 2026 TAX CODE AS A NEURAL NETWORK · LIVE FOR THE HOUSEHOLD AT THE CURSOR', 20, 18);
    const acts = this.acts;
    const diff = new Set(weightDiff(this.base, this.net).map((d) => `${d.layer}:${d.neuron}`));
    // edges
    this.net.forEach((l, li) => {
      l.W.forEach((row, r) => row.forEach((w, k) => {
        if (!w) return;
        const a = this.npos[li][k], b = this.npos[li + 1][r];
        const on = acts && acts[li][k] > 0;
        const hi = this.hoverNeuron && ((this.hoverNeuron.l === li && this.hoverNeuron.i === r) || (this.hoverNeuron.l === li - 1 && this.hoverNeuron.i === k));
        g.strokeStyle = w > 0 ? `rgba(255,176,74,${hi ? 0.9 : on ? 0.4 : 0.08})` : `rgba(116,199,255,${hi ? 0.9 : on ? 0.4 : 0.08})`;
        g.lineWidth = hi ? 1.6 : 1;
        const dx = (b.x - a.x) * 0.5;
        g.beginPath(); g.moveTo(a.x, a.y); g.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y); g.stroke();
      }));
    });
    // nodes
    const all = [{ names: ['ordinary income', 'Social Security', 'capital gains'], title: 'Inputs' }, ...this.net];
    all.forEach((l, li) => {
      l.names.forEach((nm, i) => {
        const p = this.npos[li][i];
        const v = acts ? acts[li][i] : 0;
        const on = v > 0.5;
        const changed = li > 0 && diff.has(`${li - 1}:${nm}`);
        if (on) { const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 12); grd.addColorStop(0, 'rgba(255,200,120,0.6)'); grd.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = grd; g.fillRect(p.x - 12, p.y - 12, 24, 24); }
        g.beginPath(); g.arc(p.x, p.y, li === all.length - 1 ? 5 : 3.4, 0, Math.PI * 2);
        g.fillStyle = on ? '#fff3dc' : 'rgba(255,255,255,0.18)'; g.fill();
        if (changed) { g.strokeStyle = '#c9a0ff'; g.lineWidth = 1.4; g.beginPath(); g.arc(p.x, p.y, 6.5, 0, Math.PI * 2); g.stroke(); }
        const hov = this.hoverNeuron && this.hoverNeuron.l === li - 1 && this.hoverNeuron.i === i;
        if (hov) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, 8, 0, Math.PI * 2); g.stroke(); }
      });
      const p0 = this.npos[li][0];
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.font = '400 8.5px "Geist Mono", monospace'; g.textAlign = 'center';
      if (W > 700) g.fillText((l.title || '').toUpperCase().slice(0, 18), p0.x, H - 5);
    });
  }

  onNetMove(e) {
    const r = this.netc.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 14 * 14;
    this.npos.forEach((col, li) => col.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd && li > 0) { bd = d; best = { l: li - 1, i }; } }));
    this.hoverNeuron = best;
    this.netc.style.cursor = best ? 'pointer' : 'default';
    this.drawNet(); this.renderNeuron();
  }
}

function fmtW(v) { return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : +v.toFixed(4); }
