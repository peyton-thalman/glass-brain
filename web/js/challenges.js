// Surgery challenges: reshape the brain's beliefs by editing weights, without breaking it.
// Everything is measured live on 800 held-out clients whose truth came from 1,024 simulated lives each.

const FEAT = ['age', 'portfolio', 'spending', 'income', 'equity', 'early', 'flex', 'health'];

export function prepareEval(brain, evalData) {
  const X = evalData.raw.map((r) => brain.encode(Object.fromEntries(FEAT.map((f, i) => [f, r[i]]))));
  return { X, raw: evalData.raw, truth: evalData.success };
}

function sig(z) { return 1 / (1 + Math.exp(-z)); }

function preds(brain, X, set) {
  return X.map((x) => {
    const xx = set ? x.map((v, i) => (set[i] !== undefined ? set[i] : v)) : x;
    const a = brain.forward(xx);
    return sig(a[a.length - 1][0]);
  });
}

function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  idx.forEach(([, i], k) => { r[i] = k; });
  return r;
}

function spearman(a, b) {
  const ra = rank(a), rb = rank(b), n = a.length;
  let d = 0;
  for (let i = 0; i < n; i++) d += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d) / (n * (n * n - 1));
}

export function measure(brain, ev) {
  const p = preds(brain, ev.X);
  const mae = (mask) => {
    let s = 0, n = 0;
    p.forEach((v, i) => { if (!mask || mask(ev.raw[i])) { s += Math.abs(v - ev.truth[i]); n++; } });
    return s / Math.max(n, 1);
  };
  const instinct = (f) => {
    const j = FEAT.indexOf(f);
    const hi = preds(brain, ev.X, { [j]: 1 }), lo = preds(brain, ev.X, { [j]: -1 });
    return hi.reduce((s, v, i) => s + v - lo[i], 0) / hi.length;
  };
  const meanP = p.reduce((s, v) => s + v, 0) / p.length;
  const meanT = ev.truth.reduce((s, v) => s + v, 0) / p.length;
  // Dead = never fires on any eval client.
  let silenced = 0;
  brain.gain.forEach((g) => g.forEach((v) => { if (v === 0) silenced++; }));
  return {
    p, mae: mae(), maeWhere: mae, instinct, shift: meanP - meanT,
    spearman: () => spearman(p, ev.truth), silenced,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}`;

export const CHALLENGES = [
  {
    id: 'fearless',
    title: 'Fearless',
    brief: 'Make the brain stop fearing an early crash. Its sensitivity to bad early markets has to fall below 25% of normal.',
    constraint: 'It must stay accurate (under 2.5 pts off) for clients whose early markets were close to normal.',
    hint: 'One first-layer neuron carries most of the fear, but silencing it breaks the brain. The cleanest cut happens before the first neuron: click an input on the far left.',
    par: 48,
    check(m, base) {
      const now = m.instinct('early'), was = base.early;
      const ratio = now / was;
      const err = m.maeWhere((r) => r[5] > 0.035 && r[5] < 0.095);
      return [
        { label: 'Fear of early crashes', value: `${Math.round(ratio * 100)}% of normal`, ok: ratio < 0.25, goal: '< 25%' },
        { label: 'Accuracy, normal markets', value: `${pct(err)} pts off`, ok: err < 0.025, goal: '< 2.5' },
      ];
    },
  },
  {
    id: 'immortal',
    title: 'Immortal',
    brief: 'Flip the brain\'s view of longevity: excellent health has to raise its answer by at least 1.5 points on average. Right now it lowers it by about 15.',
    constraint: 'It must still understand pensions: sensitivity to guaranteed income stays above 80% of normal.',
    hint: 'Pinning health only makes it indifferent. You need it to prefer a long life. Start with the dread in layer two, then find who else carries the life clock.',
    par: 72,
    check(m, base) {
      const h = m.instinct('health');
      const inc = m.instinct('income') / base.income;
      return [
        { label: 'Health penalty', value: `${h >= 0 ? '+' : ''}${(h * 100).toFixed(1)} pts`, ok: h >= 0.015, goal: '≥ +1.5' },
        { label: 'Pension understanding', value: `${Math.round(inc * 100)}%`, ok: inc > 0.8, goal: '> 80%' },
      ];
    },
  },
  {
    id: 'pension',
    title: 'Pension-blind',
    brief: 'Make the brain blind to Social Security and pensions. Its sensitivity to guaranteed income has to fall below 30% of normal.',
    constraint: 'For clients with no guaranteed income, where it shouldn\'t matter anyway, stay under 3 pts off.',
    hint: 'Income is smeared across nearly every first-layer neuron, so neuron surgery won\'t get there. Pin the input at the value it has for the clients you must not break.',
    par: 48,
    check(m, base) {
      const r = m.instinct('income') / base.income;
      const err = m.maeWhere((x) => x[3] < 1000);
      return [
        { label: 'Pension sensitivity', value: `${Math.round(r * 100)}% of normal`, ok: r < 0.3, goal: '< 30%' },
        { label: 'Accuracy, no-pension clients', value: `${pct(err)} pts off`, ok: err < 0.03, goal: '< 3.0' },
      ];
    },
  },
  {
    id: 'gambler',
    title: 'Gambler',
    brief: 'Give the brain a gambling problem: going from all bonds to all stocks must raise its answer by at least 15 points on average. Right now it\'s about 3.',
    constraint: 'Overall it has to stay within 6 pts of the truth.',
    hint: 'Look for neurons that read stock allocation: missed-the-boom, the crash exposure meter, stock appetite. Dials go past 100%.',
    par: 48,
    check(m) {
      const e = m.instinct('equity');
      return [
        { label: 'Love of stocks', value: `+${(e * 100).toFixed(1)} pts`, ok: e >= 0.15, goal: '≥ +15' },
        { label: 'Overall accuracy', value: `${pct(m.mae)} pts off`, ok: m.mae < 0.06, goal: '< 6.0' },
      ];
    },
  },
  {
    id: 'pessimist',
    title: 'Born pessimist',
    brief: 'Make the brain at least 10 points gloomier than the truth on average, but it must still rank every client in the right order.',
    constraint: 'Rank correlation with the truth stays above 0.97.',
    hint: 'Sometimes the smallest edit is one number. Every neuron has a bias, and so does the output.',
    par: 1,
    check(m) {
      const s = m.spearman();
      return [
        { label: 'Gloom', value: `${(m.shift * 100).toFixed(1)} pts`, ok: m.shift <= -0.10, goal: '≤ −10' },
        { label: 'Ranking kept', value: s.toFixed(3), ok: s > 0.97, goal: '> 0.970' },
      ];
    },
  },
  {
    id: 'prune',
    title: 'Lobotomy, gently',
    brief: 'Remove at least 10 working neurons (freeze or silence them) and keep the brain sharp. Dead neurons don\'t count.',
    constraint: 'Overall error stays under 2 pts, double what it is now.',
    hint: 'Freezing beats silencing: it keeps the average contribution. Low-vote neurons are mostly redundant copies.',
    par: 123,
    check(m, base, brain, deadSet) {
      let n = 0;
      brain.gain.forEach((g, li) => g.forEach((v, ni) => { if ((v === 0 || !isNaN(brain.freeze[li][ni])) && !deadSet.has(`${li}:${ni}`)) n++; }));
      return [
        { label: 'Neurons silenced', value: `${n}`, ok: n >= 10, goal: '≥ 10' },
        { label: 'Overall error', value: `${pct(m.mae)} pts`, ok: m.mae < 0.02, goal: '< 2.0' },
      ];
    },
  },
];

export function baseline(brain, ev) {
  const m = measure(brain, ev);
  return { mae: m.mae, early: m.instinct('early'), health: m.instinct('health'), income: m.instinct('income'), equity: m.instinct('equity') };
}
