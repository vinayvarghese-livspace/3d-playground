/**
 * Prompt Database — standalone web app (separate from HH Multi Sheet Reader).
 *
 * Bound to: Prompt Database spreadsheet
 *   https://docs.google.com/spreadsheets/d/12NU2Ru7Jnxok4M0Ylva1n8CKBxScnOs3k4gPs35a4Ec
 *
 * Actions (JSON or JSONP via ?callback=):
 *   action=universal     — read Universal tab (templates)
 *   action=promptChunk      — stash one Custom-prompt slice (CacheService; v6+)
 *   action=promptApprove    — append Rate & Approve row to All user
 *   action=approvedCustoms  — latest Custom prompts for Sub-category + Template reuse (v8+)
 *   action=ping             — health check ({ version, sheet })
 *
 * After editing this file: Deploy → Manage deployments → ✎ Edit →
 *   Version: New version → Deploy (keep the same /exec URL).
 *   Execute as: Me
 *   Who has access: Anyone within Livspace (or same as your other HH reader)
 */

var PROMPT_DB_ID = '12NU2Ru7Jnxok4M0Ylva1n8CKBxScnOs3k4gPs35a4Ec';
var UNIVERSAL_TAB = 'Universal';
var ALL_USER_TAB = 'All user';
var SCRIPT_VERSION = 11;

/** Old headers that must never be re-created (and are deleted if still present). */
var RETIRED_COLUMNS = [
  'Image input (Separate links)',
  'Image input (separate links)',
  'Image input'
];

/** Columns written on Rate & Approve (header names must match All user row 1). */
var APPROVE_COLUMNS = [
  'EAN Number',
  'Author',
  'Primary/Product replacement',
  'Product Type',
  'Product Type Variant',
  'Sub-category',
  'Template',
  'Prior EAN',
  'Match level',
  'Model name',
  'Image size',
  'Image short code',
  'Image Name',
  'Shot seq',
  'Quality Rating',
  'Generation count',
  'app version',
  'Final successful prompt',
  'Prior image (A)',
  'Product image (B)',
  'Prompt origin',
  'Universal row',
  'Approved At'
];

function doGet(e) {
  var p = (e && e.parameter) || {};
  var body;
  try {
    if (p.action === 'universal') body = { ok: true, data: readUniversal_() };
    else if (p.action === 'promptChunk') body = { ok: true, data: stashPromptChunk_(p) };
    else if (p.action === 'promptApprove') body = { ok: true, data: writePromptApprove_(p) };
    else if (p.action === 'approvedCustoms') body = { ok: true, data: readApprovedCustoms_(p) };
    else if (p.action === 'ping') body = { ok: true, data: { version: SCRIPT_VERSION, sheet: PROMPT_DB_ID } };
    else throw new Error('Unknown action: ' + (p.action || '(none)') +
      '. Use universal, promptChunk, promptApprove, approvedCustoms, or ping.');
  } catch (err) {
    body = { ok: false, error: String((err && err.message) || err) };
  }
  var json = JSON.stringify(body);
  var cb = String(p.callback || '');
  if (/^[A-Za-z_$][\w$]{0,63}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Stash one prompt chunk in CacheService so long Custom prompts can approve via JSONP.
 * Params: uploadId, i (0-based), n (total), data (raw prompt slice)
 */
function stashPromptChunk_(p) {
  var id = String(p.uploadId || '').replace(/[^\w.-]/g, '');
  var i = parseInt(p.i, 10);
  var n = parseInt(p.n, 10);
  var data = String(p.data != null ? p.data : '');
  if (!id) throw new Error('uploadId is required');
  if (isNaN(i) || i < 0 || isNaN(n) || n < 1 || n > 80) throw new Error('Invalid prompt chunk index');
  if (i >= n) throw new Error('Chunk index out of range');
  var cache = CacheService.getScriptCache();
  var key = 'promptUpload:' + id;
  var raw = cache.get(key);
  var obj = raw ? JSON.parse(raw) : { n: n, parts: {} };
  obj.n = n;
  if (!obj.parts) obj.parts = {};
  obj.parts[String(i)] = data;
  // CacheService entry limit ~100KB — prompts stay well under that.
  cache.put(key, JSON.stringify(obj), 600);
  return {
    version: SCRIPT_VERSION,
    uploadId: id,
    received: Object.keys(obj.parts).length,
    n: n
  };
}

function takePromptUpload_(uploadId) {
  var id = String(uploadId || '').replace(/[^\w.-]/g, '');
  if (!id) throw new Error('promptUploadId is required');
  var cache = CacheService.getScriptCache();
  var key = 'promptUpload:' + id;
  var raw = cache.get(key);
  if (!raw) throw new Error('Custom prompt upload expired or missing — approve again');
  var obj = JSON.parse(raw);
  var n = parseInt(obj.n, 10) || 0;
  var parts = [];
  for (var i = 0; i < n; i++) {
    if (obj.parts[String(i)] == null) {
      throw new Error('Missing prompt chunk ' + i + ' of ' + n);
    }
    parts.push(String(obj.parts[String(i)]));
  }
  cache.remove(key);
  return parts.join('');
}

function getSpreadsheet_() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active && active.getId() === PROMPT_DB_ID) return active;
  } catch (ignore) {}
  return SpreadsheetApp.openById(PROMPT_DB_ID);
}

function norm_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

function findSheet_(ss, title) {
  var want = norm_(title);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (norm_(sheets[i].getName()) === want) return sheets[i];
  }
  // Soft match: "All user" / "All User" / "all-user"
  var soft = want.replace(/[^a-z0-9]+/g, '');
  for (var j = 0; j < sheets.length; j++) {
    if (norm_(sheets[j].getName()).replace(/[^a-z0-9]+/g, '') === soft) return sheets[j];
  }
  throw new Error('Tab not found: "' + title + '". Available: ' +
    sheets.map(function (sh) { return sh.getName(); }).join(', '));
}

/** Read Universal tab — full grid as values[][] (row 0 = headers). */
function readUniversal_() {
  var ss = getSpreadsheet_();
  var sheet = findSheet_(ss, UNIVERSAL_TAB);
  var values = sheet.getDataRange().getDisplayValues();
  if (!values || !values.length) values = [[]];
  return {
    version: SCRIPT_VERSION,
    tab: sheet.getName(),
    sheetId: ss.getId(),
    values: values,
    readAt: new Date().toISOString()
  };
}

/**
 * Append one approval row to All user.
 * Params (query string): ean, author, workflow, productType, model, imageShortCode,
 *   imageName, qualityRating, appVersion, prompt, priorImage, productImage, promptOrigin, universalRow
 */
function writePromptApprove_(p) {
  var ean = String(p.ean || '').trim();
  var author = String(p.author || '').trim();
  var prompt = String(p.prompt || '');
  var origin = String(p.promptOrigin || p.origin || '').trim();
  var rating = String(p.qualityRating != null ? p.qualityRating : (p.rating != null ? p.rating : '')).trim();
  var uploadId = String(p.promptUploadId || p.uploadId || '').trim();

  if (!ean) throw new Error('ean is required');
  if (!author) throw new Error('author is required');
  if (!origin) throw new Error('promptOrigin is required (Automated or Custom)');
  if (!rating) throw new Error('qualityRating is required (1–5)');
  if (!/^[1-5]$/.test(rating)) throw new Error('qualityRating must be 1–5, got: ' + rating);
  if (/^automated$/i.test(origin)) origin = 'Automated';
  else if (/^custom$/i.test(origin)) origin = 'Custom';
  else throw new Error('promptOrigin must be Automated or Custom');

  // Long Custom prompts arrive via promptChunk uploads (JSONP URL limit).
  if (origin === 'Custom' && uploadId) {
    prompt = takePromptUpload_(uploadId);
  }
  // Only Custom prompts are stored; Automated keeps the cell blank.
  if (origin === 'Custom' && !String(prompt || '').trim()) {
    throw new Error('Custom prompt is empty — edit the prompt or use Default before Approve');
  }
  if (origin === 'Automated') prompt = '';

  var ss = getSpreadsheet_();
  var sheet = findSheet_(ss, ALL_USER_TAB);
  ensureHeaders_(sheet);

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var colIndex = {};
  header.forEach(function (h, i) {
    var key = norm_(h);
    if (key) colIndex[key] = i;
  });

  function col(name) {
    var i = colIndex[norm_(name)];
    return i == null ? -1 : i;
  }

  var width = Math.max(header.length, APPROVE_COLUMNS.length);
  var row = [];
  for (var c = 0; c < width; c++) row.push('');

  function set(name, value) {
    var i = col(name);
    if (i < 0) return;
    row[i] = value == null ? '' : String(value);
  }

  var approvedAt = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'Asia/Kolkata',
    "yyyy-MM-dd'T'HH:mm:ssXXX"
  );

  var priorImage = String(p.priorImage || p.imagePrior || '').trim();
  var productImage = String(p.productImage || p.imageProduct || '').trim();

  set('EAN Number', ean);
  set('Author', author);
  set('Primary/Product replacement', String(p.workflow || 'Product replacement').trim() || 'Product replacement');
  set('Product Type', String(p.productType || '').trim());
  set('Product Type Variant', String(p.productTypeVariant || p.variant || '').trim());
  set('Sub-category', String(p.subCategory || p.subcategory || '').trim());
  set('Template', String(p.template || '').trim());
  set('Prior EAN', String(p.priorEan || p.matchEan || '').trim());
  set('Match level', String(p.matchLevel || p.matchLabel || '').trim());
  // Keep the real Answerly model id/label — any model is allowed.
  set('Model name', String(p.model || p.modelName || '').trim());
  set('Image size', String(p.imageSize || p.size || '').trim());
  set('Image short code', String(p.imageShortCode || p.shotCode || '').trim());
  set('Image Name', String(p.imageName || p.shotName || '').trim());
  set('Shot seq', String(p.shotSeq != null ? p.shotSeq : (p.seq != null ? p.seq : '')).trim());
  // Force rating as plain text so sheet dropdowns / number formats cannot blank it.
  set('Quality Rating', rating);
  // Successful Generate clicks for this shot before Approve (1 = first try, 2+ = regenerations).
  var genCount = String(
    p.generationCount != null ? p.generationCount
      : (p.regenCount != null ? p.regenCount : '')
  ).trim();
  if (genCount && !/^\d+$/.test(genCount)) genCount = '';
  set('Generation count', genCount);
  set('app version', String(p.appVersion || '').trim());
  set('Final successful prompt', prompt);
  set('Prior image (A)', priorImage);
  set('Product image (B)', productImage);
  // Intentionally do not write retired "Image input (Separate links)".
  set('Prompt origin', origin);
  set('Universal row', String(p.universalRow || '').trim());
  set('Approved At', approvedAt);

  var next = sheet.getLastRow() + 1;
  var range = sheet.getRange(next, 1, 1, row.length);
  // Sheet dropdowns on Model name / Quality Rating reject unknown values — clear validation on this row first.
  try { range.clearDataValidations(); } catch (e) { /* ignore */ }
  range.setValues([row]);
  // Re-write rating as text after setValues in case the column format coerced it away.
  var ratingCol = col('Quality Rating');
  if (ratingCol >= 0 && rating) {
    try {
      sheet.getRange(next, ratingCol + 1).setNumberFormat('@').setValue(String(rating));
    } catch (e2) { /* ignore */ }
  }
  SpreadsheetApp.flush();

  return {
    version: SCRIPT_VERSION,
    tab: sheet.getName(),
    row: next,
    ean: ean,
    model: String(p.model || p.modelName || '').trim(),
    promptOrigin: origin,
    qualityRating: rating,
    generationCount: genCount,
    promptChars: origin === 'Custom' ? String(prompt || '').length : 0,
    approvedAt: approvedAt
  };
}

/**
 * Latest Custom prompts from All user for reuse on matching Sub-category + Template (+ shot code).
 * Optional filters: template, subCategory, imageShortCode, limit (default 200).
 */
function readApprovedCustoms_(p) {
  var ss = getSpreadsheet_();
  var sheet = findSheet_(ss, ALL_USER_TAB);
  ensureHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { version: SCRIPT_VERSION, rows: [], count: 0 };
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var header = values[0] || [];
  var colIndex = {};
  header.forEach(function (h, i) {
    var key = norm_(h);
    if (key) colIndex[key] = i;
  });
  function idx(name) {
    var i = colIndex[norm_(name)];
    return i == null ? -1 : i;
  }
  function cell(row, name) {
    var i = idx(name);
    return i < 0 ? '' : String(row[i] || '').trim();
  }
  var wantTpl = norm_(p.template || '');
  var wantSub = norm_(p.subCategory || p.subcategory || '');
  var wantCode = norm_(p.imageShortCode || p.shotCode || '');
  var limit = Math.max(1, Math.min(500, parseInt(p.limit, 10) || 200));
  var out = [];
  // Newest first.
  for (var r = values.length - 1; r >= 1 && out.length < limit; r--) {
    var row = values[r] || [];
    var origin = cell(row, 'Prompt origin');
    if (!/^custom$/i.test(origin)) continue;
    var prompt = cell(row, 'Final successful prompt');
    if (!prompt) continue;
    var tpl = cell(row, 'Template');
    var sub = cell(row, 'Sub-category');
    var code = cell(row, 'Image short code');
    if (wantTpl && norm_(tpl) !== wantTpl) continue;
    if (wantSub && norm_(sub) !== wantSub) continue;
    if (wantCode && norm_(code) !== wantCode) continue;
    out.push({
      ean: cell(row, 'EAN Number'),
      author: cell(row, 'Author'),
      template: tpl,
      subCategory: sub,
      productType: cell(row, 'Product Type'),
      imageShortCode: code,
      imageName: cell(row, 'Image Name'),
      qualityRating: cell(row, 'Quality Rating'),
      prompt: prompt,
      promptOrigin: 'Custom',
      universalRow: cell(row, 'Universal row'),
      priorEan: cell(row, 'Prior EAN'),
      approvedAt: cell(row, 'Approved At'),
      row: r + 1
    });
  }
  return { version: SCRIPT_VERSION, rows: out, count: out.length };
}

/** Delete retired columns (e.g. redundant "Image input (Separate links)") from right to left. */
function retireObsoleteColumns_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  if (sheet.getLastRow() < 1) return;
  var header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var retired = {};
  RETIRED_COLUMNS.forEach(function (name) {
    retired[norm_(name)] = true;
  });
  for (var c = header.length - 1; c >= 0; c--) {
    if (retired[norm_(header[c])]) {
      try { sheet.deleteColumn(c + 1); } catch (e) { /* ignore */ }
    }
  }
}

/** Ensure row 1 has every APPROVE_COLUMNS name (append missing headers only; never reorder). */
function ensureHeaders_(sheet) {
  retireObsoleteColumns_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var lastRow = sheet.getLastRow();
  var header = lastRow >= 1
    ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    : [];
  var have = {};
  header.forEach(function (h) {
    var k = norm_(h);
    if (k) have[k] = true;
  });
  // Never re-add retired columns even if somehow listed elsewhere.
  RETIRED_COLUMNS.forEach(function (name) {
    have[norm_(name)] = true;
  });
  var missing = [];
  APPROVE_COLUMNS.forEach(function (name) {
    if (!have[norm_(name)]) missing.push(name);
  });
  if (!missing.length) return;
  if (!header.length || !String(header[0] || '').trim()) {
    // Empty sheet — write full header row
    sheet.getRange(1, 1, 1, APPROVE_COLUMNS.length).setValues([APPROVE_COLUMNS]);
    return;
  }
  var start = lastCol + 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);
}

/** Run once from the editor to verify tabs + authorize write. */
function checkPromptDb() {
  var ss = getSpreadsheet_();
  Logger.log('Spreadsheet: ' + ss.getName() + ' (' + ss.getId() + ')');
  var u = findSheet_(ss, UNIVERSAL_TAB);
  Logger.log('Universal OK: "' + u.getName() + '", rows=' + u.getLastRow());
  var a = findSheet_(ss, ALL_USER_TAB);
  ensureHeaders_(a);
  Logger.log('All user OK: "' + a.getName() + '", rows=' + a.getLastRow() +
    ', headers=' + a.getRange(1, 1, 1, a.getLastColumn()).getDisplayValues()[0].join(' | '));
  Logger.log('Script version ' + SCRIPT_VERSION + ' — authorize if prompted, then Deploy → New deployment.');
}
