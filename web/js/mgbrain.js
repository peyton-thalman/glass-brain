// The MoneyGuide Brain: a smooth (SiLU) network trained to reproduce the MoneyGuide engine's probability of success.
export class MGBrain {
  constructor(d) {
    this.d = d;
    this.layers = d.layers.map((l) => ({ W: l.W, b: l.b }));
  }
  enc(f) {
    return this.d.features.map(({ name, kind, lo, hi }) => {
      if (kind === 'log') { const g = (v) => Math.log1p(Math.max(v, 0) / this.d.logK); return (2 * (g(f[name]) - g(lo))) / (g(hi) - g(lo)) - 1; }
      return (2 * (f[name] - lo)) / (hi - lo) - 1;
    });
  }
  forward(x) {
    let h = x;
    const last = this.layers.length - 1;
    this.layers.forEach((l, i) => {
      const o = new Array(l.W.length);
      for (let r = 0; r < l.W.length; r++) {
        let s = l.b[r];
        const w = l.W[r];
        for (let k = 0; k < w.length; k++) s += w[k] * h[k];
        o[r] = i < last ? s / (1 + Math.exp(-s)) : s;
      }
      h = o;
    });
    return h;
  }
  success(f) { return 100 / (1 + Math.exp(-this.forward(this.enc(f))[0])); }
  legacy(f) { return Math.max(0, Math.pow(10, this.forward(this.enc(f))[1] * 3.5 + 4) - 1e4); }
}
