// The trained network, run in the browser. Holds the live (editable) weights,
// per-neuron gain dials, and decodes the three outputs.

export class Brain {
  constructor(data) {
    this.data = data;
    this.sizes = data.sizes;
    this.features = data.features;
    this.load(data.final);
    this.original = this.cloneLayers();
  }

  load(layers) {
    this.layers = layers.map((l) => ({
      W: Float32Array.from(l.W.flat()),
      b: Float32Array.from(l.b),
      rows: l.W.length,
      cols: l.W[0].length,
    }));
    // gain[layer][neuron]: 1 = untouched, 0 = silenced, 2 = doubled. Hidden layers only.
    this.gain = this.sizes.slice(1, -1).map((n) => new Float32Array(n).fill(1));
    // freeze[layer][neuron]: NaN = live, otherwise the neuron always outputs this value
    // (mean-ablation: it stops carrying information but keeps its average contribution).
    this.freeze = this.sizes.slice(1, -1).map((n) => new Float32Array(n).fill(NaN));
  }

  cloneLayers() {
    return this.layers.map((l) => ({ W: l.W.slice(), b: l.b.slice(), rows: l.rows, cols: l.cols }));
  }

  reset() {
    this.layers = this.original.map((l) => ({ W: l.W.slice(), b: l.b.slice(), rows: l.rows, cols: l.cols }));
    this.gain.forEach((g) => g.fill(1));
    this.freeze.forEach((f) => f.fill(NaN));
  }

  // How many weights differ from the trained brain (gain dials count every outgoing weight they scale).
  editCount() {
    let n = 0;
    this.layers.forEach((l, i) => {
      const o = this.original[i];
      for (let j = 0; j < l.W.length; j++) if (Math.abs(l.W[j] - o.W[j]) > 1e-6) n++;
      for (let j = 0; j < l.b.length; j++) if (Math.abs(l.b[j] - o.b[j]) > 1e-6) n++;
    });
    this.gain.forEach((g, li) => {
      const next = this.layers[li + 1];
      g.forEach((v, ni) => { if (v !== 1 || !isNaN(this.freeze[li][ni])) n += next.rows; });
    });
    return n;
  }

  // Cut input j out of the brain as if it always read `value` (encoded): zero its weights, fold into biases.
  pinInput(j, value) {
    const l = this.layers[0];
    for (let r = 0; r < l.rows; r++) {
      l.b[r] += l.W[r * l.cols + j] * value;
      l.W[r * l.cols + j] = 0;
    }
  }

  totalWeights() {
    return this.layers.reduce((s, l) => s + l.W.length, 0);
  }

  encode(c) {
    return this.features.map((f) => {
      let x = c[f.name], lo = f.lo, hi = f.hi;
      if (f.scale === 'log') { x = Math.log(x); lo = Math.log(lo); hi = Math.log(hi); }
      return 2 * (x - lo) / (hi - lo) - 1;
    });
  }

  // Returns every layer's activations, input to output (output is raw logits).
  forward(x, opts = {}) {
    const acts = [Float32Array.from(x)];
    let h = acts[0];
    const last = this.layers.length - 1;
    for (let i = 0; i <= last; i++) {
      const { W, b, rows, cols } = this.layers[i];
      const out = new Float32Array(rows);
      for (let r = 0; r < rows; r++) {
        let s = b[r];
        const off = r * cols;
        for (let k = 0; k < cols; k++) s += W[off + k] * h[k];
        if (i < last) {
          s = s > 0 ? s : 0;
          const fz = this.freeze[i][r];
          if (fz === fz) s = fz;
          s *= this.gain[i][r];
          if (opts.clamp && opts.clamp[i] && opts.clamp[i][r] !== undefined) s = opts.clamp[i][r];
        }
        out[r] = s;
      }
      acts.push(out);
      h = out;
    }
    return acts;
  }

  static decode(o) {
    return {
      success: 1 / (1 + Math.exp(-o[0])),
      legacy: Math.max(0, Math.pow(10, o[1] * 3.3 + 4) - 1e4),
      brokeYears: Math.max(0, Math.expm1(o[2] * 3)),
    };
  }

  predict(c, opts) {
    const acts = this.forward(this.encode(c), opts);
    return { acts, ...Brain.decode(acts[acts.length - 1]) };
  }
}
