// Smart shopping list aggregator.
// Pure data layer; no DOM. Combines ingredient parser + unit normalizer + aisle map.
//
// Storage key: shopping_list_v1
// Shape: { version: 1, items: [ { slug, displayName, qty, unit, aisle, sources: [recipeId...], checked } ], generatedAt }

import { parseIngredients } from './ingredient-parser.js';
import { sumCompatible, scaleQty, formatQty, dimensionOf } from './unit-normalize.js';

const KEY = 'shopping_list_v1';
const VERSION = 1;

const newEmpty = () => ({ version: VERSION, items: [], generatedAt: null });

function readRaw(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return newEmpty();
  try {
    const raw = store.getItem(KEY);
    if (!raw) return newEmpty();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return newEmpty();
    return {
      version: parsed.version || VERSION,
      items: parsed.items,
      generatedAt: parsed.generatedAt || null,
    };
  } catch {
    return newEmpty();
  }
}

function writeRaw(state, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function loadList(storage) {
  return readRaw(storage);
}

export function saveList(state, storage) {
  writeRaw(state, storage);
  return state;
}

// ---- Core aggregator ----
// Inputs:
//   recipeSources: Array<{ recipe: RecipeObject, servingsFactor: number }>
// The recipe object needs `id` (or fallback index), `ingredients` (string),
// and optionally `servings` (original recipe yield).
// Output: unordered array of aggregated items (slug, qty, unit, aisle, sources, modifiers).

function groupParts(allParts) {
  const bySlug = new Map();
  for (const p of allParts) {
    if (!p.slug) continue;
    if (!bySlug.has(p.slug)) bySlug.set(p.slug, []);
    bySlug.get(p.slug).push(p);
  }
  return bySlug;
}

function aggregateGroup(parts) {
  const unitParts = parts.filter((p) => p.qty != null && p.unit);
  const bareParts = parts.filter((p) => p.qty != null && !p.unit);
  const noQtyParts = parts.filter((p) => p.qty == null);

  // Try to sum quantities with units.
  let merged = null;
  if (unitParts.length) {
    merged = sumCompatible(unitParts.map((p) => ({ qty: p.qty, unit: p.unit })));
  }

  // If sum failed (mixed dimensions), represent as the majority dim.
  if (unitParts.length && !merged) {
    // Group by dimension, pick the larger set.
    const byDim = new Map();
    for (const p of unitParts) {
      const d = dimensionOf(p.unit);
      if (!byDim.has(d)) byDim.set(d, []);
      byDim.get(d).push(p);
    }
    let biggest = null;
    for (const [, arr] of byDim) {
      if (!biggest || arr.length > biggest.length) biggest = arr;
    }
    if (biggest) merged = sumCompatible(biggest.map((p) => ({ qty: p.qty, unit: p.unit })));
  }

  const bareSum = bareParts.reduce((acc, p) => acc + p.qty, 0);

  // Display name: most common item string, or the slug as fallback.
  const nameCount = new Map();
  for (const p of parts) {
    const nm = (p.item || p.slug).trim();
    if (!nm) continue;
    nameCount.set(nm, (nameCount.get(nm) || 0) + 1);
  }
  let displayName = parts[0]?.slug || '';
  let best = 0;
  for (const [nm, c] of nameCount) {
    if (c > best) { best = c; displayName = nm; }
  }

  return {
    slug: parts[0].slug,
    displayName,
    qty: merged ? merged.qty : (bareSum || null),
    unit: merged ? merged.unit : null,
    bareSum: bareSum || null,
    lines: parts.length,
    qtyMissing: noQtyParts.length > 0,
    modifiers: [...new Set(parts.map((p) => p.modifier).filter(Boolean))],
  };
}

// ---- Public API ----

export function generateFromRecipes(recipeSources, aisleMap = {}) {
  const allParts = [];
  for (const source of recipeSources) {
    const recipe = source.recipe || source; // allow bare recipe objects too
    const factor = Number.isFinite(source.servingsFactor) ? source.servingsFactor : 1;
    const recipeId = recipe?.id != null ? String(recipe.id) : '';
    const ingredientsText = typeof recipe?.ingredients === 'string' ? recipe.ingredients : '';
    if (!ingredientsText) continue;
    for (const p of parseIngredients(ingredientsText)) {
      allParts.push({
        ...p,
        qty: scaleQty(p.qty, factor),
        recipeId,
      });
    }
  }

  const grouped = groupParts(allParts);
  const items = [];
  for (const [, parts] of grouped) {
    const agg = aggregateGroup(parts);
    const aisle = aisleMap[agg.slug] || 'Other';
    const sources = [...new Set(parts.map((p) => p.recipeId).filter(Boolean))];
    items.push({
      slug: agg.slug,
      displayName: agg.displayName,
      qty: agg.qty,
      unit: agg.unit,
      bareSum: agg.bareSum,
      aisle,
      sources,
      lines: agg.lines,
      qtyMissing: agg.qtyMissing,
      modifiers: agg.modifiers,
      checked: false,
    });
  }
  // Also capture raw lines that didn't produce a slug (so user sees them).
  const unparsed = allParts.filter((p) => !p.slug && p.raw.trim());
  for (const p of unparsed) {
    items.push({
      slug: `raw:${p.raw.slice(0, 60)}`,
      displayName: p.raw,
      qty: null,
      unit: null,
      bareSum: null,
      aisle: 'Other',
      sources: [p.recipeId].filter(Boolean),
      lines: 1,
      qtyMissing: true,
      modifiers: [],
      checked: false,
    });
  }

  return {
    version: VERSION,
    items,
    generatedAt: new Date().toISOString(),
  };
}

// Merge a freshly-generated list with existing unchecked state.
// Strategy: preserve existing checked items; add new items; existing
// unchecked items not in the new list remain as "leftovers".
export function mergeWithExisting(newList, existing) {
  if (!existing || !Array.isArray(existing.items) || !existing.items.length) return newList;
  const bySlug = new Map(newList.items.map((i) => [i.slug, { ...i }]));
  const leftovers = [];
  for (const old of existing.items) {
    if (bySlug.has(old.slug)) {
      // Preserve checked flag if previously checked.
      if (old.checked) bySlug.get(old.slug).checked = true;
    } else if (!old.checked) {
      leftovers.push({ ...old });
    }
  }
  return {
    version: VERSION,
    items: [...bySlug.values(), ...leftovers],
    generatedAt: newList.generatedAt,
  };
}

// Group items by aisle for display. Returns a Map<aisle, items[]>.
const AISLE_ORDER = ['Produce', 'Dairy', 'Meat', 'Pantry', 'Frozen', 'Other'];
export function groupByAisle(list) {
  const out = new Map();
  for (const aisle of AISLE_ORDER) out.set(aisle, []);
  for (const item of list.items || []) {
    if (!out.has(item.aisle)) out.set(item.aisle, []);
    out.get(item.aisle).push(item);
  }
  // Drop empty aisles.
  for (const aisle of [...out.keys()]) {
    if (!out.get(aisle).length) out.delete(aisle);
  }
  return out;
}

// Human-friendly quantity string for a list item (e.g. "1 1/2 cups").
export function formatItemQty(item) {
  if (!item) return '';
  if (item.qty == null) return '';
  const qtyStr = formatQty(item.qty);
  return item.unit ? `${qtyStr} ${item.unit}` : qtyStr;
}

// Toggle an item checked/unchecked in place (returns new list).
export function toggleItem(list, slug) {
  return {
    ...list,
    items: list.items.map((i) => (i.slug === slug ? { ...i, checked: !i.checked } : i)),
  };
}

// Remove an item (e.g. "I don't need this").
export function removeItem(list, slug) {
  return { ...list, items: list.items.filter((i) => i.slug !== slug) };
}
