// Runs the MoneyGuide engine off the main thread so the page never stutters while the X-ray recomputes.
import * as P from '../vendor/planner.js';
import * as X from './xray-core.js';

const plain = (x) => JSON.parse(JSON.stringify(x));

self.onmessage = ({ data: { id, type, plan, plans, items, evs, ev, facts, who, ages = {} } }) => {
  let out;
  if (type === 'checkEv') out = items.map((x) => X.prob(P, x.plan, X.eventsFrom(x.ev), 1000));
  else if (type === 'check') out = plans.map((p) => X.prob(P, p, {}, 1000));
  else if (type === 'heads') out = evs.map((e) => (e ? X.prob(P, plan, X.eventsFrom(e), 1000) : null));
  else if (type === 'verdict') out = X.verdict(P, plan, ev);
  else if (type === 'sens') out = X.sensitivity(P, plan, ev);
  else if (type === 'cliff') out = X.survivorCliff(P, plan, ev, who);
  else if (type === 'events') out = X.eventCatalog(plan, facts).map((e) => ({ id: e.id, p: X.prob(P, plan, X.eventsFrom({ [e.id]: ages[e.id] ?? e.def ?? true }), 600) }));
  else if (type === 'fix') {
    const r = X.gentlestFix(P, plan, ev, facts, 85, (s) => self.postMessage({ id, type: 'progress', out: s }));
    const { plan: q, stress } = X.withEvents(r.plan, ev);
    const sp = P.simulate(q, { trials: 1000, stress }).spending;
    out = { ...r, plan: undefined, cuts: sp };
  } else if (type === 'insights') out = P.buildInsights(plan).map(({ action, ...i }) => i);
  self.postMessage({ id, type, out: plain(out) });
};
