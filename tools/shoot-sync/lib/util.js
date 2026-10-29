'use strict';

function squash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normEan(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // Excel may give scientific notation or numbers
  if (/e\+/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  const digits = s.replace(/\.0+$/, '').replace(/[^\d]/g, '');
  return digits;
}

function cellText(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.richText) return v.richText.map((p) => p.text || '').join('');
    if (v.hyperlink && v.text == null) return String(v.hyperlink);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function cellLink(v) {
  if (v && typeof v === 'object') {
    if (v.hyperlink) return String(v.hyperlink);
    if (v.formula && /HYPERLINK/i.test(v.formula)) {
      const m = String(v.formula).match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
      if (m) return m[1];
    }
  }
  const t = cellText(v).trim();
  if (/^https?:\/\//i.test(t)) return t;
  return '';
}

function fmtLocal(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString([], {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function stampVersionId(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return 'v' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

module.exports = { squash, normEan, cellText, cellLink, fmtLocal, stampVersionId };
