// Drives the Firefly upscale page in the signed-in debug Chrome. Shared by upscale.js (batch) and server.js (service).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const cfg = require('./config');

const SEL = {
  uploadButton: '[data-testid="empty-state-upload-button"], sp-dropzone sp-button:has-text("Upload")',
  fileInput: '#empty-state-uploader-file-input',
  modalText: '[data-testid="intro-modal-description"]',
  modalOk: '[data-testid="intro-modal-cta"]',
  storageContinue: '[data-testid="insufficient-storage-modal-continue"]',
  upscaleTool: '[data-testid="upscale-button"]',
  scalePicker: '[data-testid="image-editor-upscale-scale-picker"] sp-picker',
  editNew: '[data-testid="edit-new-button"]',
  generate: '[data-testid="upscale-generate-button"]',
  download: 'sp-action-button.download-button',
  errorToast: 'sp-toast[variant="negative"], sp-toast[variant="error"]',
  signIn: 'sp-button:has-text("Sign in"), button:has-text("Sign in")'
};

const RATE_LIMIT_TEXT = /speed racer|too many|rate limit|try again later|limit reached|slow down|wait a (few|moment)/i;
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');
const DL_DIR = path.join(os.tmpdir(), 'firefly-upscaler-downloads');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

class RateLimitError extends Error {}
class NotSignedInError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.mkdirSync(cfg.logsDir, { recursive: true });
  fs.appendFileSync(path.join(cfg.logsDir, 'run.log'), line + os.EOL);
}

function redact(text) {
  return String(text)
    .replace(/(bearer\s+)[\w.\-~+/=]+/gi, '$1***')
    .replace(/("?(?:access_?token|refresh_?token|id_?token|token|authorization|x-api-key|signature|sig)"?\s*[:=]\s*"?)[^"&,\s}]+/gi, '$1***')
    .replace(/([?&](?:X-Amz-[^=]+|Signature|sig|token|se|sp|sv|sr|skoid|sktid|skt|ske|sks|skv)=)[^&]+/gi, '$1***');
}

function attachNetworkLogger(page, state) {
  const file = path.join(cfg.logsDir, `network-${RUN_ID}.jsonl`);
  page.on('response', async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (type !== 'xhr' && type !== 'fetch') return;
    const url = res.url();
    if (!/adobe|firefly/i.test(url)) return;

    if (res.status() === 429) state.rateLimited = true;
    if (!cfg.logNetwork) return;

    const entry = {
      time: new Date().toISOString(),
      method: req.method(),
      status: res.status(),
      url: redact(url)
    };
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('json')) {
      try {
        entry.body = redact((await res.text()).slice(0, 800));
      } catch (_) {}
    }
    fs.appendFile(file, JSON.stringify(entry) + os.EOL, () => {});
  });
}

async function textOf(locator) {
  return ((await locator.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
}

// Firefly shows pop-ups for rate limits ("Whoa there, speed racer!"), first-use intros and storage warnings.
async function handleModals(page) {
  const descriptions = page.locator(SEL.modalText);
  const count = await descriptions.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const desc = descriptions.nth(i);
    if (!(await desc.isVisible().catch(() => false))) continue;
    const text = await textOf(desc);
    const shot = path.join(cfg.logsDir, `popup-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    const ok = page.locator(SEL.modalOk).filter({ visible: true }).first();
    await ok.click({ timeout: 3000 }).catch(() => {});
    if (RATE_LIMIT_TEXT.test(text)) throw new RateLimitError(text);
    log(`  Closed Firefly pop-up: ${text.slice(0, 80)}`);
  }

  const storage = page.locator(SEL.storageContinue).first();
  if (await storage.isVisible().catch(() => false)) {
    log('  Firefly warned about cloud storage, continuing');
    await storage.click().catch(() => {});
  }
}

async function checkForError(page, state) {
  if (state.rateLimited) throw new RateLimitError('HTTP 429 from Firefly');
  await handleModals(page);
  const toast = page.locator(SEL.errorToast).first();
  if (await toast.isVisible().catch(() => false)) {
    const text = await textOf(toast);
    if (RATE_LIMIT_TEXT.test(text)) throw new RateLimitError(text);
    if (text) throw new Error(`Firefly error: ${text}`);
  }
}

async function firstVisible(page, selectors, timeout, state) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (state) await checkForError(page, state);
    for (const [name, sel] of Object.entries(selectors)) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) return name;
    }
    await sleep(500);
  }
  return null;
}

// After a finished upscale, "Edit new" returns to the empty upload screen without reloading the page.
async function startNewFromEditor(page) {
  if (!page.url().includes('workflow=upscaleImage')) return false;
  const editNew = page.locator(SEL.editNew).filter({ visible: true }).first();
  if (!(await editNew.isVisible().catch(() => false))) return false;
  if ((await editNew.getAttribute('disabled').catch(() => null)) !== null) return false;
  await handleModals(page);
  await editNew.click().catch(() => {});
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if ((await page.locator(SEL.fileInput).count()) > 0) return true;
    if (await page.locator(SEL.uploadButton).filter({ visible: true }).first().isVisible().catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}

async function openFreshPage(page) {
  if (await startNewFromEditor(page)) return;
  await page.goto(cfg.pageUrl, { waitUntil: 'domcontentloaded', timeout: cfg.pageLoadTimeoutMs });
  const found = await firstVisible(
    page,
    { signIn: SEL.signIn, upload: SEL.uploadButton, editNew: SEL.editNew },
    cfg.pageLoadTimeoutMs
  );
  if (found === 'signIn') throw new NotSignedInError('Not signed in to Firefly. Log in in the upscaler Chrome window.');
  if (!found) throw new Error('Upscale page did not load (upload button not found).');
  await handleModals(page);

  // Firefly reopens the previous image after a reload; "Edit new" brings back the empty upload screen.
  await sleep(2000);
  const hasInput = (await page.locator(SEL.fileInput).count()) > 0;
  const hasUpload = await page.locator(SEL.uploadButton).filter({ visible: true }).first().isVisible().catch(() => false);
  if (!hasInput && !hasUpload) {
    await page.locator(SEL.editNew).first().click();
    const ready = await firstVisible(page, { input: SEL.fileInput, upload: SEL.uploadButton }, 20000);
    if (!ready) throw new Error('Upload screen did not appear after clicking "Edit new".');
  }
}

// `input` is a file path or { name, mimeType, buffer }.
async function uploadImage(page, input) {
  const fileInput = page.locator(SEL.fileInput).first();
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(input);
    return;
  }
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator(SEL.uploadButton).filter({ visible: true }).first().click()
  ]);
  await chooser.setFiles(input);
}

async function openUpscalePanel(page, state) {
  const found = await firstVisible(page, { generate: SEL.generate, tool: SEL.upscaleTool }, 60000, state);
  if (!found) throw new Error('Image did not load in the editor (Upscale button not found).');
  if (found === 'tool') {
    await page.locator(SEL.upscaleTool).first().click();
  }
  await page.locator(SEL.generate).first().waitFor({ state: 'visible', timeout: 30000 });
}

async function selectScale(page, scale) {
  const value = scale.replace(/x$/i, '');
  const picker = page.locator(SEL.scalePicker).first();
  await picker.waitFor({ state: 'visible', timeout: 15000 });
  await sleep(1500);
  if ((await picker.getAttribute('value')) === value) return;

  // The menu can close by itself while the panel is still settling, so retry a few times.
  const option = page.locator(`[data-testid="firefly-menu-item-${value}x"], sp-menu-item[value="${value}"]`).filter({ visible: true }).first();
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!(await option.isVisible().catch(() => false))) await picker.click();
    try {
      await option.waitFor({ state: 'visible', timeout: 5000 });
      await sleep(400);
      await option.click({ timeout: 5000 });
    } catch (_) {}
    await sleep(800);
    if ((await picker.getAttribute('value')) === value) return;
  }

  const after = await picker.getAttribute('value');
  throw new Error(`Could not select scale ${scale} (picker shows "${after}x")`);
}

async function generateAndWait(page, state) {
  const download = page.locator(SEL.download).first();
  const wasVisible = await download.isVisible().catch(() => false);

  state.rateLimited = false;
  await page.locator(SEL.generate).first().click();

  if (wasVisible) {
    await download.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  }

  const deadline = Date.now() + cfg.jobTimeoutMs;
  while (Date.now() < deadline) {
    await checkForError(page, state);
    const visible = await download.isVisible().catch(() => false);
    const disabled = await download.getAttribute('disabled').catch(() => null);
    if (visible && disabled === null) return;
    await sleep(2000);
  }
  throw new Error('Timed out waiting for the upscaled result.');
}

function listDownloads() {
  try {
    return fs.readdirSync(DOWNLOADS_DIR);
  } catch (_) {
    return [];
  }
}

async function waitForStableFile(file) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const size = fs.statSync(file).size;
    if (size > 0 && size === last) return;
    last = size;
    await sleep(1000);
  }
}

// Chrome's download folder is set over our own CDP session before every download: Playwright's
// download artifacts break when another automation client has connected to the same Chrome.
async function downloadResult(page, destBase) {
  fs.mkdirSync(DL_DIR, { recursive: true });
  const cdp = await page.context().browser().newBrowserCDPSession();
  const names = new Map();
  let completed = null;
  let canceled = false;
  cdp.on('Browser.downloadWillBegin', (e) => names.set(e.guid, e.suggestedFilename));
  cdp.on('Browser.downloadProgress', (e) => {
    if (!names.has(e.guid)) return;
    if (e.state === 'completed') completed = e.guid;
    else if (e.state === 'canceled') canceled = true;
  });

  try {
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: DL_DIR,
      eventsEnabled: true
    });
    const before = new Set(listDownloads());

    await page.locator(SEL.download).first().click();

    const menuItem = page.locator('sp-menu-item').filter({ hasText: /^\s*Download\s*$/ }).filter({ visible: true }).first();
    let menuChecked = false;

    const deadline = Date.now() + cfg.downloadTimeoutMs;
    while (Date.now() < deadline) {
      if (!names.size && !menuChecked && (await menuItem.isVisible().catch(() => false))) {
        menuChecked = true;
        await menuItem.click().catch(() => {});
      }
      if (canceled) throw new Error('Download was canceled.');
      if (completed) {
        const src = path.join(DL_DIR, completed);
        await waitForStableFile(src);
        const dest = destBase + (path.extname(names.get(completed) || '') || '.jpg');
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        return dest;
      }
      const added = listDownloads().filter((f) => !before.has(f) && !/\.(crdownload|tmp|part)$/i.test(f));
      if (added.length) {
        const src = path.join(DOWNLOADS_DIR, added[0]);
        await waitForStableFile(src);
        const dest = destBase + (path.extname(src) || '.jpg');
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        return dest;
      }
      await sleep(500);
    }
    throw new Error('Download did not start.');
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Runs one upscale and returns the saved file path. onStage(name) reports progress.
async function processImage(page, state, input, { scale, destBase, onStage = () => {} }) {
  state.rateLimited = false;
  onStage('opening');
  await openFreshPage(page);
  onStage('uploading');
  await uploadImage(page, input);
  await openUpscalePanel(page, state);
  onStage('preparing');
  await selectScale(page, scale);
  onStage('upscaling');
  await generateAndWait(page, state);
  onStage('downloading');
  return downloadResult(page, destBase);
}

async function connect() {
  try {
    return await chromium.connectOverCDP(cfg.cdpUrl, { timeout: 10000 });
  } catch (e) {
    throw new Error(
      `Cannot reach Chrome at ${cfg.cdpUrl}. Run start-chrome.bat first (close other Chrome windows using that profile).`
    );
  }
}

module.exports = {
  RUN_ID,
  RateLimitError,
  NotSignedInError,
  sleep,
  log,
  connect,
  attachNetworkLogger,
  processImage
};
