import { test, expect } from '@playwright/test';

const KEY = 'recipe_journal_v3';
const SCHEMA_KEY = 'recipe_journal_schema_version';

async function freshPage(page) {
  await page.goto('/index.html');
  await page.evaluate(
    ({ key, schemaKey }) => {
      try {
        localStorage.removeItem(key);
        localStorage.removeItem(schemaKey);
      } catch {}
    },
    { key: KEY, schemaKey: SCHEMA_KEY }
  );
  await page.goto('/index.html');
  await page.locator('.recipe-grid .card').first().waitFor();
}

test('service worker keeps the seeded grid available offline after warm cache', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'offline service worker flow is desktop-only');

  await freshPage(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.webmanifest');

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.locator('.recipe-grid .card').first().waitFor();

  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  expect(controlled).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.recipe-grid .card')).toHaveCount(187, { timeout: 15_000 });
  await context.setOffline(false);
});
