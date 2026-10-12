// Batch mode: upscales every image in input/ and saves the results to output/.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const {
  RUN_ID,
  RateLimitError,
  NotSignedInError,
  sleep,
  log,
  connect,
  attachNetworkLogger,
  processImage
} = require('./firefly');

function ensureDirs() {
  [cfg.inputDir, cfg.outputDir, cfg.doneDir, cfg.failedDir, cfg.logsDir].forEach((d) =>
    fs.mkdirSync(d, { recursive: true })
  );
}

function listImages() {
  return fs
    .readdirSync(cfg.inputDir)
    .filter((f) => cfg.imageExtensions.includes(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(cfg.inputDir, f));
}

function moveFile(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
  return dest;
}

async function saveScreenshot(page, file) {
  const shot = path.join(cfg.failedDir, `${path.parse(file).name}_error.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  return shot;
}

async function main() {
  ensureDirs();
  const files = listImages().slice(0, cfg.maxPerRun);
  if (!files.length) {
    log(`No images in ${cfg.inputDir}`);
    return;
  }
  log(`Run ${RUN_ID}: ${files.length} image(s), scale ${cfg.scale}`);

  const browser = await connect();
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = await context.newPage();
  const state = { rateLimited: false };
  attachNetworkLogger(page, state);

  let ok = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let rateLimitHits = 0;
  const started = Date.now();

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      log(`(${i + 1}/${files.length}) ${path.basename(file)}`);
      const destBase = path.join(cfg.outputDir, `${path.parse(file).name}_${cfg.scale}`);

      for (let attempt = 1; ; attempt++) {
        try {
          const out = await processImage(page, state, file, { scale: cfg.scale, destBase });
          moveFile(file, cfg.doneDir);
          log(`  Saved ${path.basename(out)}`);
          ok++;
          consecutiveFailures = 0;
          break;
        } catch (err) {
          if (err instanceof NotSignedInError) throw err;
          if (err instanceof RateLimitError && attempt <= cfg.rateLimitRetries) {
            rateLimitHits++;
            log(`  RATE LIMIT pop-up: "${err.message}". Waiting ${Math.round(cfg.rateLimitWaitMs / 1000)} s, then retrying (${attempt}/${cfg.rateLimitRetries}).`);
            await sleep(cfg.rateLimitWaitMs);
            continue;
          }
          const shot = await saveScreenshot(page, file);
          moveFile(file, cfg.failedDir);
          log(`  FAILED: ${err.message} (screenshot: ${path.basename(shot)})`);
          failed++;
          consecutiveFailures++;
          break;
        }
      }

      if (consecutiveFailures >= cfg.maxConsecutiveFailures) {
        log(`Stopping: ${consecutiveFailures} failures in a row.`);
        break;
      }

      if (i < files.length - 1) {
        const wait = cfg.delayMs + Math.floor(Math.random() * cfg.jitterMs);
        log(`  Waiting ${Math.round(wait / 1000)} s before next image`);
        await sleep(wait);
      }
    }
  } finally {
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    log(`Done in ${mins} min. ${ok} succeeded, ${failed} failed, ${rateLimitHits} rate-limit pop-up(s).`);
    await page.close().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    try {
      log(`ERROR: ${err.message}`);
    } catch (_) {
      console.error(err);
    }
    process.exit(1);
  });
