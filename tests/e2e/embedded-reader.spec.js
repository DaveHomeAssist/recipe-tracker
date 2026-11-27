import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('embedded Journal loads only public recipes even with family credentials and cached data', async ({ page }) => {
  await page.addInitScript(() => {
    window.RECIPE_TRACKER_CONFIG = { USE_REMOTE_BACKEND: true, PUBLIC_READER: true, apiBaseUrl: '/api' };
    localStorage.setItem('recipe_journal_session', JSON.stringify({
      token: 'test-family-session',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    localStorage.setItem('recipe_journal_v3', JSON.stringify({
      recipes: [{ id: 'cached-family', name: 'Private recipe fixture' }],
      tagRegistry: {},
    }));
    localStorage.setItem('recipe_journal_prefs', JSON.stringify({
      filters: { search: 'Private search fixture' },
      recentSearches: ['Private search fixture'],
    }));
  });
  const requests = [];
  await page.route('**/api/v1/**', (route) => {
    requests.push(new URL(route.request().url()).pathname);
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: { data: [{
      id: 'public-recipe',
      name: 'Homemade Pita Bread',
      url: 'https://cooking.nytimes.com/recipes/1016071-homemade-pita-bread',
      ingredients: 'Flour and water',
      instructions: 'Bake.',
    }] } });
  });
  await page.route('**/mirror-test.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<iframe title="Mirror" width="1000" height="750" src="./index.html" sandbox="allow-same-origin allow-scripts allow-modals"></iframe>',
  }));
  await page.route('**/build/public/recipes.json', (route) => route.fulfill({ json: [] }));
  await page.route('**/DT-Pita-Bread-gwkl-facebookJumbo.jpg', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
  }));
  await page.goto('./mirror-test.html');
  const reader = page.frameLocator('iframe');
  await expect(reader.getByRole('searchbox')).toHaveValue('');
  await expect(reader.getByText('Private recipe fixture')).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Sign in to edit' })).toBeHidden();
  await expect(reader.getByRole('link', { name: 'Kitchen' })).toBeHidden();
  const card = reader.locator('.card').filter({ hasText: 'Homemade Pita Bread' });
  await expect(card.locator('img')).toBeVisible();
  await card.click();
  await expect(reader.getByRole('button', { name: 'Print recipe' })).toBeVisible();
  await expect(reader.locator('#recipeActions')).toBeHidden();
  expect(requests).toEqual(['/api/v1/public-recipes']);
});

test('public new window link runs as the anonymous reader without sign in or deals tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.RECIPE_TRACKER_CONFIG = { USE_REMOTE_BACKEND: true, PUBLIC_READER: true, apiBaseUrl: '/api' };
    localStorage.setItem('recipe_journal_session', JSON.stringify({
      token: 'test-family-session',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    localStorage.setItem('recipe_journal_prefs', JSON.stringify({
      filters: { search: 'Stale search fixture' },
      recentSearches: ['Stale search fixture'],
    }));
  });
  const requests = [];
  await page.route('**/api/v1/**', (route) => {
    requests.push(new URL(route.request().url()).pathname);
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: { data: [{
      id: 'public-recipe',
      name: 'Homemade Pita Bread',
      ingredients: 'Flour and water',
      instructions: 'Bake.',
    }] } });
  });
  await page.route('**/build/public/recipes.json', (route) => route.fulfill({ json: [] }));
  await page.goto('./index.html?embed=public');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('.card').filter({ hasText: 'Homemade Pita Bread' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to edit' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Black Friday' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Kitchen' })).toBeHidden();
  await expect(page.locator('#libraryTab')).toHaveAttribute('href', './index.html?embed=public');
  expect(requests).toEqual(['/api/v1/public-recipes']);
});
