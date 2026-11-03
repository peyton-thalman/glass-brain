// How it works: the pictures for steps 2 to 4 come from the planning engine, run live on Dale and Marilyn.

import * as P from './vendor/planner.js';
import { FAMILIES, toPlan } from './household/families.js';
import { eventCatalog } from './household/xray-core.js';

const $ = (s) => document.querySelector(s);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const colorFor = (p) => (p >= 75 ? css('--good') : p >= 60 ? css('--amber') : css('--coral'));

const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('.rv').forEach((el) => io.observe(el));

const w = new Worker(new URL('./household/xray-worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map();
w.onmessage = ({ data }) => { const p = pending.get(data.id); if (p && data.type !== 'progress') { pending.delete(data.id); p(data.out); } };
const ask = (msg) => new Promise((res) => { const id = ++seq; pending.set(id, res); w.postMessage({ ...msg, id }); });

const KOW = FAMILIES.find((f) => f.id === 'kowalski');
const plan = toPlan(P, KOW);

(async () => {
  const [v, evs] = await Promise.all([ask({ type: 'verdict', plan, ev: {} }), ask({ type: 'events', plan, facts: KOW, ages: {} })]);
  const p = Math.round(v.probability);

  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rank = Array.from({ length: 100 }, (_, i) => i).sort(() => r() - 0.5);
  $('#wDots').innerHTML = rank.map((k) => `<i class="${k >= p ? 'bad' : ''}"></i>`).join('');
  $('#wDotsCap').innerHTML = `The money lasts in <b>${p} out of 100</b>.`;

  const runs = v.history.filter((h) => !h.wraps), ok = runs.filter((h) => h.ok).length;
  $('#wYears').innerHTML = runs.map((h) => `<i class="${h.ok ? 'ok' : 'bad'}" title="${h.year}"></i>`).join('');
  $('#wYearsCap').innerHTML = `It worked in <b>${ok} of ${runs.length}</b> real starting years.`;

  const [d] = KOW.people;
  const names = { death0: `If ${d.first} dies first`, ltc: `If ${d.first} needs care`, crash: 'If stocks crash now', ssCut: 'If Social Security is cut' };
  const rows = [{ label: 'As planned', p: v.probability, base: true }, ...eventCatalog(plan, KOW).filter((e) => names[e.id]).map((e) => ({ label: names[e.id], p: (evs.find((x) => x.id === e.id) || {}).p }))].filter((x) => x.p != null);
  $('#wBars').innerHTML = rows.map((x) => `<div class="t-bar ${x.base ? 'base' : ''}"><div class="t-bl"><b>${x.label}</b></div><div class="t-track"><i style="--w:${x.p}%;--c:${colorFor(x.p)}"></i></div><b class="t-bv">${Math.round(x.p)}</b></div>`).join('');
})();
