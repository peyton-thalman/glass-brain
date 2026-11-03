// Draws the living network: every trained weight as a synapse, every neuron as a light,
// and pulses that travel wherever signal is actually flowing for the current client.

const AMBER = [255, 176, 74];
const ICE = [116, 199, 255];
const CORAL = [255, 106, 85];

function sprite(rgb, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(255,255,255,1)`);
  grd.addColorStop(0.18, `rgba(${rgb},0.9)`);
  grd.addColorStop(0.45, `rgba(${rgb},0.25)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export class BrainView {
  constructor(canvas, labels, tooltip, opts) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.labels = labels;
    this.tip = tooltip;
    this.opts = opts; // { inputNames, outputNames, layerCaps, nameOf(L,i), onSelect, onHover }
    this.brain = null;
    this.acts = null;
    this.scales = null;
    this.sel = null;
    this.hover = null;
    this.pulses = [];
    this.glowA = sprite(AMBER.join(','));
    this.glowI = sprite(ICE.join(','));
    this.glowW = sprite('241,216,166');
    this.glowC = sprite(CORAL.join(','));
    this.dead = new Set();
    this.excite = 0; // flash when the client changes
    this.last = performance.now();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.tip.style.opacity = 0; });
    canvas.addEventListener('click', (e) => {
      const n = this.pick(e);
      this.opts.onSelect(n);
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  set(brain, acts) {
    const changed = this.brain !== brain;
    this.brain = brain;
    this.acts = acts;
    if (changed || !this.nodes) this.resize();
  }

  bump() { this.excite = 1; }

  resize() {
    if (!this.brain) return;
    const r = this.c.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sizes = this.brain.sizes;
    // Leave room for input labels on the left and output labels on the right.
    const left = Math.max(96, this.w * 0.17), right = this.w - Math.max(this.w < 700 ? 150 : 170, this.w * 0.2);
    const top = 58, bot = this.h - (this.opts.bottomPad ? this.opts.bottomPad() : 40);
    this.nodes = sizes.map((n, L) => {
      const x = left + (right - left) * (L / (sizes.length - 1));
      const span = Math.min(bot - top, L === 0 ? 8 * 52 : L === sizes.length - 1 ? 3 * 110 : n * 26);
      const y0 = top + (bot - top - span) / 2;
      return Array.from({ length: n }, (_, i) => ({ x, y: n === 1 ? (top + bot) / 2 : y0 + (span * i) / (n - 1), L, i }));
    });
    this.syn = [];
    for (let L = 0; L < sizes.length - 1; L++) {
      for (let r = 0; r < sizes[L + 1]; r++) {
        for (let k = 0; k < sizes[L]; k++) {
          const a = this.nodes[L][k], b = this.nodes[L + 1][r];
          this.syn.push({ L, r, k, a, b, dx: (b.x - a.x) * 0.5 });
        }
      }
    }
    this.pulses = [];
    this.buildLabels();
    if (this.lastVals) this.setLabelValues(...this.lastVals);
  }

  buildLabels() {
    const { inputNames, outputNames, layerCaps } = this.opts;
    this.labels.innerHTML = '';
    this.inLabels = this.nodes[0].map((n, i) => {
      const d = document.createElement('div');
      d.className = 'lbl in';
      d.style.left = `${n.x}px`; d.style.top = `${n.y}px`;
      d.innerHTML = `${inputNames[i]}<span class="v"></span>`;
      d.onclick = () => this.opts.onSelect({ L: 0, i });
      this.labels.appendChild(d);
      return d;
    });
    const last = this.nodes.length - 1;
    this.outLabels = this.nodes[last].map((n, i) => {
      const d = document.createElement('div');
      d.className = 'lbl out';
      d.style.left = `${n.x}px`; d.style.top = `${n.y}px`;
      d.innerHTML = `${outputNames[i]}<span class="v"></span>`;
      d.onclick = () => this.opts.onSelect({ L: last, i });
      this.labels.appendChild(d);
      return d;
    });
    const gap = this.nodes[1][0].x - this.nodes[0][0].x;
    if (gap > 78) this.nodes.forEach((col, L) => {
      const d = document.createElement('div');
      d.className = 'layer-cap';
      d.style.left = `${col[0].x}px`;
      d.innerHTML = layerCaps[L];
      this.labels.appendChild(d);
    });
  }

  setLabelValues(inVals, outVals, pinned) {
    this.lastVals = [inVals, outVals, pinned];
    if (!this.inLabels) return;
    this.inLabels.forEach((d, i) => {
      d.querySelector('.v').textContent = inVals[i];
      d.classList.toggle('pinned', !!(pinned && pinned[i] !== undefined));
      d.classList.toggle('sel', !!(this.sel && this.sel.L === 0 && this.sel.i === i));
    });
    this.outLabels.forEach((d, i) => {
      d.querySelector('.v').textContent = outVals[i];
      d.classList.toggle('sel', !!(this.sel && this.sel.L === this.nodes.length - 1 && this.sel.i === i));
    });
  }

  pick(e) {
    const r = this.c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 20 * 20;
    this.nodes && this.nodes.forEach((col) => col.forEach((n) => {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }));
    return best ? { L: best.L, i: best.i } : null;
  }

  onMove(e) {
    const n = this.pick(e);
    this.hover = n;
    this.c.style.cursor = n ? 'pointer' : 'default';
    if (!n) { this.tip.style.opacity = 0; return; }
    const node = this.nodes[n.L][n.i];
    const [name, sub] = this.opts.nameOf(n.L, n.i);
    this.tip.innerHTML = `<b>${name}</b><span>${sub}</span>`;
    const left = node.x + 14 > this.w - 250 ? node.x - 254 : node.x + 14;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${node.y - 18}px`;
    this.tip.style.opacity = 1;
  }

  // Normalized 0..1 brightness of a node, plus sign for inputs.
  level(L, i) {
    if (!this.acts) return 0;
    const v = this.acts[L][i];
    if (L === 0) return Math.min(1, Math.abs(v));
    if (L === this.nodes.length - 1) return 0.8;
    const s = this.scales ? this.scales[L - 1][i] : 1;
    return Math.min(1, v / (s || 1));
  }

  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    requestAnimationFrame((tt) => this.frame(tt));
    if (this.brain && this.nodes && this.acts && this.w) this.draw(dt, t);
  }

  draw(dt, t) {
    const g = this.g, B = this.brain;
    g.clearRect(0, 0, this.w, this.h);
    const focus = this.sel || this.hover;
    const isFocus = (L, i) => focus && focus.L === L && focus.i === i;
    this.excite = Math.max(0, this.excite - dt * 1.4);

    // synapses
    g.lineCap = 'round';
    for (const s of this.syn) {
      const layer = B.layers[s.L];
      const w = layer.W[s.r * layer.cols + s.k];
      if (w === 0) continue;
      const src = s.L === 0 ? this.acts[0][s.k] : this.level(s.L, s.k);
      const flow = Math.abs(w) * Math.abs(src);
      let a = 0.018 + 0.05 * Math.min(1, Math.abs(w)) + 0.42 * Math.min(1, flow * 0.9);
      // Sign of the signal it carries: positive weight on positive input excites.
      const pos = (s.L === 0 ? w * this.acts[0][s.k] : w) >= 0;
      if (focus) {
        const touches = (focus.L === s.L && focus.i === s.k) || (focus.L === s.L + 1 && focus.i === s.r);
        a = touches ? Math.min(0.95, 0.18 + a * 2.2) : a * 0.22;
      }
      a *= 1 + this.excite * 0.5;
      if (a < 0.01) continue;
      const rgb = pos ? AMBER : ICE;
      g.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
      g.lineWidth = 0.5 + Math.min(2.2, Math.abs(w) * 0.9);
      g.beginPath();
      g.moveTo(s.a.x, s.a.y);
      g.bezierCurveTo(s.a.x + s.dx, s.a.y, s.b.x - s.dx, s.b.y, s.b.x, s.b.y);
      g.stroke();

      // spawn pulses where signal flows
      const rate = Math.pow(Math.min(1, flow), 1.6) * (focus ? 1.2 : 0.75) * (1 + this.excite * 3);
      if (rate > 0.02 && this.pulses.length < 1100 && Math.random() < rate * dt * 2.2) {
        this.pulses.push({ s, t: 0, v: 0.55 + Math.random() * 0.5, pos, m: Math.min(1, flow) });
      }
    }

    // pulses
    g.globalCompositeOperation = 'lighter';
    const keep = [];
    for (const p of this.pulses) {
      p.t += p.v * dt;
      if (p.t >= 1) continue;
      keep.push(p);
      const { s } = p, u = p.t, iu = 1 - u;
      const x = iu ** 3 * s.a.x + 3 * iu * iu * u * (s.a.x + s.dx) + 3 * iu * u * u * (s.b.x - s.dx) + u ** 3 * s.b.x;
      const y = iu ** 3 * s.a.y + 3 * iu * iu * u * s.a.y + 3 * iu * u * u * s.b.y + u ** 3 * s.b.y;
      let alpha = Math.sin(Math.PI * u) * (0.35 + 0.65 * p.m);
      if (focus && !((focus.L === s.L && focus.i === s.k) || (focus.L === s.L + 1 && focus.i === s.r))) alpha *= 0.25;
      const r = 5 + 7 * p.m;
      g.globalAlpha = alpha;
      g.drawImage(p.pos ? this.glowA : this.glowI, x - r, y - r, r * 2, r * 2);
    }
    this.pulses = keep;
    g.globalAlpha = 1;

    // neurons
    const last = this.nodes.length - 1;
    this.nodes.forEach((col, L) => col.forEach((n) => {
      const lv = this.level(L, n.i);
      const hid = L > 0 && L < last;
      const gain = hid ? B.gain[L - 1][n.i] : 1;
      const frozen = hid && !isNaN(B.freeze[L - 1][n.i]);
      const dead = hid && this.dead.has(`${L - 1}:${n.i}`);
      const f = isFocus(L, n.i);
      let glow = this.glowW;
      if (L === 0) glow = this.acts[0][n.i] >= 0 ? this.glowA : this.glowI;
      if (L === last) glow = this.glowA;
      if (gain === 0) glow = this.glowC;
      if (frozen) glow = this.glowI;
      const pulse = 1 + 0.06 * Math.sin(t / 500 + n.i * 1.7 + L);
      const R = (L === last ? 26 : 9 + 22 * lv) * pulse * (1 + this.excite * 0.25) * (f ? 1.25 : 1);
      g.globalAlpha = dead ? 0.05 : (gain === 0 ? 0.5 : Math.min(1, 0.12 + lv * 0.9)) * (focus && !f ? 0.75 : 1);
      g.drawImage(glow, n.x - R, n.y - R, R * 2, R * 2);
    }));
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    this.nodes.forEach((col, L) => col.forEach((n) => {
      const hid = L > 0 && L < last;
      const lv = this.level(L, n.i);
      const gain = hid ? B.gain[L - 1][n.i] : 1;
      const frozen = hid && !isNaN(B.freeze[L - 1][n.i]);
      const dead = hid && this.dead.has(`${L - 1}:${n.i}`);
      const f = isFocus(L, n.i);
      const r = L === last ? 7 : L === 0 ? 4.5 : 3.6;
      g.beginPath();
      g.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (dead) {
        g.setLineDash([1.5, 2]); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
      } else {
        g.fillStyle = gain === 0 ? '#2a1512' : `rgba(255,248,235,${0.35 + 0.65 * lv})`;
        g.fill();
      }
      if (gain === 0) { g.strokeStyle = 'rgba(255,106,85,0.9)'; g.lineWidth = 1.2; g.stroke(); }
      if (frozen) {
        g.strokeStyle = 'rgba(116,199,255,0.95)'; g.lineWidth = 1.2;
        g.strokeRect(n.x - r - 3, n.y - r - 3, (r + 3) * 2, (r + 3) * 2);
      }
      if (gain > 1) {
        g.beginPath(); g.arc(n.x, n.y, r + 3 + gain * 1.5, 0, Math.PI * 2);
        g.strokeStyle = `rgba(255,176,74,${0.35 + 0.15 * gain})`; g.lineWidth = 1; g.stroke();
      }
      if (gain > 0 && gain < 1) {
        g.beginPath(); g.arc(n.x, n.y, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * gain);
        g.strokeStyle = 'rgba(255,106,85,0.8)'; g.lineWidth = 1; g.stroke();
      }
      if (f) {
        g.beginPath(); g.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.stroke();
      }
    }));
  }
}
