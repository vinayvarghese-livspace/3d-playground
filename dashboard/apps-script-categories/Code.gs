/**
 * Categories & Subcategories reader — STANDALONE web app.
 * Separate from the Presentation Board reader, HH reader, and MTS Furniture reader.
 *
 * Spreadsheet:
 *   https://docs.google.com/spreadsheets/d/1DGJBChDVxkE-fj-vi3bG2lfagjO-jZ0rcFqY2C1Vl-8
 * Tab: Categories & Subcategories <Quick Glance> (gid=1274485640)
 *
 * Hierarchy only (fill-down):
 *   Division → Dept → Category → Sub Category
 * USP, Set/EACH, Collection, and Custom live on the presentation sheet, not here.
 *
 * Actions (JSON / JSONP via ?callback=):
 *   action=nav   — division tree for the presentation finder
 *   action=ping  — health check
 *
 * Reads through the Sheets API (advanced service). SpreadsheetApp.openById
 * always demands the full spreadsheets scope, even for a read.
 */

var SHEET_ID = '1DGJBChDVxkE-fj-vi3bG2lfagjO-jZ0rcFqY2C1Vl-8';
var SHEET_GID = 1274485640;
var FEED_VERSION = 5;
var CACHE_SECONDS = 60;
var CACHE_CHUNK = 30000;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return apiResponse_(p);
  return ContentService
    .createTextOutput('Categories reader. Use ?action=nav or ?action=ping.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function apiResponse_(p) {
  var body;
  try {
    if (p.action === 'nav' || p.action === 'categories') body = { ok: true, data: getNavFeed() };
    else if (p.action === 'ping') body = { ok: true, data: { version: FEED_VERSION, sheet: SHEET_ID, gid: SHEET_GID } };
    else throw new Error('Unknown action: ' + p.action);
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

/** Read-only: no Drive scope. Short cache avoids re-reading the sheet on every poll. */
function getNavFeed() {
  var cacheKey = ['catNav', FEED_VERSION, SHEET_ID, SHEET_GID].join(':');
  var cached = cacheGet_(cacheKey);
  if (cached) {
    cached.readAt = new Date().toISOString();
    cached.cached = true;
    return cached;
  }

  var parsed = readCategorySheet_();
  var out = {
    version: FEED_VERSION,
    sheetId: SHEET_ID,
    gid: SHEET_GID,
    tab: parsed.tab,
    headers: parsed.headers,
    columns: parsed.columns,
    readAt: new Date().toISOString(),
    cached: false,
    tree: parsed.tree
  };
  cachePut_(cacheKey, out);
  return out;
}

function readCategorySheet_() {
  var tab = findTab_();
  var values = sheetValues_(tab.title);
  if (!values.length) {
    return { tab: tab.title, headers: [], columns: {}, tree: [] };
  }

  var headerInfo = findHeaderRow_(values);
  var headers = headerInfo.headers;
  var startRow = headerInfo.rowIndex + 1;

  var colDivision = findCol_(headers, [/^division$/i]);
  var colDept = findCol_(headers, [/^dept(artment)?$/i]);
  var colCategory = findCol_(headers, [/^categor(y|ies)$/i]);
  var colSub = findCol_(headers, [/^sub[-\s]?categor(y|ies)$/i, /^subcategory$/i]);

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
    var divisionCell = cell_(row, colDivision);
    var deptCell = cell_(row, colDept);
    var categoryCell = cell_(row, colCategory);
    var subCell = cell_(row, colSub);

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

    addSub_(divisions, division, dept, category, sub);
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

function addSub_(divisions, divisionName, deptName, categoryName, subName) {
  var division = findOrPush_(divisions, divisionName, function () {
    return { name: divisionName, depts: [] };
  });
  var dept = findOrPush_(division.depts, deptName, function () {
    return { name: deptName, categories: [] };
  });
  var category = findOrPush_(dept.categories, categoryName, function () {
    return { name: categoryName, subs: [] };
  });

  var slug = slugify_(subName);
  var existing = null;
  for (var i = 0; i < category.subs.length; i++) {
    if (category.subs[i].slug === slug) {
      existing = category.subs[i];
      break;
    }
  }
  if (!existing) {
    category.subs.push({ name: subName, slug: slug });
  }
}

function findOrPush_(list, name, factory) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) return list[i];
  }
  var item = factory();
  list.push(item);
  return item;
}

function cell_(row, index) {
  if (index < 0) return '';
  return String(row[index] || '').replace(/\s+/g, ' ').trim();
}

function slugify_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function findTab_() {
  var meta = Sheets.Spreadsheets.get(SHEET_ID, { fields: 'sheets.properties' });
  var sheets = (meta && meta.sheets) || [];
  var byName = null;
  for (var i = 0; i < sheets.length; i++) {
    var props = sheets[i].properties || {};
    if (Number(props.sheetId) === Number(SHEET_GID)) {
      return { title: props.title, sheetId: props.sheetId };
    }
    if (/categories/i.test(props.title || '') && /subcategor/i.test(props.title || '')) {
      byName = { title: props.title, sheetId: props.sheetId };
    }
  }
  if (byName) return byName;
  throw new Error('Tab gid ' + SHEET_GID + ' (Categories & Subcategories <Quick Glance>) was not found.');
}

function sheetValues_(title) {
  var range = "'" + String(title).replace(/'/g, "''") + "'";
  var res = Sheets.Spreadsheets.Values.get(SHEET_ID, range, {
    valueRenderOption: 'FORMATTED_VALUE'
  });
  return (res && res.values) || [];
}

function findHeaderRow_(values) {
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

function findCol_(headers, patterns) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').replace(/\s+/g, ' ').trim();
    if (!h) continue;
    for (var p = 0; p < patterns.length; p++) {
      if (patterns[p].test(h)) return i;
    }
  }
  return -1;
}

function cacheGet_(key) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(key + ':n');
  if (!meta) return null;
  var n = Number(meta);
  if (!(n > 0)) return null;
  var parts = [];
  for (var i = 0; i < n; i++) {
    var chunk = cache.get(key + ':' + i);
    if (chunk == null) return null;
    parts.push(chunk);
  }
  try {
    return JSON.parse(parts.join(''));
  } catch (err) {
    return null;
  }
}

function cachePut_(key, obj) {
  var cache = CacheService.getScriptCache();
  var json = JSON.stringify(obj);
  var chunks = [];
  for (var i = 0; i < json.length; i += CACHE_CHUNK) {
    chunks.push(json.substring(i, i + CACHE_CHUNK));
  }
  cache.put(key + ':n', String(chunks.length), CACHE_SECONDS);
  for (var c = 0; c < chunks.length; c++) {
    cache.put(key + ':' + c, chunks[c], CACHE_SECONDS);
  }
}
