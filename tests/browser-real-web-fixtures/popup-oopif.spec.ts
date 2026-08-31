import { expect, test } from '@playwright/test';

test('captures autosave mutation before popup and frame navigation', async ({ page, context }) => {
  await page.goto(`data:text/html,${encodeURIComponent(`<!doctype html><button id="open">open</button><input id="name"><iframe srcdoc="<button id='inside'>inside</button>"></iframe><script>window.effects=[];name.oninput=()=>effects.push(name.value);open.onclick=()=>window.open('data:text/html,popup','_blank')</script>`)}`);
  await page.locator('#name').fill('KRMAR78');
  expect(await page.evaluate(() => (globalThis as unknown as { effects:string[] }).effects)).toEqual(['KRMAR78']);
  const popupPromise = context.waitForEvent('page');
  await page.locator('#open').click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/^data:text\/html/u);
  await expect(page.frameLocator('iframe').locator('#inside')).toBeVisible();
});
