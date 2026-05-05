// SEC EDGAR scraper — fetches recent filings from publicly-traded retailers
// and surfaces any mention of Nashville / Tennessee / Middle Tennessee.
//
// SEC's free public API: https://www.sec.gov/edgar/sec-api-documentation
// Requirement: User-Agent header with contact email. Set via SEC_USER_AGENT env var.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// Companies whose expansion patterns matter for Nashville real estate.
// CIK = SEC's central index key. Look up at https://www.sec.gov/cgi-bin/browse-edgar
const TRACKED_COMPANIES = [
  { name: 'Walmart',          cik: '0000104169' },
  { name: 'Costco',           cik: '0000909832' },
  { name: 'Dollar General',   cik: '0000029534' },
  { name: 'Dollar Tree',      cik: '0000935703' },
  { name: 'Target',           cik: '0000027419' },
  { name: 'Kroger',           cik: '0000056873' },
  { name: 'Home Depot',       cik: '0000354950' },
  { name: 'Lowes',            cik: '0000060667' },
  { name: 'McDonalds',        cik: '0000063908' },
  { name: 'Starbucks',        cik: '0000829224' },
  { name: 'Chipotle',         cik: '0001058090' },
  { name: 'Wendys',           cik: '0000030697' },
  { name: 'Yum Brands',       cik: '0001041061' },
  { name: 'Restaurant Brands',cik: '0001618756' },
  { name: 'Dominos',          cik: '0001286681' },
  { name: 'CVS Health',       cik: '0000064803' },
  { name: 'Walgreens',        cik: '0001618921' },
  { name: 'AutoZone',         cik: '0000866787' },
  { name: 'OReilly Auto',     cik: '0000898173' },
  { name: 'Tractor Supply',   cik: '0000916365' },
  { name: 'TJX',              cik: '0000109198' },
  { name: 'Ross Stores',      cik: '0000745732' },
  { name: 'Five Below',       cik: '0001177609' },
  { name: 'Hilton',           cik: '0001585689' },
  { name: 'Marriott',         cik: '0001048286' },
  { name: 'HCA Healthcare',   cik: '0000860730' },
  { name: 'Tenet Healthcare', cik: '0000070318' },
  { name: 'Brookdale Senior', cik: '0001332349' },
  { name: 'Camden Property',  cik: '0000906345' },
  { name: 'Mid-America Apt',  cik: '0000912242' },
  { name: 'AvalonBay',        cik: '0000915912' }
];

const FILING_TYPES = ['10-K', '10-Q', '8-K'];

const KEYWORDS = [
  /nashville/i,
  /\bmiddle tennessee\b/i,
  /\bdavidson county\b/i,
  /\bwilliamson county\b/i,
  /\brutherford county\b/i,
  /\bsumner county\b/i,
  /\bwilson county\b/i,
  /\bfranklin,?\s+tn\b/i,
  /\bmurfreesboro\b/i,
  /\bspring hill,?\s+tn\b/i,
  /\bmt\.?\s+juliet\b/i,
  /\bbrentwood,?\s+tn\b/i,
  /\bsmyrna,?\s+tn\b/i,
  /\bgallatin,?\s+tn\b/i,
  /\bhendersonville,?\s+tn\b/i
];

const USER_AGENT = process.env.SEC_USER_AGENT || 'nashville-intel research-tool@example.com';

async function secFetch(url) {
  await new Promise(r => setTimeout(r, 200));
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'gzip, deflate'
    }
  });
  if (!res.ok) throw new Error(`SEC ${res.status} for ${url}`);
  return res;
}

async function fetchSubmissions(cik) {
  const padded = cik.padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await secFetch(url);
  return res.json();
}

async function fetchFilingText(cik, accessionNumber, primaryDoc) {
  const accNoDashes = accessionNumber.replace(/-/g, '');
  const cikNoLeading = cik.replace(/^0+/, '');
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNoLeading}/${accNoDashes}/${primaryDoc}`;
  const res = await secFetch(url);
  return res.text();
}

function findSnippets(text, maxSnippets = 3) {
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
  const snippets = [];
  for (const re of KEYWORDS) {
    const m = clean.match(re);
    if (!m) continue;
    const i = m.index;
    const start = Math.max(0, i - 120);
    const end = Math.min(clean.length, i + 180);
    snippets.push({
      keyword: m[0],
      context: '...' + clean.slice(start, end).trim() + '...'
    });
    if (snippets.length >= maxSnippets) break;
  }
  return snippets;
}

async function processCompany(company) {
  console.log(`\nFetching ${company.name} (CIK ${company.cik})...`);
  const submissions = await fetchSubmissions(company.cik);
  const recent = submissions.filings && submissions.filings.recent;
  if (!recent) {
    console.log(`  No filings found`);
    return [];
  }

  const filings = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (!FILING_TYPES.includes(recent.form[i])) continue;
    filings.push({
      form: recent.form[i],
      accession: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      primaryDoc: recent.primaryDocument[i],
      reportDate: (recent.reportDate && recent.reportDate[i]) || null
    });
  }

  filings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  const toScan = filings.slice(0, 3);
  console.log(`  Scanning ${toScan.length} recent filings`);

  const hits = [];
  for (const f of toScan) {
    try {
      const text = await fetchFilingText(company.cik, f.accession, f.primaryDoc);
      const snippets = findSnippets(text);
      if (snippets.length > 0) {
        hits.push({
          company: company.name,
          form: f.form,
          filingDate: f.filingDate,
          reportDate: f.reportDate,
          accession: f.accession,
          filingUrl: `https://www.sec.gov/Archives/edgar/data/${company.cik.replace(/^0+/, '')}/${f.accession.replace(/-/g, '')}/${f.primaryDoc}`,
          snippets
        });
        console.log(`  HIT: ${f.form} ${f.filingDate} - ${snippets.length} mention(s)`);
      }
    } catch (err) {
      console.warn(`  Skip ${f.accession}: ${err.message}`);
    }
  }
  return hits;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  if (!process.env.SEC_USER_AGENT) {
    console.warn('WARNING: SEC_USER_AGENT not set. Set it to "Your Name your-email@example.com"');
  }

  const allHits = [];
  for (const company of TRACKED_COMPANIES) {
    try {
      const hits = await processCompany(company);
      allHits.push(...hits);
    } catch (err) {
      console.warn(`${company.name} failed: ${err.message}`);
    }
  }

  allHits.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

  const date = new Date().toISOString().slice(0, 10);
  const snapshot = {
    fetched_at: new Date().toISOString(),
    source: 'SEC EDGAR',
    keywords: KEYWORDS.map(r => r.toString()),
    companies_tracked: TRACKED_COMPANIES.length,
    hit_count: allHits.length,
    hits: allHits
  };

  const datedPath = path.join(DATA_DIR, `sec-${date}.json`);
  const latestPath = path.join(DATA_DIR, 'sec-latest.json');
  await fs.writeFile(datedPath, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(latestPath, JSON.stringify(snapshot));

  console.log(`\nDone. ${allHits.length} filings mention Nashville/Tennessee.`);
  console.log(`Wrote ${datedPath}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
