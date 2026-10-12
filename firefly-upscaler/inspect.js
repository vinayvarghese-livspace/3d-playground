// Dumps the buttons/inputs on the open Firefly tab (including inside shadow DOM)
// to logs/dom-*.json. Use it if Adobe changes the page and a selector stops working.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const cfg = require('./config');

async function main() {
  fs.mkdirSync(cfg.logsDir, { recursive: true });
  const browser = await chromium.connectOverCDP(cfg.cdpUrl);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().includes('firefly.adobe.com'));
  if (!page) throw new Error('No Firefly tab open in the debug Chrome.');

  const elements = await page.evaluate(() => {
    const out = [];
    const interesting = (el) =>
      el.hasAttribute('data-testid') ||
      el.hasAttribute('aria-label') ||
      el.getAttribute('role') ||
      /^(BUTTON|INPUT|SP-BUTTON|SP-ACTION-BUTTON|SP-MENU-ITEM|SP-PICKER|SP-TOAST)$/.test(el.tagName);

    const walk = (root, depth) => {
      root.querySelectorAll('*').forEach((el) => {
        if (interesting(el)) {
          const rect = el.getBoundingClientRect();
          out.push({
            depth,
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            testid: el.getAttribute('data-testid') || undefined,
            role: el.getAttribute('role') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            type: el.getAttribute('type') || undefined,
            disabled: el.hasAttribute('disabled') || undefined,
            visible: rect.width > 0 && rect.height > 0,
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) || undefined
          });
        }
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      });
    };
    walk(document, 0);
    return out;
  });

  const file = path.join(cfg.logsDir, `dom-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ url: page.url(), elements }, null, 2));
  console.log(`Saved ${elements.length} elements to ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
