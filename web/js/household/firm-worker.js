// One slice of the firm: this worker makes its own advisors' households from a seed, encodes them once, and on
// each market move re-scores them with the Book Brain and reports per advisor how many plans are below 75%.
import { rng, sampleHousehold, features, balances, lg, BALANCE_INPUTS, EQUITY, BONDS } from './book-model.js';

let L, X, B, EQ, BD, INV, RISKY, P0, per, adv, n, d, x, bufs;

function base(i, spx, bond) {
  x.set(X.subarray(i * d, i * d + d));
  const k = 1 + spx * EQ[i] + bond * BD[i];
  for (let j = 0; j < 4; j++) x[BALANCE_INPUTS[j][0]] = lg(B[i * 5 + j] * k, BALANCE_INPUTS[j][1]);
  const tk = B[i * 5 + 3] * k;
  x[25] = tk > 0 ? (2 * Math.min(B[i * 5 + 4], tk)) / tk - 1 : 0;
  let h = x;
  const last = L.length - 1;
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
  return 100 / (1 + Math.exp(-h[0]));
}

self.onmessage = ({ data }) => {
  if (data.init) {
    L = data.layers.map((l) => ({ W: Float32Array.from(l.W.flat()), b: Float32Array.from(l.b), out: l.W.length, inp: l.W[0].length }));
    ({ per, adv } = data);
    n = per * adv; d = L[0].inp;
    const r = rng(data.seed), fs = Array.from({ length: n }, (_, i) => sampleHousehold(r, 'f' + i, [0.012, 0.05]));
    X = new Float32Array(fs.flatMap(features)); B = new Float32Array(fs.flatMap(balances));
    EQ = Float32Array.from(fs, (f) => EQUITY[f.invest.portfolio]); BD = Float32Array.from(fs, (f) => BONDS[f.invest.portfolio]);
    RISKY = Float64Array.from(fs, (f) => f.accounts.ira.reduce((t, v) => t + v, 0) + f.accounts.roth + f.accounts.taxable);
    INV = Float64Array.from(fs, (f, i) => RISKY[i] + f.accounts.cash);
    x = new Float32Array(d); bufs = L.map((l) => new Float32Array(l.out));
    P0 = Float32Array.from({ length: n }, (_, i) => base(i, 0, 0));
    self.postMessage({ ready: true, aum: INV.reduce((t, v) => t + v, 0) });
    return;
  }
  const { spx, bond, id } = data;
  const below = new Int32Array(adv), fresh = new Int32Array(adv), money = new Float64Array(adv);
  for (let i = 0; i < n; i++) {
    const p = base(i, spx, bond), a = Math.floor(i / per);
    if (p < 75) { below[a]++; money[a] += INV[i] + RISKY[i] * (spx * EQ[i] + bond * BD[i]); if (P0[i] >= 75) fresh[a]++; }
  }
  self.postMessage({ id, below, fresh, money }, [below.buffer, fresh.buffer, money.buffer]);
};
