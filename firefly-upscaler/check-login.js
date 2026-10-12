// Confirms the debug Chrome is reachable and signed in to Firefly.
const { chromium } = require('playwright-core');
const cfg = require('./config');

async function main() {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes('firefly.adobe.com'));
  if (!page) {
    page = await context.newPage();
    await page.goto(cfg.pageUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(5000);

  const signIn = await page
    .locator('sp-button:has-text("Sign in"), button:has-text("Sign in")')
    .first()
    .isVisible()
    .catch(() => false);

  console.log(`Firefly tab: ${page.url()}`);
  console.log(signIn ? 'NOT signed in - log in in the Chrome window, then run this again.' : 'Signed in - ready to run upscale.js');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Cannot connect to Chrome at ${cfg.cdpUrl}: ${err.message}`);
    process.exit(1);
  });
