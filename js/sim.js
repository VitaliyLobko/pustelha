// Тренажер скиду: вид з камери вниз, приціл — точка під дроном, тягнеться пальцем; цілі поки квадратами.
import { simulate } from './ballistics.js';
import { $, el, fmt, read, write, vibrate, clockWord, where } from './ui.js';
import { windPicker } from './wind-pick.js';
import { RENEW_MODES, RENEW_NOTE, renewPref, setRenew } from './settings.js';

const KEY = 'pustelha:sim';
// Кут огляду камери по ширині кадру — типовий для дронів; кратність звужує його
const HFOV = 80 * Math.PI / 180;
// Цілі схемою — знаками APP-6 / MIL-STD-2525 для противника: червоний ромб, усередині — рід військ.
// size — справжній розмір на землі (м), по ньому рахується влучання; знак малюється не дрібніше за SYM_MIN px
const KINDS = [
  { id: 'inf', name: 'Піхота', size: 1, count: 5, icon: 'inf' },
  { id: 'mech', name: 'БМП', size: 4, count: 3, icon: 'mech' },
  { id: 'tank', name: 'Танк', size: 5, count: 2, icon: 'armor' },
  { id: 'dug', name: 'Бліндаж', size: 4, count: 2, icon: 'fort' },
];
const SYM_MIN = 26;
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
const DEFAULTS = { height: 100, zoom: 4, wind: 4, clock: 3, kind: 'inf', move: 0, hint: false, load: 'c1', ret: 'cross' };
// Повітря в тренажері — стандартне; вітер слабшає до землі, як у розрахунку за замовчуванням
const AIR = { tempC: 15, elevation: 150, profile: 1 / 7 };
const DT = 0.004;

const state = { ...DEFAULTS, ...read(KEY, {}) };
const save = () => write(KEY, state);
const kind = () => KINDS.find((k) => k.id === state.kind) || KINDS[0];
const move = () => MOVES.find((m) => m.v === state.move) || MOVES[0];
/** Скільки метрів землі вміщає кадр по ширині. */
const spanM = () => 2 * state.height * Math.tan(HFOV / 2) / state.zoom;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initSim({ loads, loadById }) {
  const frame = $('sim-frame');
  const cv = $('sim-cv');
  const ctx = cv.getContext('2d');
  let side = 0, dpr = 1, ppm = 1;
  let ground = null;
  let round = null;
  const reticle = { e: 0, n: 0 };
  let bombs = [], bursts = [];
  let hint = null;
  let loop = 0, lastT = 0;
  let msgT = 0;

  const toS = (e, n) => [side / 2 + e * ppm, side / 2 - n * ppm];
  const params = () => ({ height: state.height, speed: 0, wind: state.wind, clock: state.clock, ...AIR });

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
        if (Math.hypot(e, n) < k.size * 2 + span * 0.08) continue;
        if (targets.some((t) => Math.hypot(t.e - e, t.n - n) < k.size * 2.5)) continue;
        targets.push({ e, n, size: k.size, dir: rnd() * 2 * Math.PI, hit: false });
        break;
      }
    }
    round = { seed, span, targets, craters: [], drops: 0, hits: 0, last: null, kind: k, active: 0 };
    reticle.e = reticle.n = 0;
    bombs = []; bursts = [];
    ground = null;
    paintOut();
    paintScore();
    kick();
  }

  /* --- земля: плями трави й ґрунту, кущі, польова дорога — у метрах, щоб масштабувались з кратністю --- */
  function paintGround() {
    const g = document.createElement('canvas');
    g.width = g.height = Math.round(side * dpr);
    const c = g.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(round.seed ^ 0x9e3779b9);
    // Землю малюємо на весь кадр при 1× — щоб кратність не міняла місцевість
    const R = state.height * Math.tan(HFOV / 2);
    c.fillStyle = '#6d7746';
    c.fillRect(0, 0, side, side);
    const area = (2 * R) ** 2;
    const PATCH = ['#66703f', '#7a8550', '#5d6838', '#857f55', '#727045', '#5f6a3a'];
    for (let i = 0; i < area / 120; i++) {
      const [x, y] = toS((rnd() - 0.5) * 2 * R, (rnd() - 0.5) * 2 * R);
      const r = (2 + rnd() * 12) * ppm;
      if (x < -r || y < -r || x > side + r || y > side + r) continue;
      c.globalAlpha = 0.35 + rnd() * 0.35;
      c.fillStyle = PATCH[Math.floor(rnd() * PATCH.length)];
      c.beginPath();
      c.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, 2 * Math.PI);
      c.fill();
    }
    // Польова дорога через кадр
    c.globalAlpha = 0.8;
    c.strokeStyle = '#8f8461';
    c.lineWidth = Math.max(2, 3.5 * ppm);
    c.lineCap = 'round';
    c.beginPath();
    const y0 = (rnd() - 0.5) * R, y1 = (rnd() - 0.5) * R;
    const [ax, ay] = toS(-R, y0), [bx, by] = toS(0, (rnd() - 0.5) * R), [dx, dy] = toS(R, y1);
    c.moveTo(ax, ay);
    c.quadraticCurveTo(bx, by, dx, dy);
    c.stroke();
    // Кущі
    for (let i = 0; i < area / 60; i++) {
      const [x, y] = toS((rnd() - 0.5) * 2 * R, (rnd() - 0.5) * 2 * R);
      const r = (0.4 + rnd() * 1.2) * ppm;
      if (x < -r || y < -r || x > side + r || y > side + r) continue;
      c.globalAlpha = 0.55 + rnd() * 0.3;
      c.fillStyle = rnd() < 0.5 ? '#3f4a2a' : '#4b5632';
      c.beginPath();
      c.arc(x, y, Math.max(0.6, r), 0, 2 * Math.PI);
      c.fill();
    }
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
    round.targets.forEach((t, i) => drawTarget(t, i === round.active));
    if (state.hint && hint) {
      const [x0, y0] = toS(reticle.e, reticle.n);
      const [x, y] = toS(reticle.e + hint.y, reticle.n + hint.x);
      ctx.strokeStyle = '#79aaf0';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
    }
    const now = performance.now();
    for (const b of bombs) {
      const tau = (now - b.t0) / 1000;
      const p = b.path[Math.min(b.path.length - 1, Math.floor(tau / DT))];
      const [x, y] = toS(b.e0 + p[1], b.n0 + p[0]);
      // Чим нижче, тим менший — падає від камери
      const r = 2.5 + 5 * (p[2] / state.height);
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
      ctx.beginPath(); ctx.arc(x, y, (0.6 + 2.4 * k) * Math.max(ppm, 4), 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawReticle(...toS(reticle.e, reticle.n));
  }

  /** Ціль: справжній слід на землі (по ньому влучання) і знак противника APP-6 поверх — щоб читався на будь-якій кратності. */
  function drawTarget(t, active) {
    const [x, y] = toS(t.e, t.n);
    const s = t.size * ppm;
    const d = Math.max(SYM_MIN, s) / 2;
    ctx.globalAlpha = t.hit ? 0.45 : 1;
    // Знак більший за ціль — показуємо її справжній розмір пунктиром
    if (d * 2 > s + 4) {
      ctx.strokeStyle = 'rgb(255 255 255 / .8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      ctx.setLineDash([]);
    }
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
    if (active && !t.hit) {
      // Вибрана ціль — жовті кутики навколо
      const r = d + 5, k = Math.min(8, r * 0.5);
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * r, y + sy * (r - k)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - k), y + sy * r);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (t.hit) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; cross(x, y, d * 0.7); }
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
    const load = loadById(state.load);
    const r = simulate(params(), load, { dt: DT, track: true });
    bombs.push({ e0: reticle.e, n0: reticle.n, path: r.path, T: r.time, r, t0: performance.now() });
    round.drops++;
    vibrate(15);
    paintScore();
    kick();
  }

  function land(b, now) {
    b.done = true;
    const e = b.e0 + b.r.y, n = b.n0 + b.r.x;
    const gap = (t) => Math.hypot(Math.max(Math.abs(e - t.e) - t.size / 2, 0), Math.max(Math.abs(n - t.n) - t.size / 2, 0));
    // Влучання — у будь-яку ціль у сліді; промах — відносно вибраної
    const struck = round.targets.find((t) => !t.hit && gap(t) === 0);
    const aim = round.targets[round.active];
    const ref = struck || (aim && !aim.hit ? aim : null);
    const best = ref && { t: ref, d: gap(ref), de: e - ref.e, dn: n - ref.n };
    const hit = !!struck;
    if (hit) {
      struck.hit = true;
      round.hits++;
      vibrate([30, 40, 30]);
      if (struck === aim) nextTarget();
    }
    round.craters.push({ e, n, hit });
    bursts.push({ e, n, t0: now });
    round.last = { hit, best, T: b.T, drift: Math.hypot(b.r.x, b.r.y), dx: b.r.x, dy: b.r.y, no: round.drops };
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
    } else if (L.hit) {
      rows.push(row(`Скид ${L.no}`, el('span', { class: 'v good' }, `влучання — ${round.kind.name.toLowerCase()}`)));
    } else {
      rows.push(row(`Скид ${L.no}`, el('span', {}, el('span', { class: 'v bad' }, `промах ${fmt(L.best.d)} м`),
        ` до краю · ${where(L.best.dn, L.best.de, ['вище', 'нижче'])} від центру цілі`)));
    }
    if (L) {
      rows.push(row('Падав', `${fmt(L.T)} с · вітер зніс ${fmt(L.drift)} м${L.drift >= 0.05 ? ` (${where(L.dx, L.dy, ['вгору', 'вниз'])})` : ''}`));
      if (state.move) rows.push(row('Ціль', `за цей час пройшла ${fmt(state.move * L.T)} м — бери упередження по ходу руху`));
    }
    if (state.hint && hint) {
      const d = Math.hypot(hint.x, hint.y);
      rows.push(row('Підказка', d >= 0.05 ? `впаде ${where(hint.x, hint.y, ['вище', 'нижче'])} від прицілу — синє кільце` : 'впаде під приціл', 'fx'));
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

  /* --- жести на кадрі: палець на прицілі — тягне приціл; деінде свайп: вгору-вниз — висота, вліво-вправо — кратність --- */
  const GRAB = 46;
  let gest = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const box = cv.getBoundingClientRect();
    const [rx, ry] = toS(reticle.e, reticle.n);
    const onReticle = Math.hypot(e.clientX - box.left - rx, e.clientY - box.top - ry) < GRAB;
    gest = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, mode: onReticle ? 'aim' : null, h0: state.height, z0: state.zoom };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!gest || !cv.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - gest.x0, dy = e.clientY - gest.y0;
    // Напрям свайпу — за першими 10 px руху
    if (!gest.mode) {
      if (Math.hypot(dx, dy) < 10) return;
      gest.mode = Math.abs(dy) > Math.abs(dx) ? 'height' : 'zoom';
    }
    if (gest.mode === 'aim') {
      // Відносно, щоб палець не закривав приціл
      reticle.e += (e.clientX - gest.x) / ppm;
      reticle.n -= (e.clientY - gest.y) / ppm;
      clampReticle();
      gest.x = e.clientX; gest.y = e.clientY;
      if (!loop) draw();
    } else if (gest.mode === 'height') {
      // Вгору — вище: 1 px ≈ 0,8 м, крок 5 м
      setView({ height: Math.max(25, Math.min(300, Math.round((gest.h0 - dy * 0.8) / 5) * 5)) });
    } else {
      // Вправо — більша кратність: крок на кожні 40 px
      setView({ zoom: Math.max(1, Math.min(8, gest.z0 + Math.round(dx / 40))) });
    }
  });
  const endGest = () => {
    if (gest?.mode === 'height' || gest?.mode === 'zoom') settleView(gest.mode === 'height');
    gest = null;
  };
  cv.addEventListener('pointerup', endGest);
  cv.addEventListener('pointercancel', endGest);

  function clampReticle() {
    const lim = spanM() * 0.48;
    reticle.e = Math.max(-lim, Math.min(lim, reticle.e));
    reticle.n = Math.max(-lim, Math.min(lim, reticle.n));
  }

  /** Висота чи кратність під пальцем: кадр перемальовується одразу, цілі лишаються на своїх місцях на землі. */
  function setView(v) {
    const was = state.height;
    Object.assign(state, v);
    if (v.height != null && v.height === was && v.zoom == null) return;
    ppm = side / spanM();
    ground = null;
    clampReticle();
    $('sim-h-v').textContent = `${state.height} м`;
    $('sim-zoom-v').textContent = `${state.zoom}×`;
    flash(v.height != null ? `↕ ${state.height} м` : `${state.zoom}×`);
    if (v.height != null && hint) {
      const r = simulate(params(), loadById(state.load), { dt: DT });
      hint = { x: r.x, y: r.y };
    }
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
        for (const t of round.targets) { t.e *= k; t.n *= k; }
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

  /* --- рядок під кадром --- */
  const sel = $('sim-load');
  const paintLoads = () => {
    const list = loads();
    if (!list.some((l) => l.id === state.load)) state.load = list[0].id;
    sel.replaceChildren(...list.map((l) => el('option', { value: l.id }, l.name || 'Без назви')));
    sel.value = state.load;
  };
  sel.addEventListener('change', () => { state.load = sel.value; changed(); });
  $('sim-hint').addEventListener('click', () => { state.hint = !state.hint; changed(); });
  $('sim-new').addEventListener('click', () => {
    vibrate(8);
    const m = renewPref();
    const said = [];
    if (m === 'wind' || m === 'both') {
      // Випадковий вітер 1–8 м/с з будь-якої години
      state.wind = 1 + Math.floor(Math.random() * 8);
      state.clock = 1 + Math.floor(Math.random() * 12);
      said.push(`вітер ${state.wind} м/с з ${state.clock} год`);
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

  /* --- ціль, вітер, рух: тап — панель під рядком, свайп — наступне значення --- */
  const tools = [...document.querySelectorAll('#pane-sim .sim-tool[data-panel]')];
  const cycle = {
    tgt: (d) => { state.kind = KINDS[(KINDS.indexOf(kind()) + d + KINDS.length) % KINDS.length].id; changed({ fresh: true }); },
    wind: (d) => {
      const steps = [0, 2, 4, 6, 8];
      const i = steps.findIndex((v) => v >= state.wind);
      state.wind = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? steps.length - 1 : i) + d))];
      changed();
    },
    move: (d) => { state.move = MOVES[(MOVES.indexOf(move()) + d + MOVES.length) % MOVES.length].v; changed(); },
  };
  for (const b of tools) {
    let sx = null, swiped = false;
    b.addEventListener('pointerdown', (e) => { sx = e.clientX; swiped = false; });
    b.addEventListener('pointerup', (e) => {
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
      const open = b.getAttribute('aria-expanded') !== 'true';
      for (const o of tools) {
        o.setAttribute('aria-expanded', String(o === b && open));
        $(o.dataset.panel).hidden = !(o === b && open);
      }
    });
  }
  $('sim-tgt').append(el('div', { class: 'chips' }, KINDS.map((k) => el('button', {
    type: 'button', 'data-v': k.id, onclick: () => { state.kind = k.id; changed({ fresh: true }); },
  }, `${k.name} · ${fmt(k.size, 0)} м`))));
  $('sim-move').append(el('div', { class: 'chips' }, MOVES.map((m) => el('button', {
    type: 'button', 'data-v': String(m.v), onclick: () => { state.move = m.v; changed(); },
  }, m.name))));
  const wind = windPicker({ get: () => state, set: (v) => { Object.assign(state, v); changed(); } });
  $('sim-wind').append(wind.el);

  /* --- усе, що залежить від налаштувань --- */
  function changed({ fresh = false } = {}) {
    save();
    const load = loadById(state.load);
    const r = simulate(params(), load, { dt: DT });
    hint = { x: r.x, y: r.y };
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
    $('sim-wind-v').textContent = state.wind ? `${fmt(state.wind, state.wind % 1 ? 1 : 0)} м/с` : 'штиль';
    $('sim-move-v').textContent = state.move ? (move().short || move().name) : 'стоїть';
    for (const b of $('sim-tgt').querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === state.kind);
    for (const b of $('sim-move').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === state.move);
    tools.forEach((b) => b.classList.toggle('hot', (b.dataset.key === 'wind' && state.wind > 0) || (b.dataset.key === 'move' && state.move > 0)));
    wind.paint();
    $('sim-zoom-v').textContent = `${state.zoom}×`;
    $('sim-h-v').textContent = `${state.height} м`;
    hIn.value = state.height;
    zIn.value = state.zoom;
    const ret = RETICLES.find((r) => r.id === state.ret);
    $('sim-ret').setAttribute('aria-label', `Сітка: ${ret.name}`);
    $('sim-ret').title = `Сітка: ${ret.name}`;
    $('sim-hint').setAttribute('aria-pressed', String(state.hint));
    // Вітер на кадрі: стрілка — куди рухається повітря
    const osd = $('sim-wind-osd');
    osd.hidden = !state.wind;
    $('sim-wind-arrow').setAttribute('transform', `rotate(${state.clock * 30 + 180} 12 12)`);
    $('sim-wind-osd-v').textContent = `${fmt(state.wind, state.wind % 1 ? 1 : 0)} м/с`;
  }

  new ResizeObserver(resize).observe(cv);
  paintLoads();
  changed({ fresh: true });

  return {
    /** Вкладку показали: свої вантажі могли змінитись у розрахунку, кадр — отримати розмір. */
    show() {
      paintLoads();
      if (!renewPanel.hidden) paintRenew();
      changed();
      resize();
    },
  };
}
