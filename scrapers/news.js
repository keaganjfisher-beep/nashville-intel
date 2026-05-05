// News scraper — pulls Google News RSS for targeted Nashville real-estate queries.
// Google News aggregates across all major outlets (Tennessean, NBJ, Bisnow, local TV,
// trade press) so we get broad coverage from one source without bot-blocking issues.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// Each query becomes a Google News RSS feed URL.
// Aim: cover geographic + action signals across the middle TN MSA.
const QUERIES = [
  'nashville real estate',
  '"middle tennessee" development',
  'nashville rezoning',
  'nashville multifamily',
  'nashville apartments development',
  '"spring hill" tennessee development',
  'franklin tn development',
  'murfreesboro development',
  '"mt juliet" tn',
  'nashville expansion store',
  'nashville opens groundbreaking',
  'metro nashville council planning'
];

function googleNewsRSS(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

const SIGNAL_KEYWORDS = [
  /\bnashville\b/i, /\bmiddle tennessee\b/i, /\bdavidson county\b/i,
  /\bwilliamson county\b/i, /\brutherford county\b/i, /\bsumner county\b/i,
  /\bwilson county\b/i, /\bspring hill\b/i, /\bfranklin\b/i, /\bmurfreesboro\b/i,
  /\bsmyrna\b/i, /\bgallatin\b/i, /\bhendersonville\b/i, /\bmt\.?\s+juliet\b/i,
  /\blebanon\b/i, /\bbrentwood\b/i, /\bnolensville\b/i, /\bantioch\b/i, /\bgermantown\b/i
];

const ACTION_KEYWORDS = [
  /\brezoning?\b/i, /\bzoning change\b/i, /\bspecific plan\b/i,
  /\bground[\s-]?breaking\b/i, /\bbreaks ground\b/i, /\bgroundbreaking\b/i,
  /\bopening\b/i, /\bexpansion\b/i, /\bexpands\b/i, /\bnew location\b/i,
  /\bmultifamily\b/i, /\bapartments?\b/i, /\bsubdivision\b/i, /\bmixed[\s-]use\b/i,
  /\bbuild[\s-]to[\s-]rent\b/i, /\bsite plan\b/i, /\bdevelopment\b/i,
  /\bacquired\b/i, /\bacquires\b/i, /\bsells\b/i, /\bsold for\b/i,
  /\bunveils\b/i, /\bplanning commission\b/i, /\bmetro council\b/i
];

async function fetchRSS(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; nashville-intel/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  function extract(content, tag) {
    const m = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return null;
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
  }
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const c = m[1];
    const title = extract(c, 'title') || '';
    const link = extract(c, 'link') || '';
    const pubDate = extract(c, 'pubDate') || '';
    const description = extract(c, 'description') || '';
    // Google News tags source name in <source>
    const source = extract(c, 'source') || 'Google News';
    items.push({ title, link, pubDate, description, source });
  }
  return items;
}

function scoreItem(item) {
  const text = `${item.title} ${item.description}`;
  let geo = 0, action = 0;
  const matched = { geo: [], action: [] };
  for (const re of SIGNAL_KEYWORDS) {
    if (re.test(text)) { geo++; matched.geo.push(re.toString()); }
  }
  for (const re of ACTION_KEYWORDS) {
    if (re.test(text)) { action++; matched.action.push(re.toString()); }
  }
  return { score: geo * 2 + action, geo, action, matched };
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const seen = new Set();
  const allItems = [];

  for (const q of QUERIES) {
    try {
      console.log(`Query: "${q}"`);
      const xml = await fetchRSS(googleNewsRSS(q));
      const items = parseRSS(xml);
      let kept = 0;
      for (const item of items) {
        // Dedupe across queries by link
        const key = (item.link || '').split('?')[0];
        if (!key || seen.has(key)) continue;
        const { score, geo, action, matched } = scoreItem(item);
        if (score === 0 || geo === 0) continue;
        seen.add(key);
        allItems.push({
          source: item.source,
          query: q,
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          score,
          matched_geo: matched.geo,
          matched_action: matched.action,
          excerpt: item.description.slice(0, 280)
        });
        kept++;
      }
      console.log(`  Got ${items.length} items, kept ${kept} relevant`);
      // Throttle a bit between queries
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.warn(`  "${q}" failed: ${err.message}`);
    }
  }

  allItems.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.pubDate || '').localeCompare(a.pubDate || '');
  });

  const date = new Date().toISOString().slice(0, 10);
  const snapshot = {
    fetched_at: new Date().toISOString(),
    source: 'Google News RSS (aggregating Tennessean, NBJ, Bisnow, local TV, trades)',
    queries: QUERIES,
    item_count: allItems.length,
    items: allItems.slice(0, 100)
  };

  const datedPath = path.join(DATA_DIR, `news-${date}.json`);
  const latestPath = path.join(DATA_DIR, 'news-latest.json');
  await fs.writeFile(datedPath, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(latestPath, JSON.stringify(snapshot));

  console.log(`\nDone. ${allItems.length} relevant news items.`);
  console.log(`Wrote ${datedPath}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
