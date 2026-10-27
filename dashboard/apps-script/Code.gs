// HH Multi Sheet Reader.
// Shoot / Naming are read-only. Assign writes append to the live LSH-HH-Render Tracker
// (Artist, PDP Images, Start Date) when the EAN is not already present.
// Drive stays read-only. script.external_request is only used for Shoot Tracker byte-range reads.

const SOURCES = {
  render: { label: 'LSH-HH-Render Tracker', type: 'sheet', id: '12ckZ3NVf2bF08A7Lq6rFf08qK-gIz5mdQL65C-3l--U' },
  // Native Google Sheet (Save as Google Sheets). Live edits are readable immediately — no .xlsx write-back lag.
  shoot:  { label: 'Shoot Tracker - HH', type: 'sheet', id: '1mowqAXZMzYmy-EXrl3gAiqX72FjWn0FBlPZD9ZsuBIw',
            tabs: ['Decor and Garden', 'Table Top & Bath', 'Kitchen & Laundry'],
            lookupTabs: ['Upload Log', 'Log'] },
  naming: { label: 'LSH-HH-Naming Convention-Test-2', type: 'sheet', id: '1BCUOtOmzYyMcfxptuwpSNOtvyN7PC7k792pljITUM8w',
            tabs: ['Shot List'] },
  // Live Render Tracker — Pick/Assign write-back (same file as render). Tracker tab:
  // EAN Number | Photoshoot Status | Artist | PDP Images | Start Date | End Date | …
  assign: { label: 'LSH-HH-Render Tracker', type: 'sheet', id: '12ckZ3NVf2bF08A7Lq6rFf08qK-gIz5mdQL65C-3l--U' }
};
const RENDER_TAB = 'Tracker';
const NAMING_TAB = 'Shot List';
const NAMING_COLUMNS = ['Category', 'Product Type', 'Variant', 'Seq', 'Image Name', 'Shot Code'];
// Written into PDP Images on assign (one of that column's dropdown values).
const ASSIGN_PDP_STATUS = 'Blocked';
const CACHE_SECONDS = 21600;
const CACHE_CHUNK = 30000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const XLSX_MEMO = {};
// tasks.js warns when the deployed web app is older than this; raise both together.
const FEED_VERSION = 27;

/* ---------- Web app ---------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action) return apiResponse_(p);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('HH Multi Sheet Reader')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// JSON, or JSONP when a callback is given (the 3D Playground page loads it with a <script> tag).
function apiResponse_(p) {
  let body;
  try {
    if (p.action === 'tasks') body = { ok: true, data: getTaskFeed() };
    else if (p.action === 'thumbs') body = { ok: true, data: getFolderImages(String(p.ids || '').split(',')) };
    else if (p.action === 'assign') body = { ok: true, data: writeAssigns_(p) };
    else if (p.action === 'assigns') body = { ok: true, data: readAssignSheet_() };
    else throw new Error('Unknown action: ' + p.action);
  } catch (err) {
    body = { ok: false, error: String((err && err.message) || err) };
  }
  const json = JSON.stringify(body);
  const cb = String(p.callback || '');
  if (/^[A-Za-z_$][\w$]{0,63}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function getTaskFeed() {
  const src = source_('shoot');
  const tabs = src.tabs;
  let availableShootTabs = [];
  try { availableShootTabs = sheetTabs_(src).map(p => p.title); } catch (err) { availableShootTabs = []; }
  let results;
  try {
    results = readShootTabs_(src, tabs);
  } catch (err) {
    const error = String((err && err.message) || err);
    results = {};
    tabs.forEach(tab => { results[tab] = { error }; });
  }
  const shoot = tabs.map(tab => (results[tab].error ? { tab, error: results[tab].error } : Object.assign({ tab }, results[tab])));
  const naming = readTab_('naming', NAMING_TAB);
  naming.values = pickColumns_(naming.values, NAMING_COLUMNS);
  let assigns = { values: [], links: {}, name: '' };
  try { assigns = readAssignSheet_(); } catch (err) { assigns = { values: [], links: {}, error: String(err.message || err) }; }
  let render;
  try { render = readTab_('render', RENDER_TAB); } catch (err) {
    render = { values: [], links: {}, error: String((err && err.message) || err) };
  }
  return {
    version: FEED_VERSION,
    availableShootTabs,
    shoot,
    render,
    assigns,
    naming,
    readAt: new Date().toISOString()
  };
}

// Run from the editor: Photoshoot Status histogram + how many rows already have GDRIVE + template.
function inspectShootStatuses() {
  const src = source_('shoot');
  src._tabProps = null;
  src._driveMap = null;
  (src.tabs || []).forEach(tab => {
    let parsed;
    try { parsed = readNativeTab_(src, tab, true); } catch (err) {
      Logger.log(tab + ': ERROR ' + err);
      return;
    }
    if (parsed.error) { Logger.log(tab + ': ' + parsed.error); return; }
    const headers = (parsed.values[0] || []).map(h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
    const eanCol = headers.indexOf('ean code');
    const statusCol = headers.findIndex(h => /photoshoot status/.test(h));
    const tplCol = headers.findIndex(h => /template/.test(h));
    const driveCols = headers.map((h, c) => (/gdrive|drive/.test(h) ? c : -1)).filter(c => c >= 0);
    Logger.log('--- ' + tab + ' --- rows=' + Math.max(0, parsed.values.length - 1) +
      ' statusCol=' + (statusCol >= 0 ? colA1_(statusCol) + '("' + headers[statusCol] + '")' : 'MISSING') +
      ' templateCol=' + (tplCol >= 0 ? colA1_(tplCol) : 'MISSING') +
      ' driveCols=' + (driveCols.map(c => colA1_(c)).join(',') || 'none'));

    const statusCounts = {};
    let withDrive = 0;
    let withTpl = 0;
    let withBoth = 0;
    let bothDone = 0;
    for (let r = 1; r < parsed.values.length; r++) {
      const ean = String(parsed.values[r][eanCol] || '').replace(/\s+/g, '');
      if (!ean) continue;
      const status = String(statusCol >= 0 ? (parsed.values[r][statusCol] || '') : '').trim() || 'blank';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const hasTpl = tplCol >= 0 && /T\d+/i.test(String(parsed.values[r][tplCol] || ''));
      const hasDrive = driveCols.some(c => parsed.links[r + ',' + c]) ||
        driveCols.some(c => /drive\.google\.com|folders\//i.test(String(parsed.values[r][c] || '')));
      if (hasDrive) withDrive++;
      if (hasTpl) withTpl++;
      if (hasDrive && hasTpl) {
        withBoth++;
        if (/^done\b/i.test(status)) bothDone++;
      }
    }
    Logger.log('Status counts: ' + Object.keys(statusCounts).sort((a, b) => statusCounts[b] - statusCounts[a])
      .map(k => '"' + k + '"=' + statusCounts[k]).join(', '));
    Logger.log('With GDRIVE link: ' + withDrive + ', with template: ' + withTpl +
      ', with both: ' + withBoth + ', both + Done: ' + bothDone);
  });
}

// Run from the Apps Script editor after sheet cleanup — lists every tab name still in Shoot Tracker.
function listShootTabs() {
  const src = source_('shoot');
  src._tabProps = null;
  const titles = sheetTabs_(src).map(p => p.title);
  Logger.log('Shoot Tracker tabs (' + titles.length + '):');
  titles.forEach((t, i) => Logger.log((i + 1) + '. "' + t + '"'));
  Logger.log('Configured product tabs: ' + (src.tabs || []).map(t => '"' + t + '"').join(', '));
  (src.tabs || []).forEach(want => {
    const hit = titles.find(t => normTab_(t) === normTab_(want));
    Logger.log('  ' + want + ' → ' + (hit ? 'OK ("' + hit + '")' : 'MISSING'));
  });
  const logs = nativeLogTabs_(src);
  Logger.log('Upload Log / Log tabs: ' + (logs.length ? logs.map(t => '"' + t + '"').join(', ') : 'none'));
}

/* ---------- Assign sheet (read + append-only write) ---------- */

function assignTabTitle_(src) {
  const titles = sheetTabs_(src).map(p => p.title);
  const hit = titles.find(t => normTab_(t) === 'tracker') || titles.find(t => /assign|render|tracker/i.test(t));
  return hit || titles[0] || 'Sheet1';
}

function readAssignSheet_() {
  const src = source_('assign');
  const title = assignTabTitle_(src);
  const range = "'" + title.replace(/'/g, "''") + "'";
  const values = trimValues_((Sheets.Spreadsheets.Values.get(src.id, range, { valueRenderOption: 'FORMATTED_VALUE' }).values) || []);
  return { name: title, values, links: linksFromCellText_(values), modified: DriveApp.getFileById(src.id).getLastUpdated().toISOString() };
}

// Append-only Pick/Assign rows via SpreadsheetApp (needs spreadsheets write scope).
// Never deletes, clears, or overwrites existing rows. If the EAN is already in column A, that pick is skipped.
// Writes only: A EAN Number | C Artist | D PDP Images (= Blocked) | E Start Date.
// Does not touch: B Photoshoot Status, F End Date, G Drive Link, or any QC columns.
function writeAssigns_(p) {
  const src = source_('assign');
  const artist = String(p.artist || '').trim();
  if (!artist) throw new Error('Artist name is required');
  let rows;
  try { rows = JSON.parse(String(p.rows || '[]')); } catch (err) { throw new Error('Invalid rows payload'); }
  if (!Array.isArray(rows) || !rows.length) throw new Error('No tasks to assign');

  const ss = SpreadsheetApp.openById(src.id);
  const title = assignTabTitle_(src);
  const sheet = ss.getSheetByName(title) || ss.getSheets()[0];
  if (!sheet) throw new Error('No tab found in the assign sheet');

  const lastRow = sheet.getLastRow();
  const have = {};
  if (lastRow >= 1) {
    const existing = sheet.getRange(1, 1, lastRow, 1).getValues();
    existing.forEach((row, i) => {
      if (i === 0 && !/^\d/.test(lookupKey_(row[0]))) return;
      const key = lookupKey_(row[0]);
      if (key) have[key] = true;
    });
  }

  const startDate = formatAssignDate_(new Date());
  const eans = [];
  const artists = [];
  const pdps = [];
  const starts = [];
  const written = [];
  const skipped = [];
  rows.forEach(r => {
    const ean = lookupKey_(r && r.ean);
    if (!ean || !/^\d{8,}/.test(ean)) return;
    if (have[ean]) { skipped.push(ean); return; }
    have[ean] = true;
    eans.push([ean]);
    artists.push([artist]);
    pdps.push([ASSIGN_PDP_STATUS]);
    starts.push([startDate]);
    written.push(ean);
  });

  if (eans.length) {
    const start = sheet.getLastRow() + 1;
    const n = eans.length;
    sheet.getRange(start, 1, n, 1).setValues(eans);       // A EAN Number
    sheet.getRange(start, 3, n, 1).setValues(artists);    // C Artist
    sheet.getRange(start, 4, n, 1).setValues(pdps);       // D PDP Images
    sheet.getRange(start, 5, n, 1).setValues(starts);     // E Start Date
    SpreadsheetApp.flush();
  }
  return {
    written: written.length,
    skipped: skipped.length,
    writtenEans: written,
    skippedEans: skipped,
    startDate: startDate,
    pdpImages: ASSIGN_PDP_STATUS,
    sheet: src.id,
    tab: sheet.getName()
  };
}

function formatAssignDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Kolkata', 'dd-MMM-yyyy');
}

// Run once from the editor to grant write access (Authorize when prompted), then deploy a new version.
function checkAssignWrite() {
  const src = source_('assign');
  const ss = SpreadsheetApp.openById(src.id);
  const sheet = ss.getSheetByName(assignTabTitle_(src)) || ss.getSheets()[0];
  Logger.log('Assign sheet open OK: "' + ss.getName() + '" / tab "' + sheet.getName() + '", last row ' + sheet.getLastRow());
  Logger.log('Header: ' + sheet.getRange(1, 1, 1, 6).getValues()[0].join(' | '));
  Logger.log('Write scope is active. On Pick writes only A EAN, C Artist, D ' + ASSIGN_PDP_STATUS +
    ', E ' + formatAssignDate_(new Date()) + ' — leaves B Photoshoot Status, F End Date, G+ Drive/QC untouched');
}

// Shoot Tracker tabs plus Drive-folder fill from Upload Log / Log. Native sheet or legacy .xlsx.
function readShootTabs_(src, tabs) {
  if (src.type === 'xlsx') return readXlsxTabs_(src, tabs);
  return readNativeShootTabs_(src, tabs);
}

// Keeps only the named columns (header match ignores case and spaces), in the given order.
function pickColumns_(values, names) {
  if (!values.length) return values;
  const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const headers = values[0].map(norm);
  const idx = names.map(n => headers.indexOf(norm(n))).filter(i => i >= 0);
  return values.map(r => idx.map(i => r[i]));
}

// Run this once from the editor to grant the read-only permissions and check the feed.
function checkTaskFeed() {
  const src = source_('shoot');
  // Fresh maps for this run (warm script instances can keep the last in-memory map).
  src._driveMap = null;
  src._driveMapInfo = null;
  src._tabProps = null;
  Logger.log('Shoot Tracker: ' + src.type + ' ' + src.id);
  if (src.type !== 'xlsx') {
    Logger.log('Tabs: ' + sheetTabs_(src).map(p => '"' + p.title + '"').join(', '));
    Logger.log('Log tabs: ' + (nativeLogTabs_(src).map(t => '"' + t + '"').join(', ') || 'none'));
  }
  const feed = getTaskFeed();
  if (src.type !== 'xlsx') {
    // Always rebuild the map for the log line (product tabs may have been served from cache).
    src._driveMap = null;
    src._driveMapInfo = null;
    nativeDriveMap_(src);
    (src._driveMapInfo || []).forEach(line => Logger.log(line));
    Logger.log('Upload Log map size: ' + Object.keys(src._driveMap || {}).length);
    if (src._driveFillInfo) Logger.log(src._driveFillInfo);
  }
  feed.shoot.forEach(t => {
    if (t.error) { Logger.log(t.tab + ': ' + t.error); return; }
    const folders = Object.keys(t.links).filter(k => /\/folders\//.test(t.links[k])).length;
    const driveHeaders = (t.values[0] || []).map((h, c) => [h, c]).filter(([h]) => /drive/i.test(h))
      .map(([h, c]) => '"' + String(h).replace(/\s+/g, ' ') + '" (column ' + (c + 1) + ')');
    Logger.log(t.tab + ': ' + (t.values.length - 1) + ' rows, ' + Object.keys(t.links).length + ' links, ' + folders + ' Drive folder links. Drive headers: ' + (driveHeaders.join(', ') || 'none'));
  });
  if (src._driveFillInfo) Logger.log(src._driveFillInfo);
  Logger.log('Render Tracker: ' + (feed.render.values.length - 1) + ' rows');
  Logger.log('Naming Convention: ' + (feed.naming.values.length - 1) + ' rows');

  const folderIds = [];
  feed.shoot.forEach(t => Object.keys(t.links || {}).forEach(k => {
    const m = String(t.links[k]).match(/\/folders\/([\w-]+)|[?&]id=([\w-]+)/);
    if (m && folderIds.length < 3) folderIds.push(m[1] || m[2]);
  }));
  const images = getFolderImages(folderIds);
  folderIds.forEach(id => Logger.log('Drive folder ' + id + ': ' + images[id].length + ' images'));
}

// Reads the three Shoot Tracker tabs without the cache and logs how long each step takes.
function inspectShootTracker() {
  const src = source_('shoot');
  const t0 = Date.now();
  const lap = msg => Logger.log(msg + '   [' + ((Date.now() - t0) / 1000).toFixed(1) + ' s]');
  if (src.type === 'xlsx') {
    const book = xlsxBook_(src);
    lap('File index, tab list, shared text and styles read (' + Object.keys(book.entries).length + ' parts, ' + book.sheets.length + ' tabs)');
    const tabs = book.sheets.filter(s => allowedTab_(src, s.name));
    book.prefetch(xlsxParts_(src, book, tabs));
    lap('Read ' + tabs.map(s => s.name).join(', '));
    tabs.forEach(s => {
      const parsed = parseXlsxSheet_(book, s);
      lap('Parsed ' + s.name + ': ' + (parsed.values.length - 1) + ' rows, ' + (parsed.values[0] || []).length + ' columns, ' + Object.keys(parsed.links).length + ' links');
    });
    Logger.log('Unpacked directly: ' + ZIP_STATS.direct + ', rebuilt: ' + ZIP_STATS.rebuilt);
    return;
  }
  Logger.log('Native sheet ' + src.id);
  lap('Tabs: ' + sheetTabs_(src).map(p => p.title).join(', '));
  nativeLogTabs_(src).forEach(t => Logger.log('Log tab: ' + t));
  nativeDriveMap_(src);
  (src._driveMapInfo || []).forEach(line => Logger.log(line));
  lap('Upload Log map: ' + Object.keys(src._driveMap || {}).length + ' EANs');
  src.tabs.forEach(tab => {
    const parsed = readNativeTab_(src, tab, true);
    lap(tab + ': ' + (parsed.values.length - 1) + ' rows, ' + Object.keys(parsed.links).length + ' links, ' +
      Object.keys(parsed.links).filter(k => /\/folders\//.test(parsed.links[k])).length + ' Drive folders');
  });
}

// Logs how one EAN's GDRIVE LINK cell is stored. Change DEBUG_EAN and run from the editor.
const DEBUG_EAN = '8909327028525';
// PDP guideline debug EANs — run inspectPdpLinks() from the Apps Script editor.
const DEBUG_PDP_EANS = ['8909327048158', '8909327041531'];

// Run from the editor (select inspectPdpLinks → Run) and read Execution log.
// Shows header, display text, formula, Values-API link, grid hyperlink, rich-text URL for each EAN.
function inspectPdpLinks() {
  const src = source_('shoot');
  const want = DEBUG_PDP_EANS.map(e => String(e).replace(/\s+/g, ''));
  Logger.log('FEED_VERSION=' + FEED_VERSION + ' shoot=' + src.id);
  Logger.log('Looking for EANs: ' + want.join(', '));

  src.tabs.forEach(tab => {
    const props = sheetTabs_(src).find(p => normTab_(p.title) === normTab_(tab));
    if (!props) {
      Logger.log(tab + ': tab not found');
      return;
    }
    const range = "'" + props.title.replace(/'/g, "''") + "'";
    const values = trimValues_((Sheets.Spreadsheets.Values.get(src.id, range, { valueRenderOption: 'FORMATTED_VALUE' }).values) || []);
    let formulas = [];
    try {
      formulas = trimValues_((Sheets.Spreadsheets.Values.get(src.id, range, { valueRenderOption: 'FORMULA' }).values) || []);
    } catch (err) { formulas = []; }

    const headers = (values[0] || []).map(h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
    const eanCol = headers.indexOf('ean code');
    const pdpCols = linkColumnIndexes_(values[0]).filter(c => /pdp|guideline|slides/.test(headers[c] || ''));
    Logger.log('--- ' + props.title + ' --- eanCol=' + (eanCol >= 0 ? colA1_(eanCol) : 'missing') +
      ' pdpCols=' + (pdpCols.map(c => colA1_(c) + '("' + headers[c] + '")').join(', ') || 'none'));
    Logger.log('All headers: ' + headers.map((h, c) => colA1_(c) + '=' + h).join(' | '));

    if (eanCol < 0 || !pdpCols.length) return;

    let found = 0;
    for (let r = 1; r < values.length; r++) {
      const ean = String(values[r][eanCol] || '').replace(/\s+/g, '');
      if (want.indexOf(ean) < 0) continue;
      found++;
      pdpCols.forEach(c => {
        const text = String(values[r][c] || '');
        const formula = String((formulas[r] && formulas[r][c]) || '');
        const fm = String(formula || '').match(/^=\s*HYPERLINK\s*\(\s*["'](https?:\/\/[^"']+)["']/i);
        const formulaUrl = fm ? fm[1] : '';

        let gridUrl = '';
        try {
          const a1 = "'" + props.title.replace(/'/g, "''") + "'!" + colA1_(c) + (r + 1);
          const res = Sheets.Spreadsheets.get(src.id, {
            ranges: [a1],
            includeGridData: true,
            fields: 'sheets(data(rowData(values(chipRuns,hyperlink,textFormatRuns,formattedValue,userEnteredValue))))'
          });
          const cell = ((((res.sheets || [])[0] || {}).data || [])[0] || {}).rowData;
          const v = cell && cell[0] && cell[0].values && cell[0].values[0];
          gridUrl = cellGridLinkUrl_(v);
          Logger.log(ean + ' ' + colA1_(c) + (r + 1) + ' grid raw: ' + JSON.stringify(v || null).slice(0, 800));
        } catch (err) {
          Logger.log(ean + ' grid error: ' + err);
        }

        let richUrl = '';
        try {
          const sheet = SpreadsheetApp.openById(src.id).getSheetByName(props.title);
          const rt = sheet.getRange(r + 1, c + 1).getRichTextValue();
          richUrl = richTextLinkUrl_(rt);
        } catch (err) {
          Logger.log(ean + ' richText error: ' + err);
        }

        const driveUrl = text && !/^https?:\/\//i.test(text) ? driveFileUrlByName_(text) : '';
        Logger.log(ean + ' ' + colA1_(c) + (r + 1) +
          ' display="' + text.slice(0, 80) + '"' +
          ' formula="' + formula.slice(0, 120) + '"' +
          ' formulaUrl=' + (formulaUrl || '(none)') +
          ' gridUrl=' + (gridUrl || '(none)') +
          ' richUrl=' + (richUrl || '(none)') +
          ' driveByName=' + (driveUrl || '(none)'));
      });
    }
    if (!found) Logger.log(props.title + ': none of the debug EANs on this tab');
  });

  // Also exercise the same path the feed uses (after mergeLinkColumnUrls_).
  Logger.log('--- feed finalize path ---');
  want.forEach(ean => {
    src.tabs.forEach(tab => {
      try {
        const parsed = readNativeTab_(src, tab, false);
        const headers = (parsed.values[0] || []).map(h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
        const eanCol = headers.indexOf('ean code');
        const pdpCols = linkColumnIndexes_(parsed.values[0]).filter(c => /pdp|guideline|slides/.test(headers[c] || ''));
        parsed.values.forEach((row, r) => {
          if (String(row[eanCol] || '').replace(/\s+/g, '') !== ean) return;
          pdpCols.forEach(c => {
            Logger.log('finalize ' + tab + ' ' + ean + ' ' + colA1_(c) + ': text="' +
              String(row[c] || '').slice(0, 60) + '" link=' + (parsed.links[r + ',' + c] || '(none)'));
          });
        });
      } catch (err) {
        Logger.log('finalize ' + tab + ' error: ' + err);
      }
    });
  });
}

function inspectEan() {
  const src = source_('shoot');
  const file = DriveApp.getFileById(src.id);
  Logger.log('File "' + file.getName() + '" (' + file.getMimeType() + '), type=' + src.type + ', saved in Drive at ' +
    Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'dd MMM yyyy HH:mm:ss') + ', ' +
    Math.round(file.getSize() / 1048576) + ' MB, owner ' + (file.getOwner() ? file.getOwner().getEmail() : 'unknown') +
    ', now ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy HH:mm:ss'));

  if (src.type !== 'xlsx') {
    inspectEanNative_(src);
    return;
  }
  inspectEanXlsx_(src);
}

function inspectEanNative_(src) {
  const colName = colA1_;
  Logger.log('Tabs in the file: ' + sheetTabs_(src).map(p => '"' + p.title + '"').join(', '));
  Logger.log('EAN-to-Drive tabs used: ' + (nativeLogTabs_(src).map(t => '"' + t + '"').join(', ') || 'none'));
  const map = nativeDriveMap_(src);
  (src._driveMapInfo || []).forEach(line => Logger.log(line));
  Logger.log('Drive folder for ' + DEBUG_EAN + ': ' + (map[DEBUG_EAN] || 'not found'));
  ['8909327027399', '8909327039613'].forEach(e => Logger.log('Folder for ' + e + ': ' + (map[e] || 'not found')));

  let found = 0;
  src.tabs.forEach(tab => {
    const parsed = readNativeTab_(src, tab, true);
    const headers = (parsed.values[0] || []).map(h => String(h).toLowerCase().replace(/\s+/g, ' ').trim());
    const eanCol = headers.indexOf('ean code');
    const driveCol = headers.findIndex(h => /drive/.test(h));
    const pdpCol = headers.findIndex(h => /pdp|guideline/.test(h));
    parsed.values.forEach((row, r) => {
      if (String(row[eanCol] || '').replace(/\s+/g, '') !== DEBUG_EAN) return;
      found++;
      Logger.log(parsed.name + ', row ' + (r + 1) + ': "' + headers[driveCol] + '" shows "' + row[driveCol] +
        '", link read: ' + (parsed.links[r + ',' + driveCol] || 'none'));
      if (pdpCol >= 0) {
        Logger.log('PDP col ' + colName(pdpCol) + ' "' + headers[pdpCol] + '" shows "' + String(row[pdpCol] || '').slice(0, 60) +
          '", link read: ' + (parsed.links[r + ',' + pdpCol] || 'none'));
      }
      Logger.log('Set / PCs: ' + (row[headers.indexOf('set / pcs')] || '(blank)') +
        ', Template: ' + (row[headers.findIndex(h => /template/.test(h))] || '(blank)') +
        ', Photoshoot Status: ' + (row[headers.findIndex(h => /photoshoot status/.test(h))] || '(blank)'));
      Logger.log('Row values: ' + row.map((v, c) => v ? colName(c) + ' (' + headers[c] + ')=' + String(v).slice(0, 40) : '').filter(Boolean).join(' | '));
    });
  });
  if (!found) Logger.log('EAN ' + DEBUG_EAN + ' not found in ' + src.tabs.join(', '));
}

function inspectEanXlsx_(src) {
  const book = xlsxBook_(src);
  const tabs = book.sheets.filter(s => allowedTab_(src, s.name));
  book.prefetch(xlsxParts_(src, book, tabs));
  const colName = c => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };
  let found = 0;
  tabs.forEach(s => {
    const parsed = parseXlsxSheet_(book, s);
    const headers = (parsed.values[0] || []).map(h => String(h).toLowerCase().replace(/\s+/g, ' ').trim());
    const eanCol = headers.indexOf('ean code');
    const driveCol = headers.findIndex(h => /drive/.test(h));
    if (driveCol < 0) Logger.log(s.name + ': no Drive column. Headers: ' + headers.map((h, c) => colName(c) + '=' + h).join(' | '));
    const xml = book.text(s.path);
    const rels = relsMap_(book.text(sheetRelsPath_(s.path)));
    parsed.values.forEach((row, r) => {
      if (String(row[eanCol]).replace(/\s+/g, '') !== DEBUG_EAN) return;
      found++;
      const ref = colName(driveCol) + (r + 1);
      Logger.log(s.name + ', row ' + (r + 1) + ': "' + headers[driveCol] + '" cell ' + ref + ' shows "' + row[driveCol] + '", link read: ' + (parsed.links[r + ',' + driveCol] || 'none'));
      const cell = xml.match(new RegExp('<c r="' + ref + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)'));
      Logger.log('Cell XML: ' + (cell ? cell[0] : 'not in file'));
      const rowLinks = (xml.match(new RegExp('<hyperlink\\b[^>]*ref="[A-Z]+' + (r + 1) + '(?::[^"]*)?"[^>]*>', 'g')) || [])
        .map(h => h + ' -> ' + (rels[attr_(h.replace(/^<hyperlink/, ''), 'r:id')] || 'no target'));
      Logger.log('Hyperlinks on row ' + (r + 1) + ': ' + (rowLinks.length ? rowLinks.join('  ||  ') : 'none'));
      Logger.log('Row values: ' + row.map((v, c) => colName(c) + ' (' + headers[c] + ')=' + String(v || '(blank)').slice(0, 40)).join(' | '));
    });
  });
  if (!found) Logger.log('EAN ' + DEBUG_EAN + ' not found in ' + tabs.map(s => s.name).join(', '));
  Logger.log('Tabs in the file: ' + book.sheets.map(s => '"' + s.name + '"').join(', '));
  Logger.log('EAN-to-Drive tabs used: ' + (logSheets_(book).map(s => '"' + s.name + '"').join(', ') || 'none'));
  const map = driveMap_(book);
  book.driveMapInfo.forEach(line => Logger.log(line));
  Logger.log('Drive folder for ' + DEBUG_EAN + ': ' + (map[DEBUG_EAN] || 'not found'));
}

/* ---------- Drive folder images (listed only: nothing is downloaded or changed) ---------- */

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_FOLDERS_PER_CALL = 50;
const MAX_IMAGES_PER_FOLDER = 40;
const FOLDER_CACHE_SECONDS = 1800;

// Returns { folderId: [{ id, name, thumb }] }. thumb is Drive's short-lived thumbnail link, which loads in the
// page without a Google cookie (browsers block that cookie on drive.google.com images inside other sites).
// The 30-minute cache stays well inside the link's lifetime. If a folder has no images directly inside,
// the images one level down (e.g. an "Edited" subfolder) are used instead.
function getFolderImages(ids) {
  ids = ids.filter(id => /^[\w-]{10,100}$/.test(id)).slice(0, MAX_FOLDERS_PER_CALL);
  const out = {};
  const cache = CacheService.getUserCache();
  const cached = cache.getAll(ids.map(id => 'imgs2:' + id));
  const missing = [];
  ids.forEach(id => {
    const hit = cached['imgs2:' + id];
    if (hit != null) out[id] = JSON.parse(hit);
    else missing.push(id);
  });
  if (!missing.length) return out;

  const found = listChildren_(missing);
  const subfolders = [];
  missing.forEach(id => {
    out[id] = found[id].images;
    if (!out[id].length) found[id].folders.forEach(f => subfolders.push({ parent: id, id: f.id, name: f.name }));
  });
  if (subfolders.length) {
    const inner = listChildren_(subfolders.map(s => s.id));
    subfolders.forEach(s => inner[s.id].images.forEach(img => out[s.parent].push(Object.assign({}, img, { name: s.name + '/' + img.name }))));
  }

  const put = {};
  missing.forEach(id => {
    out[id] = out[id].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, MAX_IMAGES_PER_FOLDER);
    put['imgs2:' + id] = JSON.stringify(out[id]);
  });
  try { cache.putAll(put, FOLDER_CACHE_SECONDS); } catch (err) { /* uncached: listed again next time */ }
  return out;
}

function listChildren_(parentIds) {
  const result = {};
  parentIds.forEach(id => { result[id] = { images: [], folders: [] }; });
  for (let i = 0; i < parentIds.length; i += 25) {
    const chunk = parentIds.slice(i, i + 25);
    const q = '(' + chunk.map(id => "'" + id + "' in parents").join(' or ') + ')' +
      " and trashed = false and (mimeType contains 'image/' or mimeType = '" + FOLDER_MIME + "')";
    let pageToken;
    do {
      const res = Drive.Files.list({
        q, pageToken, pageSize: 1000,
        fields: 'nextPageToken, files(id, name, mimeType, parents, thumbnailLink)',
        supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      (res.files || []).forEach(f => (f.parents || []).forEach(p => {
        const slot = result[p];
        if (!slot) return;
        if (f.mimeType === FOLDER_MIME) slot.folders.push({ id: f.id, name: f.name });
        else slot.images.push({ id: f.id, name: f.name, thumb: f.thumbnailLink || '' });
      }));
      pageToken = res.nextPageToken;
    } while (pageToken);
  }
  return result;
}

/* ---------- Viewer (Index.html) ---------- */

function getSources() {
  return Object.keys(SOURCES).map(key => ({ key, label: SOURCES[key].label }));
}

function getTabs(sourceKey) {
  const src = source_(sourceKey);
  if (src.type === 'xlsx') {
    return xlsxBook_(src).sheets.filter(s => allowedTab_(src, s.name)).map(s => ({ name: s.name }));
  }
  return sheetTabs_(src)
    .filter(p => allowedTab_(src, p.title))
    .map(p => ({ name: p.title }));
}

function getTabData(sourceKey, tabName) {
  const tab = readTab_(sourceKey, tabName);
  return { values: tab.values, links: tab.links, modified: tab.modified };
}

/* ---------- Sources ---------- */

function source_(key) {
  const src = SOURCES[key];
  if (!src) throw new Error('Unknown source: ' + key);
  if (!src.id || /^PASTE_/.test(src.id)) throw new Error('ID not set for ' + src.label + '. Paste it into SOURCES in Code.gs.');
  return src;
}

function normTab_(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
}

function allowedTab_(src, name) {
  return !src.tabs || src.tabs.some(t => normTab_(t) === normTab_(name));
}

// Every source returns { name, values, links, modified }. links maps "row,col" (0-based, header is row 0) to a URL.
function readTab_(key, tab) {
  const src = source_(key);
  if (!allowedTab_(src, tab)) throw new Error('Tab "' + tab + '" is not enabled for ' + src.label);
  return src.type === 'xlsx' ? readXlsxTab_(src, tab) : readSheetTab_(src, tab);
}

// Native sheets are read through the Sheets API service: unlike SpreadsheetApp.openById,
// it works with the read-only spreadsheets scope.
function sheetTabs_(src) {
  if (src._tabProps) return src._tabProps;
  const meta = Sheets.Spreadsheets.get(src.id, { fields: 'sheets.properties(title,gridProperties)' });
  return (src._tabProps = (meta.sheets || []).map(s => s.properties));
}

function readSheetTab_(src, tab) {
  return readNativeTab_(src, tab, false);
}

// One Values.get + URLs found in cell text. When fillDrive is true, empty GDRIVE cells use Upload Log.
// (Avoids a 2nd formula get and a full-grid hyperlink get — those hit the Sheets read quota.)
function readNativeTab_(src, tab, fillDrive) {
  const props = sheetTabs_(src).find(p => normTab_(p.title) === normTab_(tab));
  if (!props) throw new Error('Tab "' + tab + '" not found in ' + src.label);
  const range = "'" + props.title.replace(/'/g, "''") + "'";
  const values = trimValues_((Sheets.Spreadsheets.Values.get(src.id, range, { valueRenderOption: 'FORMATTED_VALUE' }).values) || []);
  let formulas = [];
  try {
    formulas = trimValues_((Sheets.Spreadsheets.Values.get(src.id, range, { valueRenderOption: 'FORMULA' }).values) || []);
  } catch (err) { formulas = []; }
  return finalizeNativeTab_(src, props.title, values, fillDrive, formulas);
}

function finalizeNativeTab_(src, title, values, fillDrive, formulaValues) {
  const links = linksFromCellText_(values);
  // PDP Guideline / GDRIVE cells often use =HYPERLINK("url","label") — FORMATTED_VALUE hides the URL.
  try { mergeLinks_(links, linksFromFormulas_(formulaValues || [])); } catch (err) { /* keep text links */ }
  // Smart chips / Insert→Link — Values FORMULA does not include those URLs.
  try { mergeLinkColumnUrls_(src, title, values, links); } catch (err) { /* continue without chip URLs */ }
  // Shoot Tracker often stores only the Drive/Slides file title in "PDP guideline link" (no URL).
  try { resolvePdpNameLinks_(values, links); } catch (err) { /* continue without Drive name lookup */ }
  if (fillDrive) {
    try {
      normalizeEanColumn_(values);
      fillNativeDriveFromLog_(src, values, links);
    } catch (err) { /* product rows still usable without Log fill */ }
  }
  try { blankPlaceholderRows_(values, links); } catch (err) { /* ignore */ }
  const trimmed = trimValues_(values);
  Object.keys(links).forEach(k => {
    const [r, c] = k.split(',').map(Number);
    if (r >= trimmed.length || c >= (trimmed[0] || []).length) delete links[k];
  });
  return {
    name: title,
    values: trimmed,
    links,
    modified: DriveApp.getFileById(src.id).getLastUpdated().toISOString()
  };
}

function linksFromCellText_(values) {
  const links = {};
  values.forEach((row, r) => row.forEach((v, c) => {
    const m = String(v || '').match(/https?:\/\/\S+/i);
    if (m) links[r + ',' + c] = m[0].replace(/[.,);]+$/, '');
  }));
  return links;
}

// Parses =HYPERLINK("https://...", "label") from FORMULA render values (double or single quotes).
function linksFromFormulas_(values) {
  const links = {};
  const re = /^=\s*HYPERLINK\s*\(\s*["'](https?:\/\/[^"']+)["']/i;
  (values || []).forEach((row, r) => (row || []).forEach((v, c) => {
    const m = String(v || '').match(re);
    if (m) links[r + ',' + c] = m[1];
  }));
  return links;
}

function mergeLinks_(into, extra) {
  Object.keys(extra || {}).forEach(k => {
    if (!into[k]) into[k] = extra[k];
  });
  return into;
}

function colA1_(c) {
  let s = '';
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s;
}

// Columns that usually hold clickable labels (PDP guideline, Drive) rather than a raw URL in the cell text.
function linkColumnIndexes_(headerRow) {
  const cols = [];
  (headerRow || []).forEach((h, c) => {
    const n = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (/pdp|guideline|slides/.test(n)) cols.push(c);
    else if (/gdrive|drive/.test(n) && /link|upload|folder|gdrive/.test(n)) cols.push(c);
  });
  return cols;
}

function cellGridLinkUrl_(cell) {
  if (!cell) return '';
  // Smart chips (file @-links) carry the real URI — often a Slides deep link with ?slide=id…
  const chips = cell.chipRuns || [];
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i] && chips[i].chip;
    const uri = chip && chip.richLinkProperties && chip.richLinkProperties.uri;
    if (uri && /^https?:\/\//i.test(uri)) return uri;
  }
  if (cell.hyperlink && /^https?:\/\//i.test(cell.hyperlink)) return cell.hyperlink;
  const runs = cell.textFormatRuns || [];
  for (let i = 0; i < runs.length; i++) {
    const uri = runs[i].format && runs[i].format.link && runs[i].format.link.uri;
    if (uri && /^https?:\/\//i.test(uri)) return uri;
  }
  return '';
}

function richTextLinkUrl_(cell) {
  if (!cell) return '';
  try {
    const whole = cell.getLinkUrl();
    if (whole && /^https?:\/\//i.test(whole)) return whole;
  } catch (err) { /* ignore */ }
  try {
    const runs = cell.getRuns() || [];
    for (let i = 0; i < runs.length; i++) {
      const u = runs[i].getLinkUrl();
      if (u && /^https?:\/\//i.test(u)) return u;
    }
  } catch (err) { /* ignore */ }
  return '';
}

// "PDP guideline link" cells often hold a file title only, e.g. "LSH - HH - Decor | PDP Content".
// Resolve unique titles → Drive/Slides webViewLink (cached) and write into links{}.
function resolvePdpNameLinks_(values, links) {
  if (!values.length) return;
  const pdpCols = [];
  (values[0] || []).forEach((h, c) => {
    const n = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (/pdp|guideline/.test(n)) pdpCols.push(c);
  });
  if (!pdpCols.length) return;

  const byName = {};
  for (let r = 1; r < values.length; r++) {
    pdpCols.forEach(c => {
      const key = r + ',' + c;
      if (links[key]) return;
      const text = String((values[r] && values[r][c]) || '').trim();
      if (!text || /^https?:\/\//i.test(text)) return;
      if (!byName[text]) byName[text] = [];
      byName[text].push(key);
    });
  }
  Object.keys(byName).forEach(name => {
    const url = driveFileUrlByName_(name);
    if (!url) return;
    byName[name].forEach(key => { links[key] = url; });
  });
}

function driveFileUrlByName_(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pdpf:' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
    .map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('').slice(0, 32);
  try {
    const hit = cache.get(cacheKey);
    if (hit === '-') return '';
    if (hit) return hit;
  } catch (err) { /* continue */ }

  let url = '';
  try {
    const escaped = raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const res = Drive.Files.list({
      q: "name = '" + escaped + "' and trashed = false",
      pageSize: 10,
      fields: 'files(id, name, mimeType, webViewLink, shortcutDetails)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    const files = res.files || [];
    const prefer = [
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet'
    ];
    let best = null;
    for (let i = 0; i < prefer.length && !best; i++) best = files.find(f => f.mimeType === prefer[i]) || null;
    if (!best) best = files[0] || null;
    if (best) url = driveWebUrl_(best);
  } catch (err) {
    url = '';
  }

  try { cache.put(cacheKey, url || '-', Math.min(CACHE_SECONDS, 21600)); } catch (err) { /* ignore */ }
  return url;
}

function driveWebUrl_(f) {
  if (!f) return '';
  if (f.webViewLink) return f.webViewLink;
  if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails && f.shortcutDetails.targetId) {
    return 'https://drive.google.com/open?id=' + f.shortcutDetails.targetId;
  }
  if (f.mimeType === 'application/vnd.google-apps.presentation') {
    return 'https://docs.google.com/presentation/d/' + f.id + '/edit';
  }
  if (f.mimeType === 'application/vnd.google-apps.document') {
    return 'https://docs.google.com/document/d/' + f.id + '/edit';
  }
  if (f.id) return 'https://drive.google.com/open?id=' + f.id;
  return '';
}

// Fills links{} for PDP / Drive columns from Sheets grid hyperlinks + SpreadsheetApp rich text.
// Values API never returns Insert→Link URLs; only display text like "PDP Guideline".
function mergeLinkColumnUrls_(src, title, values, links) {
  if (!values.length) return;
  const cols = linkColumnIndexes_(values[0]);
  if (!cols.length) return;
  const height = values.length;
  const safeTitle = String(title || '').replace(/'/g, "''");
  const ranges = cols.map(c => "'" + safeTitle + "'!" + colA1_(c) + '1:' + colA1_(c) + height);

  // 1) Advanced Sheets: smart-chip URIs (slide deep links), hyperlink, textFormatRuns
  try {
    const res = Sheets.Spreadsheets.get(src.id, {
      ranges: ranges,
      includeGridData: true,
      fields: 'sheets(data(rowData(values(chipRuns,hyperlink,textFormatRuns))))'
    });
    const data = (res.sheets && res.sheets[0] && res.sheets[0].data) || [];
    data.forEach((grid, i) => {
      const c = cols[i];
      ((grid && grid.rowData) || []).forEach((row, r) => {
        if (r >= height) return;
        const url = cellGridLinkUrl_(row.values && row.values[0]);
        // Chip / grid URL wins (includes ?slide=id…); do not keep a weaker prior value.
        if (url) links[r + ',' + c] = url;
      });
    });
  } catch (err) { /* fall through to SpreadsheetApp */ }

  // Skip SpreadsheetApp.getRichTextValues on full columns — on tall Shoot Tracker tabs it often
  // exceeds the Apps Script time limit (especially after sheet cleanup / re-reads). Chip runs +
  // HYPERLINK formulas + Drive-by-name lookup already cover PDP guideline links.
}

// All product tabs in one batchGet (1 read) + Upload Log map (1 read), instead of ~9 reads per load.
function readNativeShootTabs_(src, tabs) {
  const modified = DriveApp.getFileById(src.id).getLastUpdated();
  const key = tab => ['sheet' + FEED_VERSION, src.id, normTab_(tab).replace(/\W+/g, '_'), modified.getTime()].join(':');
  const out = {};
  const missing = [];
  tabs.forEach(tab => {
    const hit = cacheGet_(key(tab));
    if (hit) out[tab] = hit;
    else missing.push(tab);
  });
  if (!missing.length) return out;

  nativeDriveMap_(src);

  const specs = [];
  missing.forEach(tab => {
    const props = sheetTabs_(src).find(p => normTab_(p.title) === normTab_(tab));
    if (!props) out[tab] = { error: 'Tab "' + tab + '" not found in ' + src.label };
    else specs.push({ tab, title: props.title, range: "'" + props.title.replace(/'/g, "''") + "'" });
  });
  if (!specs.length) return out;

  const batch = Sheets.Spreadsheets.Values.batchGet(src.id, {
    ranges: specs.map(s => s.range),
    valueRenderOption: 'FORMATTED_VALUE'
  });
  let formulaRanges = [];
  try {
    formulaRanges = (Sheets.Spreadsheets.Values.batchGet(src.id, {
      ranges: specs.map(s => s.range),
      valueRenderOption: 'FORMULA'
    }).valueRanges) || [];
  } catch (err) { formulaRanges = []; }
  const valueRanges = batch.valueRanges || [];
  specs.forEach((s, i) => {
    try {
      const values = trimValues_((valueRanges[i] && valueRanges[i].values) || []);
      const formulas = trimValues_((formulaRanges[i] && formulaRanges[i].values) || []);
      const result = finalizeNativeTab_(src, s.title, values, true, formulas);
      result.modified = modified.toISOString();
      cachePut_(key(s.tab), result);
      out[s.tab] = result;
    } catch (err) {
      out[s.tab] = { error: String((err && err.message) || err) };
    }
  });
  return out;
}

// Empty GDRIVE cells get the folder from Upload Log / Log (A = EAN, E = EAN Folder Link).
function fillNativeDriveFromLog_(src, values, links) {
  if (!values.length) return;
  const header = values[0].map(h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
  const eanCol = header.indexOf('ean code');
  const driveCols = header.map((h, c) => (/gdrive|drive link|drive/.test(h) ? c : -1)).filter(c => c >= 0);
  if (eanCol < 0 || !driveCols.length) {
    src._driveFillInfo = 'no fill: eanCol=' + eanCol + ' driveCols=' + driveCols.join(',');
    return;
  }
  const map = nativeDriveMap_(src);
  let filled = 0;
  for (let r = 1; r < values.length; r++) {
    if (driveCols.some(c => links[r + ',' + c])) continue;
    const url = map[lookupKey_(values[r][eanCol])];
    if (!url) continue;
    links[r + ',' + driveCols[0]] = url;
    filled++;
  }
  src._driveFillInfo = 'filled ' + filled + ' GDRIVE cells from Upload Log map (' + Object.keys(map).length + ' EANs, col ' + (driveCols[0] + 1) + ')';
}

// Upload Log layout (local data): column A = EAN, column E = EAN Folder Link. One Values.get only.
function nativeDriveMap_(src) {
  if (src._driveMap) return src._driveMap;
  const map = {};
  src._driveMapInfo = [];
  const tabs = nativeLogTabs_(src);
  if (!tabs.length) {
    src._driveMapInfo.push('No Upload Log / Log tab found. Tabs: ' + sheetTabs_(src).map(p => '"' + p.title + '"').join(', '));
    return (src._driveMap = map);
  }
  tabs.forEach(title => {
    const range = "'" + title.replace(/'/g, "''") + "'!A:E";
    const shown = Sheets.Spreadsheets.Values.get(src.id, range, { valueRenderOption: 'FORMATTED_VALUE' }).values || [];
    const eanCol = LOG_EAN_COL;
    const linkCol = LOG_LINK_COL;
    let added = 0;
    const firstKey = lookupKey_(shown[0] && shown[0][eanCol]);
    const start = /^\d{8,}/.test(firstKey) ? 0 : 1;
    for (let i = start; i < shown.length; i++) {
      const key = lookupKey_(shown[i] && shown[i][eanCol]);
      if (!key || !/^\d{8,}/.test(key) || map[key]) continue;
      const m = String((shown[i] && shown[i][linkCol]) || '').match(/https?:\/\/\S+/i);
      if (!m) continue;
      map[key] = m[0].replace(/[.,);]+$/, '');
      added++;
    }
    src._driveMapInfo.push('"' + title + '": ' + added + ' EANs with a folder link (A=EAN, E=EAN Folder Link). Sample: A=' +
      String((shown[start] && shown[start][eanCol]) || '').slice(0, 20) + ' E=' +
      String((shown[start] && shown[start][linkCol]) || '').slice(0, 60));
  });
  return (src._driveMap = map);
}

function nativeLogTabs_(src) {
  const wanted = (src.lookupTabs || []).map(squashName_);
  return sheetTabs_(src)
    .map(p => p.title)
    .filter(t => {
      const n = squashName_(t);
      return wanted.indexOf(n) >= 0 || n === 'log' || /uploadlog/.test(n);
    })
    .sort((a, b) => (/upload/.test(squashName_(b)) ? 1 : 0) - (/upload/.test(squashName_(a)) ? 1 : 0));
}

// Rewrites the EAN CODE column to a plain digit string so "8.909E+12" still matches Upload Log.
function normalizeEanColumn_(values) {
  if (!values.length) return;
  const headers = values[0].map(h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
  const eanCol = headers.indexOf('ean code');
  if (eanCol < 0) return;
  for (let r = 1; r < values.length; r++) {
    const key = lookupKey_(values[r][eanCol]);
    if (key) values[r][eanCol] = key;
  }
}

function trimValues_(values) {
  if (!values.length) return [];
  let width = values[0].length;
  while (width > 0 && String(values[0][width - 1]).trim() === '') width--;
  let height = values.length;
  while (height > 1 && values[height - 1].slice(0, width).every(v => String(v == null ? '' : v).trim() === '')) height--;
  return values.slice(0, height).map(r => {
    const row = [];
    for (let c = 0; c < width; c++) row.push(r[c] == null ? '' : String(r[c]));
    return row;
  });
}

/* ---------- xlsx (read-only: parts of the file are read, never converted or copied) ---------- */

function readXlsxTab_(src, tab) {
  const result = readXlsxTabs_(src, [tab])[tab];
  if (result.error) throw new Error(result.error);
  return result;
}

// Returns { tab: result or { error } }. Parsed tabs are cached for everyone until the file changes;
// getLastUpdated() runs first, so a user who can't open the file never gets the cached copy.
function readXlsxTabs_(src, tabs) {
  const modified = DriveApp.getFileById(src.id).getLastUpdated();
  const key = tab => ['xlsx' + FEED_VERSION, src.id, normTab_(tab).replace(/\W+/g, '_'), modified.getTime()].join(':');
  const out = {};
  const missing = [];
  tabs.forEach(tab => {
    const hit = cacheGet_(key(tab));
    if (hit) out[tab] = hit;
    else missing.push(tab);
  });
  if (!missing.length) return out;

  const book = xlsxBook_(src);
  const sheets = {};
  missing.forEach(tab => {
    const sheet = book.sheets.find(s => normTab_(s.name) === normTab_(tab));
    if (sheet) sheets[tab] = sheet;
    else out[tab] = { error: 'Tab "' + tab + '" not found in ' + src.label };
  });
  book.prefetch(xlsxParts_(src, book, Object.keys(sheets).map(tab => sheets[tab])));
  Object.keys(sheets).forEach(tab => {
    const result = Object.assign({ name: sheets[tab].name, modified: modified.toISOString() }, parseXlsxSheet_(book, sheets[tab]));
    cachePut_(key(tab), result);
    out[tab] = result;
  });
  return out;
}

// Cell XML and link targets for the given tabs plus the tabs their formulas look links up in, fetched in one round.
function xlsxParts_(src, book, sheets) {
  const lookups = logSheets_(book);
  return [].concat.apply([], sheets.concat(lookups).map(s => [s.path, sheetRelsPath_(s.path)]));
}

function sheetRelsPath_(path) {
  return path.replace(/([^/]+)$/, '_rels/$1.rels');
}

// The Shoot Tracker is larger than the 50 MB Apps Script can load at once (it holds embedded images),
// so only the zip parts that are needed (tab list, cell XML, shared text, styles) are fetched by byte range.
// Each range request to a file this size takes several seconds, so parts are fetched in parallel batches.
function xlsxBook_(src) {
  if (XLSX_MEMO[src.id]) return XLSX_MEMO[src.id];
  const entries = zipIndex_(src.id, DriveApp.getFileById(src.id).getSize());
  const texts = {};
  const prefetch = names => {
    const todo = names.filter(n => !(n in texts));
    todo.filter(n => !entries[n]).forEach(n => { texts[n] = ''; });
    const found = todo.filter(n => entries[n]);
    readZipEntries_(src.id, found.map(n => entries[n])).forEach((t, i) => { texts[found[i]] = t; });
  };
  const text = name => {
    if (!(name in texts)) prefetch([name]);
    return texts[name];
  };
  prefetch(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/styles.xml']);

  const rels = relsMap_(text('xl/_rels/workbook.xml.rels'));
  const sheets = [];
  const re = /<sheet\b([^>]*)>/g;
  const workbook = text('xl/workbook.xml');
  let m;
  while ((m = re.exec(workbook))) {
    const target = rels[attr_(m[1], 'r:id')];
    if (!target) continue;
    const path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    sheets.push({ name: attr_(m[1], 'name'), path });
  }
  if (!sheets.length) throw new Error('Could not read the tabs of ' + src.label + '. Is it an .xlsx file?');

  XLSX_MEMO[src.id] = { text, prefetch, sheets, entries, strings: null, dateStyles: null };
  return XLSX_MEMO[src.id];
}

/* ---------- Zip parts by byte range ---------- */

const ZIP_STATS = { direct: 0, rebuilt: 0 };

function mediaUrl_(id) {
  return 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true';
}

function fetchRangeResponse_(id, start, end) {
  const res = UrlFetchApp.fetch(mediaUrl_(id), {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + start + '-' + end },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 206 && code !== 200) throw new Error('Drive read failed (' + code + '): ' + res.getContentText().slice(0, 200));
  return res;
}

function fetchRange_(id, start, end) {
  const res = fetchRangeResponse_(id, start, end);
  const bytes = res.getContent();
  return res.getResponseCode() === 200 ? bytes.slice(start, end + 1) : bytes;
}

function u16_(b, o) { return (b[o] & 255) | ((b[o + 1] & 255) << 8); }
function u32_(b, o) { return u16_(b, o) + u16_(b, o + 2) * 65536; }
function le16_(v) { return [v & 255, (v >>> 8) & 255].map(signedByte_); }
function le32_(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255].map(signedByte_); }
function signedByte_(v) { return v > 127 ? v - 256 : v; }

// Reads the zip's central directory from the end of the file: name -> entry details.
function zipIndex_(id, size) {
  const tailLen = Math.min(size, 1048576);
  const tailStart = size - tailLen;
  const tail = fetchRange_(id, tailStart, size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32_(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx file.');
  const cdSize = u32_(tail, eocd + 12);
  const cdOffset = u32_(tail, eocd + 16);
  if (cdOffset === 0xFFFFFFFF) throw new Error('This .xlsx file is too large to read (zip64).');
  const cd = cdOffset >= tailStart
    ? tail.slice(cdOffset - tailStart, cdOffset - tailStart + cdSize)
    : fetchRange_(id, cdOffset, cdOffset + cdSize - 1);

  const entries = {};
  let p = 0;
  while (p + 46 <= cd.length && u32_(cd, p) === 0x02014b50) {
    const nameLen = u16_(cd, p + 28);
    const extraLen = u16_(cd, p + 30);
    const codes = [];
    let ascii = true;
    for (let k = 0; k < nameLen; k++) {
      const b = cd[p + 46 + k] & 255;
      if (b > 127) ascii = false;
      codes.push(b);
    }
    const name = ascii ? String.fromCharCode.apply(null, codes) : Utilities.newBlob(codes.map(signedByte_)).getDataAsString('UTF-8');
    entries[name] = {
      flags: u16_(cd, p + 8), method: u16_(cd, p + 10), time: u16_(cd, p + 12), date: u16_(cd, p + 14),
      crc: u32_(cd, p + 16), csize: u32_(cd, p + 20), usize: u32_(cd, p + 24),
      offset: u32_(cd, p + 42), nameCodes: codes, extraLen, fileSize: size
    };
    p += 46 + nameLen + extraLen + u16_(cd, p + 32);
  }
  return entries;
}

// Fetches several parts in parallel. The range is worked out from the central directory
// (the local header's extra field is almost always the same length); any part that doesn't
// unpack from that guess is read again the careful way.
function readZipEntries_(id, list) {
  if (!list.length) return [];
  const url = mediaUrl_(id);
  const token = ScriptApp.getOAuthToken();
  const responses = UrlFetchApp.fetchAll(list.map(e => {
    const end = Math.min(e.fileSize - 1, e.offset + 30 + e.nameCodes.length + e.extraLen + e.csize - 1 + ((e.flags & 8) ? 16 : 0));
    return { url, headers: { Authorization: 'Bearer ' + token, Range: 'bytes=' + e.offset + '-' + end }, muteHttpExceptions: true };
  }));
  return list.map((e, i) => {
    if (responses[i].getResponseCode() === 206) {
      try {
        const files = Utilities.unzip(responses[i].getBlob().setContentType('application/zip'));
        if (files.length) {
          ZIP_STATS.direct++;
          return files[0].getDataAsString('UTF-8');
        }
      } catch (err) {
        // Read it the careful way below.
      }
    }
    return readZipEntry_(id, e);
  });
}

// Fetches one compressed part. The byte range of a zip entry (local header + data) is itself
// readable by Utilities.unzip, so it is passed on as-is; if that fails, the part is rebuilt
// into a one-file zip (much slower for large parts).
function readZipEntry_(id, e) {
  const head = fetchRange_(id, e.offset, e.offset + 29);
  if (u32_(head, 0) !== 0x04034b50) throw new Error('Unexpected .xlsx layout.');
  const dataStart = e.offset + 30 + u16_(head, 26) + u16_(head, 28);
  const hasDescriptor = (u16_(head, 6) & 8) !== 0;
  const entryEnd = Math.min(e.fileSize - 1, dataStart + e.csize - 1 + (hasDescriptor ? 16 : 0));
  try {
    const files = Utilities.unzip(fetchRangeResponse_(id, e.offset, entryEnd).getBlob().setContentType('application/zip'));
    if (files.length) {
      ZIP_STATS.direct++;
      return files[0].getDataAsString('UTF-8');
    }
  } catch (err) {
    // Fall back to rebuilding the part below.
  }
  ZIP_STATS.rebuilt++;

  const data = e.csize ? Array.from(fetchRange_(id, dataStart, dataStart + e.csize - 1)) : [];
  if (e.method === 0) return Utilities.newBlob(data).getDataAsString('UTF-8');

  const name = e.nameCodes.map(signedByte_);
  const fields = [].concat(le16_(e.method), le16_(e.time), le16_(e.date), le32_(e.crc), le32_(e.csize), le32_(e.usize), le16_(name.length));
  const local = [].concat(le32_(0x04034b50), le16_(20), le16_(0), fields, le16_(0), name);
  const central = [].concat(le32_(0x02014b50), le16_(20), le16_(20), le16_(0), fields,
    le16_(0), le16_(0), le16_(0), le16_(0), le32_(0), le32_(0), name);
  const end = [].concat(le32_(0x06054b50), le16_(0), le16_(0), le16_(1), le16_(1),
    le32_(central.length), le32_(local.length + data.length), le16_(0));
  const zip = Utilities.newBlob(local.concat(data, central, end), 'application/zip', 'part.zip');
  return Utilities.unzip(zip)[0].getDataAsString('UTF-8');
}

// Cell values and links of one tab. Formulas like HYPERLINK(INDEX('Upload Log'!E:E, MATCH(B29, 'Upload Log'!A:A, 0)), "Open folder")
// keep only their text in the file, so they are returned as lookups and resolved against the other tab.
// cols (optional) limits reading to those column indexes, so a large lookup tab is scanned quickly.
// maxRow (optional, 0-based) stops after that row, e.g. 0 to read only the header.
function readSheetGrid_(book, sheet, cols, maxRow) {
  const xml = book.text(sheet.path);
  const strings = sharedStrings_(book);
  const dates = dateStyles_(book);
  const grid = [];
  const links = {};
  const lookups = [];
  const shared = {};

  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cellRe.exec(xml))) {
    if (!m[2]) continue;
    const refMatch = m[1].match(/\br="([A-Z]+\d+)"/);
    if (!refMatch) continue;
    const pos = cellPos_(refMatch[1]);
    if (maxRow != null && pos.r > maxRow) break;
    if (cols && cols.indexOf(pos.c) < 0) continue;
    const type = attr_(m[1], 't');
    const inner = m[2];
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    let value = '';
    if (type === 's') value = v ? strings[Number(v[1])] || '' : '';
    else if (type === 'inlineStr') value = joinText_(inner);
    else if (type === 'b') value = v && v[1] === '1' ? 'TRUE' : 'FALSE';
    else if (type === 'str' || type === 'e') value = v ? unescape_(v[1]) : '';
    else if (v) value = dates[Number(attr_(m[1], 's') || 0)] ? excelDate_(Number(v[1])) : formatNumber_(v[1]);

    const f = inner.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
    if (f && value !== '') {
      const si = attr_(f[1], 'si');
      if (f[2] && si) shared[si] = { text: unescape_(f[2]), r: pos.r };
      const formula = f[2] ? { text: unescape_(f[2]), r: pos.r } : shared[si];
      const literal = formula && formula.text.match(/HYPERLINK\(\s*"([^"]+)"/i);
      const lookup = formula && !literal && lookupFormula_(formula.text);
      if (literal) links[pos.r + ',' + pos.c] = literal[1];
      else if (lookup) lookups.push(Object.assign(lookup, { r: pos.r, c: pos.c, keyRow: lookup.keyRow - formula.r + pos.r }));
    }

    if (value !== '') (grid[pos.r] = grid[pos.r] || [])[pos.c] = value;
  }

  const sheetRels = relsMap_(book.text(sheetRelsPath_(sheet.path)));
  const hlRe = /<hyperlink\b([^>]*)>/g;
  while ((m = hlRe.exec(xml))) {
    const ref = attr_(m[1], 'ref');
    const url = sheetRels[attr_(m[1], 'r:id')];
    if (!ref || !url) continue;
    const [from, to] = ref.split(':').map(cellPos_);
    const end = to || from;
    for (let r = from.r; r <= end.r; r++) {
      for (let c = from.c; c <= end.c; c++) {
        if (!links[r + ',' + c]) links[r + ',' + c] = url;
      }
    }
  }
  return { grid, links, lookups };
}

function parseXlsxSheet_(book, sheet) {
  const { grid, links, lookups } = readSheetGrid_(book, sheet);
  lookups.forEach(l => {
    const key = lookupKey_((grid[l.keyRow] || [])[l.keyCol]);
    const url = key && lookupTable_(book, l.sheet, l.matchCol, l.resultCol)[key];
    if (url && !links[l.r + ',' + l.c]) links[l.r + ',' + l.c] = url;
  });
  fillDriveFromLog_(book, grid, links);

  const header = grid[0] || [];
  const values = [];
  for (let r = 0; r < grid.length; r++) {
    const row = [];
    for (let c = 0; c < header.length; c++) row.push((grid[r] && grid[r][c]) || '');
    values.push(row);
  }
  blankPlaceholderRows_(values, links);
  const trimmed = trimValues_(values);
  Object.keys(links).forEach(k => {
    const [r, c] = k.split(',').map(Number);
    if (r >= trimmed.length || c >= (trimmed[0] || []).length) delete links[k];
  });
  return { values: trimmed, links };
}

// Any row whose GDRIVE cell has no link (empty cell, or a formula whose cached result is blank) gets the folder
// from the Upload Log / Log EAN-to-Drive mapping.
function fillDriveFromLog_(book, grid, links) {
  const header = (grid[0] || []).map(h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
  const eanCol = header.indexOf('ean code');
  const driveCols = header.map((h, c) => (/gdrive|drive link/.test(h) ? c : -1)).filter(c => c >= 0);
  if (eanCol < 0 || !driveCols.length) return;
  const map = driveMap_(book);
  for (let r = 1; r < grid.length; r++) {
    if (driveCols.some(c => links[r + ',' + c])) continue;
    const url = map[lookupKey_((grid[r] || [])[eanCol])];
    if (url) links[r + ',' + driveCols[0]] = url;
  }
}

function squashName_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The EAN-to-Drive tabs, matched loosely ("Upload Log", "Upload_Log ", "Log"), Upload Log first.
function logSheets_(book) {
  const wanted = (SOURCES.shoot.lookupTabs || []).map(squashName_);
  return book.sheets
    .filter(s => wanted.indexOf(squashName_(s.name)) >= 0 || /uploadlog/.test(squashName_(s.name)))
    .sort((a, b) => (/upload/.test(squashName_(b.name)) ? 1 : 0) - (/upload/.test(squashName_(a.name)) ? 1 : 0));
}

// Upload Log layout: column A = EAN, column E = EAN Folder Link.
const LOG_EAN_COL = 0;
const LOG_LINK_COL = 4;

// EAN -> Drive folder URL from the log tabs (Upload Log first, then Log for EANs it lacks).
function driveMap_(book) {
  if (book.driveMap) return book.driveMap;
  const map = {};
  book.driveMapInfo = [];
  logSheets_(book).forEach(sheet => {
    const head = readSheetGrid_(book, sheet, [LOG_EAN_COL, LOG_LINK_COL], 0).grid[0] || [];
    const table = lookupTable_(book, sheet.name, LOG_EAN_COL, LOG_LINK_COL);
    let added = 0;
    Object.keys(table).forEach(k => { if (!map[k]) { map[k] = table[k]; added++; } });
    book.driveMapInfo.push('"' + sheet.name + '": A="' + (head[LOG_EAN_COL] || '') + '", E="' + (head[LOG_LINK_COL] || '') + '", ' +
      Object.keys(table).length + ' EANs with a folder link (' + added + ' new)');
  });
  return (book.driveMap = map);
}

const SHEET_REF = "(?:'((?:[^']|'')+)'|([\\w.]+))!\\$?([A-Z]+)(?:\\$?\\d+)?:\\$?[A-Z]+";

function lookupFormula_(formula) {
  const index = formula.match(new RegExp('HYPERLINK\\(\\s*INDEX\\(\\s*' + SHEET_REF, 'i'));
  if (!index) return null;
  const rest = formula.slice(index.index + index[0].length);
  const match = rest.match(new RegExp('MATCH\\([\\s\\S]*?,\\s*' + SHEET_REF, 'i'));
  const key = rest.match(/(?:^|[^!:$\w'])\$?([A-Z]{1,3})\$?(\d+)\b/);
  if (!match || !key) return null;
  const col = letters => cellPos_(letters.toUpperCase() + '1').c;
  return {
    sheet: (index[1] || index[2]).replace(/''/g, "'"),
    resultCol: col(index[3]),
    matchCol: col(match[3]),
    keyCol: col(key[1]),
    keyRow: Number(key[2]) - 1
  };
}

// EAN key: strips spaces, expands scientific notation ("8.909E+12") and plain numbers from the Sheets API.
function lookupKey_(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && isFinite(v)) return String(Math.round(v));
  let s = String(v).replace(/[\s\u00a0]+/g, '');
  if (/^\d+\.?\d*e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (isFinite(n)) return String(Math.round(n));
  }
  if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

// Formulas in some tabs still name 'Upload Log' although the file only has a tab called "Log", so a missing
// name falls back to whichever lookup tab exists.
function lookupSheet_(book, sheetName) {
  return book.sheets.find(s => squashName_(s.name) === squashName_(sheetName)) || logSheets_(book)[0] || null;
}

// First row per key that holds a link. An EAN logged twice (e.g. a failed upload with no folder, then the real one)
// still gets its folder. Built once per tab and column pair while the file is being read.
function lookupTable_(book, sheetName, matchCol, resultCol) {
  book.lookups = book.lookups || {};
  const id = sheetName + '|' + matchCol + '|' + resultCol;
  if (book.lookups[id]) return book.lookups[id];
  const table = {};
  const sheet = lookupSheet_(book, sheetName);
  if (sheet) {
    const { grid, links } = readSheetGrid_(book, sheet, [matchCol, resultCol]);
    grid.forEach((row, r) => {
      const key = lookupKey_(row && row[matchCol]);
      if (!key || table[key]) return;
      const cell = links[r + ',' + resultCol] || String((row && row[resultCol]) || '').trim();
      const url = cell.match(/https?:\/\/\S+/i);
      if (url) table[key] = url[0];
    });
  }
  return (book.lookups[id] = table);
}

// Rows with neither an EAN code nor a product name only hold defaults (department, "Pcs", "0", "Pending").
// They are blanked rather than removed so row numbers still match the sheet.
const PLACEHOLDER_KEYS = ['ean code', 'product name'];

function blankPlaceholderRows_(values, links) {
  if (!values.length) return;
  const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const headers = values[0].map(norm);
  const idx = PLACEHOLDER_KEYS.map(k => headers.indexOf(k));
  if (idx.some(i => i < 0)) return;
  for (let r = 1; r < values.length; r++) {
    if (idx.some(i => String(values[r][i]).trim() !== '')) continue;
    values[r] = values[r].map(() => '');
    Object.keys(links).forEach(k => { if (k.split(',')[0] === String(r)) delete links[k]; });
  }
}

function sharedStrings_(book) {
  if (book.strings) return book.strings;
  const xml = book.text('xl/sharedStrings.xml');
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) out.push(joinText_(m[1]));
  book.strings = out;
  return out;
}

function joinText_(inner) {
  const clean = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const parts = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(clean))) parts.push(m[1]);
  return unescape_(parts.join(''));
}

// Index of each cell style (the "s" attribute) to whether it shows a date.
function dateStyles_(book) {
  if (book.dateStyles) return book.dateStyles;
  const xml = book.text('xl/styles.xml');
  const custom = {};
  const fmtRe = /<numFmt\b([^>]*)>/g;
  let m;
  while ((m = fmtRe.exec(xml))) custom[attr_(m[1], 'numFmtId')] = unescape_(attr_(m[1], 'formatCode'));
  const cellXfs = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
  book.dateStyles = (cellXfs.match(/<xf\b[^>]*/g) || []).map(xf => {
    const id = Number(attr_(xf, 'numFmtId') || 0);
    const code = custom[id];
    if (code) return /[dy]/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''));
    return (id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 36) || (id >= 50 && id <= 58);
  });
  return book.dateStyles;
}

function excelDate_(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return ('0' + d.getUTCDate()).slice(-2) + '-' + MONTHS[d.getUTCMonth()] + '-' + d.getUTCFullYear();
}

function formatNumber_(v) {
  const n = Number(v);
  if (!isFinite(n)) return v;
  return String(Number.isInteger(n) ? n : parseFloat(n.toPrecision(12)));
}

function relsMap_(xml) {
  const out = {};
  const re = /<Relationship\b([^>]*)>/g;
  let m;
  while ((m = re.exec(xml))) out[attr_(m[1], 'Id')] = attr_(m[1], 'Target');
  return out;
}

function attr_(attrs, name) {
  const m = attrs.match(new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '="([^"]*)"'));
  return m ? unescape_(m[1]) : '';
}

function cellPos_(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  if (!m) return { r: -1, c: -1 };
  let c = 0;
  for (let i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

function unescape_(s) {
  return String(s || '')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/* ---------- Cache (shared, keyed by file version so edits show up on the next load) ---------- */

function cacheGet_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key) || 0);
    if (!count) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(key + ':' + i);
    const parts = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < count; i++) {
      if (parts[keys[i]] == null) return null;
      json += parts[keys[i]];
    }
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function cachePut_(key, value) {
  try {
    const json = JSON.stringify(value);
    const entries = {};
    let count = 0;
    for (let i = 0; i < json.length; i += CACHE_CHUNK) entries[key + ':' + count++] = json.slice(i, i + CACHE_CHUNK);
    entries[key] = String(count);
    CacheService.getScriptCache().putAll(entries, CACHE_SECONDS);
  } catch (err) {
    // Too large to cache: the next load parses the file again.
  }
}
