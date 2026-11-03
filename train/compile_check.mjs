// Prove the hand-compiled network equals the planning engine: 1,000,000 random returns.
import { compileLaw, runCompiled, countCompiled, weightDiff } from '../web/js/compile.js';
import { engineTax, LAW } from '../web/js/taxread.js';
for (const year of [2025, 2026]) {
  const net = compileLaw(LAW[year]);
  let max = 0, worst = null, t0 = Date.now();
  for (let i = 0; i < 1_000_000; i++) {
    const o = Math.random() < 0.3 ? Math.random() * 120000 : Math.random() * 900000, s = Math.random() < 0.1 ? 0 : Math.random() * 110000, g = Math.random() < 0.3 ? 0 : Math.random() * 700000;
    const e = Math.abs(runCompiled(net, o, s, g) - engineTax(o, s, g, LAW[year]).federal);
    if (e > max) { max = e; worst = [o, s, g]; }
  }
  console.log(year, countCompiled(net), 'max error $' + max.toFixed(6), worst?.map(Math.round), `${Date.now() - t0}ms`);
}
const d = weightDiff(compileLaw(LAW[2025]), compileLaw(LAW[2026]));
console.log('2025 → 2026 law change =', d.length, 'weight edits');
d.forEach((x) => console.log('  ', x.neuron.padEnd(28), x.what.padEnd(26), x.from, '→', x.to));
