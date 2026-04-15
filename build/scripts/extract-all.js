#!/usr/bin/env node
// Bulk-extract recipes from a list of bookmark URLs.
//
// Usage:
//   node scripts/extract-all.js --in bookmarks.json --out public/recipes.json [--limit N] [--concurrency N]
//
// Uses JSON-LD first, falls back to OG meta. No external API.
// Polite: concurrency capped, per-host serial, 15s timeout, 2 retries on network error.
// Resumable: merges with existing output file so re-runs skip already-extracted URLs.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseRecipeHtml, inferCuisine } = require('../api/_lib/parse.js');

function parseArgs(argv) {
  const args = { in: 'bookmarks.json', out: 'public/recipes.json', limit: Infinity, concurrency: 4 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
  }
  return args;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Wayback Machine fallback: ask the availability API for the closest snapshot,
// then fetch its HTML. Used when the origin blocks scraping (e.g. allrecipes).
async function fetchViaWayback(url) {
  // Use the CDX Server API (better than /wayback/available — finds more
  // snapshots and lets us filter to successful HTML captures only). Results
  // come back as a CSV-ish JSON array: first row is the header, rest are data.
  let bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const cdxUrl =
    `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(bare)}` +
    `&output=json&limit=-5&filter=statuscode:200&filter=mimetype:text/html`;
  const cdxRes = await fetchWithTimeout(cdxUrl, 20000);
  let rows;
  try { rows = JSON.parse(cdxRes); } catch { throw new Error('cdx parse failed'); }
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('no wayback snapshot');
  // Walk from newest backward (limit=-5 gave us the last 5) until we find one that fetches.
  const dataRows = rows.slice(1).reverse();
  let lastErr;
  for (const row of dataRows) {
    const [, timestamp, original] = row;
    const snapUrl = `http://web.archive.org/web/${timestamp}id_/${original}`;
    try {
      return await fetchWithTimeout(snapUrl, 25000);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('wayback snapshots all failed');
}

async function extractOne(url, title, folder, addDate) {
  let html = '';
  let lastErr = null;
  let via = 'direct';
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (host) await hostDelay(host);
      html = await fetchWithTimeout(url, 20000);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  // Direct fetch failed — try Wayback as a one-time fallback.
  if (!html && lastErr) {
    try {
      html = await fetchViaWayback(url);
      via = 'wayback';
      lastErr = null;
    } catch (e) {
      lastErr = e;
    }
  }
  const base = {
    id: `bk-${addDate || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    bookmarkTitle: title,
    folder,
    addedAt: addDate ? new Date(addDate * 1000).toISOString() : null,
    status: 'to-try',
    rating: 0,
    notes: '',
    tags: '',
    dateTried: '',
    fetchError: lastErr ? String(lastErr.message || lastErr) : null,
  };
  if (lastErr && !html) {
    // Could not fetch at all — keep a minimal record so the user sees the bookmark.
    return {
      ...base,
      name: title || url,
      description: '',
      image: '',
      author: '',
      sourceSite: (new URL(url)).hostname.replace(/^www\./, ''),
      cuisine: '',
      category: '',
      ingredients: '',
      instructions: '',
      prepTime: '',
      cookTime: '',
      totalTime: '',
      servings: '',
      keywords: '',
      extractedFrom: 'none',
    };
  }
  const parsed = parseRecipeHtml(html, url);
  // Prefer the bookmark's human title if the parser returned something worse.
  if (!parsed.name || parsed.name.length < 3) parsed.name = title || parsed.name;
  // Post-process: infer cuisine from title/desc/keywords when JSON-LD is silent.
  parsed.bookmarkTitle = title;
  const inferred = inferCuisine(parsed);
  if (inferred) parsed.cuisine = inferred;
  parsed.fetchVia = via;
  return { ...base, ...parsed };
}

// Per-host jitter: space requests to the same domain by at least 400-800ms
// to stay under rate limits. Tracked in a shared map across worker invocations.
const hostNextAllowed = new Map();
async function hostDelay(host) {
  const now = Date.now();
  const next = hostNextAllowed.get(host) || 0;
  const wait = Math.max(0, next - now);
  const jitter = 400 + Math.floor(Math.random() * 400);
  hostNextAllowed.set(host, now + wait + jitter);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

// Minimal concurrency pool with per-host serialization so we don't hammer any
// single domain. Tasks carry .host; workers pick only tasks whose host is idle.
async function runPool(tasks, concurrency, onProgress) {
  const busy = new Set();
  const queue = tasks.slice();
  const results = [];
  let done = 0;

  return new Promise((resolve) => {
    const launch = () => {
      if (!queue.length && busy.size === 0) return resolve(results);
      while (busy.size < concurrency) {
        const idx = queue.findIndex(t => !busy.has(t.host));
        if (idx === -1) break;
        const [task] = queue.splice(idx, 1);
        busy.add(task.host);
        task.fn()
          .then(r => { results.push({ ok: true, r, task }); })
          .catch(e => { results.push({ ok: false, e, task }); })
          .finally(() => {
            busy.delete(task.host);
            done++;
            if (onProgress) onProgress(done, tasks.length, task);
            launch();
          });
      }
    };
    launch();
  });
}

(async () => {
  const args = parseArgs(process.argv);
  const bookmarks = JSON.parse(fs.readFileSync(args.in, 'utf8'));

  let existing = [];
  if (fs.existsSync(args.out)) {
    try { existing = JSON.parse(fs.readFileSync(args.out, 'utf8')); } catch { existing = []; }
  }
  const existingByUrl = new Map(existing.map(r => [r.url, r]));

  const todo = bookmarks
    .filter(b => !existingByUrl.has(b.url))
    .slice(0, args.limit);

  console.error(`bookmarks: ${bookmarks.length}  already done: ${existingByUrl.size}  to fetch: ${todo.length}`);
  if (!todo.length) { console.error('nothing to do'); return; }

  const tasks = todo.map(b => {
    let host = '';
    try { host = new URL(b.url).hostname; } catch {}
    return {
      host,
      fn: () => extractOne(b.url, b.title, b.folder, b.addDate),
    };
  });

  const pool = await runPool(tasks, args.concurrency, (done, total, task) => {
    process.stderr.write(`\r[${done}/${total}] ${task.host.slice(0, 40).padEnd(40)}`);
  });
  process.stderr.write('\n');

  const fresh = [];
  const failures = [];
  for (const p of pool) {
    if (p.ok) fresh.push(p.r);
    else failures.push({ host: p.task.host, err: String(p.e && p.e.message || p.e) });
  }

  const all = [...existing, ...fresh];
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(all, null, 2) + '\n');

  // Summary.
  const byExtract = fresh.reduce((a, r) => { a[r.extractedFrom] = (a[r.extractedFrom] || 0) + 1; return a; }, {});
  console.error(`\nnew records: ${fresh.length}`);
  console.error(`extraction source:`, byExtract);
  console.error(`failures: ${failures.length}`);
  if (failures.length) console.error(failures.slice(0, 5));
  console.error(`total in ${args.out}: ${all.length}`);
})().catch(e => { console.error(e); process.exit(1); });
