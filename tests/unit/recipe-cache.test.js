import { beforeEach, describe, expect, it } from 'vitest';

import { clearRemoteRecipeCache, loadRemoteRecipeCache, saveRemoteRecipeCache } from '../../src/recipe-cache.js';

describe('remote recipe cache', () => {
  beforeEach(() => {
    const store = new Map();
    const fakeStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage,
      configurable: true,
      writable: true,
    });
    clearRemoteRecipeCache();
  });

  it('returns an empty cache when nothing is stored', () => {
    expect(loadRemoteRecipeCache()).toEqual({ recipes: [], tagRegistry: {}, fetchedAt: '' });
  });

  it('round-trips recipes and fetchedAt metadata', () => {
    saveRemoteRecipeCache([{ id: 'recipe_1', name: 'Soup' }], '2026-04-16T00:00:00.000Z');
    expect(loadRemoteRecipeCache()).toEqual({
      recipes: [{ id: 'recipe_1', name: 'Soup' }],
      tagRegistry: {},
      fetchedAt: '2026-04-16T00:00:00.000Z',
    });
  });
});
