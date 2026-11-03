// Every brain and every precomputed number records the planning-engine build that labeled it (its fingerprint, from
// web/js/vendor/engine.json). If the engine has been rebuilt since, the page says so in a banner instead of quietly
// showing a brain that no longer agrees with the engine. train/provenance.mjs runs the same check from the command line.

let current;
const engine = () => (current ??= fetch(new URL('./vendor/engine.json', import.meta.url)).then((r) => r.json()).then((m) => m.fingerprint).catch(() => null));

/**
 * items: [{ label, data, features? }]. `data.engine` is the fingerprint it was labeled with; `features`, when given,
 * is the input list the page's code encodes, checked against the list the brain was trained on.
 */
export async function checkProvenance(items) {
  const fp = await engine();
  if (!fp) return [];
  const problems = [];
  for (const { label, data, features } of items) {
    if (!data) continue;
    if (data.engine !== fp) problems.push(`${label} was labeled by planning engine build ${data.engine || 'unknown'}, but the page runs build ${fp}.`);
    const trained = data.features ? data.features.length : data.layers?.[0]?.W?.[0]?.length;
    if (features && (data.features ? data.features.join('|') !== features.join('|') : trained !== features.length)) problems.push(`${label} was trained on ${trained ?? 'an unknown number of'} household facts, but this page encodes ${features.length}.`);
  }
  if (problems.length) banner(problems);
  return problems;
}

function banner(problems) {
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:sticky;top:0;z-index:1000;background:#7a1f1f;color:#fff;font:14px/1.45 system-ui,sans-serif;padding:10px 16px';
  el.innerHTML = `<strong>Out of date:</strong> ${problems.map((p) => p.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))).join(' ')} Its numbers may not match the engine. Retrain it (see VALIDATION.md, "Provenance").`;
  document.body.prepend(el);
}
