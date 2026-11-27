import { beforeEach, describe, expect, it } from 'vitest';

import {
  continueRecipe,
  dismissContinue,
  loadPrefs,
  recordEdit,
  recordExport,
  recordFilter,
  recordLibraryScroll,
  recordRating,
  recordSearch,
  recordView,
} from '../../src/recipe-prefs.js';

describe('recipe prefs', () => {
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
  });

  it('loads sensible defaults', () => {
    expect(loadPrefs()).toMatchObject({
      recentSearches: [],
      lastFilter: 'all',
      defaultRating: 0,
      editsSinceLastExport: 0,
      recentlyViewed: [],
      v: 1,
    });
  });

  it('records recent searches case-insensitively and keeps max 5', () => {
    let prefs = loadPrefs();
    ['Chicken', 'Pasta', 'Lemon', 'Soup', 'Greek', 'CHICKEN'].forEach((query) => {
      prefs = recordSearch(query, prefs);
    });
    expect(prefs.recentSearches).toEqual(['CHICKEN', 'Greek', 'Soup', 'Lemon', 'Pasta']);
  });

  it('records filter, edits, export reset, and recent views', () => {
    let prefs = loadPrefs();
    prefs = recordFilter('Italian', prefs);
    prefs = recordEdit(prefs);
    prefs = recordEdit(prefs);
    prefs = recordView('recipe-1', prefs);
    prefs = recordView('recipe-2', prefs);
    prefs = recordView('recipe-1', prefs);
    expect(prefs.lastFilter).toBe('Italian');
    expect(prefs.editsSinceLastExport).toBe(2);
    expect(prefs.recentlyViewed).toEqual(['recipe-1', 'recipe-2']);
    expect(prefs.lastView.id).toBe('recipe-1');
    prefs = recordExport(prefs);
    expect(prefs.editsSinceLastExport).toBe(0);
  });

  it('keeps continue and scroll state local, bounded, and dismissible', () => {
    const now = Date.UTC(2026, 10, 27, 15, 0, 0);
    let prefs = recordView('recipe-1', loadPrefs(), now);
    prefs = recordLibraryScroll(412.6, prefs);
    expect(prefs.libraryScroll).toBe(413);
    expect(continueRecipe([{ id: 'recipe-1', name: 'Gougères' }], prefs, now + 1000)?.name).toBe('Gougères');
    prefs = dismissContinue(prefs, now + 2000);
    expect(continueRecipe([{ id: 'recipe-1', name: 'Gougères' }], prefs, now + 3000)).toBeNull();
  });

  it('tracks rating history and stores the median as the default', () => {
    let prefs = loadPrefs();
    [5, 4, 5, 3, 4].forEach((rating) => {
      prefs = recordRating(rating, prefs);
    });
    expect(prefs.defaultRating).toBe(4);
    expect(prefs.recentManualRatings).toEqual([5, 4, 5, 3, 4]);
  });
});
