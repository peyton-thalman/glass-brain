// The Household X-ray: everything here is the planning engine (vendor/planner.js), asked the right questions.
// Pure functions of (P = planner bundle, plan, events, facts), so the worker and node checks share them.

import { NOW, toPlan } from './families.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const TR = 300; // trials for search and sensitivity; headline numbers use 1,000

// ---------------------------------------------------------------- life events

/** events: { death: [age|null, age|null], ltc: age|null, crash: bool, inflation: bool, ssCut: bool } */
export function withEvents(plan, ev = {}) {
  const p = clone(plan);
  const stress = {};
  const keys = ['client', 'spouse'];
  (ev.death || []).forEach((age, i) => {
    const who = p[keys[i]];
    if (age != null && who) who.planningAge = Math.max(NOW - who.birthYear + 1, age);
  });
  if (ev.ltc != null) {
    // Care costs $110k a year in today's dollars, rising 5% a year. A policy's daily benefit is fixed unless it has a
    // 3% inflation rider, so in today's dollars it shrinks until care starts; it pays for up to its benefit years.
    const pol = p.ltcPolicy, yrs = Math.max(0, ev.ltc - (NOW - p.client.birthYear));
    const covered = pol ? Math.min(110000, pol.daily * 365 * Math.pow((pol.rider ? 1.03 : 1) / 1.05, yrs)) * Math.min(pol.years, 3) / 3 : 0;
    stress.ltc = { age: ev.ltc, years: 3, amount: Math.round(110000 - covered) };
  }
  if (ev.crash) stress.badTiming = true;
  if (ev.inflation) stress.extraInflation = 0.01;
  if (ev.ssCut) p.assumptions.ssReduction = true;
  return { plan: p, stress };
}

export const anyEvent = (ev) => !!ev && ((ev.death || []).some((a) => a != null) || ev.ltc != null || ev.crash || ev.inflation || ev.ssCut);

export function prob(P, plan, ev, trials = 1000, extra = {}) {
  const { plan: p, stress } = withEvents(plan, ev);
  return P.probability(p, { trials, lite: true, stress: { ...stress, ...(extra.stress || {}) }, ...extra.opts });
}

// ---------------------------------------------------------------- the verdict + history

/** Real portfolio return for one historical year, after fees. */
function realReturn(P, row, portIdx, fees) {
  const r = P.historicalReturn(row, P.MODEL_PORTFOLIOS[portIdx].weights) - fees;
  return (1 + r) / (1 + row[6]) - 1;
}

function geoMean(xs) {
  return xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(1 + x), 0) / xs.length) - 1 : 0;
}

export function verdict(P, plan, ev) {
  const { plan: p, stress } = withEvents(plan, ev);
  const mc = P.simulate(p, { trials: 1000, stress });
  const hs = P.simulate(p, { returns: 'historical', stress });
  const H = P.HISTORY, n = H.length;
  const port = p.assumptions.postRetPortfolio, fees = p.assumptions.fees;
  const years = hs.history.map((h, s0) => {
    const real = Array.from({ length: 30 }, (_, y) => realReturn(P, H[(s0 + y) % n], port, fees));
    const infl = Array.from({ length: 10 }, (_, y) => H[(s0 + y) % n][6]);
    const runOut = h.path.findIndex((v) => v <= 1);
    return {
      year: h.startYear, ok: h.ok, endReal: h.endReal, path: h.path,
      wraps: h.startYear + h.path.length - 1 > H[n - 1][0],
      first10: geoMean(real.slice(0, 10)), after10: geoMean(real.slice(10, Math.max(11, h.path.length))),
      infl10: geoMean(infl), runOutYear: runOut >= 0 ? NOW + runOut : null,
    };
  });
  const rows = mc.rows.map((r, i) => {
    const P0 = Math.pow(1 + p.assumptions.inflation + (stress.extraInflation || 0), i);
    const d = (x) => x / P0;
    return {
      year: r.year, ages: [r.clientAge, r.spouseAge], alive: r.alive,
      ss: d(r.socialSecurity), pension: d(r.pensions), spend: d(r.goalSpending), medicare: d(r.medicare), irmaa: r.irmaaTier,
      fed: d(r.federalTax), state: d(r.stateTax), tax: d(r.taxes), rate: r.tax ? r.tax.bracketRate : 0,
      rmd: d(r.rmd), fromIra: d(r.fromDeferred + r.rmd), fromOther: d(r.fromCash + r.fromTaxable + r.fromRoth),
      end: d(r.end), shortfall: d(r.shortfall), filing: r.alive[0] && r.alive[1] ? 'joint' : 'single',
      conv: d(r.rothConversion), gains: d(r.capitalGains),
      ret: r.tax ? { agi: d(r.tax.agi), magi: d(r.tax.magi), taxableSS: d(r.tax.taxableSS), std: d(r.tax.standardDeduction), senior: d(r.tax.seniorDeduction), deduction: d(r.tax.deduction), taxable: d(r.tax.taxableIncome), ordinary: d(r.tax.ordinaryTax), ltcg: d(r.tax.ltcgTax), niit: d(r.tax.niit), federal: d(r.tax.federal), state: d(r.tax.state), room: d(r.tax.bracketRoom) } : null,
    };
  });
  return {
    probability: mc.probability,
    p10: mc.p10, p50: mc.p50, p90: mc.p90, years: mc.years,
    legacy: mc.afterTaxLegacy, lifetimeTax: mc.lifetimeTax, lifetimeMedicare: mc.lifetimeMedicare,
    depletion: mc.medianDepletionYear,
    history: years, rows,
    diagnosis: diagnose(years),
  };
}

/** Why the failing eras failed: compare the first decade with everything after it. */
export function diagnose(years) {
  const full = years.filter((y) => !y.wraps);
  const bad = full.filter((y) => !y.ok), good = full.filter((y) => y.ok);
  const avg = (xs, k) => (xs.length ? xs.reduce((s, x) => s + x[k], 0) / xs.length : null);
  const closest = [...full].sort((a, b) => a.endReal - b.endReal)[0];
  return {
    tested: full.length, failed: bad.length,
    badFirst10: avg(bad, 'first10'), goodFirst10: avg(good, 'first10'),
    badAfter10: avg(bad, 'after10'), goodAfter10: avg(good, 'after10'),
    badInfl: avg(bad, 'infl10'), goodInfl: avg(good, 'infl10'),
    worst: bad.length ? bad.reduce((w, y) => ((y.runOutYear ?? 9999) < (w.runOutYear ?? 9999) ? y : w)) : null,
    closest,
    eras: eras(bad.map((y) => y.year)),
  };
}

const ERA_NAMES = [
  [1928, 1932, 'the 1929 crash'], [1936, 1941, 'the 1937 relapse and WWII'], [1946, 1949, 'post-war inflation'],
  [1955, 1974, 'the 1966–82 stagflation decade'], [1977, 1981, 'double-digit inflation'], [1998, 2002, 'the dot-com bust'],
  [2006, 2009, 'the 2008 financial crisis'], [2015, 2025, 'the 2022 stock-and-bond crash'],
];
function eras(fails) {
  const out = [];
  for (const [a, b, name] of ERA_NAMES) {
    const hit = fails.filter((y) => y >= a && y <= b);
    if (hit.length) out.push({ name, from: Math.min(...hit), to: Math.max(...hit), n: hit.length });
  }
  return out;
}

// ---------------------------------------------------------------- sensitivity

export function sensitivity(P, plan, ev) {
  const base = prob(P, plan, ev, TR * 2);
  const vary = (label, low, high, fLow, fHigh, sLow = {}, sHigh = {}) => {
    const a = clone(plan); fLow && fLow(a);
    const b = clone(plan); fHigh && fHigh(b);
    return { label, low, high, lo: prob(P, a, ev, TR * 2, { stress: sLow }), hi: prob(P, b, ev, TR * 2, { stress: sHigh }) };
  };
  const core = plan.goals.find((g) => g.type === 'retirement' && g.enabled);
  const port = plan.assumptions.postRetPortfolio;
  const rows = [
    core && vary('Everyday spending', '10% more', '10% less', (p) => (p.goals.find((g) => g.id === core.id).amount *= 1.1), (p) => (p.goals.find((g) => g.id === core.id).amount *= 0.9)),
    vary('Market returns', '1% lower', '1% higher', null, null, { returnDrag: 0.01 }, { returnDrag: -0.01 }),
    vary('Inflation', '1% hotter', '½% cooler', null, (p) => (p.assumptions.inflation -= 0.005), { extraInflation: 0.01 }),
    vary('All-in fees', '+0.5%', '−0.5%', (p) => (p.assumptions.fees += 0.005), (p) => (p.assumptions.fees = Math.max(0, p.assumptions.fees - 0.005))),
    vary('How long you live', '5 years longer', '5 years shorter', (p) => P.people(p).forEach((x) => (x.planningAge += 5)), (p) => P.people(p).forEach((x) => (x.planningAge -= 5))),
    vary('A crash in year one', 'Two bad years now', 'Average years', null, null, { badTiming: true }, {}),
    vary('Social Security', '23% cut in 2033', 'As promised', (p) => (p.assumptions.ssReduction = true), null),
    vary('Stock / bond mix', port > 1 ? 'One step safer' : 'Same', port < 6 ? 'One step riskier' : 'Same',
      (p) => (p.assumptions.postRetPortfolio = Math.max(1, port - 1)), (p) => (p.assumptions.postRetPortfolio = Math.min(6, port + 1))),
  ].filter(Boolean);
  rows.forEach((r) => (r.swing = Math.max(Math.abs(r.lo - base), Math.abs(r.hi - base))));
  rows.sort((a, b) => b.swing - a.swing);
  return { base, rows };
}

// ---------------------------------------------------------------- one event at a time

export function eventCatalog(plan, facts) {
  const ppl = facts.people;
  const list = [];
  ppl.forEach((p, i) => {
    if (ppl.length === 2) list.push({ id: 'death' + i, label: `${p.first} dies at`, kind: 'death', who: i, def: Math.min(p.planTo - 1, p.age + 4), min: p.age + 1, max: p.planTo - 1 });
  });
  list.push({ id: 'ltc', label: `${ppl[0].first} needs 3 years of care at`, kind: 'ltc', def: Math.max(85, ppl[0].age + 3), min: ppl[0].age + 1, max: ppl[0].planTo - 1, note: '$110,000 a year in today’s dollars, rising with medical inflation' });
  list.push({ id: 'crash', label: 'Markets crash in the first two years', kind: 'crash', note: 'Two severe down years right now, when withdrawals hurt most' });
  list.push({ id: 'inflation', label: 'Inflation runs 1% hotter for good', kind: 'inflation' });
  list.push({ id: 'ssCut', label: 'Social Security is cut 23% in 2033', kind: 'ssCut', note: 'If Congress does nothing when the trust fund runs short (2025 Trustees Report)' });
  return list;
}

export function eventsFrom(active) {
  const ev = { death: [null, null], ltc: null, crash: false, inflation: false, ssCut: false };
  for (const [id, v] of Object.entries(active)) {
    if (v == null || v === false) continue;
    if (id.startsWith('death')) ev.death[+id.slice(5)] = v;
    else if (id === 'ltc') ev.ltc = v;
    else ev[id] = true;
  }
  return ev;
}

// ---------------------------------------------------------------- what a death does to the money

/** Compare the last full year together with the first year alone, on the average-markets ledger. */
export function survivorCliff(P, plan, ev, who) {
  const { plan: p, stress } = withEvents(plan, ev);
  const rows = verdictRows(P, p, stress);
  const k = rows.findIndex((r) => !r.alive[who]);
  if (k <= 0 || k + 1 >= rows.length) return null;
  const before = rows[k - 1], after = rows[k + 1];
  const income = (r) => r.ss + r.pension;
  return {
    year: rows[k].year, before, after,
    incomeBefore: income(before), incomeAfter: income(after),
    spendBefore: before.spend, spendAfter: after.spend,
    taxBefore: before.tax, taxAfter: after.tax, rateBefore: before.rate, rateAfter: after.rate,
    irmaaBefore: before.irmaa, irmaaAfter: Math.max(...rows.slice(k, k + 6).map((r) => r.irmaa)),
    iraBefore: before.fromIra + before.fromOther, iraAfter: after.fromIra + after.fromOther,
  };
}

function verdictRows(P, p, stress) {
  const r = P.simulate(p, { trials: 1, lite: true, stress });
  return r.rows.map((x, i) => {
    const d = (v) => v / Math.pow(1 + p.assumptions.inflation + (stress.extraInflation || 0), i);
    return {
      year: x.year, alive: x.alive, ss: d(x.socialSecurity), pension: d(x.pensions), spend: d(x.goalSpending),
      tax: d(x.taxes), rate: x.tax ? x.tax.bracketRate : 0, irmaa: x.irmaaTier, fromIra: d(x.fromDeferred + x.rmd), fromOther: d(x.fromCash + x.fromTaxable + x.fromRoth),
    };
  });
}

// ---------------------------------------------------------------- the gentlest fix

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

function fixMoves(base, facts) {
  const f = facts.feelings || {};
  const out = [];
  const core = base.goals.find((g) => g.type === 'retirement' && g.enabled);
  if (core && f.cutOk !== 'no') {
    out.push({
      key: 'core', pain: f.cutOk === 'yes' ? 0.8 : 1.2,
      apply: (p) => {
        const g = p.goals.find((x) => x.id === core.id);
        const floor = core.amount * (f.cutOk === 'yes' ? 0.8 : 0.9);
        if (g.amount <= floor + 1) return null;
        g.amount = Math.max(floor, g.amount - Math.max(1200, Math.round(core.amount * 0.025 / 600) * 600));
        return p;
      },
    });
    out.push({
      key: 'guardrails', pain: f.cutOk === 'yes' ? 0.5 : 0.9, once: true,
      apply: (p) => (p.strategy.spending.policy === 'guardrails' ? null : ((p.strategy.spending = { policy: 'guardrails', band: 0.2, adjust: 0.1 }), p)),
    });
  }
  for (const g of base.goals) {
    if (!g.enabled || g.type === 'retirement' || g.amount <= 0) continue;
    const weight = g.type === 'legacy' ? (f.priority === 'legacy' ? 2 : 0.5) : g.type === 'other' ? (f.priority === 'legacy' ? 1.4 : 0.6) : f.priority === 'spend' ? 1.1 : 0.6;
    out.push({
      key: 'goal:' + g.id, pain: weight,
      apply: (p) => {
        const x = p.goals.find((q) => q.id === g.id);
        if (x.amount <= 0) return null;
        x.amount = Math.max(0, x.amount - g.amount * 0.25);
        if (x.amount < 1) x.enabled = false;
        return p;
      },
    });
  }
  ['client', 'spouse'].forEach((k, i) => {
    const who = base[k];
    if (!who) return;
    const age = NOW - who.birthYear;
    if (who.ssClaimAge > age) out.push({ key: 'ss' + i, pain: 0.5, apply: (p) => (p[k].ssClaimAge >= 70 ? null : ((p[k].ssClaimAge += 1), p)) });
    // Still working: save a little more each year, or stop a year later (up to five years, never past 70).
    if (who.salary > 0 && who.retirementAge > age) {
      const cap = Math.min(70, who.retirementAge + 5);
      out.push({ key: 'work' + i, pain: f.worry === 'running-out' ? 1.0 : 1.4, apply: (p) => (p[k].retirementAge >= cap ? null : ((p[k].retirementAge += 1), (p[k].acceptableRetirementAge = p[k].retirementAge), p)) });
      out.push({
        key: 'save' + i, pain: 0.8,
        apply: (p) => {
          let a = p.accounts.find((x) => x.id === 'ira' + i);
          if (!a) p.accounts.push((a = { id: 'ira' + i, name: `${who.firstName}’s IRA`, owner: k, type: 'deferred', balance: 0, basis: 0, annualSavings: 0, savingsIncrease: 0.02 }));
          const start = (base.accounts.find((x) => x.id === 'ira' + i) || { annualSavings: 0 }).annualSavings;
          if (a.annualSavings >= start + 12000 || a.annualSavings >= who.salary * 0.3) return null;
          a.annualSavings += 2400;
          return p;
        },
      });
    }
  });
  if (facts.home && facts.home.value > 0 && facts.home.open && !facts.home.downsize)
    out.push({ key: 'downsize', pain: f.worry === 'running-out' ? 1.0 : 1.6, once: true, apply: (p) => (p.inflows.some((x) => x.id === 'downsize') ? null : (p.inflows.push({ id: 'downsize', name: 'Downsize the house', year: facts.home.downsizeYear, amount: facts.home.netProceeds, gainPct: 0 }), p)) });
  const port = base.assumptions.postRetPortfolio;
  if (port < 5) out.push({ key: 'riskier', pain: f.worry === 'market' ? 2.5 : 1.5, apply: (p) => (p.assumptions.postRetPortfolio >= Math.min(5, port + 1) ? null : ((p.assumptions.postRetPortfolio += 1), p)) });
  return out;
}

/** Greedy search for the least painful set of changes that gets the plan (under these events) to `target`. */
export function gentlestFix(P, plan, ev, facts, target = 85, onStep) {
  const moves = fixMoves(plan, facts);
  let cur = clone(plan), p = prob(P, cur, ev, TR);
  const start = p, steps = [];
  for (let i = 0; i < 30 && p < target; i++) {
    let best = null;
    for (const m of moves) {
      const n = m.apply(clone(cur));
      if (!n) continue;
      const np = prob(P, n, ev, TR);
      const score = (np - p) / m.pain;
      if (np > p && (!best || score > best.score)) best = { m, n, np, score };
    }
    if (!best) break;
    cur = best.n; p = best.np;
    steps.push(best.m.key);
    onStep && onStep({ step: i + 1, p });
  }
  const before = prob(P, plan, ev, 1000), after = prob(P, cur, ev, 1000);
  const last = P.HISTORY[P.HISTORY.length - 1][0];
  const hist = (pl) => {
    const { plan: q, stress } = withEvents(pl, ev);
    const full = P.simulate(q, { returns: 'historical', stress }).history.filter((h) => h.startYear + h.path.length - 1 <= last);
    return { ok: full.filter((h) => h.ok).length, of: full.length };
  };
  return { plan: cur, before, after, start, reached: p >= target, histBefore: hist(plan), histAfter: hist(cur), changes: describe(plan, cur, facts) };
}

export function describe(a, b, facts) {
  const out = [];
  const names = facts.people.map((p) => p.first);
  for (const g of b.goals) {
    const o = a.goals.find((x) => x.id === g.id);
    if (!o || Math.round(o.amount) === Math.round(g.amount)) continue;
    if (g.type === 'retirement') out.push({ what: `Trim everyday spending to ${money(g.amount / 12)} a month`, detail: `from ${money(o.amount / 12)}` });
    else if (!g.enabled || g.amount < 1) out.push({ what: `Let go of “${g.name}”`, detail: `${money(o.amount)} a year` });
    else out.push({ what: `Scale “${g.name}” to ${money(g.amount)} a year`, detail: `from ${money(o.amount)}` });
  }
  if (a.strategy.spending.policy !== b.strategy.spending.policy) out.push({ what: 'Spend 10% less in bad market years', detail: 'only when savings fall behind, then back to normal when markets recover' });
  ['client', 'spouse'].forEach((k, i) => {
    if (a[k] && b[k] && a[k].ssClaimAge !== b[k].ssClaimAge) out.push({ what: `${names[i]} claims Social Security at ${b[k].ssClaimAge}`, detail: `instead of ${a[k].ssClaimAge}` });
  });
  ['client', 'spouse'].forEach((k, i) => {
    if (a[k] && b[k] && a[k].retirementAge !== b[k].retirementAge) out.push({ what: `${names[i]} works until ${b[k].retirementAge}`, detail: `instead of ${a[k].retirementAge}` });
    const sv = (p) => (p.accounts.find((x) => x.id === 'ira' + i) || { annualSavings: 0 }).annualSavings;
    if (sv(b) > sv(a)) out.push({ what: `${names[i]} saves ${money(sv(b) - sv(a))} more a year`, detail: `${money(sv(b))} a year in all, until retiring` });
  });
  if (!a.inflows.some((x) => x.id === 'downsize') && b.inflows.some((x) => x.id === 'downsize')) {
    const d = b.inflows.find((x) => x.id === 'downsize');
    out.push({ what: `Downsize the house in ${d.year}`, detail: `frees about ${money(d.amount)}` });
  }
  if (a.assumptions.postRetPortfolio !== b.assumptions.postRetPortfolio) out.push({ what: 'Take one step more stock risk', detail: '' });
  return out;
}

// ---------------------------------------------------------------- what to ask next

/**
 * The facts worth confirming first: for each one we are unsure of, the engine scores the plausible answers and the
 * spread between them is how much the answer could move the plan. P is the planner bundle, f the intake facts.
 */
export function questions(P, f) {
  const two = f.people.length === 2, out = [];
  const pr = (g, ev = {}) => prob(P, toPlan(P, g), eventsFrom(ev), 600);
  const alt = (mod) => { const g = JSON.parse(JSON.stringify(f)); mod(g); return g; };
  const ask = (id, q, why, scenarios, ev = {}) => {
    const ps = scenarios.map((m) => pr(alt(m), ev));
    out.push({ id, q, why, lo: Math.min(...ps), hi: Math.max(...ps), swing: Math.max(...ps) - Math.min(...ps) });
  };
  f.pensions.forEach((pn, k) => {
    if (!two || pn.endAge != null) return;
    const who = f.people[pn.owner], other = f.people[1 - pn.owner];
    ask(`surv${k}`, `If ${who.first} dies first, does the ${pn.name.toLowerCase()} keep paying ${other.first}?`, `Single-life or joint-and-survivor, checked against the pension paperwork. Scored as if ${who.first} died at ${Math.min(who.planTo - 1, who.age + 4)}.`,
      [(g) => (g.pensions[k].survivorPct = 0), (g) => (g.pensions[k].survivorPct = 100)], { [`death${pn.owner}`]: Math.min(who.planTo - 1, who.age + 4) });
  });
  ask('spend', `Is ${'$' + Math.round(f.spending.core).toLocaleString()} a month really what they spend?`, 'Three months of bank and card statements usually settle it. Scored at 15% less and 15% more.',
    [(g) => (g.spending.core *= 0.85), (g) => (g.spending.core *= 1.15)]);
  ask('life', 'How long did their parents and grandparents live?', 'Family history and health move the planning age. Scored 5 years shorter and 5 years longer.',
    [(g) => g.people.forEach((p) => (p.planTo = Math.max(p.age + 2, p.planTo - 5))), (g) => g.people.forEach((p) => (p.planTo += 5))]);
  const careAge = Math.max(85, f.people[0].age + 3);
  if (!f.ltc || f.ltc.has !== 'yes') ask('ltc', `Does ${f.people[0].first} have long-term-care insurance?`, `Scored with no policy and with a typical one ($200 a day for 3 years), if care starts at ${careAge}.`,
    [(g) => (g.ltc = { has: 'no' }), (g) => (g.ltc = { has: 'yes', daily: 200, years: 3, rider: false })], { ltc: careAge });
  f.people.forEach((p, i) => {
    if (p.claimAge > p.age) ask(`claim${i}`, `When does ${p.first} really plan to claim Social Security?`, 'Scored claiming at 62 against waiting to 70.',
      [(g) => (g.people[i].claimAge = Math.max(62, p.age)), (g) => (g.people[i].claimAge = 70)]);
  });
  if (!two && f.marital === 'widowed' && (!f.late || !f.late.ssMonthly)) ask('late', 'What was the late spouse\'s Social Security benefit?', 'A survivor can take the larger of their own and the late spouse\'s. Scored at the same as their own and 60% higher.',
    [(g) => (g.late = { ssMonthly: 0 }), (g) => (g.late = { ssMonthly: Math.round(f.people[0].ssMonthly * 1.6) })]);
  return out.sort((a, b) => b.swing - a.swing);
}
