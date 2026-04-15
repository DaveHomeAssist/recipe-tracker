import { describe, it, expect } from 'vitest';
import { escapeHtml, safeUrl, dedupeByUrl } from '../../src/recipe-lib.js';

describe('escapeHtml', () => {
  it('escapes all five reserved HTML characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Cacio e Pepe')).toBe('Cacio e Pepe');
  });

  it('neutralizes an <img onerror> payload so no tag remains', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const out = escapeHtml(payload);
    // The raw tag brackets are gone — the string "onerror=" survives as plain
    // text, which is harmless because there's no opening < to start an element.
    expect(out).not.toMatch(/<img[\s>]/);
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('coerces null and undefined to empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces numbers and booleans to their string form', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml(false)).toBe('false');
  });

  it('handles already-escaped entities without double-escaping markup structure', () => {
    // Content stays literal — the caller passed "&amp;", we escape it to "&amp;amp;"
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('survives unicode and emoji', () => {
    expect(escapeHtml('café 🍳')).toBe('café 🍳');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('safeUrl', () => {
  it('accepts http URLs', () => {
    expect(safeUrl('http://example.com/recipe')).toBe('http://example.com/recipe');
  });

  it('accepts https URLs', () => {
    expect(safeUrl('https://example.com/recipe')).toBe('https://example.com/recipe');
  });

  it('accepts https with uppercase scheme', () => {
    expect(safeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(safeUrl('   https://example.com   ')).toBe('https://example.com');
  });

  it('rejects javascript: URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JavaScript:alert(1)')).toBe('');
    expect(safeUrl(' javascript:alert(1)')).toBe('');
  });

  it('rejects data: URLs', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('rejects vbscript: URLs', () => {
    expect(safeUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('rejects file: URLs', () => {
    expect(safeUrl('file:///etc/passwd')).toBe('');
  });

  it('rejects protocol-relative URLs (//host)', () => {
    expect(safeUrl('//example.com/recipe')).toBe('');
  });

  it('rejects relative paths', () => {
    expect(safeUrl('/recipes/1')).toBe('');
    expect(safeUrl('recipes/1')).toBe('');
  });

  it('rejects empty, null and undefined', () => {
    expect(safeUrl('')).toBe('');
    expect(safeUrl(null)).toBe('');
    expect(safeUrl(undefined)).toBe('');
    expect(safeUrl('   ')).toBe('');
  });
});

describe('dedupeByUrl', () => {
  it('removes duplicate recipes that share a URL', () => {
    const out = dedupeByUrl([
      { id: 1, name: 'A', url: 'https://example.com/x' },
      { id: 2, name: 'A copy', url: 'https://example.com/x' },
      { id: 3, name: 'B', url: 'https://example.com/y' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1); // first one wins
    expect(out[1].id).toBe(3);
  });

  it('treats URL equality as case-insensitive and trims whitespace', () => {
    const out = dedupeByUrl([
      { id: 1, url: 'https://example.com/X' },
      { id: 2, url: '  HTTPS://EXAMPLE.COM/x  ' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it('keeps every record when no URLs are set (can\'t dedupe without a key)', () => {
    const out = dedupeByUrl([
      { id: 1, name: 'manual 1', url: '' },
      { id: 2, name: 'manual 2', url: '' },
      { id: 3, name: 'manual 3' },
    ]);
    expect(out).toHaveLength(3);
  });

  it('is an identity on an empty array', () => {
    expect(dedupeByUrl([])).toEqual([]);
  });

  it('handles a mix of url and no-url entries', () => {
    const out = dedupeByUrl([
      { id: 1, url: 'https://a.com' },
      { id: 2, url: '' },
      { id: 3, url: 'https://a.com' },
      { id: 4, url: '' },
    ]);
    // Two "no url" entries both kept; the two a.com entries collapse to one.
    expect(out).toHaveLength(3);
    expect(out.filter(r => r.url === 'https://a.com')).toHaveLength(1);
  });

  it('performance: dedupes 10k records in under 100ms', () => {
    const recipes = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      url: `https://example.com/${i % 5000}`, // 50% duplicates
    }));
    const t0 = performance.now();
    const out = dedupeByUrl(recipes);
    const elapsed = performance.now() - t0;
    expect(out).toHaveLength(5000);
    expect(elapsed).toBeLessThan(100);
  });
});
