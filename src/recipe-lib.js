// Pure helpers used by index.html and tests. Single source of truth.
// No DOM, no side effects, no imports — safe to load in Node or the browser.

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

export const normalizeTags = (raw) => {
  const s = String(raw ?? '');
  const seen = new Set();
  return s
    .split(',')
    .map((t) => t.trim().replace(/\s{2,}/g, ' '))
    .filter(Boolean)
    .map((t) => t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .filter((t) => {
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
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
