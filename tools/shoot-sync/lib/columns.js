'use strict';

const { squash, cellText, cellLink, normEan } = require('./util');
const config = require('../config');

function headerIndexMap(headerRow) {
  const map = new Map();
  (headerRow || []).forEach((h, i) => {
    const key = squash(h);
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

function findCol(headerMap, name) {
  const exact = headerMap.get(squash(name));
  if (exact != null) return exact;
  // prefix / contains for size* style aliases used in playground
  const want = squash(name);
  for (const [k, i] of headerMap) {
    if (k.startsWith(want) || want.startsWith(k)) return i;
  }
  return -1;
}

/** Project a raw grid onto allowlisted product columns. Returns { headers, rows, links }. */
function projectProductGrid(values, linkMap) {
  const headers = config.productColumns.slice();
  if (!values || !values.length) return { headers, rows: [], byEan: new Map() };

  const srcHeader = values[0] || [];
  const srcMap = headerIndexMap(srcHeader);
  const colIdx = headers.map((h) => findCol(srcMap, h));
  const eanIdx = findCol(srcMap, 'EAN CODE');

  const rows = [];
  const byEan = new Map();
  for (let r = 1; r < values.length; r++) {
    const src = values[r] || [];
    const ean = normEan(eanIdx >= 0 ? src[eanIdx] : '');
    const row = headers.map((h, c) => {
      const i = colIdx[c];
      if (i < 0) return '';
      return cellText(src[i]);
    });
    if (ean) row[0] = ean; // normalize EAN CODE column
    // Skip totally empty rows
    if (!ean && !row.some((x) => String(x).trim())) continue;

    const links = {};
    config.linkColumns.forEach((h) => {
      const c = headers.indexOf(h);
      const i = colIdx[c];
      if (c < 0 || i < 0) return;
      const url = (linkMap && linkMap[r + ',' + i]) || cellLink(src[i]) || '';
      if (url) links[c] = url;
    });

    const entry = { ean, values: row, links };
    rows.push(entry);
    if (ean) byEan.set(ean, entry);
  }
  return { headers, rows, byEan };
}

function projectUploadLog(values) {
  const headers = [config.uploadLog.eanHeader, config.uploadLog.linkHeader];
  const byEan = new Map();
  const rows = [];
  if (!values || !values.length) return { headers, rows, byEan };

  // Detect header row vs data: if col A looks like header text, start at 1
  let start = 0;
  const first = cellText((values[0] || [])[config.uploadLog.sourceEanCol]);
  if (/ean/i.test(first) && !/^\d{8,}/.test(normEan(first))) start = 1;

  for (let r = start; r < values.length; r++) {
    const src = values[r] || [];
    const ean = normEan(src[config.uploadLog.sourceEanCol]);
    if (!ean) continue;
    const link = cellText(src[config.uploadLog.sourceLinkCol]).trim() ||
      cellLink(src[config.uploadLog.sourceLinkCol]);
    const entry = { ean, values: [ean, link || ''], links: link ? { 1: link } : {} };
    rows.push(entry);
    byEan.set(ean, entry);
  }
  return { headers, rows, byEan };
}

function gridFromProjected(projected) {
  const out = [projected.headers.slice()];
  projected.rows.forEach((row) => {
    const vals = row.values.slice();
    Object.keys(row.links || {}).forEach((c) => {
      const i = Number(c);
      const url = row.links[c];
      const label = vals[i] || 'Open';
      if (url) vals[i] = { text: label, hyperlink: url };
    });
    out.push(vals);
  });
  return out;
}

module.exports = {
  headerIndexMap,
  findCol,
  projectProductGrid,
  projectUploadLog,
  gridFromProjected
};
