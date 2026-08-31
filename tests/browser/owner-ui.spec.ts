import { expect, test } from '@playwright/test';

test('OWNER authenticates and every principal workspace is navigable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Přihlášení vlastníka/u })).toBeVisible();
  await page.getByLabel('Uživatelské jméno').fill('KRMAR78');
  await page.getByLabel('Heslo').fill('local-verification-password');
  await page.getByRole('button', { name: /Přihlásit/u }).click();
  await expect(page.getByText(/Řídicí centrum/u)).toBeVisible();
  await page.getByRole('button', { name: /Generování/u }).click();
  await expect(page.getByText(/Generační workspace/u)).toBeVisible();
  await page.getByRole('button', { name: /Prohlížeč/u }).click();
  await expect(page.getByText(/Browser runtime/u)).toBeVisible();
});
