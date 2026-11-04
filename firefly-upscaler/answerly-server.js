// Answerly-only local bridge (no Firefly / Chrome / Playwright).
// Same port as the full upscaler so Preview keeps using http://127.0.0.1:5175
//   GET  /health
//   GET  /answerly/health
//   POST/DELETE /answerly/token
//   GET  /answerly/models
//   POST /answerly/jobs …
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const answerly = require('./answerly');

const PORT = cfg.servicePort || 5175;
const JOBS_DIR = path.join(__dirname, 'jobs-answerly');
const MAX_BODY_BYTES = 80 * 1024 * 1024;
const JOB_TTL_MS = 15 * 60 * 1000;
const ANSWERLY_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.ANSWERLY_CONCURRENCY) || 6));
const ANSWERLY_TEST_HTML = path.join(__dirname, '..', 'answerly-test.html');

const answerlyJobs = new Map();
let answerlyActive = 0;
const answerlyWaiters = [];

function log(msg) {
  const t = new Date().toLocaleTimeString();
  console.log(`[${t}] ${msg}`);
}

function originAllowed(origin) {
  return (cfg.allowedOrigins || []).some((rule) => (rule instanceof RegExp ? rule.test(origin) : rule === origin));
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

function finalizeCancelledAnswerlyJob(job, reason) {
  job.cancelRequested = true;
  job.status = 'cancelled';
  job.stage = 'cancelled';
  job.error = reason || 'Cancelled';
  job.finishedAt = Date.now();
  job.buffer = null;
  job.images = null;
  log(`[answerly] ${job.id}: cancelled`);
}

function throwIfAnswerlyCancelled(job) {
  if (job && job.cancelRequested) {
    const err = new Error('Cancelled');
    err.code = 'cancelled';
    throw err;
  }
}

function scheduleAnswerlyJob(job) {
  const start = () => {
    if (job.cancelRequested || job.status === 'cancelled') {
      if (job.status !== 'cancelled') finalizeCancelledAnswerlyJob(job);
      const next = answerlyWaiters.shift();
      if (next) next();
      return;
    }
    answerlyActive++;
    Promise.resolve()
      .then(() => runAnswerlyJob(job))
      .catch((err) => log(`[answerly] ${job.id}: schedule error ${err && err.message}`))
      .finally(() => {
        answerlyActive--;
        const next = answerlyWaiters.shift();
        if (next) next();
      });
  };
  if (answerlyActive < ANSWERLY_CONCURRENCY) start();
  else answerlyWaiters.push(start);
}

async function requestCancelAnswerlyJob(job) {
  if (!job) return { ok: false, error: 'not found' };
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
    return { ok: true, id: job.id, status: job.status, alreadyFinished: true };
  }
  job.cancelRequested = true;
  if (!job.startedAt || job.status === 'queued') {
    finalizeCancelledAnswerlyJob(job);
    return { ok: true, id: job.id, status: 'cancelled' };
  }
  if (job.executionId) {
    try { await answerly.cancelExecution(job.executionId); } catch (_) { /* best-effort */ }
  }
  return { ok: true, id: job.id, status: job.status, cancelRequested: true };
}

function cancelAllAnswerlyJobs() {
  const results = [];
  for (const job of answerlyJobs.values()) {
    if (job.status === 'queued' || job.status === 'running') {
      job.cancelRequested = true;
      if (!job.startedAt || job.status === 'queued') finalizeCancelledAnswerlyJob(job);
      else if (job.executionId) {
        answerly.cancelExecution(job.executionId).catch(() => {});
      }
      results.push({ id: job.id, status: job.status });
    }
  }
  return results;
}

function publicAnswerlyJob(job) {
  let progress = 5;
  if (job.status === 'done') progress = 100;
  else if (job.status === 'cancelled' || job.status === 'canceled') progress = job.lastProgress || 0;
  else if (job.status === 'failed') progress = job.lastProgress || 0;
  else if (job.stage === 'uploading') progress = 15;
  else if (job.stage === 'queued-remote') progress = 30;
  else if (job.stage === 'running-remote') progress = Math.min(90, 40 + (job.remoteProgress || 0));
  else if (job.stage === 'downloading') progress = 95;
  job.lastProgress = progress;
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress,
    workflow: job.workflow,
    model: job.model,
    executionId: job.executionId,
    resultUrl: job.resultUrl,
    elapsedMs: job.startedAt ? (job.finishedAt || Date.now()) - job.startedAt : 0,
    error: job.error,
    cancelRequested: !!job.cancelRequested
  };
}

async function runAnswerlyJob(job) {
  if (job.cancelRequested) {
    finalizeCancelledAnswerlyJob(job);
    return;
  }
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const meta = answerly.WORKFLOWS[job.workflow];
    if (!meta) throw new Error('Unknown workflow: ' + job.workflow);

    let images = Array.isArray(job.images) && job.images.length
      ? job.images
      : (job.buffer ? [{ buffer: job.buffer, name: job.imageName, mime: job.imageMime }] : []);
    const modelLow = String(job.model || '').toLowerCase();
    const maxRefs = /krea|grok|xai\//.test(modelLow) ? 1 : 4;
    if (maxRefs === 1 && images.length > 1) images = images.slice(0, 1);

    const imageUrls = [];
    throwIfAnswerlyCancelled(job);
    if (meta.needsImage) {
      if (!images.length) throw new Error(meta.label + ' needs an input image');
      job.stage = 'uploading';
      for (let i = 0; i < images.length; i++) {
        throwIfAnswerlyCancelled(job);
        job.stage = 'uploading · ' + (i + 1) + '/' + images.length;
        const uploaded = await answerly.uploadImage(images[i].buffer, images[i].name, images[i].mime);
        imageUrls.push(uploaded.publicUrl);
      }
      job.inputUrl = imageUrls[0] || null;
      job.inputUrls = imageUrls;
    }

    let prompt = job.prompt;
    if (maxRefs > 1 && imageUrls.length > 2) {
      prompt += '\n\nAdditional product reference images (INPUT IMAGE 3+):\n' +
        imageUrls.slice(2).map((u, i) => 'INPUT IMAGE ' + (i + 3) + ': ' + u).join('\n');
    }

    throwIfAnswerlyCancelled(job);
    job.stage = 'queued-remote';
    const input = answerly.buildInput(meta, {
      model: job.model,
      prompt: prompt,
      image_size: job.imageSize,
      imageUrls: imageUrls.slice(0, maxRefs),
      imageUrl: imageUrls[0] || null
    });
    const queued = await answerly.queueWorkflow(job.workflow, input);
    throwIfAnswerlyCancelled(job);
    job.executionId = queued.execution_id;
    if (!job.executionId) throw new Error('No execution_id returned from Answerly');

    const deadline = Date.now() + (cfg.answerlyJobTimeoutMs || 5 * 60 * 1000);
    while (Date.now() < deadline) {
      throwIfAnswerlyCancelled(job);
      job.stage = 'running-remote';
      const exec = await answerly.getExecution(job.executionId);
      const st = String(exec.status || '').toLowerCase();
      if (st === 'completed' || st === 'succeeded' || st === 'success') {
        throwIfAnswerlyCancelled(job);
        const resultUrl = answerly.pickResultUrl(exec);
        if (!resultUrl) throw new Error('Job completed but no result image URL was returned');
        job.stage = 'downloading';
        const { buffer, contentType } = await answerly.fetchResultBytes(resultUrl);
        throwIfAnswerlyCancelled(job);
        const ext = /jpeg|jpg/i.test(contentType) ? '.jpg' : /webp/i.test(contentType) ? '.webp' : '.png';
        job.resultPath = path.join(JOBS_DIR, 'answerly-' + job.id + ext);
        job.resultMime = contentType;
        job.resultUrl = resultUrl;
        fs.writeFileSync(job.resultPath, buffer);
        job.status = 'done';
        job.finishedAt = Date.now();
        job.buffer = null;
        job.images = null;
        return;
      }
      if (st === 'failed' || st === 'cancelled' || st === 'canceled' || st === 'error') {
        if (st === 'cancelled' || st === 'canceled' || job.cancelRequested) {
          const err = new Error('Cancelled');
          err.code = 'cancelled';
          throw err;
        }
        throw new Error(exec.error_message || 'Answerly job ' + st);
      }
      await new Promise((r) => setTimeout(r, cfg.answerlyPollMs || 2000));
    }
    throw new Error('Timed out waiting for Answerly job');
  } catch (err) {
    if (job.cancelRequested || (err && err.code === 'cancelled') || /cancelled|canceled/i.test(err && err.message || '')) {
      finalizeCancelledAnswerlyJob(job);
      return;
    }
    job.status = 'failed';
    job.error = err.message || String(err);
    job.finishedAt = Date.now();
    job.buffer = null;
    job.images = null;
    log(`[answerly] ${job.id}: FAILED ${job.error}`);
  }
}

function decodeImagePart(img, label) {
  const part = img || {};
  const b64 = part.base64;
  if (!b64) throw new Error(label + ' requires base64');
  const buffer = Buffer.from(String(b64).replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length) throw new Error(label + ' base64 is empty');
  return {
    buffer,
    name: part.name || 'upload.png',
    mime: part.mime || 'image/png'
  };
}

function parseAnswerlyJobBody(raw) {
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch (_) {
    throw new Error('Body must be JSON');
  }
  const workflow = data.workflow || data.workflow_id || 'image-edit-workflow';
  if (!answerly.WORKFLOWS[workflow]) throw new Error('Unsupported workflow: ' + workflow);
  const prompt = String(data.prompt || data.edit_instructions || '').trim();
  if (!prompt) throw new Error('prompt is required');
  const model = String(data.model || 'gemini-3.1-flash-image').trim();
  const imageSize = String(data.image_size || '1K').trim();
  const meta = answerly.WORKFLOWS[workflow];
  const images = [];
  if (meta.needsImage) {
    const list = Array.isArray(data.images) ? data.images : null;
    if (list && list.length) {
      list.forEach((img, i) => images.push(decodeImagePart(img, 'images[' + i + ']')));
    } else {
      const img = data.image || {};
      const b64 = img.base64 || data.imageBase64;
      if (!b64) throw new Error(meta.label + ' requires image.base64 or images[]');
      images.push(decodeImagePart({
        base64: b64,
        name: img.name || data.imageName || 'upload.png',
        mime: img.mime || data.imageMime || 'image/png'
      }, 'image'));
    }
  }
  const first = images[0] || null;
  return {
    workflow,
    prompt,
    model,
    imageSize,
    images,
    buffer: first ? first.buffer : null,
    imageName: first ? first.name : 'upload.png',
    imageMime: first ? first.mime : 'image/png'
  };
}

async function handle(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    if (!originAllowed(origin)) return sendJson(res, 403, { error: `Origin ${origin} is not allowed` });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/answerly-test' || url.pathname === '/answerly-test.html')) {
    if (!fs.existsSync(ANSWERLY_TEST_HTML)) return sendJson(res, 404, { error: 'answerly-test.html not found' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(ANSWERLY_TEST_HTML).pipe(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'answerly-bridge',
      answerlyOnly: true,
      chrome: false,
      scale: null,
      queued: 0,
      busy: answerlyActive > 0,
      folder: path.dirname(__dirname)
    });
  }

  if (req.method === 'GET' && url.pathname === '/answerly/health') {
    const token = answerly.tokenStatus();
    const ws = answerly.workspaceInfo();
    return sendJson(res, 200, {
      ok: true,
      service: 'answerly-bridge',
      answerlyOnly: true,
      workspaceId: ws.id,
      workspaceName: ws.name,
      workspaceKind: ws.kind,
      preferredWorkspaceId: cfg.answerlyWorkspaceId || answerly.DEFAULT_WORKSPACE,
      workflows: Object.values(answerly.WORKFLOWS).map((w) => ({ id: w.id, label: w.label, needsImage: w.needsImage })),
      token
    });
  }

  if (req.method === 'GET' && url.pathname === '/answerly/workspaces') {
    try {
      const workspaces = await answerly.listWorkspaces();
      return sendJson(res, 200, { ok: true, active: answerly.workspaceInfo(), workspaces });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  if (url.pathname === '/answerly/token') {
    if (req.method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (_) {
        return sendJson(res, 400, { error: 'JSON body required' });
      }
      try {
        const token = await answerly.setTokenAndResolveWorkspace(
          body.accessToken || body.token,
          body.workspaceId || cfg.answerlyWorkspaceId || answerly.DEFAULT_WORKSPACE
        );
        return sendJson(res, 200, { ok: true, token, workspace: answerly.workspaceInfo() });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
    if (req.method === 'DELETE') {
      return sendJson(res, 200, { ok: true, token: answerly.clearToken() });
    }
  }

  if (req.method === 'GET' && url.pathname === '/answerly/models') {
    try {
      const tool = url.searchParams.get('tool');
      const data = await answerly.listModels(!tool || tool === 'all' ? null : tool);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/answerly/jobs') {
    const raw = await readBody(req);
    let parsed;
    try { parsed = parseAnswerlyJobBody(raw); } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const job = {
      id: crypto.randomUUID(),
      workflow: parsed.workflow,
      model: parsed.model,
      prompt: parsed.prompt,
      imageSize: parsed.imageSize,
      images: parsed.images || [],
      buffer: parsed.buffer,
      imageName: parsed.imageName,
      imageMime: parsed.imageMime,
      status: 'queued',
      stage: 'queued',
      createdAt: Date.now(),
      startedAt: 0,
      finishedAt: 0,
      error: null,
      executionId: null,
      resultUrl: null,
      resultPath: null,
      resultMime: null,
      inputUrl: null,
      inputUrls: null,
      lastProgress: 0
    };
    answerlyJobs.set(job.id, job);
    scheduleAnswerlyJob(job);
    return sendJson(res, 202, { id: job.id, parallel: true, concurrency: ANSWERLY_CONCURRENCY });
  }

  if (req.method === 'POST' && url.pathname === '/answerly/jobs/cancel-all') {
    return sendJson(res, 200, { ok: true, cancelled: cancelAllAnswerlyJobs().length });
  }

  if (req.method === 'POST' && parts[0] === 'answerly' && parts[1] === 'jobs' && parts[2] && parts[3] === 'cancel') {
    const job = answerlyJobs.get(parts[2]);
    if (!job) return sendJson(res, 404, { error: 'Answerly job not found' });
    return sendJson(res, 200, await requestCancelAnswerlyJob(job));
  }

  if (req.method === 'GET' && parts[0] === 'answerly' && parts[1] === 'jobs' && parts[2]) {
    const job = answerlyJobs.get(parts[2]);
    if (!job) return sendJson(res, 404, { error: 'Answerly job not found' });
    if (parts[3] === 'result') {
      if (job.status !== 'done' || !job.resultPath) return sendJson(res, 409, { error: 'Job is not finished' });
      res.writeHead(200, { 'Content-Type': job.resultMime || 'image/png', 'Cache-Control': 'no-store' });
      fs.createReadStream(job.resultPath).pipe(res);
      return;
    }
    return sendJson(res, 200, publicAnswerlyJob(job));
  }

  // Firefly upscale routes are not available on this Answerly-only process.
  if (url.pathname === '/jobs' || (parts[0] === 'jobs')) {
    return sendJson(res, 503, {
      error: 'AI upscale is not running. Start the Firefly upscaler (Start 3D Playground / AI upscale setup) when you need upscale.'
    });
  }

  sendJson(res, 404, { error: 'Not found' });
}

fs.rmSync(JOBS_DIR, { recursive: true, force: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });

setInterval(() => {
  const now = Date.now();
  for (const job of answerlyJobs.values()) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
      if (job.resultPath) fs.rm(job.resultPath, { force: true }, () => {});
      answerlyJobs.delete(job.id);
    }
  }
}, 60 * 1000).unref();

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`[answerly-bridge] request error: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    log(`[answerly-bridge] listening on http://127.0.0.1:${PORT}`);
    log(`[answerly-bridge] health: http://127.0.0.1:${PORT}/answerly/health`);
    log('[answerly-bridge] Firefly Chrome is NOT required for Answerly.');
  });
