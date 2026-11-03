// Training data for the Tax Brain: 2026 federal tax returns from the planning engine
// (web/js/vendor/taxlaw.js, bundled from ~/moneyguide/src/engine/tax.ts).
// A married couple, both 65+, 2026 law. Inputs: ordinary income (IRA/pension/Roth conversions),
// Social Security benefits, long-term gains + qualified dividends.
// Targets: federal income tax, the marginal rate on the next dollar of ordinary income, and the
// Medicare IRMAA surcharge (both spouses, annual) that this MAGI triggers two years later.
import fs from 'fs';
import { ENGINE } from './engine.mjs';
import * as T from '../web/js/vendor/taxlaw.js';

export const RANGE = { ord: 600_000, ss: 100_000, ltcg: 300_000 };

export function tax(ord, ss, ltcg, law) {
  return T.computeTax({ filing: 'mfj', year: 2026, index: 1, wages: 0, ordinary: ord, ltcg, ssBenefits: ss, over65: 2, stateRate: 0, stateTaxesSS: false, law });
}
export function irmaa(magi, law) {
  const tier = T.irmaaTier(magi, 'mfj', 1, law);
  return 2 * (T.medicareAnnual(tier, law) - T.medicareAnnual(0, law));
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Law variants used to train "vendor" brains for the audit demo.
export function variant(name) {
  const L = JSON.parse(JSON.stringify(T.LAW[2026], (k, v) => (v === Infinity ? '__inf' : v)), (k, v) => (v === '__inf' ? Infinity : v));
  if (name === 'no-senior') L.senior.amount = 0;            // software never updated for the OBBBA senior deduction
  if (name === 'law2025') return T.LAW[2025];
  return L;
}

export function build(n, seed, law) {
  const r = rng(seed);
  const X = new Float32Array(n * 3), Y = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Half the samples uniform, half concentrated below $250k where most retirees live and the law is busiest.
    const ord = r() < 0.5 ? r() * RANGE.ord : Math.pow(r(), 1.6) * 250_000;
    const ss = r() < 0.12 ? 0 : r() * RANGE.ss;
    const ltcg = r() < 0.35 ? 0 : Math.pow(r(), 1.5) * RANGE.ltcg;
    const t = tax(ord, ss, ltcg, law);
    const t2 = tax(ord + 100, ss, ltcg, law);
    X.set([ord / RANGE.ord, ss / RANGE.ss, ltcg / RANGE.ltcg], i * 3);
    Y.set([t.federal, (t2.federal - t.federal) / 100, irmaa(t.magi, law)], i * 3);
  }
  return { X, Y };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = +(process.argv[2] || 3_000_000);
  const v = process.argv[3] || '';
  const law = v ? variant(v) : undefined;
  const tag = v ? `_${v}` : '';
  const t0 = Date.now();
  for (const [name, count, seed] of [['train', n, 1], ['test', 50_000, 2]]) {
    const { X, Y } = build(count, seed, law);
    fs.writeFileSync(new URL(`./tax${tag}_${name}_X.f32`, import.meta.url), Buffer.from(X.buffer));
    fs.writeFileSync(new URL(`./tax${tag}_${name}_Y.f32`, import.meta.url), Buffer.from(Y.buffer));
    console.log(`${name}: ${count.toLocaleString()} returns`);
  }
  fs.writeFileSync(new URL(`./tax${tag}_meta.json`, import.meta.url), JSON.stringify({ engine: ENGINE, law: v || 'enacted' }));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
