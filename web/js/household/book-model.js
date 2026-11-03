// The Book: thousands of made-up households like the ones in a 55+ town outside Phoenix, generated from a seed,
// plus the feature encoding the Book Brain reads. Shared by train/bookdata.mjs and the browser, so the network
// sees exactly the facts it was trained on.

import { NOW } from './families.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_M = ['Dale', 'Gary', 'Ron', 'Jim', 'Bob', 'Larry', 'Dennis', 'Roger', 'Jerry', 'Wayne', 'Terry', 'Frank', 'Ken', 'Carl', 'Doug', 'Rick', 'Steve', 'Bill', 'Don', 'Ray', 'Glen', 'Lyle', 'Marv', 'Duane'];
const FIRST_F = ['Marilyn', 'Linda', 'Joan', 'Carol', 'Sue', 'Barb', 'Judy', 'Diane', 'Karen', 'Sharon', 'Donna', 'Janet', 'Pat', 'Nancy', 'Bev', 'Connie', 'Gail', 'Peggy', 'Deb', 'Lois', 'Arlene', 'Kathy', 'Rita', 'Jean'];
const LAST = ['Olson', 'Kowalski', 'Hansen', 'Becker', 'Schmidt', 'Larson', 'Novak', 'Meyer', 'Jensen', 'Wagner', 'Kraus', 'Peterson', 'Hoffman', 'Brandt', 'Lindqvist', 'Dvorak', 'Mueller', 'Sorensen', 'Weber', 'Quinn', 'Moreno', 'Haugen', 'Fischer', 'Ruiz', 'Nygaard', 'Kessler', 'Brooks', 'Duffy', 'Halvorsen', 'Vance'];
const JOBS = ['Auto-plant pension', 'Teachers pension', 'State pension', 'Union pension', 'Utility pension', 'Railroad pension', 'County pension', 'Airline pension'];

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const weighted = (r, pairs) => { let u = r() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) if ((u -= w) <= 0) return v; return pairs[0][0]; };
const logn = (r, median, spread) => median * Math.exp(spread * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()));
const round = (x, k) => Math.round(x / k) * k;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const HEALTH = ['poor', 'average', 'good', 'excellent'];
const LIFE = { poor: 87, average: 91, good: 94, excellent: 97 };

/** One household in the same "facts" shape the X-ray intake edits. */
/** `wr` is the range of withdrawal rates spending is drawn from: wide for training, closer to a real book for the demo. */
export function sampleHousehold(r, id, wr = [0.015, 0.075]) {
  const couple = r() < 0.62;
  const age0 = Math.round(clamp(62 + Math.pow(r(), 0.9) * 28, 62, 91));
  const sex0 = couple ? 'M' : r() < 0.72 ? 'F' : 'M';
  const person = (age, sex) => {
    const health = weighted(r, [['poor', 12], ['average', 35], ['good', 38], ['excellent', 15]]);
    const planTo = Math.max(age + 3, LIFE[health] + Math.round((r() - 0.5) * 4) + (sex === 'F' ? 2 : 0));
    const retiredAt = Math.min(age, Math.round(57 + r() * 10));
    let claimAge = weighted(r, [[62, 30], [65, 12], [66, 14], [67, 20], [68, 6], [70, 18]]);
    if (age >= 70) claimAge = Math.min(claimAge, 70);
    return { first: pick(r, sex === 'M' ? FIRST_M : FIRST_F), age, sex, health, planTo, retiredAt, ssMonthly: round(900 + r() * 2900, 10), claimAge };
  };
  const people = [person(age0, sex0)];
  if (couple) people.push(person(clamp(age0 + Math.round((r() - 0.65) * 12), 60, 95), 'F'));
  if (couple) people[1].ssMonthly = round(people[1].ssMonthly * (0.45 + r() * 0.5), 10);

  const pensions = [];
  if (r() < 0.45) pensions.push({ name: pick(r, JOBS), owner: 0, monthly: round(400 + Math.pow(r(), 1.4) * 4200, 25), cola: r() < 0.35, survivorPct: couple ? weighted(r, [[0, 30], [50, 35], [75, 10], [100, 25]]) : 0 });
  if (couple && r() < 0.2) pensions.push({ name: pick(r, JOBS), owner: 1, monthly: round(300 + r() * 2200, 25), cola: r() < 0.35, survivorPct: weighted(r, [[0, 40], [50, 35], [100, 25]]) });
  const working = people.map((p, i) => [p, i]).filter(([p]) => p.age < 72);
  if (working.length && r() < 0.1) {
    const [p, i] = pick(r, working);
    pensions.push({ name: 'Part-time job', owner: i, monthly: round(500 + r() * 1800, 50), cola: false, survivorPct: 0, endAge: p.age + 1 + Math.floor(r() * 4) });
  }

  const ira = people.map((_, i) => (r() < (i ? 0.25 : 0.1) ? 0 : round(logn(r, i ? 90000 : 320000, 0.9), 1000)));
  const roth = r() < 0.6 ? 0 : round(logn(r, 60000, 0.9), 1000);
  const taxable = r() < 0.45 ? 0 : round(logn(r, 160000, 1.0), 1000);
  const cash = round(10000 + r() * 90000, 1000);
  const investable = ira.reduce((s, x) => s + x, 0) + roth + taxable + cash;

  // Spend about what the money supports, with a wide spread, so the book holds every kind of plan.
  const ss = people.reduce((s, p) => s + p.ssMonthly, 0) * 12 * 0.92;
  const pen = pensions.reduce((s, p) => s + p.monthly, 0) * 12;
  const wantsN = r() < 0.5 ? 1 : 0;
  const wants = wantsN ? [{ name: weighted(r, [['Travel', 3], ['Visiting the grandkids', 2], ['Cabin upkeep', 1], ['RV trips', 1]]), yearly: round(3000 + r() * 20000, 500), years: 5 + Math.floor(r() * 8) }] : [];
  const gifts = r() < 0.25 ? round(2000 + r() * 12000, 500) : 0;
  const legacy = r() < 0.15 ? round(50000 + r() * 250000, 10000) : 0;
  const want = wants.reduce((s, w) => s + w.yearly, 0) * 0.6 + gifts;
  const core = round(clamp(((ss + pen) * 0.85 + investable * (wr[0] + r() * (wr[1] - wr[0])) - want) / 12, 1800, 16000), 100);

  const last = pick(r, LAST);
  const home = round(250000 + Math.pow(r(), 1.3) * 420000, 5000);
  return {
    id, name: couple ? `${people[0].first} & ${people[1].first} ${last}` : `${people[0].first} ${last}`,
    tagline: '', story: '',
    people, pensions,
    accounts: { ira, roth, taxable, basis: round(taxable * (0.5 + r() * 0.4), 1000), cash },
    home: { value: home, open: r() < 0.5, downsize: false, downsizeYear: NOW + 2 + Math.floor(r() * 5), netProceeds: round(home * (0.25 + r() * 0.2), 5000) },
    spending: { core, survivorPct: couple ? round(70 + r() * 15, 5) : 100, wants, gifts, legacy },
    invest: { portfolio: weighted(r, [[1, 15], [2, 30], [3, 35], [4, 15], [5, 5]]), fees: Math.round((0.9 + r() * 0.7) * 20) / 20 },
    feelings: { cutOk: weighted(r, [['no', 2], ['some', 5], ['yes', 3]]), priority: weighted(r, [['spend', 4], ['spouse', couple ? 3 : 0], ['legacy', 2]]), worry: weighted(r, [['running-out', 4], ['care', 3], ['market', 2], ['survivor', couple ? 2 : 0]]) },
  };
}

export function makeBook(n = 4000, seed = 20261103) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => sampleHousehold(r, 'h' + i, [0.012, 0.05]));
}

// ---------------------------------------------------------------- the market

/** Stock share of each model portfolio (Cash … All equity), from the engine's capital market assumptions. */
export const EQUITY = [0, 0.25, 0.43, 0.6, 0.75, 0.88, 1];

/** A household's facts after the S&P moves by `spx` (−0.3 = down 30%) from the day the plan was made. Bonds and cash held flat. */
export function applyMarket(f, spx) {
  if (!spx) return f;
  const k = 1 + spx * EQUITY[f.invest.portfolio];
  const a = f.accounts;
  return { ...f, accounts: { ...a, ira: a.ira.map((x) => x * k), roth: a.roth * k, taxable: a.taxable * k, basis: a.basis } };
}

// ---------------------------------------------------------------- what the Book Brain reads

export const lg = (x, hi) => (2 * Math.log1p(Math.max(0, x) / 10000)) / Math.log1p(hi / 10000) - 1;
const lin = (x, lo, hi) => (2 * (x - lo)) / (hi - lo) - 1;

export const FEATURE_NAMES = [
  'Age', 'Married', 'Spouse age gap', 'Life expectancy', 'Spouse life expectancy', 'Health', 'Spouse health',
  'Social Security', 'Spouse Social Security', 'Claim age', 'Already claimed', 'Spouse claim age', 'Spouse already claimed',
  'Pension', 'Pension survivor share', 'Spouse pension', 'Spouse pension survivor share', 'Pension COLA', 'Part-time work', 'Years of work left',
  'IRA', 'Spouse IRA', 'Roth', 'Brokerage', 'Cash', 'Cost basis',
  'Everyday spending', 'Survivor spending', 'Travel & goals', 'Years of goals', 'Gifts', 'Legacy goal',
  'Stock / bond mix', 'Fees',
];

/** The trained heads, in output order. `event` is what the X-ray turns on to reproduce each one. */
export const HEADS = [
  { id: 'base', label: 'The plan as it is' },
  { id: 'death0', label: 'First spouse dies in 4 years' },
  { id: 'death1', label: 'Second spouse dies in 4 years' },
  { id: 'ltc', label: 'Three years of care' },
  { id: 'crash', label: 'Another crash from here' },
  { id: 'ssCut', label: 'Social Security cut 23%' },
  { id: 'inflation', label: 'Inflation 1% hotter' },
];

/** The events the X-ray uses for each head, so a head's label equals what the X-ray shows. */
export function headEvents(f) {
  const p = f.people;
  const ev = {
    base: {},
    death0: p.length === 2 ? { death0: Math.min(p[0].planTo - 1, p[0].age + 4) } : null,
    death1: p.length === 2 ? { death1: Math.min(p[1].planTo - 1, p[1].age + 4) } : null,
    ltc: { ltc: Math.max(85, p[0].age + 3) },
    crash: { crash: true },
    ssCut: { ssCut: true },
    inflation: { inflation: true },
  };
  return HEADS.map((h) => ev[h.id]);
}

/** The four inputs a market move changes (IRA, spouse IRA, Roth, brokerage): feature index and log-scale top. */
export const BALANCE_INPUTS = [[20, 4e6], [21, 2e6], [22, 1.5e6], [23, 3e6]];
/** Per household: IRA, spouse IRA, Roth, brokerage, and the brokerage's cost basis (input 25 is basis ÷ brokerage). */
export const balances = (f) => [f.accounts.ira[0] || 0, f.accounts.ira[1] || 0, f.accounts.roth, f.accounts.taxable, f.accounts.basis];

export function features(f) {
  const [a, b] = f.people;
  const H = (p) => (p ? ['poor', 'average', 'good', 'excellent'].indexOf(p.health) / 1.5 - 1 : 0);
  const pen = (i) => f.pensions.filter((x) => x.owner === i && x.endAge == null);
  const job = f.pensions.filter((x) => x.endAge != null);
  const sum = (xs) => xs.reduce((s, x) => s + x.monthly, 0);
  const surv = (xs) => (sum(xs) > 0 ? xs.reduce((s, x) => s + x.monthly * x.survivorPct, 0) / sum(xs) / 100 : 0);
  const all = f.pensions.filter((x) => x.endAge == null);
  const colaShare = sum(all) > 0 ? all.filter((x) => x.cola).reduce((s, x) => s + x.monthly, 0) / sum(all) : 0;
  const jobYears = job.length ? Math.max(...job.map((x) => x.endAge - f.people[x.owner].age)) : 0;
  const ac = f.accounts, s = f.spending;
  const wantY = s.wants.reduce((t, w) => t + w.yearly, 0);
  const wantN = s.wants.length ? s.wants.reduce((t, w) => t + w.years * w.yearly, 0) / Math.max(1, wantY) : 0;
  return [
    lin(a.age, 60, 95), b ? 1 : -1, b ? lin(b.age - a.age, -15, 10) : 0,
    lin(a.planTo - a.age, 0, 40), b ? lin(b.planTo - a.age, 0, 45) : -1, H(a), b ? H(b) : 0,
    lin(a.ssMonthly, 0, 4000), b ? lin(b.ssMonthly, 0, 4000) : -1,
    lin(a.claimAge, 62, 70), a.claimAge <= a.age ? 1 : -1, b ? lin(b.claimAge, 62, 70) : 0, b ? (b.claimAge <= b.age ? 1 : -1) : 0,
    lg(sum(pen(0)) * 12, 60000), surv(pen(0)) * 2 - 1, b ? lg(sum(pen(1)) * 12, 40000) : -1, b ? surv(pen(1)) * 2 - 1 : 0, colaShare * 2 - 1,
    lg(sum(job) * 12, 40000), lin(jobYears, 0, 6),
    lg(ac.ira[0] || 0, 4e6), lg(ac.ira[1] || 0, 2e6), lg(ac.roth, 1.5e6), lg(ac.taxable, 3e6), lg(ac.cash, 3e5),
    ac.taxable > 0 ? (2 * Math.min(ac.basis, ac.taxable)) / ac.taxable - 1 : 0,
    lg(s.core * 12, 200000), b ? lin(s.survivorPct, 50, 100) : 1, lg(wantY, 60000), lin(wantN, 0, 15), lg(s.gifts, 30000), lg(s.legacy, 500000),
    lin(f.invest.portfolio, 1, 5), lin(f.invest.fees, 0.5, 2),
  ];
}
