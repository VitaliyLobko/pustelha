// Пошук населеного пункту за назвою — Nominatim (OpenStreetMap). Лише на вимогу: правила сервісу забороняють
// підказки на кожну літеру й більше запиту на секунду.
const API = 'https://nominatim.openstreetmap.org/search';
let last = 0;

/** Назва з області й району — щоб відрізнити однойменні села. */
function label(r) {
  const a = r.address || {};
  const where = [a.district || a.county, a.state].filter(Boolean).join(', ');
  return { name: r.name || r.display_name.split(',')[0], where };
}

/** До 8 населених пунктів України: [{name, where, lat, lon}]. */
export async function findPlaces(q) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const params = new URLSearchParams({
    q, format: 'jsonv2', countrycodes: 'ua', featureType: 'settlement', 'accept-language': 'uk', addressdetails: 1, limit: 8,
  });
  const res = await fetch(`${API}?${params}`, { referrerPolicy: 'strict-origin-when-cross-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).map((r) => ({ ...label(r), lat: Number(r.lat), lon: Number(r.lon) }));
}
