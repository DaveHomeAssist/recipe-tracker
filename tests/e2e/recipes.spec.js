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
    try {
      localStorage.removeItem('recipe_journal_v3');
      localStorage.removeItem('recipe_journal_schema_version');
      localStorage.removeItem('recipe_journal_prefs');
    } catch {}
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

  await page.locator('.filter-btn[data-cuisine-filter="Italian"]').click();
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

test('last cuisine filter persists across reload', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  await page.locator('.filter-btn[data-cuisine-filter="Italian"]').click();
  await expect(page.locator('.filter-btn[data-cuisine-filter="Italian"]')).toHaveClass(/active/);

  await page.reload();
  await page.locator('.recipe-grid .card').first().waitFor();
  await expect(page.locator('.filter-btn[data-cuisine-filter="Italian"]')).toHaveClass(/active/);

  const cuisineTexts = await page.locator('.recipe-grid .card .card-cuisine').allTextContents();
  expect(cuisineTexts.every((t) => t.trim() === 'Italian')).toBe(true);
});

test('recent searches are suggested and can be replayed', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  const search = page.locator('#searchInput');
  await search.fill('chicken');
  await page.waitForTimeout(650);
  await search.blur();
  await page.waitForTimeout(150);
  await search.fill('');
  await search.focus();

  const recentChip = page.locator('#recentSearches [data-search="chicken"]');
  await expect(recentChip).toBeVisible();
  await recentChip.click();
  await expect(search).toHaveValue('chicken');

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

test('add form pre-fills cuisine, suggestions, and rating defaults from usage', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();
  const expectedCuisine = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('recipe_journal_v3') || '[]');
    const recipes = Array.isArray(stored) ? stored : stored.recipes || [];
    const counts = recipes.reduce((acc, recipe) => {
      const cuisine = String(recipe?.cuisine || '').trim() || 'Other';
      acc[cuisine] = (acc[cuisine] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Other';
  });

  await page.locator('#openAddBtn').click();
  await expect(page.locator('#f-cuisine')).toHaveValue(expectedCuisine);
  await expect(page.locator('#location-suggestions')).toBeAttached();
  expect(await page.locator('#source-suggestions option').count()).toBeGreaterThan(0);
  await page.locator('#f-tag-input').fill('sou');
  await page.waitForTimeout(250);
  expect(await page.locator('#tag-suggestions .tag-dropdown-item').count()).toBeGreaterThan(0);

  await page.locator('#f-name').fill(`Rated Recipe ${Date.now()}`);
  await page.locator('#fStars .star-option[data-v="5"]').click();
  await page.locator('#saveFormBtn').click();
  await expect(page.locator('#formModal')).not.toHaveClass(/open/);

  await page.locator('#openAddBtn').click();
  await expect(page.locator('#fStars .star-option.active')).toHaveCount(5);
});

test('closing the view modal restores the prior scroll position', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').nth(30).scrollIntoViewIfNeeded();
  const beforeOpen = await page.evaluate(() => window.scrollY);

  await page.locator('.recipe-grid .card').nth(30).click();
  await expect(page.locator('#viewModal')).toHaveClass(/open/);
  await page.locator('#closeViewBtn').click();
  await expect(page.locator('#viewModal')).not.toHaveClass(/open/);
  await page.waitForTimeout(120);

  const afterClose = await page.evaluate(() => window.scrollY);
  expect(Math.abs(afterClose - beforeOpen)).toBeLessThan(5);
});

test('backup nudge appears after ten local edits', async ({ page }) => {
  await freshPage(page);
  await page.evaluate(() => {
    localStorage.setItem(
      'recipe_journal_prefs',
      JSON.stringify({
        recentSearches: [],
        lastFilter: 'all',
        defaultRating: 0,
        editsSinceLastExport: 10,
        lastNudgeDismissedAt: 0,
        recentlyViewed: [],
        recentManualRatings: [],
        v: 1,
      })
    );
  });

  await page.reload();
  await page.locator('.recipe-grid .card').first().waitFor();
  await expect(page.locator('#toast')).toContainText('10 changes since your last backup.');
  await expect(page.locator('#toast button')).toHaveCount(2);
});

test('card tags add an active filter', async ({ page }) => {
  await freshPage(page);
  const firstCardTag = page.locator('.recipe-grid [data-card-tag]').first();
  await expect(firstCardTag).toBeVisible();
  const activeSlug = await firstCardTag.getAttribute('data-card-tag');
  expect(activeSlug).toBeTruthy();

  await firstCardTag.click();
  await expect(page.locator(`#activeFilters [data-clear-tag="${activeSlug}"]`)).toBeVisible();
});

test('editing preserves cuisines outside the default select list', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('recipe_journal_v3', JSON.stringify({
      recipes: [{
        id: 'custom-british',
        name: 'Sunday Roast',
        cuisine: 'British',
        source: '',
        location: '',
        ingredients: '',
        instructions: '',
        preptime: '',
        cooktime: '',
        servings: '',
        tags: ['comfort-food'],
        notes: '',
        url: '',
        date: '',
        rating: 0,
      }],
      tagRegistry: {
        'comfort-food': {
          slug: 'comfort-food',
          label: 'Comfort Food',
          color: '#c9a84c',
          colorIndex: 0,
          pinned: false,
          createdAt: '2026-04-17T00:00:00.000Z',
          updatedAt: '2026-04-17T00:00:00.000Z',
        },
      },
    }));
    localStorage.removeItem('recipe_journal_schema_version');
  });
  await page.reload();

  await expect(page.locator('.recipe-grid .card')).toHaveCount(1);
  await page.locator('.recipe-grid .card').first().click();
  await page.locator('#editViewBtn').click();
  await expect(page.locator('#f-cuisine')).toHaveValue('British');
  await page.locator('#saveFormBtn').click();
  await expect(page.locator('#formModal')).not.toHaveClass(/open/);

  await page.reload();
  await expect(page.locator('.recipe-grid .card .card-cuisine')).toHaveText('British');
  const storedCuisine = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('recipe_journal_v3') || '{}');
    return stored?.recipes?.[0]?.cuisine || '';
  });
  expect(storedCuisine).toBe('British');
});

test('renaming an active tag keeps the active filter in sync', async ({ page }) => {
  await freshPage(page);
  const firstCardTag = page.locator('.recipe-grid [data-card-tag]').first();
  await expect(firstCardTag).toBeVisible();
  const activeSlug = await firstCardTag.getAttribute('data-card-tag');
  const currentLabel = (await firstCardTag.textContent())?.trim() || 'Tag';
  const nextLabel = `${currentLabel} Renamed`;
  const nextSlug = nextLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  await firstCardTag.click();
  await expect(page.locator(`#activeFilters [data-clear-tag="${activeSlug}"]`)).toBeVisible();

  await page.locator('#openTagManagerBtn').click();
  await page.locator(`[data-edit-label="${activeSlug}"]`).click();
  const input = page.locator(`[data-tag-rename-input="${activeSlug}"]`);
  await input.fill(nextLabel);
  await input.press('Enter');

  await expect(page.locator(`#activeFilters [data-clear-tag="${nextSlug}"]`)).toBeVisible();
  await expect(page.locator(`#activeFilters [data-clear-tag="${activeSlug}"]`)).toHaveCount(0);
});

test('escaping inline tag rename does not close the tag manager modal', async ({ page }) => {
  await freshPage(page);
  await page.locator('#openTagManagerBtn').click();
  const firstLabel = page.locator('[data-edit-label]').first();
  const slug = await firstLabel.getAttribute('data-edit-label');
  expect(slug).toBeTruthy();

  await firstLabel.click();
  const input = page.locator(`[data-tag-rename-input="${slug}"]`);
  await expect(input).toBeVisible();
  await input.press('Escape');

  await expect(page.locator('#tagManagerModal')).toHaveClass(/open/);
  await expect(input).toHaveCount(0);
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

test('import validates recipes before merge and reports dropped invalid rows', async ({ page }) => {
  await freshPage(page);
  await page.locator('.recipe-grid .card').first().waitFor();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#importFile').setInputFiles({
    name: 'recipes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 4,
        recipes: [
          {
            id: 123,
            name: 'Imported Rigatoni',
            cuisine: 'Italian',
            rating: 99,
            url: 'javascript:alert(1)',
            image: 'javascript:alert(2)',
            extraField: 'strip me',
          },
          {
            cuisine: 'Italian',
            notes: 'missing name should drop',
          },
        ],
      })
    ),
  });

  await expect(page.locator('#toast')).toContainText('Dropped 1 invalid recipe');

  await page.locator('#searchInput').fill('Imported Rigatoni');
  await expect(page.locator('.recipe-grid .card')).toHaveCount(1);
  await expect(page.locator('.recipe-grid .card .card-title')).toHaveText('Imported Rigatoni');
  await expect(page.locator('.recipe-grid .card .card-stars')).toContainText('★');

  await page.locator('.recipe-grid .card').first().click();
  await expect(page.locator('#viewModal')).toHaveClass(/open/);
  await expect(page.locator('#v-name')).toHaveText('Imported Rigatoni');
  await expect(page.locator('#viewBody')).not.toContainText('Original Source URL');
  await expect(page.locator('#viewBody')).not.toContainText('javascript:alert(1)');
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
