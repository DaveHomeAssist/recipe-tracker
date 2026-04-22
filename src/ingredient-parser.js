// Ingredient-line parser. Pure function, no DOM, no side effects.
//
// Takes a single free-text ingredient line (e.g. "1 1/2 cups flour, sifted")
// and returns a structured record:
//   { qty, unit, item, slug, modifier, raw }
// Unparsable lines still return a record with item === raw so downstream
// consumers never see null. Target coverage against real recipes: >=85%
// of lines resolve to a non-null slug.

// Unit word list. Keys are normalized (lowercased, no trailing s).
// Values are the canonical unit token used by unit-normalize.js.
const UNIT_MAP = Object.freeze({
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', t: 'tsp',
  tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', T: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  floz: 'floz', 'fl.oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  pint: 'pint', pints: 'pint', pt: 'pint',
  quart: 'quart', quarts: 'quart', qt: 'quart',
  gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  g: 'g', gram: 'g', grams: 'g', gm: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', '#': 'lb',
  clove: 'clove', cloves: 'clove',
  pinch: 'pinch', pinches: 'pinch',
  dash: 'dash', dashes: 'dash',
  slice: 'slice', slices: 'slice',
  can: 'can', cans: 'can',
  pkg: 'pkg', package: 'pkg', packages: 'pkg', pack: 'pkg',
  stick: 'stick', sticks: 'stick',
  bunch: 'bunch', bunches: 'bunch',
  sprig: 'sprig', sprigs: 'sprig',
  handful: 'handful', handfuls: 'handful',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  head: 'head', heads: 'head',
  stalk: 'stalk', stalks: 'stalk',
});

// Unicode vulgar fractions -> decimal.
const VULGAR = Object.freeze({
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
});

// Words that are not actual ingredient items (stop words after quantity+unit).
const STOP_WORDS = new Set(['of', 'a', 'an', 'the']);

// Leading bullets or list markers to strip.
const LEAD_STRIP_RE = /^\s*(?:[-*•·●▪]|\d+[.)])\s+/;

// Extract a leading quantity (integer, decimal, fraction, mixed, vulgar).
// Returns { qty: number|null, rest: string }.
function extractQuantity(s) {
  let rest = s;

  // Vulgar fraction as first non-space character.
  const firstCh = rest.replace(/^\s+/, '')[0];
  if (firstCh && VULGAR[firstCh] != null) {
    const v = VULGAR[firstCh];
    rest = rest.replace(/^\s*./, '').trimStart();
    // Could be "½ cup" or "1 ½ cups"? The leading case first, then check for
    // trailing vulgar after integer below.
    return { qty: v, rest };
  }

  // Range: "2-3 cups" or "2 to 3 cups" -> use lower bound.
  const rangeDash = rest.match(/^\s*(\d+(?:\.\d+)?)\s*[-–—to]+\s*(\d+(?:\.\d+)?)(?=\s|$)/i);
  if (rangeDash) {
    return { qty: parseFloat(rangeDash[1]), rest: rest.slice(rangeDash[0].length).trimStart() };
  }

  // Mixed fraction: "1 1/2 cups" or "1 ½ cups".
  const mixed = rest.match(/^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)(?=\s|$)/);
  if (mixed) {
    const qty = parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);
    return { qty, rest: rest.slice(mixed[0].length).trimStart() };
  }
  const mixedVulgar = rest.match(/^\s*(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])(?=\s|$)/);
  if (mixedVulgar) {
    const qty = parseInt(mixedVulgar[1], 10) + (VULGAR[mixedVulgar[2]] || 0);
    return { qty, rest: rest.slice(mixedVulgar[0].length).trimStart() };
  }

  // Simple fraction.
  const frac = rest.match(/^\s*(\d+)\s*\/\s*(\d+)(?=\s|$)/);
  if (frac) {
    return { qty: parseInt(frac[1], 10) / parseInt(frac[2], 10), rest: rest.slice(frac[0].length).trimStart() };
  }

  // Decimal or integer.
  const num = rest.match(/^\s*(\d+(?:\.\d+)?)(?=\s|$)/);
  if (num) {
    return { qty: parseFloat(num[1]), rest: rest.slice(num[0].length).trimStart() };
  }

  return { qty: null, rest };
}

// Extract a unit token if the first word matches UNIT_MAP.
// Returns { unit: string|null, rest: string }.
function extractUnit(s) {
  // "fl oz" / "fl.oz" -> two-word unit; match before single-word.
  const twoWord = s.match(/^\s*(fl\.?\s*oz|fluid\s+ounces?)\b\.?/i);
  if (twoWord) {
    const key = twoWord[1].toLowerCase().replace(/\s+/g, ' ').replace('.', '');
    return { unit: 'floz', rest: s.slice(twoWord[0].length).trimStart() };
  }
  const m = s.match(/^\s*([A-Za-z]+)\b\.?/);
  if (!m) return { unit: null, rest: s };
  const word = m[1];
  const key = word.toLowerCase();
  // Keep case-sensitive T vs t distinction: big T = tbsp, little t = tsp.
  if (word === 'T') return { unit: 'tbsp', rest: s.slice(m[0].length).trimStart() };
  if (word === 't') return { unit: 'tsp', rest: s.slice(m[0].length).trimStart() };
  if (UNIT_MAP[key] != null) {
    return { unit: UNIT_MAP[key], rest: s.slice(m[0].length).trimStart() };
  }
  return { unit: null, rest: s };
}

// Slug: lowercase, strip punctuation, collapse whitespace, drop trailing
// descriptors after a comma/parenthesis.
function slugify(item) {
  if (!item) return '';
  // Strip everything after first comma or open paren (descriptors like
  // "onion, diced" or "flour (all purpose)").
  let base = item.split(/[(,]/)[0];
  base = base.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop leading stop words.
  const parts = base.split(' ').filter((w) => !STOP_WORDS.has(w));
  return parts.join(' ');
}

// Public API: parse one ingredient line.
export function parseIngredient(line) {
  const raw = typeof line === 'string' ? line : '';
  if (!raw.trim()) {
    return { qty: null, unit: null, item: '', slug: '', modifier: '', raw };
  }

  // Strip leading bullet/list markers.
  let work = raw.replace(LEAD_STRIP_RE, '').trim();

  const q = extractQuantity(work);
  work = q.rest;

  const u = extractUnit(work);
  work = u.rest;

  // Optional "of" after unit.
  work = work.replace(/^\s*of\s+/i, '');

  // Split modifier: everything after a comma or in parentheses is descriptor.
  let item = work;
  let modifier = '';
  const commaIdx = work.indexOf(',');
  const parenIdx = work.indexOf('(');
  let cut = -1;
  if (commaIdx !== -1 && parenIdx !== -1) cut = Math.min(commaIdx, parenIdx);
  else if (commaIdx !== -1) cut = commaIdx;
  else if (parenIdx !== -1) cut = parenIdx;
  if (cut !== -1) {
    item = work.slice(0, cut).trim();
    modifier = work.slice(cut).replace(/^[,(]\s*/, '').replace(/\)\s*$/, '').trim();
  }

  const slug = slugify(item);

  return {
    qty: q.qty,
    unit: u.unit,
    item: item.trim(),
    slug,
    modifier,
    raw,
  };
}

// Parse an entire multi-line ingredients blob. Returns array of parsed records.
export function parseIngredients(text) {
  if (!text || typeof text !== 'string') return [];
  return text.split(/\r?\n/).map((ln) => parseIngredient(ln)).filter((r) => r.raw.trim());
}

// Test-oriented helper: given an array of parsed records, what percentage
// resolved to a non-empty slug?
export function coverageOf(records) {
  if (!Array.isArray(records) || records.length === 0) return 0;
  const hit = records.filter((r) => r && r.slug).length;
  return hit / records.length;
}
