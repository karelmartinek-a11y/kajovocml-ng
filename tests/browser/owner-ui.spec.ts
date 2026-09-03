import { expect, test } from '@playwright/test';

test('OWNER authenticates and every principal workspace is navigable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Vítejte zpět/u })).toBeVisible();
  const username=page.getByLabel('Uživatelské jméno');
  await expect(username).toHaveValue('');
  await expect(page.getByText('KRMAR78',{exact:true})).toHaveCount(0);
  await username.fill('KRMAR78');
  await page.getByLabel('Heslo').fill('local-verification-password');
  await page.getByRole('button', { name: /Pokračovat/u }).click();
  await expect(page.getByText(/Řídicí centrum/u)).toBeVisible();
  await page.getByRole('button', { name: /Generování/u }).click();
  await expect(page.getByText(/Generační workspace/u)).toBeVisible();
  await page.getByRole('button', { name: /Prohlížeč/u }).click();
  await expect(page.getByText(/Browser runtime/u)).toBeVisible();
});
