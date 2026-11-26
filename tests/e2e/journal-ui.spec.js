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

async function expectReadableRecipeDetail(dialog) {
  const ratios = await dialog.evaluate((modal) => {
    function luminance(color) {
      const linearChannels = color.match(/[\d.]+/g).map((channel) => {
        const value = Number(channel) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      const [red, green, blue] = linearChannels;
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }

    const background = luminance(getComputedStyle(modal).backgroundColor);
    const selectors = ['.view-subtitle', '.view-label', '.ing-list li', '.method-text'];
    return selectors.map((selector) => {
      const foreground = luminance(getComputedStyle(modal.querySelector(selector)).color);
      const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      return { selector, ratio };
    });
  });
  for (const { selector, ratio } of ratios) {
    expect(ratio, selector + ' contrast against the recipe surface').toBeGreaterThanOrEqual(4.5);
  }
}

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
    const banner = page.locator('.library-heading');
    await expect(banner).toHaveCSS('background-image', /banner-light\.webp/);
    const inspector = page.locator('#recipeInspector');
    await card.click();
    await expectReadableRecipeDetail(inspector);
    await page.getByRole('button', { name: /Close recipe|Back to recipes/ }).click();

    await page.getByRole('button', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(banner).toHaveCSS('background-image', /banner-dark\.webp/);
    const search = page.getByRole('searchbox', { name: 'Search recipes' });
    await search.fill('unmatched-recipe');
    const illustration = page.locator('.empty-search-art');
    await expect(illustration).toBeInViewport();
    await expect.poll(() => illustration.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    expect(await fit()).toBe(true);
    await search.fill('gougeres');
    await expect(illustration).toHaveCount(0);
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole('button', { name: 'Print recipe' })).toBeVisible();
    await expectReadableRecipeDetail(inspector);
    await page.emulateMedia({ media: 'print' });
    await expectReadableRecipeDetail(inspector);
    await expect(page.locator('#libraryBrowser')).toBeHidden();
    await expect(page.locator('.app-masthead')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print recipe' })).toBeHidden();
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
