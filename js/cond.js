// Умови скиду — одні на «Розрахунок» і тренажер: задаються в «Розрахунку», тренажер літає в них же.
import { read, write } from './ui.js';
import { windSpec } from './wind.js';
import { fcSlot } from './forecast.js';

const KEY = 'pustelha:calc';
const DEFAULTS = {
  height: 100, speed: 0, delay: 0, wind: 4, clock: 3, tempC: 15, elevation: 150, load: 'c1',
  src: 'hand', ref: 'drone', terrain: 'open', gusts: 'mid', heading: 0, meas: 0, measAt: 'drone', pos: '', fcHour: 0,
};

export const cond = { ...DEFAULTS, ...read(KEY, {}) };
export const saveCond = () => write(KEY, cond);
/** Вітер з прогнозу — лише коли його вибрано і він є. */
export const fcUsed = (fc) => cond.src === 'fc' && !!fc;

/** Параметри для simulate; speed — лише в «Розрахунку», у тренажері дрон висить. */
export const condParams = (fc, { height = cond.height, speed = cond.speed } = {}) => ({
  height,
  speed,
  delay: cond.delay,
  tempC: cond.tempC,
  elevation: cond.elevation,
  ...windSpec(cond, cond.height, fcUsed(fc) ? fcSlot(fc, cond.fcHour) : null),
});
