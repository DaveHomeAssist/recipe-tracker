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
        localStorage.removeItem('recipe_journal_prefs');
      } catch {}
    },
    { key: KEY, schemaKey: SCHEMA_KEY }
  );
  await page.goto('/index.html');
  await page.locator('.recipe-grid .card').first().waitFor();
}

test('toolbar does not horizontally overflow', async ({ page }) => {
  await freshPage(page);
  const hasNoOverflow = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth);
  expect(hasNoOverflow).toBe(true);
});

test('Add Recipe button stays inside the viewport', async ({ page }) => {
  await freshPage(page);
  const button = page.locator('#openAddBtn');
  const box = await button.boundingBox();
  const viewport = page.viewportSize();

  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
});

test('Add form modal fits within the viewport', async ({ page }) => {
  await freshPage(page);
  await page.locator('#openAddBtn').click();
  await expect(page.locator('#formModal')).toHaveClass(/open/);

  const modalBox = await page.locator('#formModal .modal').boundingBox();
  const viewport = page.viewportSize();

  expect(modalBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(modalBox.width).toBeLessThanOrEqual(viewport.width);
});

test('filter chips wrap at 320px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-320', '320px-only wrap assertion');

  await freshPage(page);
  const offsets = await page.locator('.filter-btn').evaluateAll((buttons) =>
    [...new Set(buttons.map((button) => button.offsetTop))].length
  );

  expect(offsets).toBeGreaterThan(1);
});

test('card icon buttons meet the 44px touch target at 375px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-375', '375px-only touch target assertion');

  await freshPage(page);
  const box = await page.locator('.icon-btn').first().boundingBox();

  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});
