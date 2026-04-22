// Ingredient parser tests. Edge cases + coverage floor against real data.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseIngredient,
  parseIngredients,
  coverageOf,
} from '../../src/ingredient-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

describe('parseIngredient — edge cases', () => {
  it('parses integer quantity + common unit', () => {
    const r = parseIngredient('2 cups flour');
    expect(r.qty).toBe(2);
    expect(r.unit).toBe('cup');
    expect(r.item).toBe('flour');
    expect(r.slug).toBe('flour');
  });

  it('parses decimal quantity', () => {
    const r = parseIngredient('1.5 cups milk');
    expect(r.qty).toBeCloseTo(1.5);
    expect(r.unit).toBe('cup');
    expect(r.slug).toBe('milk');
  });

  it('parses simple fraction', () => {
    const r = parseIngredient('1/2 cup sugar');
    expect(r.qty).toBeCloseTo(0.5);
    expect(r.unit).toBe('cup');
    expect(r.slug).toBe('sugar');
  });

  it('parses mixed fraction', () => {
    const r = parseIngredient('1 1/2 cups flour');
    expect(r.qty).toBeCloseTo(1.5);
    expect(r.unit).toBe('cup');
    expect(r.slug).toBe('flour');
  });

  it('parses vulgar fraction', () => {
    const r = parseIngredient('½ cup butter');
    expect(r.qty).toBeCloseTo(0.5);
    expect(r.unit).toBe('cup');
    expect(r.slug).toBe('butter');
  });

  it('parses mixed + vulgar fraction', () => {
    const r = parseIngredient('2 ¼ cups flour');
    expect(r.qty).toBeCloseTo(2.25);
    expect(r.unit).toBe('cup');
    expect(r.slug).toBe('flour');
  });

  it('parses range as lower bound', () => {
    const r = parseIngredient('2-3 tablespoons olive oil');
    expect(r.qty).toBe(2);
    expect(r.unit).toBe('tbsp');
    expect(r.slug).toBe('olive oil');
  });

  it('strips "of" after unit', () => {
    const r = parseIngredient('1 cup of milk');
    expect(r.qty).toBe(1);
    expect(r.unit).toBe('cup');
    expect(r.slug).toBe('milk');
  });

  it('separates modifier after comma', () => {
    const r = parseIngredient('1 onion, diced');
    expect(r.qty).toBe(1);
    expect(r.item).toBe('onion');
    expect(r.slug).toBe('onion');
    expect(r.modifier).toBe('diced');
  });

  it('separates modifier in parens', () => {
    const r = parseIngredient('2 cups flour (all-purpose)');
    expect(r.qty).toBe(2);
    expect(r.unit).toBe('cup');
    expect(r.item).toBe('flour');
    expect(r.slug).toBe('flour');
    expect(r.modifier).toBe('all-purpose');
  });

  it('tsp vs tbsp case sensitivity (t vs T)', () => {
    const lowT = parseIngredient('3 t salt');
    const bigT = parseIngredient('3 T olive oil');
    expect(lowT.unit).toBe('tsp');
    expect(bigT.unit).toBe('tbsp');
  });

  it('handles no quantity (just item)', () => {
    const r = parseIngredient('salt to taste');
    expect(r.qty).toBeNull();
    expect(r.slug).toBe('salt to taste');
  });

  it('strips leading bullet', () => {
    const r = parseIngredient('- 2 cups flour');
    expect(r.qty).toBe(2);
    expect(r.slug).toBe('flour');
  });

  it('strips leading numbered list marker', () => {
    const r = parseIngredient('1. 1 cup milk');
    expect(r.qty).toBe(1);
    expect(r.unit).toBe('cup');
    expect(r.slug).toBe('milk');
  });

  it('returns raw-backed record for empty input', () => {
    const r = parseIngredient('');
    expect(r.slug).toBe('');
    expect(r.raw).toBe('');
  });

  it('parses opaque units (clove)', () => {
    const r = parseIngredient('3 cloves garlic, minced');
    expect(r.qty).toBe(3);
    expect(r.unit).toBe('clove');
    expect(r.slug).toBe('garlic');
    expect(r.modifier).toBe('minced');
  });

  it('parses weight unit', () => {
    const r = parseIngredient('1 lb ground beef');
    expect(r.qty).toBe(1);
    expect(r.unit).toBe('lb');
    expect(r.slug).toBe('ground beef');
  });

  it('parses metric weight', () => {
    const r = parseIngredient('250 g flour');
    expect(r.qty).toBe(250);
    expect(r.unit).toBe('g');
    expect(r.slug).toBe('flour');
  });

  it('strips "a" / "an" / "the" leading descriptors', () => {
    const r = parseIngredient('a pinch of salt');
    expect(r.slug).toBe('salt');
  });
});

describe('parseIngredients — batch', () => {
  it('handles multi-line input', () => {
    const text = '2 cups flour\n1 cup milk\n\n1/2 tsp salt';
    const out = parseIngredients(text);
    expect(out).toHaveLength(3);
    expect(out[0].slug).toBe('flour');
    expect(out[2].qty).toBeCloseTo(0.5);
  });
});

describe('coverage against real recipe dataset', () => {
  const SOURCE = join(REPO_ROOT, 'data', 'source', 'recipes.json');

  it('covers >=85% of ingredient lines from data/source/recipes.json', () => {
    if (!existsSync(SOURCE)) {
      // Skip gracefully if the dataset isn't present in this checkout.
      return;
    }
    const raw = readFileSync(SOURCE, 'utf8');
    const data = JSON.parse(raw);
    // Recipes may be at the top level, or wrapped as { recipes: [...] }.
    const recipes = Array.isArray(data) ? data : Array.isArray(data.recipes) ? data.recipes : [];
    expect(recipes.length).toBeGreaterThan(0);

    let allRecords = [];
    for (const r of recipes) {
      if (!r || typeof r.ingredients !== 'string') continue;
      allRecords = allRecords.concat(parseIngredients(r.ingredients));
    }

    expect(allRecords.length).toBeGreaterThan(0);
    const cov = coverageOf(allRecords);
    // Report for visibility; Vitest will print on failure.
    if (cov < 0.85) {
      // eslint-disable-next-line no-console
      console.warn(`Ingredient parser coverage: ${(cov * 100).toFixed(1)}% (${allRecords.length} lines)`);
    }
    expect(cov).toBeGreaterThanOrEqual(0.85);
  });
});
