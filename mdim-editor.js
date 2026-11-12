(() => {
  'use strict';

  const APP_VERSION = '0.1-test';
  const LS_PREFIX = 'mdim.draft.';
  const MAX_ARROWS = 8;
  const WORKSPACE_SIZE = 3000;

  const DEFAULT_STYLE = {
    stroke: '#000000',
    strokeWidth: 6,
    fontName: 'Times New Roman',
    fontFamily: '"Times New Roman", Times, serif',
    fontSize: 63,
    textColor: '#000000',
    arrowHead: 26,
    textOffset: 50
  };

  const el = {
    stage: document.getElementById('stage'),
    warnings: document.getElementById('stage-warnings'),
    empty: document.getElementById('empty-hint'),
    box: document.getElementById('canvas-box'),
    img: document.getElementById('base-img'),
    overlay: document.getElementById('overlay'),
    fileImage: document.getElementById('file-image'),
    fileJson: document.getElementById('file-json'),
    btnLoadJson: document.getElementById('btn-load-json'),
    btnSaveJson: document.getElementById('btn-save-json'),
    btnExport: document.getElementById('btn-export'),
    btnRebuild: document.getElementById('btn-rebuild'),
    ean: document.getElementById('field-ean'),
    seq: document.getElementById('field-seq'),
    size: document.getElementById('field-size'),
    dimensions: document.getElementById('field-dimensions'),
    weight: document.getElementById('field-weight'),
    capacity: document.getElementById('field-capacity'),
    imageKind: document.getElementById('field-image-kind'),
    shotCode: document.getElementById('field-shot-code'),
    wrapShotCode: document.getElementById('wrap-shot-code'),
    sourceMeta: document.getElementById('source-image-meta'),
    arrowList: document.getElementById('arrow-list'),
    arrowCount: document.getElementById('arrow-count-label'),
    selectedEmpty: document.getElementById('selected-empty'),
    selectedFields: document.getElementById('selected-fields'),
    selLabel: document.getElementById('sel-label'),
    selRotation: document.getElementById('sel-rotation'),
    selLength: document.getElementById('sel-length'),
    styleFont: document.getElementById('style-font'),
    styleFontSize: document.getElementById('style-font-size'),
    styleStroke: document.getElementById('style-stroke'),
    styleOffset: document.getElementById('style-offset'),
    styleHead: document.getElementById('style-head'),
    jsonPreview: document.getElementById('json-preview')
  };

  const state = {
    imageUrl: null,
    naturalW: WORKSPACE_SIZE,
    naturalH: WORKSPACE_SIZE,
    displayW: 0,
    displayH: 0,
    selectedId: null,
    drag: null,
    doc: createEmptyDoc()
  };

  function createEmptySourceImage() {
    return {
      kind: 'custom',
      shotCode: '',
      fileName: '',
      originalWidth: 0,
      originalHeight: 0,
      isSquare: true,
      needsUpscale: false,
      workspaceSize: WORKSPACE_SIZE
    };
  }

  function createEmptyDoc() {
    return {
      version: 1,
      ean: '',
      seq: '05',
      code: 'M-DIM',
      sourceFields: {
        productSize: '',
        productDimensions: '',
        productWeightKg: '',
        productCapacity: ''
      },
      sourceImage: createEmptySourceImage(),
      arrows: [],
      style: Object.assign({}, DEFAULT_STYLE)
    };
  }

  /* ---------- Angle helpers ---------- */

  function normalizeDeg(d) {
    let x = Number(d) || 0;
    x = x % 360;
    if (x < 0) x += 360;
    if (Math.abs(x - 360) < 1e-9) x = 0;
    return x;
  }

  function applyRotationRules(deg, shiftHeld) {
    let r = normalizeDeg(deg);
    // Cardinal snap only while Shift is held; free rotate otherwise
    if (!shiftHeld) return r;
    const snaps = [0, 90, 180, 270, 360];
    let best = snaps[0];
    let bestDist = Infinity;
    snaps.forEach((s) => {
      const dist = Math.min(Math.abs(s - r), Math.abs(s - r - 360), Math.abs(s - r + 360));
      if (dist < bestDist) {
        bestDist = dist;
        best = s === 360 ? 0 : s;
      }
    });
    return best;
  }

  function readableTextAngle(rotationDeg) {
    // Keep label readable (not upside-down). Flip when pointing mostly leftward.
    let r = normalizeDeg(rotationDeg);
    let flip = false;
    if (r > 90 && r < 270) {
      r = normalizeDeg(r + 180);
      flip = true;
    }
    return { angle: r, flip };
  }

  /* ---------- Data parser ---------- */

  function isEmptyMeasure(s) {
    return !s || /^(0+(\.0+)?|-+|–|n\.?a\.?|nil|none|null|#n\/a)$/i.test(s);
  }

  function normUnit(u) {
    const x = String(u || '').toLowerCase();
    if (/^(ltr|litres?|liters?)$/.test(x)) return 'l';
    if (/^grams?$/.test(x)) return 'g';
    return x;
  }

  /** Parse one blob; supports odd Shoot Tracker forms e.g. "8.2 X CM 5.5 X CM 10.5 CM/ 340ML". */
  function parseMeasureField(raw, fallbackUnit) {
    let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (isEmptyMeasure(s)) return [];

    // Split multi-SKU "A and B" into separate chunks, then flatten
    const chunks = s.split(/\s+\band\b\s+/i);
    const out = [];
    chunks.forEach((chunk) => {
      parseMeasureChunk(chunk, fallbackUnit).forEach((lab) => out.push(lab));
    });
    return out;
  }

  function parseMeasureChunk(raw, fallbackUnit) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (isEmptyMeasure(s)) return [];

    // Dimension / volume: "… CM/ 340ML" or "… CM/210ml"
    const slashParts = s.split(/\s*\/\s*/);
    const labels = [];
    slashParts.forEach((part, idx) => {
      const p = part.trim();
      if (!p) return;
      // Later slash segments are usually capacity/volume
      const fb = idx === 0 ? fallbackUnit : (guessVolumeUnit(p) || 'ml');
      parseDimensionOrVolumePart(p, fb).forEach((lab) => labels.push(lab));
    });
    return labels;
  }

  function guessVolumeUnit(p) {
    if (/\b(ml|l|ltr|litres?|liters?)\b/i.test(p)) return null; // unit present in string
    if (/\b(cm|mm|m)\b/i.test(p)) return 'cm';
    return 'ml';
  }

  function parseDimensionOrVolumePart(raw, fallbackUnit) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return [];

    // Longer unit tokens first (ml before m, cm/mm before m, grams before g)
    const UNIT = 'ml|cm|mm|kg|grams?|g|ltr|litres?|liters?|l|m';

    // Fix "8.2 X CM 5.5 X CM" → "8.2 CM X 5.5 CM X …"
    s = s.replace(new RegExp('\\s*[xX×*]\\s*(cm|mm|m)\\b', 'gi'), ' $1 x ');
    // Stick unit onto glued forms: "12.5CM", "340ML"
    s = s.replace(new RegExp('(\\d)\\s*(' + UNIT + ')\\b', 'gi'), '$1 $2');

    // Compact "10x10x3 cm" — unit only at end: apply to each number after split
    const endUnitMatch = s.match(new RegExp('\\b(' + UNIT + ')\\s*$', 'i'));
    const endUnit = endUnitMatch ? normUnit(endUnitMatch[1]) : '';
    const core = endUnitMatch ? s.slice(0, endUnitMatch.index).trim() : s;

    // If still has x separators between bare numbers
    if (/[xX×*]/.test(core) && !new RegExp('\\b(' + UNIT + ')\\b', 'i').test(core.replace(/\s*[xX×*]\s*/g, ' '))) {
      const unit = endUnit || normUnit(fallbackUnit) || '';
      return core.split(/\s*[xX×*]\s*/)
        .map((p) => p.replace(/[^\d.,]/g, '').replace(',', '.'))
        .filter((n) => n && /\d/.test(n))
        .map((n) => (unit ? n + ' ' + unit : n));
    }

    // General: walk number + optional unit tokens
    const re = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*(' + UNIT + ')?', 'gi');
    const labels = [];
    let m;
    let lastUnit = normUnit(fallbackUnit) || endUnit || '';
    while ((m = re.exec(s)) !== null) {
      const num = m[1].replace(',', '.');
      let unit = normUnit(m[2] || '');
      if (!unit) unit = lastUnit || endUnit || normUnit(fallbackUnit) || '';
      if (unit) lastUnit = unit;
      labels.push(unit ? num + ' ' + unit : num);
    }
    return labels;
  }

  function dedupeLabels(list) {
    const seen = new Set();
    const out = [];
    list.forEach((lab) => {
      const key = String(lab).trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(String(lab).trim().replace(/\s+/g, ' '));
    });
    return out;
  }

  function collectLabelsFromFields(fields) {
    const size = parseMeasureField(fields.productSize, 'cm');
    const dimsRaw = String(fields.productDimensions || '').trim();
    const sizeRaw = String(fields.productSize || '').trim();
    const dims = dimsRaw && dimsRaw.toLowerCase() !== sizeRaw.toLowerCase()
      ? parseMeasureField(fields.productDimensions, 'cm')
      : [];
    const weight = parseMeasureField(fields.productWeightKg, 'kg').map((v) => {
      if (/\b(kg|g)\b/i.test(v)) return v;
      return v + ' kg';
    });
    const capacity = parseMeasureField(fields.productCapacity, 'ml');
    // Size/dim may already include "/ 340ML" — dedupe against capacity column
    return dedupeLabels(size.concat(dims, weight, capacity)).slice(0, MAX_ARROWS);
  }

  function defaultArrowLayout(count) {
    // Sensible starting poses; human adjusts on image.
    const presets = [
      { cx: 0.18, cy: 0.45, length: 0.42, rotation: 90 },
      { cx: 0.42, cy: 0.78, length: 0.28, rotation: 155 },
      { cx: 0.62, cy: 0.78, length: 0.38, rotation: 18 },
      { cx: 0.78, cy: 0.5, length: 0.32, rotation: 90 },
      { cx: 0.5, cy: 0.2, length: 0.3, rotation: 0 },
      { cx: 0.3, cy: 0.65, length: 0.26, rotation: 140 },
      { cx: 0.7, cy: 0.65, length: 0.26, rotation: 40 },
      { cx: 0.5, cy: 0.5, length: 0.28, rotation: 0 }
    ];
    if (count <= 1) return [{ cx: 0.72, cy: 0.5, length: 0.35, rotation: 90 }];
    if (count === 2) {
      return [
        { cx: 0.22, cy: 0.48, length: 0.4, rotation: 90 },
        { cx: 0.55, cy: 0.78, length: 0.4, rotation: 8 }
      ];
    }
    return presets.slice(0, count);
  }

  function rebuildArrowsFromRaw(keepPositions) {
    const labels = collectLabelsFromFields(state.doc.sourceFields);
    const prev = state.doc.arrows || [];
    const layout = defaultArrowLayout(labels.length);
    state.doc.arrows = labels.map((label, i) => {
      const id = 'arrow-' + (i + 1);
      const old = keepPositions && prev[i] ? prev[i] : null;
      const base = layout[i] || layout[layout.length - 1];
      return {
        id,
        label,
        cx: old ? old.cx : base.cx,
        cy: old ? old.cy : base.cy,
        length: old ? old.length : base.length,
        rotation: old ? old.rotation : base.rotation,
        visible: true
      };
    });
    if (state.selectedId && !state.doc.arrows.some((a) => a.id === state.selectedId)) {
      state.selectedId = state.doc.arrows[0] ? state.doc.arrows[0].id : null;
    }
  }

  /* ---------- Geometry ---------- */

  function arrowPixels(arrow) {
    const w = state.displayW || state.naturalW || 1;
    const h = state.displayH || state.naturalH || 1;
    const cx = arrow.cx * w;
    const cy = arrow.cy * h;
    const lengthPx = Math.max(20, arrow.length * w);
    const rot = normalizeDeg(arrow.rotation);
    const rad = (rot * Math.PI) / 180;
    const half = lengthPx / 2;
    const dx = Math.cos(rad) * half;
    const dy = Math.sin(rad) * half;
    return {
      cx, cy, lengthPx, rot, rad,
      x1: cx - dx,
      y1: cy - dy,
      x2: cx + dx,
      y2: cy + dy
    };
  }

  /* ---------- Render SVG ---------- */

  function syncOverlaySize() {
    const img = el.img;
    if (!img.naturalWidth) return;
    // Editor always works in 3000×3000 logical pixels (workspace bitmap).
    state.naturalW = WORKSPACE_SIZE;
    state.naturalH = WORKSPACE_SIZE;
    const rect = img.getBoundingClientRect();
    state.displayW = rect.width;
    state.displayH = rect.height;
    el.overlay.setAttribute('viewBox', '0 0 ' + state.displayW + ' ' + state.displayH);
    el.overlay.setAttribute('width', String(state.displayW));
    el.overlay.setAttribute('height', String(state.displayH));
  }

  function updateStageWarnings() {
    const src = state.doc.sourceImage || createEmptySourceImage();
    const msgs = [];
    if (src.originalWidth && src.originalHeight) {
      if (!src.isSquare) {
        msgs.push({
          danger: true,
          text: 'Source is ' + src.originalWidth + '×' + src.originalHeight +
            ' (not 1:1). Fitted into a 3000×3000 white workspace — check margins/proportion.'
        });
      }
      if (src.needsUpscale) {
        msgs.push({
          danger: false,
          text: 'Source min side is below 3000px (' + src.originalWidth + '×' + src.originalHeight +
            '). Editor shows a fitted 3000×3000 preview; for marketplace quality, upscale (e.g. Firefly) before final export when merged with Playground.'
        });
      }
    }
    if (!el.warnings) return;
    if (!msgs.length) {
      el.warnings.hidden = true;
      el.warnings.innerHTML = '';
      return;
    }
    el.warnings.hidden = false;
    el.warnings.innerHTML = msgs.map((m) =>
      '<div class="mdim-warn' + (m.danger ? ' is-danger' : '') + '">' + escapeHtml(m.text) + '</div>'
    ).join('');
  }

  function updateSourceMetaLine() {
    const src = state.doc.sourceImage || createEmptySourceImage();
    if (!src.originalWidth) {
      el.sourceMeta.textContent = 'No image loaded';
      return;
    }
    const kind = src.kind === 'shot'
      ? ('shot ' + (src.shotCode || '(code?)'))
      : 'custom';
    el.sourceMeta.textContent =
      (src.fileName || 'image') + ' · ' + kind + ' · original ' +
      src.originalWidth + '×' + src.originalHeight +
      ' · workspace ' + WORKSPACE_SIZE + '×' + WORKSPACE_SIZE +
      (src.needsUpscale ? ' · needs upscale' : '') +
      (src.isSquare ? '' : ' · not square');
  }

  function styleFontCss() {
    const s = state.doc.style;
    const name = s.fontName || 'Times New Roman';
    return s.fontFamily || ('"' + name + '", Times, serif');
  }

  function renderOverlay() {
    syncOverlaySize();
    const svg = el.overlay;
    const style = state.doc.style;
    const ns = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    (state.doc.arrows || []).forEach((arrow) => {
      if (arrow.visible === false) return;
      const g = document.createElementNS(ns, 'g');
      g.classList.add('mdim-arrow');
      g.dataset.id = arrow.id;
      if (arrow.id === state.selectedId) g.classList.add('is-selected');

      const geo = arrowPixels(arrow);
      const scale = state.naturalW ? state.displayW / state.naturalW : 1;
      const head = (Number(style.arrowHead) || DEFAULT_STYLE.arrowHead) * scale;
      const sw = (Number(style.strokeWidth) || DEFAULT_STYLE.strokeWidth) * scale;
      const textOff = Number(style.textOffset) != null ? Number(style.textOffset) : DEFAULT_STYLE.textOffset;
      const { angle: textAngle, flip } = readableTextAngle(geo.rot);
      const side = flip ? 1 : -1;

      // Shaft (shortened so heads sit at ends without stretching)
      const shaftHalf = Math.max(0, geo.lengthPx / 2 - head * 0.85);
      const sx1 = geo.cx - Math.cos(geo.rad) * shaftHalf;
      const sy1 = geo.cy - Math.sin(geo.rad) * shaftHalf;
      const sx2 = geo.cx + Math.cos(geo.rad) * shaftHalf;
      const sy2 = geo.cy + Math.sin(geo.rad) * shaftHalf;

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', sx1);
      line.setAttribute('y1', sy1);
      line.setAttribute('x2', sx2);
      line.setAttribute('y2', sy2);
      line.setAttribute('stroke', style.stroke || '#000');
      line.setAttribute('stroke-width', String(sw));
      line.setAttribute('stroke-linecap', 'butt');
      line.setAttribute('pointer-events', 'none');
      g.appendChild(line);

      // Invisible hit targets (no green chrome)
      const hit = document.createElementNS(ns, 'line');
      hit.setAttribute('x1', geo.x1);
      hit.setAttribute('y1', geo.y1);
      hit.setAttribute('x2', geo.x2);
      hit.setAttribute('y2', geo.y2);
      hit.classList.add('mdim-hit');
      hit.dataset.role = 'move';
      g.appendChild(hit);

      const inset = Math.max(head * 0.55, 10);
      const e1x = geo.cx - Math.cos(geo.rad) * Math.max(0, geo.lengthPx / 2 - inset);
      const e1y = geo.cy - Math.sin(geo.rad) * Math.max(0, geo.lengthPx / 2 - inset);
      const e2x = geo.cx + Math.cos(geo.rad) * Math.max(0, geo.lengthPx / 2 - inset);
      const e2y = geo.cy + Math.sin(geo.rad) * Math.max(0, geo.lengthPx / 2 - inset);
      [[e1x, e1y, 'end1'], [e2x, e2y, 'end2']].forEach(([x, y, role]) => {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', x);
        c.setAttribute('cy', y);
        c.setAttribute('r', Math.max(12, head * 0.45));
        c.classList.add('mdim-end');
        c.dataset.role = role;
        g.appendChild(c);
      });

      // Fixed-size filled triangular heads on top (always visible)
      const head1 = makeHead(ns, geo.x1, geo.y1, geo.rad + Math.PI, head, style.stroke || '#000');
      const head2 = makeHead(ns, geo.x2, geo.y2, geo.rad, head, style.stroke || '#000');
      head1.setAttribute('pointer-events', 'none');
      head2.setAttribute('pointer-events', 'none');
      g.appendChild(head1);
      g.appendChild(head2);

      // Label — same font, bold only (no outline stroke)
      const label = document.createElementNS(ns, 'text');
      label.textContent = arrow.label || '';
      label.setAttribute('x', '0');
      label.setAttribute('y', '0');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('fill', style.textColor || '#000');
      label.setAttribute('font-family', styleFontCss());
      label.setAttribute('font-size', String((style.fontSize || DEFAULT_STYLE.fontSize) * scale));
      label.setAttribute('font-weight', '700');
      label.setAttribute('pointer-events', 'none');
      const tx = geo.cx + Math.cos(geo.rad + Math.PI / 2) * textOff * scale * side;
      const ty = geo.cy + Math.sin(geo.rad + Math.PI / 2) * textOff * scale * side;
      label.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') rotate(' + textAngle + ')');
      g.appendChild(label);

      // Green rotate handle on the arrow (not on heads) — side-panel slider stays removed
      const rhDist = 36;
      const rhx = geo.cx + Math.cos(geo.rad - Math.PI / 2) * rhDist;
      const rhy = geo.cy + Math.sin(geo.rad - Math.PI / 2) * rhDist;
      const rline = document.createElementNS(ns, 'line');
      rline.setAttribute('x1', geo.cx);
      rline.setAttribute('y1', geo.cy);
      rline.setAttribute('x2', rhx);
      rline.setAttribute('y2', rhy);
      rline.classList.add('mdim-rotate-line');
      g.appendChild(rline);
      const rh = document.createElementNS(ns, 'circle');
      rh.setAttribute('cx', rhx);
      rh.setAttribute('cy', rhy);
      rh.setAttribute('r', 7);
      rh.classList.add('mdim-rotate-handle');
      rh.dataset.role = 'rotate';
      g.appendChild(rh);

      svg.appendChild(g);
    });
  }

  function makeHead(ns, tipX, tipY, pointingRad, size, fill) {
    // Triangle pointing along pointingRad (away from center)
    const back = size;
    const halfW = size * 0.55;
    const bx = tipX - Math.cos(pointingRad) * back;
    const by = tipY - Math.sin(pointingRad) * back;
    const px = Math.cos(pointingRad + Math.PI / 2) * halfW;
    const py = Math.sin(pointingRad + Math.PI / 2) * halfW;
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute(
      'points',
      tipX + ',' + tipY + ' ' + (bx + px) + ',' + (by + py) + ' ' + (bx - px) + ',' + (by - py)
    );
    poly.setAttribute('fill', fill);
    poly.setAttribute('stroke', 'none');
    return poly;
  }

  /* ---------- Panel sync ---------- */

  function syncPanelFromDoc(skipJson) {
    el.ean.value = state.doc.ean || '';
    el.seq.value = state.doc.seq || '05';
    el.size.value = state.doc.sourceFields.productSize || '';
    el.dimensions.value = state.doc.sourceFields.productDimensions || '';
    el.weight.value = state.doc.sourceFields.productWeightKg || '';
    el.capacity.value = state.doc.sourceFields.productCapacity || '';
    const src = state.doc.sourceImage || createEmptySourceImage();
    el.imageKind.value = src.kind === 'shot' ? 'shot' : 'custom';
    el.shotCode.value = src.shotCode || '';
    el.wrapShotCode.style.display = el.imageKind.value === 'shot' ? '' : 'none';
    updateSourceMetaLine();
    updateStageWarnings();
    const st = state.doc.style;
    el.styleFont.value = st.fontName || '';
    el.styleFontSize.value = st.fontSize != null ? st.fontSize : DEFAULT_STYLE.fontSize;
    el.styleStroke.value = st.strokeWidth != null ? st.strokeWidth : DEFAULT_STYLE.strokeWidth;
    el.styleOffset.value = st.textOffset != null ? st.textOffset : DEFAULT_STYLE.textOffset;
    el.styleHead.value = st.arrowHead != null ? st.arrowHead : DEFAULT_STYLE.arrowHead;

    const arrows = state.doc.arrows || [];
    el.arrowCount.textContent = arrows.length ? '(' + arrows.length + ')' : '(none)';
    el.arrowList.innerHTML = '';
    arrows.forEach((a) => {
      const card = document.createElement('div');
      card.className = 'arrow-card' + (a.id === state.selectedId ? ' is-active' : '');
      card.dataset.id = a.id;
      card.innerHTML =
        '<div class="label">' + escapeHtml(a.label) + '</div>' +
        '<div class="meta">' + a.id + ' · ' + Math.round(normalizeDeg(a.rotation)) + '° · L ' +
        Number(a.length).toFixed(2) + '</div>';
      card.addEventListener('click', () => {
        state.selectedId = a.id;
        syncPanelFromDoc();
        renderOverlay();
      });
      el.arrowList.appendChild(card);
    });

    const sel = arrows.find((a) => a.id === state.selectedId);
    if (!sel) {
      el.selectedEmpty.hidden = false;
      el.selectedFields.hidden = true;
    } else {
      el.selectedEmpty.hidden = true;
      el.selectedFields.hidden = false;
      el.selLabel.value = sel.label || '';
      el.selRotation.value = String(round1(normalizeDeg(sel.rotation)));
      el.selLength.value = String(Number(sel.length).toFixed(3));
    }

    if (!skipJson) {
      el.jsonPreview.value = JSON.stringify(state.doc, null, 2);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function readPanelIntoDoc() {
    state.doc.ean = String(el.ean.value || '').trim();
    state.doc.seq = String(el.seq.value || '05').trim().padStart(2, '0').slice(-2);
    state.doc.sourceFields.productSize = el.size.value;
    state.doc.sourceFields.productDimensions = el.dimensions.value;
    state.doc.sourceFields.productWeightKg = el.weight.value;
    state.doc.sourceFields.productCapacity = el.capacity.value;
    if (!state.doc.sourceImage) state.doc.sourceImage = createEmptySourceImage();
    state.doc.sourceImage.kind = el.imageKind.value === 'shot' ? 'shot' : 'custom';
    state.doc.sourceImage.shotCode = String(el.shotCode.value || '').trim();
    state.doc.sourceImage.workspaceSize = WORKSPACE_SIZE;
    state.doc.style.fontName = el.styleFont.value.trim() || DEFAULT_STYLE.fontName;
    state.doc.style.fontFamily = '"' + state.doc.style.fontName + '", Times, serif';
    state.doc.style.fontSize = Number(el.styleFontSize.value);
    if (!Number.isFinite(state.doc.style.fontSize)) state.doc.style.fontSize = DEFAULT_STYLE.fontSize;
    state.doc.style.strokeWidth = Number(el.styleStroke.value);
    if (!Number.isFinite(state.doc.style.strokeWidth)) state.doc.style.strokeWidth = DEFAULT_STYLE.strokeWidth;
    state.doc.style.textOffset = Number(el.styleOffset.value);
    if (!Number.isFinite(state.doc.style.textOffset)) state.doc.style.textOffset = DEFAULT_STYLE.textOffset;
    state.doc.style.arrowHead = Number(el.styleHead.value);
    if (!Number.isFinite(state.doc.style.arrowHead)) state.doc.style.arrowHead = DEFAULT_STYLE.arrowHead;
  }

  function persist() {
    readPanelIntoDoc();
    const ean = state.doc.ean || 'draft';
    try {
      localStorage.setItem(LS_PREFIX + ean, JSON.stringify(state.doc));
    } catch (_) { /* ignore quota */ }
    el.jsonPreview.value = JSON.stringify(state.doc, null, 2);
  }

  function loadDraftForEan(ean) {
    if (!ean) return false;
    try {
      const raw = localStorage.getItem(LS_PREFIX + ean);
      if (!raw) return false;
      const doc = JSON.parse(raw);
      if (!doc || !doc.version) return false;
      state.doc = normalizeDoc(doc);
      return true;
    } catch (_) {
      return false;
    }
  }

  function normalizeDoc(doc) {
    const d = Object.assign(createEmptyDoc(), doc);
    d.sourceFields = Object.assign(createEmptyDoc().sourceFields, doc.sourceFields || {});
    d.sourceImage = Object.assign(createEmptySourceImage(), doc.sourceImage || {});
    d.sourceImage.workspaceSize = WORKSPACE_SIZE;
    d.style = Object.assign({}, DEFAULT_STYLE, doc.style || {});
    if (d.style.fontName && !d.style.fontFamily) {
      d.style.fontFamily = '"' + d.style.fontName + '", Times, serif';
    }
    d.arrows = Array.isArray(doc.arrows) ? doc.arrows.slice(0, MAX_ARROWS) : [];
    d.seq = String(d.seq || '05').padStart(2, '0').slice(-2);
    d.code = d.code || 'M-DIM';
    return d;
  }

  /* ---------- Pointer interactions ---------- */

  function svgPoint(evt) {
    const rect = el.overlay.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
  }

  function findArrow(id) {
    return (state.doc.arrows || []).find((a) => a.id === id);
  }

  el.overlay.addEventListener('pointerdown', (evt) => {
    const t = evt.target;
    if (!t || !t.closest) return;
    const g = t.closest('.mdim-arrow');
    if (!g) {
      state.selectedId = null;
      syncPanelFromDoc();
      renderOverlay();
      return;
    }
    const id = g.dataset.id;
    const role = t.dataset.role || 'move';
    state.selectedId = id;
    const arrow = findArrow(id);
    if (!arrow) return;
    const pt = svgPoint(evt);
    const geo = arrowPixels(arrow);
    state.drag = {
      id,
      role,
      startX: pt.x,
      startY: pt.y,
      orig: {
        cx: arrow.cx,
        cy: arrow.cy,
        length: arrow.length,
        rotation: arrow.rotation,
        x1: geo.x1,
        y1: geo.y1,
        x2: geo.x2,
        y2: geo.y2
      }
    };
    el.overlay.setPointerCapture(evt.pointerId);
    syncPanelFromDoc();
    renderOverlay();
    evt.preventDefault();
  });

  el.overlay.addEventListener('pointermove', (evt) => {
    if (!state.drag) return;
    const arrow = findArrow(state.drag.id);
    if (!arrow) return;
    const pt = svgPoint(evt);
    const w = state.displayW || 1;
    const h = state.displayH || 1;
    const shift = evt.shiftKey;

    if (state.drag.role === 'move') {
      const dx = pt.x - state.drag.startX;
      const dy = pt.y - state.drag.startY;
      arrow.cx = clamp01(state.drag.orig.cx + dx / w);
      arrow.cy = clamp01(state.drag.orig.cy + dy / h);
    } else if (state.drag.role === 'end1' || state.drag.role === 'end2') {
      // Length-only: keep center fixed; new length = 2 * distance from center to pointer projected… 
      // Better UX matching plan: drag endpoint moves that end; center & other end adjust so length changes without rotating unless intended.
      // Keep rotation fixed; change length from center to dragged end * 2.
      const cx = state.drag.orig.cx * w;
      const cy = state.drag.orig.cy * h;
      const dist = Math.hypot(pt.x - cx, pt.y - cy);
      arrow.length = clamp(dist * 2 / w, 0.04, 1.2);
      // Optional: update rotation toward pointer if Alt held
      if (evt.altKey) {
        const ang = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
        const base = state.drag.role === 'end1' ? ang + 180 : ang;
        arrow.rotation = applyRotationRules(base, shift);
      }
    } else if (state.drag.role === 'rotate') {
      const cx = arrow.cx * w;
      const cy = arrow.cy * h;
      const handleAng = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
      arrow.rotation = applyRotationRules(handleAng + 90, shift);
    }

    renderOverlay();
    syncPanelFromDoc(true);
  });

  function endDrag(evt) {
    if (!state.drag) return;
    state.drag = null;
    try { el.overlay.releasePointerCapture(evt.pointerId); } catch (_) { /* */ }
    persist();
    syncPanelFromDoc();
    renderOverlay();
  }
  el.overlay.addEventListener('pointerup', endDrag);
  el.overlay.addEventListener('pointercancel', endDrag);

  function clamp01(n) { return clamp(n, 0, 1); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  /* ---------- Image load (always → 3000×3000 workspace) ---------- */

  function revokeImageUrl() {
    if (state.imageUrl && state.imageUrl.indexOf('blob:') === 0) {
      try { URL.revokeObjectURL(state.imageUrl); } catch (_) { /* */ }
    }
    state.imageUrl = null;
  }

  function showWorkspaceUrl(url) {
    revokeImageUrl();
    state.imageUrl = url;
    el.img.onload = () => {
      el.empty.hidden = true;
      el.box.hidden = false;
      syncOverlaySize();
      updateStageWarnings();
      updateSourceMetaLine();
      renderOverlay();
      persist();
      syncPanelFromDoc();
    };
    el.img.src = url;
  }

  /** Letterbox / contain source into white 3000×3000 — style units stay consistent. */
  function buildWorkspaceBitmap(img) {
    const size = WORKSPACE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('workspace encode failed'));
        else resolve(blob);
      }, 'image/png');
    });
  }

  function inferShotCodeFromFileName(name) {
    const n = String(name || '');
    const m = n.match(/_(\d{2})_([A-Za-z0-9-]+)\./);
    if (m) return { seq: m[1], code: m[2] };
    if (/_MAIN\./i.test(n)) return { seq: '', code: 'MAIN' };
    return null;
  }

  async function loadImageFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const tempUrl = URL.createObjectURL(file);
    try {
      const img = await loadHtmlImage(tempUrl);
      const ow = img.naturalWidth;
      const oh = img.naturalHeight;
      const inferred = inferShotCodeFromFileName(file.name);
      const src = state.doc.sourceImage || createEmptySourceImage();
      src.fileName = file.name || '';
      src.originalWidth = ow;
      src.originalHeight = oh;
      src.isSquare = ow > 0 && ow === oh;
      src.needsUpscale = Math.min(ow, oh) < WORKSPACE_SIZE;
      src.workspaceSize = WORKSPACE_SIZE;
      if (inferred && inferred.code) {
        src.kind = 'shot';
        src.shotCode = inferred.code;
        if (inferred.seq) state.doc.seq = inferred.seq;
      } else if (!src.kind) {
        src.kind = 'custom';
      }
      state.doc.sourceImage = src;

      const workspaceBlob = await buildWorkspaceBitmap(img);
      showWorkspaceUrl(URL.createObjectURL(workspaceBlob));
    } catch (err) {
      alert('Could not load image: ' + (err && err.message ? err.message : err));
    } finally {
      try { URL.revokeObjectURL(tempUrl); } catch (_) { /* */ }
    }
  }

  function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unreadable image'));
      img.src = url;
    });
  }

  el.fileImage.addEventListener('change', () => {
    const f = el.fileImage.files && el.fileImage.files[0];
    if (f) loadImageFile(f);
    el.fileImage.value = '';
  });

  ;['dragenter', 'dragover'].forEach((type) => {
    el.stage.addEventListener(type, (e) => {
      e.preventDefault();
      el.stage.classList.add('is-dragover');
    });
  });
  ;['dragleave', 'drop'].forEach((type) => {
    el.stage.addEventListener(type, (e) => {
      e.preventDefault();
      el.stage.classList.remove('is-dragover');
    });
  });
  el.stage.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImageFile(f);
  });

  window.addEventListener('resize', () => {
    if (!state.imageUrl) return;
    syncOverlaySize();
    renderOverlay();
  });

  /* ---------- Panel events ---------- */

  function onFieldChange() {
    readPanelIntoDoc();
    persist();
    syncPanelFromDoc();
    renderOverlay();
  }

  el.ean.addEventListener('change', () => {
    const ean = String(el.ean.value || '').trim();
    if (ean && loadDraftForEan(ean)) {
      syncPanelFromDoc();
      renderOverlay();
      return;
    }
    onFieldChange();
  });
  ;[el.seq, el.size, el.dimensions, el.weight, el.capacity, el.shotCode].forEach((node) => {
    node.addEventListener('change', onFieldChange);
  });
  el.imageKind.addEventListener('change', () => {
    el.wrapShotCode.style.display = el.imageKind.value === 'shot' ? '' : 'none';
    onFieldChange();
    updateSourceMetaLine();
  });
  ;[el.styleFont, el.styleFontSize, el.styleStroke, el.styleOffset, el.styleHead].forEach((node) => {
    node.addEventListener('change', onFieldChange);
    node.addEventListener('input', () => {
      readPanelIntoDoc();
      renderOverlay();
    });
  });

  el.btnRebuild.addEventListener('click', () => {
    readPanelIntoDoc();
    rebuildArrowsFromRaw(true);
    state.selectedId = state.doc.arrows[0] ? state.doc.arrows[0].id : null;
    persist();
    syncPanelFromDoc();
    renderOverlay();
  });

  el.selLabel.addEventListener('input', () => {
    const a = findArrow(state.selectedId);
    if (!a) return;
    a.label = el.selLabel.value;
    persist();
    syncPanelFromDoc();
    renderOverlay();
  });

  function setSelectedRotation(raw, shiftHeld) {
    const a = findArrow(state.selectedId);
    if (!a) return;
    a.rotation = applyRotationRules(Number(raw), !!shiftHeld);
    persist();
    syncPanelFromDoc();
    renderOverlay();
  }

  el.selRotation.addEventListener('change', (e) => setSelectedRotation(el.selRotation.value, e.shiftKey));
  el.selRotation.addEventListener('input', (e) => {
    const a = findArrow(state.selectedId);
    if (!a) return;
    a.rotation = applyRotationRules(Number(el.selRotation.value), e.shiftKey);
    renderOverlay();
    el.jsonPreview.value = JSON.stringify(state.doc, null, 2);
  });

  el.selLength.addEventListener('change', () => {
    const a = findArrow(state.selectedId);
    if (!a) return;
    a.length = clamp(Number(el.selLength.value) || 0.1, 0.04, 1.2);
    persist();
    syncPanelFromDoc();
    renderOverlay();
  });

  /* ---------- JSON load / save ---------- */

  el.btnSaveJson.addEventListener('click', () => {
    persist();
    const blob = new Blob([JSON.stringify(state.doc, null, 2)], { type: 'application/json' });
    const name = (state.doc.ean || 'mdim') + '_' + (state.doc.seq || '05') + '_M-DIM.json';
    downloadBlob(blob, name);
  });

  el.btnLoadJson.addEventListener('click', () => el.fileJson.click());
  el.fileJson.addEventListener('change', async () => {
    const f = el.fileJson.files && el.fileJson.files[0];
    el.fileJson.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      state.doc = normalizeDoc(JSON.parse(text));
      state.selectedId = state.doc.arrows[0] ? state.doc.arrows[0].id : null;
      persist();
      syncPanelFromDoc();
      renderOverlay();
    } catch (err) {
      alert('Could not load JSON: ' + (err && err.message ? err.message : err));
    }
  });

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- PNG metadata (write / read) ---------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function latin1(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      out[i] = code < 256 ? code : 63;
    }
    return out;
  }

  function pngChunk(type, data) {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(latin1(type), 4);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
  }

  function textChunk(key, value) {
    return pngChunk('tEXt', new Uint8Array([...latin1(key), 0, ...latin1(value)]));
  }

  function itxtChunk(key, text) {
    return pngChunk('iTXt', new Uint8Array([...latin1(key), 0, 0, 0, 0, 0, ...new TextEncoder().encode(text)]));
  }

  function xmlEscape(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function localIsoWithOffset(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
    );
  }

  function buildXmp(fields) {
    const x = (v) => xmlEscape(v || '');
    return '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/">' +
      '<dc:creator><rdf:Seq><rdf:li>' + x(fields.Author) + '</rdf:li></rdf:Seq></dc:creator>' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + x(fields.Title) + '</rdf:li></rdf:Alt></dc:title>' +
      '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">' + x(fields.Description) + '</rdf:li></rdf:Alt></dc:description>' +
      '<exif:UserComment><rdf:Alt><rdf:li xml:lang="x-default">' + x(fields.Description) + '</rdf:li></rdf:Alt></exif:UserComment>' +
      '<xmp:CreatorTool>' + x(fields.Software) + '</xmp:CreatorTool>' +
      '<xmp:CreateDate>' + x(fields['Creation Time']) + '</xmp:CreateDate>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  }

  async function addPngText(blob, fields) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] !== 137 || bytes[1] !== 80) throw new Error('Not a PNG');
    const ihdrEnd = 8 + 4 + 4 + 13 + 4;
    const chunks = Object.entries(fields)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => {
        // Long JSON → iTXt UTF-8; short latin1 → tEXt
        if (k === 'MdimJson' || String(v).length > 200 || /[^\x00-\xFF]/.test(String(v))) {
          return itxtChunk(k, String(v));
        }
        return textChunk(k, String(v));
      });
    chunks.push(itxtChunk('XML:com.adobe.xmp', buildXmp(fields)));
    const extra = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(bytes.length + extra);
    out.set(bytes.subarray(0, ihdrEnd), 0);
    let offset = ihdrEnd;
    chunks.forEach((c) => { out.set(c, offset); offset += c.length; });
    out.set(bytes.subarray(ihdrEnd), offset);
    return new Blob([out], { type: 'image/png' });
  }

  function readPngTextChunks(bytes) {
    const out = {};
    if (bytes.length < 8 || bytes[0] !== 137) return out;
    let i = 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (i + 12 <= bytes.length) {
      const len = view.getUint32(i);
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      const dataStart = i + 8;
      const dataEnd = dataStart + len;
      if (dataEnd + 4 > bytes.length) break;
      if (type === 'tEXt') {
        const data = bytes.subarray(dataStart, dataEnd);
        let z = 0;
        while (z < data.length && data[z] !== 0) z++;
        const key = String.fromCharCode.apply(null, data.subarray(0, z));
        let val = '';
        for (let p = z + 1; p < data.length; p++) val += String.fromCharCode(data[p]);
        out[key] = val;
      } else if (type === 'iTXt') {
        const data = bytes.subarray(dataStart, dataEnd);
        let z = 0;
        while (z < data.length && data[z] !== 0) z++;
        const key = String.fromCharCode.apply(null, data.subarray(0, z));
        const compFlag = data[z + 1];
        // skip comp method, language, translated keyword
        let p = z + 3;
        while (p < data.length && data[p] !== 0) p++;
        p++;
        while (p < data.length && data[p] !== 0) p++;
        p++;
        if (compFlag === 0) {
          out[key] = new TextDecoder('utf-8').decode(data.subarray(p));
        }
      } else if (type === 'IEND') {
        break;
      }
      i = dataEnd + 4;
    }
    return out;
  }

  /* ---------- Export burn-in ---------- */

  function drawArrowOnCanvas(ctx, arrow) {
    const style = state.doc.style;
    const w = WORKSPACE_SIZE;
    const h = WORKSPACE_SIZE;
    const cx = arrow.cx * w;
    const cy = arrow.cy * h;
    const lengthPx = Math.max(20, arrow.length * w);
    const rot = normalizeDeg(arrow.rotation);
    const rad = (rot * Math.PI) / 180;
    const head = Number(style.arrowHead) || DEFAULT_STYLE.arrowHead;
    const sw = Number(style.strokeWidth) || DEFAULT_STYLE.strokeWidth;
    const textOff = Number(style.textOffset) || DEFAULT_STYLE.textOffset;
    const half = lengthPx / 2;
    const x1 = cx - Math.cos(rad) * half;
    const y1 = cy - Math.sin(rad) * half;
    const x2 = cx + Math.cos(rad) * half;
    const y2 = cy + Math.sin(rad) * half;
    const shaftHalf = Math.max(0, half - head * 0.85);
    const sx1 = cx - Math.cos(rad) * shaftHalf;
    const sy1 = cy - Math.sin(rad) * shaftHalf;
    const sx2 = cx + Math.cos(rad) * shaftHalf;
    const sy2 = cy + Math.sin(rad) * shaftHalf;

    ctx.save();
    ctx.strokeStyle = style.stroke || '#000';
    ctx.fillStyle = style.stroke || '#000';
    ctx.lineWidth = sw;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();
    drawHeadCanvas(ctx, x1, y1, rad + Math.PI, head);
    drawHeadCanvas(ctx, x2, y2, rad, head);

    const { angle: textAngle, flip } = readableTextAngle(rot);
    const side = flip ? 1 : -1;
    const tx = cx + Math.cos(rad + Math.PI / 2) * textOff * side;
    const ty = cy + Math.sin(rad + Math.PI / 2) * textOff * side;
    const fontPx = style.fontSize || DEFAULT_STYLE.fontSize;
    ctx.font = '700 ' + fontPx + 'px ' + styleFontCss();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(tx, ty);
    ctx.rotate((textAngle * Math.PI) / 180);
    ctx.fillStyle = style.textColor || '#000';
    ctx.fillText(arrow.label || '', 0, 0);
    ctx.restore();
  }

  function drawHeadCanvas(ctx, tipX, tipY, pointingRad, size) {
    const back = size;
    const halfW = size * 0.55;
    const bx = tipX - Math.cos(pointingRad) * back;
    const by = tipY - Math.sin(pointingRad) * back;
    const px = Math.cos(pointingRad + Math.PI / 2) * halfW;
    const py = Math.sin(pointingRad + Math.PI / 2) * halfW;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(bx + px, by + py);
    ctx.lineTo(bx - px, by - py);
    ctx.closePath();
    ctx.fill();
  }

  async function exportPng() {
    persist();
    if (!state.imageUrl || !el.img.naturalWidth) {
      alert('Load a base image first.');
      return;
    }
    if (!state.doc.ean || state.doc.ean.length !== 13) {
      if (!confirm('EAN is not 13 digits. Export anyway?')) return;
    }
    const src = state.doc.sourceImage || {};
    if (src.needsUpscale) {
      if (!confirm('Source was below 3000px. Export will use the fitted 3000×3000 workspace (preview upscale, not Firefly). Continue?')) {
        return;
      }
    }
    if (src.originalWidth && !src.isSquare) {
      if (!confirm('Source is not 1:1. Export is 3000×3000 with white margins. Continue?')) {
        return;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = WORKSPACE_SIZE;
    canvas.height = WORKSPACE_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(el.img, 0, 0, WORKSPACE_SIZE, WORKSPACE_SIZE);
    (state.doc.arrows || []).forEach((a) => {
      if (a.visible === false) return;
      drawArrowOnCanvas(ctx, a);
    });

    const rawBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!rawBlob) {
      alert('PNG encode failed.');
      return;
    }

    const title = (state.doc.ean || 'EAN') + '_' + (state.doc.seq || '05') + '_M-DIM';
    // Marketplace output only — no MdimJson in this file. Edit state stays in JSON / later Prompt DB.
    const fields = {
      Author: localStorage.getItem('imageRenamer.author') || 'M-DIM Editor',
      Title: title,
      Description: 'M-DIM · ' + (state.doc.arrows || []).map((a) => a.label).join(' · '),
      Software: '3D Playground M-DIM Editor (Test ' + APP_VERSION + ')',
      'Creation Time': localIsoWithOffset(new Date())
    };

    const finalBlob = await addPngText(rawBlob, fields);
    downloadBlob(finalBlob, title + '.png');
  }

  el.btnExport.addEventListener('click', () => {
    exportPng().catch((err) => alert('Export failed: ' + (err && err.message ? err.message : err)));
  });

  /* ---------- Boot ---------- */

  syncPanelFromDoc();
})();
