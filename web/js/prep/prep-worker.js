// Runs the Meeting prep tools on the planning engine off the main thread (the fix search takes a few seconds).
import * as P from '../vendor/planner.js';
import * as S from '../vendor/scenario.js';
import { session, replay } from './tools.js';

let s = session(P, S);
const plain = (x) => JSON.parse(JSON.stringify(x ?? null));

self.onmessage = ({ data: { id, type, name, input, calls } }) => {
  let out;
  if (type === 'reset') { s = session(P, S); out = true; }
  else if (type === 'run') out = s.run(name, input);
  else if (type === 'state') out = { facts: s.facts, sources: s.sources, defaulted: s.defaulted, refs: s.refs, calls: s.calls };
  else if (type === 'replay') out = replay(P, S, calls);
  self.postMessage({ id, out: plain(out) });
};
