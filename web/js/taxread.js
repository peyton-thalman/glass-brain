// Reading the tax code: where the real law bends, and where the brain's hinges bend.
// Shared by the browser (Tax tab) and node (train/taxread.mjs).
import * as T from './vendor/taxlaw.js';

export const ORD_MAX = 600_000;

export function engineTax(ord, ss, ltcg, law) {
  return T.computeTax({ filing: 'mfj', year: 2026, index: 1, wages: 0, ordinary: Math.max(0, ord), ltcg, ssBenefits: ss, over65: 2, stateRate: 0, stateTaxesSS: false, law });
}
export function engineIrmaa(magi, law) {
  const tier = T.irmaaTier(magi, 'mfj', 1, law);
  return 2 * (T.medicareAnnual(tier, law) - T.medicareAnnual(0, law));
}
export const LAW = T.LAW;

// ---- the brain: tax(x) = c + sum v_j relu(w_j . x + b_j) ----
export class TaxBrain {
  constructor(d, key = 'tax') {
    this.range = d.range;
    this.scale = d.taxScale;
    this.load(d[key]);
  }
  load(p) {
    this.W1 = p.W1.map((r) => r.slice());
    this.b1 = p.b1.slice();
    this.W2 = p.W2.slice();
    this.b2 = p.b2;
    this.orig = { W1: p.W1.map((r) => r.slice()), b1: p.b1.slice(), W2: p.W2.slice(), b2: p.b2 };
    this.H = this.b1.length;
  }
  reset() { this.load(this.orig); }
  enc(ord, ss, ltcg) { return [ord / this.range.ord, ss / this.range.ss, ltcg / this.range.ltcg]; }
  pre(j, x) { const w = this.W1[j]; return w[0] * x[0] + w[1] * x[1] + w[2] * x[2] + this.b1[j]; }
  value(ord, ss, ltcg) {
    const x = this.enc(ord, ss, ltcg);
    let s = this.b2;
    for (let j = 0; j < this.H; j++) { const z = this.pre(j, x); if (z > 0) s += this.W2[j] * z; }
    return s * this.scale;
  }
  // Exact marginal rate on ordinary income: the sum of slopes of every hinge that is switched on.
  marginal(ord, ss, ltcg) {
    const x = this.enc(ord, ss, ltcg);
    let g = 0;
    for (let j = 0; j < this.H; j++) if (this.pre(j, x) > 0) g += this.W2[j] * this.W1[j][0];
    return (g * this.scale) / this.range.ord;
  }
  activations(ord, ss, ltcg) {
    const x = this.enc(ord, ss, ltcg);
    return this.b1.map((_, j) => Math.max(0, this.pre(j, x)));
  }
  // Where each hinge bends along the ordinary-income axis (for this SS and gains), and how much it changes the slope.
  kinks(ss, ltcg) {
    const out = [];
    for (let j = 0; j < this.H; j++) {
      const w = this.W1[j];
      if (Math.abs(w[0]) < 1e-6) continue;
      const rest = w[1] * (ss / this.range.ss) + w[2] * (ltcg / this.range.ltcg) + this.b1[j];
      const at = (-rest / w[0]) * this.range.ord;
      if (at < 0 || at > ORD_MAX) continue;
      const jump = (this.W2[j] * Math.abs(w[0]) * this.scale) / this.range.ord;
      out.push({ j, at, jump });
    }
    return out.sort((a, b) => a.at - b.at);
  }
}

// ---- the law: find every point where the real marginal rate changes, and say why ----
const COMPONENTS = [
  ['ordinaryTax', 'bracket'], ['taxableSS', 'ss'], ['seniorDeduction', 'senior'], ['ltcgTax', 'ltcg'], ['niit', 'niit'],
];

function slopes(ord, ss, ltcg, law, h) {
  const a = engineTax(ord - h, ss, ltcg, law), b = engineTax(ord, ss, ltcg, law), c = engineTax(ord + h, ss, ltcg, law);
  const left = {}, right = {};
  for (const [k] of COMPONENTS) { left[k] = (b[k] - a[k]) / h; right[k] = (c[k] - b[k]) / h; }
  left.federal = (b.federal - a.federal) / h; right.federal = (c.federal - b.federal) / h;
  return { left, right, r: b };
}

function describe(ord, ss, ltcg, law) {
  const { left, right, r } = slopes(ord, ss, ltcg, law, 25);
  const d = (k) => right[k] - left[k];
  const pct = (x) => `${Math.round(x * 1000) / 10}%`;
  if (Math.abs(d('seniorDeduction')) > 0.01) {
    return d('seniorDeduction') < 0 ? ['senior', 'Senior deduction starts phasing out', 'OBBBA: $6,000 each, cut 6¢ per $1 of MAGI over $150k']
      : ['senior', 'Senior deduction fully phased out', 'the $12,000 couple\'s deduction is gone'];
  }
  if (Math.abs(d('taxableSS')) > 0.05) {
    if (left.taxableSS < 0.01) return ['ss', 'Social Security starts becoming taxable', 'provisional income crosses $32,000 (IRC §86)'];
    if (right.taxableSS < 0.01) return ['ss', 'Social Security hits the 85% cap', 'no more benefits can become taxable'];
    return ['ss', 'Social Security enters the 85% zone', 'provisional income crosses $44,000: each $1 drags in $0.85 of benefits'];
  }
  if (Math.abs(d('niit')) > 0.005) return ['niit', 'Net investment income tax kicks in', '3.8% on gains once MAGI passes $250,000'];
  if (Math.abs(d('ltcgTax')) > 0.01) {
    return d('ltcgTax') > 0 ? ['ltcg', 'Capital gains pushed out of the 0% bracket', 'income stacks gains above $98,900 of taxable income']
      : ['ltcg', 'All gains now taxed: stacking stops', 'the 0% bracket is fully used'];
  }
  if (left.federal < 0.005) return ['bracket', 'Tax starts: deductions used up', 'standard deduction + 65+ additions + senior deduction'];
  void pct;
  return bracketLabel(ord, ss, ltcg, law);
}

function bracketLabel(ord, ss, ltcg, law) {
  const L = law || LAW[2026];
  const before = engineTax(ord - 60, ss, ltcg, law), after = engineTax(ord + 60, ss, ltcg, law);
  const a = Math.round(before.bracketRate * 100), b = Math.round(after.bracketRate * 100);
  const top = L.ordinary.mfj.find(([, r]) => Math.round(r * 100) === a);
  if (a !== b) return ['bracket', `${a}% → ${b}% bracket`, `taxable income passes $${top[0].toLocaleString()}`];
  return ['bracket', 'Rate change', ''];
}

export function lawKinks(ss, ltcg, law, step = 250) {
  const out = [];
  let prev = null;
  for (let ord = step; ord < ORD_MAX - step; ord += step) {
    const m = (engineTax(ord + step / 2, ss, ltcg, law).federal - engineTax(ord - step / 2, ss, ltcg, law).federal) / step;
    if (prev !== null && Math.abs(m - prev) > 0.004) {
      // refine: bisection on where the slope switches
      let lo = ord - step, hi = ord;
      const sl = (o) => (engineTax(o + 5, ss, ltcg, law).federal - engineTax(o - 5, ss, ltcg, law).federal) / 10;
      const target = (m + prev) / 2;
      const up = m > prev;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if ((sl(mid) > target) === up) hi = mid; else lo = mid; }
      const at = (lo + hi) / 2;
      if (!out.length || at - out[out.length - 1].at > 150) {
        const [kind, label, why] = describe(at, ss, ltcg, law);
        const from = sl(at - 120), to = sl(at + 120);
        if (Math.abs(to - from) > 0.004) out.push({ at, from, to, jump: to - from, kind, label, why });
      }
    }
    prev = m;
  }
  return out;
}

// Match each real kink to the brain's hinges nearby: the slope-weighted center of the hinges within a window.
export function matchKinks(lawK, brainK, win = 9000) {
  return lawK.map((k) => {
    const near = brainK.filter((b) => Math.abs(b.at - k.at) < win && Math.sign(b.jump) === Math.sign(k.jump));
    const mass = near.reduce((s, b) => s + Math.abs(b.jump), 0);
    if (!near.length || mass < Math.abs(k.jump) * 0.25) return { ...k, found: false, hinges: [] };
    const center = near.reduce((s, b) => s + b.at * Math.abs(b.jump), 0) / mass;
    const best = near.slice().sort((a, b) => Math.abs(b.jump) - Math.abs(a.jump))[0];
    return { ...k, found: true, center, err: center - k.at, captured: mass / Math.abs(k.jump), hinges: near.map((b) => b.j), lead: best };
  });
}

// ---- auditing a trained brain against candidate versions of the law, from its hinges ----
const cloneLaw = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === Infinity ? '__inf' : v)), (k, v) => (v === '__inf' ? Infinity : v));
export function hypotheses() {
  const noSenior = cloneLaw(LAW[2026]); noSenior.senior.amount = 0;
  const indexed = cloneLaw(LAW[2026]); indexed.ssBase.mfj = [70000, 97000];
  return [
    { id: 'law2026', name: '2026 law, as enacted', law: LAW[2026] },
    { id: 'law2025', name: '2025 law (last year\'s numbers)', law: LAW[2025] },
    { id: 'nosenior', name: '2026 law without the OBBBA senior deduction', law: noSenior },
    { id: 'indexed', name: '2026 law with Social Security thresholds indexed', law: indexed },
  ];
}
const SLICES = [[0, 0], [25000, 0], [40000, 0], [60000, 0], [40000, 60000], [20000, 120000]];

export function audit(brain) {
  return hypotheses().map((h) => {
    let explained = 0, total = 0, matched = 0, count = 0, stray = 0, strayMass = 0, err = 0, n = 0;
    for (const [ss, g] of SLICES) {
      const lk = lawKinks(ss, g, h.law, 500);
      const bk = brain.kinks(ss, g).filter((b) => Math.abs(b.jump) > 0.004);
      for (const k of lk) {
        total += Math.abs(k.jump); count++;
        const near = bk.filter((b) => Math.abs(b.at - k.at) < 2500 && Math.sign(b.jump) === Math.sign(k.jump));
        const mass = near.reduce((s, b) => s + Math.abs(b.jump), 0);
        explained += Math.min(Math.abs(k.jump), mass);
        if (mass > Math.abs(k.jump) * 0.4) matched++;
      }
      for (const b of bk) {
        if (!lk.some((k) => Math.abs(b.at - k.at) < 4000)) { stray++; strayMass += Math.abs(b.jump); }
      }
      for (let x = 5000; x < ORD_MAX; x += 5000) { err += Math.abs(brain.value(x, ss, g) - engineTax(x, ss, g, h.law).federal); n++; }
    }
    return { ...h, matched, count, coverage: explained / total, stray, strayMass, err: err / n, score: explained / total - 0.5 * strayMass / total };
  }).sort((a, b) => b.score - a.score);
}
