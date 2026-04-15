import { test, expect } from '@playwright/test';

// These tests exercise the live static site (served locally by playwright.config.js
// unless PW_BASE_URL is set, e.g. to the GitHub Pages URL).

// NOTE: We used to clear localStorage via addInitScript(), but that runs on
// every navigation — including page.reload() — which broke persistence tests.
// Instead each test clears once before its first navigation.

async function freshPage(page) {
  // First nav gives us a real origin we can talk to; then clear storage and
  // reload so the seed re-runs from scratch. Only happens once per test —
  // subsequent page.reload() calls in the test body stay persistent.
  await page.goto('/index.html');
  await page.evaluate(() => {
    try { localStorage.removeItem('recipe_journal_v3'); } catch {}
  });
  await page.goto('/index.html');
}

test('loads and renders all 187 seeded cards', async ({ page }) => {
  await freshPage(page);
  await expect(page.locator('.recipe-grid .card')).toHaveCount(187, { timeout: 15_000 });

  // Stats bar reflects the same count.
  await expect(page.locator('.stats-bar')).toContainText('187');
});

test('clicking a card opens the view modal with the recipe name', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  const firstTitle = await page.locator('.recipe-grid .card .card-title').first().innerText();
  await page.locator('.recipe-grid .card').first().click();

  const modal = page.locator('#viewModal');
  await expect(modal).toHaveClass(/open/);
  await expect(modal.locator('.view-title')).toHaveText(firstTitle);
});

test('cuisine filter narrows the grid', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  const totalBefore = await page.locator('.recipe-grid .card').count();
  expect(totalBefore).toBe(187);

  await page.locator('.filter-btn[data-filter="Italian"]').click();
  const italianCount = await page.locator('.recipe-grid .card').count();
  expect(italianCount).toBeGreaterThan(0);
  expect(italianCount).toBeLessThan(187);

  // Every visible card should be Italian. Use textContent (not innerText)
  // because `.card-cuisine` has `text-transform: uppercase`, which innerText
  // respects. textContent returns the underlying "Italian" string.
  const cuisineTexts = await page.locator('.recipe-grid .card .card-cuisine').allTextContents();
  expect(cuisineTexts.every((t) => t.trim() === 'Italian')).toBe(true);
});

test('search narrows the grid and is case-insensitive', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  await page.locator('#searchInput').fill('CHICKEN');
  // Give the input handler a tick.
  await page.waitForTimeout(150);

  const count = await page.locator('.recipe-grid .card').count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(187);
});

test('adding a manual recipe persists across reload', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  const countBefore = await page.locator('.recipe-grid .card').count();

  await page.locator('#openAddBtn').click();
  await expect(page.locator('#formModal')).toHaveClass(/open/);

  const uniqueName = `Test Recipe ${Date.now()}`;
  await page.locator('#f-name').fill(uniqueName);
  await page.locator('#f-cuisine').selectOption('Italian');
  await page.locator('#f-notes').fill('round-trip test');
  await page.locator('#saveFormBtn').click();

  // Modal closes and grid grows.
  await expect(page.locator('#formModal')).not.toHaveClass(/open/);
  await expect(page.locator('.recipe-grid .card')).toHaveCount(countBefore + 1);

  // Search for our unique name. Click first to make sure search input is
  // focused and the input event will fire the render handler.
  const search = page.locator('#searchInput');
  await search.click();
  await search.fill(uniqueName);
  // The search input handler re-renders synchronously; give it a tick.
  await page.waitForFunction(
    (name) => {
      const titles = [...document.querySelectorAll('.recipe-grid .card .card-title')].map(
        (t) => t.textContent.trim()
      );
      return titles.length === 1 && titles[0] === name;
    },
    uniqueName,
    { timeout: 5000 }
  );

  // Reload without clearing storage — the addition should persist.
  await page.reload();
  await page.locator('.recipe-grid .card').first().waitFor();
  await page.locator('#searchInput').click();
  await page.locator('#searchInput').fill(uniqueName);
  await page.waitForFunction(
    (name) => {
      const titles = [...document.querySelectorAll('.recipe-grid .card .card-title')].map(
        (t) => t.textContent.trim()
      );
      return titles.length === 1 && titles[0] === name;
    },
    uniqueName,
    { timeout: 5000 }
  );
});

test('no console errors or uncaught exceptions on load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();
  expect(errors).toEqual([]);
});

test('XSS hardening: a manually added recipe with an <img onerror> name renders as text', async ({ page }) => {
  // Pre-seed an adversarial recipe into localStorage, then load the page.
  await page.addInitScript(() => {
    const evil = [{
      id: 99999,
      name: '<img src=x onerror="window.__xssFired=true">',
      cuisine: 'Other',
      source: '',
      location: '',
      ingredients: '',
      instructions: '',
      preptime: '',
      cooktime: '',
      servings: '',
      tags: '',
      notes: 'adversarial',
      url: '',
      date: '',
      rating: 0,
    }];
    window.localStorage.setItem('recipe_journal_v3', JSON.stringify(evil));
  });

  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  // Exactly one card.
  await expect(page.locator('.recipe-grid .card')).toHaveCount(1);
  // No <img> from the payload.
  expect(await page.locator('.recipe-grid img').count()).toBe(0);
  // Title renders as literal text, not markup.
  const titleText = await page.locator('.recipe-grid .card-title').innerText();
  expect(titleText).toContain('<img');
  // The onerror side effect never fired.
  const fired = await page.evaluate(() => window.__xssFired === true);
  expect(fired).toBe(false);
});
