// Налаштування вітру, спільні для розрахунку й тренажера: місцевість, пориви, де виміряно, прогноз.
import { levelWind } from './ballistics.js';

// Шорсткість z0, м: що грубша поверхня, то сильніше гальмує вітер біля землі
export const TERRAINS = [['open', 'Поле', 0.03], ['bush', 'Кущі', 0.1], ['rough', 'Посадки, руїни', 0.3], ['forest', 'Ліс, місто', 1]];
// Множник сили поривів: «помірні» — звичайна приземна турбулентність для цієї місцевості
export const GUSTS = [['none', 'Без', 0], ['calm', 'Слабкі', 0.6], ['mid', 'Помірні', 1], ['strong', 'Сильні', 1.5]];
// З прогнозом ті самі множники — відносно його поривів
export const GUSTS_FC = { none: 'Без', calm: 'Слабші', mid: 'Прогноз', strong: 'Сильніші' };
// Де виміряно вітер: дрон показує свій вітер на висоті; 10 м — метеостанції й прогнози; біля землі — анемометр у руці
export const REFS = [['drone', 'На дроні'], ['10', '10 м'], ['2', 'Біля землі']];

export const z0Of = (key) => (TERRAINS.find(([k]) => k === key) || TERRAINS[0])[2];
export const gustyOf = (key) => (GUSTS.find(([k]) => k === key) || GUSTS[2])[2];
const refZ = (key, H) => (key === 'drone' ? H : +key || H);

/**
 * Вітер для simulate. st: { src: 'hand'|'fc', wind, clock, ref, terrain, gusts, heading, meas, measAt };
 * H — висота, на якій дрон зараз (там виміряно «на висоті дрона»); fc — прогноз.
 */
export function windSpec(st, H, fc) {
  const z0 = z0Of(st.terrain), gusty = gustyOf(st.gusts);
  if (st.src === 'fc' && fc) {
    // Місцевість з прогнозом не потрібна: вище 10 м вітер дає модель, пориви — її «пориви до»; нижче 10 м і замір біля землі —
    // як на відкритому місці
    const open = z0Of('open');
    const spec = { levels: fc.levels, heading: st.heading || 0, gust10: fc.gust10, pressure: fc.pressure, tempC: fc.tempC, z0: open, gusty };
    if (st.meas > 0) {
      // Форма профілю — з прогнозу, сила — з заміру на місці
      const f = levelWind(fc.levels, refZ(st.measAt, H), open).speed;
      if (f > 0.1) spec.scale = st.meas / f;
    }
    return spec;
  }
  // Біля землі серед дерев чи посадок замір нічого не каже про вітер над ними — вважаємо, що міряли на відкритому:
  // профіль від 2 м — як над полем, а місцевість лишається для поривів
  const zp = st.ref === '2' ? z0Of('open') : z0;
  return { wind: st.wind, clock: st.clock, refHeight: refZ(st.ref, H), z0, zp, gusty };
}

/** Курс носа, за якого вітер на висоті H дме з години clock: тренажер бере з прогнозу силу й профіль, а напрям — як вибрав. */
export const headingFor = (fc, H, clock, z0) => (levelWind(fc.levels, H, z0).dir - clock * 30 + 720) % 360;

/** Годинник «звідки дме» відносно носа для вітру з напряму dir (°) при курсі heading. */
export const clockOf = (dir, heading) => {
  const c = Math.round((((dir - heading) % 360) + 360) % 360 / 30) % 12;
  return c || 12;
};
