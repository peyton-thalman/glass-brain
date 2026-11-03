// Four made-up households of the kind an advisor meets in a 55+ retirement town in the Phoenix suburbs.
// None of them is a real client. Each is built to show one way a plan breaks that a single
// probability number hides: a single-life pension, a care event, a bad first decade, or no cushion at all.
//
// The intake (household.js) edits these "facts" objects; toPlan() turns facts into a planning engine Plan.

export const NOW = 2026;

export const FAMILIES = [
  {
    id: 'kowalski',
    name: 'Dale & Marilyn Kowalski',
    tagline: 'Auto-plant pension, single-life payout, 7 years apart',
    story: 'Moved down from Michigan in 2015. Dale took the single-life option on his pension because the check was bigger. Marilyn keeps the books.',
    people: [
      { first: 'Dale', age: 78, sex: 'M', health: 'average', planTo: 92, retiredAt: 62, ssMonthly: 2900, claimAge: 65 },
      { first: 'Marilyn', age: 71, sex: 'F', health: 'good', planTo: 96, retiredAt: 60, ssMonthly: 1150, claimAge: 62 },
    ],
    pensions: [{ name: 'Auto-plant pension', owner: 0, monthly: 3100, cola: false, survivorPct: 0 }],
    accounts: { ira: [640000, 85000], roth: 0, taxable: 120000, basis: 90000, cash: 60000 },
    home: { value: 385000, open: true, downsize: false, downsizeYear: 2030, netProceeds: 120000 },
    spending: { core: 6500, survivorPct: 80, wants: [{ name: 'Trips to see the grandkids', yearly: 9000, years: 10 }], gifts: 6000, legacy: 0 },
    invest: { portfolio: 3, fees: 1.25 },
    feelings: { cutOk: 'some', priority: 'spouse', worry: 'survivor' },
  },
  {
    id: 'pederson',
    name: 'Joan Pederson',
    tagline: 'Widowed teacher, solid pension, worried about care',
    story: 'Retired Minnesota schoolteacher, widowed in 2021. Plays bridge three days a week. Her mother needed five years of memory care.',
    people: [
      { first: 'Joan', age: 74, sex: 'F', health: 'good', planTo: 97, retiredAt: 60, ssMonthly: 1400, claimAge: 67 },
    ],
    pensions: [{ name: 'Teachers retirement pension', owner: 0, monthly: 3800, cola: true, survivorPct: 0 }],
    accounts: { ira: [410000], roth: 35000, taxable: 220000, basis: 150000, cash: 45000 },
    home: { value: 340000, open: false, downsize: false, downsizeYear: 2032, netProceeds: 150000 },
    spending: { core: 5200, survivorPct: 100, wants: [{ name: 'Church mission trips', yearly: 5000, years: 8 }], gifts: 10000, legacy: 150000 },
    invest: { portfolio: 2, fees: 1.25 },
    feelings: { cutOk: 'some', priority: 'legacy', worry: 'care' },
  },
  {
    id: 'alvarez',
    name: 'Rick & Sue Alvarez',
    tagline: 'Just retired, big 401(k), first decade decides everything',
    story: 'Engineer and nurse from the Chicago suburbs, retired this spring. Big travel plans, a cabin in Wisconsin, and almost everything in pre-tax money.',
    people: [
      { first: 'Rick', age: 65, sex: 'M', health: 'good', planTo: 94, retiredAt: 65, ssMonthly: 3600, claimAge: 67 },
      { first: 'Sue', age: 63, sex: 'F', health: 'excellent', planTo: 97, retiredAt: 63, ssMonthly: 2100, claimAge: 64 },
    ],
    pensions: [],
    accounts: { ira: [1550000, 380000], roth: 90000, taxable: 260000, basis: 200000, cash: 80000 },
    home: { value: 520000, open: true, downsize: false, downsizeYear: 2036, netProceeds: 180000 },
    spending: { core: 9000, survivorPct: 75, wants: [{ name: 'Travel', yearly: 25000, years: 10 }, { name: 'Cabin upkeep', yearly: 9000, years: 15 }], gifts: 0, legacy: 0 },
    invest: { portfolio: 4, fees: 1.25 },
    feelings: { cutOk: 'some', priority: 'spend', worry: 'market' },
  },
  {
    id: 'hoffman',
    name: 'Gary & Linda Hoffman',
    tagline: 'Social Security, a modest IRA, no room for surprises',
    story: 'Ran a hardware store in Iowa for 30 years and sold it for less than they hoped. Both claimed Social Security early. Linda still works mornings at the rec center.',
    people: [
      { first: 'Gary', age: 70, sex: 'M', health: 'poor', planTo: 90, retiredAt: 64, ssMonthly: 2300, claimAge: 62 },
      { first: 'Linda', age: 68, sex: 'F', health: 'good', planTo: 95, retiredAt: 66, ssMonthly: 1250, claimAge: 62 },
    ],
    pensions: [{ name: 'Linda’s rec-center job', owner: 1, monthly: 900, cola: false, survivorPct: 0, endAge: 71 }],
    accounts: { ira: [265000, 90000], roth: 0, taxable: 0, basis: 0, cash: 40000 },
    home: { value: 310000, open: true, downsize: false, downsizeYear: 2029, netProceeds: 110000 },
    spending: { core: 3700, survivorPct: 80, wants: [{ name: 'Visiting family in Iowa', yearly: 4000, years: 10 }], gifts: 0, legacy: 0 },
    invest: { portfolio: 3, fees: 1.25 },
    feelings: { cutOk: 'yes', priority: 'spend', worry: 'running-out' },
  },
];

export const PORTFOLIO_NAMES = ['Cash', 'Conservative', 'Mod. conservative', 'Moderate', 'Mod. aggressive', 'Aggressive', 'All equity'];

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Turn intake facts into a planning engine Plan. `P` is the planner bundle (for normalizePlan). */
export function toPlan(P, f) {
  const person = (p, i) => ({
    firstName: p.first, lastName: f.name.split(' ').pop(), birthYear: NOW - p.age, sex: p.sex, health: p.health,
    retirementAge: p.retiredAt, acceptableRetirementAge: p.retiredAt, planningAge: Math.max(p.planTo, p.age + 1),
    salary: 0, ssPia: p.ssMonthly, ssClaimAge: p.claimAge, lifeInsurance: 0,
  });
  const owner = (i) => (i === 0 ? 'client' : 'spouse');
  const a = f.accounts;
  const acct = (id, name, ownerKey, type, balance, basis) => ({ id, name, owner: ownerKey, type, balance, basis, annualSavings: 0, savingsIncrease: 0 });
  const accounts = [
    ...a.ira.map((b, i) => acct('ira' + i, `${f.people[i].first}’s IRA`, owner(i), 'deferred', b, 0)),
    acct('roth', 'Roth IRA', 'client', 'roth', a.roth, a.roth),
    acct('taxable', 'Brokerage', 'joint', 'taxable', a.taxable, Math.min(a.basis, a.taxable)),
    acct('cash', 'Cash & CDs', 'joint', 'cash', a.cash, a.cash),
  ].filter((x) => x.balance > 0);
  const s = f.spending;
  const goal = (id, type, name, amount, priority, extra = {}) => ({
    id, type, name, priority, amount, acceptable: amount, atRetirement: false, startYear: NOW, years: 0, repeatEvery: 0, survivorPct: 100, enabled: amount > 0, ...extra,
  });
  const core = s.core * 12;
  const goals = [
    goal('core', 'retirement', 'Everyday living', core, 10, { acceptable: Math.round(core * (f.feelings.cutOk === 'no' ? 1 : f.feelings.cutOk === 'some' ? 0.9 : 0.8)), atRetirement: true, survivorPct: s.survivorPct }),
    ...s.wants.map((w, i) => goal('want' + i, 'travel', w.name, w.yearly, 6, { years: w.years, acceptable: 0 })),
    goal('gifts', 'other', 'Gifts to family', s.gifts, 4, { acceptable: 0 }),
    goal('legacy', 'legacy', 'Leave to heirs', s.legacy, 3, { acceptable: 0 }),
  ];
  const income = f.pensions.map((p, i) => ({
    id: 'pen' + i, name: p.name, owner: owner(p.owner), annualAmount: p.monthly * 12,
    startAge: Math.min(f.people[p.owner].age, f.people[p.owner].retiredAt), endAge: p.endAge ?? 0, cola: p.cola, survivorPct: p.survivorPct,
  }));
  const plan = {
    client: person(f.people[0], 0),
    spouse: f.people[1] ? person(f.people[1], 1) : null,
    accounts, goals, income,
    inflows: f.home.downsize ? [{ id: 'downsize', name: 'Downsize the house', year: f.home.downsizeYear, amount: f.home.netProceeds, gainPct: 0 }] : [],
    otherAssets: [{ id: 'home', name: 'Home', kind: 'home', value: f.home.value }],
    liabilities: [],
    assumptions: {
      inflation: 0.025, medicalInflation: 0.05, fees: f.invest.fees / 100, stateRate: 0.025, stateTaxesSS: false, heirTaxRate: 0.22,
      preRetPortfolio: f.invest.portfolio, postRetPortfolio: f.invest.portfolio, ssReduction: false, returns: 'montecarlo', longevity: 'planning',
    },
    riskAnswers: [2, 2, 2, 2, 2],
  };
  return P.normalizePlan(clone(plan));
}
