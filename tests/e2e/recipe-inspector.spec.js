import { expect, test } from '@playwright/test';

const firstRecipe = {
  id: 'bread-0',
  name: 'Wood Oven Bread 00',
  cuisine: 'French',
  ingredients: '500g flour\n250ml water',
  instructions: [...Array.from({ length: 125 }, (_, i) => `Step ${i + 1}. Fold the dough and let it rest.`), 'Finish by cooling the loaf on a rack.'].join('\n'),
  servings: '2 loaves',
  url: 'https://example.test/bread',
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((first) => {
    const recipes = [
      first,
      ...Array.from({ length: 35 }, (_, index) => ({
        id: `bread-${index + 1}`,
        name: `Wood Oven Bread ${String(index + 1).padStart(2, '0')}`,
        cuisine: 'French',
        url: 'https://example.test/recipe',
      })),
      { id: 'salad', name: 'Room Temperature Salad', cuisine: 'Italian' },
    ];
    localStorage.setItem('recipe_journal_v3', JSON.stringify({ recipes, tagRegistry: {} }));
    window.print = () => { document.body.dataset.printRequested = 'true'; };
  }, firstRecipe);
});

test('desktop inspector keeps the library interactive and scrolls independently', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./index.html');
  const inspector = page.getByRole('region', { name: firstRecipe.name });
  const firstCard = page.locator('.card[data-id="bread-0"]');
  await firstCard.focus();
  await page.keyboard.press('Enter');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(firstCard).toHaveAttribute('aria-current', 'true');
  const grid = page.locator('#recipeGrid');
  const gridBox = await grid.boundingBox();
  const paneBox = await inspector.boundingBox();
  expect(gridBox.x + gridBox.width).toBeLessThanOrEqual(paneBox.x + 1);
  const detail = page.locator('#viewBody');
  await detail.evaluate((body) => { body.scrollTop = 400; });
  expect(await detail.evaluate((body) => body.scrollTop)).toBeGreaterThan(0);
  expect(await grid.evaluate((element) => element.scrollTop)).toBe(0);
  await grid.evaluate((element) => { element.scrollTop = 300; });
  expect(await detail.evaluate((body) => body.scrollTop)).toBe(400);
  expect(await grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const nextCard = page.locator('.card[data-id="bread-1"]');
  await nextCard.click();
  await expect(nextCard).toHaveAttribute('aria-current', 'true');
  await expect(firstCard).not.toHaveAttribute('aria-current', 'true');
  await expect(detail).toContainText('No ingredients saved.');
  await expect(detail).toContainText('No method saved.');
  await expect(detail.getByRole('link')).toHaveAttribute('href', 'https://example.test/recipe');
  expect(await detail.evaluate((body) => body.scrollTop)).toBe(0);

  const search = page.getByRole('searchbox', { name: 'Search recipes' });
  await search.fill('salad');
  await expect(nextCard).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Wood Oven Bread 01' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#recipeInspector')).toBeHidden();
  await expect(search).toBeFocused();
});

test('mobile Back and browser Back restore the filtered list and its scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./index.html');
  const search = page.getByRole('searchbox', { name: 'Search recipes' });
  await search.fill('wood oven');
  await page.locator('[data-cuisine-filter="French"]').click();
  const card = page.locator('.card[data-id="bread-20"]');
  const grid = page.locator('#recipeGrid');
  await card.scrollIntoViewIfNeeded();
  const before = await grid.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  const inspector = page.locator('#recipeInspector');
  const initialUrl = page.url();
  const initialHistoryLength = await page.evaluate(() => history.length);

  await card.click();
  await expect(inspector).toBeVisible();
  expect(await inspector.boundingBox()).toEqual({ x: 0, y: 0, width: 375, height: 812 });
  await expect(search).toBeHidden();
  await expect(page.getByRole('button', { name: 'Close recipe' })).toBeHidden();
  await page.goBack();
  await expect(inspector).toBeHidden();
  await expect(card).toBeFocused();
  await expect(search).toHaveValue('wood oven');
  await expect(page.locator('.active-filters')).toContainText('French');
  expect(await grid.evaluate((element) => element.scrollTop)).toBe(before);

  await card.click();
  await expect(inspector).toBeVisible();
  await page.getByRole('button', { name: 'Back to recipes', exact: false }).click();
  await expect(inspector).toBeHidden();
  await expect(card).toBeFocused();
  expect(page.url()).toBe(initialUrl);
  await expect.poll(() => page.evaluate(() => history.state?.recipeInspector)).toBeUndefined();
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
  expect(await grid.evaluate((element) => element.scrollTop)).toBe(before);
});

test('print includes the whole recipe and excludes the library and actions', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('.card[data-id="bread-0"]').click();
  await page.getByRole('button', { name: 'Print recipe' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true');

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#libraryBrowser')).toBeHidden();
  await expect(page.locator('.inspector-actions')).toBeHidden();
  await expect(page.locator('#v-name')).toHaveText(firstRecipe.name);
  const detail = page.locator('#viewBody');
  await expect(detail).toContainText('500g flour');
  await expect(detail).toContainText('Finish by cooling the loaf on a rack.');
  await expect(detail.getByRole('link')).toHaveAttribute('href', firstRecipe.url);
  expect(await detail.evaluate((body) => body.scrollHeight <= body.clientHeight + 1)).toBe(true);
  const pdf = await page.pdf();
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
});
