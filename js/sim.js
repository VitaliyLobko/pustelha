// Тренажер скиду: вид з камери вниз, приціл — точка під дроном, тягнеться пальцем; цілі поки квадратами.
import { simulate, gustStats, gustSeries, gustStep, gustStart, CALM_GUST, gaussian, meanWind, scatter } from './ballistics.js';
import { loadFc } from './forecast.js';
import { $, el, fmt, read, write, vibrate, where, wheelStrip } from './ui.js';
import { RENEW_MODES, RENEW_NOTE, renewPref, setRenew } from './settings.js';
import { WARHEADS, warhead, radii, effect, whyNot, describe } from './warhead.js';
import { cond, saveCond, fcUsed, condParams } from './cond.js';

const KEY = 'pustelha:sim';
// Кут огляду камери по ширині кадру — типовий для дронів; кратність звужує його
const HFOV = 80 * Math.PI / 180;
// Цілі схемою — знаками APP-6 / MIL-STD-2525 для противника: червоний ромб, усередині — рід військ.
// len × wid — справжні габарити згори (м): довжина — по ходу руху; по них малюємо силует і рахуємо влучання.
// Людина — плечі 0,5 × 0,3 м; БМП-2 — 6,7 × 3,2; Т-72 — корпус 6,9 × 3,6; бліндаж на відділення — 5 × 3
const KINDS = [
  { id: 'inf', name: 'Піхота', what: 'жива сила', len: 0.3, wid: 0.5, count: 5, icon: 'inf' },
  { id: 'mech', name: 'БМП', what: 'механізована піхота', len: 6.7, wid: 3.2, count: 3, icon: 'mech' },
  { id: 'tank', name: 'Танк', what: 'бронетехніка', len: 6.9, wid: 3.6, count: 2, icon: 'armor' },
  { id: 'dug', name: 'Бліндаж', what: 'укриття', len: 5, wid: 3, count: 2, icon: 'fort' },
];
const m1 = (v) => fmt(v, v % 1 ? 1 : 0);
const dims = (k) => (k.len < 1 ? `${m1(k.wid)} × ${m1(k.len)} м` : `${m1(k.len)} × ${m1(k.wid)} м`);
/** Знак APP-6 для плиток і кнопки «Ціль» — той самий, що на кадрі. */
const SYM = (icon) => `<svg class="tgt-sym" viewBox="0 0 34 30" aria-hidden="true"><path class="s-hos" d="M17 3 29 15 17 27 5 15Z"/>${
  icon === 'inf' || icon === 'mech' ? '<path class="s-in" d="M11 9 23 21M23 9 11 21"/>' : ''}${
  icon === 'armor' || icon === 'mech' ? '<ellipse class="s-in" cx="17" cy="15" rx="4.5" ry="2.7"/>' : ''}${
  icon === 'fort' ? '<text class="s-txt" x="17" y="19.5">Б</text>' : ''}</svg>`;
/** Які БЧ беруть ціль — з тієї ж таблиці, що й рахунок влучань. */
function takes(icon) {
  const by = (e) => WARHEADS.filter((w) => effect({ type: w.id }, icon) === e).map((w) => w.name.toLowerCase());
  const r = by('radius'), d = by('direct');
  if (r.length === WARHEADS.length) return 'бере будь-яка БЧ у радіусі ураження';
  return [r.length && `${r.join(' чи ')} — у радіусі`, d.length && `${d.join(' чи ')} — лише прямим влучанням`].filter(Boolean).join(', ');
}
const SYM_MIN = 26;
// Вантаж у стрічці — та сама авіабомба носом униз, що на кнопці
const LOAD_ICO = '<svg class="ld-sym" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.7 7.6 15.8 4.4V2.6H8.2v1.8l3.1 3.2z"/>'
  + '<path d="M12.9 6.6 14.9 10v7.3c0 2.7-1.3 5-2.9 5s-2.9-2.3-2.9-5V10l2-3.4z"/></svg>';
const MOVES = [
  { v: 0, name: 'стоїть' },
  { v: 1.4, name: 'крок 1,4 м/с', short: 'крок' },
  { v: 3.5, name: 'біг 3,5 м/с', short: 'біг' },
  { v: 8.3, name: 'авто 30 км/год', short: 'авто' },
];
const RETICLES = [
  { id: 'cross', name: 'Хрест' },
  { id: 'ring', name: 'Хрест з колом' },
  { id: 'meter', name: 'Метри на землі' },
  { id: 'dot', name: 'Точка' },
];
// Тут — лише своє, тренажерне; висота, вантаж, вітер і повітря — спільні умови з «Розрахунку» (cond.js)
const DEFAULTS = { zoom: 4, kind: 'inf', move: 0, hint: false, ret: 'cross' };
const DT = 0.004;

const state = { ...DEFAULTS, ...read(KEY, {}) };
const save = () => { write(KEY, state); saveCond(); };
const kind = () => KINDS.find((k) => k.id === state.kind) || KINDS[0];
const move = () => MOVES.find((m) => m.v === state.move) || MOVES[0];
/** Скільки метрів землі вміщає кадр по ширині. */
const spanM = () => 2 * cond.height * Math.tan(HFOV / 2) / state.zoom;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initSim({ loads, loadById, openCalc }) {
  const frame = $('sim-frame');
  const cv = $('sim-cv');
  const ctx = cv.getContext('2d');
  let side = 0, dpr = 1, ppm = 1;
  let ground = null;
  let round = null;
  const reticle = { e: 0, n: 0 };
  // Куди дивиться камера (центр кадру на землі): двома пальцями дрон летить над місцевістю
  const cam = { e: 0, n: 0 };
  let bombs = [], bursts = [];
  let hint = null, hintSc = null;
  let loop = 0, lastT = 0;
  let msgT = 0, fireT = 0;
  // Прогноз — той, що взяли в «Розрахунку»; діє, коли там вибрано вітер з прогнозу
  let fc = loadFc();
  let shownH = cond.height;

  const toS = (e, n) => [side / 2 + (e - cam.e) * ppm, side / 2 - (n - cam.n) * ppm];
  // Ті самі умови, що в «Розрахунку», лише дрон висить
  const params = () => condParams(fc, { speed: 0 });

  /* --- живий вітер: середній на висоті дрона плюс порив, що змінюється з часом, — як показує дрон --- */
  let gst = null, meanH = { x: 0, y: 0 };
  let gcur = CALM_GUST;
  const N = gaussian(Math.random);
  /** Миттєвий вітер на висоті дрона в осях дрона. */
  const windNow = () => {
    const m = Math.hypot(meanH.x, meanH.y);
    const ax = m > 1e-6 ? meanH.x / m : 1, ay = m > 1e-6 ? meanH.y / m : 0;
    return { x: meanH.x + ax * gcur.u - ay * gcur.v, y: meanH.y + ay * gcur.u + ax * gcur.v };
  };
  setInterval(() => {
    if (!gst || document.hidden || frame.closest('[hidden]')) return;
    gcur = gst.su > 0.01 ? gustStep(gst, gcur, 0.25, N) : CALM_GUST;
    paintOsd();
  }, 250);
  function paintOsd() {
    const w = windNow(), sp = Math.hypot(w.x, w.y);
    const osd = $('sim-wind-osd');
    osd.hidden = sp < 0.05 && !(gst?.su > 0.01);
    // Стрілка — куди рухається повітря зараз; підсвітка — порив чи затишшя відносно середнього
    $('sim-wind-arrow').setAttribute('transform', `rotate(${(Math.atan2(w.y, w.x) * 180 / Math.PI).toFixed(1)} 12 12)`);
    $('sim-wind-osd-v').textContent = `${fmt(sp)} м/с`;
    const k = gst?.su > 0.01 ? gcur.u / gst.su : 0;
    osd.classList.toggle('gust', k > 1);
    osd.classList.toggle('lull', k < -1);
  }

  /* --- раунд: нові цілі на випадкових місцях --- */
  function newRound() {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const rnd = mulberry32(seed);
    const span = spanM();
    const k = kind();
    const targets = [];
    for (let i = 0; i < k.count; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const e = (rnd() - 0.5) * span * 0.8, n = (rnd() - 0.5) * span * 0.8;
        // Не одна на одній і не просто під прицілом
        // Піхота — не ближче 3 м одна від одної, як у розосередженому порядку; на великій кратності кадр малий — відступи менші
        const gapM = Math.min(Math.max(3, k.len * 1.5), span * 0.25);
        const last = tries === 39;
        if (!last && Math.hypot(e, n) < gapM + span * 0.08) continue;
        if (!last && targets.some((t) => Math.hypot(t.e - e, t.n - n) < gapM)) continue;
        targets.push({ e, n, len: k.len, wid: k.wid, dir: rnd() * 2 * Math.PI, hit: false });
        break;
      }
    }
    round = { seed, span, targets, craters: [], drops: 0, hits: 0, last: null, kind: k, active: 0 };
    reticle.e = reticle.n = 0;
    cam.e = cam.n = 0;
    bombs = []; bursts = [];
    clearTimeout(fireT);
    $('sim-drop').classList.remove('fire');
    ground = null;
    paintOut();
    paintScore();
    kick();
  }

  /* --- земля: плями трави й ґрунту, кущі, польова дорога — у метрах, щоб масштабувались з кратністю --- */
  // Місцевість — клітинками по 20 м, у кожної свій генератор: політ, висота й кратність показують ту саму землю
  const CELL = 20;
  const cellRnd = (ix, iy, salt) => mulberry32((round.seed ^ Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ salt) >>> 0);
  /** Пройти видимі клітинки (з запасом на найбільшу пляму) і для кожної — її генератор і кут у метрах. */
  function eachCell(salt, fn) {
    const half = spanM() / 2 + 14;
    const [e0, e1] = [Math.floor((cam.e - half) / CELL), Math.floor((cam.e + half) / CELL)];
    const [n0, n1] = [Math.floor((cam.n - half) / CELL), Math.floor((cam.n + half) / CELL)];
    for (let ix = e0; ix <= e1; ix++) for (let iy = n0; iy <= n1; iy++) fn(cellRnd(ix, iy, salt), ix * CELL, iy * CELL);
  }
  function paintGround() {
    const g = document.createElement('canvas');
    g.width = g.height = Math.round(side * dpr);
    const c = g.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#6d7746';
    c.fillRect(0, 0, side, side);
    const visible = (x, y, r) => !(x < -r || y < -r || x > side + r || y > side + r);
    const PATCH = ['#66703f', '#7a8550', '#5d6838', '#857f55', '#727045', '#5f6a3a'];
    // Пляма на 120 м², кущ — на 60 м²: усі випадкові числа беремо до перевірки видимості, щоб не збити послідовність
    eachCell(0x51ed27, (rnd, e, n) => {
      for (let i = 0, k = Math.floor(CELL * CELL / 120 + rnd()); i < k; i++) {
        const pe = e + rnd() * CELL, pn = n + rnd() * CELL, r = (2 + rnd() * 12) * ppm;
        const a = 0.35 + rnd() * 0.35, col = PATCH[Math.floor(rnd() * PATCH.length)], q = 0.5 + rnd() * 0.5, ang = rnd() * Math.PI;
        const [x, y] = toS(pe, pn);
        if (!visible(x, y, r)) continue;
        c.globalAlpha = a;
        c.fillStyle = col;
        c.beginPath();
        c.ellipse(x, y, r, r * q, ang, 0, 2 * Math.PI);
        c.fill();
      }
    });
    // Польова дорога через усе поле
    const rr = mulberry32(round.seed ^ 0x9e3779b9);
    const [y0, yb, y1] = [(rr() - 0.5) * 120, (rr() - 0.5) * 120, (rr() - 0.5) * 120];
    c.globalAlpha = 0.8;
    c.strokeStyle = '#8f8461';
    c.lineWidth = Math.max(2, 3.5 * ppm);
    c.lineCap = 'round';
    c.beginPath();
    const [ax, ay] = toS(-700, y0), [bx, by] = toS(0, yb), [dx, dy] = toS(700, y1);
    c.moveTo(ax, ay);
    c.quadraticCurveTo(bx, by, dx, dy);
    c.stroke();
    // Кущі
    eachCell(0x2c1b3c, (rnd, e, n) => {
      for (let i = 0, k = Math.floor(CELL * CELL / 60 + rnd()); i < k; i++) {
        const pe = e + rnd() * CELL, pn = n + rnd() * CELL, r = Math.max(0.6, (0.4 + rnd() * 1.2) * ppm);
        const a = 0.55 + rnd() * 0.3, col = rnd() < 0.5 ? '#3f4a2a' : '#4b5632';
        const [x, y] = toS(pe, pn);
        if (!visible(x, y, r)) continue;
        c.globalAlpha = a;
        c.fillStyle = col;
        c.beginPath();
        c.arc(x, y, r, 0, 2 * Math.PI);
        c.fill();
      }
    });
    c.globalAlpha = 1;
    ground = g;
  }

  /* --- кадр --- */
  function resize() {
    const box = cv.getBoundingClientRect();
    if (!box.width) return;
    dpr = window.devicePixelRatio || 1;
    side = box.width;
    cv.width = cv.height = Math.round(side * dpr);
    ppm = side / spanM();
    ground = null;
    draw();
  }

  function draw() {
    if (!side || !round) return;
    if (!ground) paintGround();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ground, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Вирви від попередніх скидів
    for (const c of round.craters) {
      const [x, y] = toS(c.e, c.n);
      ctx.fillStyle = 'rgb(40 34 26 / .75)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(3, 0.6 * ppm), 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = c.hit ? '#ff6b5a' : 'rgb(255 255 255 / .85)';
      ctx.lineWidth = 1.5;
      cross(x, y, 4);
    }
    const L = round.last;
    if (L?.eff === 'radius') {
      // Зони останнього скиду: червона — ураження, помаранчева — поранення
      const [x, y] = toS(L.e, L.n);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      for (const [r, c] of [[L.R.wound, 'rgb(255 179 71 / .85)'], [L.R.kill, 'rgb(255 90 74 / .95)']]) {
        ctx.strokeStyle = c;
        ctx.beginPath(); ctx.arc(x, y, r * ppm, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    round.targets.forEach((t, i) => drawTarget(t, i === round.active));
    if (state.hint && hint) {
      const [x0, y0] = toS(reticle.e, reticle.n);
      const [x, y] = toS(reticle.e + hint.y, reticle.n + hint.x);
      ctx.strokeStyle = '#79aaf0';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      const ld = loadById(cond.load);
      const rk = effect(ld, round.kind.icon) === 'radius' ? radii(ld).kill * ppm : 0;
      ctx.beginPath(); ctx.arc(x, y, Math.max(7, rk), 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      if (hintSc?.r50 > 0.05) {
        // Еліпс, у який ляже половина скидів через пориви (1,18σ)
        const { a, b, ang } = hintSc.ell;
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const t = (i / 40) * 2 * Math.PI, lx = a * 1.177 * Math.cos(t), ly = b * 1.177 * Math.sin(t);
          const bx = hintSc.mx + lx * Math.cos(ang) - ly * Math.sin(ang), by = hintSc.my + lx * Math.sin(ang) + ly * Math.cos(ang);
          const [px, py] = toS(reticle.e + by, reticle.n + bx);
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.fillStyle = 'rgb(121 170 240 / .18)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    const now = performance.now();
    for (const b of bombs) {
      const tau = (now - b.t0) / 1000;
      // Затримка скиду: механізм ще не відпустив — вантаж на дроні
      if (tau < 0) continue;
      const p = b.path[Math.min(b.path.length - 1, Math.floor(tau / DT))];
      const [x, y] = toS(b.e0 + p[1], b.n0 + p[0]);
      // Чим нижче, тим менший — падає від камери
      const r = 2.5 + 5 * (p[2] / cond.height);
      ctx.fillStyle = '#1b1b1b';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    for (const b of bursts) {
      const k = Math.min(1, (now - b.t0) / 700);
      const [x, y] = toS(b.e, b.n);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.arc(x, y, Math.max(6, b.r * ppm) * (0.3 + 0.7 * k), 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawReticle(...toS(reticle.e, reticle.n));
  }

  /** Силует цілі згори в справжньому масштабі: людина, корпус з баштою й гарматою, накат бліндажа. */
  function drawBody(t, x, y) {
    const icon = round.kind.icon;
    ctx.save();
    ctx.translate(x, y);
    // На екрані північ угорі, тож кут руху дзеркалимо
    ctx.rotate(-t.dir);
    const L = t.len * ppm, W = t.wid * ppm;
    if (icon === 'inf') {
      // Людина — темна пляма; менше 1,2 px не малюємо, інакше зникне зовсім
      ctx.fillStyle = '#23261a';
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(0.6, L / 2), Math.max(0.6, W / 2), 0, 0, 2 * Math.PI);
      ctx.fill();
    } else if (icon === 'fort') {
      ctx.fillStyle = '#5b4b33';
      ctx.fillRect(-L / 2, -W / 2, L, W);
      // Колоди накату поперек
      ctx.strokeStyle = 'rgb(40 32 20 / .7)';
      ctx.lineWidth = Math.max(0.5, 0.15 * ppm);
      ctx.beginPath();
      for (let i = 1; i < 6; i++) { const lx = -L / 2 + (L * i) / 6; ctx.moveTo(lx, -W / 2); ctx.lineTo(lx, W / 2); }
      ctx.stroke();
    } else {
      // Корпус, башта ближче до центру, гармата вперед по ходу
      const tank = icon === 'armor';
      ctx.fillStyle = '#3d4230';
      ctx.fillRect(-L / 2, -W / 2, L, W);
      ctx.strokeStyle = '#1d2016';
      ctx.lineWidth = Math.max(0.5, 0.1 * ppm);
      ctx.strokeRect(-L / 2, -W / 2, L, W);
      const tr = (tank ? 1.15 : 0.7) * ppm, tx = tank ? -0.3 * ppm : 0.2 * ppm;
      ctx.fillStyle = '#2f3325';
      ctx.beginPath();
      ctx.arc(tx, 0, tr, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx + tr, 0);
      ctx.lineTo(tx + (tank ? 4.6 : 2.6) * ppm, 0);
      ctx.lineWidth = Math.max(0.6, (tank ? 0.16 : 0.1) * ppm);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Ціль: силует у справжньому масштабі (по ньому влучання) і знак противника APP-6 міткою над ним — щоб ціль
   * було видно на будь-якій висоті, а сам знак її не закривав. Коли силует великий, мітка вже не потрібна.
   */
  function drawTarget(t, active) {
    const [x, y] = toS(t.e, t.n);
    const s = Math.max(t.len, t.wid) * ppm;
    ctx.globalAlpha = t.hit ? 0.45 : 1;
    drawBody(t, x, y);
    if (active && !t.hit) {
      // Вибрана ціль — жовті кутики навколо силуету
      const r = Math.max(7, s / 2 + 4), k = Math.min(8, r * 0.5);
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * r, y + sy * (r - k)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - k), y + sy * r);
      }
      ctx.stroke();
    }
    if (t.hit) { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; cross(x, y, Math.max(6, s * 0.6)); }
    if (s < SYM_MIN * 1.5) drawMark(x, y - Math.max(7, s / 2 + 4), t.hit);
    ctx.globalAlpha = 1;
  }

  /** Знак APP-6 міткою: ромб на ніжці, вістря ніжки — над ціллю. */
  function drawMark(x, foot, hit) {
    const d = SYM_MIN / 2, y = foot - 10 - d;
    ctx.globalAlpha = hit ? 0.35 : 0.85;
    ctx.strokeStyle = 'rgb(255 255 255 / .85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, foot); ctx.lineTo(x, y + d);
    ctx.stroke();
    // Рамка противника — ромб, заливка світло-червона (APP-6: hostile)
    ctx.beginPath();
    ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
    ctx.fillStyle = 'rgb(255 128 128 / .88)';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Значок роду військ у межах ромба: вписаний прямокутник ±d/2
    const w = d / 2, h = d / 2;
    ctx.beginPath();
    const icon = round.kind.icon;
    if (icon === 'inf' || icon === 'mech') {
      // Піхота — діагоналі хрест-навхрест
      ctx.moveTo(x - w, y - h); ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y - h); ctx.lineTo(x - w, y + h);
    }
    if (icon === 'armor' || icon === 'mech') {
      // Броня — овал гусениці; разом із хрестом — механізована піхота
      ctx.moveTo(x + w * 0.75, y);
      ctx.ellipse(x, y, w * 0.75, h * 0.45, 0, 0, 2 * Math.PI);
    }
    ctx.stroke();
    if (icon === 'fort') {
      // Укріплення: значок у стандарті ще звіряємо — поки літера
      ctx.fillStyle = '#111';
      ctx.font = `700 ${Math.round(d * 0.7)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Б', x, y + 1);
    }
  }

  function cross(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  // Сітки — білі з темною обвідкою, щоб читались і на світлому ґрунті
  function drawReticle(x, y) {
    const stroke = (fn) => {
      ctx.strokeStyle = 'rgb(0 0 0 / .55)'; ctx.lineWidth = 3.5; fn();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; fn();
    };
    const line = (x1, y1, x2, y2) => { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); };
    const arms = (a, b) => { line(x - b, y, x - a, y); line(x + a, y, x + b, y); line(x, y - b, x, y - a); line(x, y + a, x, y + b); };
    ctx.beginPath();
    if (state.ret === 'cross') stroke(() => { ctx.beginPath(); arms(6, 30); ctx.stroke(); });
    if (state.ret === 'ring') stroke(() => { ctx.beginPath(); arms(16, 34); ctx.moveTo(x + 12, y); ctx.arc(x, y, 12, 0, 2 * Math.PI); ctx.stroke(); });
    if (state.ret === 'meter') {
      // Кільця 1, 2, 5 м на землі під дроном — видно, скільки це в кадрі на цій висоті й кратності
      stroke(() => { ctx.beginPath(); arms(4, 12); ctx.stroke(); });
      let lastR = -Infinity;
      for (const m of [1, 2, 5, 10]) {
        const r = m * ppm;
        if (r < 6 || r > side * 0.48) continue;
        stroke(() => { ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); });
        // Підпис — лише якщо кільце достатньо далеко від попереднього підписаного, інакше налазять
        if (r - lastR < 16) continue;
        lastR = r;
        ctx.font = '600 10px ui-monospace, Consolas, monospace';
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgb(0 0 0 / .6)'; ctx.lineWidth = 3;
        ctx.strokeText(`${m} м`, x + r * 0.71 + 2, y - r * 0.71 - 2);
        ctx.fillText(`${m} м`, x + r * 0.71 + 2, y - r * 0.71 - 2);
      }
    }
    if (state.ret === 'dot') {
      ctx.fillStyle = 'rgb(0 0 0 / .55)'; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
    }
  }

  /* --- рух цілей, падіння, вибухи — кадр за кадром, поки є що рухати --- */
  function tick(now) {
    loop = 0;
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000);
    lastT = now;
    const v = state.move;
    if (v) {
      const lim = round.span * 0.46;
      for (const t of round.targets) {
        if (t.hit) continue;
        t.e += Math.cos(t.dir) * v * dt;
        t.n += Math.sin(t.dir) * v * dt;
        // Від краю кадру — відбивається
        if (Math.abs(t.e) > lim) { t.e = Math.sign(t.e) * lim; t.dir = Math.PI - t.dir; }
        if (Math.abs(t.n) > lim) { t.n = Math.sign(t.n) * lim; t.dir = -t.dir; }
      }
    }
    for (const b of bombs.filter((x) => (now - x.t0) / 1000 >= x.T)) land(b, now);
    bombs = bombs.filter((b) => !b.done);
    bursts = bursts.filter((b) => now - b.t0 < 700);
    draw();
    if (v || bombs.length || bursts.length) kick();
    else lastT = 0;
  }
  function kick() {
    if (!loop && !frame.closest('[hidden]')) loop = requestAnimationFrame(tick);
  }

  /* --- скид --- */
  function drop() {
    const load = loadById(cond.load);
    const s = params();
    // Порив, що дме в момент скиду, триває й далі — вантаж падає в справжньому, не середньому вітрі
    const gust = gst?.su > 0.01 ? gustSeries(gst, Math.random, 60, gcur) : null;
    const r = simulate(s, load, { dt: DT, track: true, gust });
    const w = windNow();
    // Вантаж іде вниз після затримки механізму — за неї рухома ціль теж встигає зміститись
    const delay = cond.delay || 0;
    bombs.push({
      e0: reticle.e, n0: reticle.n, path: r.path, T: r.time, r, load, t0: performance.now() + delay * 1000, delay,
      wNow: Math.hypot(w.x, w.y), wMean: Math.hypot(meanH.x, meanH.y), k: gst?.su > 0.01 ? gcur.u / gst.su : 0,
    });
    round.drops++;
    vibrate(15);
    paintScore();
    flyBomb(delay + r.time);
    kick();
  }

  /** «Скид» — як «Перевірити» в Shooter's Log: авіабомба летить від лівого краю кнопки за правий рівно за час падіння. */
  function flyBomb(T) {
    const btn = $('sim-drop');
    // Новий скид, поки летить попередній, — бомба знову стартує від лівого краю
    btn.classList.remove('fire');
    void btn.offsetWidth;
    const b = btn.getBoundingClientRect(), ico = btn.querySelector('.drop-ico').getBoundingClientRect();
    btn.style.setProperty('--from', `${b.left - ico.right}px`);
    btn.style.setProperty('--fly', `${b.right - ico.left}px`);
    btn.style.setProperty('--fall', `${T}s`);
    btn.classList.add('fire');
    clearTimeout(fireT);
    fireT = setTimeout(() => btn.classList.remove('fire'), T * 1000);
  }

  function land(b, now) {
    b.done = true;
    const e = b.e0 + b.r.y, n = b.n0 + b.r.x;
    // Відстань від точки падіння до краю цілі — у її власних осях: уздовж руху й поперек
    const gap = (t) => {
      const de = e - t.e, dn = n - t.n, c = Math.cos(t.dir), s = Math.sin(t.dir);
      return Math.hypot(Math.max(Math.abs(de * c + dn * s) - t.len / 2, 0), Math.max(Math.abs(-de * s + dn * c) - t.wid / 2, 0));
    };
    const icon = round.kind.icon;
    const eff = effect(b.load, icon);
    const R = radii(b.load);
    const alive = round.targets.filter((t) => !t.hit);
    // У зоні ураження — усі цілі одразу; броню й перекриття — лише пряме влучання; none — ця БЧ ціль не бере
    const reach = eff === 'radius' ? R.kill : 0;
    const struck = eff === 'none' ? [] : alive.filter((t) => gap(t) <= reach);
    const wounded = eff === 'radius' ? alive.filter((t) => !struck.includes(t) && gap(t) <= R.wound).length : 0;
    const direct = eff === 'none' && alive.some((t) => gap(t) === 0);
    // Промах рахуємо від вибраної цілі
    const aim = round.targets[round.active];
    const ref = struck[0] || (aim && !aim.hit ? aim : null);
    const best = ref && { t: ref, d: gap(ref), de: e - ref.e, dn: n - ref.n };
    for (const t of struck) t.hit = true;
    round.hits += struck.length;
    if (struck.length) {
      vibrate([30, 40, 30]);
      if (aim?.hit) nextTarget();
    }
    round.craters.push({ e, n, hit: struck.length > 0 });
    bursts.push({ e, n, t0: now, r: Math.max(1, R.kill) });
    round.last = {
      killed: struck.length, wounded, direct, eff, R, why: eff === 'none' ? whyNot(b.load, icon) : '',
      e, n, best, T: b.T, delay: b.delay, drift: Math.hypot(b.r.x, b.r.y), dx: b.r.x, dy: b.r.y, no: round.drops,
      wNow: b.wNow, wMean: b.wMean, k: b.k,
    };
    paintScore();
    paintOut();
  }

  /* --- показання під кадром --- */
  function paintOut() {
    const out = $('sim-out');
    const L = round?.last;
    const rows = [];
    const row = (k, v, cls = '') => el('div', { class: cls }, el('span', { class: 'k' }, k), v);
    if (!L) {
      rows.push(row('Як', 'тягни приціл пальцем на ціль і тисни «Скид»'));
    } else if (!L.best) {
      rows.push(row(`Скид ${L.no}`, el('span', { class: 'v' }, 'цілей не лишилось')));
    } else if (L.killed) {
      const name = round.kind.name.toLowerCase();
      rows.push(row(`Скид ${L.no}`, el('span', {},
        el('span', { class: 'v good' }, L.killed > 1 ? `уражено ${L.killed} — ${name}` : `уражено — ${name}`),
        L.wounded ? ` · ще ${L.wounded} у зоні поранення` : '')));
    } else if (L.direct) {
      rows.push(row(`Скид ${L.no}`, el('span', {}, el('span', { class: 'v bad' }, 'пряме влучання без ураження'), ` — ${L.why}`)));
    } else {
      const zone = L.eff === 'radius'
        ? (L.best.d <= L.R.wound ? ` — у зоні поранення, ураження лише до ${fmt(L.R.kill)} м` : ` — поза зоною ураження ${fmt(L.R.kill)} м`)
        : L.eff === 'direct' ? ' — по цій цілі потрібне пряме влучання' : ' — і пряме не допомогло б, див. «БЧ»';
      rows.push(row(`Скид ${L.no}`, el('span', {}, el('span', { class: 'v bad' }, `промах ${fmt(L.best.d)} м`),
        ` до краю · ${where(L.best.dn, L.best.de, ['вище', 'нижче'])} від центру цілі${zone}`)));
    }
    if (L) {
      rows.push(row('Падав', `${fmt(L.T)} с${L.delay ? ` + затримка ${fmt(L.delay, 2)} с` : ''} · вітер зніс ${fmt(L.drift)} м${L.drift >= 0.05 ? ` (${where(L.dx, L.dy, ['вгору', 'вниз'])})` : ''}`));
      if (L.wMean > 0.05 || Math.abs(L.k) > 0) {
        rows.push(row('Вітер', `у момент скиду ${fmt(L.wNow)} м/с, середній ${fmt(L.wMean)}${L.k > 1 ? ' — скинув у порив' : L.k < -1 ? ' — скинув у затишшя' : ''}`));
      }
      if (state.move) rows.push(row('Ціль', `за цей час пройшла ${fmt(state.move * (L.T + (L.delay || 0)))} м — бери упередження по ходу руху`));
    }
    if (round) {
      const ld = loadById(cond.load), icon = round.kind.icon, eff = effect(ld, icon);
      const wh = warhead(ld).name.toLowerCase();
      rows.push(row('БЧ', eff === 'radius' ? describe(ld)
        : eff === 'direct' ? `${wh} · по цілі «${round.kind.name}» — лише пряме влучання` : `${wh} · ${whyNot(ld, icon)}`));
    }
    if (state.hint && hint) {
      const d = Math.hypot(hint.x, hint.y);
      rows.push(row('Підказка', `${d >= 0.05 ? `впаде ${where(hint.x, hint.y, ['вище', 'нижче'])} від прицілу` : 'впаде під приціл'} — синє кільце${
        effect(loadById(cond.load), round.kind.icon) === 'radius' ? ' розміром із зону ураження' : ''}${
        hintSc?.r50 > 0.05 ? `; через пориви половина скидів — у блакитній плямі ≈ ${fmt(hintSc.r50)} м` : ''}`, 'fx'));
    }
    out.replaceChildren(...rows);
  }

  function paintScore() {
    $('sim-score-v').textContent = round ? `${round.hits}/${round.drops}` : '0/0';
    const n = round?.targets.length ?? 0;
    $('sim-fig-v').textContent = round && round.active >= 0 ? `${round.active + 1}/${n}` : `✓ ${n}`;
  }

  /** Наступна неуражена ціль по колу; усі уражені — вибору немає. */
  function nextTarget() {
    const list = round.targets;
    for (let k = 1; k <= list.length; k++) {
      const i = (Math.max(round.active, 0) + k) % list.length;
      if (!list[i].hit) { round.active = i; return; }
    }
    round.active = -1;
  }
  $('sim-fig').addEventListener('click', () => {
    vibrate(8);
    nextTarget();
    paintScore();
    if (!loop) draw();
  });

  /* --- жести на кадрі: один палець будь-де — тягне приціл; два пальці: щипок — кратність, разом вгору-вниз — висота --- */
  // Вгору — вище: 1 px ≈ 0,8 м, крок 5 м; вправо — більша кратність, крок на кожні 40 px
  const liftTo = (h0, dy) => Math.max(10, Math.min(300, Math.round((h0 - dy * 0.8) / 5) * 5));
  const zoomTo = (z0, dx) => Math.max(1, Math.min(8, z0 + Math.round(dx / 40)));
  const fingers = new Map();
  let gest = null;
  const pair = () => {
    const [a, b] = [...fingers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 1) gest = { mode: 'aim', x: e.clientX, y: e.clientY, t: performance.now(), r: { ...reticle } };
    else if (fingers.size === 2) {
      // Другий палець ліг одразу за першим — це жест двома пальцями, а не прицілювання: приціл повертаємо
      if (gest?.mode === 'aim' && performance.now() - gest.t < 300) Object.assign(reticle, gest.r);
      gest = { mode: null, ...pair(), z0: state.zoom, c0: { ...cam }, r0: { ...reticle } };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId);
    if (!f || !gest) return;
    f.x = e.clientX; f.y = e.clientY;
    if (gest.mode === 'aim') {
      // Відносно, щоб палець не закривав приціл
      reticle.e += (e.clientX - gest.x) / ppm;
      reticle.n -= (e.clientY - gest.y) / ppm;
      clampReticle();
      gest.x = e.clientX; gest.y = e.clientY;
      if (!loop) draw();
      return;
    }
    if (fingers.size < 2) return;
    const p = pair();
    // Що саме робимо — вирішує перший помітний рух: розвели пальці чи посунули обидва
    if (!gest.mode) {
      if (Math.abs(p.d - gest.d) > 24) gest.mode = 'zoom';
      else if (Math.hypot(p.x - gest.x, p.y - gest.y) > 12) gest.mode = 'pan';
      else return;
    }
    if (gest.mode === 'zoom') setView({ zoom: Math.max(1, Math.min(8, Math.round(gest.z0 * p.d / gest.d))) });
    // Дрон летить туди, куди ведуть пальці, — як приціл одним пальцем; земля в кадрі пливе назустріч
    else pan(gest.c0.e + (p.x - gest.x) / ppm, gest.c0.n - (p.y - gest.y) / ppm);
  });
  const endGest = (e) => {
    fingers.delete(e.pointerId);
    // Другий палець після щипка не підхоплює приціл — жест закінчується, коли піднято всі
    if (gest && gest.mode !== 'aim') {
      if (gest.mode === 'zoom') settleView(false);
      gest = { mode: 'done' };
    }
    if (!fingers.size) gest = null;
  };
  cv.addEventListener('pointerup', endGest);
  cv.addEventListener('pointercancel', endGest);

  /** Свайп по плашці: висота — вгору-вниз, кратність — вліво-вправо; без руху це звичайний тап, що відкриває повзунок. */
  function badgeSwipe(btn, axis) {
    let s = null, swipedAt = 0;
    // Після свайпу браузер ще надішле click — він не має відкривати повзунок
    btn.addEventListener('click', (e) => { if (performance.now() - swipedAt < 400) e.stopImmediatePropagation(); }, { capture: true });
    btn.addEventListener('pointerdown', (e) => {
      btn.setPointerCapture(e.pointerId);
      s = { x: e.clientX, y: e.clientY, h0: cond.height, z0: state.zoom, moved: false };
    });
    btn.addEventListener('pointermove', (e) => {
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.moved && Math.abs(axis === 'y' ? dy : dx) < 8) return;
      s.moved = true;
      if (axis === 'y') setView({ height: liftTo(s.h0, dy) });
      else setView({ zoom: zoomTo(s.z0, dx) });
    });
    const end = () => {
      if (s?.moved) {
        settleView(axis === 'y');
        swipedAt = performance.now();
      }
      s = null;
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', () => { if (s?.moved) settleView(axis === 'y'); s = null; });
  }
  badgeSwipe($('sim-h-btn'), 'y');
  badgeSwipe($('sim-z-btn'), 'x');

  function clampReticle() {
    const lim = spanM() * 0.48;
    reticle.e = Math.max(cam.e - lim, Math.min(cam.e + lim, reticle.e));
    reticle.n = Math.max(cam.n - lim, Math.min(cam.n + lim, reticle.n));
  }

  /** Дрон летить: камера й приціл разом зсуваються над землею; далі за половину поля ситуації не відлітаємо. */
  function pan(e, n) {
    const lim = round.span * 0.5;
    e = Math.max(-lim, Math.min(lim, e));
    n = Math.max(-lim, Math.min(lim, n));
    reticle.e = gest.r0.e + (e - gest.c0.e);
    reticle.n = gest.r0.n + (n - gest.c0.n);
    cam.e = e; cam.n = n;
    ground = null;
    if (!loop) draw();
  }

  /** Висота чи кратність під пальцем: кадр перемальовується одразу, цілі лишаються на своїх місцях на землі. */
  function setView(v) {
    const was = cond.height;
    if (v.height != null) cond.height = v.height;
    if (v.zoom != null) state.zoom = v.zoom;
    if (v.height != null && v.height === was && v.zoom == null) return;
    shownH = cond.height;
    ppm = side / spanM();
    ground = null;
    clampReticle();
    $('sim-h-v').textContent = `${cond.height} м`;
    $('sim-zoom-v').textContent = `${state.zoom}×`;
    flash(v.height != null ? `↕ ${cond.height} м` : `${state.zoom}×`);
    if (v.height != null) refreshWind();
    if (!loop) draw();
  }

  /**
   * Відпустив. Після спуску (fit) цілі, що опинились за кадром, підтягуємо всередину — ситуація та сама, лише ближче,
   * і рухаються вони далі в межах нового кадру. Кратність лише наближує — цілі не чіпаємо.
   */
  function settleView(fit = false) {
    if (fit) {
      const lim = spanM() * 0.42;
      const far = Math.max(0, ...round.targets.filter((t) => !t.hit).map((t) => Math.max(Math.abs(t.e), Math.abs(t.n))));
      if (far > lim) {
        const k = lim / far;
        for (const p of [...round.targets, cam, reticle]) { p.e *= k; p.n *= k; }
        ground = null;
        round.span = Math.min(round.span, spanM());
      }
    }
    changed();
  }

  /* --- кнопки на кадрі --- */
  function flash(text) {
    const m = $('sim-msg');
    m.textContent = text;
    m.hidden = false;
    clearTimeout(msgT);
    msgT = setTimeout(() => { m.hidden = true; }, 1200);
  }
  $('sim-i').addEventListener('click', (e) => {
    const help = $('sim-help');
    help.hidden = !help.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!help.hidden));
  });
  $('sim-ret').addEventListener('click', () => {
    const i = RETICLES.findIndex((r) => r.id === state.ret);
    state.ret = RETICLES[(i + 1) % RETICLES.length].id;
    flash(RETICLES.find((r) => r.id === state.ret).name);
    changed();
  });
  // Висота й кратність — тап по плашці відкриває повзунок поверх кадру, як у Shooter's Log
  const pops = [...frame.querySelectorAll('[data-pop]')];
  for (const b of pops) {
    b.addEventListener('click', () => {
      const open = $(b.dataset.pop).hidden;
      for (const o of pops) {
        $(o.dataset.pop).hidden = !(o === b && open);
        o.setAttribute('aria-expanded', String(o === b && open));
      }
    });
  }
  const hIn = $('sim-h'), zIn = $('sim-z');
  hIn.addEventListener('input', () => setView({ height: +hIn.value }));
  hIn.addEventListener('change', () => settleView(true));
  zIn.addEventListener('input', () => setView({ zoom: +zIn.value }));
  zIn.addEventListener('change', () => settleView(false));

  /* --- рядок під кадром; вантаж — стрічкою, як ціль; той самий, що в «Розрахунку», свої задаються там --- */
  const ldStrip = el('div', { class: 'tgt-strip', role: 'radiogroup', 'aria-label': 'Вантаж' });
  const ldNote = el('p', { class: 'tgt-note' });
  const ldWheel = wheelStrip(ldStrip, (b) => {
    const l = loadById(b.dataset.v);
    ldNote.textContent = `${l.name || 'Без назви'}: ${fmt(l.mass, 2)} кг · ${describe(l)}`;
  });
  $('sim-ldp').append(ldStrip, ldNote, el('button', {
    type: 'button', class: 'link-btn', onclick: () => openCalc('load'),
  }, 'Свої вантажі — у «Розрахунку» ›'));
  const paintLoads = () => {
    const list = loads();
    if (!list.some((l) => l.id === cond.load)) cond.load = list[0].id;
    $('sim-load-v').textContent = loadById(cond.load).name || 'Без назви';
    ldStrip.replaceChildren(...list.map((l) => {
      const ico = el('span', { class: 'tgt-ico ld-ico' });
      ico.innerHTML = LOAD_ICO;
      return el('button', {
        type: 'button', class: 'tgt-opt', role: 'radio', 'data-v': l.id, 'aria-checked': String(l.id === cond.load),
        onclick: () => { cond.load = l.id; paintLoads(); changed(); },
      }, ico, el('span', {}, l.name || 'Без назви'));
    }));
    if (!$('sim-ldp').hidden) ldWheel.settle(ldStrip.querySelector('[aria-checked="true"]'));
  };
  $('sim-hint').addEventListener('click', () => { state.hint = !state.hint; changed(); });
  $('sim-new').addEventListener('click', () => {
    vibrate(8);
    const m = renewPref();
    const said = [];
    if (m === 'wind' || m === 'both') {
      // Випадковий вітер 1–8 м/с з будь-якої години
      cond.wind = 1 + Math.floor(Math.random() * 8);
      cond.clock = 1 + Math.floor(Math.random() * 12);
      cond.src = 'hand';
      said.push(`вітер ${cond.wind} м/с з ${cond.clock} год`);
    }
    if (m === 'move' || m === 'both') {
      // Інша швидкість, ніж була; напрям кожної цілі й так новий
      const other = MOVES.filter((x) => x.v !== state.move);
      state.move = other[Math.floor(Math.random() * other.length)].v;
      said.push(move().short || move().name);
    }
    changed({ fresh: true });
    if (said.length) flash(said.join(' · '));
  });
  const renewBtn = $('sim-new-mode');
  const renewPanel = $('sim-renew');
  const paintRenew = () => {
    const m = renewPref();
    renewPanel.replaceChildren(
      el('div', { class: 'chips' }, RENEW_MODES.map(([k, label]) => el('button', {
        type: 'button', class: k === m ? 'on' : null, 'aria-pressed': String(k === m),
        onclick: () => { setRenew(k); paintRenew(); },
      }, label))),
      el('p', { class: 'muted small' }, RENEW_NOTE[m]));
    renewBtn.title = `Нова ситуація: ${RENEW_MODES.find(([k]) => k === m)[1]}`;
    renewBtn.setAttribute('aria-label', renewBtn.title);
  };
  renewBtn.addEventListener('click', () => {
    const open = renewPanel.hidden;
    paintRenew();
    renewPanel.hidden = !open;
    renewBtn.setAttribute('aria-expanded', String(open));
  });
  $('sim-drop').addEventListener('click', drop);

  /* --- ціль, рух: тап — панель під рядком; вітер: тап — у «Розрахунок»; свайп — наступне значення --- */
  const tools = [...document.querySelectorAll('#pane-sim .sim-tools .sim-tool, #sim-load')];
  const cycle = {
    tgt: (d) => { state.kind = KINDS[(KINDS.indexOf(kind()) + d + KINDS.length) % KINDS.length].id; changed({ fresh: true }); },
    wind: (d) => {
      const steps = [0, 2, 4, 6, 8];
      const i = steps.findIndex((v) => v >= cond.wind);
      cond.wind = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? steps.length - 1 : i) + d))];
      cond.src = 'hand';
      changed();
    },
    move: (d) => { state.move = MOVES[(MOVES.indexOf(move()) + d + MOVES.length) % MOVES.length].v; changed(); },
    load: (d) => {
      const list = loads();
      const i = list.findIndex((l) => l.id === cond.load);
      cond.load = list[(i + d + list.length) % list.length].id;
      paintLoads();
      changed();
    },
  };
  // Довге натискання скидає: вітер — у штиль (і з прогнозу на заданий), рух — цілі стоять
  const reset = {
    wind: () => { cond.wind = 0; cond.src = 'hand'; changed(); flash('Вітер скинуто — штиль'); },
    move: () => { state.move = 0; changed(); flash('Рух скинуто — цілі стоять'); },
  };
  for (const b of tools) {
    let sx = null, sy = 0, swiped = false, holdT = 0;
    const unhold = () => { clearTimeout(holdT); holdT = 0; };
    b.addEventListener('pointerdown', (e) => {
      sx = e.clientX; sy = e.clientY; swiped = false;
      if (!reset[b.dataset.key]) return;
      holdT = setTimeout(() => {
        holdT = 0; sx = null; swiped = true;
        vibrate(20);
        reset[b.dataset.key]();
      }, 550);
    });
    b.addEventListener('pointermove', (e) => { if (holdT && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) unhold(); });
    b.addEventListener('pointercancel', () => { unhold(); sx = null; });
    // Інакше Android на довге натискання покаже меню
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('pointerup', (e) => {
      unhold();
      if (sx == null) return;
      const dx = e.clientX - sx;
      sx = null;
      if (Math.abs(dx) < 30) return;
      swiped = true;
      vibrate(6);
      cycle[b.dataset.key](dx < 0 ? 1 : -1);
    });
    b.addEventListener('click', () => {
      if (swiped) { swiped = false; return; }
      const open = b.dataset.panel && b.getAttribute('aria-expanded') !== 'true';
      for (const o of tools) {
        if (!o.dataset.panel) continue;
        o.setAttribute('aria-expanded', String(o === b && open));
        $(o.dataset.panel).hidden = !(o === b && open);
      }
      if (!b.dataset.panel) { openCalc(b.dataset.key); return; }
      // Стрічку вирівнюємо, коли її видно: у прихованої немає розмірів
      if (b.dataset.key === 'tgt' && open) tgtWheel.settle(tgtStrip.querySelector('[aria-checked="true"]'));
      if (b.dataset.key === 'load' && open) ldWheel.settle(ldStrip.querySelector('[aria-checked="true"]'));
    });
  }
  // Ціль — стрічкою, як у Shooter's Log: посередині в рамці, під стрічкою — що це і чим брати; вибір — тапом
  const tgtStrip = el('div', { class: 'tgt-strip', role: 'radiogroup', 'aria-label': 'Ціль' }, KINDS.map((k) => {
    const ico = el('span', { class: 'tgt-ico' });
    ico.innerHTML = SYM(k.icon);
    return el('button', {
      type: 'button', class: 'tgt-opt', role: 'radio', 'data-v': k.id, onclick: () => { state.kind = k.id; changed({ fresh: true }); },
    }, ico, el('span', {}, k.name));
  }));
  const tgtNote = el('p', { class: 'tgt-note' });
  const tgtWheel = wheelStrip(tgtStrip, (b) => {
    const k = KINDS.find((x) => x.id === b.dataset.v);
    tgtNote.textContent = `${k.name}: ${k.what}, ${dims(k)} · ${takes(k.icon)}`;
  });
  $('sim-tgt').append(tgtStrip, tgtNote);
  $('sim-move').append(el('div', { class: 'chips' }, MOVES.map((m) => el('button', {
    type: 'button', 'data-v': String(m.v), onclick: () => { state.move = m.v; changed(); },
  }, m.name))));

  /** Середній вітер на висоті дрона, сила поривів, підказка з розкидом — після будь-якої зміни вітру, висоти чи вантажу. */
  function refreshWind() {
    const s = params();
    meanH = meanWind(s)(cond.height);
    gst = gustStats(s);
    // Порив стартує не з нуля, а з випадкового в межах звичайного — інакше перші півхвилини вітер був би рівно середній
    if (!(gst.su > 0.01)) gcur = CALM_GUST;
    else if (gcur === CALM_GUST) gcur = gustStart(gst, N);
    const load = loadById(cond.load);
    const r = simulate(s, load, { dt: DT });
    hint = { x: r.x, y: r.y };
    // Час падіння — з тієї ж моделі, що й підказка; затримку скиду показуємо окремо, бо вона до падіння
    $('sim-fall-v').textContent = `${fmt(r.time)}${cond.delay ? `+${fmt(cond.delay, 2)}` : ''} с`;
    hintSc = state.hint && gst.su > 0.01 ? scatter(s, load, { n: 60, seed: 3 }) : null;
    paintOsd();
  }

  /* --- усе, що залежить від налаштувань --- */
  function changed({ fresh = false } = {}) {
    save();
    refreshWind();
    paintControls();
    if (fresh) {
      ppm = side / spanM();
      newRound();
    } else {
      paintOut();
      kick();
      if (!loop) draw();
    }
  }

  function paintControls() {
    const k = kind();
    // На кнопці — коротко, щоб уміщалось на 360 px; напрям вітру — стрілкою на кадрі, повністю — у панелі
    $('sim-tgt-v').textContent = k.name;
    // Сила — на висоті дрона: з прогнозу чи з профілю, а не задана біля землі
    const wm = Math.hypot(meanH.x, meanH.y);
    $('sim-wind-v').textContent = wm >= 0.05 ? `${fmt(wm)} м/с` : 'штиль';
    $('sim-move-v').textContent = state.move ? (move().short || move().name) : 'стоїть';
    $('sim-tgt-ico').innerHTML = SYM(k.icon);
    let on = null;
    for (const b of tgtStrip.querySelectorAll('.tgt-opt')) {
      b.setAttribute('aria-checked', String(b.dataset.v === state.kind));
      if (b.dataset.v === state.kind) on = b;
    }
    if (!$('sim-tgt').hidden) tgtWheel.settle(on);
    for (const b of $('sim-move').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === state.move);
    tools.forEach((b) => b.classList.toggle('hot', (b.dataset.key === 'wind' && wm >= 0.05) || (b.dataset.key === 'move' && state.move > 0)));
    $('sim-zoom-v').textContent = `${state.zoom}×`;
    $('sim-h-v').textContent = `${cond.height} м`;
    hIn.value = cond.height;
    zIn.value = state.zoom;
    const ret = RETICLES.find((r) => r.id === state.ret);
    $('sim-ret').setAttribute('aria-label', `Сітка: ${ret.name}`);
    $('sim-ret').title = `Сітка: ${ret.name}`;
    $('sim-hint').setAttribute('aria-pressed', String(state.hint));
    // З прогнозом напрям вітру залежить від курсу — показуємо його біля носа
    $('sim-nose-v').textContent = fcUsed(fc) ? `ніс ${fmt(cond.heading || 0, 0)}°` : 'ніс';
  }

  new ResizeObserver(resize).observe(cv);
  paintLoads();
  changed({ fresh: true });

  return {
    /** Вкладку показали: свої вантажі могли змінитись у розрахунку, кадр — отримати розмір. */
    show() {
      fc = loadFc();
      paintLoads();
      if (!renewPanel.hidden) paintRenew();
      // Висоту могли змінити в «Розрахунку» — кадр перебудовуємо, цілі лишаються на землі
      if (cond.height !== shownH) {
        shownH = cond.height;
        ppm = side / spanM();
        ground = null;
        clampReticle();
        settleView(true);
      } else changed();
      resize();
    },
  };
}
