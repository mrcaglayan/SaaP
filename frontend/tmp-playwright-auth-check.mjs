import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } });
page.on('console', (msg) => console.log(`console:${msg.type()}:${msg.text()}`));
page.on('pageerror', (err) => console.log(`pageerror:${err.message}`));
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/api/') && res.status() >= 400) {
    console.log(`apierror:${res.status()}:${url}`);
  }
});
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[type="email"]').fill('test@example.com');
await page.locator('input[autocomplete="current-password"]').fill('123456');
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForTimeout(6000);
console.log('after-login-url=' + page.url());
if (page.url().includes('/login')) {
  console.log('login-body=' + (await page.locator('body').innerText()).slice(0, 1000).replace(/\s+/g, ' '));
} else {
  await page.goto('http://localhost:5173/app/ayarlar/organizasyon-yonetimi', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  console.log('target-url=' + page.url());
  const body = await page.locator('body').innerText();
  console.log('body-start=' + body.slice(0, 2000).replace(/\s+/g, ' '));
  const autoBtn = page.getByRole('button', { name: /Otomatik alt hesap olustur|Auto-create missing sub-accounts/i });
  console.log('auto-count=' + await autoBtn.count());
  if (await autoBtn.count()) {
    console.log('auto-visible=' + await autoBtn.first().isVisible());
    console.log('auto-enabled=' + await autoBtn.first().isEnabled());
    console.log('auto-box=' + JSON.stringify(await autoBtn.first().boundingBox()));
  }
  await page.screenshot({ path: 'tmp-org-management-auth.png', fullPage: true });
}
await browser.close();
