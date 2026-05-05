// Amenity scraper — pulls POIs from OpenStreetMap (Overpass API) for middle Tennessee.
// Real, free, public data. Writes a dated JSON snapshot + a "latest" copy.
//
// Categories tracked: grocery, hospital, walk-in clinic, pharmacy, dentist,
// coffee, restaurant, fast food, childcare, gas, auto/tire, bank, convenience.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
];

// south, west, north, east — middle Tennessee bounding box
const BBOX = '35.55,-87.50,36.65,-86.05';

const QUERY = `[out:json][timeout:90];
(
  node["shop"="supermarket"](${BBOX});
  node["shop"="greengrocer"](${BBOX});
  node["amenity"="hospital"](${BBOX});
  node["amenity"="clinic"](${BBOX});
  node["amenity"="doctors"](${BBOX});
  node["amenity"="pharmacy"](${BBOX});
  node["amenity"="dentist"](${BBOX});
  node["amenity"="cafe"](${BBOX});
  node["amenity"="restaurant"](${BBOX});
  node["amenity"="fast_food"](${BBOX});
  node["amenity"="childcare"](${BBOX});
  node["amenity"="kindergarten"](${BBOX});
  node["amenity"="fuel"](${BBOX});
  node["shop"="car_repair"](${BBOX});
  node["shop"="tyres"](${BBOX});
  node["amenity"="bank"](${BBOX});
  node["shop"="convenience"](${BBOX});
  way["shop"="supermarket"](${BBOX});
  way["amenity"="hospital"](${BBOX});
);
out center;`;

const CATEGORIES = [
  { key: 'grocery',     match: t => t.shop === 'supermarket' || t.shop === 'greengrocer' },
  { key: 'hospital',    match: t => t.amenity === 'hospital' },
  { key: 'clinic',      match: t => t.amenity === 'clinic' || t.amenity === 'doctors' },
  { key: 'pharmacy',    match: t => t.amenity === 'pharmacy' },
  { key: 'dentist',     match: t => t.amenity === 'dentist' },
  { key: 'cafe',        match: t => t.amenity === 'cafe' },
  { key: 'restaurant',  match: t => t.amenity === 'restaurant' },
  { key: 'fast_food',   match: t => t.amenity === 'fast_food' },
  { key: 'childcare',   match: t => t.amenity === 'childcare' || t.amenity === 'kindergarten' },
  { key: 'fuel',        match: t => t.amenity === 'fuel' },
  { key: 'auto',        match: t => t.shop === 'car_repair' || t.shop === 'tyres' },
  { key: 'bank',        match: t => t.amenity === 'bank' },
  { key: 'convenience', match: t => t.shop === 'convenience' }
];

function categorize(tags) {
  for (const c of CATEGORIES) if (c.match(tags)) return c.key;
  return null;
}

async function fetchOverpass() {
  let lastErr;
  for (const url of OVERPASS_URLS) {
    try {
      console.log(`Trying ${url}...`);
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(QUERY),
        headers: { 'User-Agent': 'nashville-intel/1.0 (real-estate-research)' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.elements || [];
    } catch (err) {
      console.warn(`Failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Overpass mirrors failed');
}

function elementsToPOIs(elements) {
  const out = [];
  for (const el of elements) {
    const lat = el.lat ?? (el.center && el.center.lat);
    const lng = el.lon ?? (el.center && el.center.lon);
    const tags = el.tags || {};
    const category = categorize(tags);
    if (!category || lat == null || lng == null) continue;
    out.push({
      id: `${el.type}/${el.id}`,
      lat, lng,
      category,
      name: tags.name || tags.brand || tags.operator || null,
      brand: tags.brand || null,
      addr: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ') || null
    });
  }
  return out;
}

function summarize(pois) {
  const counts = {};
  for (const p of pois) counts[p.category] = (counts[p.category] || 0) + 1;
  return counts;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  console.log('Fetching middle Tennessee POIs from OpenStreetMap...');
  const elements = await fetchOverpass();
  console.log(`Got ${elements.length} raw elements`);

  const pois = elementsToPOIs(elements);
  console.log(`Categorized to ${pois.length} POIs`);

  const counts = summarize(pois);
  console.log('Per-category counts:');
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const snapshot = {
    fetched_at: new Date().toISOString(),
    bbox: BBOX,
    source: 'OpenStreetMap via Overpass API',
    counts,
    pois
  };

  const datedPath = path.join(DATA_DIR, `amenities-${date}.json`);
  const latestPath = path.join(DATA_DIR, 'amenities-latest.json');
  await fs.writeFile(datedPath, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(latestPath, JSON.stringify(snapshot));
  console.log(`Wrote ${datedPath}`);
  console.log(`Wrote ${latestPath}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
