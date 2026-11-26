import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const picks = [
  { id: 'starter', name: 'Alain Ducasse’s Gougères Recipe', url: 'https://www.foodandwine.com/recipes/alain-ducasses-gougeres?utm_source=journal' },
  { id: 'vegetarian', name: 'Biscuit Vegetable Pot Pie Casserole', url: 'https://sallysbakingaddiction.com/biscuit-vegetable-pot-pie/' },
  { id: 'rolls', name: 'Soft Dinner Rolls Recipe', url: 'https://sallysbakingaddiction.com/soft-dinner-rolls/' },
  { id: 'dessert', name: 'Sweet Potato Cheesecake', url: 'https://www.mybakingaddiction.com/sweet-potato-cheesecake/' },
].map((recipe) => ({ ...recipe, cuisine: 'American', ingredients: 'Flour', instructions: 'Bake until ready.' }));

const duplicate = { id: 'old-dessert', name: 'Old cheesecake bookmark', url: picks[3].url };
const unrelated = { id: 'unrelated', name: 'Summer Sangria', url: 'https://example.com/sangria' };
const invalid = { id: 'invalid', name: 'Bad URL recipe', url: 'https://[' };

test('Thanksgiving uses the active library, groups matching recipes, and opens the existing reader', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((recipes) => {
    localStorage.setItem('recipe_journal_v3', JSON.stringify({ recipes, tagRegistry: {} }));
  }, [unrelated, invalid, duplicate, ...picks]);
  await page.goto('./index.html');
  await page.getByRole('searchbox', { name: 'Search recipes' }).fill('sangria');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Thanksgiving', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanksgiving', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Thanksgiving', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.thanksgiving-course h2')).toHaveText(['Starters', 'Mains', 'Sides & bread', 'Desserts']);
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(page.getByText(duplicate.name)).toHaveCount(0);
  await expect(page.getByText(unrelated.name)).toHaveCount(0);

  const starter = page.locator('.card[data-id="starter"]');
  await starter.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#v-name')).toHaveText(picks[0].name);
  await expect(page.locator('#viewBody')).toContainText('Bake until ready.');
  await expect(page.getByRole('button', { name: 'Print recipe' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cook this recipe' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(starter).toBeFocused();

  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search recipes' })).toHaveValue('sangria');
  await expect(page.locator('.card')).toHaveCount(1);
});

test('Thanksgiving fits alongside Black Friday on a phone and returns from a public recipe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.setFixedTime(new Date('2026-11-26T18:00:00Z'));
  await page.addInitScript(() => {
    window.RECIPE_TRACKER_CONFIG = { USE_REMOTE_BACKEND: true, PUBLIC_READER: true, apiBaseUrl: '/api' };
  });
  await page.route('**/api/v1/public-recipes', (route) => route.fulfill({ json: { data: [unrelated, ...picks] } }));
  await page.goto('./index.html?collection=thanksgiving');
  const nav = page.getByRole('navigation', { name: 'Recipe Journal' });
  const blackFriday = nav.getByRole('link', { name: 'Black Friday' });
  await expect(blackFriday).toBeVisible();
  const bounds = await blackFriday.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);

  const card = page.locator('.card[data-id="starter"]');
  await card.click();
  await expect(page.getByRole('button', { name: 'Print recipe' })).toBeVisible();
  await expect(page.locator('#recipeActions')).toBeHidden();
  await page.goBack();
  await expect(page.locator('#recipeInspector')).toBeHidden();
  await expect(card).toBeFocused();
  expect(page.url()).toContain('?collection=thanksgiving');
});
