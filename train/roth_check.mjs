// Gradient-descent Roth schedule vs the fill-the-bracket rules of thumb, plus a gradient check.
import { makeModel, run, gradient, optimize, fillBracket } from '../web/js/roth.js';
const cases = [
  { age: 65, ira: 2_000_000, ss: 60000, other: 0, growth: 0.05, years: 30, heirRate: 0.24, rmdAge: 75, irmaa: true },
  { age: 63, ira: 900_000, ss: 45000, other: 10000, growth: 0.05, years: 32, heirRate: 0.12, rmdAge: 75, irmaa: true },
  { age: 66, ira: 4_000_000, ss: 70000, other: 20000, growth: 0.05, years: 29, heirRate: 0.35, rmdAge: 75, irmaa: true },
];
for (const p of cases) {
  const m = makeModel(p);
  // gradient check vs finite difference
  const conv = new Array(p.years).fill(30000);
  const { g } = gradient(m, conv);
  const fd = [0, 3, 7].map((t) => { const a = conv.slice(), b = conv.slice(); a[t] += 50; b[t] -= 50; return [g[t], (run(m, a).tax + run(m, a).heirs - run(m, b).tax - run(m, b).heirs) / 100]; });
  const show = (n, c) => { const r = run(m, c); return `${n.padEnd(10)} lifetime tax $${Math.round(r.tax).toLocaleString().padStart(9)}  IRMAA $${Math.round(r.irmaa).toLocaleString().padStart(7)}  heirs $${Math.round(r.heirs).toLocaleString().padStart(9)}  TOTAL $${Math.round(r.objective).toLocaleString()}`; };
  console.log(`\nIRA $${p.ira.toLocaleString()} age ${p.age} SS $${p.ss} heirs ${p.heirRate}`);
  console.log('  grad check', fd.map(([a, b]) => `${a.toFixed(3)}/${b.toFixed(3)}`).join('  '));
  console.log('  ' + show('none', new Array(p.years).fill(0)));
  for (const r of [0.12, 0.22, 0.24]) console.log('  ' + show(`fill ${r * 100}%`, fillBracket(m, r)));
  let last; const t0 = Date.now();
  for (const it of optimize(m)) last = it;
  console.log('  ' + show('gradient', last.conv), `(${Date.now() - t0}ms)`);
  console.log('   schedule:', last.conv.slice(0, 12).map((c) => Math.round(c / 1000) + 'k').join(' '));
}
