import { expect, test } from '@playwright/test';

test('captures autosave mutation before popup and frame navigation', async ({ page, context }) => {
  await page.goto(`data:text/html,${encodeURIComponent(`<!doctype html><button id="popup-button">open</button><input id="field"><iframe srcdoc="<button id='inside'>inside</button>"></iframe><script>window.effects=[];document.getElementById('field').oninput=event=>effects.push(event.target.value);document.getElementById('popup-button').onclick=()=>window.open('about:blank','_blank')</script>`)}`);
  await page.locator('#field').fill('KRMAR78');
  expect(await page.evaluate(() => (globalThis as unknown as { effects:string[] }).effects)).toEqual(['KRMAR78']);
  const popupPromise = context.waitForEvent('page');
  await page.locator('#popup-button').click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('about:blank');
  await expect(page.frameLocator('iframe').locator('#inside')).toBeVisible();
});
