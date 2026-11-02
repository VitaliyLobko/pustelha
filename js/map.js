// Діалог вибору місця прогнозу: карта OpenStreetMap / супутник Esri (Leaflet лежить у застосунку), пошук за назвою.
// Місце — клітинка сітки 0,1°, саме вона йде в запит прогнозу.
import { el, read, write, vibrate } from './ui.js';
import { coarse } from './forecast.js';
import { findPlaces } from './places.js';

const LAYER_KEY = 'pustelha:map-layer';
const UA = [[44.3, 22.1], [52.4, 40.2]];
const HINT = 'Тапни на карті місце вильоту або знайди населений пункт — виділиться клітинка ≈ 11 × 7 км.';
const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const LAYERS = {
  map: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: `© ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap')}` }]],
  sat: [['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 18, attribution: 'Супутник © Esri, Maxar, Earthstar Geographics' }],
  ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 18 }]],
};

let leaflet = null;
/** Leaflet — лише при першому відкритті карти. */
const loadLeaflet = () => (leaflet ??= Promise.all([
  new Promise((ok, bad) => document.head.append(el('link', { rel: 'stylesheet', href: './vendor/leaflet.css', onload: ok, onerror: bad }))),
  new Promise((ok, bad) => document.head.append(el('script', { src: './vendor/leaflet.js', onload: ok, onerror: bad }))),
]).then(() => window.L));

const cellText = (c) => `${c.lat.toFixed(1)}, ${c.lon.toFixed(1)} — клітинка ≈ 11 × 7 км`;

/**
 * Відкрити карту. start — {lat, lon} або null (уся Україна); onPick(c, now) — вибрано клітинку c = {lat, lon} (огрублену),
 * now — одразу просити прогноз.
 */
export async function openMap({ start, onPick }) {
  let pick = start ? coarse(start) : null;
  const box = el('div', { class: 'map-box' });
  const q = el('input', { type: 'search', class: 'map-q', placeholder: 'Місто чи село', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const list = el('ul', { class: 'place-list map-list', hidden: true });
  const cap = el('p', { class: 'map-cap' }, pick ? cellText(pick) : HINT);
  const take = el('button', { type: 'button', class: 'btn primary', disabled: !pick }, 'Прогноз тут');
  const seg = el('div', { class: 'seg map-layers', role: 'group', 'aria-label': 'Підкладка' });
  const dlg = el('dialog', { class: 'map-dlg', 'aria-label': 'Вибір місця на карті' },
    el('form', { class: 'map-top', onsubmit: (e) => { e.preventDefault(); search(); } },
      q, el('button', { type: 'submit', class: 'btn' }, 'Знайти'),
      el('button', { type: 'button', class: 'btn map-x', 'aria-label': 'Закрити', onclick: () => dlg.close() }, '✕')),
    list,
    el('div', { class: 'map-wrap' }, box, seg),
    el('div', { class: 'map-bot' }, cap, el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Скасувати'), take)));
  take.addEventListener('click', () => { dlg.close(); onPick(pick, true); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  let L;
  try {
    L = await loadLeaflet();
  } catch {
    leaflet = null;
    cap.textContent = 'Карта не відкрилась. Назву чи координати можна ввести в поле місця.';
    return;
  }
  const map = L.map(box, { zoomControl: false, attributionControl: false });
  L.control.attribution({ prefix: false }).addTo(map);
  if (start) map.setView([pick.lat, pick.lon], 11);
  else map.fitBounds(UA);

  // Підкладка: карта чи супутник із підписами; вибір пам'ятаємо
  let layer = LAYERS[read(LAYER_KEY, 'map')] ? read(LAYER_KEY, 'map') : 'map';
  let tiles = [];
  const showLayer = (k) => {
    layer = k;
    write(LAYER_KEY, k);
    tiles.forEach((t) => t.remove());
    tiles = LAYERS[k].map(([url, o]) => L.tileLayer(url, o).addTo(map));
    tiles[0].once('tileerror', () => { if (!navigator.onLine) cap.textContent = 'Немає мережі — карта не вантажиться. Назву чи координати можна ввести в поле місця.'; });
    seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.k === k); b.setAttribute('aria-pressed', String(b.dataset.k === k)); });
  };
  seg.append(...[['map', 'Мапа'], ['sat', 'Супутник']].map(([k, t]) =>
    el('button', { type: 'button', 'data-k': k, onclick: () => showLayer(k) }, t)));
  showLayer(layer);

  const cell = L.rectangle([[0, 0], [0, 0]], { color: '#ffb020', weight: 2, fillOpacity: 0.18, interactive: false });
  function choose(c, name) {
    pick = coarse(c);
    cell.setBounds([[pick.lat - 0.05, pick.lon - 0.05], [pick.lat + 0.05, pick.lon + 0.05]]).addTo(map);
    cap.textContent = name ? `${name} · ${cellText(pick)}` : cellText(pick);
    take.disabled = false;
    vibrate(8);
  }
  if (pick) choose(pick);
  map.on('click', (e) => { list.hidden = true; choose({ lat: e.latlng.lat, lon: e.latlng.lng }); });

  async function search() {
    const text = q.value.trim();
    if (!text) return;
    q.blur();
    list.hidden = false;
    list.replaceChildren(el('li', { class: 'muted' }, 'Шукаю…'));
    try {
      const hits = await findPlaces(text);
      list.replaceChildren(...(hits.length ? hits.map((p) => el('li', {}, el('button', { type: 'button', onclick: () => {
        list.hidden = true;
        map.setView([p.lat, p.lon], 12);
        choose(p, p.name);
      } }, p.name, el('span', {}, p.where)))) : [el('li', { class: 'muted' }, `«${text}» не знайшов. Спробуй інакше написати.`)]));
    } catch {
      list.replaceChildren(el('li', { class: 'muted' }, navigator.onLine ? 'Пошук не відповів. Спробуй ще раз.' : 'Немає мережі — пошук не працює.'));
    }
  }
}
