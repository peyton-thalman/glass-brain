// One slice of the book, scored by the Book Brain on its own thread. The facts are encoded once; a market move
// only rescales the four balance inputs, so each frame is a forward pass and nothing else.
import { lg, BALANCE_INPUTS } from './book-model.js';

let L, X, B, EQ, BD, n, d, H, x, bufs;

self.onmessage = ({ data }) => {
  if (data.init) {
    L = data.layers.map((l) => ({ W: Float32Array.from(l.W.flat()), b: Float32Array.from(l.b), out: l.W.length, inp: l.W[0].length }));
    ({ X, B, EQ, BD } = data);
    n = EQ.length; d = L[0].inp; H = L[L.length - 1].out;
    x = new Float32Array(d);
    bufs = L.map((l) => new Float32Array(l.out));
    return;
  }
  const { spx, bond = 0, id } = data, out = new Float32Array(n * H), last = L.length - 1;
  for (let i = 0; i < n; i++) {
    x.set(X.subarray(i * d, i * d + d));
    const k = 1 + spx * EQ[i] + bond * BD[i];
    for (let j = 0; j < 4; j++) x[BALANCE_INPUTS[j][0]] = lg(B[i * 5 + j] * k, BALANCE_INPUTS[j][1]);
    const tk = B[i * 5 + 3] * k;
    x[25] = tk > 0 ? (2 * Math.min(B[i * 5 + 4], tk)) / tk - 1 : 0;
    let h = x;
    for (let li = 0; li <= last; li++) {
      const l = L[li], o = bufs[li], W = l.W, m = l.inp;
      for (let r = 0; r < l.out; r++) {
        let s = l.b[r];
        const off = r * m;
        for (let c = 0; c < m; c++) s += W[off + c] * h[c];
        o[r] = li < last ? s / (1 + Math.exp(-s)) : s;
      }
      h = o;
    }
    for (let j = 0; j < H; j++) out[i * H + j] = 100 / (1 + Math.exp(-h[j]));
  }
  self.postMessage({ id, out }, [out.buffer]);
};
