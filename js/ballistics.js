// Падіння вантажу з дрона: точкова маса, опір від швидкості відносно повітря, вітер, RK4.
// Осі прив'язані до носа дрона: x — вперед, y — праворуч, z — вгору; висота відраховується від цілі.

export const G = 9.80665;

/** Густина повітря за температурою (°C) і висотою місцевості над морем (м), стандартна атмосфера. */
export function airDensity(tempC = 15, elevation = 0) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * elevation, 5.25588);
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

/**
 * Політ від скиду до землі.
 * s: { height, speed, delay, wind, clock, profile, tempC, elevation }, m: { mass, diameter (мм), cd }.
 * profile — показник степеневого профілю вітру (0 — однаковий на всій висоті, 1/7 — слабшає до землі);
 * wind задано на висоті скиду.
 */
export function simulate(s, m, { dt = 0.002, track = false } = {}) {
  const rho = airDensity(s.tempC, s.elevation);
  const k = dragK(m, rho);
  const air = windVector(s.wind || 0, s.clock ?? 12);
  const H = s.height;
  const alpha = s.profile || 0;
  // Вітер на висоті z: біля самої землі степеневий профіль дає нуль — обрізаємо на півметрі
  const share = (z) => (alpha ? Math.pow(Math.max(z, 0.5) / H, alpha) : 1);

  const deriv = (st) => {
    const f = share(st[2]);
    const rx = st[3] - air.x * f, ry = st[4] - air.y * f, rz = st[5];
    const kv = k * Math.hypot(rx, ry, rz);
    return [st[3], st[4], st[5], -kv * rx, -kv * ry, -G - kv * rz];
  };
  const add = (a, b, h) => a.map((v, i) => v + b[i] * h);

  // Затримка механізму скиду: дрон за цей час пролітає вперед
  let st = [(s.speed || 0) * (s.delay || 0), 0, H, s.speed || 0, 0, 0];
  let t = 0;
  const path = track ? [[st[0], st[1], st[2], 0]] : null;
  while (st[2] > 0 && t < 600) {
    const k1 = deriv(st);
    const k2 = deriv(add(st, k1, dt / 2));
    const k3 = deriv(add(st, k2, dt / 2));
    const k4 = deriv(add(st, k3, dt));
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
  const calm = simulate({ ...s, wind: 0 }, m, opts);
  return {
    ...full,
    carry: { x: calm.x, y: calm.y },
    drift: { x: full.x - calm.x, y: full.y - calm.y },
  };
}
