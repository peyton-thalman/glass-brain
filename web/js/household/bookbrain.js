// The Book Brain in the browser: a 34 → 128 → 128 → 64 → 7 SiLU network that reads a household's facts and
// returns the MoneyGuide engine's probability of success under the plan and six life events, in microseconds.

import { features } from './book-model.js';

export class BookBrain {
  constructor(d) {
    this.d = d;
    this.heads = d.heads;
    this.L = d.layers.map((l) => ({ W: Float32Array.from(l.W.flat()), b: Float32Array.from(l.b), out: l.W.length, inp: l.W[0].length }));
    this.buf = this.L.map((l) => new Float32Array(l.out));
  }

  /** Raw outputs (logits) for one encoded household. */
  logits(x) {
    let h = x;
    const last = this.L.length - 1;
    this.L.forEach((l, i) => {
      const o = this.buf[i], W = l.W, n = l.inp;
      for (let r = 0; r < l.out; r++) {
        let s = l.b[r];
        const off = r * n;
        for (let k = 0; k < n; k++) s += W[off + k] * h[k];
        o[r] = i < last ? s / (1 + Math.exp(-s)) : s;
      }
      h = o;
    });
    return h;
  }

  /** Probability of success (0–100) under every head. */
  predict(f) {
    const z = this.logits(features(f));
    return Array.from(z, (v) => 100 / (1 + Math.exp(-v)));
  }
}
