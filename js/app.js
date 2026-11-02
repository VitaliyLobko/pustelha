import { solve, simulate, meanWind, levelWind, scatter, gustStats } from './ballistics.js';
import { TERRAINS, GUSTS, REFS, z0Of, clockOf, windSpec } from './wind.js';
import { LEVELS, parseCoords, coarse, posText, fetchForecast, loadFc, saveFc, fcAge, fcSlot } from './forecast.js';
import { $, el, fmt, num, read, write, arrowHead, clockWord, where } from './ui.js';
import { windPicker } from './wind-pick.js';
import { initSim } from './sim.js';
import { renderSettings } from './settings.js';
import { WARHEADS, warhead, charge, radii, describe } from './warhead.js';
import { cond, saveCond, fcUsed, condParams } from './cond.js';
import { findPlaces } from './places.js';
import { compassRose } from './compass.js';

const LOADS_KEY = 'pustelha:loads';

// Умовні вантажі для прототипу — не реальні вироби; по одному на тип БЧ
const PRESETS = [
  { id: 'c05', name: 'Умовний осколковий 0,5 кг', mass: 0.5, diameter: 50, cd: 0.6, type: 'frag', ex: 0.1 },
  { id: 'c1', name: 'Умовний фугасний 1 кг', mass: 1, diameter: 70, cd: 0.5, type: 'he', ex: 0.5 },
  { id: 'c2', name: 'Умовний кумулятивний 2 кг', mass: 2, diameter: 100, cd: 0.45, type: 'heat', ex: 0.6 },
];
const TABLE_HEIGHTS = [25, 50, 75, 100, 150, 200, 250, 300];

// Умови скиду — спільні з тренажером (cond.js); тут їх задають
const state = cond;
let custom = read(LOADS_KEY, []);
const save = saveCond;
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

/* --- вітер: вручну чи з прогнозу, місцевість, пориви --- */
let fc = loadFc();
let rose = null;
const fieldVal = (k) => (k === 'heading' ? String(state.heading || 0) : state[k] ? String(state[k]) : '');
/** Прогноз на вибрану годину; номер години — у межах того, що є в прогнозі. */
const fcNow = () => {
  const n = fc?.hours?.length || 1;
  if (!(state.fcHour < n)) state.fcHour = 0;
  return fcSlot(fc, state.fcHour);
};
const SEGS =[['w-src', 'src', null], ['w-ref', 'ref', REFS], ['w-meas-at', 'measAt', REFS], ['w-terrain', 'terrain', TERRAINS], ['w-gust', 'gusts', GUSTS]];
function bindWind() {
  for (const [id, key, list] of SEGS) {
    if (list) $(id).replaceChildren(...list.map(([v, label]) => el('button', { type: 'button', 'data-v': v }, label)));
    for (const b of $(id).querySelectorAll('button')) b.addEventListener('click', () => { state[key] = b.dataset.v; changed(); });
  }
  // Курс — розою компаса або числом; 0 видно як «0», а не порожнім полем — інакше схоже на «не задано»
  rose = compassRose({
    get: () => state.heading || 0,
    set: (deg) => { state.heading = deg; $('f-heading').value = String(deg); $('f-heading').classList.remove('invalid'); changed(); },
  });
  $('w-head').replaceChildren(rose.node);
  for (const [k, max] of [['heading', 359], ['meas', 40]]) {
    const input = $(`f-${k}`);
    input.value = fieldVal(k);
    input.addEventListener('input', () => {
      const v = input.value.trim() === '' ? 0 : num(input.value);
      const ok = Number.isFinite(v) && v >= 0 && v <= max;
      input.classList.toggle('invalid', !ok);
      if (!ok) return;
      state[k] = v;
      changed();
    });
  }
  const pos = $('fc-pos');
  pos.value = state.pos;
  pos.addEventListener('change', () => {
    // Зберігаємо лише огрублене — точних координат на пристрої не лишається
    const p = parseCoords(pos.value);
    if (p) { const c = coarse(p); state.pos = pos.value = posText(c); save(); }
  });
  $('fc-get').addEventListener('click', getForecast);
  // Windy й Ventusky — на клітинці з поля місця; посилання складаємо в мить натискання, поле могло змінитись
  const links = {
    'fc-windy': (lat, lon) => `https://www.windy.com/?wind,100m,${lat},${lon},10`,
    'fc-ventusky': (lat, lon) => `https://www.ventusky.com/?p=${lat};${lon};9&l=wind-100m`,
  };
  for (const [id, url] of Object.entries(links)) {
    $(id).addEventListener('click', (e) => {
      const p = parseCoords(pos.value);
      if (!p) { e.preventDefault(); paintFc('Спершу вибери місце: назвою, на карті чи координатами.', 'warn'); return; }
      const c = coarse(p);
      e.currentTarget.href = url(c.lat.toFixed(1), c.lon.toFixed(1));
    });
  }
  // Карта вантажиться лише на вимогу: потрібна рідко, а підкладку тягне з мережі
  $('fc-map').addEventListener('click', async () => {
    const { openMap } = await import('./map.js');
    openMap({
      start: parseCoords(pos.value),
      onPick: (c, now) => {
        state.pos = pos.value = posText(c);
        save();
        if (now) getForecast();
      },
    });
  });
}

async function getForecast() {
  const text = $('fc-pos').value.trim();
  const p = parseCoords(text);
  if (p) return forecastAt(p);
  if (/\p{L}{2}/u.test(text) && !/https?:|goo\.gl/i.test(text)) return findByName(text);
  paintFc('Не бачу ні координат, ні назви. Потрібна назва населеного пункту, цифри на кшталт «48.51, 37.98» або посилання з Google Maps. Коротке посилання maps.app.goo.gl не підходить — скопіюй самі цифри.', 'warn');
}

/** Назва замість координат: один збіг — одразу прогноз, кілька — вибір. */
async function findByName(text) {
  paintFc(`Шукаю «${text}»…`);
  let hits;
  try {
    hits = await findPlaces(text);
  } catch {
    paintFc(navigator.onLine ? 'Пошук не відповів. Спробуй ще раз.' : 'Немає мережі — пошук не працює.', 'warn');
    return;
  }
  if (!hits.length) { paintFc(`«${text}» не знайшов. Перевір назву або введи координати.`, 'warn'); return; }
  if (hits.length === 1) { forecastAt(hits[0]); return; }
  $('fc-out').replaceChildren(el('p', { class: 'note' }, 'Кілька збігів — вибери:'),
    el('ul', { class: 'place-list' }, hits.map((h) => el('li', {},
      el('button', { type: 'button', onclick: () => forecastAt(h) }, h.name, el('span', {}, h.where))))));
}

async function forecastAt(p) {
  const c = coarse(p);
  state.pos = $('fc-pos').value = posText(c);
  save();
  const btn = $('fc-get');
  btn.disabled = true;
  paintFc('Питаю прогноз…');
  try {
    fc = await fetchForecast(c);
    saveFc(fc);
    state.src = 'fc';
    changed();
  } catch (err) {
    paintFc(navigator.onLine ? `Сервер прогнозу не відповів (${err.message}). Спробуй ще раз.` : 'Немає мережі — прогноз узяти ніде.', 'warn');
  } finally {
    btn.disabled = false;
  }
}

/** Таблиця прогнозу по висотах або повідомлення. */
function paintFc(msg, cls = '') {
  const out = $('fc-out');
  if (msg) { out.replaceChildren(el('p', { class: `note ${cls}` }, msg)); return; }
  if (!fc) { out.replaceChildren(); return; }
  const age = fcAge(fc);
  const f = fcNow();
  // Нижче 10 м — як над відкритим місцем: місцевість з прогнозом не задаємо
  const z0 = z0Of('open');
  const H = state.height;
  const rows = [...f.levels.map((l) => [l.z, l.speed, l.dir]), [H, levelWind(f.levels, H, z0).speed, levelWind(f.levels, H, z0).dir]]
    .sort((a, b) => a[0] - b[0]);
  // Година вильоту: «зараз» і наступні повні години — у кожної свій вітер
  const hours = fc.hours?.length > 1 ? el('div', { class: 'chips fc-hours', role: 'group', 'aria-label': 'На яку годину' },
    fc.hours.map((h, i) => el('button', {
      type: 'button', class: i === state.fcHour ? 'on' : null, 'aria-pressed': String(i === state.fcHour),
      onclick: () => { state.fcHour = i; changed(); },
    }, i ? h.time.slice(11, 16) : 'Зараз'))) : null;
  out.replaceChildren(
    hours ? el('div', { class: 'label' }, 'На коли') : '', hours || '',
    el('p', { class: `note${age.stale ? ' warn' : ''}` }, `Прогноз на ${f.time.slice(11, 16)}, отримано ${age.text}${age.stale ? ' — застарів, онови' : ''} · пориви біля землі до ${fmt(f.gust10)} м/с · ${fmt(f.tempC, 0)} °C, ${fmt(f.pressure, 0)} гПа`),
    el('table', { class: 'table fc-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Висота'), el('th', {}, 'Вітер, м/с'), el('th', {}, 'Звідки'), el('th', {}, 'Від носа'))),
      el('tbody', {}, rows.map(([z, sp, dir]) => el('tr', { class: z === H && !LEVELS.includes(H) ? 'cur' : '' },
        el('td', {}, `${fmt(z, 0)} м`), el('td', {}, fmt(sp)), el('td', {}, `${fmt(dir, 0)}°`), el('td', {}, `${clockOf(dir, state.heading)} год`))))));
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
  $('l-type').value = warhead(load).id;
  $('l-type').disabled = preset;
  $('l-ex').value = charge(load);
  $('l-ex').readOnly = preset;
  $('l-ex').classList.remove('invalid');
  paintWarhead(load);
  $('l-name-row').hidden = preset;
  $('l-name').value = load.name;
  const note = $('load-note');
  note.className = preset ? 'note warn' : 'note';
  note.textContent = preset
    ? 'Умовні цифри для прикладу — не реальний виріб. Для свого вантажу натисни «Зробити свій» і впиши масу, діаметр корпусу, Cd, тип БЧ і масу ВР.'
    : 'Cd — коефіцієнт опору: що більший, то сильніше гальмує повітря і зносить вітер. Орієнтири з підручника: куля ≈ 0,47, циліндр торцем ≈ 0,8, кубик ≈ 1,05.';
  $('load-actions').replaceChildren(preset
    ? el('button', { type: 'button', class: 'btn', onclick: () => addLoad({ ...load, name: `${load.name} (свій)` }) }, 'Зробити свій')
    : el('button', { type: 'button', class: 'btn danger', onclick: removeLoad }, 'Видалити'));
}

function paintWarhead(load) {
  const r = radii(load);
  $('wh-note').textContent = warhead(load).id === 'heat'
    ? `Кумулятивна пробиває броню лише прямим влучанням; по живій силі — як невеликий фугас: ураження ${fmt(r.kill)} м, поранення ${fmt(r.wound)} м.`
    : `Від краю цілі: ураження ${fmt(r.kill)} м, поранення ${fmt(r.wound)} м. Радіус росте як ∛ маси ВР — удвічі більший заряд дає лише +26 %.`;
}

function addLoad(from) {
  const load = {
    id: `u${Date.now().toString(36)}`, name: from.name, mass: from.mass, diameter: from.diameter, cd: from.cd,
    type: warhead(from).id, ex: charge(from),
  };
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
  $('l-type').replaceChildren(...WARHEADS.map((w) => el('option', { value: w.id }, w.name)));
  $('l-type').addEventListener('change', (e) => {
    const load = currentLoad();
    if (isPreset(load)) return;
    load.type = e.target.value;
    saveLoads();
    paintWarhead(load);
    changed();
  });
  $('l-ex').addEventListener('input', (e) => {
    const load = currentLoad();
    if (isPreset(load)) return;
    const v = num(e.target.value);
    // ВР не важча за весь вантаж
    const ok = Number.isFinite(v) && v > 0 && v <= load.mass;
    e.target.classList.toggle('invalid', !ok);
    if (!ok) return;
    load.ex = v;
    saveLoads();
    paintWarhead(load);
    changed();
  });
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
const fcOn = () => fcUsed(fc);
// Повітря — з прогнозу, якщо він увімкнений (температура й тиск), інакше з полів «Повітря»
const params = (height = state.height) => condParams(fc, { height });

/** Вітер на висоті z словами для дрона: сила і година «звідки» відносно носа. */
function windAt(s, z) {
  const a = meanWind(s)(z);
  const speed = Math.hypot(a.x, a.y);
  const deg = (Math.atan2(-a.y, -a.x) * 180 / Math.PI + 360) % 360;
  return { speed, clock: Math.round(deg / 30) % 12 || 12, x: a.x, y: a.y };
}

function stat(label, value, unit, sub, cls = '') {
  return el('div', { class: `stat ${cls}` },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value' }, value, unit ? el('small', {}, unit) : null),
    sub ? el('div', { class: 'stat-sub' }, sub) : null);
}

// «i» живе між перерисовками блоку — створюємо раз, щоб не губився стан «відкрито»
const calcHelpBtn = el('button', {
  type: 'button', class: 'hint-btn', 'aria-expanded': 'false', 'aria-controls': 'calc-help', 'aria-label': 'Що на схемі', title: 'Що на схемі',
  onclick: () => {
    const help = $('calc-help');
    help.hidden = !help.hidden;
    calcHelpBtn.setAttribute('aria-expanded', String(!help.hidden));
    // Легенда — одразу під блоком: якщо прокручено вниз, повертаємось до неї
    if (!help.hidden && scrollY > 0) scrollTo({ top: 0, behavior: 'smooth' });
  },
}, 'i');

function render() {
  const out = $('result');
  const load = currentLoad();
  if (!(load.mass > 0 && load.diameter > 0 && load.cd >= 0) || !(state.height > 0)) {
    $('calc-top').replaceChildren(el('p', { class: 'error' }, 'Перевір висоту і параметри вантажу — розрахунку немає.'));
    out.replaceChildren();
    return;
  }
  const s = params();
  const r = solve(s, load);
  const dist = Math.hypot(r.x, r.y);
  const driftLen = Math.hypot(r.drift.x, r.drift.y);
  const hover = !state.speed;
  const wTop = windAt(s, state.height), wLow = windAt(s, 2);

  const lines = [
    el('li', {}, `Падає ${fmt(r.time)} с, біля землі ${fmt(r.impactSpeed, 0)} м/с`
      + (r.impactSpeed > 0.9 * r.vt ? ' — майже гранична швидкість, далі не розганяється.' : '.')),
  ];
  if (!hover) {
    const delayPart = state.delay ? ` (з них ${fmt(state.speed * state.delay)} м — затримка скиду)` : '';
    lines.push(el('li', { class: 'carry' }, `Рух дрона ${fmt(state.speed)} м/с: вантаж летить вперед за інерцією і пролітає ${fmt(r.carry.x)} м${delayPart}.`));
  }
  if (wTop.speed > 0.05) {
    lines.push(el('li', { class: 'wind' }, `Вітер на ${fmt(state.height, 0)} м — ${fmt(wTop.speed)} м/с ${clockWord(wTop.clock)}, біля землі — ${fmt(wLow.speed)} м/с: `
      + (driftLen >= 0.05 ? `за час падіння зносить на ${fmt(driftLen)} м (${where(r.drift.x, r.drift.y)}).` : 'майже не встигає знести — менше 5 см.')));
    lines.push(el('li', { class: 'wind', id: 'sc-line' }, 'Рахую розкид від поривів…'));
  }
  lines.push(el('li', { class: 'aim' }, dist < 0.1
    ? 'Скидай прямо над ціллю — поправка менша за 10 см.'
    : hover
      ? `Щоб влучити: зависни так, щоб ціль була ${where(r.x, r.y)} від точки під дроном — дрон стоїть проти вітру від цілі.`
      : `Щоб влучити: у момент скиду ціль має бути ${where(r.x, r.y)} від точки під дроном.`));
  lines.push(el('li', {}, `Бойова частина: ${describe(load)} від краю цілі.`));
  lines.push(el('li', { class: 'small muted' }, 'Точка під дроном = центр кадру, лише коли камера дивиться строго вниз (−90°). Як саме рахуємо — «Налаштування» → «Як рахуємо».'));

  // Угорі, липким, як кадр у тренажері: схема й головні числа; під ним — умови кнопками, ще нижче — розбір
  $('calc-top').replaceChildren(
    calcHelpBtn,
    plan(r, wTop),
    el('div', { class: 'stats mini' },
      stat('Куди впаде', fmt(dist), 'м', dist >= 0.05 ? where(r.x, r.y) : 'під дроном', 'hit'),
      stat('Падає', fmt(r.time), 'с', `з ${fmt(state.height, 0)} м`),
      stat('Знесе вітер', fmt(driftLen), 'м', wTop.speed > 0.05 ? `${fmt(wTop.speed)} м/с` : 'без вітру'),
      el('div', { class: 'stat', id: 'sc-tile' }, el('div', { class: 'stat-label' }, 'Розкид'), el('div', { class: 'stat-value' }, '…'))));
  lines.splice(1, 0, el('li', {}, `Удар — ${fmt(r.impactAngle, 0)}° від вертикалі; гранична швидкість цього вантажу ${fmt(r.vt, 0)} м/с.`));
  out.replaceChildren(
    el('ul', { class: 'explain' }, lines),
    el('fieldset', { class: 'box' }, el('legend', {}, 'За висотою'), heightTable(load)));
  scheduleScatter();
}

/* Схема згори: центр — точка під дроном, ніс угору; масштаб підбирається під точку падіння */
let planMap = null;
function plan(r, w) {
  const pts = r.path.filter((_, i) => i % 15 === 0).concat([r.path[r.path.length - 1]]);
  const reach = Math.max(0.5, ...pts.map((p) => Math.hypot(p[0], p[1])));
  const step = niceStep(reach / 3);
  const rings = Math.max(1, Math.ceil(reach / step));
  const sc = 132 / (rings * step);
  const P = (x, y) => [y * sc, -x * sc];
  planMap = P;

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
  // Розкид від поривів — дорисовується, коли пораховано
  svg.append(el('svg:g', { id: 'plan-sc' }));
  const [hx, hy] = P(r.x, r.y);
  svg.append(el('svg:circle', { class: 'hit-ring', cx: hx, cy: hy, r: 9 }),
    el('svg:circle', { class: 'hit', cx: hx, cy: hy, r: 4 }),
    el('svg:text', { class: 'hit-label', x: hx + (hx > 90 ? -14 : 14), y: hy + (hy < -140 ? 20 : -10), 'text-anchor': hx > 90 ? 'end' : 'start' }, `${fmt(Math.hypot(r.x, r.y))} м`));
  if (w.speed > 0.05) {
    // Куди рухається повітря на висоті скиду, у кутку схеми
    // Точний напрям, а не округлений до години: з прогнозу вітер рідко дме рівно з «години»
    const dx = w.y / w.speed, dy = -w.x / w.speed;
    const cx = -128, cy = 132;
    svg.append(el('svg:line', { class: 'wind', x1: cx - dx * 16, y1: cy - dy * 16, x2: cx + dx * 10, y2: cy + dy * 10 }),
      el('svg:path', { class: 'wind-head', d: arrowHead(cx + dx * 18, cy + dy * 18, dx, dy, 8) }),
      el('svg:text', { class: 'wind-label', x: cx + 26, y: cy + 4 }, `вітер ${fmt(w.speed)} м/с`));
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
    const calm = simulate({ ...s, wind: 0, levels: null }, load);
    return el('tr', { class: h === state.height ? 'cur' : '' },
      el('td', {}, `${fmt(h, 0)} м`),
      el('td', {}, fmt(r.time)),
      moving ? el('td', {}, fmt(calm.x)) : null,
      el('td', {}, fmt(Math.hypot(r.x - calm.x, r.y - calm.y))),
      // При зависанні точка падіння = знесення вітром, окрема колонка зайва
      moving ? el('td', {}, fmt(Math.hypot(r.x, r.y))) : null,
      el('td', { 'data-h': h }, '…'));
  });
  return el('table', { class: 'table', id: 'h-table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Висота'), el('th', {}, 'Час, с'), moving ? el('th', {}, 'Вперед, м') : null,
      el('th', {}, 'Вітер, м'), moving ? el('th', {}, 'Точка, м') : null, el('th', {}, 'Розкид 90 %, м'))),
    el('tbody', {}, rows));
}

/* --- розкид від поривів: сотня скидів з різними поривами — важко, тож після паузи у введенні --- */
let scT = 0;
const scCache = new Map();
function scheduleScatter() {
  clearTimeout(scT);
  scT = setTimeout(paintScatter, 160);
}
function scatterOf(s, load, n) {
  const key = JSON.stringify([s, load.mass, load.diameter, load.cd, n]);
  if (!scCache.has(key)) {
    if (scCache.size > 60) scCache.clear();
    scCache.set(key, scatter(s, load, { n }));
  }
  return scCache.get(key);
}
function paintScatter() {
  const tile = $('sc-tile');
  if (!tile) return;
  const load = currentLoad();
  const s = params();
  const sc = scatterOf(s, load, 150);
  const g = sc.g;
  const line = $('sc-line');
  if (!(sc.r90 > 0)) {
    tile.replaceChildren(el('div', { class: 'stat-label' }, 'Розкид'), el('div', { class: 'stat-value' }, '0', el('small', {}, 'м')),
      el('div', { class: 'stat-sub' }, 'без поривів'));
    line?.remove();
  } else {
    tile.replaceChildren(el('div', { class: 'stat-label' }, 'Розкид'),
      el('div', { class: 'stat-value' }, fmt(sc.r50), el('span', { class: 'stat-sep' }, '/'), fmt(sc.r90), el('small', {}, 'м')),
      el('div', { class: 'stat-sub' }, '50 % / 90 % скидів'));
    if (line) {
      line.textContent = `Пориви: вітер на висоті скиду гуляє ±${fmt(g.su)} м/с (до ${fmt(g.peak)} м/с), один порив тримається ≈ ${fmt(g.T, 0)} с. `
        + `Тому навіть ідеальний скид ляже не в точку, а в коло ${fmt(sc.r50)} м для половини скидів і ${fmt(sc.r90)} м для 9 з 10. `
        + 'Скидай, коли вітер на дроні близький до середнього, — не в порив і не в затишшя.';
    }
    const P = planMap;
    const box = $('plan-sc');
    if (P && box) {
      const ellipse = (k) => {
        const { a, b, ang } = sc.ell;
        const d = [];
        for (let i = 0; i <= 48; i++) {
          const t = (i / 48) * 2 * Math.PI;
          const lx = a * k * Math.cos(t), ly = b * k * Math.sin(t);
          const [px, py] = P(sc.mx + lx * Math.cos(ang) - ly * Math.sin(ang), sc.my + lx * Math.sin(ang) + ly * Math.cos(ang));
          d.push(`${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`);
        }
        return d.join(' ');
      };
      // Еліпси на 50 % і 90 %: для двовимірного нормального розподілу — 1,18σ і 2,15σ
      box.replaceChildren(...sc.pts.map(([x, y]) => { const [px, py] = P(x, y); return el('svg:circle', { class: 'sc-pt', cx: px.toFixed(1), cy: py.toFixed(1), r: 1.6 }); }),
        el('svg:path', { class: 'sc-90', d: ellipse(2.146) }), el('svg:path', { class: 'sc-50', d: ellipse(1.177) }));
    }
  }
  // Колонка розкиду в таблиці — по 60 скидів на висоту
  for (const td of document.querySelectorAll('#h-table td[data-h]')) {
    const r = scatterOf(params(+td.dataset.h), load, 60);
    td.textContent = r.r90 > 0 ? fmt(r.r90) : '—';
  }
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
// Вітер на 10 м для сили w, заданої там, де виміряно, — за тим самим профілем, що й розрахунок
const at10 = (w) => {
  const a = meanWind(windSpec({ ...state, src: 'hand', wind: w }, state.height, null))(10);
  return Math.hypot(a.x, a.y);
};
const calcWind = windPicker({ get: () => state, set: (v) => { Object.assign(state, v); changed(); }, max: 15, ground: at10 });

function paintStatic() {
  calcWind.paint();
  for (const [id, key] of SEGS) for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === state[key]);
  const on = fcOn();
  $('w-hand').hidden = state.src !== 'hand';
  $('w-fc').hidden = state.src !== 'fc';
  $('w-ref-note').hidden = state.ref !== '2';
  $('w-terr').hidden = state.src === 'fc';
  $('w-meas-box').hidden = !(state.meas > 0);
  rose?.paint();
  if (state.src === 'fc') paintFc(fc ? '' : 'Прогнозу ще немає: встав координати й натисни «Прогноз». Поки рахую з ручного вітру.');
  const s = params();
  const w = windAt(s, state.height), g = gustStats(s);
  $('w-sum').textContent = w.speed > 0.05
    ? `На висоті скиду ${fmt(state.height, 0)} м: ${fmt(w.speed)} м/с ${clockWord(w.clock)}${g.su > 0.01 ? `, пориви до ${fmt(g.peak)} м/с` : ''}.`
      + (on && state.meas > 0 && s.scale ? ` Прогноз підігнано під замір: ×${fmt(s.scale, 2)}.` : '')
    : 'Штиль.';
  $('speed-hint').textContent = state.speed ? '' : '· зависання';
  for (const k of ['tempC', 'elevation']) $(`f-${k}`).disabled = on;
  $('air-sum').textContent = on
    ? `Повітря з прогнозу: ${fmt(fcNow().tempC, 0)} °C, ${fmt(fcNow().pressure, 0)} гПа — поля вище не діють.`
    : 'Холодне й низинне повітря щільніше — гальмує вантаж сильніше.';
  // На кнопках умов — коротко, що зараз стоїть
  $('ct-drop').textContent = `${fmt(state.height, 0)} м · ${state.speed ? `${fmt(state.speed)} м/с` : 'висить'}`;
  $('ct-wind').textContent = w.speed > 0.05 ? `${fmt(w.speed)} м/с${on ? ' · прогноз' : ''}` : 'штиль';
  $('ct-load').textContent = `${currentLoad().name}${state.delay ? ` · +${fmt(state.delay, 2)} с` : ''}`;
  $('ct-air').textContent = on ? `${fmt(fcNow().tempC, 0)} °C · прогноз` : `${fmt(state.tempC, 0)} °C · ${fmt(state.elevation, 0)} м`;
  for (const b of document.querySelectorAll('.calc-tool')) b.classList.toggle('hot', b.dataset.key === 'wind' && w.speed > 0.05);
}

/* --- умови кнопками: тап відкриває панель під ними, одна за раз --- */
const OPEN_KEY = 'pustelha:calc-open';
function openPanel(key, scroll = false) {
  for (const b of document.querySelectorAll('.calc-tool')) {
    const on = b.dataset.key === key;
    b.setAttribute('aria-expanded', String(on));
    $(b.dataset.panel).hidden = !on;
  }
  write(OPEN_KEY, key || '');
  // З тренажера — одразу до потрібної панелі, під липкою схемою
  if (key && scroll) $(`cp-${key}`).scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function bindTools() {
  for (const b of document.querySelectorAll('.calc-tool')) {
    b.addEventListener('click', () => openPanel(b.getAttribute('aria-expanded') === 'true' ? '' : b.dataset.key));
  }
  openPanel(read(OPEN_KEY, ''));
}

/** Поля — з умов: тренажер міг змінити висоту чи вітер, поки «Розрахунок» був схований. */
function syncForm() {
  for (const field of document.querySelectorAll('.field[data-key]')) {
    const k = field.dataset.key;
    $(`r-${k}`).value = $(`f-${k}`).value = state[k];
  }
  for (const k of ['heading', 'meas']) $(`f-${k}`).value = fieldVal(k);
  for (const k of ['tempC', 'elevation']) $(`f-${k}`).value = state[k];
  $('fc-pos').value = state.pos;
  fc = loadFc();
  paintLoads();
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

/* --- розділи в нижній панелі: розрахунок, тренажер, налаштування --- */
const TAB_KEY = 'pustelha:tab';
let sim = null;
let tabNow = null;
// Перейшов в інший розділ — його значок у нижній панелі пару секунд грає свою анімацію; при старті — ні
let tabPlay = 0;
function playTab(tab) {
  const b = document.querySelector(`.tabs button[data-tab="${tab}"]`);
  for (const o of document.querySelectorAll('.tabs button')) o.classList.remove('play');
  void b.offsetWidth;
  b.classList.add('play');
  clearTimeout(tabPlay);
  tabPlay = setTimeout(() => b.classList.remove('play'), 2600);
}
function showTab(tab, { play = true } = {}) {
  if (play && tab !== tabNow) playTab(tab);
  tabNow = tab;
  for (const b of document.querySelectorAll('.tabs button')) {
    b.classList.toggle('on', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  $('pane-sim').hidden = tab !== 'sim';
  $('pane-calc').hidden = tab !== 'calc';
  $('pane-set').hidden = tab !== 'set';
  // Налаштування — не стартовий розділ: після перезапуску відкриваємо той, де тренувався
  if (tab !== 'set') write(TAB_KEY, tab);
  if (tab === 'set') renderSettings($('pane-set'));
  // Тренажер міг змінити висоту чи вітер — поля й розрахунок наздоганяють
  if (tab === 'calc') { syncForm(); changed(); }
  if (tab === 'sim') {
    sim ??= initSim({
      loads: allLoads,
      loadById: (id) => allLoads().find((l) => l.id === id) || PRESETS[1],
      // Умови в тренажері лише показані: тап по них — сюди, до потрібної панелі
      openCalc: (key) => { showTab('calc'); openPanel(key, true); },
    });
    sim.show();
  }
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));

$('calc-wind').append(calcWind.el);
bindPairs();
bindWind();
bindLoads();
bindAir();
bindTools();
paintLoads();
paintStatic();
render();
// Перший запуск — «Розрахунок»: спершу умови, потім тренування в них
showTab(read(TAB_KEY, 'calc') === 'sim' ? 'sim' : 'calc', { play: false });
registerSW();
// Мобільний Chrome то показує, то ховає адресний рядок: видима частина екрана нижча за сторінку, і нижня панель
// опиняється під краєм — піднімаємо її на цю різницю. Великий відступ (клавіатура) ігноруємо
if (window.visualViewport) {
  const placeTabs = () => {
    const vv = window.visualViewport;
    const gap = Math.round(document.documentElement.clientHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--vv-gap', `${gap > 0 && gap < 120 ? gap : 0}px`);
  };
  visualViewport.addEventListener('resize', placeTabs);
  visualViewport.addEventListener('scroll', placeTabs);
  placeTabs();
}
