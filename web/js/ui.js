// Shared page behavior: keep each slider's filled track (--p) in step with its value, whether a person drags it
// or a script sets it.
(() => {
  const fill = (el) => {
    const lo = +el.min || 0, hi = el.max === '' ? 100 : +el.max, v = +el.value;
    el.style.setProperty('--p', `${hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0}%`);
  };
  const all = () => document.querySelectorAll('input[type="range"]').forEach(fill);
  document.addEventListener('input', (e) => e.target.matches?.('input[type="range"]') && fill(e.target));
  addEventListener('DOMContentLoaded', all);
  setInterval(all, 250);
})();
