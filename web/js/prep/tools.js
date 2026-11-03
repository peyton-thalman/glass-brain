// The tools Claude can call while it prepares a meeting packet. Claude can't compute anything: every number it may
// use comes back from these tools as a reference ([[xray.score]]), which code fills in after it writes. The same
// module runs in the page (prep-worker.js) and in Node (train/prep_check.mjs), on the same engine bundles, so a
// packet's record can be replayed and checked number for number.
import { NOW, toPlan } from '../household/families.js';
import * as X from '../household/xray-core.js';

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
const pctText = (x) => `${(x * 100).toFixed(1)}%`;

// ---------------------------------------------------------------- tool definitions (sent to Claude)

const SOURCE = {
  type: 'object',
  properties: {
    fact: { type: 'string', description: 'Fact id, the path into household: "people.0.age", "pensions.0.survivorPct", "accounts.ira.1", "spending.core", "feelings.worry"' },
    source: { type: 'string', enum: ['said', 'assumed', 'unclear'], description: 'said = stated in the notes; assumed = not stated, you picked a typical value; unclear = mentioned but vague or contradictory' },
    quote: { type: 'string', description: 'said / unclear: the exact words from the notes, under 25 words' },
    why: { type: 'string', description: 'assumed / unclear: why this value, in a few plain words' },
  },
  required: ['fact', 'source'],
};

const PERSON = {
  type: 'object',
  properties: {
    first: { type: 'string' },
    age: { type: 'integer', description: 'Age this year' },
    sex: { type: 'string', enum: ['F', 'M'], description: 'Sets the mortality table. Use what the notes show (pronouns, "wife", "husband"); if nothing shows it, pick one and mark it assumed' },
    health: { type: 'string', enum: ['poor', 'average', 'good', 'excellent'] },
    planTo: { type: 'integer', description: 'Age to plan to (typical: 92 to 97)' },
    retiredAt: { type: 'integer', description: 'Age they stopped (or will stop) working' },
    salary: { type: 'number', description: 'Yearly pay if still working, else 0' },
    ssMonthly: { type: 'number', description: 'Social Security a month: the check now if claiming, otherwise the full-retirement-age amount from their statement' },
    claimAge: { type: 'integer', description: 'Age they claimed, or plan to claim, Social Security' },
  },
  required: ['first', 'age', 'sex'],
};

export const TOOLS = [
  {
    name: 'record_facts',
    description: 'Write down the household from the meeting notes, in the planning engine\'s intake format. Call this first. Call it again with the whole household to correct anything. '
      + 'Give a source for every fact you fill in. Leave a field out when the notes don\'t say it: code fills a typical value and marks it assumed. Returns references for every fact, and warnings.',
    input_schema: {
      type: 'object',
      properties: {
        household: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'e.g. "Dale & Marilyn Kowalski"' },
            state: { type: 'string', description: 'State they live in, if said' },
            marital: { type: 'string', enum: ['married', 'single', 'widowed'] },
            people: { type: 'array', items: PERSON, minItems: 1, maxItems: 2, description: 'The client first, then the spouse' },
            late: { type: 'object', properties: { first: { type: 'string' }, ssMonthly: { type: 'number', description: 'The late spouse\'s Social Security a month' } }, description: 'Widowed only: the spouse who died' },
            pensions: {
              type: 'array', maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' }, owner: { type: 'integer', enum: [0, 1], description: 'Index into people' },
                  monthly: { type: 'number' }, cola: { type: 'boolean', description: 'Rises with inflation' },
                  survivorPct: { type: 'integer', enum: [-1, 0, 50, 75, 100], description: 'What the survivor keeps if the owner dies first. -1 = not known yet (single-life or joint is unclear)' },
                  endAge: { type: 'integer', description: 'Only for income that stops, like a part-time job' },
                },
                required: ['name', 'owner', 'monthly'],
              },
            },
            accounts: {
              type: 'object',
              properties: {
                ira: { type: 'array', items: { type: 'number' }, description: 'Traditional IRA + 401(k) money, one total per person, in people order' },
                roth: { type: 'number' }, taxable: { type: 'number', description: 'Brokerage' }, basis: { type: 'number', description: 'What they paid for the brokerage holdings' },
                cash: { type: 'number', description: 'Bank, CDs, money market' },
                save: { type: 'array', items: { type: 'number' }, description: 'Still working: saved into retirement accounts a year, per person' },
              },
            },
            home: { type: 'object', properties: { value: { type: 'number' }, downsize: { type: 'boolean' }, downsizeYear: { type: 'integer' }, netProceeds: { type: 'number' } } },
            spending: {
              type: 'object',
              properties: {
                core: { type: 'number', description: 'Everyday spending a MONTH, after tax' },
                survivorPct: { type: 'integer', description: 'Spending after the first death, % of now (typical 75 to 80)' },
                wants: { type: 'array', maxItems: 6, items: { type: 'object', properties: { name: { type: 'string' }, yearly: { type: 'number' }, years: { type: 'integer' }, startYear: { type: 'integer' } }, required: ['name', 'yearly', 'years'] }, description: 'Goals with an end: travel, a cabin, helping a grandchild' },
                gifts: { type: 'number', description: 'Gifts to family a year' }, legacy: { type: 'number', description: 'Amount they want to leave' },
              },
            },
            invest: { type: 'object', properties: { portfolio: { type: 'integer', minimum: 0, maximum: 6, description: '0 cash, 1 conservative, 2 mod. conservative, 3 moderate, 4 mod. aggressive, 5 aggressive, 6 all equity' }, fees: { type: 'number', description: 'All-in fees, % a year' } } },
            feelings: {
              type: 'object',
              properties: {
                cutOk: { type: 'string', enum: ['no', 'some', 'yes'], description: 'Could they trim spending in a bad year?' },
                priority: { type: 'string', enum: ['spend', 'spouse', 'legacy'] },
                worry: { type: 'string', enum: ['running-out', 'care', 'market', 'survivor'] },
              },
            },
            ltc: { type: 'object', properties: { has: { type: 'string', enum: ['yes', 'no', 'unknown'] }, daily: { type: 'number' }, years: { type: 'number' }, rider: { type: 'boolean' } }, description: 'Long-term-care insurance' },
          },
          required: ['name', 'marital', 'people'],
        },
        sources: { type: 'array', items: SOURCE },
        topics: { type: 'array', items: { type: 'string', enum: ['roth_conversion', 'social_security_timing', 'medicare', 'rmd', 'qcd'] }, description: 'Planning questions the notes raise that plan_check answers' },
      },
      required: ['household', 'sources'],
    },
  },
  {
    name: 'xray',
    description: 'Run the planning engine on the recorded household: 1,000 simulated markets plus every real start year since 1928, each life event (a death, care, a crash, a Social Security cut, hotter inflation), and the survivor\'s income. Returns references.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'gentlest_fix',
    description: 'Search, on the engine, for the least painful set of changes that gets the plan to the target, using only moves this family said they could live with (weighted by their feelings answers). Returns references for each change.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'integer', minimum: 70, maximum: 95, description: 'Default 85' },
        under: { type: 'string', description: 'Optional: an event id from xray (e.g. "death0", "ltc", "crash") to find the gentlest fix if that happens. Use it when the plan looks fine as planned but one event breaks it' },
      },
    },
  },
  {
    name: 'ask_first',
    description: 'Score each unconfirmed fact on the engine at its plausible answers and rank them by how much the answer could move the plan. Returns references.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'plan_check',
    description: 'The engine\'s answer to one planning question for this household (2026 federal law): how much to convert to a Roth and when, when to claim Social Security, Medicare IRMAA, RMDs or QCDs. Uses the recorded facts. Only call it for a topic the notes raise.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: ['roth_conversion', 'social_security_timing', 'medicare', 'rmd', 'qcd'] },
        question: { type: 'string', description: 'The question in the client\'s words, if they asked one' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'write_packet',
    description: 'Deliver the finished packet. Never type a digit: write every number, age, year, dollar amount and percent as a reference like [[xray.score]] or [[people.0.age]], and spell small counts as words ("three calls"). '
      + '"401(k)" is the only allowed digit text. Code fills the references in and rejects any text with a typed digit.',
    input_schema: {
      type: 'object',
      properties: {
        client_summary: { type: 'string', description: 'For the client, in plain warm English, second person ("you"), about 200 to 300 words. Paragraphs separated by blank lines. What we heard, how the plan looks, the one risk that matters most, and what we suggest. No jargon, no "Monte Carlo".' },
        file_note: { type: 'string', description: 'The advisor\'s file note: who met, what was discussed, what was decided, open items. Short lines starting with "- ". Factual, past tense.' },
        todos: {
          type: 'array', maxItems: 10,
          items: { type: 'object', properties: { who: { type: 'string', enum: ['advisor', 'branch'] }, what: { type: 'string' }, when: { type: 'string', description: 'e.g. "this week", "before the next meeting"' } }, required: ['who', 'what'] },
          description: 'advisor = decisions and conversations; branch = the branch office administrator: scheduling, paperwork requests, statements to pull',
        },
        asks: {
          type: 'array', maxItems: 6,
          items: { type: 'object', properties: { ref: { type: 'string', description: 'An ask_first reference id ("ask.1") when it came from that tool' }, question: { type: 'string' }, why: { type: 'string' } }, required: ['question', 'why'] },
          description: 'What to confirm before acting, most important first. Include contradictions and vague answers from the notes.',
        },
      },
      required: ['client_summary', 'file_note', 'todos', 'asks'],
    },
  },
];

// ---------------------------------------------------------------- the household: clean, default, flatten

const DEFAULT_PERSON = (p) => ({ health: 'average', planTo: p.sex === 'M' ? 92 : 95, retiredAt: Math.min(p.age, 65), salary: 0, ssMonthly: 0, claimAge: clamp(Math.min(p.age, 67), 62, 70) });

/** Turn what Claude wrote into a complete intake object. Returns { f, defaulted: [fact ids], errors: [] }. */
export function cleanHousehold(h) {
  const errors = [], defaulted = [];
  const has = (o, k) => o && o[k] !== undefined && o[k] !== null;
  const people = (h.people || []).slice(0, 2).map((p, i) => {
    if (!p.first) errors.push(`people.${i}.first is missing`);
    if (!Number.isInteger(p.age)) errors.push(`people.${i}.age is missing: give your best estimate and mark it assumed`);
    const d = DEFAULT_PERSON({ age: p.age || 70, sex: p.sex });
    const out = { first: String(p.first || `Person ${i + 1}`).slice(0, 30), age: clamp(p.age || 70, 20, 105), sex: p.sex === 'M' ? 'M' : 'F' };
    for (const k of ['health', 'planTo', 'retiredAt', 'salary', 'ssMonthly', 'claimAge']) {
      if (has(p, k)) out[k] = p[k];
      else { out[k] = d[k]; defaulted.push(`people.${i}.${k}`); }
    }
    out.planTo = clamp(Math.round(out.planTo), out.age + 2, 110);
    out.retiredAt = clamp(Math.round(out.retiredAt), 40, 80);
    out.claimAge = clamp(Math.round(out.claimAge), 62, 70);
    out.salary = clamp(num(out.salary, 0), 0, 5e6);
    out.ssMonthly = clamp(num(out.ssMonthly, 0), 0, 6000);
    if (!['poor', 'average', 'good', 'excellent'].includes(out.health)) out.health = 'average';
    return out;
  });
  if (!people.length) errors.push('people is empty');
  const two = people.length === 2;
  const a = h.accounts || {};
  const sub = (o, k, dv, path) => (has(o, k) ? o[k] : (defaulted.push(path), dv));
  const money0 = (x) => clamp(num(x, 0), 0, 5e7);
  const ira = people.map((_, i) => money0(sub(a.ira || [], i, 0, `accounts.ira.${i}`)));
  const taxable = money0(sub(a, 'taxable', 0, 'accounts.taxable'));
  const f = {
    id: 'mine', name: String(h.name || people.map((p) => p.first).join(' & ')).slice(0, 60),
    state: h.state || null,
    people,
    marital: two ? 'married' : h.marital === 'widowed' ? 'widowed' : 'single',
    pensions: (h.pensions || []).slice(0, 4).map((x, k) => ({
      name: String(x.name || 'Pension').slice(0, 40), owner: two && x.owner === 1 ? 1 : 0, monthly: clamp(num(x.monthly, 0), 0, 50000),
      cola: !!sub(x, 'cola', false, `pensions.${k}.cola`),
      survivorPct: [-1, 0, 50, 75, 100].includes(x.survivorPct) ? x.survivorPct : (defaulted.push(`pensions.${k}.survivorPct`), -1),
      ...(Number.isInteger(x.endAge) ? { endAge: clamp(x.endAge, 40, 100) } : {}),
    })),
    accounts: {
      ira, roth: money0(sub(a, 'roth', 0, 'accounts.roth')), taxable,
      basis: Math.min(taxable, money0(sub(a, 'basis', taxable * 0.75, 'accounts.basis'))),
      cash: money0(sub(a, 'cash', 0, 'accounts.cash')),
      ...(a.save ? { save: people.map((_, i) => money0(a.save[i])) } : {}),
    },
    home: (() => {
      const o = h.home || {};
      return { value: money0(sub(o, 'value', 0, 'home.value')), open: true, downsize: !!o.downsize, downsizeYear: clamp(num(o.downsizeYear, NOW + 4), NOW, NOW + 30), netProceeds: money0(o.netProceeds ?? 0) };
    })(),
    spending: (() => {
      const o = h.spending || {};
      return {
        core: clamp(num(sub(o, 'core', 5000, 'spending.core'), 5000), 500, 100000),
        survivorPct: clamp(num(sub(o, 'survivorPct', two ? 80 : 100, 'spending.survivorPct'), 80), 40, 100),
        wants: (o.wants || []).slice(0, 6).map((w) => ({ name: String(w.name || 'Goal').slice(0, 40), yearly: money0(w.yearly), years: clamp(num(w.years, 5), 1, 40), ...(Number.isInteger(w.startYear) ? { startYear: clamp(w.startYear, NOW, NOW + 30) } : {}) })),
        gifts: money0(sub(o, 'gifts', 0, 'spending.gifts')), legacy: money0(sub(o, 'legacy', 0, 'spending.legacy')),
      };
    })(),
    invest: (() => {
      const o = h.invest || {};
      return { portfolio: clamp(Math.round(num(sub(o, 'portfolio', 3, 'invest.portfolio'), 3)), 0, 6), fees: clamp(num(sub(o, 'fees', 1.25, 'invest.fees'), 1.25), 0, 3) };
    })(),
    feelings: (() => {
      const o = h.feelings || {};
      const pick = (k, ok, dv) => (ok.includes(o[k]) ? o[k] : (defaulted.push(`feelings.${k}`), dv));
      return {
        cutOk: pick('cutOk', ['no', 'some', 'yes'], 'some'),
        priority: pick('priority', two ? ['spend', 'spouse', 'legacy'] : ['spend', 'legacy'], 'spend'),
        worry: pick('worry', two ? ['running-out', 'care', 'market', 'survivor'] : ['running-out', 'care', 'market'], 'running-out'),
      };
    })(),
  };
  if (h.ltc && h.ltc.has === 'yes') f.ltc = { has: 'yes', daily: clamp(num(h.ltc.daily, 150), 0, 1000), years: clamp(num(h.ltc.years, 3), 0, 10), rider: !!h.ltc.rider };
  else { f.ltc = { has: h.ltc && h.ltc.has === 'no' ? 'no' : 'unknown' }; if (!h.ltc || !h.ltc.has) defaulted.push('ltc.has'); }
  if (f.marital === 'widowed' && h.late) f.late = { first: String(h.late.first || 'Late spouse').slice(0, 30), ssMonthly: clamp(num(h.late.ssMonthly, 0), 0, 6000) };
  return { f, defaulted, errors };
}

const YEARS = /(age|planTo|retiredAt|claimAge|endAge|Year)$/;
/** How a fact prints in the packet. */
function factText(path, v) {
  if (typeof v !== 'number') return null;
  if (YEARS.test(path) || /\.years$/.test(path)) return String(Math.round(v));
  if (/survivorPct$/.test(path)) return v < 0 ? null : `${v}%`;
  if (/fees$/.test(path)) return `${v}%`;
  if (/portfolio$/.test(path)) return null;
  return money(v);
}
function flatten(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const p = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}

// ---------------------------------------------------------------- plan_check needs the plain-English intake

function toPlain(f, topic, question) {
  const owner = (i) => f.people[i].first;
  const accounts = [
    ...f.accounts.ira.map((b, i) => ({ owner: owner(i), kind: 'ira', label: `${owner(i)}'s IRA`, balance: b })).filter((x) => x.balance > 0),
    ...(f.accounts.roth ? [{ owner: owner(0), kind: 'roth', balance: f.accounts.roth }] : []),
    ...(f.accounts.taxable ? [{ owner: 'joint', kind: 'brokerage', balance: f.accounts.taxable, cost_basis: f.accounts.basis }] : []),
    ...(f.accounts.cash ? [{ owner: 'joint', kind: 'savings', balance: f.accounts.cash }] : []),
  ];
  const income = [
    ...f.pensions.map((p) => ({ owner: owner(p.owner), kind: 'pension', amount: p.monthly, per: 'month', ...(p.endAge ? { end_year: NOW + p.endAge - f.people[p.owner].age } : {}) })),
    ...f.people.filter((p) => p.salary > 0 && p.retiredAt > p.age).map((p) => ({ owner: p.first, kind: 'wages', amount: p.salary, per: 'year', end_year: NOW + p.retiredAt - p.age })),
  ];
  return {
    topic, ...(question ? { question } : {}),
    married: f.people.length === 2, state: f.state || 'Arizona',
    people: f.people.map((p) => ({
      name: p.first, age: p.age, on_medicare: p.age >= 65,
      social_security: p.ssMonthly > 0 ? { status: p.claimAge <= p.age ? 'getting_it' : 'not_yet', monthly: p.ssMonthly, start_age: p.claimAge } : { status: 'none' },
    })),
    ...(f.marital === 'widowed' && f.late ? { late_spouse: { name: f.late.first, social_security_monthly: f.late.ssMonthly || undefined } } : {}),
    accounts, income, spending: { amount: f.spending.core, per: 'month' },
    known_facts: f.people.every((p) => p.retiredAt <= p.age) ? ['wages'] : [],
    skipped: [],
  };
}

// ---------------------------------------------------------------- a session: the tools, the references, the log

/**
 * P is the planner bundle, S the scenario bundle (plan_check). Every tool result Claude sees is also the record:
 * `calls` keeps each input and the exact output, so replay() can rerun them and compare.
 */
export function session(P, S) {
  let f = null, defaulted = [], sources = {}, topics = [];
  const refs = {};
  const calls = [];
  // A reference: what it prints as, and where it came from (shown on hover in the packet).
  const ref = (id, text, from) => { if (text != null && text !== '') refs[id] = { text: String(text), from }; return text == null ? undefined : String(text); };
  const refList = (prefix) => Object.fromEntries(Object.entries(refs).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, v.text]));
  const need = () => { if (!f) throw new Error('Call record_facts first.'); };
  const plan = () => toPlan(P, f);

  const tools = {
    record_facts({ household, sources: src = [], topics: t = [] }) {
      const c = cleanHousehold(household || {});
      if (c.errors.length) return { ok: false, error: c.errors.join('; ') };
      f = c.f; defaulted = c.defaulted; topics = t.filter((x) => typeof x === 'string');
      sources = {};
      for (const s of src) if (s && s.fact) sources[s.fact] = { source: s.source, quote: s.quote ? String(s.quote).slice(0, 240) : undefined, why: s.why ? String(s.why).slice(0, 200) : undefined };
      for (const k of Object.keys(refs)) delete refs[k]; // new facts: every earlier engine answer is stale
      const flat = flatten(f);
      const unsourced = [];
      for (const [path, v] of Object.entries(flat)) {
        const s = sources[path] || (defaulted.includes(path) ? { source: 'assumed', why: 'not in the notes; a typical value' } : null);
        if (!s && !['id', 'name', 'home.open'].includes(path) && !/\.(first|name)$/.test(path)) unsourced.push(path);
        ref(path, factText(path, v), { kind: s ? s.source : 'unclear', quote: s?.quote, why: s?.why || (s ? undefined : 'no source given') });
      }
      return {
        ok: true,
        household: f.name, people: f.people.map((p) => `${p.first}, ${p.age}`),
        filled_with_typical_values: defaulted,
        no_source_given: unsourced,
        refs: refList(''),
        note: 'Write any of these as [[id]] in the packet. Facts filled with typical values are assumptions: name the ones that matter in asks.',
      };
    },

    xray() {
      need();
      const pl = plan();
      const v = X.verdict(P, pl, {});
      const d = v.diagnosis;
      const out = { score: ref('xray.score', v.probability, eng('xray', 'Share of 1,000 simulated markets where the money lasts')) };
      ref('xray.history_ok', d.tested - d.failed, eng('xray', 'Real start years since 1928 where the money lasted'));
      ref('xray.history_of', d.tested, eng('xray', 'Real start years tested'));
      ref('xray.history_failed', d.failed, eng('xray', 'Real start years where the money ran out'));
      if (d.failed) {
        ref('xray.bad_first10', pctText(d.badFirst10), eng('xray', 'Real return a year, first decade, in the start years that failed'));
        ref('xray.good_first10', pctText(d.goodFirst10), eng('xray', 'Real return a year, first decade, in the start years that worked'));
        d.eras.forEach((e, i) => ref(`xray.era${i + 1}`, e.name, eng('xray', 'A historical era where this plan failed')));
        if (d.worst?.runOutYear) ref('xray.worst_runout_year', d.worst.runOutYear, eng('xray', 'Year the money runs out in the worst real start year'));
      }
      if (v.depletion) ref('xray.median_runout', v.depletion, eng('xray', 'Median year the money runs out, when it does'));
      ref('xray.legacy_median', money(v.legacy), eng('xray', 'Median after-tax amount left to heirs, today’s dollars'));
      const cat = X.eventCatalog(pl, f);
      const events = cat.map((e, i) => {
        const p = X.prob(P, pl, X.eventsFrom({ [e.id]: e.def ?? true }));
        const label = e.def != null ? `${e.label} ${e.def}` : e.label;
        ref(`xray.event.${e.id}`, p, eng('xray', label));
        ref(`xray.event.${e.id}.label`, label, eng('xray', 'Life event tested'));
        return { id: e.id, label, score: p };
      });
      const worst = events.reduce((w, e) => (e.score < w.score ? e : w), events[0]);
      ref('xray.worst_event.label', worst.label, eng('xray', 'The life event that hurts this plan most'));
      ref('xray.worst_event', worst.score, eng('xray', 'Score under the life event that hurts most'));
      const survivor = [];
      if (f.people.length === 2) {
        f.people.forEach((p, who) => {
          const c = X.survivorCliff(P, pl, {}, who);
          if (!c) return;
          const k = `xray.cliff${who}`;
          const other = f.people[1 - who].first;
          ref(`${k}.year`, c.year, eng('xray', `Year ${p.first} dies in the survivor test`));
          ref(`${k}.income_before`, money(c.incomeBefore / 12), eng('xray', 'Pension + Social Security a month, last year together (today’s dollars)'));
          ref(`${k}.income_after`, money(c.incomeAfter / 12), eng('xray', `Pension + Social Security a month, ${other}'s first year alone`));
          ref(`${k}.income_drop`, money((c.incomeBefore - c.incomeAfter) / 12), eng('xray', 'Guaranteed income lost a month'));
          ref(`${k}.savings_before`, money(c.iraBefore / 12), eng('xray', 'Taken from savings a month, last year together'));
          ref(`${k}.savings_after`, money(c.iraAfter / 12), eng('xray', 'Taken from savings a month, first year alone'));
          ref(`${k}.rate_after`, `${Math.round(c.rateAfter * 100)}%`, eng('xray', 'Federal bracket as a single filer'));
          survivor.push({ dies: p.first, survivor: other, income_drop_monthly: money((c.incomeBefore - c.incomeAfter) / 12) });
        });
      }
      return { ...out, real_years_lasted: `${d.tested - d.failed} of ${d.tested}`, events, worst_event: worst.label, survivor, refs: refList('xray.') };
    },

    gentlest_fix({ target = 85, under } = {}) {
      need();
      const t = clamp(Math.round(num(target, 85)), 70, 95);
      const pl = plan();
      const e = under ? X.eventCatalog(pl, f).find((x) => x.id === under) : null;
      if (under && !e) throw new Error(`No event ${under}. Use an id from xray's events.`);
      const r = X.gentlestFix(P, pl, e ? X.eventsFrom({ [e.id]: e.def ?? true }) : {}, f, t);
      const label = e ? (e.def != null ? `${e.label} ${e.def}` : e.label) : 'as planned';
      ref('fix.under', label, eng('fix', 'The fix was searched for this case'));
      ref('fix.target', t, eng('fix', 'Target score'));
      ref('fix.before', r.before, eng('fix', 'Score today'));
      ref('fix.after', r.after, eng('fix', 'Score with the changes, checked on the engine'));
      ref('fix.history_before', `${r.histBefore.ok} of ${r.histBefore.of}`, eng('fix', 'Real start years that lasted, today'));
      ref('fix.history_after', `${r.histAfter.ok} of ${r.histAfter.of}`, eng('fix', 'Real start years that lasted, with the changes'));
      r.changes.forEach((c, i) => { ref(`fix.change${i + 1}`, c.what, eng('fix', c.detail || 'A change the search chose')); if (c.detail) ref(`fix.change${i + 1}.detail`, c.detail, eng('fix', c.what)); });
      return { under: label, before: r.before, after: r.after, reached: r.reached, changes: r.changes, refs: refList('fix.') };
    },

    ask_first() {
      need();
      const qs = X.questions(P, f).sort((a, b) => b.swing - a.swing).slice(0, 6);
      qs.forEach((q, i) => {
        const k = `ask.${i + 1}`;
        ref(k, q.q, eng('ask_first', q.why));
        ref(`${k}.why`, q.why, eng('ask_first', q.q));
        ref(`${k}.low`, q.lo, eng('ask_first', 'Score at the low answer'));
        ref(`${k}.high`, q.hi, eng('ask_first', 'Score at the high answer'));
        ref(`${k}.swing`, `${q.swing} points`, eng('ask_first', 'How far the answer could move the score'));
      });
      return { questions: qs.map((q, i) => ({ id: `ask.${i + 1}`, q: q.q, low: q.lo, high: q.hi, swing: q.swing })), refs: refList('ask.') };
    },

    plan_check({ topic, question }) {
      need();
      const k = `check.${topic}`;
      const input = toPlain(f, topic, question);
      let r = S.planCheck(input);
      const assumed = [];
      // The engine asks one question at a time. Here nobody is there to answer, so each one is skipped (the engine
      // then states the assumption it used) and becomes something to confirm.
      for (let i = 0; i < 8 && r.status === 'need_more'; i++) {
        assumed.push({ question: r.ask.question, if_skipped: r.ask.if_skipped });
        input.skipped.push(r.ask.fact_id);
        r = S.planCheck(input);
      }
      if (r.status !== 'answer') return { status: r.status, message: r.message || 'The engine could not answer that.' };
      ref(`${k}.headline`, r.headline, eng('plan_check', r.subline));
      if (r.subline) ref(`${k}.subline`, r.subline, eng('plan_check', r.headline));
      r.key_numbers.forEach((n, i) => ref(`${k}.n${i + 1}`, n.value, eng('plan_check', n.label)));
      if (r.close_call) ref(`${k}.close_call`, r.close_call, eng('plan_check', 'Close call'));
      assumed.forEach((a, i) => ref(`${k}.assumed${i + 1}`, a.if_skipped, eng('plan_check', a.question)));
      return {
        status: 'answer', headline: r.headline, key_numbers: r.key_numbers.map((n, i) => ({ id: `${k}.n${i + 1}`, label: n.label, value: n.value })),
        close_call: r.close_call, assumed_because_not_in_notes: assumed, engine_assumed: r.assumed, refs: refList(k + '.'),
      };
    },
  };

  function eng(tool, label) { return { kind: 'engine', tool, label }; }

  return {
    tools,
    refs, calls,
    get facts() { return f; },
    get sources() { return sources; },
    get defaulted() { return defaulted; },
    get topics() { return topics; },
    /** Run one tool call, log it, and return what Claude sees. Errors come back as { error } for an is_error result. */
    run(name, input) {
      let output;
      try {
        if (!tools[name]) throw new Error(`No tool named ${name}.`);
        output = tools[name](input || {});
      } catch (e) {
        output = { ok: false, error: e.message };
      }
      calls.push({ name, input, output: JSON.parse(JSON.stringify(output)) });
      return output;
    },
  };
}

/** Rerun a record's tool calls on these engine bundles and compare every output. */
export function replay(P, S, calls) {
  const s = session(P, S);
  const diffs = [];
  calls.forEach((c, i) => {
    const out = s.run(c.name, c.input);
    if (JSON.stringify(out) !== JSON.stringify(c.output)) diffs.push({ i, name: c.name });
  });
  return { checked: calls.length, diffs };
}
