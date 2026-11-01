import { solve, simulate, windVector } from './ballistics.js';
import { $, el, fmt, num, read, write, arrowHead, clockWord, where } from './ui.js';
import { windPicker } from './wind-pick.js';
import { initSim } from './sim.js';
import { renderSettings } from './settings.js';

const KEY = 'pustelha:calc';
const LOADS_KEY = 'pustelha:loads';

// Умовні вантажі для прототипу — не реальні вироби
const PRESETS = [
  { id: 'c05', name: 'Умовний 0,5 кг', mass: 0.5, diameter: 50, cd: 0.6 },
  { id: 'c1', name: 'Умовний 1 кг', mass: 1, diameter: 70, cd: 0.5 },
  { id: 'c2', name: 'Умовний 2 кг', mass: 2, diameter: 100, cd: 0.45 },
];
const DEFAULTS = { height: 100, speed: 0, delay: 0, wind: 4, clock: 3, profile: true, tempC: 15, elevation: 150, load: 'c1' };
const TABLE_HEIGHTS = [25, 50, 75, 100, 150, 200, 250, 300];

const state = { ...DEFAULTS, ...read(KEY, {}) };
let custom = read(LOADS_KEY, []);
const save = () => write(KEY, state);
const saveLoads = () => write(LOADS_KEY, custom);

/* --- повзунок + число --- */
function bindPairs() {
  for (const field of document.querySelectorAll('.field[data-key]')) {
    const key = field.dataset.key;
    const range = $(`r-${key}`), box = $(`f-${key}`);
    for (const input of [range, box]) {
      input.min = field.dataset.min;
      input.step = field.dataset.step;
    }
    range.max = field.dataset.max;
    range.value = box.value = state[key];
    range.addEventListener('input', () => {
      state[key] = num(range.value);
      box.value = range.value;
      box.classList.remove('invalid');
      changed();
    });
    box.addEventListener('input', () => {
      const v = num(box.value);
      const ok = Number.isFinite(v) && v >= num(field.dataset.min);
      box.classList.toggle('invalid', !ok);
      if (!ok) return;
      state[key] = v;
      range.value = v;
      changed();
    });
  }
}

function bindProfile() {
  for (const b of $('profile').querySelectorAll('button')) {
    b.addEventListener('click', () => { state.profile = b.dataset.v === '1'; changed(); });
  }
}

/* --- вантаж --- */
const allLoads = () => [...PRESETS, ...custom];
const currentLoad = () => allLoads().find((l) => l.id === state.load) || PRESETS[1];
const isPreset = (l) => PRESETS.some((p) => p.id === l.id);

function paintLoads() {
  const sel = $('load');
  sel.replaceChildren(
    el('optgroup', { label: 'Умовні' }, PRESETS.map((l) => el('option', { value: l.id }, l.name))),
    custom.length ? el('optgroup', { label: 'Свої' }, custom.map((l) => el('option', { value: l.id }, l.name || 'Без назви'))) : null,
    el('option', { value: 'new' }, '＋ Новий вантаж'));
  const load = currentLoad();
  sel.value = load.id;
  const preset = isPreset(load);
  for (const k of ['mass', 'diameter', 'cd']) {
    const input = $(`l-${k}`);
    input.value = load[k];
    input.readOnly = preset;
    input.classList.remove('invalid');
  }
  $('l-name-row').hidden = preset;
  $('l-name').value = load.name;
  const note = $('load-note');
  note.className = preset ? 'note warn' : 'note';
  note.textContent = preset
    ? 'Умовні цифри для прикладу — не реальний виріб. Для свого вантажу натисни «Зробити свій» і впиши масу, діаметр корпусу та Cd.'
    : 'Cd — коефіцієнт опору: що більший, то сильніше гальмує повітря і зносить вітер. Орієнтири з підручника: куля ≈ 0,47, циліндр торцем ≈ 0,8, кубик ≈ 1,05.';
  $('load-actions').replaceChildren(preset
    ? el('button', { type: 'button', class: 'btn', onclick: () => addLoad({ ...load, name: `${load.name} (свій)` }) }, 'Зробити свій')
    : el('button', { type: 'button', class: 'btn danger', onclick: removeLoad }, 'Видалити'));
}

function addLoad(from) {
  const load = { id: `u${Date.now().toString(36)}`, name: from.name, mass: from.mass, diameter: from.diameter, cd: from.cd };
  custom.push(load);
  state.load = load.id;
  saveLoads();
  paintLoads();
  changed();
  $('l-name').focus();
  $('l-name').select();
}

function removeLoad() {
  custom = custom.filter((l) => l.id !== state.load);
  state.load = PRESETS[1].id;
  saveLoads();
  paintLoads();
  changed();
}

function bindLoads() {
  $('load').addEventListener('change', (e) => {
    if (e.target.value === 'new') { addLoad({ name: 'Свій вантаж', mass: 1, diameter: 60, cd: 0.5 }); return; }
    state.load = e.target.value;
    paintLoads();
    changed();
  });
  for (const k of ['mass', 'diameter', 'cd']) {
    $(`l-${k}`).addEventListener('input', (e) => {
      const load = currentLoad();
      if (isPreset(load)) return;
      const v = num(e.target.value);
      const ok = Number.isFinite(v) && (k === 'cd' ? v >= 0 : v > 0);
      e.target.classList.toggle('invalid', !ok);
      if (!ok) return;
      load[k] = v;
      saveLoads();
      changed();
    });
  }
  $('l-name').addEventListener('input', (e) => {
    const load = currentLoad();
    if (isPreset(load)) return;
    load.name = e.target.value.trim();
    saveLoads();
    const opt = $('load').querySelector(`option[value="${load.id}"]`);
    if (opt) opt.textContent = load.name || 'Без назви';
  });
}

/* --- повітря --- */
function bindAir() {
  for (const k of ['tempC', 'elevation']) {
    const input = $(`f-${k}`);
    input.value = state[k];
    input.addEventListener('input', () => {
      const v = num(input.value);
      const ok = Number.isFinite(v) && (k === 'tempC' ? v > -60 && v < 60 : v >= -400 && v < 6000);
      input.classList.toggle('invalid', !ok);
      if (!ok) return;
      state[k] = v;
      changed();
    });
  }
}

/* --- розрахунок і розбір --- */
const params = (height = state.height) => ({
  height,
  speed: state.speed,
  delay: state.delay,
  wind: state.wind,
  clock: state.clock,
  profile: state.profile ? 1 / 7 : 0,
  tempC: state.tempC,
  elevation: state.elevation,
});


function stat(label, value, unit, sub, cls = '') {
  return el('div', { class: `stat ${cls}` },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value' }, value, unit ? el('small', {}, unit) : null),
    sub ? el('div', { class: 'stat-sub' }, sub) : null);
}

function render() {
  const out = $('result');
  const load = currentLoad();
  if (!(load.mass > 0 && load.diameter > 0 && load.cd >= 0) || !(state.height > 0)) {
    out.replaceChildren(el('p', { class: 'error' }, 'Перевір висоту і параметри вантажу — розрахунку немає.'));
    return;
  }
  const r = solve(params(), load);
  const dist = Math.hypot(r.x, r.y);
  const driftLen = Math.hypot(r.drift.x, r.drift.y);
  const hover = !state.speed;

  const lines = [
    el('li', {}, `Падає ${fmt(r.time)} с, біля землі ${fmt(r.impactSpeed, 0)} м/с`
      + (r.impactSpeed > 0.9 * r.vt ? ' — майже гранична швидкість, далі не розганяється.' : '.')),
  ];
  if (!hover) {
    const delayPart = state.delay ? ` (з них ${fmt(state.speed * state.delay)} м — затримка скиду)` : '';
    lines.push(el('li', { class: 'carry' }, `Рух дрона ${fmt(state.speed)} м/с: вантаж летить вперед за інерцією і пролітає ${fmt(r.carry.x)} м${delayPart}.`));
  }
  if (state.wind > 0) {
    lines.push(el('li', { class: 'wind' }, driftLen >= 0.05
      ? `Вітер ${fmt(state.wind)} м/с ${clockWord(state.clock)}: зносить на ${fmt(driftLen)} м (${where(r.drift.x, r.drift.y)}).`
      : `Вітер ${fmt(state.wind)} м/с майже не встигає знести — менше 5 см.`));
  }
  lines.push(el('li', { class: 'aim' }, dist < 0.1
    ? 'Скидай прямо над ціллю — поправка менша за 10 см.'
    : hover
      ? `Щоб влучити: зависни так, щоб ціль була ${where(r.x, r.y)} від точки під дроном — дрон стоїть проти вітру від цілі.`
      : `Щоб влучити: у момент скиду ціль має бути ${where(r.x, r.y)} від точки під дроном.`));
  lines.push(el('li', { class: 'small muted' }, 'Точка під дроном = центр кадру, лише коли камера дивиться строго вниз (−90°).'));

  out.replaceChildren(
    el('h2', {}, 'Куди впаде'),
    el('div', { class: 'stats' },
      stat('Точка падіння', fmt(dist), 'м', dist >= 0.05 ? where(r.x, r.y) : 'під дроном', 'hit'),
      stat('Час падіння', fmt(r.time), 'с', `з ${fmt(state.height, 0)} м`),
      stat('Знесення вітром', fmt(driftLen), 'м', state.wind > 0 ? `${fmt(state.wind)} м/с, ${clockWord(state.clock)}` : 'без вітру'),
      stat('Швидкість удару', fmt(r.impactSpeed, 0), 'м/с', `${fmt(r.impactAngle, 0)}° від вертикалі · гранична ${fmt(r.vt, 0)} м/с`)),
    plan(r),
    el('ul', { class: 'explain' }, lines),
    el('fieldset', { class: 'box' }, el('legend', {}, 'За висотою'), heightTable(load)));
}

/* Схема згори: центр — точка під дроном, ніс угору; масштаб підбирається під точку падіння */
function plan(r) {
  const pts = r.path.filter((_, i) => i % 15 === 0).concat([r.path[r.path.length - 1]]);
  const reach = Math.max(0.5, ...pts.map((p) => Math.hypot(p[0], p[1])));
  const step = niceStep(reach / 3);
  const rings = Math.max(1, Math.ceil(reach / step));
  const sc = 132 / (rings * step);
  const P = (x, y) => [y * sc, -x * sc];

  const svg = el('svg:svg', { class: 'plan', viewBox: '-170 -170 340 340', role: 'img',
    'aria-label': `Схема згори: точка падіння ${where(r.x, r.y) || 'під дроном'}` });
  svg.append(el('svg:line', { class: 'axis', x1: 0, y1: -150, x2: 0, y2: 150 }),
    el('svg:line', { class: 'axis', x1: -150, y1: 0, x2: 150, y2: 0 }));
  for (let k = 1; k <= rings; k++) {
    const rr = k * step * sc;
    svg.append(el('svg:circle', { class: 'ring', r: rr }),
      el('svg:text', { class: 'ring-label', x: rr * 0.71 + 3, y: -rr * 0.71 - 3 }, `${fmt(k * step, step < 1 ? 1 : 0)} м`));
  }
  svg.append(el('svg:path', { class: 'nose', d: 'M-6,-150 L0,-162 L6,-150 Z' }),
    el('svg:text', { class: 'nose-label', x: 10, y: -152 }, 'ніс дрона'));
  svg.append(el('svg:path', { class: 'track', d: pts.map((p, i) => `${i ? 'L' : 'M'}${P(p[0], p[1]).map((v) => v.toFixed(1)).join(',')}`).join(' ') }));
  svg.append(el('svg:path', { class: 'nadir', d: 'M-8,0 H8 M0,-8 V8' }),
    el('svg:text', { class: 'nadir-label', x: -10, y: 18, 'text-anchor': 'end' }, 'під дроном'));
  const [hx, hy] = P(r.x, r.y);
  svg.append(el('svg:circle', { class: 'hit-ring', cx: hx, cy: hy, r: 9 }),
    el('svg:circle', { class: 'hit', cx: hx, cy: hy, r: 4 }),
    el('svg:text', { class: 'hit-label', x: hx + (hx > 90 ? -14 : 14), y: hy + (hy < -140 ? 20 : -10), 'text-anchor': hx > 90 ? 'end' : 'start' }, `${fmt(Math.hypot(r.x, r.y))} м`));
  if (state.wind > 0) {
    // Куди рухається повітря, у кутку схеми
    const w = windVector(1, state.clock);
    const dx = w.y, dy = -w.x;
    const cx = -128, cy = 132;
    svg.append(el('svg:line', { class: 'wind', x1: cx - dx * 16, y1: cy - dy * 16, x2: cx + dx * 10, y2: cy + dy * 10 }),
      el('svg:path', { class: 'wind-head', d: arrowHead(cx + dx * 18, cy + dy * 18, dx, dy, 8) }),
      el('svg:text', { class: 'wind-label', x: cx + 26, y: cy + 4 }, `вітер ${fmt(state.wind)} м/с`));
  }
  return svg;
}

function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= v) || 10 * p;
}

function heightTable(load) {
  const heights = [...new Set([...TABLE_HEIGHTS, state.height])].sort((a, b) => a - b);
  const moving = state.speed > 0;
  const rows = heights.map((h) => {
    const s = params(h);
    const r = simulate(s, load);
    const calm = state.wind > 0 ? simulate({ ...s, wind: 0 }, load) : r;
    return el('tr', { class: h === state.height ? 'cur' : '' },
      el('td', {}, `${fmt(h, 0)} м`),
      el('td', {}, fmt(r.time)),
      moving ? el('td', {}, fmt(calm.x)) : null,
      el('td', {}, fmt(Math.hypot(r.x - calm.x, r.y - calm.y))),
      // При зависанні точка падіння = знесення вітром, окрема колонка зайва
      moving ? el('td', {}, fmt(Math.hypot(r.x, r.y))) : null);
  });
  return el('table', { class: 'table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Висота'), el('th', {}, 'Час, с'), moving ? el('th', {}, 'Вперед, м') : null,
      el('th', {}, 'Вітер, м'), moving ? el('th', {}, 'Точка, м') : null)),
    el('tbody', {}, rows));
}

/* --- оновлення екрана --- */
let frame = 0;
function changed() {
  save();
  paintStatic();
  // Повзунок шле input десятки разів на секунду — рахуємо раз на кадр
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
}

// Вітер у розрахунку — той самий годинник, що й у тренажері; край шкали — 15 м/с
const calcWind = windPicker({ get: () => state, set: (v) => { Object.assign(state, v); changed(); }, max: 15 });

function paintStatic() {
  calcWind.paint();
  for (const b of $('profile').querySelectorAll('button')) b.classList.toggle('on', (b.dataset.v === '1') === state.profile);
  $('speed-hint').textContent = state.speed ? '' : '· зависання';
  $('air-sum').textContent = `· ${fmt(state.tempC, 0)} °C, ${fmt(state.elevation, 0)} м над морем`;
}

function registerSW() {
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname) && !new URLSearchParams(location.search).has('sw');
  if (!('serviceWorker' in navigator) || local) return;
  const offer = (worker) => {
    $('update').hidden = false;
    $('update-btn').onclick = () => worker.postMessage('skipWaiting');
  };
  // updateViaCache 'none' — перевірка оновлення не бере sw.js і version.js з HTTP-кешу.
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((err) => console.warn('SW registration failed', err));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/* --- вкладки: тренажер і розрахунок; ⚙ — налаштування поверх них --- */
const TAB_KEY = 'pustelha:tab';
let sim = null;
let tabNow = 'sim';
function showTab(tab) {
  tabNow = tab;
  for (const b of document.querySelectorAll('.tabs button')) {
    b.classList.toggle('on', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  $('pane-sim').hidden = tab !== 'sim';
  $('pane-calc').hidden = tab !== 'calc';
  $('pane-set').hidden = true;
  $('gear').setAttribute('aria-pressed', 'false');
  write(TAB_KEY, tab);
  if (tab === 'sim') {
    sim ??= initSim({ loads: allLoads, loadById: (id) => allLoads().find((l) => l.id === id) || PRESETS[1] });
    sim.show();
  }
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));

function showSettings() {
  for (const b of document.querySelectorAll('.tabs button')) {
    b.classList.remove('on');
    b.setAttribute('aria-selected', 'false');
  }
  $('pane-sim').hidden = $('pane-calc').hidden = true;
  renderSettings($('pane-set'));
  $('pane-set').hidden = false;
  $('gear').setAttribute('aria-pressed', 'true');
}
// Повторний тап по ⚙ — назад туди, звідки прийшов
$('gear').addEventListener('click', () => ($('pane-set').hidden ? showSettings() : showTab(tabNow)));

$('ver').textContent = `v${self.APP_VERSION}`;
$('calc-wind').append(calcWind.el);
bindPairs();
bindProfile();
bindLoads();
bindAir();
paintLoads();
paintStatic();
render();
showTab(read(TAB_KEY, 'sim') === 'calc' ? 'calc' : 'sim');
registerSW();
