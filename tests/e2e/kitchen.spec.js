import { expect, test } from '@playwright/test';

const recipe = {
  id: 'kitchen-handoff-fixture',
  name: 'Weeknight gougères',
  cuisine: 'French',
  ingredients: '1 cup flour',
  instructions: 'Bake until golden.',
  tags: ['family-favorite'],
};

const cases = [
  {
    format: 'current Journal state',
    stored: {
      recipes: [recipe],
      tagRegistry: { 'family-favorite': { slug: 'family-favorite', label: 'Bake With Dad' } },
    },
    tagSearch: 'bake with dad',
  },
  {
    format: 'legacy recipe array',
    stored: [{ ...recipe, tags: 'Family Favorite' }],
    tagSearch: 'family favorite',
  },
];

for (const { format, stored, tagSearch } of cases) {
  test(`Kitchen can find and open a recipe from ${format}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('recipe_journal_v3', JSON.stringify(value));
    }, stored);

    await page.goto('./kitchen.html');
    await page.getByRole('button', { name: 'Cook', exact: true }).click();
    await page.locator('#pick-cook').click();

    const result = page.locator('.recipe-row').filter({ hasText: recipe.name });
    await expect(result).toBeVisible();
    const search = page.getByPlaceholder('Search 1 recipes…');
    await search.fill('no matching recipe');
    await expect(result).toHaveCount(0);
    await search.fill(tagSearch);
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.locator('.cook-overlay')).toContainText(recipe.name);
    await expect(page.locator('.cook-overlay')).toContainText('Bake until golden.');
  });
}

test('Big Game grocery review preserves source amounts and hands off to a private trip link', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    localStorage.setItem('recipe_journal_v3', JSON.stringify([{
      id: 'ducasse',
      name: 'Alain Ducasse’s Gougères Recipe',
      url: 'https://www.foodandwine.com/recipes/alain-ducasses-gougeres',
      servings: 'About 28 gougères',
      ingredients: '4 large eggs\n1 cup carrots\n1 ounce carrots\n3½ ounces shredded Gruyère, plus more for topping',
    }]));
  });
  await page.goto('./kitchen.html#menu=big-game');
  await expect(page.getByRole('heading', { name: 'Big Game Souper Party' })).toBeVisible();
  await page.getByRole('button', { name: 'Review gougères groceries' }).click();
  await expect(page.getByText('Saved yield: About 28 gougères', { exact: false })).toBeVisible();

  const decision = (line) => page.getByLabel(`Shopping decision for ${line}`, { exact: true });
  const output = page.getByLabel('Grocery handoff');
  const copy = page.getByRole('button', { name: 'Copy grocery list' });
  await expect(copy).toBeDisabled();
  await page.getByLabel('Recipe batches').fill('2');
  await page.getByRole('button', { name: 'Set batches' }).click();
  await expect(page.getByText('Recipe needs 8 count')).toBeVisible();
  await decision('4 large eggs').selectOption('skip');
  await decision('1 cup carrots').selectOption('garden');
  await page.getByLabel('Confirmed garden amount (cup)').fill('0.5');
  await decision('1 ounce carrots').selectOption('buy');
  await decision('3½ ounces shredded Gruyère, plus more for topping').selectOption('buy');
  await expect(copy).toBeDisabled();
  await page.getByLabel('Reviewed shopping line (item and amount)').fill('Gruyère · 7 oz plus topping');
  await expect(copy).toBeEnabled();
  await expect(output).toHaveValue('1 1/2 cup carrots\n2 oz carrots\nGruyère · 7 oz plus topping');

  const link = page.getByRole('link', { name: 'Open Lisa’s list' });
  await expect(link).toBeHidden();
  await page.getByLabel('Lisa’s Notion trip link').fill('https://notion.so.example.com/invalid');
  await page.getByRole('button', { name: 'Set link' }).click();
  await expect(page.getByText('Use a secure Notion page or database view link.')).toBeVisible();
  await expect(link).toBeHidden();
  const trip = 'https://app.notion.com/p/private-trip?v=private-view';
  await page.getByLabel('Lisa’s Notion trip link').fill(trip);
  await page.getByRole('button', { name: 'Set link' }).click();
  await expect(link).toHaveAttribute('href', trip);
  await expect.poll(() => page.evaluate(() => ({
    pageFits: document.documentElement.scrollHeight <= document.documentElement.clientHeight &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    pantry: localStorage.getItem('pantry_v1'),
    existingShop: localStorage.getItem('shopping_list_v1'),
  }))).toEqual({ pageFits: true, pantry: null, existingShop: null });

  await page.reload();
  await page.getByRole('button', { name: 'Review gougères groceries' }).click();
  await expect(link).toHaveAttribute('href', trip);
  await expect(output).toBeEmpty();
});

for (const [width, height] of [[667, 375], [820, 1180]]) {
  test(`Kitchen tabs remain tappable at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./kitchen.html');
    const tabs = page.getByRole('navigation', { name: 'Kitchen views' }).getByRole('button');
    await expect(tabs).toHaveCount(5);
    for (const tab of await tabs.all()) {
      await expect(tab).toBeInViewport();
      const box = await tab.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
}
