// The Firm X-ray: 250 advisors' books (100,000 made-up households) re-scored by the Book Brain as real market
// history replays. Each worker generates and scores its own advisors; this page only adds up what they report.

const $ = (s) => document.querySelector(s);
const compact = (n) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(0)}M` : `${s}$${Math.round(a / 1e3)}k`;
};
const pctS = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%`;
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const REGIONS = ['Desert Southwest', 'Mountain West', 'Pacific', 'Plains', 'Upper Midwest', 'Great Lakes', 'South Central', 'Southeast', 'Mid-Atlantic', 'Northeast'];
const PER_REGION = 25, PER_ADVISOR = 400, ADVISORS = REGIONS.length * PER_REGION, HOUSEHOLDS = ADVISORS * PER_ADVISOR;
const S = { eps: [], ep: 0, i: 0, playing: false, below: null, fresh: null, money: null, below0: 0, ms: 0, aum: 0 };
const pool = [];
let seq = 0;

async function boot() {
  const [brain, spx] = await Promise.all(['bookbrain', 'spx'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())));
  S.eps = spx.episodes;
  const W = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const per = Math.ceil(ADVISORS / W);
  const t0 = performance.now();
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise((res) => {
    const lo = w * per, adv = Math.max(0, Math.min(ADVISORS, lo + per) - lo);
    if (!adv) return res();
    const wk = new Worker(new URL('./firm-worker.js', import.meta.url), { type: 'module' });
    wk.onmessage = ({ data }) => { if (data.ready) { S.aum += data.aum; res(); } };
    wk.postMessage({ init: true, layers: brain.layers, seed: 424242 + w, per: PER_ADVISOR, adv });
    pool.push({ wk, lo, adv });
  })));
  S.genMs = performance.now() - t0;
  $('#eps').innerHTML = S.eps.map((e, k) => `<button data-ep="${k}">${e.label}</button>`).join('');
  await score(0, 0);
  S.below0 = S.below.reduce((t, v) => t + v, 0);
  setEpisode(S.eps.findIndex((e) => e.id === 'covid'));
}

async function score(spx, bond) {
  const t0 = performance.now(), id = ++seq;
  const parts = await Promise.all(pool.map(({ wk, lo }) => new Promise((res) => {
    const on = ({ data }) => { if (data.id === id) { wk.removeEventListener('message', on); res([lo, data]); } };
    wk.addEventListener('message', on);
    wk.postMessage({ spx, bond, id });
  })));
  S.below = new Int32Array(ADVISORS); S.fresh = new Int32Array(ADVISORS); S.money = new Float64Array(ADVISORS);
  for (const [lo, d] of parts) { S.below.set(d.below, lo); S.fresh.set(d.fresh, lo); S.money.set(d.money, lo); }
  S.ms = performance.now() - t0;
  S.spx = spx; S.bond = bond;
}

// ---------------------------------------------------------------- the market

function setEpisode(k) {
  S.ep = k; S.i = 0; S.playing = false;
  document.querySelectorAll('#eps button').forEach((b) => b.classList.toggle('on', +b.dataset.ep === k));
  $('#note').textContent = S.eps[k].note;
  $('#play').textContent = '▶';
  frame();
}
$('#eps').addEventListener('click', (e) => { const b = e.target.closest('[data-ep]'); if (b) { setEpisode(+b.dataset.ep); play(); } });
$('#play').addEventListener('click', () => (S.playing ? (S.playing = false, ($('#play').textContent = '▶')) : play()));

async function play() {
  const e = S.eps[S.ep];
  if (S.i >= e.close.length - 1) S.i = 0;
  S.playing = true; $('#play').textContent = '❚❚';
  const stride = Math.max(1, Math.round(e.close.length / 40));
  while (S.playing && S.i < e.close.length - 1) {
    S.i = Math.min(e.close.length - 1, S.i + stride);
    await frame();
  }
  S.playing = false; $('#play').textContent = '▶';
}

async function frame() {
  const e = S.eps[S.ep], spx = e.close[S.i] / e.close[0] - 1, bond = e.bond[S.i];
  await score(spx, bond);
  const el = $('#spxMove');
  el.textContent = pctS(spx);
  el.style.color = spx < -0.1 ? 'var(--coral)' : spx < 0 ? 'var(--amber)' : spx > 0 ? 'var(--good)' : 'var(--text)';
  $('#spxDate').textContent = `S&P 500 on ${fmtDate(e.dates[S.i])}, since ${fmtDate(e.dates[0])} · bonds ${pctS(bond)}`;
  spark(e);
  stats();
  grid();
}

function spark(e) {
  const c = e.close, W = 600, H = 90, lo = Math.min(...c), hi = Math.max(...c);
  const X = (i) => (i / (c.length - 1)) * W, Y = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const pts = (a) => a.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  $('#spark').innerHTML = `<polyline points="${pts(c)}" fill="none" stroke="var(--faint)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
    <polyline points="${pts(c.slice(0, S.i + 1))}" fill="none" stroke="var(--amber)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <line x1="${X(S.i)}" x2="${X(S.i)}" y1="0" y2="${H}" stroke="var(--amber)" vector-effect="non-scaling-stroke"/>`;
}

function stats() {
  const below = S.below.reduce((t, v) => t + v, 0), fresh = S.fresh.reduce((t, v) => t + v, 0), money = S.money.reduce((t, v) => t + v, 0);
  const needHelp = S.fresh.filter((v) => v >= 25).length;
  $('#stats').innerHTML = `
    <div class="bk-stat ${fresh ? 'alarm' : ''}"><span class="l">Plans below 75%</span><b>${below.toLocaleString()}</b><div class="d">${fresh ? `${fresh.toLocaleString()} fell below since the plans were made` : `of ${HOUSEHOLDS.toLocaleString()} households`}</div></div>
    <div class="bk-stat ${fresh ? 'alarm' : ''}"><span class="l">Client money in those plans</span><b>${compact(money)}</b><div class="d">of ${compact(S.aum)} across the firm</div></div>
    <div class="bk-stat ${needHelp ? 'alarm' : ''}"><span class="l">Advisors with 25+ new red flags</span><b>${needHelp}</b><div class="d">who need help this week, of ${ADVISORS}</div></div>
    <div class="bk-stat"><span class="l">Re-scored this frame</span><b>${(S.ms / 1000).toFixed(1)}s</b><div class="d">${HOUSEHOLDS.toLocaleString()} households, in this browser</div></div>`;
  const engineHours = (HOUSEHOLDS * 0.09) / 3600;
  $('#speed').innerHTML = `The planning engine itself takes about 90 ms per household at 1,000 markets, so one re-score of this firm would take it about <b>${engineHours.toFixed(1)} CPU-hours</b>. The neural network did it in <b>${(S.ms / 1000).toFixed(1)} seconds</b> on this computer. Generating the 100,000 households took ${(S.genMs / 1000).toFixed(1)} s.`;
}

function color(share) {
  const t = Math.min(1, share / 0.45);
  const a = [159, 230, 184], m = [255, 176, 74], b = [255, 106, 85];
  const mix = (p, q, u) => p.map((v, j) => Math.round(v + (q[j] - v) * u));
  return `rgb(${(t < 0.5 ? mix(a, m, t * 2) : mix(m, b, (t - 0.5) * 2)).join(',')})`;
}

function grid() {
  $('#grid').innerHTML = REGIONS.map((name, r) => {
    let below = 0, fresh = 0;
    const tiles = Array.from({ length: PER_REGION }, (_, k) => {
      const a = r * PER_REGION + k;
      below += S.below[a]; fresh += S.fresh[a];
      return `<i data-a="${a}" style="background:${color(S.below[a] / PER_ADVISOR)}"></i>`;
    }).join('');
    return `<div class="fm-region"><div class="fm-rh"><b>${name}</b><span>${(below / (PER_REGION * PER_ADVISOR) * 100).toFixed(0)}% below 75%${fresh ? ` · <em>+${fresh.toLocaleString()}</em>` : ''}</span></div><div class="fm-tiles">${tiles}</div></div>`;
  }).join('');
}

$('#grid').addEventListener('mousemove', (e) => {
  const t = e.target.closest('[data-a]'), tip = $('#tip');
  if (!t) return (tip.hidden = true);
  const a = +t.dataset.a, r = Math.floor(a / PER_REGION);
  tip.innerHTML = `<b>Advisor ${a + 1}</b> · ${REGIONS[r]}<br>${S.below[a]} of ${PER_ADVISOR} households below 75%<br><span class="m">${S.fresh[a]} fell below since the plan date · ${compact(S.money[a])} in those plans</span>`;
  tip.hidden = false;
  tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14) + 'px';
  tip.style.top = e.clientY + 16 + 'px';
});
$('#grid').addEventListener('mouseleave', () => ($('#tip').hidden = true));

boot();
