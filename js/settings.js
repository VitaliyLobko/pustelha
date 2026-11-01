// ⚙ Налаштування — як у Shooter's Log: групи в рамках, рядки «іконка · назва · значення ›», тап розгортає один рядок.
import { el, read, write, toast } from './ui.js';

export const THEME_KEY = 'pustelha:theme';
const RENEW_KEY = 'pustelha:renew';
const OPEN_KEY = 'pustelha:set-open';
const THEMES = [['auto', 'Авто'], ['dark', 'Темна'], ['light', 'Світла'], ['night', 'Нічна']];

const ICONS = {
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7.2" r="1.2"/><circle cx="14.5" cy="7.2" r="1.2"/>',
  renew: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
};
const icon = (name) => {
  const s = el('span', { class: 'set-ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return s;
};

export const themePref = () => read(THEME_KEY, 'auto');

/** Тема на <html>: «Авто» стежить за телефоном і перемикається разом із ним. */
export function applyTheme() {
  const pref = themePref();
  const light = pref === 'light' || (pref === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = pref === 'night' ? 'night' : light ? 'light' : 'dark';
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (themePref() === 'auto') applyTheme(); });

/** Що міняє «Нова ситуація», крім місць цілей. */
export const RENEW_MODES = [['static', 'Статично'], ['wind', 'Зміна вітру'], ['move', 'Зміна руху'], ['both', 'Вітер і рух']];
export const renewPref = () => {
  const m = read(RENEW_KEY, 'static');
  return RENEW_MODES.some(([k]) => k === m) ? m : 'static';
};
export const setRenew = (m) => write(RENEW_KEY, m);
export const RENEW_NOTE = {
  static: 'Цілі на нових місцях, вітер і рух — як вибрав.',
  wind: 'Цілі на нових місцях і випадковий вітер — сила й напрям.',
  move: 'Цілі на нових місцях і випадковий рух — швидкість і напрям.',
  both: 'Цілі на нових місцях, випадкові вітер і рух.',
};

function group(title, items) {
  return el('fieldset', { class: 'box settings-group' }, el('legend', {}, title), items);
}

function setRow(key, ico, title, value, body) {
  const open = read(OPEN_KEY, '') === key;
  const row = el('div', { class: `set-row${open ? ' open' : ''}` });
  const head = el('button', {
    type: 'button', class: 'set-head', 'aria-expanded': String(open), onclick: () => {
      const opening = !row.classList.contains('open');
      for (const r of document.querySelectorAll('.set-row.open')) setOpen(r, false);
      setOpen(row, opening);
      write(OPEN_KEY, opening ? key : '');
    },
  }, icon(ico), el('span', { class: 'set-title' }, title), el('span', { class: 'set-val' }, value),
  el('span', { class: 'set-chev', 'aria-hidden': 'true' }, '›'));
  const bodyEl = el('div', { class: 'set-body' }, el('div', { class: 'set-inner' }, el('div', { class: 'set-pane' }, body)));
  bodyEl.inert = !open;
  row.append(head, bodyEl);
  return row;
}
function setOpen(row, open) {
  row.classList.toggle('open', open);
  row.querySelector('.set-head').setAttribute('aria-expanded', String(open));
  row.querySelector('.set-body').inert = !open;
}

const chips = (list, isOn, pick) => el('div', { class: 'chips' }, list.map(([v, label]) =>
  el('button', { type: 'button', class: isOn(v) ? 'on' : null, 'aria-pressed': String(isOn(v)), onclick: () => pick(v) }, label)));

function aboutPanel() {
  return el('section', { class: 'about' },
    el('h3', {}, 'Пустельга'),
    el('p', { class: 'muted small' }, `Версія ${self.APP_VERSION} · збірка ${self.APP_BUILD ?? '—'}`),
    el('p', { class: 'muted small' }, 'Тренажер скиду з дрона: висота, вітер, вантаж, рухомі цілі. Працює без інтернету, усе рахується на пристрої.'),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: checkUpdate }, 'Перевірити оновлення')));
}

function themeRow(rerender) {
  return setRow('theme', 'palette', 'Тема', THEMES.find(([k]) => k === themePref())[1], [
    chips(THEMES, (v) => v === themePref(), (v) => { write(THEME_KEY, v); applyTheme(); rerender(); }),
    el('p', { class: 'muted small' }, 'Нічна — уся сторінка червоним, щоб не збивати нічний зір.'),
  ]);
}

function renewRow(rerender) {
  const m = renewPref();
  return setRow('renew', 'renew', 'Нова ситуація', RENEW_MODES.find(([k]) => k === m)[1], [
    chips(RENEW_MODES, (v) => v === m, (v) => { setRenew(v); rerender(); }),
    el('p', { class: 'muted small' }, `${RENEW_NOTE[m]} Те саме — кнопкою ▾ біля ⟳ під кадром.`),
  ]);
}

/** Сторінка налаштувань; rerender — перемалювати її після зміни. */
export function renderSettings(root) {
  const rerender = () => renderSettings(root);
  root.replaceChildren(el('div', { class: 'settings' },
    group('Про застосунок', [aboutPanel()]),
    group('Вигляд', [themeRow(rerender)]),
    group('Тренажер', [renewRow(rerender)])));
}

async function checkUpdate() {
  if (!('serviceWorker' in navigator)) { toast('Оновлення працюють лише по https'); return; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { toast('Застосунок ще не встановлено як офлайн-копію'); return; }
  // Без мережі reg.update() не падає, а тихо завершується — інакше вийшло б «у вас найновіша версія»
  if (!navigator.onLine) { toast('Немає зв’язку з сервером'); return; }
  toast('Перевіряю оновлення…');
  // Wi-Fi без інтернету браузер теж вважає «онлайн» — питаємо сам сервер; HEAD іде повз service worker
  try {
    const res = await fetch('./version.js', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    await reg.update();
  } catch {
    toast('Немає зв’язку з сервером');
    return;
  }
  toast(reg.installing || reg.waiting ? 'Є нова версія — натисни «Оновити» вгорі' : 'У тебе найновіша версія');
}
