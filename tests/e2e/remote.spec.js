import { test, expect } from '@playwright/test';

test('remote mode adds a recipe, syncs to the mocked Notion backend, and reload persists it', async ({ page }) => {
  const notionRows = [];
  const sessionToken = 'session-token';
  let recipeListRequests = 0;

  await page.addInitScript(() => {
    window.RECIPE_TRACKER_CONFIG = {
      USE_REMOTE_BACKEND: true,
      apiBaseUrl: '/api',
    };
    try {
      const now = Date.now();
      localStorage.setItem('recipe_journal_session', JSON.stringify({
        token: 'session-token',
        scope: 'recipe_journal',
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      }));
    } catch {}
  });

  await page.route('**/api/log/client-error', async (route) => {
    await route.fulfill({
      status: 204,
      body: '',
    });
  });

  await page.route('**/api/v1/health', async (route) => {
    const auth = route.request().headers()['authorization'];
    if (auth !== `Bearer ${sessionToken}`) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, authenticated: true }),
    });
  });

  await page.route('**/api/v1/recipes', async (route) => {
    const request = route.request();
    const auth = request.headers()['authorization'];
    if (auth !== `Bearer ${sessionToken}`) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }),
      });
      return;
    }

    if (request.method() === 'GET') {
      recipeListRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: notionRows }),
      });
      return;
    }

    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      const recipe = {
        ...body,
        version: 1,
      };
      notionRows.unshift(recipe);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: recipe.id,
            version: recipe.version,
            recipe,
          },
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/v1/recipes/*', async (route) => {
    const request = route.request();
    const auth = request.headers()['authorization'];
    if (auth !== `Bearer ${sessionToken}`) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }),
      });
      return;
    }

    if (request.method() === 'GET') {
      const id = request.url().split('/').pop();
      const recipe = notionRows.find((row) => String(row.id) === String(id));
      await route.fulfill({
        status: recipe ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(recipe ? { data: { recipe } } : { error: { code: 'NOT_FOUND', message: 'Recipe not found' } }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/index.html');

  await page.locator('#openAddBtn').click();
  const uniqueName = `Remote Recipe ${Date.now()}`;
  await page.locator('#f-name').fill(uniqueName);
  await page.locator('#f-ingredients').fill('Water');
  await page.locator('#f-instructions').fill('Heat');
  await page.locator('#saveFormBtn').click();
  await expect(page.locator('#formModal')).not.toHaveClass(/open/);

  expect(notionRows.some((recipe) => recipe.name === uniqueName)).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/index\.html/);
  expect(recipeListRequests).toBeGreaterThanOrEqual(1);
  expect(notionRows.some((recipe) => recipe.name === uniqueName)).toBe(true);
});
