// Field-level schema validator for imported recipes. Whitelist approach:
// unknown fields are dropped, known fields are coerced to their expected
// type, `name` is required. Pure function — no DOM, no side effects.
//
// This is a defense-in-depth layer. The render pipeline already escapes
// every field via `escapeHtml` (see src/recipe-lib.js), so a malformed
// recipe cannot execute JS. This validator exists to stop obviously
// broken or oversized imports from silently corrupting local state.

import { safeUrl, splitTagLabels } from './recipe-lib.js';

const MAX_FIELD_LEN = 100_000; // 100 KB per text field — forgiving but bounded
const MAX_RECIPES = 10_000;    // reject imports that would blow up the grid

const toStr = (v) => {
  if (v == null) return '';
  const s = String(v);
  return s.length > MAX_FIELD_LEN ? s.slice(0, MAX_FIELD_LEN) : s;
};

const toId = (v) => {
  // Accept string or number; coerce to string so equality checks stay simple.
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v).slice(0, 200);
};

const toRating = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 5) return 5;
  return Math.round(n);
};

export const validateRecipe = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const name = toStr(raw.name).trim();
  if (!name) return null; // name is the one hard requirement

  return {
    id: toId(raw.id),
    name,
    cuisine: toStr(raw.cuisine).trim(),
    source: toStr(raw.source).trim(),
    location: toStr(raw.location).trim(),
    ingredients: toStr(raw.ingredients),
    instructions: toStr(raw.instructions),
    preptime: toStr(raw.preptime).trim(),
    cooktime: toStr(raw.cooktime).trim(),
    servings: toStr(raw.servings).trim(),
    tags: splitTagLabels(raw.tags),
    notes: toStr(raw.notes),
    url: safeUrl(raw.url),
    image: safeUrl(raw.image),
    date: toStr(raw.date).trim(),
    rating: toRating(raw.rating),
  };
};

export const validateImport = (payload) => {
  if (payload == null) {
    return { ok: false, error: 'file is empty' };
  }

  let incoming;
  if (Array.isArray(payload)) {
    incoming = payload;
  } else if (typeof payload === 'object' && Array.isArray(payload.recipes)) {
    incoming = payload.recipes;
  } else {
    return { ok: false, error: 'not a recipe journal export (expected an array or {recipes: [...]})' };
  }

  if (incoming.length > MAX_RECIPES) {
    return { ok: false, error: `too many recipes (${incoming.length} > ${MAX_RECIPES} max)` };
  }

  const recipes = [];
  let dropped = 0;
  for (const raw of incoming) {
    const valid = validateRecipe(raw);
    if (valid) recipes.push(valid);
    else dropped++;
  }

  return { ok: true, recipes, dropped, total: incoming.length };
};
