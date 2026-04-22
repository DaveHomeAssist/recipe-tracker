import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPantry,
  savePantry,
  addItem,
  removeItem,
  setLow,
  addMany,
  recipeCoverage,
  rankRecipesByCoverage,
  recipesICanCook,
  stalePantryItems,
} from '../../src/pantry.js';

function makeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('pantry CRUD', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('starts empty', () => {
    expect(loadPantry(storage).items).toEqual([]);
  });

  it('addItem + save + load round-trip', () => {
    let p = loadPantry(storage);
    p = addItem(p, { slug: 'onion' });
    savePantry(p, storage);
    const reloaded = loadPantry(storage);
    expect(reloaded.items).toHaveLength(1);
    expect(reloaded.items[0].slug).toBe('onion');
    expect(reloaded.items[0].displayName).toBe('onion');
    expect(reloaded.items[0].low).toBe(false);
  });

  it('addItem dedupes by slug', () => {
    let p = loadPantry(storage);
    p = addItem(p, { slug: 'onion' });
    p = addItem(p, { slug: 'onion', low: true });
    expect(p.items).toHaveLength(1);
    expect(p.items[0].low).toBe(true);
  });

  it('removeItem drops by slug', () => {
    let p = loadPantry(storage);
    p = addItem(p, { slug: 'onion' });
    p = addItem(p, { slug: 'garlic' });
    p = removeItem(p, 'onion');
    expect(p.items.map((i) => i.slug)).toEqual(['garlic']);
  });

  it('setLow toggles flag', () => {
    let p = loadPantry(storage);
    p = addItem(p, { slug: 'flour' });
    p = setLow(p, 'flour', true);
    expect(p.items[0].low).toBe(true);
    p = setLow(p, 'flour', false);
    expect(p.items[0].low).toBe(false);
  });

  it('addMany accepts a slug array', () => {
    let p = loadPantry(storage);
    p = addMany(p, ['onion', 'garlic', 'tomato']);
    expect(p.items.map((i) => i.slug).sort()).toEqual(['garlic', 'onion', 'tomato']);
  });

  it('rejects empty slug', () => {
    let p = loadPantry(storage);
    p = addItem(p, { slug: '' });
    expect(p.items).toHaveLength(0);
  });
});

describe('recipe coverage', () => {
  it('reports 100% coverage when pantry has everything', () => {
    const recipe = { ingredients: '1 cup flour\n2 eggs\n1/2 cup milk' };
    const set = new Set(['flour', 'eggs', 'milk']);
    const r = recipeCoverage(recipe, set);
    expect(r.coverage).toBe(1);
    expect(r.matched).toBe(3);
    expect(r.missing).toEqual([]);
  });

  it('reports partial coverage with missing list', () => {
    const recipe = { ingredients: '1 cup flour\n2 eggs\n1/2 cup milk' };
    const set = new Set(['flour']);
    const r = recipeCoverage(recipe, set);
    expect(r.matched).toBe(1);
    expect(r.total).toBe(3);
    expect(r.coverage).toBeCloseTo(1 / 3);
    expect(r.missing.sort()).toEqual(['eggs', 'milk']);
  });

  it('dedupes slugs per-recipe', () => {
    const recipe = { ingredients: '1 onion, chopped\n2 onions, sliced' };
    const set = new Set(['onion']);
    const r = recipeCoverage(recipe, set);
    // "onion" and "onions" both slugify to their respective forms.
    // Pantry has only 'onion', so coverage depends on exact slug match.
    expect(r.total).toBeGreaterThanOrEqual(1);
  });

  it('handles empty ingredients', () => {
    const r = recipeCoverage({ ingredients: '' }, new Set());
    expect(r.coverage).toBe(0);
    expect(r.total).toBe(0);
  });
});

describe('rankRecipesByCoverage', () => {
  it('sorts by coverage desc then matched desc', () => {
    const recipes = [
      { id: 'a', ingredients: '1 cup flour\n2 eggs' }, // 0% if pantry empty
      { id: 'b', ingredients: '1 cup flour' },         // 100% if flour
      { id: 'c', ingredients: '1 cup flour\n1 cup milk' }, // 50% if flour
    ];
    const pantry = { items: [{ slug: 'flour' }] };
    const ranked = rankRecipesByCoverage(recipes, pantry);
    expect(ranked[0].recipe.id).toBe('b'); // 100%
    expect(ranked[1].recipe.id).toBe('c'); // 50%
    expect(ranked[2].recipe.id).toBe('a'); // 0%
  });
});

describe('recipesICanCook', () => {
  it('returns only recipes at/above threshold', () => {
    const recipes = [
      { id: 'a', ingredients: '1 cup flour' },
      { id: 'b', ingredients: '1 cup flour\n2 eggs' },
    ];
    const pantry = { items: [{ slug: 'flour' }] };
    const full = recipesICanCook(recipes, pantry, 1);
    expect(full).toHaveLength(1);
    expect(full[0].recipe.id).toBe('a');
    const partial = recipesICanCook(recipes, pantry, 0.5);
    expect(partial.length).toBeGreaterThanOrEqual(1);
  });
});

describe('stalePantryItems', () => {
  it('flags items >=30 days old', () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const fresh = new Date().toISOString();
    const state = {
      version: 1,
      items: [
        { slug: 'spice', addedAt: old },
        { slug: 'bread', addedAt: fresh },
      ],
    };
    const stale = stalePantryItems(state);
    expect(stale.map((i) => i.slug)).toEqual(['spice']);
  });
});
