/**
 * One-off: extract SUB-CATEGORY / TITLE / IMAGE URL / SEQUENCE from
 * ATH MTS Furniture PDP Content PPTX (already unzipped under pptx-extract/).
 *
 * Image order: left→right within each row, then next row down.
 * Sequence items map onto that visual order 1:1.
 * IMAGE URL comes from hyperlinks on pictures when present.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'pptx-extract');
const SLIDES = path.join(ROOT, 'ppt', 'slides');
const OUT = path.join(__dirname, 'pdp-board-from-pptx.csv');
const OUT_SHEET = path.join(__dirname, 'pdp-board-sheet-import.csv');

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseRels(slideNum) {
  const p = path.join(SLIDES, '_rels', 'slide' + slideNum + '.xml.rels');
  if (!fs.existsSync(p)) return {};
  const x = fs.readFileSync(p, 'utf8');
  const map = {};
  for (const m of x.matchAll(/<Relationship[^>]*\/>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const target = decodeXml((m[0].match(/Target="([^"]+)"/) || [])[1] || '');
    const type = (m[0].match(/Type="([^"]+)"/) || [])[1] || '';
    if (id) map[id] = { target, type };
  }
  return map;
}

function emuToNum(v) {
  return Number(v || 0);
}

/** Sort items into rows by Y, then L→R within each row. */
function clusterRows(items, yTol) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    let row = rows.find((r) => Math.abs(r.y - it.y) <= yTol);
    if (!row) {
      row = { y: it.y, items: [] };
      rows.push(row);
    }
    row.items.push(it);
    row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length;
  }
  rows.sort((a, b) => a.y - b.y);
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows.flatMap((r) => r.items);
}

function unique(arr) {
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    const k = String(a).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

function extractSubCategory(texts) {
  const header =
    texts.find((t) => /PDP Page|Shared Images|Our Recommendation|Sequence/i.test(t)) ||
    texts[0] ||
    '';
  const parts = header
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  let category = '';
  let variant = '';

  if (parts.length) {
    category = parts[0]
      .replace(/\s*-\s*PDP Page.*/i, '')
      .replace(/\s*PDP Page.*/i, '')
      .replace(/\s*-\s*$/, '')
      .trim();

    for (let i = parts.length - 1; i >= 1; i--) {
      const p = parts[i];
      if (/^(Shared Images|Our Recommendation|Sequence|Our Recommendation\s*-\s*Sequence)$/i.test(p)) {
        continue;
      }
      if (/^Our Recommendation/i.test(p)) {
        const after = p.replace(/^Our Recommendation\s*-?\s*Sequence\s*-?\s*/i, '').trim();
        if (after) {
          variant = after;
          break;
        }
        continue;
      }
      if (/^Sequence\b/i.test(p)) {
        const after = p.replace(/^Sequence\s*-?\s*/i, '').trim();
        if (after) {
          variant = after;
          break;
        }
        continue;
      }
      variant = p;
      break;
    }
  }

  if (!category) {
    category = (
      texts.find(
        (t) =>
          t.length < 40 &&
          !/^Sequence$/i.test(t) &&
          !/Hero|Lifestyle|Close/i.test(t)
      ) || 'Unknown'
    ).trim();
  }

  category = category.replace(/\s*-\s*$/, '').trim() || 'Unknown';

  if (variant) {
    const esc = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp('^' + esc + '$', 'i').test(category)) {
      return category + ' - ' + variant;
    }
  }
  return category;
}

function parasFromShapeXml(shapeXml) {
  const out = [];
  for (const p of shapeXml.matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)) {
    const t = [...p[0].matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) out.push(t);
  }
  return out;
}

function extractSequence(flatTexts, shapes) {
  // Prefer paragraph list from the shape whose first para is "Sequence"
  for (const s of shapes) {
    const paras = s.paras || [];
    if (!paras.length) continue;
    if (!/^Sequence\b/i.test(paras[0]) && !/^Sequence\b/i.test(s.text)) continue;

    const items = [];
    for (let i = 0; i < paras.length; i++) {
      let t = paras[i];
      if (i === 0 && /^Sequence$/i.test(t)) continue;
      if (i === 0) t = t.replace(/^Sequence\s*/i, '').trim();
      if (!t || /^Sequence$/i.test(t)) continue;
      const numbered = t.match(/^\d+\.\s*(.+)$/);
      items.push(numbered ? numbered[1].trim() : t);
    }
    if (items.length) return unique(items);
  }

  const numbered = [];
  for (const t of flatTexts) {
    const chunks = String(t)
      .split(/\n|(?=\d+\.\s)/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const line of chunks) {
      const m = line.match(/^\d+\.\s*(.+)$/);
      if (m) numbered.push(m[1].trim());
    }
  }
  return unique(numbered);
}

const BRAND_SKIP = /^(Sequence|Shared Images|Our Recommendation|PDP Page)$/i;
const BRAND_HINT =
  /barn|elm|gulmohar|home\s*cent|wooden|street|interio|mobile|livspace|pottery|west\s*elm|ikea|pepperfry|urban|ladder|godrej|nilkamal|durian|hometown|fabindia|amazon|flipkart|wake\s*fit|sleepycat|temper|springfit|kurlon|centuary|sheela|royaloak|spacewood|evok|damro|featherlite|steelcase|herman|nilkamal|hometown|deck|regalia/i;

function isBrandLabel(t) {
  const s = t.trim();
  if (!s || s.length > 48) return false;
  if (BRAND_SKIP.test(s)) return false;
  if (/\d+\.\s/.test(s)) return false;
  if (/PDP Page|Shared Images|Our Recommendation|Sequence\s*-/i.test(s)) return false;
  if (
    /Hero|Lifestyle|Close-?up|Internals|Flaps|Drawer|Human scale|Angle View|Headboard Close|Leg\/\s*Base|Recommendation/i.test(
      s
    ) &&
    !BRAND_HINT.test(s)
  ) {
    return false;
  }
  if (s.split(/\s+/).length <= 5) return true;
  return BRAND_HINT.test(s);
}

function brandScore(img, b) {
  const dx = Math.abs(b.x + (b.cx || 0) / 2 - (img.x + (img.cx || 0) / 2));
  const abovePenalty =
    b.y + 200000 < img.y ? 0 : b.y > img.y + img.cy * 0.45 ? 5e6 : 2e5;
  if (dx > Math.max(img.cx || 1.5e6, 2.2e6)) return Infinity;
  return dx * 1.2 + Math.abs(b.y - img.y) * 0.35 + abovePenalty;
}

/** Greedy 1:1 brand→image assignment by proximity (each brand once). */
function assignBrands(images, brands) {
  const pairs = [];
  for (let i = 0; i < images.length; i++) {
    for (let j = 0; j < brands.length; j++) {
      const score = brandScore(images[i], brands[j]);
      if (score < Infinity) pairs.push({ i, j, score });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const usedImg = new Set();
  const usedBrand = new Set();
  const titles = images.map(() => '');
  for (const p of pairs) {
    if (usedImg.has(p.i) || usedBrand.has(p.j)) continue;
    usedImg.add(p.i);
    usedBrand.add(p.j);
    titles[p.i] = brands[p.j].text.trim();
  }
  return titles;
}

function parseSlide(slideNum) {
  const xmlPath = path.join(SLIDES, 'slide' + slideNum + '.xml');
  const x = fs.readFileSync(xmlPath, 'utf8');
  const rels = parseRels(slideNum);

  const shapes = [];
  for (const m of x.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const s = m[0];
    const off = s.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const ext = s.match(/<a:ext cx="(-?\d+)" cy="(-?\d+)"/);
    const paras = parasFromShapeXml(s);
    const texts = [...s.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((t) =>
      decodeXml(t[1])
    );
    const text = texts.join(' ').replace(/\s+/g, ' ').trim();
    if (!text || !off) continue;
    shapes.push({
      x: emuToNum(off[1]),
      y: emuToNum(off[2]),
      cx: ext ? emuToNum(ext[1]) : 0,
      cy: ext ? emuToNum(ext[2]) : 0,
      text,
      texts,
      paras
    });
  }

  const allTexts = shapes.map((s) => s.text).filter(Boolean);
  const flatTexts = [...x.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
    .map((t) => decodeXml(t[1]))
    .filter((t) => t.trim());

  const pics = [];
  for (const m of x.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const s = m[0];
    const off = s.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const ext = s.match(/<a:ext cx="(-?\d+)" cy="(-?\d+)"/);
    if (!off) continue;
    const hlinkId = (s.match(/hlinkClick[^>]*r:id="([^"]+)"/) || [])[1];
    const embedId = (s.match(/r:embed="([^"]+)"/) || [])[1];
    const title = (s.match(/\stitle="([^"]*)"/) || [])[1] || '';
    let refUrl = '';
    if (hlinkId && rels[hlinkId]) refUrl = rels[hlinkId].target || '';
    let mediaFile = '';
    if (embedId && rels[embedId]) {
      mediaFile = path.basename(rels[embedId].target || '');
    }
    // IMAGE URL only if the hyperlink itself points at an image asset
    let imageUrl = '';
    if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(refUrl) ||
        /googleusercontent|ggpht|cloudinary|imgix|cdn\.shopify/i.test(refUrl)) {
      imageUrl = refUrl;
    }
    pics.push({
      x: emuToNum(off[1]),
      y: emuToNum(off[2]),
      cx: ext ? emuToNum(ext[1]) : 0,
      cy: ext ? emuToNum(ext[2]) : 0,
      imageUrl,
      refUrl,
      mediaFile,
      embedId,
      mediaTitle: decodeXml(title),
      hlinkId
    });
  }

  const usable = pics.filter(
    (p) => p.cx > 200000 && p.cy > 200000 && p.x > -500000 && p.y > -500000
  );
  const ordered = clusterRows(usable, 400000);

  const brands = shapes.filter(
    (s) => isBrandLabel(s.text) && !/^Sequence\b/i.test(s.text)
  );
  const sub = extractSubCategory(allTexts.length ? allTexts : flatTexts);
  const sequence = extractSequence(flatTexts, shapes);

  const titles = assignBrands(ordered, brands);
  const n = Math.max(ordered.length, sequence.length);
  const rows = [];

  for (let i = 0; i < n; i++) {
    const img = ordered[i];
    const seq = sequence[i] || '';
    const title = img ? titles[i] || '' : '';
    if (!img && !seq) continue;
    rows.push({
      subCategory: sub,
      title,
      imageUrl: img ? img.imageUrl : '',
      refUrl: img ? img.refUrl : '',
      mediaFile: img ? img.mediaFile : '',
      sequence: seq,
      slide: slideNum
    });
  }

  return {
    sub,
    sequence,
    brands: brands.map((b) => b.text),
    imageCount: ordered.length,
    rows
  };
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const slides = fs
  .readdirSync(SLIDES)
  .filter((f) => /^slide\d+\.xml$/.test(f))
  .map((f) => parseInt(f.match(/\d+/)[0], 10))
  .sort((a, b) => a - b);

const allRows = [];
const summary = [];

for (const n of slides) {
  const r = parseSlide(n);
  summary.push({
    slide: n,
    sub: r.sub,
    imgs: r.imageCount,
    seq: r.sequence.length,
    brands: r.brands.join('; '),
    seqPreview: r.sequence.slice(0, 3).join(' / ')
  });
  for (const row of r.rows) {
    if (!row.imageUrl && !row.title && !row.sequence) continue;
    allRows.push(row);
  }
}

const header = [
  'SUB-CATEGORY',
  'TITLE',
  'IMAGE URL',
  'SEQUENCE',
  'REFERENCE URL',
  'MEDIA FILE',
  'SLIDE'
];
const lines = [header.join(',')];
for (const r of allRows) {
  lines.push(
    [
      r.subCategory,
      r.title,
      r.imageUrl,
      r.sequence,
      r.refUrl,
      r.mediaFile,
      r.slide
    ]
      .map(csvEscape)
      .join(',')
  );
}
fs.writeFileSync(OUT, lines.join('\r\n'), 'utf8');

// Clean 4-column file for pasting into the PDP generator sheet
const sheetHeader = ['SUB-CATEGORY', 'TITLE', 'IMAGE URL', 'SEQUENCE'];
const sheetLines = [sheetHeader.join(',')];
for (const r of allRows) {
  sheetLines.push(
    [r.subCategory, r.title, r.imageUrl, r.sequence].map(csvEscape).join(',')
  );
}
fs.writeFileSync(OUT_SHEET, sheetLines.join('\r\n'), 'utf8');

console.log('Wrote', OUT);
console.log('Wrote', OUT_SHEET);
console.log('Rows', allRows.length);
console.log('With IMAGE URL', allRows.filter((r) => r.imageUrl).length);
console.log('With REFERENCE URL', allRows.filter((r) => r.refUrl).length);
console.log('With title', allRows.filter((r) => r.title).length);
console.log('With seq', allRows.filter((r) => r.sequence).length);
console.log('\n--- per slide ---');
for (const s of summary) {
  console.log(
    String(s.slide).padStart(2),
    '|',
    s.sub.slice(0, 44).padEnd(44),
    '| imgs',
    String(s.imgs).padStart(2),
    'seq',
    String(s.seq).padStart(2),
    '|',
    s.brands.slice(0, 48),
    '|',
    s.seqPreview.slice(0, 55)
  );
}
