// Roth Autopilot: a learned optimizer. One forward pass gives a household's conversion schedule;
// optional refinement continues gradient descent from there through the exact tax network.
import { makeModel, run, gradient } from './roth.js';

export class Autopilot {
  constructor(d) { this.d = d; this.K = d.K; }
  encode(p) {
    return [(p.age - 67) / 7, (Math.log(p.ira) - Math.log(700_000)) / 1.5, p.ss / 50_000 - 1, p.other / 60_000 - 1,
      p.heirRate / 0.2 - 1, (p.draw / p.ira) / 0.03 - 1, (p.growth - 0.0475) / 0.0175];
  }
  schedule(p) {
    let h = this.encode(p);
    const L = this.d.layers;
    L.forEach((l, i) => {
      const o = new Array(l.W.length);
      for (let r = 0; r < l.W.length; r++) {
        let s = l.b[r];
        const w = l.W[r];
        for (let k = 0; k < w.length; k++) s += w[k] * h[k];
        o[r] = i < L.length - 1 ? s / (1 + Math.exp(-s)) : Math.log1p(Math.exp(s)); // SiLU, softplus out
      }
      h = o;
    });
    const conv = new Array(p.years).fill(0);
    for (let t = 0; t < Math.min(this.K, p.years); t++) conv[t] = h[t] * p.ira;
    return conv;
  }
  // A few steps of projected gradient descent starting from the autopilot's guess.
  refine(p, conv, steps = 25) {
    const m = makeModel(p);
    let c = conv.slice(), best = { conv: c.slice(), obj: run(m, c).objective };
    for (let k = 0; k < steps; k++) {
      const { g } = gradient(m, c);
      const lr = 15000 * Math.pow(0.9, k);
      c = c.map((v, t) => (t < this.K ? Math.max(0, v - lr * g[t]) : 0));
      const o = run(m, c).objective;
      if (o < best.obj) best = { conv: c.slice(), obj: o };
    }
    return best;
  }
}

export function householdParams(h) {
  // Money Finder household → Roth model parameters
  const age = Math.round(h.age);
  return { age, ira: Math.max(1, h.ira), ss: h.ss, other: h.other, heirRate: h.heirRate, draw: h.draw, growth: h.growth ?? 0.045, years: 95 - age, rmdAge: age <= 66 ? 75 : 73, irmaa: true };
}
