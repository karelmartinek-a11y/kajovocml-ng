import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('OWNER authenticates and every principal workspace is navigable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Vítejte zpět/u })).toBeVisible();
  const username=page.getByLabel('Uživatelské jméno');
  await expect(username).toHaveValue('');
  await expect(page.getByText('KRMAR78',{exact:true})).toHaveCount(0);
  await username.fill('explicit-user-input');
  await expect(username).toHaveValue('explicit-user-input');
  await username.fill('');

  const apiKey=process.env.KCML_OWNER_API_KEY;
  test.skip(!apiKey, 'Authenticated production navigation requires KCML_OWNER_API_KEY');
  const session=await page.request.post('/api/v1/auth/api-key-session', {headers:{Authorization:`Bearer ${apiKey}`,'Idempotency-Key':randomUUID()}});
  expect(session.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Provozní přehled/u })).toBeVisible();
  await page.goto('/generation');
  await expect(page.getByText(/Výrobní workspace/u)).toBeVisible();
  await page.goto('/browser');
  await expect(page.getByRole('heading', { name: /Browser relace a automatizace/u })).toBeVisible();
});
