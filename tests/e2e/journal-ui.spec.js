import { expect, test } from '@playwright/test';

const storageKey = 'recipe_journal_v3';
const recipe = {
  id: 'gougeres-test',
  name: 'Alain Ducasse’s Gougères',
  cuisine: 'French',
  ingredients: '1 cup flour\n4 eggs',
  instructions: 'Bake until golden.',
  tags: ['baking'],
};

for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
  test(`Journal and Kitchen work within a ${viewport.width}px viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(({ key, item }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify({ recipes: [item], tagRegistry: {} }));
      }
    }, { key: storageKey, item: recipe });

    await page.goto('./index.html');
    const card = page.locator('.recipe-grid .card').filter({ hasText: recipe.name });
    await expect(card).toBeVisible();
    expect((await card.boundingBox()).height).toBeGreaterThan(90);
    const fit = () => page.evaluate(() => {
      const { scrollWidth, scrollHeight, clientWidth, clientHeight } = document.documentElement;
      return scrollWidth <= clientWidth && scrollHeight <= clientHeight;
    });
    expect(await fit()).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('gougeres');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole('button', { name: 'Print recipe' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#main')).toBeHidden();
    await expect(page.locator('#viewBody')).toContainText('1 cup flour');
    await expect(page.locator('#viewBody')).toContainText('Bake until golden.');
    await page.emulateMedia({ media: 'screen' });

    await page.getByRole('link', { name: 'Cook this recipe' }).click();
    await expect(page.getByRole('dialog', { name: recipe.name })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.cook-overlay')).toContainText('Bake until golden.');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cook-overlay')).toHaveCount(0);
    expect(await fit()).toBe(true);

    await expect(page.locator('#sync-label')).toHaveText('On this device');
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await page.getByRole('button', { name: 'Add breakfast recipe for Mon' }).click();
    await page.getByRole('button', { name: recipe.name }).click();
    await expect(page.locator('.plan-entry')).toHaveCount(1);
    await page.getByRole('button', { name: /Shop for this week/ }).click();
    await expect(page.locator('#shop-list')).toContainText('flour');
    await page.locator('#shop-list .shop-item').filter({ hasText: 'flour' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: /Check received/ }).click();
    await page.getByRole('button', { name: 'Pantry', exact: true }).click();
    await expect(page.locator('#pantry-items')).toContainText('flour');
  });
}
