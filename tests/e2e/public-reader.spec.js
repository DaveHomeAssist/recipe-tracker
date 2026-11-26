import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('public visitors browse without a code, and family sign-in restores editing', async ({ page }) => {
  await page.addInitScript(() => {
    window.RECIPE_TRACKER_CONFIG = {
      PUBLIC_READER: true,
      USE_REMOTE_BACKEND: true,
      apiBaseUrl: '/api',
    };
    if (!localStorage.getItem('recipe_journal_v3')) {
      localStorage.setItem('recipe_journal_v3', JSON.stringify({
        recipes: [{ id: 'private', name: 'Private cache marker' }],
        tagRegistry: {},
      }));
    }
  });

  const publicRecipe = { id: 'public-0', name: 'Public gougères', ingredients: '1 cup flour', instructions: 'Bake.' };
  await page.route('**/api/v1/public-recipes', async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({ json: { data: [publicRecipe] } });
  });
  await page.route('**/api/v1/session', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: {
        token: 'synthetic-family-session',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      } });
    } else {
      await route.fulfill({ json: { authenticated: true, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });
    }
  });
  await page.route('**/api/v1/recipes', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-family-session');
    await route.fulfill({ json: { data: [{ ...publicRecipe, id: 'family-1', notes: 'Private family note' }] } });
  });

  let deleteRequests = 0;
  await page.route('**/api/v1/recipes/family-1', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().headers().authorization).toBe('Bearer synthetic-family-session');
    deleteRequests += 1;
    if (deleteRequests === 1) {
      await route.fulfill({ status: 409, json: { error: { message: 'Recipe changed on another device' } } });
    } else {
      await route.fulfill({ status: 204 });
    }
  });

  await page.goto('./index.html');
  await expect(page.getByRole('heading', { name: 'Enter Family Access Code' })).toHaveCount(0);
  const card = page.locator('.recipe-grid .card').filter({ hasText: publicRecipe.name });
  await expect(card).toBeVisible();
  await expect(page.getByText('Private cache marker')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Recipe', exact: true })).toBeHidden();
  await card.click();
  await expect(page.getByRole('button', { name: 'Print recipe' })).toBeVisible();
  await expect(page.locator('#recipeActions')).toBeHidden();
  await expect(page.locator('#cookViewLink')).toBeHidden();
  await page.getByRole('button', { name: 'Close recipe', exact: true }).click();

  await page.goto('./kitchen.html');
  await expect(page.getByText('Kitchen is for family members.', { exact: false })).toBeVisible();
  await expect(page.locator('#plan-grid')).toHaveCount(0);
  await page.getByRole('link', { name: 'Library' }).click();

  await page.getByRole('button', { name: 'Sign in to edit' }).click();
  await page.getByLabel('Access Code').fill('synthetic-family-code');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Recipe', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kitchen', exact: true })).toBeVisible();
  const signedInCard = page.locator('.recipe-grid .card[data-id="family-1"]');
  await expect(signedInCard).toBeVisible();
  await signedInCard.click();
  await expect(page.locator('#viewBody')).toContainText('Private family note');
  await page.locator('#recipeActions summary').click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cook this recipe' })).toBeVisible();

  const inspector = page.locator('#recipeInspector');
  const confirm = page.getByRole('dialog', { name: 'Delete recipe?' });
  await inspector.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toContainText(publicRecipe.name);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(inspector).toBeVisible();
  expect(deleteRequests).toBe(0);

  await inspector.locator('summary').click();
  await inspector.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete recipe', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Delete failed: Recipe changed on another device');
  await expect(inspector).toBeVisible();
  await expect(signedInCard).toHaveAttribute('aria-current', 'true');

  await inspector.locator('summary').click();
  await inspector.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete recipe', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(inspector).toBeHidden();
  await expect(signedInCard).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Search recipes' })).toBeFocused();
  expect(deleteRequests).toBe(2);
});

test('guest cards show matched source photos and collapse failed images', async ({ page }) => {
  await page.addInitScript(() => {
    window.RECIPE_TRACKER_CONFIG = { PUBLIC_READER: true, USE_REMOTE_BACKEND: true };
  });
  const goodImage = 'https://images.example.test/bread.jpg';
  const brokenImage = 'https://images.example.test/soup.jpg';
  await page.route('**/api/v1/public-recipes', (route) => route.fulfill({ json: { data: [
    { id: 'bread', name: 'Bread', url: 'https://recipes.example.test/bread/' },
    { id: 'soup', name: 'Soup', url: 'https://recipes.example.test/soup' },
    { id: 'salad', name: 'Salad', url: 'https://recipes.example.test/salad' },
  ] } }));
  await page.route('**/build/public/recipes.json', (route) => route.fulfill({ json: [
    { url: 'https://recipes.example.test/bread?utm_source=newsletter', image: goodImage },
    { url: 'https://recipes.example.test/soup', image: brokenImage },
    { url: 'https://recipes.example.test/salad?recipe=other', image: goodImage },
  ] }));
  await page.route(goodImage, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
  }));
  await page.route(brokenImage, (route) => route.abort());

  await page.goto('./index.html');
  const bread = page.locator('.card[data-id="bread"] img');
  await expect(bread).toHaveAttribute('src', goodImage);
  await expect.poll(() => bread.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);

  const soup = page.locator('.card[data-id="soup"]');
  await expect(soup.locator('.card-image')).toHaveAttribute('hidden', '');
  await expect(soup.locator('.card-image')).toBeHidden();
  await expect(page.locator('.card[data-id="salad"] img')).toHaveCount(0);
});
