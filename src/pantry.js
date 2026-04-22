// Pantry state + "cook what I have" recipe matching.
// Pure data layer. Reuses ingredient-parser for recipe -> slug extraction.
//
// Storage key: pantry_v1
// Shape: { version: 1, items: [ { slug, displayName, addedAt, low, expiresAt } ] }

import { parseIngredients } from './ingredient-parser.js';

const KEY = 'pantry_v1';
const VERSION = 1;

const makeEmpty = () => ({ version: VERSION, items: [] });

function readRaw(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return makeEmpty();
  try {
    const raw = store.getItem(KEY);
    if (!raw) return makeEmpty();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return makeEmpty();
    return { version: parsed.version || VERSION, items: parsed.items };
  } catch {
    return makeEmpty();
  }
}

function writeRaw(state, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(state));
  } catch { /* quota */ }
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const slug = typeof raw.slug === 'string' ? raw.slug.toLowerCase().trim() : '';
  if (!slug) return null;
  return {
    slug,
    displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : slug,
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString(),
    low: raw.low === true,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
  };
}

// ---- Public API ----

export function loadPantry(storage) {
  const state = readRaw(storage);
  return { version: VERSION, items: state.items.map(normalizeItem).filter(Boolean) };
}

export function savePantry(state, storage) {
  const cleaned = {
    version: VERSION,
    items: (state.items || []).map(normalizeItem).filter(Boolean),
  };
  writeRaw(cleaned, storage);
  return cleaned;
}

export function addItem(state, { slug, displayName = null, low = false, expiresAt = null }) {
  const clean = normalizeItem({ slug, displayName, low, expiresAt });
  if (!clean) return state;
  // Dedupe by slug: if already present, update; else add.
  const existing = state.items.findIndex((i) => i.slug === clean.slug);
  if (existing !== -1) {
    const next = state.items.slice();
    next[existing] = { ...next[existing], ...clean, addedAt: next[existing].addedAt };
    return { ...state, items: next };
  }
  return { ...state, items: [...state.items, clean] };
}

export function removeItem(state, slug) {
  return { ...state, items: state.items.filter((i) => i.slug !== slug) };
}

export function setLow(state, slug, low) {
  return {
    ...state,
    items: state.items.map((i) => (i.slug === slug ? { ...i, low: !!low } : i)),
  };
}

// Add multiple items from a flat list of slugs (used by shopping-list -> pantry).
export function addMany(state, slugs) {
  let s = state;
  for (const slug of slugs) s = addItem(s, { slug });
  return s;
}

// ---- Recipe matching ----
// For a recipe, extract the set of ingredient slugs and compute
// { matched, total, coverage, missing }.
// coverage = matched / total (0 if total=0).

export function recipeCoverage(recipe, pantrySet) {
  if (!recipe || typeof recipe.ingredients !== 'string') {
    return { matched: 0, total: 0, coverage: 0, missing: [] };
  }
  const parsed = parseIngredients(recipe.ingredients);
  const slugs = parsed.map((p) => p.slug).filter(Boolean);
  if (!slugs.length) return { matched: 0, total: 0, coverage: 0, missing: [] };
  let matched = 0;
  const missing = [];
  // Dedupe at the recipe level so "1 onion" + "2 onions" don't count twice.
  const unique = [...new Set(slugs)];
  for (const slug of unique) {
    if (pantrySet.has(slug)) matched += 1;
    else missing.push(slug);
  }
  return {
    matched,
    total: unique.length,
    coverage: matched / unique.length,
    missing,
  };
}

// Filter + sort a list of recipes by pantry coverage descending.
// Returns: Array<{ recipe, ...coverageInfo }>
export function rankRecipesByCoverage(recipes, pantry) {
  const slugSet = new Set((pantry?.items || []).map((i) => i.slug));
  return recipes
    .map((r) => ({ recipe: r, ...recipeCoverage(r, slugSet) }))
    .sort((a, b) => {
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      return b.matched - a.matched;
    });
}

// Convenience: show only recipes above a threshold (e.g. 0.7).
export function recipesICanCook(recipes, pantry, threshold = 1) {
  const ranked = rankRecipesByCoverage(recipes, pantry);
  return ranked.filter((r) => r.coverage >= threshold);
}

// Items flagged "low" that have been low for >=30 days (stale).
export function stalePantryItems(state, nowIso = null) {
  const now = nowIso ? new Date(nowIso) : new Date();
  return (state.items || []).filter((i) => {
    if (!i.addedAt) return false;
    const added = new Date(i.addedAt);
    const days = (now - added) / (1000 * 60 * 60 * 24);
    return days >= 30;
  });
}
