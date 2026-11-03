// Roth conversions by gradient descent through the tax code.
// The tax law is a neural network (compile.js), so lifetime tax is differentiable in every year's conversion.
// We unroll a couple's retirement year by year (IRA growth, conversions, RMDs, the compiled 2026 tax network),
// and descend on the conversion schedule to minimize lifetime federal tax + IRMAA + the tax heirs pay on
// whatever IRA is left.
import { compileLaw, runCompiled } from './compile.js';
import { engineTax, engineIrmaa, LAW } from './taxread.js';

const ULT = [27.4, 26.5, 25.5, 24.6, 23.7, 22.9, 22.0, 21.1, 20.2, 19.4, 18.5, 17.7, 16.8, 16.0, 15.2, 14.4, 13.7, 12.9, 12.2, 11.5, 10.8, 10.1, 9.5, 8.9, 8.4, 7.8, 7.3, 6.8, 6.4, 6.0];
const divisor = (age) => ULT[Math.min(ULT.length - 1, Math.max(0, age - 72))];

export function makeModel(p) {
  // p: { age, ira, ss, other, growth, years, heirRate, rmdAge, irmaa }
  const net = compileLaw(LAW[2026]);
  const tax = (ord, ss) => runCompiled(net, ord, ss, 0);
  // gradient of tax w.r.t. ordinary income by backprop through the compiled ReLU network
  const dtax = (ord, ss) => {
    const acts = runCompiled(net, ord, ss, 0, true);
    let g = net.at(-1).W[0].slice();
    for (let li = net.length - 2; li >= 0; li--) {
      const l = net[li], out = acts[li + 1], prev = new Array(l.W[0].length).fill(0);
      l.W.forEach((row, r) => { if (out[r] > 0) row.forEach((w, k) => { prev[k] += g[r] * w; }); });
      g = prev;
    }
    return g[0];
  };
  return { p, tax, dtax, net };
}

// Run the plan forward. conv[t] = Roth conversion in year t. Returns yearly rows and the objective.
export function run(model, conv, withGrad = false) {
  const { p, tax, dtax } = model;
  let ira = p.ira, roth = 0;
  const rows = [];
  let total = 0, irmaaTotal = 0;
  const marg = [];
  const draw = p.draw || 0; // IRA withdrawals the household needs for spending each year
  const binding = [];
  for (let t = 0; t < p.years; t++) {
    const age = p.age + t;
    const rmd0 = age >= p.rmdAge ? ira / divisor(age) : 0;
    const rmd = Math.min(ira, Math.max(rmd0, draw));
    binding.push(rmd0 >= draw && rmd < ira ? 'rmd' : rmd >= ira ? 'empty' : 'draw');
    const c = Math.min(Math.max(0, conv[t] || 0), Math.max(0, ira - rmd));
    const ord = p.other + rmd + c;
    const tx = tax(ord, p.ss);
    const magi = engineTax(ord, p.ss, 0).magi;
    const irm = p.irmaa ? engineIrmaa(magi) : 0;
    total += tx; irmaaTotal += irm;
    rows.push({ t, age, ira, rmd, conv: c, ord, tax: tx, irmaa: irm, magi, roth });
    if (withGrad) marg.push(dtax(ord, p.ss));
    ira = (ira - rmd - c) * (1 + p.growth);
    roth = (roth + c) * (1 + p.growth);
  }
  const heirs = ira * p.heirRate;
  return { rows, tax: total, irmaa: irmaaTotal, heirs, endIra: ira, endRoth: roth, objective: total + irmaaTotal + heirs, marg, binding };
}

// d objective / d conv[t]: today's marginal tax, minus the future taxes that dollar would have caused
// (RMDs it would have fed, and the heirs' tax on what's left), all through the compiled network's gradients.
export function gradient(model, conv) {
  const { p } = model;
  const r = run(model, conv, true);
  const T = p.years;
  // adjoint: value (in tax) of one more dollar of IRA at the start of year t
  const lam = new Array(T + 1).fill(0);
  lam[T] = p.heirRate;
  for (let t = T - 1; t >= 0; t--) {
    const age = p.age + t;
    const b = r.binding[t];
    // $1 more IRA → q more withdrawal taxed at marg[t], and (1−q)(1+g) more IRA next year.
    // When spending draws set the withdrawal, an extra dollar just rides along; when the IRA empties, it's withdrawn now.
    const q = b === 'empty' ? 1 : b === 'rmd' && age >= p.rmdAge ? 1 / divisor(age) : 0;
    lam[t] = q * r.marg[t] + (1 - q) * (1 + p.growth) * lam[t + 1];
  }
  // $1 more conversion in year t: taxed now at marg[t]; removes (1+g) dollars of IRA next year
  const g = conv.map((c, t) => r.marg[t] - (1 + p.growth) * lam[t + 1]);
  return { g, run: r };
}

// Projected gradient descent on the schedule. Yields each iterate so the UI can animate it.
export function* optimize(model, steps = 260) {
  const { p } = model;
  const T = p.years;
  let conv = new Array(T).fill(0);
  let best = { conv: conv.slice(), obj: run(model, conv).objective };
  const window = Math.max(0, p.rmdAge - p.age + 2);
  for (let k = 0; k < steps; k++) {
    const { g, run: r } = gradient(model, conv);
    const lr = 60000 * Math.pow(0.985, k);
    conv = conv.map((c, t) => (t < window ? Math.max(0, c - lr * g[t]) : 0));
    const obj = run(model, conv).objective;
    if (obj < best.obj) best = { conv: conv.slice(), obj };
    yield { k, conv, obj: r.objective, best };
  }
  // polish the best iterate by coordinate search, since the objective is piecewise linear
  let conv2 = best.conv.slice(), obj2 = best.obj;
  for (const step of [8000, 2000, 500]) {
    for (let pass = 0; pass < 3; pass++) {
      for (let t = 0; t < Math.min(T, window); t++) {
        for (const d of [step, -step]) {
          const tryC = conv2.slice(); tryC[t] = Math.max(0, tryC[t] + d);
          const o = run(model, tryC).objective;
          if (o < obj2 - 1) { conv2 = tryC; obj2 = o; }
        }
      }
    }
  }
  yield { k: steps, conv: conv2, obj: obj2, best: { conv: conv2, obj: obj2 }, done: true };
}

// The rules of thumb advisors use: convert each year up to the top of a bracket, until RMDs start.
export function fillBracket(model, rate) {
  const { p } = model;
  const top = { 0.12: 100800, 0.22: 211400, 0.24: 403550 }[rate];
  const conv = [];
  let ira = p.ira;
  for (let t = 0; t < p.years; t++) {
    const age = p.age + t;
    if (age >= p.rmdAge) { conv.push(0); continue; }
    // find ordinary income at which taxable income hits the bracket top (bisection on the engine)
    let lo = 0, hi = 800000;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (engineTax(m, p.ss, 0).taxableIncome < top) lo = m; else hi = m; }
    const wd = Math.min(ira, p.draw || 0);
    const c = Math.max(0, Math.min(ira - wd, lo - p.other - wd));
    conv.push(c);
    ira = (ira - wd - c) * (1 + p.growth);
  }
  return conv;
}
