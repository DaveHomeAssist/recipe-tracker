import { describe, it, expect } from 'vitest';
import {
  generateFromRecipes,
  mergeWithExisting,
  groupByAisle,
  formatItemQty,
  toggleItem,
  removeItem,
  loadList,
  saveList,
} from '../../src/shopping-list.js';

const AISLE = {
  flour: 'Pantry',
  'all-purpose flour': 'Pantry',
  'olive oil': 'Pantry',
  milk: 'Dairy',
  eggs: 'Dairy',
  butter: 'Dairy',
  onion: 'Produce',
  onions: 'Produce',
  garlic: 'Produce',
  tomato: 'Produce',
  tomatoes: 'Produce',
};

function makeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('shopping-list generator', () => {
  it('aggregates identical ingredients across recipes', () => {
    const sources = [
      {
        recipe: {
          id: 'a',
          ingredients: '1 cup flour\n2 eggs\n1/2 cup milk',
        },
        servingsFactor: 1,
      },
      {
        recipe: {
          id: 'b',
          ingredients: '1 cup flour\n1 cup milk',
        },
        servingsFactor: 1,
      },
    ];
    const list = generateFromRecipes(sources, AISLE);
    const flour = list.items.find((i) => i.slug === 'flour');
    expect(flour).toBeTruthy();
    expect(flour.qty).toBeCloseTo(2); // 1 cup + 1 cup = 2 cup
    expect(flour.unit).toBe('cup');
    expect(flour.aisle).toBe('Pantry');
    expect(flour.sources.sort()).toEqual(['a', 'b']);
  });

  it('combines tbsp + cup correctly via base unit', () => {
    const sources = [
      { recipe: { id: 'a', ingredients: '2 tbsp olive oil' }, servingsFactor: 1 },
      { recipe: { id: 'b', ingredients: '1 cup olive oil' }, servingsFactor: 1 },
    ];
    const list = generateFromRecipes(sources, AISLE);
    const oil = list.items.find((i) => i.slug === 'olive oil');
    // 2 tbsp + 1 cup = 6 tsp + 48 tsp = 54 tsp = 1.125 cup
    expect(oil.qty).toBeCloseTo(1.125);
    expect(oil.unit).toBe('cup');
  });

  it('scales by servingsFactor', () => {
    const sources = [
      { recipe: { id: 'a', ingredients: '2 cups flour' }, servingsFactor: 2 },
    ];
    const list = generateFromRecipes(sources, AISLE);
    const flour = list.items.find((i) => i.slug === 'flour');
    expect(flour.qty).toBeCloseTo(4);
  });

  it('assigns Other aisle when slug unknown', () => {
    const sources = [
      { recipe: { id: 'a', ingredients: '1 widget' }, servingsFactor: 1 },
    ];
    const list = generateFromRecipes(sources, AISLE);
    const item = list.items.find((i) => i.slug === 'widget');
    expect(item.aisle).toBe('Other');
  });

  it('captures bare-quantity items (no unit)', () => {
    const sources = [
      { recipe: { id: 'a', ingredients: '2 eggs' }, servingsFactor: 1 },
      { recipe: { id: 'b', ingredients: '3 eggs' }, servingsFactor: 1 },
    ];
    const list = generateFromRecipes(sources, AISLE);
    const eggs = list.items.find((i) => i.slug === 'eggs');
    expect(eggs).toBeTruthy();
    expect(eggs.aisle).toBe('Dairy');
    // No unit so we store bareSum instead.
    expect(eggs.bareSum).toBe(5);
  });

  it('groupByAisle buckets correctly', () => {
    const sources = [
      { recipe: { id: 'a', ingredients: '1 cup flour\n1 cup milk\n2 tomatoes\n1 widget' }, servingsFactor: 1 },
    ];
    const list = generateFromRecipes(sources, AISLE);
    const grouped = groupByAisle(list);
    expect(grouped.has('Produce')).toBe(true);
    expect(grouped.has('Dairy')).toBe(true);
    expect(grouped.has('Pantry')).toBe(true);
    expect(grouped.has('Other')).toBe(true);
  });

  it('formatItemQty renders cleanly', () => {
    expect(formatItemQty({ qty: 1.5, unit: 'cup' })).toBe('1 1/2 cup');
    expect(formatItemQty({ qty: 2, unit: 'tbsp' })).toBe('2 tbsp');
    expect(formatItemQty({ qty: null, unit: null })).toBe('');
  });

  it('mergeWithExisting preserves checked state', () => {
    const first = generateFromRecipes([
      { recipe: { id: 'a', ingredients: '1 cup flour\n2 eggs' }, servingsFactor: 1 },
    ], AISLE);
    const checkedFirst = {
      ...first,
      items: first.items.map((i) => (i.slug === 'flour' ? { ...i, checked: true } : i)),
    };
    const second = generateFromRecipes([
      { recipe: { id: 'b', ingredients: '1 cup flour\n1 cup milk' }, servingsFactor: 1 },
    ], AISLE);
    const merged = mergeWithExisting(second, checkedFirst);
    const flour = merged.items.find((i) => i.slug === 'flour');
    expect(flour.checked).toBe(true); // preserved
    // Leftover: eggs from first list, unchecked, still appears.
    const eggs = merged.items.find((i) => i.slug === 'eggs');
    expect(eggs).toBeTruthy();
    // Milk from new list appears.
    const milk = merged.items.find((i) => i.slug === 'milk');
    expect(milk).toBeTruthy();
  });

  it('toggleItem + removeItem work', () => {
    const list = generateFromRecipes([
      { recipe: { id: 'a', ingredients: '1 cup flour\n2 eggs' }, servingsFactor: 1 },
    ], AISLE);
    const t = toggleItem(list, 'flour');
    expect(t.items.find((i) => i.slug === 'flour').checked).toBe(true);
    const r = removeItem(list, 'flour');
    expect(r.items.find((i) => i.slug === 'flour')).toBeUndefined();
  });

  it('saveList + loadList round-trip', () => {
    const storage = makeStorage();
    const list = generateFromRecipes([
      { recipe: { id: 'a', ingredients: '1 cup flour' }, servingsFactor: 1 },
    ], AISLE);
    saveList(list, storage);
    const reloaded = loadList(storage);
    expect(reloaded.items).toHaveLength(1);
    expect(reloaded.items[0].slug).toBe('flour');
  });
});
