const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3011/');
  await page.screenshot({ path: 'C:/Users/Z004R4CM/.gemini/antigravity-ide/brain/3f581479-c5d3-4ee1-bc09-400f180ebd28/sut_screenshot1.png' });
  await page.locator('[data-testid="outlet-3-name"]').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/Z004R4CM/.gemini/antigravity-ide/brain/3f581479-c5d3-4ee1-bc09-400f180ebd28/sut_screenshot2.png' });
  await page.getByText('PIN', { exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/Z004R4CM/.gemini/antigravity-ide/brain/3f581479-c5d3-4ee1-bc09-400f180ebd28/sut_screenshot3.png' });
  await browser.close();
})();
