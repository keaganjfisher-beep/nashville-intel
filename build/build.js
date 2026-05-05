// Build step — assembles the deployable site in dist/.
// Reads the latest data snapshots and copies them alongside the HTML.
// The HTML reads from ./data/*.json at runtime, so the structure stays simple.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_DATA_DIR = path.join(DIST_DIR, 'data');

async function safeRead(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return null; }
}

async function main() {
  console.log('Building dist/...');
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.mkdir(DIST_DATA_DIR, { recursive: true });

  const html = await fs.readFile(path.join(PUBLIC_DIR, 'prototype.html'), 'utf8');
  await fs.writeFile(path.join(DIST_DIR, 'index.html'), html);
  console.log('  ✓ index.html');

  const datasets = [
    'amenities-latest.json',
    'signals-latest.json',
    'sec-latest.json',
    'news-latest.json'
  ];
  for (const f of datasets) {
    const data = await safeRead(path.join(DATA_DIR, f));
    if (data) {
      await fs.writeFile(path.join(DIST_DATA_DIR, f), JSON.stringify(data));
      console.log(`  ✓ ${f}`);
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
