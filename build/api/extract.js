// POST /api/extract  { url }  →  Recipe JSON
//
// Stateless recipe-page scraper. Fetches the target URL with a realistic
// browser UA, runs parse.js (JSON-LD first, OG fallback), returns the
// normalized Recipe shape. Falls back to the Wayback Machine on hard fetch
// errors so bot-blocked hosts (allrecipes, foodandwine) still work.
//
// CORS: allows GET from GH Pages; override with ALLOW_ORIGIN env var.

const { parseRecipeHtml, inferCuisine } = require('./_lib/parse.js');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchViaWayback(url) {
  const bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const cdxUrl =
    `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(bare)}` +
    `&output=json&limit=-5&filter=statuscode:200&filter=mimetype:text/html`;
  const cdxRes = await fetchWithTimeout(cdxUrl, 20000);
  let rows;
  try { rows = JSON.parse(cdxRes); } catch { throw new Error('cdx parse failed'); }
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('no wayback snapshot');
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

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  const url = body && body.url;
  if (!url || typeof url !== 'string' || !/^https?:/i.test(url)) {
    return res.status(400).json({ error: 'Missing or invalid url' });
  }

  let html = '';
  let via = 'direct';
  let fetchError = null;
  try {
    html = await fetchWithTimeout(url, 20000);
  } catch (e) {
    try {
      html = await fetchViaWayback(url);
      via = 'wayback';
    } catch (e2) {
      fetchError = String(e2.message || e2);
    }
  }

  if (!html) {
    return res.status(502).json({
      error: 'Could not fetch URL',
      fetchError,
      url,
    });
  }

  const parsed = parseRecipeHtml(html, url);
  const inferred = inferCuisine(parsed);
  if (inferred) parsed.cuisine = inferred;
  parsed.fetchVia = via;
  parsed.addedAt = new Date().toISOString();
  parsed.status = 'to-try';
  parsed.rating = 0;

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(parsed);
};
