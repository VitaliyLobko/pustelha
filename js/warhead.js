// Бойова частина: тип і маса ВР → радіуси ураження. Закон подібності вибуху: радіус росте як ∛ маси ВР у тротиловому еквіваленті.
import { el, fmt } from './ui.js';

// kill / wound — коефіцієнти при ∛W (м/кг^⅓): суцільне ураження і поранення/контузія живої сили на відкритій місцевості.
// Фугас: ≈ 2∛W — смертельний надлишковий тиск, ≈ 4∛W — контузія. Осколкова: ≈ 20∛W — під ВОГ-17 (≈ 36 г ВР, радіус ≈ 7 м).
// Наближення для тренажера, не довідник: реальний радіус залежить від корпусу, висоти розриву й укриттів.
export const WARHEADS = [
  { id: 'frag', name: 'Осколкова', short: 'оск.', kill: 20, wound: 40 },
  { id: 'he', name: 'Фугасна', short: 'фуг.', kill: 2, wound: 4 },
  { id: 'heat', name: 'Кумулятивна', short: 'кум.', kill: 2, wound: 4 },
];
export const warhead = (load) => WARHEADS.find((w) => w.id === load.type) || WARHEADS[1];

/** Маса ВР: у старих власних вантажах її ще немає — 40 % маси, як у типового фугасу. */
export const charge = (load) => (load.ex > 0 ? load.ex : Math.round(load.mass * 40) / 100);

/** Радіуси за формулою (∛ маси ВР), м — без урахування корпусу. */
export function formulaRadii(load) {
  const w = warhead(load), c = Math.cbrt(charge(load));
  return { kill: w.kill * c, wound: w.wound * c };
}

/** Радіуси від краю цілі, м: задані вручну з даних виробу або за формулою; manual — хоч один заданий. */
export function radii(load) {
  const f = formulaRadii(load);
  const kill = load.kill > 0 ? load.kill : f.kill;
  // Поранення не менше за ураження: інакше червоне коло вилізло б за помаранчеве
  const wound = Math.max(kill, load.wound > 0 ? load.wound : f.wound);
  return { kill, wound, manual: load.kill > 0 || load.wound > 0 };
}

// Що бере ціль: radius — уражає в радіусі; direct — лише пряме влучання; none — не бере зовсім
export const EFFECT = {
  inf: { frag: 'radius', he: 'radius', heat: 'radius' },
  mech: { frag: 'none', he: 'direct', heat: 'direct' },
  armor: { frag: 'none', he: 'none', heat: 'direct' },
  fort: { frag: 'none', he: 'direct', heat: 'direct' },
};
const WHY_NOT = {
  'frag:mech': 'осколки броню не пробивають — потрібна кумулятивна або фугасна',
  'frag:armor': 'осколки танкову броню не беруть — потрібна кумулятивна',
  'he:armor': 'фугас танкову броню не бере — потрібна кумулятивна',
  'frag:fort': 'осколки перекриття не беруть — потрібна фугасна',
};
export const effect = (load, icon) => EFFECT[icon]?.[warhead(load).id] ?? 'direct';
export const whyNot = (load, icon) => WHY_NOT[`${warhead(load).id}:${icon}`] || 'ця БЧ таку ціль не бере';

/** «осколкова · ВР 0,10 кг · ураження 9,3 м, поранення 18,6 м» */
export function describe(load) {
  const r = radii(load);
  return `${warhead(load).name.toLowerCase()} · ВР ${fmt(charge(load), 2)} кг · ураження ${fmt(r.kill)} м, поранення ${fmt(r.wound)} м`;
}

/** Зони кружечками — тими ж кольорами, що кола останнього скиду на кадрі тренажера. */
export function zones(load) {
  const r = radii(load);
  return el('span', { class: 'zones' },
    el('span', { class: 'zone kill' }, `ураження ${fmt(r.kill)} м`),
    el('span', { class: 'zone wound' }, `поранення ${fmt(r.wound)} м`));
}
