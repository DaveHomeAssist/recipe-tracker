import { expect, test } from 'vitest';
import { mergeSeedImages } from '../../src/seed-images.js';

test('the public catalog skips ambiguous URLs and non-public image schemes', async () => {
  const recipes = [
    { url: 'https://example.test/ambiguous' },
    { url: 'https://example.test/insecure' },
    { url: 'https://example.test/private' },
    { url: 'https://example.test/CaseSensitive' },
  ];
  const catalog = [
    { url: recipes[0].url, image: 'https://images.example.test/one.jpg' },
    { url: recipes[0].url + '?utm_source=feed', image: 'https://images.example.test/two.jpg' },
    { url: recipes[1].url, image: 'http://images.example.test/plain.jpg' },
    { url: recipes[2].url, image: 'https://user@images.example.test/private.jpg' },
    { url: 'https://example.test/casesensitive', image: 'https://images.example.test/case.jpg' },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => catalog });
  await expect(mergeSeedImages(recipes, { fetchImpl, publicSources: true })).resolves.toEqual({
    recipes,
    changed: 0,
  });
});
