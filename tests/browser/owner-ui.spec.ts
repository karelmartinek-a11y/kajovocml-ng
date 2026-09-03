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

test('first password login requires QR-based MFA enrollment', async ({ page }) => {
  const mockSecret='JBSWY3DPEHPK3PXP';
  const enrollmentUri=`otpauth://totp/KajovoCML%20NG:OWNER?secret=${mockSecret}&issuer=KajovoCML%20NG&algorithm=SHA1&digits=6&period=30`;
  await page.route('**/api/v1/session', async route => route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'SESSION_INVALID',message:'Session is invalid'}})}));
  await page.route('**/api/v1/auth/login', async route => {
    const body=route.request().postDataJSON() as {username:string;password:string};
    expect(body).toEqual({username:'manually-entered-owner',password:'correct-password'});
    await route.fulfill({status:200,contentType:'application/json',headers:{'x-csrf-token':'mock-csrf'},body:JSON.stringify({state:'MFA_ENROLLMENT_REQUIRED',csrfToken:'mock-csrf',expiresAt:new Date(Date.now()+600_000).toISOString()})});
  });
  await page.route('**/api/v1/owner/mfa/enroll', async route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({secret:mockSecret,otpauthUri:enrollmentUri,expiresAt:new Date(Date.now()+600_000).toISOString()})}));
  await page.route('**/api/v1/owner/mfa/verify', async route => {
    expect((route.request().postDataJSON() as {code:string}).code).toBe('123456');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({recoveryCodes:['RECOVERY-ONE','RECOVERY-TWO']})});
  });

  await page.goto('/');
  await page.getByLabel('Uživatelské jméno').fill('manually-entered-owner');
  await page.getByLabel('Heslo').fill('correct-password');
  await page.getByRole('button',{name:'Pokračovat'}).click();

  await expect(page.getByRole('heading',{name:'Nastavení dvoufaktorového přihlášení'})).toBeVisible();
  await expect(page.getByRole('img',{name:'QR kód pro registraci dvoufaktorového přihlášení'})).toBeVisible();
  await expect(page.getByLabel('První šestimístný kód')).toBeVisible();
  await expect(page.getByText('KRMAR78',{exact:true})).toHaveCount(0);
  await page.getByLabel('První šestimístný kód').fill('123456');
  await page.getByRole('button',{name:'Ověřit a aktivovat MFA'}).click();
  await expect(page.getByRole('heading',{name:'Recovery kódy'})).toBeVisible();
  await expect(page.getByText('RECOVERY-ONE')).toBeVisible();
});
