// 500 simulated futures for the current client, drawn as threads of light across a lifetime.

import { MAX_AGE } from './sim.js';

const fmt = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : `$${Math.round(v / 1e3)}k`);

export class LivesView {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.res = null;
    this.reveal = 1;
    this.t0 = 0;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  set(res, age, animate = true) {
    // Fade the old lines into the new ones only on a meaningful change; small slider drags redraw in place.
    this.res = res;
    this.age = age;
    if (animate) { this.t0 = performance.now(); this.reveal = 0; }
    this.dirty = true;
  }

  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    if (this.res && this.w) {
      if (this.reveal < 1) {
        this.reveal = Math.min(1, (t - this.t0) / 900);
        this.dirty = true;
      }
      if (this.dirty) { this.dirty = false; this.draw(); }
    }
  }

  draw() {
    const g = this.g, { w, h } = this;
    g.clearRect(0, 0, w, h);
    const padL = 64, padR = 26, padT = 40, padB = 22;
    const lines = this.res.lines;
    const Y = MAX_AGE - Math.floor(this.age);
    // Cap the scale at the 85th percentile of peaks so a few moonshots don't flatten the rest.
    const peaks = lines.map((l) => Math.max(...l.w)).sort((a, b) => a - b);
    const cap = Math.max(peaks[Math.floor(peaks.length * 0.85)] || 1, lines[0]?.w[0] * 1.6 || 1);
    const X = (y) => padL + ((w - padL - padR) * y) / Y;
    const V = (v) => padT + (h - padT - padB) * (1 - Math.sqrt(Math.min(v, cap * 1.15) / (cap * 1.15)));
    const ease = 1 - Math.pow(1 - this.reveal, 3);
    const upto = Y * ease;

    // grid
    g.font = '400 10px "Geist Mono", monospace';
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    const ticks = [0.25, 0.5, 1].map((f) => cap * f);
    ticks.forEach((v) => {
      const y = V(v);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke();
      g.textAlign = 'right'; g.fillText(fmt(v), padL - 10, y + 3);
    });
    g.beginPath(); g.moveTo(padL, V(0)); g.lineTo(w - padR, V(0)); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke();
    g.textAlign = 'center';
    for (let a = Math.ceil(this.age / 10) * 10; a <= MAX_AGE; a += 10) {
      const x = X(a - this.age);
      g.fillText(`${a}`, x, h - 6);
    }

    // threads
    g.globalCompositeOperation = 'lighter';
    const draw = (survived) => {
      // Fade in from the shared starting point so 500 overlapping origins don't blow out to white.
      const grad = g.createLinearGradient(padL, 0, padL + (w - padL - padR) * 0.22, 0);
      grad.addColorStop(0, survived ? 'rgba(241,216,166,0.006)' : 'rgba(255,106,85,0.02)');
      grad.addColorStop(1, survived ? 'rgba(241,216,166,0.07)' : 'rgba(255,106,85,0.22)');
      g.strokeStyle = grad;
      g.lineWidth = survived ? 1 : 1.1;
      for (const l of lines) {
        if (l.survived !== survived) continue;
        g.beginPath();
        const n = Math.min(l.w.length, Math.floor(upto) + 1);
        for (let y = 0; y < n; y++) {
          const px = X(y), py = V(l.w[y]);
          y ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      }
    };
    draw(true);
    draw(false);
    // where each life ended
    for (const l of lines) {
      const y = l.w.length - 1;
      if (y > upto) continue;
      g.fillStyle = l.survived ? 'rgba(241,216,166,0.35)' : 'rgba(255,106,85,0.6)';
      g.fillRect(X(y) - 0.75, V(l.w[y]) - 0.75, 1.5, 1.5);
    }
    g.globalCompositeOperation = 'source-over';

    // median of the lives still being lived
    g.beginPath();
    let started = false;
    for (let y = 0; y <= Math.min(Y, upto); y++) {
      const vals = [];
      for (const l of lines) if (y < l.w.length) vals.push(l.w[y]);
      if (vals.length < lines.length * 0.1) break;
      vals.sort((a, b) => a - b);
      const m = vals[Math.floor(vals.length / 2)];
      started ? g.lineTo(X(y), V(m)) : g.moveTo(X(y), V(m));
      started = true;
    }
    g.strokeStyle = 'rgba(255,248,235,0.95)';
    g.lineWidth = 1.6;
    g.shadowColor = 'rgba(255,240,210,0.8)';
    g.shadowBlur = 10;
    g.stroke();
    g.shadowBlur = 0;
  }
}
