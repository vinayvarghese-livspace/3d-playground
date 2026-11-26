/**
 * MTS Furniture Sheet Reader — standalone web app (separate from HH Multi Sheet Reader).
 *
 * Spreadsheet: Photoshoot LSH FURNITURE
 *   https://docs.google.com/spreadsheets/d/13WDOySiHGQ_9Z-dW5uoI8cndbsx6LIZn1Qy-N37mUa0
 * Tab: Sheet1 only (Buyer band row + header row promoted so values[0] is real headers).
 *
 * Actions (JSON or JSONP via ?callback=):
 *   action=tasks  — Sheet1 feed for the 3D Playground MTS catalog
 *   action=nav / categories — Division→Sub Category tree for Presentation finder
 *   action=ping   — health check
 *
 * Categories sheet (same scopes; no second Apps Script Allow):
 *   https://docs.google.com/spreadsheets/d/1IVJYLciWf5om1c0NAGqWdJyPgy_5e2kBn1YAHUPNLnk
 *   Tab gid=676919905
 *
 * After editing: Deploy → Manage deployments → ✎ Edit →
 *   Version: New version → Deploy (keep the same /exec URL).
 *   Execute as: User accessing the web app
 *   Who has access: Anyone within Livspace (same as HH reader)
 *
 * Scopes (read only — do not add spreadsheets or drive write scopes):
 *   https://www.googleapis.com/auth/spreadsheets.readonly
 *   https://www.googleapis.com/auth/drive.readonly
 * DriveApp is not used. getLastUpdated() on DriveApp requires full Drive access.
 * Last-updated time is read with Drive.Files.get, which these scopes allow.
 *
 * Paste the /exec URL into tasks.js as MTS_FEED_URL.
 */

var FURNITURE_ID = '13WDOySiHGQ_9Z-dW5uoI8cndbsx6LIZn1Qy-N37mUa0';
var FURNITURE_TAB = 'Sheet1';
var FEED_VERSION = 4;
var CACHE_SECONDS = 21600;
var CACHE_CHUNK = 30000;

/** Presentation finder tree — same web app / Allow as MTS tasks. */
var CATEGORIES_ID = '1IVJYLciWf5om1c0NAGqWdJyPgy_5e2kBn1YAHUPNLnk';
var CATEGORIES_GID = 676919905;
var CATEGORIES_FEED_VERSION = 1;
var CATEGORIES_CACHE_SECONDS = 60;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return apiResponse_(p);
  return ContentService
    .createTextOutput('MTS Furniture Sheet Reader. Use ?action=tasks, ?action=nav, or ?action=ping.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function apiResponse_(p) {
  var body;
  try {
    if (p.action === 'tasks') body = { ok: true, data: getFurnitureFeed() };
    else if (p.action === 'nav' || p.action === 'categories') body = { ok: true, data: getNavFeed() };
    else if (p.action === 'ping') {
      body = {
        ok: true,
        data: {
          version: FEED_VERSION,
          sheet: FURNITURE_ID,
          categoriesSheet: CATEGORIES_ID,
          categoriesGid: CATEGORIES_GID,
          categoriesVersion: CATEGORIES_FEED_VERSION
        }
      };
    } else throw new Error('Unknown action: ' + p.action);
  } catch (err) {
    body = { ok: false, error: String((err && err.message) || err) };
  }
  var json = JSON.stringify(body);
  var cb = String(p.callback || '');
  if (/^[A-Za-z_$][\w$]{0,63}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function getFurnitureFeed() {
  var furniture;
  try {
    furniture = readFurnitureTab_();
  } catch (err) {
    furniture = { tab: FURNITURE_TAB, values: [], links: {}, error: String((err && err.message) || err) };
  }
  return {
    version: FEED_VERSION,
    furniture: furniture,
    readAt: new Date().toISOString()
  };
}

function readFurnitureTab_() {
  var modified = sheetModified_();
  var cacheKey = ['mtsFurn', FEED_VERSION, FURNITURE_ID, FURNITURE_TAB, modified.ms].join(':');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var title = resolveSheet1Title_();
  var range = "'" + String(title).replace(/'/g, "''") + "'";
  var rawValues = trimValues_((Sheets.Spreadsheets.Values.get(FURNITURE_ID, range, {
    valueRenderOption: 'FORMATTED_VALUE'
  }).values) || []);
  var rawFormulas = [];
  try {
    rawFormulas = trimValues_((Sheets.Spreadsheets.Values.get(FURNITURE_ID, range, {
      valueRenderOption: 'FORMULA'
    }).values) || []);
  } catch (err) {
    rawFormulas = [];
  }

  // Sheet1 row 1 is often a Buyer band — real headers start at "EAN CODE".
  // Chip / hyperlink reads use absolute sheet rows, so remap into promoted coordinates.
  var hi = findFurnitureHeaderRow_(rawValues);
  if (hi < 0) hi = 0;
  var values = rawValues.slice(hi);
  var formulas = rawFormulas.length ? rawFormulas.slice(hi) : [];
  var links = {};
  var multiLinks = {};
  try { mergeLinks_(links, linksFromCellTextShifted_(rawValues, hi)); } catch (err) { /* ignore */ }
  try { mergeLinks_(links, linksFromFormulasShifted_(rawFormulas, hi)); } catch (err) { /* ignore */ }
  try { mergeLinkColumnUrls_(title, values, links, multiLinks, hi); } catch (err) { /* continue */ }
  try { collectTextMultiUrls_(values, multiLinks, links); } catch (err) { /* continue */ }
  try { resolvePdpNameLinks_(values, links, multiLinks); } catch (err) { /* continue */ }

  var out = {
    tab: FURNITURE_TAB,
    name: title,
    values: values,
    links: links,
    // Extra URLs when a PDP cell has 2+ chips / URLs. Key = "row,col" (same as links).
    multiLinks: multiLinks,
    modified: modified.iso
  };
  cachePut_(cacheKey, out);
  return out;
}

function sheetModified_() {
  // Drive.Files.get is a read. DriveApp.getFileById is not allowed under drive.readonly.
  var meta = Drive.Files.get(FURNITURE_ID, {
    fields: 'modifiedTime',
    supportsAllDrives: true
  });
  var iso = meta && meta.modifiedTime ? String(meta.modifiedTime) : '';
  var when = iso ? new Date(iso) : new Date(0);
  return { iso: when.toISOString(), ms: when.getTime() };
}

function findFurnitureHeaderRow_(values) {
  for (var r = 0; r < Math.min(10, (values || []).length); r++) {
    var row = values[r] || [];
    if (row.some(function (h) {
      return /^ean\s*code$/i.test(String(h || '').replace(/\s+/g, ' ').trim());
    })) return r;
  }
  return -1;
}

function resolveSheet1Title_() {
  var meta = Sheets.Spreadsheets.get(FURNITURE_ID, { fields: 'sheets.properties' });
  var sheets = (meta && meta.sheets) || [];
  for (var i = 0; i < sheets.length; i++) {
    var props = sheets[i].properties || {};
    if (normTab_(props.title) === normTab_(FURNITURE_TAB) || props.sheetId === 0) {
      return props.title || FURNITURE_TAB;
    }
  }
  if (sheets[0] && sheets[0].properties && sheets[0].properties.title) {
    return sheets[0].properties.title;
  }
  return FURNITURE_TAB;
}

function firstHttpUrl_(text) {
  var all = allHttpUrls_(text);
  return all.length ? all[0] : '';
}

function allHttpUrls_(text) {
  var out = [];
  var seen = {};
  var re = /https?:\/\/[^\s<>"']+/gi;
  var m;
  while ((m = re.exec(String(text || '')))) {
    var url = m[0].replace(/[.,);]+$/, '');
    if (!url || seen[url]) continue;
    seen[url] = true;
    out.push(url);
  }
  return out;
}

function pushUniqueUrl_(list, url) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (list.indexOf(url) >= 0) return;
  list.push(url);
}

function setCellUrls_(links, multiLinks, key, urls) {
  if (!urls || !urls.length) return;
  links[key] = urls[0];
  if (urls.length > 1) multiLinks[key] = urls.slice();
  else if (multiLinks[key] && multiLinks[key].length <= 1) delete multiLinks[key];
}

// Raw sheet rows → promoted keys (subtract header-band offset).
function linksFromCellTextShifted_(values, hi) {
  var links = {};
  (values || []).forEach(function (row, r) {
    if (r < hi) return;
    (row || []).forEach(function (v, c) {
      var url = firstHttpUrl_(v);
      if (url) links[(r - hi) + ',' + c] = url;
    });
  });
  return links;
}

function linksFromFormulasShifted_(values, hi) {
  var links = {};
  var re = /^=\s*HYPERLINK\s*\(\s*["'](https?:\/\/[^"']+)["']/i;
  (values || []).forEach(function (row, r) {
    if (r < hi) return;
    (row || []).forEach(function (v, c) {
      var m = String(v || '').match(re);
      if (m) links[(r - hi) + ',' + c] = m[1];
      else {
        var url = firstHttpUrl_(v);
        if (url) links[(r - hi) + ',' + c] = url;
      }
    });
  });
  return links;
}

function mergeLinks_(into, extra) {
  Object.keys(extra || {}).forEach(function (k) {
    if (!into[k]) into[k] = extra[k];
  });
  return into;
}

function colA1_(c) {
  var s = '';
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

function linkColumnIndexes_(headerRow) {
  var cols = [];
  (headerRow || []).forEach(function (h, c) {
    var n = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (/pdp|guideline|slides/.test(n)) cols.push(c);
    else if (/gdrive|drive/.test(n) && /link|upload|folder|gdrive/.test(n)) cols.push(c);
  });
  return cols;
}

function cellGridLinkUrls_(cell) {
  var urls = [];
  if (!cell) return urls;
  // Smart chips — collect every chip URI (two titled PDPs share one cell).
  var chips = cell.chipRuns || [];
  for (var i = 0; i < chips.length; i++) {
    var chip = chips[i] && chips[i].chip;
    if (!chip) continue;
    var uri = (chip.richLinkProperties && chip.richLinkProperties.uri) || chip.uri || '';
    pushUniqueUrl_(urls, uri);
  }
  if (cell.hyperlink) pushUniqueUrl_(urls, cell.hyperlink);
  var runs = cell.textFormatRuns || [];
  for (var j = 0; j < runs.length; j++) {
    var linkUri = runs[j].format && runs[j].format.link && runs[j].format.link.uri;
    pushUniqueUrl_(urls, linkUri);
  }
  allHttpUrls_(cell.formattedValue).forEach(function (u) { pushUniqueUrl_(urls, u); });
  return urls;
}

/**
 * Read chip / Insert→Link URLs for PDP + GDRIVE columns.
 * @param hi absolute sheet row index of the header (Buyer band rows above it).
 * Grid row r maps to promoted key (r - hi).
 */
function mergeLinkColumnUrls_(title, values, links, multiLinks, hi) {
  if (!values.length) return;
  var cols = linkColumnIndexes_(values[0]);
  if (!cols.length) return;
  hi = Math.max(0, Number(hi) || 0);
  // Absolute sheet height = promoted length + skipped band rows.
  var absHeight = values.length + hi;
  var safeTitle = String(title || '').replace(/'/g, "''");
  var ranges = cols.map(function (c) {
    return "'" + safeTitle + "'!" + colA1_(c) + '1:' + colA1_(c) + absHeight;
  });
  try {
    var res = Sheets.Spreadsheets.get(FURNITURE_ID, {
      ranges: ranges,
      includeGridData: true,
      fields: 'sheets(data(rowData(values(chipRuns,hyperlink,textFormatRuns,formattedValue))))'
    });
    var data = (res.sheets && res.sheets[0] && res.sheets[0].data) || [];
    data.forEach(function (grid, i) {
      var c = cols[i];
      ((grid && grid.rowData) || []).forEach(function (row, r) {
        if (r < hi) return;
        var promotedR = r - hi;
        if (promotedR >= values.length) return;
        var key = promotedR + ',' + c;
        var urls = cellGridLinkUrls_(row.values && row.values[0]);
        if (!urls.length) return;
        // Merge with any text URLs already collected for this cell.
        var merged = (multiLinks[key] || (links[key] ? [links[key]] : [])).slice();
        urls.forEach(function (u) { pushUniqueUrl_(merged, u); });
        setCellUrls_(links, multiLinks, key, merged);
      });
    });
  } catch (err) { /* ignore */ }
}

// Multi-line PDP cells that paste two raw presentation URLs with a "+" between them.
function collectTextMultiUrls_(values, multiLinks, links) {
  if (!values.length) return;
  var pdpCols = [];
  (values[0] || []).forEach(function (h, c) {
    var n = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (/pdp|guideline/.test(n)) pdpCols.push(c);
  });
  if (!pdpCols.length) return;
  for (var r = 1; r < values.length; r++) {
    pdpCols.forEach(function (c) {
      var key = r + ',' + c;
      var textUrls = allHttpUrls_((values[r] && values[r][c]) || '');
      if (!textUrls.length) return;
      var merged = (multiLinks[key] || (links[key] ? [links[key]] : [])).slice();
      textUrls.forEach(function (u) { pushUniqueUrl_(merged, u); });
      setCellUrls_(links, multiLinks, key, merged);
    });
  }
}

// Titles like "ATH - MTS Furniture | PDP Content" (+ optional second title after "+").
function pdpTitleCandidates_(text) {
  return String(text || '')
    .split(/\r\n|\r|\n|\+/)
    .map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
    .filter(function (s) {
      return s && !/^https?:\/\//i.test(s) && !/^[.,;:x\-–—]+$/i.test(s) && s.length >= 4;
    });
}

// PDP guideline cells often hold a file title only, e.g. "ATH - MTS Furniture | PDP Content".
// Only fills gaps when chip/URL extraction left the cell empty (does not invent a 2nd slide for dual titles).
function resolvePdpNameLinks_(values, links, multiLinks) {
  if (!values.length) return;
  var pdpCols = [];
  (values[0] || []).forEach(function (h, c) {
    var n = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (/pdp|guideline/.test(n)) pdpCols.push(c);
  });
  if (!pdpCols.length) return;

  var byName = {};
  for (var r = 1; r < values.length; r++) {
    pdpCols.forEach(function (c) {
      var key = r + ',' + c;
      if (links[key] || (multiLinks[key] && multiLinks[key].length)) return;
      var text = String((values[r] && values[r][c]) || '').trim();
      if (!text) return;
      var textUrls = allHttpUrls_(text);
      if (textUrls.length) {
        setCellUrls_(links, multiLinks, key, textUrls);
        return;
      }
      pdpTitleCandidates_(text).forEach(function (name) {
        if (!byName[name]) byName[name] = [];
        byName[name].push(key);
      });
    });
  }
  Object.keys(byName).forEach(function (name) {
    var url = driveFileUrlByName_(name);
    if (!url) return;
    byName[name].forEach(function (key) {
      if (!links[key]) links[key] = url;
    });
  });
}

function driveFileUrlByName_(name) {
  var raw = String(name || '').trim();
  if (!raw) return '';
  var cache = CacheService.getScriptCache();
  var cacheKey = 'mtsPdp:' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
    .map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('').slice(0, 32);
  try {
    var hit = cache.get(cacheKey);
    if (hit === '-') return '';
    if (hit) return hit;
  } catch (err) { /* continue */ }

  var url = '';
  try {
    var escaped = raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var res = Drive.Files.list({
      q: "name = '" + escaped + "' and trashed = false",
      pageSize: 10,
      fields: 'files(id, name, mimeType, webViewLink, shortcutDetails)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    var files = res.files || [];
    var prefer = [
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet'
    ];
    var best = null;
    for (var i = 0; i < prefer.length && !best; i++) {
      best = files.filter(function (f) { return f.mimeType === prefer[i]; })[0] || null;
    }
    if (!best) best = files[0] || null;
    if (best) url = driveWebUrl_(best);
  } catch (err) {
    url = '';
  }
  try { cache.put(cacheKey, url || '-', Math.min(CACHE_SECONDS, 21600)); } catch (err2) { /* ignore */ }
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
  if (f.id) return 'https://drive.google.com/open?id=' + f.id;
  return '';
}

function trimValues_(values) {
  var lastR = -1;
  var lastC = -1;
  for (var r = 0; r < values.length; r++) {
    var row = values[r] || [];
    for (var c = 0; c < row.length; c++) {
      if (String(row[c] == null ? '' : row[c]).trim() !== '') {
        if (r > lastR) lastR = r;
        if (c > lastC) lastC = c;
      }
    }
  }
  if (lastR < 0) return [];
  return values.slice(0, lastR + 1).map(function (row) {
    var out = [];
    for (var c = 0; c <= lastC; c++) out.push(row && row[c] != null ? row[c] : '');
    return out;
  });
}

function normTab_(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
}

function cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var count = Number(cache.get(key) || 0);
    if (!count) return null;
    var keys = [];
    for (var i = 0; i < count; i++) keys.push(key + ':' + i);
    var parts = cache.getAll(keys);
    var json = '';
    for (var j = 0; j < count; j++) {
      if (parts[keys[j]] == null) return null;
      json += parts[keys[j]];
    }
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function cachePut_(key, value) {
  try {
    var json = JSON.stringify(value);
    var entries = {};
    var count = 0;
    for (var i = 0; i < json.length; i += CACHE_CHUNK) entries[key + ':' + (count++)] = json.slice(i, i + CACHE_CHUNK);
    entries[key] = String(count);
    CacheService.getScriptCache().putAll(entries, CACHE_SECONDS);
  } catch (err) { /* too large */ }
}

/** Run once from the editor to verify Sheet1 + GDRIVE / PDP columns. */
function checkFurnitureFeed() {
  var feed = getFurnitureFeed();
  Logger.log('FEED_VERSION=' + feed.version);
  var f = feed.furniture || {};
  if (f.error) {
    Logger.log('ERROR: ' + f.error);
    return;
  }
  var headers = (f.values && f.values[0]) || [];
  Logger.log('Headers (' + headers.length + '): ' + headers.map(function (h) {
    return '"' + String(h || '').replace(/\s+/g, ' ').trim() + '"';
  }).join(', '));
  var linkCount = Object.keys(f.links || {}).length;
  Logger.log('Rows=' + Math.max(0, (f.values || []).length - 1) + ' links=' + linkCount);
}

/* —— Presentation finder (Categories sheet) —— */

function getNavFeed() {
  var cacheKey = ['catNav', CATEGORIES_FEED_VERSION, CATEGORIES_ID, CATEGORIES_GID].join(':');
  var cached = catCacheGet_(cacheKey);
  if (cached) {
    cached.readAt = new Date().toISOString();
    cached.cached = true;
    return cached;
  }

  var parsed = readCategorySheet_();
  var out = {
    version: CATEGORIES_FEED_VERSION,
    sheetId: CATEGORIES_ID,
    gid: CATEGORIES_GID,
    tab: parsed.tab,
    headers: parsed.headers,
    columns: parsed.columns,
    readAt: new Date().toISOString(),
    cached: false,
    tree: parsed.tree
  };
  catCachePut_(cacheKey, out);
  return out;
}

function readCategorySheet_() {
  var tab = findCategoriesTab_();
  var values = categorySheetValues_(tab.title);
  if (!values.length) {
    return { tab: tab.title, headers: [], columns: {}, tree: [] };
  }

  var headerInfo = findCategoriesHeaderRow_(values);
  var headers = headerInfo.headers;
  var startRow = headerInfo.rowIndex + 1;

  var colDivision = findCategoriesCol_(headers, [/^division$/i]);
  var colDept = findCategoriesCol_(headers, [/^dept(artment)?$/i]);
  var colCategory = findCategoriesCol_(headers, [/^categor(y|ies)$/i]);
  var colSub = findCategoriesCol_(headers, [/^sub[-\s]?categor(y|ies)$/i, /^subcategory$/i]);

  if (colDivision < 0 || colDept < 0 || colCategory < 0 || colSub < 0) {
    throw new Error(
      'Need Division, Dept, Category, and Sub Category headers on "' + tab.title + '". Found: ' +
      headers.filter(function (h) { return h; }).join(' | ')
    );
  }

  var divisions = [];
  var last = { division: '', dept: '', category: '', sub: '' };

  for (var r = startRow; r < values.length; r++) {
    var row = values[r] || [];
    var divisionCell = categoryCell_(row, colDivision);
    var deptCell = categoryCell_(row, colDept);
    var categoryCell = categoryCell_(row, colCategory);
    var subCell = categoryCell_(row, colSub);

    if (divisionCell) {
      last.division = divisionCell;
      if (!deptCell) last.dept = '';
      if (!categoryCell) last.category = '';
      if (!subCell) last.sub = '';
    }
    if (deptCell) {
      last.dept = deptCell;
      if (!categoryCell) last.category = '';
      if (!subCell) last.sub = '';
    }
    if (categoryCell) {
      last.category = categoryCell;
      if (!subCell) last.sub = '';
    }
    if (subCell) last.sub = subCell;

    var division = last.division;
    var dept = last.dept;
    var category = last.category;
    var sub = last.sub;

    if (!division || !dept || !category || !sub) continue;
    if (/^sub[-\s]?categor/i.test(sub)) continue;

    addCategorySub_(divisions, division, dept, category, sub);
  }

  return {
    tab: tab.title,
    headers: headers.filter(function (h) { return h; }),
    columns: {
      division: headers[colDivision] || '',
      dept: headers[colDept] || '',
      category: headers[colCategory] || '',
      subCategory: headers[colSub] || ''
    },
    tree: divisions
  };
}

function addCategorySub_(divisions, divisionName, deptName, categoryName, subName) {
  var division = findOrPushCategory_(divisions, divisionName, function () {
    return { name: divisionName, depts: [] };
  });
  var dept = findOrPushCategory_(division.depts, deptName, function () {
    return { name: deptName, categories: [] };
  });
  var category = findOrPushCategory_(dept.categories, categoryName, function () {
    return { name: categoryName, subs: [] };
  });

  var slug = slugifyCategory_(subName);
  for (var i = 0; i < category.subs.length; i++) {
    if (category.subs[i].slug === slug) return;
  }
  category.subs.push({ name: subName, slug: slug });
}

function findOrPushCategory_(list, name, factory) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) return list[i];
  }
  var item = factory();
  list.push(item);
  return item;
}

function categoryCell_(row, index) {
  if (index < 0) return '';
  return String(row[index] || '').replace(/\s+/g, ' ').trim();
}

function slugifyCategory_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function findCategoriesTab_() {
  var meta = Sheets.Spreadsheets.get(CATEGORIES_ID, { fields: 'sheets.properties' });
  var sheets = (meta && meta.sheets) || [];
  var byName = null;
  for (var i = 0; i < sheets.length; i++) {
    var props = sheets[i].properties || {};
    if (Number(props.sheetId) === Number(CATEGORIES_GID)) {
      return { title: props.title, sheetId: props.sheetId };
    }
    if (/categories/i.test(props.title || '') && /subcategor/i.test(props.title || '')) {
      byName = { title: props.title, sheetId: props.sheetId };
    }
  }
  if (byName) return byName;
  throw new Error('Tab gid ' + CATEGORIES_GID + ' (Categories & Subcategories) was not found.');
}

function categorySheetValues_(title) {
  var range = "'" + String(title).replace(/'/g, "''") + "'";
  var res = Sheets.Spreadsheets.Values.get(CATEGORIES_ID, range, {
    valueRenderOption: 'FORMATTED_VALUE'
  });
  return (res && res.values) || [];
}

function findCategoriesHeaderRow_(values) {
  var maxScan = Math.min(20, values.length);
  for (var r = 0; r < maxScan; r++) {
    var row = (values[r] || []).map(function (h) {
      return String(h || '').replace(/\s+/g, ' ').trim();
    });
    var joined = row.join(' | ').toLowerCase();
    if (/division/.test(joined) && /sub[-\s]?categor/.test(joined)) {
      return { rowIndex: r, headers: row };
    }
  }
  var fallback = (values[0] || []).map(function (h) {
    return String(h || '').replace(/\s+/g, ' ').trim();
  });
  return { rowIndex: 0, headers: fallback };
}

function findCategoriesCol_(headers, patterns) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').replace(/\s+/g, ' ').trim();
    if (!h) continue;
    for (var p = 0; p < patterns.length; p++) {
      if (patterns[p].test(h)) return i;
    }
  }
  return -1;
}

function catCacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var count = Number(cache.get(key) || 0);
    if (!count) return null;
    var keys = [];
    for (var i = 0; i < count; i++) keys.push(key + ':' + i);
    var parts = cache.getAll(keys);
    var json = '';
    for (var j = 0; j < count; j++) {
      if (parts[keys[j]] == null) return null;
      json += parts[keys[j]];
    }
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function catCachePut_(key, value) {
  try {
    var json = JSON.stringify(value);
    var entries = {};
    var count = 0;
    for (var i = 0; i < json.length; i += CACHE_CHUNK) {
      entries[key + ':' + (count++)] = json.slice(i, i + CACHE_CHUNK);
    }
    entries[key] = String(count);
    CacheService.getScriptCache().putAll(entries, CATEGORIES_CACHE_SECONDS);
  } catch (err) { /* too large */ }
}
