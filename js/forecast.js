// Прогноз вітру по висотах (Open-Meteo): запит-приманка на сітку 5×5 точок — сервер не знає, яка з них потрібна.
import { read, write } from './ui.js';

const KEY = 'pustelha:fc';
const POS_KEY = 'pustelha:fc-pos';
const API = 'https://api.open-meteo.com/v1/forecast';
// Крок сітки — чверть градуса (≈ 28 × 18 км): ширше за клітинку моделі прогнозу, точність від цього не страждає
const STEP = 0.25;
const SIDE = 5;
export const LEVELS = [10, 80, 120, 180];

/** Координати з тексту: «48.123, 37.456», посилання Google Maps (@…, q=…, !3d…!4d…), градуси-хвилини-секунди. */
export function parseCoords(text) {
  const t = String(text || '').trim();
  const ok = (lat, lon) => (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null);
  const dms = t.match(/(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([NSПнПд])\S*[\s,]+(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([EWСхЗх])/i);
  if (dms) {
    const deg = (d, m, s, h) => (+d + m / 60 + s / 3600) * (/[SWЗ]|Пд/i.test(h) ? -1 : 1);
    return ok(deg(dms[1], dms[2], dms[3], dms[4]), deg(dms[5], dms[6], dms[7], dms[8]));
  }
  for (const re of [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|query|ll|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/, /(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)/]) {
    const m = t.match(re);
    if (m) return ok(parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.')));
  }
  return null;
}

/** Огрубити до 0,1° (≈ 10 км): на пристрої не лишається точне місце, а прогноз на такій відстані той самий. */
export const coarse = (p) => ({ lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10 });
/** Огрублене місце текстом — завжди з десятими: «38» без крапки parseCoords уже не впізнав би. */
export const posText = (c) => `${c.lat.toFixed(1)}, ${c.lon.toFixed(1)}`;

/**
 * Сітка 5×5 вузлів кроком STEP, прив'язана до загальної ґратки (не до точки), і точка — у випадковій клітинці, не в центрі:
 * з запиту видно лише квадрат ≈ 110 × 70 км. Повертає вузли й де в сітці лежить точка.
 */
export function decoyGrid(p, rnd = Math.random) {
  const axis = (v) => {
    const i = Math.floor(v / STEP);
    const r = Math.floor(rnd() * (SIDE - 1));
    const nodes = Array.from({ length: SIDE }, (_, k) => +((i - r + k) * STEP).toFixed(4));
    return { nodes, cell: r, f: (v - nodes[r]) / STEP };
  };
  return { la: axis(p.lat), lo: axis(p.lon) };
}

// Скільки годин наперед: «зараз» і ще шість — на виліт, що буде згодом
export const AHEAD = 6;
const VARS = ['wind_gusts_10m', 'temperature_2m', 'surface_pressure', ...LEVELS.flatMap((z) => [`wind_speed_${z}m`, `wind_direction_${z}m`])];

/**
 * Прогноз на всю сітку одним запитом: «зараз» і погодинно на AHEAD годин; вітер у точці — білінійно з чотирьох
 * сусідніх вузлів (вектори, не кути). hours[0] — зараз, далі — повні години.
 */
export async function fetchForecast(p) {
  const grid = decoyGrid(p);
  const lats = [], lons = [];
  for (const la of grid.la.nodes) for (const lo of grid.lo.nodes) { lats.push(la); lons.push(lo); }
  // forecast_hours рахує від поточної години, тож +1: перша з них уже почалась і є в «зараз»
  const url = `${API}?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=${VARS.join(',')}`
    + `&hourly=${VARS.join(',')}&forecast_hours=${AHEAD + 1}&wind_speed_unit=ms&timezone=auto`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const all = await res.json();
  if (!Array.isArray(all) || all.length !== SIDE * SIDE) throw new Error('несподівана відповідь');
  const { la, lo } = grid;
  const corners = [[la.cell, lo.cell, (1 - la.f) * (1 - lo.f)], [la.cell + 1, lo.cell, la.f * (1 - lo.f)],
    [la.cell, lo.cell + 1, (1 - la.f) * lo.f], [la.cell + 1, lo.cell + 1, la.f * lo.f]];
  /** Один зріз прогнозу в точці; pick(вузол) → об'єкт зі змінними VARS на потрібний час. */
  const slot = (pick) => {
    const blend = (fn) => corners.reduce((sum, [r, c, w]) => sum + w * fn(pick(all[r * SIDE + c])), 0);
    const levels = LEVELS.map((z) => {
      const e = blend((c) => -c[`wind_speed_${z}m`] * Math.sin(c[`wind_direction_${z}m`] * Math.PI / 180));
      const n = blend((c) => -c[`wind_speed_${z}m`] * Math.cos(c[`wind_direction_${z}m`] * Math.PI / 180));
      return { z, speed: Math.hypot(e, n), dir: (Math.atan2(-e, -n) * 180 / Math.PI + 360) % 360 };
    });
    return {
      time: pick(all[la.cell * SIDE + lo.cell]).time,
      levels,
      gust10: blend((c) => c.wind_gusts_10m),
      tempC: blend((c) => c.temperature_2m),
      pressure: blend((c) => c.surface_pressure),
    };
  };
  const hourly = (k) => (node) => ({ time: node.hourly.time[k], ...Object.fromEntries(VARS.map((v) => [v, node.hourly[v][k]])) });
  const now = slot((node) => node.current);
  const later = Array.from({ length: AHEAD }, (_, i) => slot(hourly(i + 1)))
    .filter((s) => s.levels.every((l) => Number.isFinite(l.speed)));
  return { ...now, fetched: Date.now(), hours: [now, ...later] };
}

/** Прогноз на вибрану годину: 0 — зараз; старий прогноз без погодинного — як є. */
export const fcSlot = (fc, i = 0) => (fc?.hours?.[i] ? { ...fc, ...fc.hours[i] } : fc);

export const loadFc = () => read(KEY, null);
export const saveFc = (fc) => write(KEY, fc);
export const loadPos = () => read(POS_KEY, null);
export const savePos = (p) => write(POS_KEY, p);

/** «12 хв тому»; старше години — прогноз уже не «зараз». */
export function fcAge(fc) {
  const min = Math.round((Date.now() - fc.fetched) / 60000);
  return { min, text: min < 1 ? 'щойно' : min < 60 ? `${min} хв тому` : `${Math.round(min / 60)} год тому`, stale: min > 60 };
}
