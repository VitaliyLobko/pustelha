// Перевірка координат і сітки-приманки: node dev/forecast-test.mjs
import { parseCoords, coarse, decoyGrid } from '../js/forecast.js';

let fail = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
  if (!ok) fail++;
};
const near = (p, lat, lon) => p && Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lon - lon) < 1e-6;

check('цифри з Google Maps', near(parseCoords('48.51234, 37.98765'), 48.51234, 37.98765));
check('посилання @', near(parseCoords('https://www.google.com/maps/@48.5,37.9,14z'), 48.5, 37.9));
check('посилання q=', near(parseCoords('https://maps.google.com/?q=48.51,37.98'), 48.51, 37.98));
check('посилання !3d!4d', near(parseCoords('https://www.google.com/maps/place/X/@48,37,10z/data=!3d48.512!4d37.987'), 48.512, 37.987));
check('кома десяткова', near(parseCoords('48,512; 37,987'), 48.512, 37.987));
check('градуси-хвилини', near(parseCoords('48°30\'36.0"N 37°59\'24.0"E'), 48.51, 37.99));
check('сміття — null', parseCoords('привіт') === null && parseCoords('95.1, 37.2') === null);
check('огрублення до 0,1°', near(coarse({ lat: 48.5671, lon: 37.9349 }), 48.6, 37.9));

// Сітка: точка завжди всередині, у різних клітинках; вузли — на загальній ґратці 0,25°
const p = { lat: 48.6, lon: 37.9 };
const cells = new Set();
let inside = true, lattice = true;
for (let i = 0; i < 200; i++) {
  const g = decoyGrid(p);
  cells.add(`${g.la.cell}:${g.lo.cell}`);
  inside &&= g.la.f >= 0 && g.la.f < 1 && g.lo.f >= 0 && g.lo.f < 1 && g.la.nodes[g.la.cell] <= p.lat && g.lo.nodes[g.lo.cell] <= p.lon;
  lattice &&= [...g.la.nodes, ...g.lo.nodes].every((v) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-9);
}
check('точка всередині своєї клітинки', inside);
check('вузли на ґратці 0,25°', lattice);
check('точка не завжди в центрі', cells.size >= 10, `${cells.size} різних клітинок з 16`);

console.log(fail ? `\n${fail} перевірок не пройшло` : '\nусе пройшло');
process.exit(fail ? 1 : 0);
