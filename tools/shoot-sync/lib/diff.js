'use strict';

const config = require('../config');

function sameValue(a, b) {
  return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}

/**
 * Merge destination projected tab with xlsx projected tab.
 * Returns { headers, rows, byEan, changes: [{ean,column,old,new}], newEans: [] }
 */
function mergeProductTab(dest, src, tabName) {
  const headers = (src && src.headers) || (dest && dest.headers) || config.productColumns.slice();
  const destBy = (dest && dest.byEan) || new Map();
  const srcBy = (src && src.byEan) || new Map();

  const changes = [];
  const newEans = [];
  const mergedBy = new Map();

  // Keep destination-only EANs
  for (const [ean, d] of destBy) {
    mergedBy.set(ean, {
      ean,
      values: d.values.slice(),
      links: Object.assign({}, d.links || {})
    });
  }

  for (const [ean, s] of srcBy) {
    const d = destBy.get(ean);
    if (!d) {
      newEans.push(ean);
      mergedBy.set(ean, {
        ean,
        values: s.values.slice(),
        links: Object.assign({}, s.links || {})
      });
      continue;
    }
    const values = d.values.slice();
    const links = Object.assign({}, d.links || {});
    headers.forEach((h, c) => {
      const oldV = d.values[c] || '';
      const newV = s.values[c] || '';
      if (!sameValue(oldV, newV)) {
        changes.push({ tab: tabName, ean, column: h, old: oldV, new: newV });
        values[c] = newV;
      }
      const oldL = (d.links && d.links[c]) || '';
      const newL = (s.links && s.links[c]) || '';
      if (newL && newL !== oldL) {
        if (sameValue(oldV, newV)) {
          // link-only change
          changes.push({ tab: tabName, ean, column: h + ' (link)', old: oldL, new: newL });
        }
        links[c] = newL;
      } else if (newL) {
        links[c] = newL;
      }
    });
    mergedBy.set(ean, { ean, values, links });
  }

  // Preserve destination row order, then append news in source order
  const rows = [];
  const seen = new Set();
  (dest.rows || []).forEach((r) => {
    if (!r.ean) return;
    const m = mergedBy.get(r.ean);
    if (m) {
      rows.push(m);
      seen.add(r.ean);
    }
  });
  (src.rows || []).forEach((r) => {
    if (!r.ean || seen.has(r.ean)) return;
    const m = mergedBy.get(r.ean);
    if (m) {
      rows.push(m);
      seen.add(r.ean);
    }
  });

  return {
    headers,
    rows,
    byEan: mergedBy,
    changes,
    newEans,
    unchanged: destBy.size + srcBy.size - changes.length - newEans.length // rough
  };
}

function mergeUploadLog(dest, src) {
  const tabName = config.uploadLogTab;
  const headers = ['EAN', 'EAN Folder Link'];
  const destBy = (dest && dest.byEan) || new Map();
  const srcBy = (src && src.byEan) || new Map();
  const changes = [];
  const newEans = [];
  const mergedBy = new Map();

  for (const [ean, d] of destBy) {
    mergedBy.set(ean, { ean, values: d.values.slice(), links: Object.assign({}, d.links || {}) });
  }

  for (const [ean, s] of srcBy) {
    const d = destBy.get(ean);
    if (!d) {
      newEans.push(ean);
      mergedBy.set(ean, { ean, values: s.values.slice(), links: Object.assign({}, s.links || {}) });
      continue;
    }
    const oldL = d.values[1] || '';
    const newL = s.values[1] || '';
    if (!sameValue(oldL, newL)) {
      changes.push({ tab: tabName, ean, column: 'EAN Folder Link', old: oldL, new: newL });
    }
    mergedBy.set(ean, {
      ean,
      values: [ean, newL || oldL],
      links: (newL || oldL) ? { 1: newL || oldL } : {}
    });
  }

  const rows = [];
  const seen = new Set();
  (dest.rows || []).forEach((r) => {
    if (!r.ean || !mergedBy.has(r.ean)) return;
    rows.push(mergedBy.get(r.ean));
    seen.add(r.ean);
  });
  (src.rows || []).forEach((r) => {
    if (!r.ean || seen.has(r.ean)) return;
    rows.push(mergedBy.get(r.ean));
    seen.add(r.ean);
  });

  return { headers, rows, byEan: mergedBy, changes, newEans };
}

module.exports = { mergeProductTab, mergeUploadLog, sameValue };
