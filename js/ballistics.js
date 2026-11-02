// Падіння вантажу з дрона: точкова маса, опір від швидкості відносно повітря, вітер з профілем по висоті й поривами, RK4.
// Осі прив'язані до носа дрона: x — вперед, y — праворуч, z — вгору; висота відраховується від цілі.

export const G = 9.80665;
const D2R = Math.PI / 180;

/** Густина повітря: за тиском біля землі (гПа), якщо він відомий, інакше — за висотою місцевості (стандартна атмосфера). */
export function airDensity(tempC = 15, elevation = 0, pressure = null) {
  const p = pressure > 0 ? pressure * 100 : 101325 * Math.pow(1 - 2.25577e-5 * elevation, 5.25588);
  return p / (287.05 * (tempC + 273.15));
}

/** Вектор руху повітря {x, y} для вітру «звідки дме» за годинником відносно носа дрона (12 — в лоб). */
export function windVector(speed, clock) {
  const a = (clock % 12) * Math.PI / 6;
  return { x: -speed * Math.cos(a), y: -speed * Math.sin(a) };
}

/** Встановлена швидкість падіння, м/с: на ній опір дорівнює вазі. */
export function terminalVelocity(m, rho) {
  const k = dragK(m, rho);
  return k > 0 ? Math.sqrt(G / k) : Infinity;
}

// Опір на одиницю маси: a = −k·|v_rel|·v_rel
function dragK(m, rho) {
  const area = Math.PI * Math.pow(m.diameter / 1000, 2) / 4;
  return 0.5 * rho * m.cd * area / m.mass;
}

/* --- середній вітер по висоті --- */

// Логарифмічний профіль приземного шару: U(z) ∝ ln(z / z0); z0 — шорсткість місцевості (поле 0,03 м … ліс 1 м).
// Нижче 1,5·z0 профіль не опускаємо — там повітря в траві чи кронах майже стоїть
const logShare = (z, zr, z0) => Math.log(Math.max(z, 1.5 * z0) / z0) / Math.log(Math.max(zr, 1.5 * z0) / z0);

/** Вітер прогнозу на висоті z: {e, n} — куди рухається повітря (схід, північ), м/с. Між рівнями — по ln z, нижче нижнього — лог-профіль. */
export function levelAir(levels, z, z0 = 0.03) {
  const v = (l, k = 1) => ({ e: -l.speed * k * Math.sin(l.dir * D2R), n: -l.speed * k * Math.cos(l.dir * D2R) });
  const L = levels;
  if (z <= L[0].z) return v(L[0], logShare(z, L[0].z, z0));
  const i = L.findIndex((l) => l.z > z);
  if (i < 0) return v(L[L.length - 1]);
  // Вектори, а не швидкість і кут окремо: так поворот вітру з висотою переходить через північ без стрибка
  const a = v(L[i - 1]), b = v(L[i]);
  const f = Math.log(z / L[i - 1].z) / Math.log(L[i].z / L[i - 1].z);
  return { e: a.e + (b.e - a.e) * f, n: a.n + (b.n - a.n) * f };
}

/** Швидкість і напрям «звідки» (°) вітру прогнозу на висоті z. */
export function levelWind(levels, z, z0) {
  const a = levelAir(levels, z, z0);
  return { speed: Math.hypot(a.e, a.n), dir: (Math.atan2(-a.e, -a.n) / D2R + 360) % 360 };
}

/**
 * Середній вітер по висоті в осях дрона: z → {x, y}.
 * Вручну: wind і clock — на висоті refHeight (за замовчуванням — висота скиду), z0 > 0 — лог-профіль, інакше однаковий;
 * zp — шорсткість лише для профілю, коли вона інша, ніж для поривів (замір біля землі — на відкритому місці).
 * З прогнозу: levels [{z, speed, dir — звідки, ° за компасом}], heading — куди дивиться ніс, °; scale — підгонка під замір.
 */
export function meanWind(s) {
  if (s.levels?.length) {
    const h = (s.heading || 0) * D2R, k = s.scale > 0 ? s.scale : 1, z0 = s.z0 > 0 ? s.z0 : 0.03;
    return (z) => {
      const a = levelAir(s.levels, z, z0);
      return { x: k * (a.e * Math.sin(h) + a.n * Math.cos(h)), y: k * (a.e * Math.cos(h) - a.n * Math.sin(h)) };
    };
  }
  const air = windVector(s.wind || 0, s.clock ?? 12);
  if (!(s.z0 > 0)) return () => air;
  const zr = s.refHeight ?? s.height, zp = s.zp > 0 ? s.zp : s.z0;
  return (z) => { const f = logShare(z, zr, zp); return { x: air.x * f, y: air.y * f }; };
}

/* --- пориви --- */

/**
 * Сила й тривалість поривів. σ поздовжньої складової в приземному шарі майже не залежить від висоти (≈ 2,5·u*);
 * з прогнозу — з «поривів до» на 10 м: порив ≈ середній + 3σ. Поперечна — 0,75σ, вертикальна — 0,5σ.
 * Тривалість T = L/U, масштаб L — за Єврокодом 1-4: 300·(z/200)^(0,67 + 0,05·ln z0). gusty — множник (0 — без поривів).
 */
export function gustStats(s) {
  const mean = meanWind(s);
  const speed = (z) => Math.hypot(mean(z).x, mean(z).y);
  const z0 = s.z0 > 0 ? s.z0 : 0.03;
  let su;
  if (s.levels?.length && s.gust10 > 0) su = Math.max(0, s.gust10 * (s.scale > 0 ? s.scale : 1) - speed(10)) / 3;
  else {
    // На висоті скиду — над шорсткістю, де закон працює; за спільного профілю це те саме число, що й на висоті заміру
    const zr = Math.max(s.height, 2, 1.5 * z0);
    su = speed(zr) / Math.log(zr / z0);
  }
  su *= s.gusty ?? 1;
  const zm = Math.max(s.height / 2, 5);
  const L = 300 * Math.pow(zm / 200, 0.67 + 0.05 * Math.log(z0));
  const T = Math.min(60, Math.max(2, L / Math.max(speed(zm), 1)));
  return { su, sv: 0.75 * su, sw: 0.5 * su, T, peak: speed(s.height) + 3 * su };
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Нормальний розподіл з рівномірного генератора (Бокс — Мюллер). */
export const gaussian = (rnd) => () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

// Пориви — сума повільної частини (тривалість T) і швидкої (≈ 3 с, як «порив» на телеметрії дрона); FAST — її частка дисперсії
const FAST = { share: 0.3, T: 3 };
const ZERO3 = { u: 0, v: 0, w: 0 };
export const CALM_GUST = { s: ZERO3, f: ZERO3, u: 0, v: 0, w: 0 };

/** Випадковий порив «зараз» — з тим самим розподілом, що й у сталому вітрі. */
export function gustStart(g, N) {
  const part = (k) => ({ u: k * g.su * N(), v: k * g.sv * N(), w: k * g.sw * N() });
  const s = part(Math.sqrt(1 - FAST.share)), f = part(Math.sqrt(FAST.share));
  return { s, f, u: s.u + f.u, v: s.v + f.v, w: s.w + f.w };
}

/** Крок пориву на dt (процес Орнштейна — Уленбека для кожної частини): пам'ятає попередній порив, за час T забуває. */
export function gustStep(g, cur, dt, N) {
  const part = (c, T, k) => {
    const a = Math.exp(-dt / T), b = Math.sqrt(1 - a * a) * k;
    return { u: a * c.u + b * g.su * N(), v: a * c.v + b * g.sv * N(), w: a * c.w + b * g.sw * N() };
  };
  const s = part(cur.s || ZERO3, g.T, Math.sqrt(1 - FAST.share)), f = part(cur.f || ZERO3, FAST.T, Math.sqrt(FAST.share));
  return { s, f, u: s.u + f.u, v: s.v + f.v, w: s.w + f.w };
}

/** Пориви на dur секунд від start (або випадкового): t → {u — вздовж вітру, v — поперек праворуч, w — вгору}. */
export function gustSeries(g, rnd, dur, start = null, step = 0.05) {
  const N = gaussian(rnd);
  let cur = start || gustStart(g, N);
  const pts = [cur];
  for (let t = 0; t < dur; t += step) pts.push(cur = gustStep(g, cur, step, N));
  return (t) => {
    const f = Math.min(pts.length - 1.001, Math.max(0, t / step));
    const i = Math.floor(f), k = f - i, a = pts[i], b = pts[i + 1];
    return { u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k, w: a.w + (b.w - a.w) * k };
  };
}

/* --- політ --- */

/**
 * Політ від скиду до землі.
 * s: { height, speed, delay, tempC, elevation, pressure? } + вітер (див. meanWind), m: { mass, diameter (мм), cd }.
 * gust — пориви t → {u, v, w} (gustSeries): u вздовж середнього вітру на висоті скиду, v — поперек.
 */
export function simulate(s, m, { dt = 0.002, track = false, gust = null } = {}) {
  const rho = airDensity(s.tempC, s.elevation, s.pressure);
  const k = dragK(m, rho);
  const H = s.height;
  const mean = meanWind(s);
  // Осі поривів — за напрямом середнього вітру на висоті скиду; у штиль — від носа
  const m0 = mean(H), m0s = Math.hypot(m0.x, m0.y);
  const ax = m0s > 1e-6 ? m0.x / m0s : 1, ay = m0s > 1e-6 ? m0.y / m0s : 0;

  const deriv = (st, t) => {
    const a = mean(Math.max(st[2], 0));
    let wx = a.x, wy = a.y, wz = 0;
    if (gust) {
      const g = gust(t);
      wx += ax * g.u - ay * g.v;
      wy += ay * g.u + ax * g.v;
      wz = g.w;
    }
    const rx = st[3] - wx, ry = st[4] - wy, rz = st[5] - wz;
    const kv = k * Math.hypot(rx, ry, rz);
    return [st[3], st[4], st[5], -kv * rx, -kv * ry, -G - kv * rz];
  };
  const add = (a, b, h) => a.map((v, i) => v + b[i] * h);

  // Затримка механізму скиду: дрон за цей час пролітає вперед
  let st = [(s.speed || 0) * (s.delay || 0), 0, H, s.speed || 0, 0, 0];
  let t = 0;
  const path = track ? [[st[0], st[1], st[2], 0]] : null;
  while (st[2] > 0 && t < 600) {
    const k1 = deriv(st, t);
    const k2 = deriv(add(st, k1, dt / 2), t + dt / 2);
    const k3 = deriv(add(st, k2, dt / 2), t + dt / 2);
    const k4 = deriv(add(st, k3, dt), t + dt);
    const next = st.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if (next[2] <= 0) {
      // Точка торкання — лінійно між кроками
      const q = st[2] / (st[2] - next[2]);
      st = st.map((v, i) => v + (next[i] - v) * q);
      t += dt * q;
      st[2] = 0;
    } else {
      st = next;
      t += dt;
    }
    if (track) path.push([st[0], st[1], st[2], t]);
  }
  const v = Math.hypot(st[3], st[4], st[5]);
  return {
    time: t,
    x: st[0],
    y: st[1],
    impactSpeed: v,
    // Кут від вертикалі в момент удару
    impactAngle: Math.atan2(Math.hypot(st[3], st[4]), -st[5]) * 180 / Math.PI,
    rho,
    vt: terminalVelocity(m, rho),
    path,
  };
}

/** Розклад промаху: окремо віднесення від руху дрона і знесення вітром. */
export function solve(s, m, opts) {
  const full = simulate(s, m, { track: true, ...opts });
  const calm = simulate({ ...s, wind: 0, levels: null }, m, opts);
  return {
    ...full,
    carry: { x: calm.x, y: calm.y },
    drift: { x: full.x - calm.x, y: full.y - calm.y },
  };
}

/**
 * Розкид від поривів: n скидів з різними поривами (з однаковим seed — ті самі числа щоразу).
 * Повертає середню точку, радіуси кіл, у які падає 50 % і 90 % скидів, і еліпс розкиду (півосі 1σ, кут від осі x).
 */
export function scatter(s, m, { n = 100, seed = 7, dt = 0.01 } = {}) {
  const g = gustStats(s);
  const base = simulate(s, m, { dt });
  if (!(g.su > 0.01)) return { g, mx: base.x, my: base.y, r50: 0, r90: 0, ell: { a: 0, b: 0, ang: 0 }, pts: [] };
  const rnd = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const r = simulate(s, m, { dt, gust: gustSeries(g, rnd, base.time * 1.5 + 2) });
    pts.push([r.x, r.y]);
  }
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const d = pts.map(([x, y]) => Math.hypot(x - mx, y - my)).sort((a, b) => a - b);
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  sxx /= n; syy /= n; sxy /= n;
  // Власні числа коваріації — квадрати півосей еліпса
  const tr = (sxx + syy) / 2, det = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  return {
    g, mx, my, pts,
    r50: d[Math.floor(n * 0.5)], r90: d[Math.floor(n * 0.9)],
    ell: { a: Math.sqrt(tr + det), b: Math.sqrt(Math.max(0, tr - det)), ang: 0.5 * Math.atan2(2 * sxy, sxx - syy) },
  };
}
