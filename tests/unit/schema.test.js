import { describe, it, expect } from 'vitest';
import { validateRecipe, validateImport } from '../../src/recipe-schema.js';

describe('validateRecipe — happy path', () => {
  it('passes a complete recipe through with all fields preserved', () => {
    const input = {
      id: 42,
      name: 'Cacio e Pepe',
      cuisine: 'Italian',
      source: 'Trattoria',
      location: 'Rome',
      ingredients: 'pecorino\nblack pepper',
      instructions: 'toss with starchy water',
      preptime: '10 min',
      cooktime: '20 min',
      servings: '2',
      tags: 'pasta, classic',
      notes: 'simplicity is the point',
      url: 'https://example.com/recipe',
      image: 'https://example.com/hero.jpg',
      date: '2024-02-20',
      rating: 5,
    };
    const out = validateRecipe(input);
    expect(out).toMatchObject({
      name: 'Cacio e Pepe',
      cuisine: 'Italian',
      url: 'https://example.com/recipe',
      image: 'https://example.com/hero.jpg',
      rating: 5,
    });
    expect(out.id).toBe('42'); // coerced to string
  });

  it('accepts sourceUrl as an alias for url', () => {
    const out = validateRecipe({
      name: 'Alias Check',
      sourceUrl: 'https://example.com/source-url',
    });
    expect(out.url).toBe('https://example.com/source-url');
  });

  it('accepts Phase D field aliases and preserves version', () => {
    const out = validateRecipe({
      name: 'Alias Bundle',
      method: 'Stir',
      prepTime: '5 min',
      cookTime: '10 min',
      dateTried: '2026-04-19',
      version: 2,
    });
    expect(out.instructions).toBe('Stir');
    expect(out.preptime).toBe('5 min');
    expect(out.cooktime).toBe('10 min');
    expect(out.date).toBe('2026-04-19');
    expect(out.version).toBe(2);
  });

  it('preserves a minimal recipe (name only)', () => {
    const out = validateRecipe({ name: 'Toast' });
    expect(out).not.toBeNull();
    expect(out.name).toBe('Toast');
    expect(out.cuisine).toBe('');
    expect(out.rating).toBe(0);
    expect(out.url).toBe('');
  });
});

describe('validateRecipe — rejects obviously bad input', () => {
  it('returns null when name is missing', () => {
    expect(validateRecipe({ cuisine: 'Italian' })).toBeNull();
    expect(validateRecipe({ name: '' })).toBeNull();
    expect(validateRecipe({ name: '   ' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateRecipe(null)).toBeNull();
    expect(validateRecipe(undefined)).toBeNull();
    expect(validateRecipe('Cacio e Pepe')).toBeNull();
    expect(validateRecipe(42)).toBeNull();
    expect(validateRecipe([])).toBeNull();
  });
});

describe('validateRecipe — field coercion and sanitization', () => {
  it('strips unknown fields (including __proto__ pollution attempts)', () => {
    const input = {
      name: 'x',
      __proto__: { polluted: true },
      extraField: 'evil',
      constructor: 'nope',
    };
    const out = validateRecipe(input);
    expect(out).not.toBeNull();
    expect(out.extraField).toBeUndefined();
    expect(out.polluted).toBeUndefined();
    // Known fields only
    expect(Object.keys(out).sort()).toEqual([
      'cooktime','cuisine','date','id','image','ingredients','instructions',
      'location','name','notes','preptime','rating','servings','source',
      'tags','url','version',
    ]);
  });

  it('drops javascript: URLs in url and image fields', () => {
    const out = validateRecipe({
      name: 'x',
      sourceUrl: 'javascript:alert(1)',
      image: 'JavaScript:alert(2)',
    });
    expect(out.url).toBe('');
    expect(out.image).toBe('');
  });

  it('drops data: URLs in url and image fields', () => {
    const out = validateRecipe({
      name: 'x',
      url: 'data:text/html,<script>alert(1)</script>',
      image: 'data:image/svg+xml,<svg>',
    });
    expect(out.url).toBe('');
    expect(out.image).toBe('');
  });

  it('coerces rating out of range', () => {
    expect(validateRecipe({ name: 'x', rating: 99 }).rating).toBe(5);
    expect(validateRecipe({ name: 'x', rating: -10 }).rating).toBe(0);
    expect(validateRecipe({ name: 'x', rating: 3.7 }).rating).toBe(4);
    expect(validateRecipe({ name: 'x', rating: 'three' }).rating).toBe(0);
    expect(validateRecipe({ name: 'x', rating: null }).rating).toBe(0);
    expect(validateRecipe({ name: 'x', rating: NaN }).rating).toBe(0);
  });

  it('coerces numeric and boolean fields to strings where a string is expected', () => {
    const out = validateRecipe({ name: 'x', cuisine: 123, source: true });
    expect(out.cuisine).toBe('123');
    expect(out.source).toBe('true');
  });

  it('coerces id to string for number and string inputs', () => {
    expect(validateRecipe({ name: 'x', id: 0 }).id).toBe('0');
    expect(validateRecipe({ name: 'x', id: 'abc-123' }).id).toBe('abc-123');
    expect(validateRecipe({ name: 'x', id: null }).id).toBe('');
    expect(validateRecipe({ name: 'x', id: NaN }).id).toBe('');
  });

  it('truncates oversized text fields to 100 KB', () => {
    const giant = 'a'.repeat(200_000);
    const out = validateRecipe({ name: 'x', instructions: giant });
    expect(out.instructions.length).toBe(100_000);
  });
});

describe('validateImport — top-level shape', () => {
  it('accepts a bare array', () => {
    const out = validateImport([
      { name: 'A' },
      { name: 'B' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.recipes).toHaveLength(2);
    expect(out.dropped).toBe(0);
  });

  it('accepts the wrapped {schemaVersion, recipes} shape from export', () => {
    const out = validateImport({
      schemaVersion: 3,
      exportedAt: '2026-04-15T00:00:00Z',
      recipes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });
    expect(out.ok).toBe(true);
    expect(out.recipes).toHaveLength(3);
  });

  it('counts dropped records separately from total', () => {
    const out = validateImport([
      { name: 'good' },
      { cuisine: 'no name' },
      { name: '' },
      { name: 'also good' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.recipes).toHaveLength(2);
    expect(out.dropped).toBe(2);
    expect(out.total).toBe(4);
  });

  it('rejects null and undefined', () => {
    expect(validateImport(null).ok).toBe(false);
    expect(validateImport(undefined).ok).toBe(false);
  });

  it('rejects wrong top-level shape', () => {
    expect(validateImport({ recipes: 'not an array' }).ok).toBe(false);
    expect(validateImport({ just: 'wrong' }).ok).toBe(false);
    expect(validateImport(42).ok).toBe(false);
    expect(validateImport('string').ok).toBe(false);
  });

  it('rejects imports over the 10k recipe cap', () => {
    const huge = Array.from({ length: 10_001 }, (_, i) => ({ name: `R${i}` }));
    const out = validateImport(huge);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/too many/i);
  });

  it('accepts exactly 10k recipes', () => {
    const max = Array.from({ length: 10_000 }, (_, i) => ({ name: `R${i}` }));
    const out = validateImport(max);
    expect(out.ok).toBe(true);
    expect(out.recipes).toHaveLength(10_000);
  });
});

describe('validateImport — performance', () => {
  it('validates 5k recipes in under 200 ms', () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({
      name: `Recipe ${i}`,
      cuisine: ['Italian','French','American'][i % 3],
      ingredients: 'stuff',
      url: `https://example.com/${i}`,
      rating: i % 6,
    }));
    const t0 = performance.now();
    const out = validateImport(big);
    const elapsed = performance.now() - t0;
    expect(out.ok).toBe(true);
    expect(out.recipes).toHaveLength(5000);
    expect(elapsed).toBeLessThan(200);
  });
});
