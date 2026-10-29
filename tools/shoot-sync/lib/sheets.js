'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');
const config = require('../config');
const { projectProductGrid, projectUploadLog } = require('./columns');
const { cellText } = require('./util');

function ensureCredDir() {
  fs.mkdirSync(config.credentialsDir, { recursive: true });
}

function loadClientCredentials() {
  ensureCredDir();
  if (!fs.existsSync(config.credentialsPath)) {
    throw new Error(
      'Missing Google OAuth client file:\n  ' + config.credentialsPath + '\n\n' +
      '1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client (Desktop)\n' +
      '2. Enable Google Sheets API (+ Drive API readonly)\n' +
      '3. Download JSON and save as credentials.json in tools/shoot-sync/.credentials/\n' +
      '4. Run: npm run auth'
    );
  }
  const raw = JSON.parse(fs.readFileSync(config.credentialsPath, 'utf8'));
  const installed = raw.installed || raw.web;
  if (!installed) throw new Error('credentials.json must be a Desktop or Web OAuth client JSON');
  return installed;
}

function createOAuthClient() {
  const c = loadClientCredentials();
  return new google.auth.OAuth2(c.client_id, c.client_secret, c.redirect_uris?.[0] || 'http://localhost:1');
}

async function authorizeInteractive() {
  ensureCredDir();
  const c = loadClientCredentials();
  const redirect = 'http://127.0.0.1:53682/oauth2callback';
  const oauth2 = new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: config.scopes,
    prompt: 'consent'
  });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, redirect);
        if (u.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end();
          return;
        }
        const err = u.searchParams.get('error');
        const code = u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Shoot Sync authorized. You can close this tab.</h2></body></html>');
        server.close();
        if (err) reject(new Error(err));
        else resolve(code);
      } catch (e) {
        reject(e);
      }
    });
    server.listen(53682, '127.0.0.1', () => {
      console.log('Open this URL to authorize:\n' + authUrl + '\n');
    });
    server.on('error', reject);
  });

  const { tokens } = await oauth2.getToken(code);
  fs.writeFileSync(config.tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
  console.log('Saved token to', config.tokenPath);
  oauth2.setCredentials(tokens);
  return oauth2;
}

async function getAuth() {
  ensureCredDir();
  if (!fs.existsSync(config.tokenPath)) {
    return authorizeInteractive();
  }
  const oauth2 = createOAuthClient();
  // Fix redirect for refresh — desktop clients often use urn or localhost
  const c = loadClientCredentials();
  const client = new google.auth.OAuth2(
    c.client_id,
    c.client_secret,
    c.redirect_uris?.[0] || 'http://127.0.0.1:53682/oauth2callback'
  );
  client.setCredentials(JSON.parse(fs.readFileSync(config.tokenPath, 'utf8')));
  client.on('tokens', (tokens) => {
    const merged = Object.assign(
      JSON.parse(fs.readFileSync(config.tokenPath, 'utf8')),
      tokens
    );
    fs.writeFileSync(config.tokenPath, JSON.stringify(merged, null, 2), 'utf8');
  });
  return client;
}

function sheetsApi(auth) {
  return google.sheets({ version: 'v4', auth });
}

async function getSheetTitles(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.spreadsheetId,
    fields: 'sheets.properties.title,sheets.properties.sheetId'
  });
  return (meta.data.sheets || []).map((s) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId
  }));
}

async function ensureTab(sheets, title) {
  const titles = await getSheetTitles(sheets);
  if (titles.some((t) => t.title === title)) return titles;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  return getSheetTitles(sheets);
}

async function readTabValues(sheets, title) {
  const range = "'" + title.replace(/'/g, "''") + "'";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE'
  });
  return res.data.values || [];
}

async function readDestination(sheets) {
  const product = {};
  for (const tab of config.productTabs) {
    try {
      const values = await readTabValues(sheets, tab);
      product[tab] = projectProductGrid(values, {});
      product[tab]._raw = values;
    } catch (err) {
      product[tab] = projectProductGrid([], {});
      product[tab]._raw = [];
      product[tab]._error = String(err.message || err);
    }
  }
  let uploadRaw = [];
  try {
    uploadRaw = await readTabValues(sheets, config.uploadLogTab);
  } catch (err) {
    uploadRaw = [];
  }
  // Destination Upload Log may already be 2-col (EAN, link) or full A:F
  let uploadLog;
  if (uploadRaw.length && /folder/i.test(cellText((uploadRaw[0] || [])[1] || ''))) {
    // 2-col projected layout
    const headers = ['EAN', 'EAN Folder Link'];
    const byEan = new Map();
    const rows = [];
    for (let r = 1; r < uploadRaw.length; r++) {
      const ean = String((uploadRaw[r] || [])[0] || '').replace(/\D/g, '');
      if (!ean) continue;
      const link = String((uploadRaw[r] || [])[1] || '');
      const entry = { ean, values: [ean, link], links: link ? { 1: link } : {} };
      rows.push(entry);
      byEan.set(ean, entry);
    }
    uploadLog = { headers, rows, byEan, _raw: uploadRaw };
  } else {
    uploadLog = projectUploadLog(uploadRaw);
    uploadLog._raw = uploadRaw;
  }
  return { product, uploadLog };
}

function a1(colIndex) {
  let n = colIndex + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function toSheetValues(projected) {
  const headers = projected.headers;
  const out = [headers];
  projected.rows.forEach((row) => {
    const line = row.values.map((v, c) => {
      const url = row.links && row.links[c];
      if (url) {
        const label = String(v || 'Open').replace(/"/g, '""');
        const safeUrl = String(url).replace(/"/g, '""');
        return '=HYPERLINK("' + safeUrl + '","' + label + '")';
      }
      return v == null ? '' : v;
    });
    out.push(line);
  });
  return out;
}

async function writeTabGrid(sheets, title, grid) {
  await ensureTab(sheets, title);
  const escaped = "'" + title.replace(/'/g, "''") + "'";
  // Clear existing content
  await sheets.spreadsheets.values.clear({
    spreadsheetId: config.spreadsheetId,
    range: escaped
  });
  if (!grid.length) return;
  const cols = Math.max(...grid.map((r) => r.length));
  const end = a1(cols - 1) + grid.length;
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: escaped + '!A1:' + end,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: grid }
  });
}

async function writeSyncMeta(sheets, meta) {
  await ensureTab(sheets, config.syncMetaTab);
  const rows = [
    ['key', 'value'],
    ['xlsxSyncedAt', meta.xlsxSyncedAt || ''],
    ['xlsxFileName', meta.xlsxFileName || ''],
    ['xlsxFileModified', meta.xlsxFileModified || ''],
    ['syncVersionId', meta.syncVersionId || ''],
    ['status', meta.status || ''],
    ['newRows', String(meta.newRows ?? '')],
    ['changedFields', String(meta.changedFields ?? '')]
  ];
  await writeTabGrid(sheets, config.syncMetaTab, rows);
}

async function appendChangeLog(sheets, entries, syncedAt) {
  if (!entries.length) return;
  await ensureTab(sheets, config.changeLogTab);
  const existing = await readTabValues(sheets, config.changeLogTab);
  const header = ['Synced At', 'Tab', 'EAN', 'Column', 'Old', 'New'];
  const startEmpty = !existing.length;
  const values = entries.map((e) => [
    syncedAt, e.tab, e.ean, e.column,
    String(e.old ?? '').slice(0, 500),
    String(e.new ?? '').slice(0, 500)
  ]);
  if (startEmpty) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: "'" + config.changeLogTab + "'!A1",
      valueInputOption: 'RAW',
      requestBody: { values: [header].concat(values) }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: "'" + config.changeLogTab + "'!A1",
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });
  }
}

async function readSyncMeta(sheets) {
  try {
    const values = await readTabValues(sheets, config.syncMetaTab);
    const out = {};
    for (let r = 1; r < values.length; r++) {
      const k = values[r][0];
      const v = values[r][1];
      if (k) out[k] = v;
    }
    return out;
  } catch (e) {
    return {};
  }
}

module.exports = {
  authorizeInteractive,
  getAuth,
  sheetsApi,
  getSheetTitles,
  ensureTab,
  readTabValues,
  readDestination,
  toSheetValues,
  writeTabGrid,
  writeSyncMeta,
  appendChangeLog,
  readSyncMeta
};
