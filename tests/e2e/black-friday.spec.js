import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const cutoff = new Date('2026-12-03T17:15:00Z');
const beforeCutoff = new Date(cutoff.getTime() - 1000);

test('the Journal and Kitchen link to all five deal categories before the cutoff', async ({ page }) => {
  await page.clock.setFixedTime(beforeCutoff);
  await page.goto('./kitchen.html');
  await expect(page.getByRole('link', { name: 'Black Friday', exact: true })).toBeVisible();

  await page.goto('./index.html');
  await page.getByRole('link', { name: 'Black Friday', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Black Friday', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Deal categories' }).getByRole('link')).toHaveCount(5);
  await expect(page.locator('.deal-card')).toHaveCount(86);
  const espresso = page.locator('.deal-card').filter({ hasText: 'De’Longhi Dedica Maestro Plus Espresso Machine' });
  await expect(espresso).toContainText('$237');
  await expect(espresso).toContainText('53% off');
  await expect(espresso.getByRole('link')).toHaveAttribute('href', 'https://www.amazon.com/dp/B0CT2PT244');
  await expect(page.locator('#black-friday-deadline')).toHaveAttribute('datetime', cutoff.toISOString());

  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('link', { name: 'Hosting & Dining' }).click();
  await expect(page.getByRole('heading', { name: 'Hosting & Dining', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});

test('the tab and bookmarked deals expire at the cutoff, even in an open tab', async ({ page }) => {
  await page.clock.install({ time: new Date(beforeCutoff.getTime() - 5000) });
  await page.clock.pauseAt(beforeCutoff);
  await page.goto('./black-friday.html');
  const productLink = page.locator('.deal-link').first();
  await expect(productLink).toBeVisible();
  await productLink.focus();
  await page.clock.fastForward(1000);
  await expect(page.getByRole('heading', { name: 'Black Friday has ended' })).toBeFocused();
  await expect(productLink).toBeHidden();
  await expect(page.getByRole('link', { name: 'Black Friday', exact: true })).toBeHidden();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Black Friday has ended' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the recipe library' }).click();
  await expect(page.getByRole('heading', { name: 'Recipe library' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Black Friday', exact: true })).toBeHidden();

  await page.goto('./kitchen.html');
  await expect(page.getByRole('link', { name: 'Black Friday', exact: true })).toBeHidden();
});
