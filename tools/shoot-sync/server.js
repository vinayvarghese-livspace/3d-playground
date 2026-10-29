'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const config = require('./config');
const { dryRun, runSync, runRollback, printVersions } = require('./lib/sync');
const { listVersions } = require('./lib/versions');
const { authorizeInteractive } = require('./lib/sheets');

const PORT = Number(process.env.SHOOT_SYNC_PORT || 8787);
const UI_DIR = path.join(__dirname, 'ui');

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  const push = (...args) => {
    lines.push(args.map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' '));
  };
  const restore = () => {
    console.log = orig;
    console.warn = origWarn;
    console.error = origErr;
  };
  console.log = (...a) => { push(...a); orig.apply(console, a); };
  console.warn = (...a) => { push(...a); origWarn.apply(console, a); };
  console.error = (...a) => { push(...a); origErr.apply(console, a); };
  return Promise.resolve()
    .then(fn)
    .then((result) => {
      restore();
      return { result, log: lines };
    })
    .catch((err) => {
      restore();
      lines.push(String(err && err.message || err));
      const e = new Error(String(err && err.message || err));
      e.log = lines;
      throw e;
    });
}

function readLastMeta() {
  try {
    if (fs.existsSync(config.metaJsonPath)) {
      return JSON.parse(fs.readFileSync(config.metaJsonPath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function statusPayload() {
  let xlsxExists = false;
  let xlsxModified = '';
  let xlsxBytes = 0;
  try {
    if (fs.existsSync(config.xlsxPath)) {
      const st = fs.statSync(config.xlsxPath);
      xlsxExists = true;
      xlsxModified = st.mtime.toISOString();
      xlsxBytes = st.size;
    }
  } catch (e) { /* ignore */ }
  let playgroundBackupCount = 0;
  try {
    if (fs.existsSync(config.playgroundBackupsDir)) {
      playgroundBackupCount = fs.readdirSync(config.playgroundBackupsDir).length;
    }
  } catch (e) { /* ignore */ }
  return {
    xlsxPath: config.xlsxPath,
    xlsxExists,
    xlsxModified,
    xlsxBytes,
    spreadsheetId: config.spreadsheetId,
    playgroundBackupsDir: config.playgroundBackupsDir,
    playgroundBackupCount,
    lastSync: readLastMeta(),
    versions: listVersions(),
    authed: fs.existsSync(config.tokenPath)
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      return sendFile(res, path.join(UI_DIR, 'index.html'));
    }
    if (method === 'GET' && u.pathname === '/app.js') {
      return sendFile(res, path.join(UI_DIR, 'app.js'));
    }
    if (method === 'GET' && u.pathname === '/api/status') {
      return sendJson(res, 200, statusPayload());
    }
    if (method === 'POST' && u.pathname === '/api/dry-run') {
      const { log } = await captureLogs(() => dryRun());
      return sendJson(res, 200, { ok: true, log });
    }
    if (method === 'POST' && u.pathname === '/api/sync') {
      if (!fs.existsSync(config.tokenPath)) {
        // First-time auth in terminal, then user retries Sync in the UI.
        await authorizeInteractive();
      }
      const { log } = await captureLogs(() => runSync());
      return sendJson(res, 200, { ok: true, log });
    }
    if (method === 'POST' && u.pathname === '/api/rollback') {
      const version = u.searchParams.get('version') || '';
      const { log } = await captureLogs(() => runRollback(version || undefined));
      return sendJson(res, 200, { ok: true, log });
    }
    if (method === 'POST' && u.pathname === '/api/auth') {
      await authorizeInteractive();
      return sendJson(res, 200, { ok: true, log: ['Authorized.'] });
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: String(err && err.message || err),
      log: err.log || [String(err && err.message || err)]
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/';
  console.log('Shoot Tracker Sync UI: ' + url);
  console.log('Keep this window open while using the page.');
  // Open browser on Windows when possible
  try {
    require('child_process').exec('cmd /c start "" "' + url + '"');
  } catch (e) { /* ignore */ }
});

// silence unused in case lint
void printVersions;
