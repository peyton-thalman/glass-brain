// A retired married couple on the MoneyGuide engine's own Chen sample household, varied across ten facts.
// Shared by the training-data generator (train/mgdata.mjs) and the browser, so both build identical plans.
export const FEATURES = [
  ['age', 60, 75], ['spouseGap', -6, 2], ['ira', 0, 4_000_000], ['roth', 0, 1_500_000], ['taxable', 0, 2_000_000],
  ['spending', 40_000, 220_000], ['pia', 1_000, 4_200], ['claimAge', 62, 70], ['portfolio', 1, 6], ['stateRate', 0, 0.093],
];

export function makePlan(M, f) {
  const base = M.sampleHouseholds().find((h) => /Chen/.test(h.name)).current;
  const plan = JSON.parse(JSON.stringify(base));
  const now = 2026;
  const age = Math.round(f.age), sAge = Math.round(f.age + f.spouseGap);
  Object.assign(plan.client, { birthYear: now - age, retirementAge: age, acceptableRetirementAge: age, salary: 0, ssPia: f.pia, ssClaimAge: Math.max(age, Math.round(f.claimAge)) });
  Object.assign(plan.spouse, { birthYear: now - sAge, retirementAge: sAge, acceptableRetirementAge: sAge, salary: 0, ssPia: Math.round(f.pia * 0.45), ssClaimAge: Math.max(sAge, 67) });
  const cash = 0.04 * (f.ira + f.roth + f.taxable);
  const acct = (type, owner, balance, basis) => ({ id: type + owner, name: type, owner, type, balance, basis, annualSavings: 0, savingsIncrease: 0 });
  plan.accounts = [acct('deferred', 'client', f.ira, 0), acct('roth', 'client', f.roth, 0), acct('taxable', 'joint', f.taxable, f.taxable * 0.6), acct('cash', 'joint', cash, cash)];
  plan.goals = plan.goals.filter((g) => g.type === 'retirement').map((g) => ({ ...g, amount: f.spending, acceptable: f.spending }));
  plan.assumptions = { ...plan.assumptions, stateRate: f.stateRate, preRetPortfolio: Math.round(f.portfolio), postRetPortfolio: Math.round(f.portfolio) };
  return M.normalizePlan(plan);
}
