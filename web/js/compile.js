// A compiler from tax law to neural network weights. No training: every weight is read off the statute.
// It builds an exact ReLU network for 2026 federal income tax for a married couple, both 65+, with inputs
// [ordinary income, Social Security benefits, long-term gains]. Each neuron is relu(W·x + b).
//
// The identities that make the law expressible as a network:
//   min(a, b)   = a − relu(a − b)
//   x for x ≥ 0 = relu(x)                       (carry a value forward a layer)
//   brackets    = Σ (rate step) · relu(income − edge)
//   gains stack = Σ (rate step) · [relu(total − edge) − relu(ordinary − edge)]

export function compileLaw(law) {
  const L = law;
  const [b1, b2] = L.ssBase.mfj;
  const std = L.standardDeduction.mfj + 2 * L.std65.mfj;
  const sen = L.senior, senMax = 2 * sen.amount;
  const phaseEnd = sen.threshold.mfj + senMax / (2 * sen.rate);
  const ord = L.ordinary.mfj, lt = L.ltcg.mfj;
  const niitAt = L.niit.threshold.mfj, niitR = L.niit.rate;

  const layers = [];
  let names = ['ordinary income', 'Social Security', 'capital gains'];
  // Each layer: list of neurons { name, w: {inputName: weight}, b, why }
  const layer = (neurons, title) => {
    const idx = Object.fromEntries(names.map((n, i) => [n, i]));
    const W = neurons.map((n) => { const row = new Array(names.length).fill(0); for (const [k, v] of Object.entries(n.w)) row[idx[k]] = v; return row; });
    layers.push({ title, names: neurons.map((n) => n.name), why: neurons.map((n) => n.why || ''), W, b: neurons.map((n) => n.b || 0), inNames: names });
    names = neurons.map((n) => n.name);
  };
  const pass = (n) => ({ name: n, w: { [n]: 1 }, why: 'carried forward' });

  layer([
    pass('ordinary income'), pass('Social Security'), pass('capital gains'),
    { name: 'provisional > $32k', w: { 'ordinary income': 1, 'capital gains': 1, 'Social Security': 0.5 }, b: -b1, why: `IRC §86: provisional income above $${b1.toLocaleString()}` },
    { name: 'provisional > $44k', w: { 'ordinary income': 1, 'capital gains': 1, 'Social Security': 0.5 }, b: -b2, why: `IRC §86: provisional income above $${b2.toLocaleString()}` },
  ], 'Provisional income');

  layer([
    pass('ordinary income'), pass('Social Security'), pass('capital gains'), pass('provisional > $44k'),
    { name: 'SS 50% cap bite', w: { 'Social Security': 0.5, 'provisional > $32k': -0.5, 'provisional > $44k': 0.5 }, why: 'min(½·benefits, ½·provisional over $32k)' },
  ], 'Pub 915 worksheet, part 1');

  layer([
    pass('ordinary income'), pass('capital gains'),
    pass('Social Security'),
    { name: 'SS 85% cap bite', w: { 'Social Security': 0.85 - 0.5, 'provisional > $44k': -0.85, 'SS 50% cap bite': 1 }, why: 'taxable benefits can\'t exceed 85% of benefits' },
  ], 'Pub 915 worksheet, part 2');

  // taxable SS = 0.85·SS − q2 ; AGI = ord + gains + taxable SS
  const agiW = { 'ordinary income': 1, 'capital gains': 1, 'Social Security': 0.85, 'SS 85% cap bite': -1 };
  layer([
    { name: 'AGI', w: agiW, why: 'ordinary + gains + taxable Social Security' },
    pass('capital gains'),
    { name: 'MAGI > $150k', w: agiW, b: -sen.threshold.mfj, why: 'OBBBA senior deduction starts phasing out' },
    { name: `MAGI > $${Math.round(phaseEnd / 1000)}k`, w: agiW, b: -phaseEnd, why: 'senior deduction fully gone' },
    { name: 'MAGI > $250k', w: agiW, b: -niitAt, why: 'IRC §1411 net investment income tax threshold' },
  ], 'Income & phase-outs');

  const ph1 = 'MAGI > $150k', ph2 = `MAGI > $${Math.round(phaseEnd / 1000)}k`;
  layer([
    { name: 'taxable income', w: { AGI: 1, [ph1]: 2 * sen.rate, [ph2]: -2 * sen.rate }, b: -(std + senMax), why: `AGI − $${(std + senMax).toLocaleString()} of deductions, plus the phase-out` },
    pass('capital gains'),
    { name: 'gains above NIIT room', w: { 'capital gains': 1, 'MAGI > $250k': -1 }, why: 'NIIT hits the smaller of gains and MAGI over $250k' },
  ], 'Taxable income');

  layer([
    { name: 'ordinary taxable', w: { 'taxable income': 1, 'capital gains': -1 }, why: 'gains stack on top, so ordinary comes first' },
    ...lt.slice(0, -1).map(([edge]) => ({ name: `taxable > $${(edge / 1000).toFixed(1)}k`, w: { 'taxable income': 1 }, b: -edge, why: 'capital gains rate edge, on total taxable income' })),
    pass('capital gains'), pass('gains above NIIT room'),
  ], 'Stacking');

  const prevLt = lt.slice(0, -1).map(([edge]) => `taxable > $${(edge / 1000).toFixed(1)}k`);
  layer([
    ...ord.slice(0, -1).map(([edge], i) => ({ name: i === 0 ? 'ordinary > $0' : `ordinary > $${(ord[i - 1][0] / 1000).toFixed(1)}k`, w: { 'ordinary taxable': 1 }, b: i === 0 ? 0 : -ord[i - 1][0], why: i === 0 ? `${ord[0][1] * 100}% bracket` : `${Math.round(ord[i][1] * 100)}% bracket starts` })).concat([{ name: `ordinary > $${(ord[ord.length - 2][0] / 1000).toFixed(1)}k`, w: { 'ordinary taxable': 1 }, b: -ord[ord.length - 2][0], why: `${Math.round(ord[ord.length - 1][1] * 100)}% bracket starts` }]),
    ...lt.slice(0, -1).map(([edge]) => ({ name: `ordinary > $${(edge / 1000).toFixed(1)}k (gains)`, w: { 'ordinary taxable': 1 }, b: -edge, why: 'gains already pushed up by ordinary income' })),
    ...prevLt.map(pass), pass('capital gains'), pass('gains above NIIT room'),
  ], 'Brackets');

  // Output: linear readout.
  const out = {};
  ord.forEach(([, r], i) => { out[layers.at(-1).names[i]] = r - (i ? ord[i - 1][1] : 0); });
  lt.slice(0, -1).forEach(([edge], k) => {
    const step = lt[k + 1][1] - lt[k][1];
    out[`taxable > $${(edge / 1000).toFixed(1)}k`] = step;
    out[`ordinary > $${(edge / 1000).toFixed(1)}k (gains)`] = -step;
  });
  out['capital gains'] = niitR;
  out['gains above NIIT room'] = -niitR;
  const lastNames = layers.at(-1).names;
  const W = [lastNames.map((n) => out[n] || 0)];
  layers.push({ title: 'Federal tax', names: ['federal tax'], why: [''], W, b: [0], inNames: lastNames, linear: true });
  return layers;
}

export function runCompiled(layers, ord, ss, ltcg, keep) {
  let h = [ord, ss, ltcg];
  const acts = keep ? [h] : null;
  for (const l of layers) {
    const o = new Array(l.W.length);
    for (let r = 0; r < l.W.length; r++) {
      let s = l.b[r];
      const w = l.W[r];
      for (let k = 0; k < w.length; k++) s += w[k] * h[k];
      o[r] = l.linear ? s : Math.max(0, s);
    }
    h = o;
    if (keep) acts.push(h);
  }
  return keep ? acts : h[0];
}

export function countCompiled(layers) {
  let neurons = 0, weights = 0;
  layers.forEach((l) => { if (!l.linear) neurons += l.W.length; l.W.forEach((r) => r.forEach((w) => { if (w !== 0) weights++; })); l.b.forEach((b) => { if (b !== 0) weights++; }); });
  return { neurons, weights, layers: layers.length };
}

// Which weights differ between two compiled laws: a change in the law, as a weight diff.
export function weightDiff(A, B) {
  const out = [];
  A.forEach((la, li) => {
    const lb = B[li];
    la.W.forEach((row, r) => {
      if (la.b[r] !== lb.b[r]) out.push({ layer: li, neuron: la.names[r], what: 'bias', from: la.b[r], to: lb.b[r] });
      row.forEach((w, k) => { if (w !== lb.W[r][k]) out.push({ layer: li, neuron: la.names[r], what: `weight from ${la.inNames[k]}`, from: w, to: lb.W[r][k] }); });
    });
  });
  return out;
}
