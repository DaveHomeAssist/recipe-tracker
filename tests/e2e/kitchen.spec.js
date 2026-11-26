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
