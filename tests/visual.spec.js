import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const KEY = 'recipe_journal_v3';
const SCHEMA_KEY = 'recipe_journal_schema_version';
const VISUAL_IMAGE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#e4d6bf" />
        <stop offset="100%" stop-color="#f6efe0" />
      </linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#g)" />
    <circle cx="112" cy="98" r="34" fill="#c9a84c" opacity="0.45" />
    <rect x="74" y="174" width="252" height="18" rx="9" fill="#8a705f" opacity="0.22" />
    <rect x="98" y="206" width="204" height="14" rx="7" fill="#8a705f" opacity="0.14" />
  </svg>
`;

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

async function stabilizePage(page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => {
    document.querySelectorAll('.card').forEach((card) => {
      card.style.animation = 'none';
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'image') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: VISUAL_IMAGE_SVG,
    });
  });
});

test('full grid matches the desktop baseline', async ({ page }) => {
  await freshPage(page);
  await stabilizePage(page);

  await expect(page).toHaveScreenshot('full-grid.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    timeout: 45_000,
  });
});

test('view modal matches the desktop baseline', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().click();
  await expect(page.locator('#viewModal')).toHaveClass(/open/);
  await stabilizePage(page);

  await expect(page).toHaveScreenshot('view-modal.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    timeout: 45_000,
  });
});

test('add form modal matches the desktop baseline', async ({ page }) => {
  await freshPage(page);
  await page.locator('#openAddBtn').click();
  await expect(page.locator('#formModal')).toHaveClass(/open/);
  await stabilizePage(page);

  await expect(page).toHaveScreenshot('add-form-modal.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    timeout: 45_000,
  });
});

test('Italian filter grid matches the desktop baseline', async ({ page }) => {
  await freshPage(page);
  await page.locator('.filter-btn[data-cuisine-filter="Italian"]').click();
  await stabilizePage(page);

  await expect(page).toHaveScreenshot('italian-filter-grid.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    timeout: 45_000,
  });
});
