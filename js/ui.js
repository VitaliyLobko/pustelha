// Спільне для екранів: побудова DOM, числа українською, збереження на пристрої.

const SVG = 'http://www.w3.org/2000/svg';

export const $ = (id) => document.getElementById(id);

/** Елемент з атрибутами й дітьми; 'svg:тег' — у просторі імен SVG, on… — слухачі. */
export function el(tag, attrs = {}, ...children) {
  const node = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

const formats = new Map();
/** Число з комою й фіксованою кількістю знаків; «−0,0» не показуємо. */
export function fmt(n, digits = 1) {
  if (!formats.has(digits)) formats.set(digits, new Intl.NumberFormat('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return formats.get(digits).format(Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n);
}

/** Число з поля: кома теж роздільник; не число — NaN. */
export const num = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/** Наконечник стрілки в (x, y), напрям (dx, dy) — одиничний вектор, s — довжина. */
export const arrowHead = (x, y, dx, dy, s) =>
  `M${x},${y} L${x - dx * s - dy * s * .6},${y - dy * s + dx * s * .6} L${x - dx * s + dy * s * .6},${y - dy * s - dx * s * .6} Z`;

export const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
export const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватний режим — працюємо без збереження */ }
};

export const vibrate = (ms) => navigator.vibrate?.(ms);

let toastT = 0;
/** Коротке повідомлення внизу екрана на 2,5 с. */
export function toast(text) {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { box.hidden = true; }, 2500);
}

/**
 * Стрічка-колесо з Shooter's Log: плитка посередині — в рамці, onFocus(плитка) пише її опис; вибирає тап.
 * Мишею: коліщатко — на плитку вперед/назад, тачпад гортає плавно; стрічку можна тягнути, клік після перетягування не вибирає.
 */
export function wheelStrip(strip, onFocus, item = '.tgt-opt') {
  // Клацання під пальцем, коли посередину стає інша плитка — лише від руки, не від програмного прокручування
  let last = null; let touched = false;
  strip.addEventListener('pointerdown', () => { touched = true; });
  strip.addEventListener('wheel', () => { touched = true; }, { passive: true });
  const focusMid = () => {
    const mid = strip.scrollLeft + strip.clientWidth / 2; let best = null; let gap = Infinity;
    strip.querySelectorAll(item).forEach((b) => {
      const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid);
      if (d < gap) { gap = d; best = b; }
    });
    strip.querySelectorAll(`${item}.focus`).forEach((b) => b !== best && b.classList.remove('focus'));
    best?.classList.add('focus');
    if (best && best !== last) { if (touched && last) vibrate(6); last = best; }
    if (best) onFocus(best);
  };
  let raf = 0;
  strip.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(focusMid); }, { passive: true });
  let wheelTo = null;
  const centerOn = (b) => strip.scrollTo({ left: b.offsetLeft + b.offsetWidth / 2 - strip.clientWidth / 2,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  strip.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    if (e.deltaMode === 0 && Math.abs(d) < 40) { strip.scrollLeft += d; return; }
    const from = wheelTo ?? strip.querySelector(`${item}.focus`);
    const to = d > 0 ? from?.nextElementSibling : from?.previousElementSibling;
    if (to) { wheelTo = to; centerOn(to); }
  }, { passive: false });
  strip.addEventListener('scrollend', () => { wheelTo = null; touched = false; });
  let drag = null;
  strip.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) drag = { x: e.clientX, left: strip.scrollLeft, moved: false };
  });
  strip.addEventListener('pointermove', (e) => {
    if (!drag || !(e.buttons & 1)) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) > 4) { drag.moved = true; strip.style.scrollSnapType = 'none'; strip.setPointerCapture(e.pointerId); }
    if (drag.moved) strip.scrollLeft = drag.left - (e.clientX - drag.x);
  });
  const dragEnd = () => {
    if (!drag) return;
    if (drag.moved) {
      strip.style.scrollSnapType = '';
      const b = strip.querySelector(`${item}.focus`); if (b) centerOn(b);
      setTimeout(() => { drag = null; }, 0);
    } else drag = null;
  };
  strip.addEventListener('click', (e) => { if (drag?.moved) { e.stopPropagation(); e.preventDefault(); } }, true);
  strip.addEventListener('pointerup', dragEnd);
  strip.addEventListener('pointercancel', dragEnd);
  return {
    centerOn,
    // Відступи по краях — щоб і крайня плитка ставала в рамку посередині; вибрана — одразу в рамці, сторінка не гортається
    settle: (on) => {
      if (!strip.clientWidth) return;
      strip.style.paddingInline = `${Math.max(0, strip.clientWidth / 2 - 22)}px`;
      strip.scrollLeft = on ? on.offsetLeft + on.offsetWidth / 2 - strip.clientWidth / 2 : 0;
      focusMid();
    },
  };
}

/** Звідки дме за годинником від носа дрона — словами. */
const CLOCK_WORDS = {
  12: 'в лоб', 1: 'спереду-справа', 2: 'спереду-справа', 3: 'справа', 4: 'ззаду-справа', 5: 'ззаду-справа',
  6: 'в спину', 7: 'ззаду-зліва', 8: 'ззаду-зліва', 9: 'зліва', 10: 'спереду-зліва', 11: 'спереду-зліва',
};
export const clockWord = (h) => `з ${h} год — ${CLOCK_WORDS[h]}`;

/** «1,2 м попереду і 0,4 м ліворуч» — у системі дрона (x — вперед, y — праворуч). */
export function where(x, y, [fwd, back] = ['попереду', 'позаду']) {
  const parts = [];
  if (Math.abs(x) >= 0.05) parts.push(`${fmt(Math.abs(x))} м ${x > 0 ? fwd : back}`);
  if (Math.abs(y) >= 0.05) parts.push(`${fmt(Math.abs(y))} м ${y > 0 ? 'праворуч' : 'ліворуч'}`);
  return parts.join(' і ');
}
