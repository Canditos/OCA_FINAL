const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3011/');
  await page.waitForTimeout(2000);
  
  // Click the block containing CCS (probably a div)
  const ccsEl = page.locator('div').filter({ hasText: /^CCS$/ }).first();
  if (await ccsEl.isVisible()) {
      await ccsEl.click();
  } else {
      await page.click('text=CCS');
  }
  await page.waitForTimeout(2000);
  
  // Click the PIN block
  const pinEl = page.locator('div, button').filter({ hasText: /^PIN$/ }).first();
  if (await pinEl.isVisible()) {
      await pinEl.click();
  } else {
      // fallback
      await page.locator(':text("PIN")').first().click();
  }
  await page.waitForTimeout(2000);
  
  // Dump the HTML body to understand the keypad structure
  const html = await page.innerHTML('body');
  require('fs').writeFileSync('sut-keypad.html', html);
  
  await page.screenshot({ path: 'sicharge-cp-keypad.png', fullPage: true });
  await browser.close();
})();
