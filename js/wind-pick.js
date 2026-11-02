// Годинник «звідки дме» з силою — з тренажера Shooter's Log, під дрон: 12 — ніс дрона, у центрі дрон.
import { el, fmt, vibrate, clockWord } from './ui.js';

// Ознаки сили вітру біля землі: верхня межа, м/с → як виглядає; короткий підпис — на кнопках швидкого вибору
const WIND_SIGNS = [
  [1, 'дим піднімається майже вертикально'],
  [2, 'вітер відчутно обличчям, дим помітно хилиться, листя ворушиться'],
  [4, 'листя й тонкі гілки постійно рухаються, легкий прапор майорить'],
  [6, 'піднімає пил і папір, гойдаються невеликі гілки, трава лягає хвилями'],
  [Infinity, 'гойдаються невеликі дерева, гілки шумлять'],
];
const WIND_QUICK = [0, 2, 4, 6, 8];
// Короткі підписи ознак — за тими самими межами, що й WIND_SIGNS
const SHORT = [[0.3, 'штиль'], [2, 'дим'], [4, 'листя'], [6, 'пил'], [Infinity, 'дерева']];
const short = (g) => SHORT.find(([top]) => g <= top)[1];
// Ручка сили: від R0 (ледь дме) до R0 + RS (край шкали) в одиницях циферблата; R0 — одразу за значком дрона
const R0 = 11;
const RS = 26;
// Точка на циферблаті (viewBox 100): кут від 12-ї години за стрілкою, r — відстань від центру
const dialPt = (deg, r) => [50 + Math.sin((deg * Math.PI) / 180) * r, 50 - Math.cos((deg * Math.PI) / 180) * r];

// «Вампір» згори: шість променів під ±30°, ±90°, ±150° від носа (передні два обабіч носа), корпус-шестикутник, кола гвинтів
const ARMS = [30, 90, 150, 210, 270, 330];
const p2 = (deg, r) => dialPt(deg, r).map((v) => v.toFixed(2)).join(' ');
const DRONE = `<g class="wp-drone">
  <path d="${ARMS.map((a) => `M${p2(a, 2.7)}L${p2(a, 6.2)}`).join('')}"/>
  <path d="${ARMS.map((a, i) => `${i ? 'L' : 'M'}${p2(a, 2.8)}`).join('')}Z"/>
  ${ARMS.map((a) => { const [x, y] = dialPt(a, 7.6); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.3"/>`; }).join('')}
  <path class="wp-nose" d="M50 45.4 51.35 47.4H48.65Z"/></g>`;

/**
 * Тап по годині — звідки дме, тягни від центру — сила (край = max), кнопки швидкого вибору з ознаками.
 * get() → { clock, wind }, set({ clock?, wind? }) — зміна стану; повертає { el, paint }.
 * ground(w) — вітер на 10 м для сили w там, де її виміряно: ознаки (дим, листя) — про вітер біля землі, а не на висоті.
 */
export function windPicker({ get, set, max = 10, ground = (w) => w }) {
  const dial = el('div', { class: 'wind-pick', role: 'radiogroup', 'aria-label': 'Звідки дме вітер' });
  const setClock = (n) => {
    const { clock, wind } = get();
    if (n === clock && wind > 0) return;
    vibrate(8);
    // Зі штилю тап по годині — одразу легкий вітер, інакше напрям нічого б не змінив
    set(wind > 0 ? { clock: n } : { clock: n, wind: 2 });
  };
  const setForce = (v) => {
    if (v === get().wind) return;
    vibrate(6);
    set({ wind: v });
  };
  // Циферблат будується раз, далі міняється лише стан — фокус лишається на натиснутій годині
  const hours = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const a = (n / 12) * 2 * Math.PI;
    const b = el('button', { type: 'button', role: 'radio', 'aria-label': `з ${n} год`, onclick: () => setClock(n) }, String(n));
    b.style.setProperty('--x', Math.sin(a).toFixed(3));
    b.style.setProperty('--y', (-Math.cos(a)).toFixed(3));
    return b;
  });
  const face = el('span', { class: 'wp-face', 'aria-hidden': 'true' });
  const scale = [0.5, 1].map((f) => {
    const r = R0 + RS * f;
    const [x, y] = dialPt(45, r);
    return `<circle class="wp-scale" cx="50" cy="50" r="${r}"/><text class="wp-text wp-scale-text" x="${(x + 1).toFixed(1)}" y="${(y - 1).toFixed(1)}">${fmt(max * f, 0)}</text>`;
  }).join('');
  // Стрілку вітру намальовано для 12-ї години й повернуто на вибрану; починається від ручки сили
  face.innerHTML = `<svg viewBox="0 0 100 100">
    <circle class="wp-ring" cx="50" cy="50" r="38"/>${scale}
    <line class="wp-aim" x1="50" y1="40" x2="50" y2="19"/><path class="wp-aim-head" d="M50 13.5 L53 19 L47 19 Z"/>
    <text class="wp-text" x="53.5" y="25">ніс</text>
    <g class="wp-wind"><line x1="50" y1="16" x2="50" y2="38"/><path d="M50 41 L52.8 35.8 L47.2 35.8 Z"/></g>
    ${DRONE}
    <circle class="wp-knob" r="6"/><text class="wp-knob-text" text-anchor="middle"></text></svg>`;
  const wind = face.querySelector('.wp-wind');
  const shaft = wind.querySelector('line');
  const knob = face.querySelector('.wp-knob');
  const knobText = face.querySelector('.wp-knob-text');
  const note = el('p', { class: 'wp-note', 'aria-live': 'polite' });
  const more = el('p', { class: 'wp-more' });
  // Сила — тягненням усередині кільця годин; поза ним сторінка гортається як завжди
  const pick = (e) => {
    const box = dial.getBoundingClientRect();
    const dx = ((e.clientX - box.left) / box.width) * 100 - 50;
    const dy = ((e.clientY - box.top) / box.height) * 100 - 50;
    const r = Math.hypot(dx, dy);
    const v = r < 9 ? 0 : Math.min(max, Math.max(1, Math.round(((r - R0) / RS) * max)));
    const n = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) / 30) % 12 || 12;
    if (v > 0 && n !== get().clock) set({ clock: n });
    setForce(v);
  };
  const pad = el('span', {
    class: 'wp-pad', role: 'slider', tabindex: '0', 'aria-label': 'Сила вітру',
    'aria-valuemin': '0', 'aria-valuemax': String(max),
    onpointerdown: (e) => { pad.setPointerCapture(e.pointerId); pick(e); },
    onpointermove: (e) => { if (pad.hasPointerCapture(e.pointerId)) pick(e); },
    onkeydown: (e) => {
      const step = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5 }[e.key];
      if (!step) return;
      e.preventDefault();
      setForce(Math.min(max, Math.max(0, get().wind + step)));
    },
  });
  const quick = WIND_QUICK.filter((v) => v <= max).map((v) => el('button', { type: 'button', onclick: () => setForce(v) },
    el('b', {}, fmt(v, 0)), el('small', {})));
  dial.append(face, pad, ...hours);

  const paint = () => {
    const { clock: v, wind: w } = get();
    hours.forEach((b, i) => {
      b.classList.toggle('on', i + 1 === v);
      b.setAttribute('aria-checked', String(i + 1 === v));
    });
    wind.setAttribute('transform', `rotate(${v * 30} 50 50)`);
    wind.style.display = w > 0 ? '' : 'none';
    const r = R0 + RS * Math.min(1, w / max);
    shaft.setAttribute('y1', String(50 - r + 6));
    const [kx, ky] = dialPt(v * 30, r);
    knob.setAttribute('cx', kx.toFixed(2));
    knob.setAttribute('cy', ky.toFixed(2));
    knobText.setAttribute('x', kx.toFixed(2));
    knobText.setAttribute('y', (ky + 2.2).toFixed(2));
    knobText.textContent = fmt(w, w % 1 ? 1 : 0);
    knob.style.display = knobText.style.display = w > 0 ? '' : 'none';
    dial.classList.toggle('calm', w === 0);
    pad.setAttribute('aria-valuenow', String(w));
    pad.setAttribute('aria-valuetext', `${fmt(w)} м/с`);
    quick.forEach((b, i) => {
      b.setAttribute('aria-pressed', String(WIND_QUICK[i] === w));
      b.querySelector('small').textContent = short(ground(WIND_QUICK[i]));
    });
    note.textContent = w === 0 ? 'Штиль' : `${fmt(w, w % 1 ? 1 : 0)} м/с ${clockWord(v)}`;
    const g = ground(w);
    // Ознаки — за вітром на 10 м: якщо силу задано на висоті дрона, біля землі він слабший
    more.textContent = w > 0
      ? `Біля землі ${Math.abs(g - w) >= 0.1 ? `≈ ${fmt(g)} м/с — ` : ''}${WIND_SIGNS.find(([top]) => g <= top)[1]}.`
      : `Тягни від центру — сила вітру, край — ${fmt(max, 0)} м/с.`;
  };
  paint();
  return { el: el('div', { class: 'wind-pick-wrap' }, note, more, dial, el('div', { class: 'wp-quick' }, ...quick)), paint };
}
