// Signal compute — diffs this week's snapshot against last week's.
// Surfaces:
//   - NEW POIs (path-of-progress signal: "new Publix in Spring Hill last week")
//   - NEW SEC filings mentioning Nashville/TN
//   - NEW news items above noise threshold
//
// Output: data/signals-latest.json + dated snapshot

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

async function listSnapshots(prefix) {
  const files = await fs.readdir(DATA_DIR);
  return files
    .filter(f => f.startsWith(prefix + '-') && f.endsWith('.json') && !f.includes('latest'))
    .sort();
}

async function readJSON(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

function diffPOIs(prevPOIs, currPOIs) {
  const prevIds = new Set(prevPOIs.map(p => p.id));
  const currIds = new Set(currPOIs.map(p => p.id));
  const added = currPOIs.filter(p => !prevIds.has(p.id));
  const removed = prevPOIs.filter(p => !currIds.has(p.id));
  return { added, removed };
}

function diffFilings(prevHits, currHits) {
  const prevAcc = new Set(prevHits.map(h => h.accession));
  const newHits = currHits.filter(h => !prevAcc.has(h.accession));
  return newHits;
}

function diffNews(prevItems, currItems) {
  const prevLinks = new Set(prevItems.map(i => i.link));
  return currItems.filter(i => !prevLinks.has(i.link));
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  // Find the two most recent snapshots of each type
  const amenitySnaps = await listSnapshots('amenities');
  const secSnaps = await listSnapshots('sec');
  const newsSnaps = await listSnapshots('news');

  const today = new Date().toISOString().slice(0, 10);

  // Amenity diff
  let amenityDiff = { added: [], removed: [], note: 'No prior snapshot — first run.' };
  if (amenitySnaps.length >= 1) {
    const curr = await readJSON(path.join(DATA_DIR, amenitySnaps[amenitySnaps.length - 1]));
    if (amenitySnaps.length >= 2) {
      const prev = await readJSON(path.join(DATA_DIR, amenitySnaps[amenitySnaps.length - 2]));
      const d = diffPOIs(prev.pois, curr.pois);
      amenityDiff = { ...d, note: `Comparing ${amenitySnaps[amenitySnaps.length - 1]} vs ${amenitySnaps[amenitySnaps.length - 2]}` };
    } else {
      amenityDiff.curr_total = curr.pois.length;
    }
  }

  // SEC diff
  let secDiff = { new_filings: [], note: 'No prior snapshot.' };
  if (secSnaps.length >= 1) {
    const curr = await readJSON(path.join(DATA_DIR, secSnaps[secSnaps.length - 1]));
    if (secSnaps.length >= 2) {
      const prev = await readJSON(path.join(DATA_DIR, secSnaps[secSnaps.length - 2]));
      secDiff.new_filings = diffFilings(prev.hits, curr.hits);
    } else {
      secDiff.new_filings = curr.hits;          // first run — everything is "new"
    }
  }

  // News diff
  let newsDiff = { new_items: [], note: 'No prior snapshot.' };
  if (newsSnaps.length >= 1) {
    const curr = await readJSON(path.join(DATA_DIR, newsSnaps[newsSnaps.length - 1]));
    if (newsSnaps.length >= 2) {
      const prev = await readJSON(path.join(DATA_DIR, newsSnaps[newsSnaps.length - 2]));
      newsDiff.new_items = diffNews(prev.items, curr.items);
    } else {
      newsDiff.new_items = curr.items.slice(0, 25);
    }
  }

  // Categorize new POIs (the path-of-progress gold)
  const newByCategory = {};
  for (const p of amenityDiff.added || []) {
    newByCategory[p.category] = (newByCategory[p.category] || 0) + 1;
  }

  // Build the signal feed (the "what changed this week" surface)
  const feed = [];

  for (const p of (amenityDiff.added || [])) {
    feed.push({
      type: 'new_amenity',
      severity: ['hospital', 'grocery', 'clinic'].includes(p.category) ? 'high' : 'medium',
      headline: `New ${p.category}${p.name ? ': ' + p.name : ''}`,
      detail: p.addr || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`,
      lat: p.lat, lng: p.lng,
      category: p.category,
      brand: p.brand
    });
  }
  for (const f of (secDiff.new_filings || [])) {
    feed.push({
      type: 'sec_filing',
      severity: f.form === '8-K' ? 'high' : 'medium',
      headline: `${f.company} filed ${f.form} mentioning Nashville/TN`,
      detail: f.snippets[0]?.context || '',
      filingDate: f.filingDate,
      url: f.filingUrl,
      keyword: f.snippets[0]?.keyword
    });
  }
  for (const n of (newsDiff.new_items || []).slice(0, 30)) {
    feed.push({
      type: 'news',
      severity: n.score >= 5 ? 'high' : 'medium',
      headline: n.title,
      detail: n.excerpt,
      url: n.link,
      source: n.source,
      pubDate: n.pubDate
    });
  }

  // Sort feed: high severity first, then most recent
  feed.sort((a, b) => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  });

  const signals = {
    computed_at: new Date().toISOString(),
    amenity_diff: {
      added_count: (amenityDiff.added || []).length,
      removed_count: (amenityDiff.removed || []).length,
      added_by_category: newByCategory,
      note: amenityDiff.note
    },
    sec_diff: {
      new_filings_count: (secDiff.new_filings || []).length
    },
    news_diff: {
      new_items_count: (newsDiff.new_items || []).length
    },
    feed: feed.slice(0, 50)  // cap for sanity
  };

  const datedPath = path.join(DATA_DIR, `signals-${today}.json`);
  const latestPath = path.join(DATA_DIR, 'signals-latest.json');
  await fs.writeFile(datedPath, JSON.stringify(signals, null, 2));
  await fs.writeFile(latestPath, JSON.stringify(signals));

  console.log('\n=== Signal Summary ===');
  console.log(`New POIs:      ${signals.amenity_diff.added_count}`);
  if (Object.keys(newByCategory).length) {
    console.log('  by category:', newByCategory);
  }
  console.log(`New filings:   ${signals.sec_diff.new_filings_count}`);
  console.log(`New news:      ${signals.news_diff.new_items_count}`);
  console.log(`Feed length:   ${signals.feed.length}`);
  console.log(`Wrote ${datedPath}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
