/**
 * Presentation Board Sheet Reader — STANDALONE web app.
 * Separate from HH Multi Sheet Reader and MTS Furniture reader.
 *
 * Spreadsheet:
 *   https://docs.google.com/spreadsheets/d/1B9qtXKT0CVDt1aXFEhHyAHCWLHBp682pdL3egqNfr4w
 * Tab: first sheet (gid=0) by default.
 *
 * Columns (header row, flexible names):
 *   SUB-CATEGORY → master title (fill-down)
 *   TITLE        → label above image (else brand from IMAGE URL)
 *   IMAGE URL    → image src (blank square if empty)
 *   SEQUENCE     → right-side numbered list
 *
 * Actions (JSON / JSONP via ?callback=):
 *   action=board  — presentation payload
 *   action=ping   — health check
 *
 * Uses SpreadsheetApp (needs spreadsheets scope in appsscript.json).
 * Paste /exec URL into presentation/config.js as PRESENTATION_FEED_URL.
 */

var SHEET_ID = '1B9qtXKT0CVDt1aXFEhHyAHCWLHBp682pdL3egqNfr4w';
var SHEET_GID = 0;
var FEED_VERSION = 3;
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
  var modified = DriveApp.getFileById(SHEET_ID).getLastUpdated();
  var cacheKey = ['presBoard', FEED_VERSION, SHEET_ID, SHEET_GID, modified.getTime()].join(':');
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
    modified: modified.toISOString(),
    readAt: new Date().toISOString(),
    cached: false,
    boards: parsed.boards
  };
  cachePut_(cacheKey, out);
  return out;
}

function readBoardSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = sheetByGid_(ss, SHEET_GID) || ss.getSheets()[0];
  if (!sheet) throw new Error('No sheet found.');

  var values = sheet.getDataRange().getDisplayValues();
  if (!values || !values.length) {
    return { tab: sheet.getName(), boards: [] };
  }

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

  if (colImage < 0 && colSub < 0) {
    throw new Error(
      'Could not find SUB-CATEGORY / IMAGE URL headers on "' + sheet.getName() + '". ' +
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

    var url = colImage >= 0 ? extractUrl_(row[colImage]) : '';
    if (!url && colImage >= 0) {
      try {
        url = urlFromRichText_(sheet.getRange(r + 1, colImage + 1).getRichTextValue());
      } catch (err) { /* ignore */ }
    }

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
      sequence: seq
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

  return { tab: sheet.getName(), boards: boards };
}

function sheetByGid_(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === Number(gid)) return sheets[i];
  }
  return null;
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

function extractUrl_(cell) {
  var s = String(cell || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  var m = s.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : '';
}

function urlFromRichText_(rich) {
  if (!rich) return '';
  var link = rich.getLinkUrl();
  if (link) return link;
  var runs = rich.getRuns();
  for (var i = 0; i < runs.length; i++) {
    var u = runs[i].getLinkUrl();
    if (u) return u;
  }
  return extractUrl_(rich.getText());
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
