// The compliance record for one packet: what went in, every engine call and its exact answer, which engine and
// model produced it, and what was shown. Downloadable as JSON; replay() reruns the calls and compares.
import { PROMPT_VERSION, MODELS } from './agent.js';

export const DISCLOSURES = [
  'Prepared with decision-support software. Claude (Anthropic) wrote the words from the advisor’s notes; every number came from the planning engine, and code checked that no number was typed by the model.',
  'Projections use 1,000 simulated markets and every historical start year since 1928 (real returns and inflation), 2026 federal tax law, SSA mortality and Arizona’s flat state tax. They are hypothetical, are not guarantees, and will change as markets and the household change.',
  'Facts marked assumed or unclear were not confirmed with the client. Education and decision support, not personal advice.',
];

export function buildRecord({ notes, removed, model, effort, engine, state, packet, usage, startedAt }) {
  return {
    kind: 'glass-brain/meeting-prep-record', version: 1,
    created: new Date().toISOString(), started: startedAt,
    prompt_version: PROMPT_VERSION,
    model: { id: model, label: MODELS[model].label, effort },
    engine: { fingerprint: engine.fingerprint, plan_check: engine.scenario?.fingerprint ?? null, moneyguide_commit: engine.commit, built: engine.builtAt },
    notes, ids_removed: removed,
    household: state.facts, sources: state.sources, filled_with_typical_values: state.defaulted,
    calls: state.calls,
    packet: packet.raw,
    references_used: Object.fromEntries(packet.refsUsed.map((id) => [id, state.refs[id]])),
    audit: { typed_numbers: 0, references: packet.refsUsed.length },
    usage,
    disclosures: DISCLOSURES,
  };
}

export function download(record) {
  const name = `${(record.household?.name || 'household').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${record.created.slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
