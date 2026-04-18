// Pure helpers used by index.html and tests. Single source of truth.
// No DOM, no side effects, no imports — safe to load in Node or the browser.

export const TAG_COLOR_PALETTE = [
  '#c9a84c',
  '#8b6f47',
  '#b5651d',
  '#6b8e6b',
  '#a0522d',
  '#708090',
  '#cd853f',
  '#8b4513',
  '#556b2f',
  '#b0866e',
];

const collapseWhitespace = (value) => String(value ?? '').trim().replace(/\s{2,}/g, ' ');
const titleCase = (value) =>
  String(value ?? '').replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[c]));

export const safeUrl = (u) => {
  const s = String(u ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
};

export const cleanTagLabel = (raw) => collapseWhitespace(raw);

export const slugifyTag = (raw) =>
  cleanTagLabel(raw)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

export const splitTagLabels = (raw) => {
  const values = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const seen = new Set();
  return values
    .map((value) => cleanTagLabel(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const normalizeTags = (raw) => splitTagLabels(raw).map((value) => titleCase(value)).join(', ');

export const normalizeTagSlugs = (raw, tagRegistry = {}) => {
  const source = Array.isArray(raw) ? raw : splitTagLabels(raw);
  const seen = new Set();
  return source
    .map((value) => {
      const str = cleanTagLabel(value);
      if (!str) return '';
      if (tagRegistry && tagRegistry[str]?.slug === str) return str;
      return slugifyTag(str);
    })
    .filter((slug) => {
      if (!slug || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });
};

export const humanizeTagSlug = (slug) => titleCase(String(slug ?? '').replace(/-/g, ' '));

export const getTagLabel = (value, tagRegistry = {}) => {
  const cleaned = cleanTagLabel(value);
  if (!cleaned) return '';
  if (tagRegistry && tagRegistry[cleaned]?.label) return tagRegistry[cleaned].label;
  const slug = slugifyTag(cleaned);
  if (tagRegistry && tagRegistry[slug]?.label) return tagRegistry[slug].label;
  return cleaned === slug ? humanizeTagSlug(slug) : cleaned;
};

export const getRecipeTagLabels = (raw, tagRegistry = {}) =>
  normalizeTagSlugs(raw, tagRegistry).map((slug) => getTagLabel(slug, tagRegistry));

export const getRecipeTagText = (raw, tagRegistry = {}) => getRecipeTagLabels(raw, tagRegistry).join(', ');

export const resolveTagColor = (tag, fallbackIndex = 0) => {
  if (tag?.color) return tag.color;
  const stableIndex = Number.isFinite(Number(tag?.colorIndex)) ? Number(tag.colorIndex) : fallbackIndex;
  return TAG_COLOR_PALETTE[stableIndex % TAG_COLOR_PALETTE.length];
};

export const dedupeByUrl = (recipes) => {
  const seen = new Map();
  for (const r of recipes) {
    const key = (r && r.url ? String(r.url).trim().toLowerCase() : '');
    if (!key) { seen.set(Symbol(), r); continue; }
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
};
