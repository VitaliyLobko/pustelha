// Перевірка моделі падіння: node dev/ballistics-test.mjs
import {
  simulate, solve, airDensity, terminalVelocity, G, meanWind, levelWind, gustStats, gustSeries, scatter, mulberry32,
} from '../js/ballistics.js';

let fail = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
  if (!ok) fail++;
};
const air = { tempC: 15, elevation: 0 };
const kg1 = { mass: 1, diameter: 80, cd: 0.5 };

// 1. Без опору — вакуум: t = √(2h/g), винос = швидкість × t
{
  const r = simulate({ ...air, height: 100, speed: 12, wind: 0 }, { ...kg1, cd: 0 });
  const t = Math.sqrt(200 / G);
  check('вакуум: час', Math.abs(r.time - t) < 1e-6, `${r.time.toFixed(6)} vs ${t.toFixed(6)}`);
  check('вакуум: винос', Math.abs(r.x - 12 * t) < 1e-5, `${r.x.toFixed(5)} vs ${(12 * t).toFixed(5)}`);
}

// 2. Довге падіння виходить на встановлену швидкість √(2mg/(ρ·Cd·A))
{
  const rho = airDensity(15, 0);
  const vt = Math.sqrt(2 * 1 * G / (rho * 0.5 * Math.PI * 0.08 ** 2 / 4));
  const r = simulate({ ...air, height: 5000, speed: 0, wind: 0 }, kg1);
  check('встановлена швидкість', Math.abs(r.impactSpeed - vt) < 0.01 && Math.abs(terminalVelocity(kg1, rho) - vt) < 1e-9,
    `${r.impactSpeed.toFixed(3)} vs ${vt.toFixed(3)} м/с, ρ=${rho.toFixed(4)}`);
}

// 3. Тільки вітер, зависання: знесення менше вітер × t і росте швидше за висоту
{
  const d = (h) => simulate({ ...air, height: h, speed: 0, wind: 5, clock: 9 }, kg1);
  const r50 = d(50), r100 = d(100), r200 = d(200);
  check('знесення < вітер × t', Math.abs(r100.y) < 5 * r100.time, `${r100.y.toFixed(3)} м, вітер×t ${(5 * r100.time).toFixed(1)}`);
  check('знесення за вітром (з лівого борту → праворуч)', r100.y > 0 && Math.abs(r100.x) < 1e-9);
  check('росте понадлінійно', r100.y / r50.y > 2 && r200.y / r100.y > 2,
    `50 м ${r50.y.toFixed(2)}, 100 м ${r100.y.toFixed(2)}, 200 м ${r200.y.toFixed(2)}`);
}

// 4. Крок інтегрування не впливає: 1 мс і 5 мс — до сантиметра
{
  const s = { ...air, height: 150, speed: 10, wind: 7, clock: 2 };
  const a = simulate(s, kg1, { dt: 0.001 }), b = simulate(s, kg1, { dt: 0.005 });
  const dx = Math.hypot(a.x - b.x, a.y - b.y);
  check('крок 1 мс vs 5 мс', dx < 0.01, `${(dx * 100).toFixed(3)} см`);
}

// 5. Вітер в лоб зменшує винос, у спину — збільшує; розклад сходиться
{
  const s = { ...air, height: 100, speed: 10, wind: 5 };
  const head = solve({ ...s, clock: 12 }, kg1), tail = solve({ ...s, clock: 6 }, kg1);
  check('лоб < спина', head.x < tail.x, `${head.x.toFixed(2)} < ${tail.x.toFixed(2)}`);
  check('розклад: carry + drift = точка', Math.abs(head.carry.x + head.drift.x - head.x) < 1e-12);
}

// 6. Лог-профіль: вітер заданий на висоті скиду — зносить менше за однаковий; ліс (z0 = 1) — ще менше за поле
{
  const s = { ...air, height: 100, speed: 0, wind: 5, clock: 3 };
  const flat = simulate(s, kg1), field = simulate({ ...s, z0: 0.03 }, kg1), forest = simulate({ ...s, z0: 1 }, kg1);
  check('профіль < однаковий', Math.abs(field.y) < Math.abs(flat.y), `${field.y.toFixed(2)} vs ${flat.y.toFixed(2)}`);
  check('ліс < поле', Math.abs(forest.y) < Math.abs(field.y), `${forest.y.toFixed(2)} vs ${field.y.toFixed(2)}`);
  const w = meanWind({ ...s, z0: 0.03 });
  check('на висоті заміру — заданий вітер', Math.abs(Math.hypot(w(100).x, w(100).y) - 5) < 1e-9);
}

// 8. Прогноз по рівнях: на рівні — його значення, вітер з курсу носа — в лоб, між рівнями — між значеннями
{
  const levels = [{ z: 10, speed: 2, dir: 300 }, { z: 80, speed: 4, dir: 310 }, { z: 120, speed: 5, dir: 314 }];
  const a = levelWind(levels, 80);
  check('рівень 80 м', Math.abs(a.speed - 4) < 1e-9 && Math.abs(a.dir - 310) < 1e-9, `${a.speed} м/с з ${a.dir}°`);
  const mid = levelWind(levels, 100);
  check('між рівнями', mid.speed > 4 && mid.speed < 5 && mid.dir > 310 && mid.dir < 314, `${mid.speed.toFixed(2)} з ${mid.dir.toFixed(1)}°`);
  const w = meanWind({ height: 80, levels, heading: 310 })(80);
  check('ніс на вітер — повітря назад', Math.abs(w.x + 4) < 1e-9 && Math.abs(w.y) < 1e-9, `x ${w.x.toFixed(3)}, y ${w.y.toFixed(3)}`);
  const r = levelWind([{ z: 10, speed: 3, dir: 350 }, { z: 80, speed: 3, dir: 10 }], Math.sqrt(800));
  check('поворот через північ без стрибка', r.dir > 355 || r.dir < 5, `${r.dir.toFixed(1)}°`);
}

// 9. Пориви: без них розкиду немає; сильніші — більший розкид; той самий seed — ті самі числа
{
  const s = { ...air, height: 100, speed: 0, wind: 5, clock: 3, z0: 0.03 };
  const none = scatter({ ...s, gusty: 0 }, kg1, { n: 40 });
  const mid = scatter(s, kg1, { n: 80 }), strong = scatter({ ...s, gusty: 1.5 }, kg1, { n: 80 });
  check('без поривів — без розкиду', none.r90 === 0);
  check('сильніші пориви — більший розкид', strong.r50 > mid.r50 && mid.r50 > 0, `R50 ${mid.r50.toFixed(2)} → ${strong.r50.toFixed(2)} м`);
  check('повторюваність', scatter(s, kg1, { n: 80 }).r50 === mid.r50);
  const g = gustStats(s);
  check('порив ≈ середній + 3σ', Math.abs(g.peak - (5 + 3 * g.su)) < 1e-9 && g.su > 0.4 && g.su < 0.8, `σ ${g.su.toFixed(2)}, до ${g.peak.toFixed(1)} м/с`);
  const series = gustSeries({ ...g, T: 5 }, mulberry32(1), 400);
  let sum = 0, sq = 0;
  for (let t = 0; t < 400; t += 0.5) { const u = series(t).u; sum += u; sq += u * u; }
  const sd = Math.sqrt(sq / 800 - (sum / 800) ** 2);
  check('σ ряду поривів', Math.abs(sd - g.su) / g.su < 0.25, `${sd.toFixed(2)} vs ${g.su.toFixed(2)}`);
}

// 10. Густина з тиску: 1013,25 гПа і 15 °C — як на рівні моря
check('густина з тиску', Math.abs(airDensity(15, 999, 1013.25) - airDensity(15, 0)) < 1e-9);

// 7. Затримка скиду додає швидкість × затримку
{
  const s = { ...air, height: 80, speed: 15, wind: 0 };
  const a = simulate(s, kg1), b = simulate({ ...s, delay: 0.2 }, kg1);
  check('затримка 0,2 с при 15 м/с = +3 м', Math.abs(b.x - a.x - 3) < 1e-9);
}

console.log(fail ? `\n${fail} перевірок не пройшло` : '\nусе пройшло');
process.exit(fail ? 1 : 0);
