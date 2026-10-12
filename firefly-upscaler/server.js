// Local upscale service for the 3D Playground page.
//   GET  /health            service + Chrome status
//   POST /jobs?name=&scale= raw image bytes in the body; returns { id }
//   GET  /jobs/:id          job status and progress (0-100)
//   GET  /jobs/:id/result   upscaled image bytes
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const ff = require('./firefly');

const MAX_BODY_BYTES = 80 * 1024 * 1024;
const JOB_TTL_MS = 15 * 60 * 1000;
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const jobs = new Map();
const pending = [];
let queue = Promise.resolve();
let browser = null;
let page = null;
const pageState = { rateLimited: false };
let lastFinishedAt = 0;
const upscaleTimes = [];

/* ---------- Chrome ---------- */

async function getPage() {
  if (!browser || !browser.isConnected()) {
    browser = await ff.connect();
    page = null;
  }
  if (!page || page.isClosed()) {
    const context = browser.contexts()[0] || (await browser.newContext());
    page = await context.newPage();
    ff.attachNetworkLogger(page, pageState);
  }
  return page;
}

async function chromeReachable() {
  try {
    const res = await fetch(`${cfg.cdpUrl}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

/* ---------- Jobs ---------- */

function expectedUpscaleMs() {
  if (!upscaleTimes.length) return cfg.expectedUpscaleMs;
  return upscaleTimes.reduce((a, b) => a + b, 0) / upscaleTimes.length;
}

const STAGE_PROGRESS = { queued: 0, waiting: 3, opening: 8, uploading: 15, preparing: 25, upscaling: 30, downloading: 92 };

function progressOf(job) {
  if (job.status === 'done') return 100;
  if (job.stage === 'upscaling' && job.upscaleStartedAt) {
    const ratio = (Date.now() - job.upscaleStartedAt) / expectedUpscaleMs();
    return Math.min(88, Math.round(30 + 58 * ratio));
  }
  return STAGE_PROGRESS[job.stage] !== undefined ? STAGE_PROGRESS[job.stage] : job.lastProgress || 0;
}

function publicJob(job) {
  const progress = progressOf(job);
  if (job.stage !== 'rate-limited') job.lastProgress = progress;
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    stage: job.stage,
    progress,
    position: job.status === 'queued' ? pending.indexOf(job) + 1 : 0,
    rateLimitHits: job.rateLimitHits,
    elapsedMs: job.startedAt ? (job.finishedAt || Date.now()) - job.startedAt : 0,
    error: job.error
  };
}

function setStage(job, stage) {
  job.stage = stage;
  if (stage === 'upscaling') job.upscaleStartedAt = Date.now();
  if (stage === 'downloading' && job.upscaleStartedAt) {
    upscaleTimes.push(Date.now() - job.upscaleStartedAt);
    if (upscaleTimes.length > 10) upscaleTimes.shift();
  }
}

async function runJob(job) {
  pending.splice(pending.indexOf(job), 1);
  job.status = 'running';

  const gap = lastFinishedAt + cfg.delayMs - Date.now();
  if (gap > 0) {
    setStage(job, 'waiting');
    await ff.sleep(gap);
  }
  job.startedAt = Date.now();

  ff.log(`[service] ${job.name}: upscaling ${job.scale}`);
  const destBase = path.join(cfg.jobsDir, job.id);
  const input = { name: job.name, mimeType: job.mime, buffer: job.buffer };

  for (let attempt = 1; ; attempt++) {
    try {
      const p = await getPage();
      job.resultPath = await ff.processImage(p, pageState, input, {
        scale: job.scale,
        destBase,
        onStage: (s) => setStage(job, s)
      });
      job.status = 'done';
      ff.log(`[service] ${job.name}: done in ${Math.round((Date.now() - job.startedAt) / 1000)} s`);
      break;
    } catch (err) {
      if (err instanceof ff.RateLimitError && attempt <= cfg.rateLimitRetries) {
        job.rateLimitHits++;
        setStage(job, 'rate-limited');
        ff.log(`[service] ${job.name}: RATE LIMIT pop-up "${err.message}". Waiting ${Math.round(cfg.rateLimitWaitMs / 1000)} s (${attempt}/${cfg.rateLimitRetries}).`);
        await ff.sleep(cfg.rateLimitWaitMs);
        continue;
      }
      if (attempt === 1 && /closed|disconnected|Target page/i.test(err.message)) {
        browser = null;
        continue;
      }
      job.status = 'failed';
      job.error = err.message;
      ff.log(`[service] ${job.name}: FAILED ${err.message}`);
      break;
    }
  }

  job.finishedAt = Date.now();
  job.buffer = null;
  lastFinishedAt = Date.now();
}

function removeJob(job) {
  if (job.resultPath) fs.rm(job.resultPath, { force: true }, () => {});
  jobs.delete(job.id);
}

setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) removeJob(job);
  }
}, 60 * 1000).unref();

/* ---------- HTTP ---------- */

function originAllowed(origin) {
  return cfg.allowedOrigins.some((rule) => (rule instanceof RegExp ? rule.test(origin) : rule === origin));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Image is too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    if (!originAllowed(origin)) return sendJson(res, 403, { error: `Origin ${origin} is not allowed` });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.setHeader('Access-Control-Max-Age', '600');
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'firefly-upscaler',
      chrome: await chromeReachable(),
      scale: cfg.serviceScale,
      queued: pending.length,
      busy: [...jobs.values()].some((j) => j.status === 'running'),
      folder: path.dirname(__dirname)
    });
  }

  if (req.method === 'POST' && url.pathname === '/jobs') {
    const scale = url.searchParams.get('scale') || cfg.serviceScale;
    if (!/^[24]x$/.test(scale)) return sendJson(res, 400, { error: 'scale must be 2x or 4x' });
    const buffer = await readBody(req);
    if (!buffer.length) return sendJson(res, 400, { error: 'Empty image' });

    const job = {
      id: crypto.randomUUID(),
      name: (url.searchParams.get('name') || 'image.png').replace(/[\\/:*?"<>|]+/g, '_'),
      mime: (req.headers['content-type'] || 'image/png').split(';')[0],
      scale,
      buffer,
      status: 'queued',
      stage: 'queued',
      rateLimitHits: 0,
      createdAt: Date.now(),
      startedAt: 0,
      finishedAt: 0,
      error: null,
      resultPath: null
    };
    jobs.set(job.id, job);
    pending.push(job);
    queue = queue.then(() => runJob(job)).catch((err) => ff.log(`[service] queue error: ${err.message}`));
    return sendJson(res, 202, { id: job.id });
  }

  if (req.method === 'GET' && parts[0] === 'jobs' && parts[1]) {
    const job = jobs.get(parts[1]);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });

    if (parts[2] === 'result') {
      if (job.status !== 'done' || !job.resultPath) return sendJson(res, 409, { error: 'Job is not finished' });
      const ext = path.extname(job.resultPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(job.resultPath)
        .on('end', () => setTimeout(() => removeJob(job), 5000))
        .pipe(res);
      return;
    }
    return sendJson(res, 200, publicJob(job));
  }

  sendJson(res, 404, { error: 'Not found' });
}

fs.rmSync(cfg.jobsDir, { recursive: true, force: true });
fs.mkdirSync(cfg.jobsDir, { recursive: true });

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      ff.log(`[service] request error: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    });
  })
  .listen(cfg.servicePort, '127.0.0.1', async () => {
    ff.log(`[service] Firefly upscaler listening on http://127.0.0.1:${cfg.servicePort}`);
    ff.log(`[service] Chrome on ${cfg.cdpUrl}: ${(await chromeReachable()) ? 'connected' : 'NOT reachable - run start-chrome.bat'}`);
  });
