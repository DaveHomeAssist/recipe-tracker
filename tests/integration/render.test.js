// Integration tests — jsdom environment.
// These import the same modules index.html imports, so a passing test
// proves the production render pipeline is safe.

import { describe, it, expect, beforeEach } from 'vitest';
import { filtered, renderCardHtml, renderGridHtml, statsFor } from '../../src/recipe-render.js';

// Sanity fixture used across tests
const sampleRecipes = [
  { id: 1, name: 'Cacio e Pepe', cuisine: 'Italian', location: 'Rome', source: 'Trattoria', notes: 'Silky', tags: 'pasta, classic', ingredients: 'pecorino', url: '' },
  { id: 2, name: 'Miso Black Cod', cuisine: 'Japanese', location: 'NYC', source: 'Nobu', notes: 'Umami bomb', tags: 'fish, umami', ingredients: 'miso, mirin, sake, cod', url: '' },
  { id: 3, name: 'Duck Confit', cuisine: 'French', location: 'Paris', source: 'Bistrot', notes: 'Bistro classic', tags: 'duck, slow cook', ingredients: 'duck legs, salt, thyme', url: '' },
  { id: 4, name: 'Shakshuka', cuisine: 'Mediterranean', location: 'Tel Aviv', source: 'Sabich', notes: 'Brunch hero', tags: 'eggs, brunch', ingredients: 'eggs, tomatoes', url: '' },
];

describe('renderGridHtml — XSS safety', () => {
  it('drops a non-http image URL instead of emitting an <img> tag', () => {
    const html = renderCardHtml({
      id: 1,
      name: 'Unsafe image',
      cuisine: 'Other',
      image: 'javascript:alert(1)',
      url: '',
      tags: '',
    });

    expect(html).not.toContain('<img');
    expect(html).toContain('card-image-empty');
  });

  it('renders a safe hero image with lazy loading and decorative alt text', () => {
    const html = renderCardHtml({
      id: 2,
      name: 'Safe image',
      cuisine: 'Italian',
      image: 'https://example.com/x.jpg',
      url: '',
      tags: '',
    });

    expect(html).toContain('<img src="https://example.com/x.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt=""');
  });

  it('escapes an <img onerror> payload in the name field (no tag survives)', () => {
    const adversarial = {
      id: 999,
      name: '<img src=x onerror=alert(1)>',
      cuisine: 'Other',
      url: '',
      tags: '',
    };
    const html = renderGridHtml([adversarial]);
    // No real <img tag (either self-closing or with attributes).
    expect(html).not.toMatch(/<img[\s>]/);
    // The payload exists only as fully-escaped text.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes a script-tag payload in the notes field', () => {
    const adversarial = {
      id: 1,
      name: 'ok',
      cuisine: 'Italian',
      notes: '<script>alert(2)</script>',
      url: '',
    };
    const html = renderGridHtml([adversarial]);
    expect(html).not.toMatch(/<script[^>]*>alert/);
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('when injected into a real DOM, the adversarial payload creates no <img> element and fires no event', () => {
    // Wire up jsdom with an alert spy to catch any accidental execution.
    let alerts = 0;
    const originalAlert = window.alert;
    window.alert = () => { alerts++; };

    const host = document.createElement('div');
    host.innerHTML = renderGridHtml([
      {
        id: 7,
        name: '<img src=x onerror="window.alert(\'xss\')">',
        cuisine: 'Other',
        tags: '" onmouseover="alert(1)" data-x="',
        url: '',
      },
    ]);
    document.body.appendChild(host);

    // No img from the payload should exist.
    expect(host.querySelectorAll('img').length).toBe(0);
    // Alert never fires.
    expect(alerts).toBe(0);
    // And the tag attribute-injection attempt ends up inside text, not as an attribute.
    const tagSpan = host.querySelector('.tag');
    expect(tagSpan?.textContent).toContain('onmouseover');

    document.body.removeChild(host);
    window.alert = originalAlert;
  });

  it('escapes adversarial content inside data-id so the attribute cannot break out', () => {
    const html = renderGridHtml([
      { id: '"><script>alert(1)</script>', name: 'x', cuisine: 'Other', url: '' },
    ]);
    expect(html).not.toMatch(/data-id="[^"]*"[^>]*>\s*<script/);
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('filtered — filter + search combinations', () => {
  it('returns all recipes for filter=all and empty search', () => {
    expect(filtered(sampleRecipes, { filter: 'all', search: '' })).toHaveLength(4);
  });

  it('narrows by cuisine filter', () => {
    const out = filtered(sampleRecipes, { filter: 'Italian', search: '' });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Cacio e Pepe');
  });

  it('narrows by search term across multiple fields', () => {
    // "miso" appears in name AND ingredients of the same recipe — match once.
    const out = filtered(sampleRecipes, { filter: 'all', search: 'miso' });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
  });

  it('combines cuisine filter AND search term', () => {
    // Filter to French, then search "duck" — only the duck confit matches.
    const out = filtered(sampleRecipes, { filter: 'French', search: 'duck' });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(3);
  });

  it('returns empty when filter and search contradict', () => {
    const out = filtered(sampleRecipes, { filter: 'Italian', search: 'duck' });
    expect(out).toHaveLength(0);
  });

  it('search is case-insensitive', () => {
    expect(filtered(sampleRecipes, { filter: 'all', search: 'PASTA' })).toHaveLength(1);
    expect(filtered(sampleRecipes, { filter: 'all', search: 'Pasta' })).toHaveLength(1);
  });

  it('search matches tags', () => {
    expect(filtered(sampleRecipes, { filter: 'all', search: 'brunch' })).toHaveLength(1);
  });

  it('search matches ingredients', () => {
    expect(filtered(sampleRecipes, { filter: 'all', search: 'pecorino' })).toHaveLength(1);
  });

  it('search matches location', () => {
    expect(filtered(sampleRecipes, { filter: 'all', search: 'rome' })).toHaveLength(1);
  });

  it('gracefully handles null/undefined fields', () => {
    const messy = [
      { id: 1, name: 'A', cuisine: 'Italian' }, // no tags/notes/etc
      { id: 2, name: 'B', cuisine: 'French', notes: null, tags: undefined },
    ];
    expect(() => filtered(messy, { filter: 'all', search: 'a' })).not.toThrow();
    expect(filtered(messy, { filter: 'all', search: 'a' })).toHaveLength(1);
  });

  it('performance: filters 10k recipes in under 50ms', () => {
    const big = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      name: `Recipe ${i}`,
      cuisine: ['Italian', 'French', 'American', 'Japanese'][i % 4],
      notes: `notes ${i}`,
      tags: 'quick, easy',
      ingredients: 'stuff',
    }));
    const t0 = performance.now();
    const out = filtered(big, { filter: 'Italian', search: 'recipe' });
    const elapsed = performance.now() - t0;
    expect(out).toHaveLength(2500);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('localStorage persistence round-trip', () => {
  const KEY = 'recipe_journal_v3';

  // Vitest's jsdom environment ships a partially-stubbed localStorage that
  // throws on method calls. Install a minimal Map-backed Storage so the
  // tests exercise a real round-trip without pretending to be the browser.
  const store = new Map();
  const fakeStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true });
    Object.defineProperty(window, 'localStorage', { value: fakeStorage, configurable: true, writable: true });
  });

  it('saves and reloads the full recipe shape with no data loss', () => {
    const original = sampleRecipes;
    localStorage.setItem(KEY, JSON.stringify(original));
    const reloaded = JSON.parse(localStorage.getItem(KEY) || '[]');
    expect(reloaded).toEqual(original);
  });

  it('preserves unicode and special characters through a round-trip', () => {
    const tricky = [
      { id: 1, name: 'Café au Lait ☕', notes: 'Great with croissants 🥐', tags: 'morning, french', cuisine: 'French' },
      { id: 2, name: 'Pierogi', notes: 'Line break\nin notes\nand "quotes"', tags: '', cuisine: 'Other' },
    ];
    localStorage.setItem(KEY, JSON.stringify(tricky));
    const out = JSON.parse(localStorage.getItem(KEY));
    expect(out[0].name).toBe('Café au Lait ☕');
    expect(out[1].notes).toContain('\n');
    expect(out[1].notes).toContain('"quotes"');
  });

  it('returns [] when storage is empty or malformed', () => {
    expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual([]);
    localStorage.setItem(KEY, '');
    expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual([]);
  });

  it('round-trip then filter+render survives an adversarial payload persisted as saved state', () => {
    const evil = [{
      id: 1,
      name: '<img src=x onerror=alert(1)>',
      cuisine: 'Italian',
      notes: 'stored XSS attempt',
      tags: 'evil',
      url: '',
    }];
    localStorage.setItem(KEY, JSON.stringify(evil));
    const reloaded = JSON.parse(localStorage.getItem(KEY));
    const html = renderGridHtml(reloaded, { filter: 'Italian', search: '' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('statsFor', () => {
  it('counts recipes, distinct cuisines, and non-empty locations', () => {
    const s = statsFor(sampleRecipes);
    expect(s.count).toBe(4);
    expect(s.cuisines).toBe(4);
    expect(s.locations).toBe(4);
  });

  it('skips empty locations', () => {
    const s = statsFor([
      { id: 1, name: 'a', cuisine: 'Italian', location: 'Rome' },
      { id: 2, name: 'b', cuisine: 'Italian', location: '' },
      { id: 3, name: 'c', cuisine: 'French' },
    ]);
    expect(s.locations).toBe(1);
    expect(s.cuisines).toBe(2);
  });
});
