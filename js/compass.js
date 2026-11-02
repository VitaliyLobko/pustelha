// Роза компаса для курсу дрона: тап чи тягнення по колу — куди дивиться ніс, з кроком 5°.
import { el } from './ui.js';

const NAMES = ['північ', 'північний схід', 'схід', 'південний схід', 'південь', 'південний захід', 'захід', 'північний захід'];
const SIDES = [[0, 'Пн'], [90, 'Сх'], [180, 'Пд'], [270, 'Зх']];
const pt = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [(50 + Math.sin(a) * r).toFixed(2), (50 - Math.cos(a) * r).toFixed(2)];
};

/** Курс словами: «південний схід» — найближча з восьми сторін. */
export const sideName = (deg) => NAMES[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Роза: get() — курс у градусах, set(deg) — новий курс. Повертає { node, paint }. */
export function compassRose({ get, set }) {
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const d = i * 15;
    const [x1, y1] = pt(d, d % 45 ? 41 : 37);
    const [x2, y2] = pt(d, 45);
    return `<line class="cr-tick${d % 45 ? '' : ' cr-major'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('');
  const labels = SIDES.map(([d, t]) => {
    const [x, y] = pt(d, 30);
    return `<text class="cr-side${d ? '' : ' cr-north'}" x="${x}" y="${y}">${t}</text>`;
  }).join('');
  const face = el('span', { class: 'cr-face', 'aria-hidden': 'true' });
  face.innerHTML = `<svg viewBox="0 0 100 100">
    <circle class="cr-ring" cx="50" cy="50" r="45"/>${ticks}
    <g class="cr-needle"><line x1="50" y1="50" x2="50" y2="14"/><path d="M50 6 L55.5 16 L44.5 16 Z"/></g>${labels}
    <circle class="cr-hub" cx="50" cy="50" r="13"/><text class="cr-deg" x="50" y="50"></text></svg>`;
  const needle = face.querySelector('.cr-needle');
  const deg = face.querySelector('.cr-deg');
  const note = el('p', { class: 'cr-note', 'aria-live': 'polite' });

  const pick = (e) => {
    const box = rose.getBoundingClientRect();
    const dx = e.clientX - box.left - box.width / 2;
    const dy = e.clientY - box.top - box.height / 2;
    if (Math.hypot(dx, dy) < box.width * 0.08) return;
    const v = (Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) / 5) * 5) % 360;
    if (v !== get()) set(v);
  };
  const rose = el('div', {
    class: 'cr-rose', role: 'slider', tabindex: '0', 'aria-label': 'Курс дрона', 'aria-valuemin': '0', 'aria-valuemax': '359',
    onpointerdown: (e) => { rose.setPointerCapture(e.pointerId); pick(e); },
    onpointermove: (e) => { if (rose.hasPointerCapture(e.pointerId)) pick(e); },
    onkeydown: (e) => {
      const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
      if (!step) return;
      e.preventDefault();
      set((get() + step + 360) % 360);
    },
  }, face);

  function paint() {
    const h = get() || 0;
    needle.setAttribute('transform', `rotate(${h} 50 50)`);
    deg.textContent = `${h}°`;
    rose.setAttribute('aria-valuenow', String(h));
    rose.setAttribute('aria-valuetext', `${h}°, ${sideName(h)}`);
    note.textContent = `Ніс на ${sideName(h)}`;
  }
  paint();
  return { node: el('div', { class: 'cr' }, rose, note), paint };
}
