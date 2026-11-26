import { expect, test } from '@playwright/test';

const cuisines = [
  'Greek', 'Mexican', 'Spanish', 'Thai', 'Mediterranean', 'Middle Eastern',
  'Italian', 'French', 'Chinese', 'American', 'Indian', 'Japanese', 'Other',
];

test('cuisine artwork follows filters and preserves the Library and Thanksgiving headings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((labels) => {
    const recipes = labels.map((cuisine) => ({ id: cuisine, cuisine, name: `${cuisine} test dish` }));
    localStorage.setItem('recipe_journal_v3', JSON.stringify({ recipes, tagRegistry: {} }));
  }, cuisines);
  await page.goto('./index.html');
  const banner = page.locator('.library-heading');
  await expect(banner).toHaveCSS('background-image', /banner-light\.webp/);
  const patterns = new Set();

  for (const cuisine of cuisines) {
    await page.getByRole('button', { name: cuisine, exact: true }).click();
    await expect(page.getByRole('heading', { name: `${cuisine} recipes`, exact: true })).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(1);
    await expect(page.locator('.card')).toContainText(`${cuisine} test dish`);
    const pattern = await banner.evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(pattern).toContain('gradient');
    expect(pattern).not.toContain('.webp');
    patterns.add(pattern);
  }
  expect(patterns.size).toBe(cuisines.length);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await page.getByRole('button', { name: 'Thai', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thai recipes' })).toBeVisible();
  await expect(banner).toHaveCSS('background-image', /repeating-linear-gradient/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

  await page.getByRole('link', { name: 'Thanksgiving', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanksgiving', exact: true })).toBeVisible();
  await expect(banner).toHaveCSS('background-image', /banner-dark\.webp/);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thai recipes' })).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipe library' })).toBeVisible();
  await expect(banner).toHaveCSS('background-image', /banner-dark\.webp/);
});
