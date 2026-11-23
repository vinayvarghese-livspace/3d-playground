/**
 * Presentation Board Sheet Reader — STANDALONE web app.
 * Separate from HH Multi Sheet Reader and MTS Furniture reader.
 *
 * Spreadsheet:
 *   https://docs.google.com/spreadsheets/d/1B9qtXKT0CVDt1aXFEhHyAHCWLHBp682pdL3egqNfr4w
 * Tab: generated (gid=510920739). USP, Set/EACH, Collection, and Custom come from this tab.
 *
 * Columns (header row, flexible names):
 *   SUB-CATEGORY → master title (fill-down)
 *   TITLE        → label above image (else brand from IMAGE URL)
 *   IMAGE URL    → image src (blank square if empty)
 *   SEQUENCE     → right-side numbered list
 *   USP + USP TEXT         → number and name of that USP
 *   REMARKS (Set/EACH)      → "SET" marks a set shot (EACH / 1 / blank = default)
 *   COLLECTION SHOOT        → "collection" or "1" marks a collection shot
 *   CUSTOM + CUSTOM TEXT   → number and name of that custom
 *
 * Actions (JSON / JSONP via ?callback=):
 *   action=board  — presentation payload
 *   action=ping   — health check
 *
 * Reads through the Sheets API (advanced service) with spreadsheets.readonly.
 * SpreadsheetApp.openById and DriveApp both require wider scopes, so they are not used.
 * Paste /exec URL into presentation/config.js as PRESENTATION_FEED_URL.
 */

var SHEET_ID = '1B9qtXKT0CVDt1aXFEhHyAHCWLHBp682pdL3egqNfr4w';
var SHEET_GID = 510920739;
var FEED_VERSION = 7;
var CACHE_SECONDS = 30;
var CACHE_CHUNK = 30000;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return apiResponse_(p);
  return ContentService
    .createTextOutput('Presentation Board Reader. Use ?action=board or ?action=ping.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function apiResponse_(p) {
  var body;
  try {
    if (p.action === 'board') body = { ok: true, data: getBoardFeed() };
    else if (p.action === 'ping') body = { ok: true, data: { version: FEED_VERSION, sheet: SHEET_ID } };
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

function getBoardFeed() {
  var cacheKey = ['presBoard', FEED_VERSION, SHEET_ID, SHEET_GID].join(':');
  var cached = cacheGet_(cacheKey);
  if (cached) {
    cached.readAt = new Date().toISOString();
    cached.cached = true;
    return cached;
  }

  var parsed = readBoardSheet_();
  var out = {
    version: FEED_VERSION,
    sheetId: SHEET_ID,
    tab: parsed.tab,
    readAt: new Date().toISOString(),
    cached: false,
    boards: parsed.boards
  };
  cachePut_(cacheKey, out);
  return out;
}

function readBoardSheet_() {
  var tab = findBoardTab_();
  var rows = sheetCells_(tab.title);
  if (!rows.length) return { tab: tab.title, boards: [] };

  var values = rows.map(function (row) {
    return row.map(function (cell) { return cellText_(cell); });
  });

  var headerInfo = findHeaderRow_(values);
  var headers = headerInfo.headers;
  var startRow = headerInfo.rowIndex + 1;

  var colSub = findCol_(headers, [
    /^sub[-\s]?categor(y|ies)$/i,
    /^subcategory$/i
  ]);
  var colTitle = findCol_(headers, [/^title$/i, /^brand$/i, /^source$/i]);
  var colImage = findCol_(headers, [
    /^image\s*url$/i,
    /^image$/i,
    /^img\s*url$/i,
    /^url$/i
  ]);
  var colSeq = findCol_(headers, [/^sequence$/i, /^shot\s*list$/i, /^seq$/i]);
  var uspPair = tagColumns_(headers, /^usp$/i, /^usp\s*text$/i);
  var colSet = findCol_(headers, [/set\s*\/\s*each/i, /^remarks?\b/i]);
  var colCollection = findCol_(headers, [/collection/i]);
  var customPair = tagColumns_(headers, /^custom$/i, /^custom\s*text$/i);

  if (colImage < 0 && colSub < 0) {
    throw new Error(
      'Could not find SUB-CATEGORY / IMAGE URL headers on "' + tab.title + '". ' +
      'Found: ' + headers.join(' | ')
    );
  }

  var boardsMap = {};
  var boardOrder = [];
  var lastSub = '';

  for (var r = startRow; r < values.length; r++) {
    var row = values[r] || [];
    var subRaw = colSub >= 0 ? String(row[colSub] || '').trim() : '';
    if (subRaw) lastSub = subRaw;
    var sub = lastSub;
    if (!sub) continue;

    var url = colImage >= 0 ? cellUrl_((rows[r] || [])[colImage]) : '';

    var titleCell = colTitle >= 0 ? String(row[colTitle] || '').trim() : '';
    var seq = colSeq >= 0 ? String(row[colSeq] || '').trim() : '';

    if (!url && !titleCell && !seq) continue;

    if (!boardsMap[sub]) {
      boardsMap[sub] = {
        subCategory: sub,
        images: [],
        sequence: [],
        _seqSeen: {}
      };
      boardOrder.push(sub);
    }
    var board = boardsMap[sub];

    board.images.push({
      title: titleCell,
      url: url,
      sequence: seq,
      usp: tagOf_(row, uspPair.num, uspPair.text, 'USP'),
      custom: tagOf_(row, customPair.num, customPair.text, 'Custom'),
      set: colSet >= 0 && /\bset\b/i.test(String(row[colSet] || '')),
      collection: colCollection >= 0 && collectionIsOn_(row[colCollection])
    });

    if (seq && !board._seqSeen[seq]) {
      board._seqSeen[seq] = true;
      board.sequence.push(seq);
    }
  }

  var boards = boardOrder.map(function (key) {
    var b = boardsMap[key];
    return {
      subCategory: b.subCategory,
      images: b.images,
      sequence: b.sequence
    };
  });

  return { tab: tab.title, boards: boards };
}

function findBoardTab_() {
  var meta = Sheets.Spreadsheets.get(SHEET_ID, { fields: 'sheets.properties' });
  var sheets = (meta && meta.sheets) || [];
  for (var i = 0; i < sheets.length; i++) {
    var props = sheets[i].properties || {};
    if (Number(props.sheetId) === Number(SHEET_GID)) {
      return { title: props.title, sheetId: props.sheetId };
    }
  }
  throw new Error('Tab gid ' + SHEET_GID + ' (generated) was not found.');
}

function sheetCells_(title) {
  var range = "'" + String(title).replace(/'/g, "''") + "'";
  var meta = Sheets.Spreadsheets.get(SHEET_ID, {
    ranges: [range],
    includeGridData: true,
    fields: 'sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue,textFormatRuns(format(link))))))'
  });
  var data = meta && meta.sheets && meta.sheets[0] && meta.sheets[0].data && meta.sheets[0].data[0];
  var rowData = (data && data.rowData) || [];
  return rowData.map(function (row) {
    return (row && row.values) || [];
  });
}

function cellText_(cell) {
  if (!cell) return '';
  return String(cell.formattedValue || '').replace(/\s+/g, ' ').trim();
}

function cellUrl_(cell) {
  if (!cell) return '';
  var fromText = extractUrl_(cell.formattedValue);
  if (fromText) return fromText;
  if (cell.hyperlink) return cell.hyperlink;
  var runs = cell.textFormatRuns || [];
  for (var i = 0; i < runs.length; i++) {
    var link = runs[i].format && runs[i].format.link;
    if (link && link.uri) return link.uri;
  }
  var formula = cell.userEnteredValue && cell.userEnteredValue.formulaValue;
  if (formula) {
    var match = String(formula).match(/HYPERLINK\(\s*"([^"]+)"/i);
    if (match) return match[1];
  }
  return '';
}

function findHeaderRow_(values) {
  var maxScan = Math.min(15, values.length);
  for (var r = 0; r < maxScan; r++) {
    var row = (values[r] || []).map(function (h) {
      return String(h || '').replace(/\s+/g, ' ').trim();
    });
    var joined = row.join(' | ').toLowerCase();
    if (
      /sub[-\s]?categor/.test(joined) ||
      /image\s*url/.test(joined) ||
      (/\btitle\b/.test(joined) && /\bsequence\b/.test(joined))
    ) {
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
    for (var p = 0; p < patterns.length; p++) {
      if (patterns[p].test(h)) return i;
    }
  }
  return -1;
}

// "USP" holds the number and "USP TEXT" holds the name. Same for CUSTOM.
function tagColumns_(headers, numberPattern, textPattern) {
  var num = findCol_(headers, [numberPattern]);
  var text = findCol_(headers, [textPattern]);
  if (text < 0 && num >= 0) return tagPair_(headers, num);
  if (num < 0 && text >= 0) return tagPair_(headers, text);
  if (text < 0) return { num: num, text: num };
  return { num: num, text: text };
}

function tagPair_(headers, headerCol) {
  if (headerCol < 0) return { num: -1, text: -1 };
  var next = headerCol + 1;
  if (next < headers.length && !String(headers[next] || '').trim()) {
    return { num: headerCol, text: next };
  }
  var prev = headerCol - 1;
  if (prev >= 0 && !String(headers[prev] || '').trim()) {
    return { num: prev, text: headerCol };
  }
  return { num: -1, text: headerCol };
}

function tagOf_(row, numCol, textCol, fallback) {
  var num = numCol >= 0 ? String(row[numCol] || '').trim() : '';
  var text = textCol >= 0 ? String(row[textCol] || '').trim() : '';
  if (!num && !text) return null;
  var id = num || slugify_(text);
  return { id: id, label: text || (fallback + ' ' + num) };
}

function collectionIsOn_(value) {
  var s = String(value || '').trim();
  return s === '1' || /collection/i.test(s);
}

function slugify_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractUrl_(cell) {
  var s = String(cell || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  var m = s.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : '';
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
