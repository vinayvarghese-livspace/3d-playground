/**
 * Prompt Database — standalone web app (separate from HH Multi Sheet Reader).
 *
 * Bound to: Prompt Database spreadsheet
 *   https://docs.google.com/spreadsheets/d/12NU2Ru7Jnxok4M0Ylva1n8CKBxScnOs3k4gPs35a4Ec
 *
 * Actions (JSON or JSONP via ?callback=):
 *   action=universal     — read Universal tab (templates)
 *   action=promptApprove — append Rate & Approve row to All user
 *   action=ping          — health check
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone within Livspace (or same as your other HH reader)
 */

var PROMPT_DB_ID = '12NU2Ru7Jnxok4M0Ylva1n8CKBxScnOs3k4gPs35a4Ec';
var UNIVERSAL_TAB = 'Universal';
var ALL_USER_TAB = 'All user';
var SCRIPT_VERSION = 5;

/** Columns written on Rate & Approve (header names must match All user row 1). */
var APPROVE_COLUMNS = [
  'EAN Number',
  'Author',
  'Primary/Product replacement',
  'Product Type',
  'Model name',
  'Image short code',
  'Image Name',
  'Quality Rating',
  'app version',
  'Final successful prompt',
  'Image input (Separate links)',
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
    else if (p.action === 'promptApprove') body = { ok: true, data: writePromptApprove_(p) };
    else if (p.action === 'ping') body = { ok: true, data: { version: SCRIPT_VERSION, sheet: PROMPT_DB_ID } };
    else throw new Error('Unknown action: ' + (p.action || '(none)') + '. Use universal, promptApprove, or ping.');
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
 *   imageName, qualityRating, appVersion, prompt, imageInput, promptOrigin, universalRow
 */
function writePromptApprove_(p) {
  var ean = String(p.ean || '').trim();
  var author = String(p.author || '').trim();
  var prompt = String(p.prompt || '');
  var origin = String(p.promptOrigin || p.origin || '').trim();
  var rating = String(p.qualityRating != null ? p.qualityRating : (p.rating != null ? p.rating : '')).trim();

  if (!ean) throw new Error('ean is required');
  if (!author) throw new Error('author is required');
  if (!origin) throw new Error('promptOrigin is required (Automated or Custom)');
  if (/^automated$/i.test(origin)) origin = 'Automated';
  else if (/^custom$/i.test(origin)) origin = 'Custom';
  else throw new Error('promptOrigin must be Automated or Custom');
  // Only Custom prompts are stored; Automated keeps the cell blank.
  // If Custom arrives without a prompt (common when JSONP truncates long URLs),
  // fall back to Automated instead of failing the whole approve write.
  if (origin === 'Custom' && !String(prompt || '').trim()) {
    origin = 'Automated';
    prompt = '';
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
  var imageInput = String(p.imageInput || '').trim();
  if (!imageInput && (priorImage || productImage)) {
    imageInput = [
      priorImage ? ('A: ' + priorImage) : '',
      productImage ? ('B: ' + productImage) : ''
    ].filter(Boolean).join(' | ');
  }

  set('EAN Number', ean);
  set('Author', author);
  set('Primary/Product replacement', String(p.workflow || 'Product replacement').trim() || 'Product replacement');
  set('Product Type', String(p.productType || '').trim());
  // Keep the real Answerly model id/label — any model is allowed.
  set('Model name', String(p.model || p.modelName || '').trim());
  set('Image short code', String(p.imageShortCode || p.shotCode || '').trim());
  set('Image Name', String(p.imageName || p.shotName || '').trim());
  set('Quality Rating', rating);
  set('app version', String(p.appVersion || '').trim());
  set('Final successful prompt', prompt);
  set('Image input (Separate links)', imageInput);
  set('Prior image (A)', priorImage);
  set('Product image (B)', productImage);
  set('Prompt origin', origin);
  set('Universal row', String(p.universalRow || '').trim());
  set('Approved At', approvedAt);

  var next = sheet.getLastRow() + 1;
  var range = sheet.getRange(next, 1, 1, row.length);
  // Sheet dropdowns on Model name (and similar) reject unknown values — clear validation on this row first.
  try { range.clearDataValidations(); } catch (e) { /* ignore */ }
  range.setValues([row]);
  SpreadsheetApp.flush();

  return {
    version: SCRIPT_VERSION,
    tab: sheet.getName(),
    row: next,
    ean: ean,
    model: String(p.model || p.modelName || '').trim(),
    promptOrigin: origin,
    approvedAt: approvedAt
  };
}

/** Ensure row 1 has every APPROVE_COLUMNS name (append missing headers only; never reorder). */
function ensureHeaders_(sheet) {
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
