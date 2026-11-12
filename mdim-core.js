/*! M-DIM shared core — used by standalone mdim-editor and 3D Playground Product Replacement */
(function (global) {
  'use strict';

  const WORKSPACE_SIZE = 3000;
  const MAX_ARROWS = 8;
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

  function normalizeDeg(d) {
    let x = Number(d) || 0;
    x = x % 360;
    if (x < 0) x += 360;
    if (Math.abs(x - 360) < 1e-9) x = 0;
    return x;
  }

  function applyRotationRules(deg, shiftHeld) {
    let r = normalizeDeg(deg);
    if (!shiftHeld) return r;
    const snaps = [0, 90, 180, 270, 360];
    let best = 0;
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
    let r = normalizeDeg(rotationDeg);
    let flip = false;
    if (r > 90 && r < 270) {
      r = normalizeDeg(r + 180);
      flip = true;
    }
    return { angle: r, flip };
  }

  function isEmptyMeasure(s) {
    return !s || /^(0+(\.0+)?|-+|–|n\.?a\.?|nil|none|null|#n\/a)$/i.test(s);
  }

  function normUnit(u) {
    const x = String(u || '').toLowerCase();
    if (/^(ltr|litres?|liters?)$/.test(x)) return 'l';
    if (/^grams?$/.test(x)) return 'g';
    return x;
  }

  function isVolumeLabel(lab) {
    return /\b(ml|l)\b/i.test(String(lab || ''));
  }

  function isWeightLabel(lab) {
    return /\b(kg|g)\b/i.test(String(lab || ''));
  }

  function parseMeasureField(raw, fallbackUnit) {
    let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (isEmptyMeasure(s)) return [];
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
    const slashParts = s.split(/\s*\/\s*/);
    const labels = [];
    slashParts.forEach((part, idx) => {
      const p = part.trim();
      if (!p) return;
      const fb = idx === 0 ? fallbackUnit : 'ml';
      parseDimensionOrVolumePart(p, fb).forEach((lab) => labels.push(lab));
    });
    return labels;
  }

  function parseDimensionOrVolumePart(raw, fallbackUnit) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    const UNIT = 'ml|cm|mm|kg|grams?|g|ltr|litres?|liters?|l|m';
    s = s.replace(/\s*[xX×*]\s*(cm|mm|m)\b/gi, ' $1 x ');
    s = s.replace(new RegExp('(\\d)\\s*(' + UNIT + ')\\b', 'gi'), '$1 $2');
    const endUnitMatch = s.match(new RegExp('\\b(' + UNIT + ')\\s*$', 'i'));
    const endUnit = endUnitMatch ? normUnit(endUnitMatch[1]) : '';
    const core = endUnitMatch ? s.slice(0, endUnitMatch.index).trim() : s;
    if (/[xX×*]/.test(core) && !new RegExp('\\b(' + UNIT + ')\\b', 'i').test(core.replace(/\s*[xX×*]\s*/g, ' '))) {
      const unit = endUnit || normUnit(fallbackUnit) || '';
      return core
        .split(/\s*[xX×*]\s*/)
        .map((p) => p.replace(/[^\d.,]/g, '').replace(',', '.'))
        .filter((n) => n && /\d/.test(n))
        .map((n) => (unit ? n + ' ' + unit : n));
    }
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

  /**
   * Collect labels from Shoot Tracker fields.
   * If 3+ linear dims + volume: omit volume by default (still returned in omittedVolume).
   */
  function collectLabelsFromFields(fields, opts) {
    opts = opts || {};
    const includeVolume = !!opts.includeVolume;
    const size = parseMeasureField(fields.productSize, 'cm');
    const dimsRaw = String(fields.productDimensions || '').trim();
    const sizeRaw = String(fields.productSize || '').trim();
    const dims = dimsRaw && dimsRaw.toLowerCase() !== sizeRaw.toLowerCase()
      ? parseMeasureField(fields.productDimensions, 'cm')
      : [];
    const weight = parseMeasureField(fields.productWeightKg, 'kg').map((v) =>
      /\b(kg|g)\b/i.test(v) ? v : v + ' kg'
    );
    const capacity = parseMeasureField(fields.productCapacity, 'ml');
    const all = dedupeLabels(size.concat(dims, weight, capacity));
    const linear = all.filter((l) => !isVolumeLabel(l));
    const volumes = all.filter((l) => isVolumeLabel(l));
    let active = all.slice();
    let omittedVolume = [];
    if (!includeVolume && linear.filter((l) => !isWeightLabel(l)).length >= 3 && volumes.length) {
      active = linear.slice();
      omittedVolume = volumes.slice();
    }
    return {
      labels: active.slice(0, MAX_ARROWS),
      omittedVolume: omittedVolume,
      allLabels: all
    };
  }

  /** Default poses: L×B×H → bottom L, angled B (flipped), right-side H (flipped). */
  function defaultArrowLayout(count, labels) {
    const labs = labels || [];
    if (count <= 1) {
      return [{ cx: 0.84, cy: 0.5, length: 0.38, rotation: 90, textSide: -1 }];
    }
    if (count === 2) {
      return [
        { cx: 0.5, cy: 0.84, length: 0.42, rotation: 0, textSide: 1 },
        { cx: 0.84, cy: 0.48, length: 0.4, rotation: 90, textSide: -1 }
      ];
    }
    // 3+: L bottom, B angled + flip, H right vertical + flip
    const presets = [
      { cx: 0.52, cy: 0.86, length: 0.44, rotation: 0, textSide: 1 },
      { cx: 0.30, cy: 0.70, length: 0.34, rotation: 148, textSide: -1 },
      { cx: 0.84, cy: 0.48, length: 0.44, rotation: 90, textSide: -1 },
      { cx: 0.16, cy: 0.45, length: 0.32, rotation: 90, textSide: 1 },
      { cx: 0.5, cy: 0.18, length: 0.28, rotation: 0, textSide: 1 },
      { cx: 0.3, cy: 0.65, length: 0.26, rotation: 140, textSide: -1 },
      { cx: 0.7, cy: 0.65, length: 0.26, rotation: 40, textSide: 1 },
      { cx: 0.5, cy: 0.5, length: 0.28, rotation: 0, textSide: 1 }
    ];
    const layout = presets.slice(0, count);
    const volIdx = labs.findIndex(isVolumeLabel);
    if (volIdx >= 0 && layout[volIdx]) {
      layout[volIdx] = { cx: 0.84, cy: 0.5, length: 0.36, rotation: 90, textSide: -1 };
    }
    return layout;
  }

  function buildArrowsFromLabels(labels, prev, keepPositions) {
    const layout = defaultArrowLayout(labels.length, labels);
    return labels.map((label, i) => {
      const id = 'arrow-' + (i + 1);
      const old = keepPositions && prev && prev[i] ? prev[i] : null;
      const base = layout[i] || layout[layout.length - 1];
      return {
        id,
        label,
        cx: old ? old.cx : base.cx,
        cy: old ? old.cy : base.cy,
        length: old ? old.length : base.length,
        rotation: old ? old.rotation : base.rotation,
        textSide: old && old.textSide != null
          ? old.textSide
          : (base.textSide != null ? base.textSide : 1),
        visible: true
      };
    });
  }

  function detectSourceFromFileName(fileName, ean) {
    const n = String(fileName || '');
    const e = String(ean || '').replace(/\D/g, '');
    const m = n.match(/(\d{13})_(\d{2})_([A-Za-z0-9-]+)/i);
    if (m && (!e || m[1] === e)) {
      return { kind: 'shot', shotCode: m[3], shotSeq: m[2], fileName: n, ean: m[1] };
    }
    if (/(\d{13})_MAIN\b/i.test(n)) {
      const em = n.match(/(\d{13})_MAIN/i);
      return { kind: 'shot', shotCode: 'MAIN', shotSeq: '', fileName: n, ean: em ? em[1] : e };
    }
    return { kind: 'custom', shotCode: '', shotSeq: '', fileName: n, ean: e || '' };
  }

  function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unreadable image'));
      img.src = url;
    });
  }

  /**
   * Fit source into a white square. Editor uses 3000 (JPEG). Apply-to-export uses native max side
   * so Upscale & generate can Firefly later like other shots.
   */
  async function buildWorkspaceBitmap(imgOrUrl, opts) {
    opts = opts || {};
    const img = typeof imgOrUrl === 'string' ? await loadHtmlImage(imgOrUrl) : imgOrUrl;
    const size = Math.max(1, Math.round(Number(opts.size) || WORKSPACE_SIZE));
    const mime = opts.mime || 'image/jpeg';
    const quality = opts.quality != null ? opts.quality : 0.92;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    const blob = await new Promise((resolve, reject) => {
      const done = (b) => (b ? resolve(b) : reject(new Error('workspace encode failed')));
      if (mime === 'image/jpeg') canvas.toBlob(done, mime, quality);
      else canvas.toBlob(done, mime);
    });
    return {
      blob,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      isSquare: img.naturalWidth > 0 && img.naturalWidth === img.naturalHeight,
      needsUpscale: Math.min(img.naturalWidth, img.naturalHeight) < WORKSPACE_SIZE,
      workspaceSize: size
    };
  }

  function arrowPixels(arrow, displayW, displayH) {
    const w = displayW || WORKSPACE_SIZE;
    const h = displayH || WORKSPACE_SIZE;
    const cx = arrow.cx * w;
    const cy = arrow.cy * h;
    const lengthPx = Math.max(20, arrow.length * w);
    const rot = normalizeDeg(arrow.rotation);
    const rad = (rot * Math.PI) / 180;
    const half = lengthPx / 2;
    return {
      cx, cy, lengthPx, rot, rad,
      x1: cx - Math.cos(rad) * half,
      y1: cy - Math.sin(rad) * half,
      x2: cx + Math.cos(rad) * half,
      y2: cy + Math.sin(rad) * half
    };
  }

  function makeHead(ns, tipX, tipY, pointingRad, size, fill) {
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
    poly.setAttribute('pointer-events', 'none');
    return poly;
  }

  function styleFontCss(style) {
    const s = style || DEFAULT_STYLE;
    return s.fontFamily || ('"' + (s.fontName || 'Times New Roman') + '", Times, serif');
  }

  function renderArrowsSvg(svg, arrows, style, displayW, displayH, selectedId) {
    const ns = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + displayW + ' ' + displayH);
    svg.setAttribute('width', String(displayW));
    svg.setAttribute('height', String(displayH));
    const st = Object.assign({}, DEFAULT_STYLE, style || {});
    const scale = displayW / WORKSPACE_SIZE;

    (arrows || []).forEach((arrow) => {
      if (arrow.visible === false) return;
      const g = document.createElementNS(ns, 'g');
      g.classList.add('mdim-arrow');
      g.dataset.id = arrow.id;
      if (arrow.id === selectedId) g.classList.add('is-selected');
      const geo = arrowPixels(arrow, displayW, displayH);
      const head = (Number(st.arrowHead) || DEFAULT_STYLE.arrowHead) * scale;
      const sw = (Number(st.strokeWidth) || DEFAULT_STYLE.strokeWidth) * scale;
      const textOff = DEFAULT_STYLE.textOffset; // always 50
      // Keep text upright when rotating. Flip button moves side AND reverses reading direction
      // (same visual effect as rotating past the upright threshold).
      const { angle: uprightAngle } = readableTextAngle(geo.rot);
      const sideSign = arrow.textSide != null ? Number(arrow.textSide) : 1;
      const textAngle = sideSign < 0 ? normalizeDeg(uprightAngle + 180) : uprightAngle;

      const shaftHalf = Math.max(0, geo.lengthPx / 2 - head * 0.85);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', geo.cx - Math.cos(geo.rad) * shaftHalf);
      line.setAttribute('y1', geo.cy - Math.sin(geo.rad) * shaftHalf);
      line.setAttribute('x2', geo.cx + Math.cos(geo.rad) * shaftHalf);
      line.setAttribute('y2', geo.cy + Math.sin(geo.rad) * shaftHalf);
      line.setAttribute('stroke', st.stroke || '#000');
      line.setAttribute('stroke-width', String(sw));
      line.setAttribute('pointer-events', 'none');
      g.appendChild(line);

      const hit = document.createElementNS(ns, 'line');
      hit.setAttribute('x1', geo.x1);
      hit.setAttribute('y1', geo.y1);
      hit.setAttribute('x2', geo.x2);
      hit.setAttribute('y2', geo.y2);
      hit.classList.add('mdim-hit');
      hit.dataset.role = 'move';
      g.appendChild(hit);

      const inset = Math.max(head * 0.55, 10);
      const halfLen = Math.max(0, geo.lengthPx / 2 - inset);
      [[-1, 'end1'], [1, 'end2']].forEach(([dir, role]) => {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', geo.cx + Math.cos(geo.rad) * halfLen * dir);
        c.setAttribute('cy', geo.cy + Math.sin(geo.rad) * halfLen * dir);
        c.setAttribute('r', Math.max(12, head * 0.45));
        c.classList.add('mdim-end');
        c.dataset.role = role;
        g.appendChild(c);
      });

      g.appendChild(makeHead(ns, geo.x1, geo.y1, geo.rad + Math.PI, head, st.stroke || '#000'));
      g.appendChild(makeHead(ns, geo.x2, geo.y2, geo.rad, head, st.stroke || '#000'));

      const label = document.createElementNS(ns, 'text');
      label.textContent = arrow.label || '';
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('fill', st.textColor || '#000');
      label.setAttribute('font-family', styleFontCss(st));
      label.setAttribute('font-size', String((st.fontSize || DEFAULT_STYLE.fontSize) * scale));
      label.setAttribute('font-weight', '700');
      label.setAttribute('pointer-events', 'none');
      const tx = geo.cx + Math.cos(geo.rad + Math.PI / 2) * textOff * scale * sideSign;
      const ty = geo.cy + Math.sin(geo.rad + Math.PI / 2) * textOff * scale * sideSign;
      label.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') rotate(' + textAngle + ')');
      g.appendChild(label);

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

  function drawArrowOnCanvas(ctx, arrow, style, canvasSize) {
    const st = Object.assign({}, DEFAULT_STYLE, style || {});
    const w = canvasSize || WORKSPACE_SIZE;
    const h = canvasSize || WORKSPACE_SIZE;
    const scale = w / WORKSPACE_SIZE;
    const geo = arrowPixels(arrow, w, h);
    const head = (Number(st.arrowHead) || DEFAULT_STYLE.arrowHead) * scale;
    const sw = (Number(st.strokeWidth) || DEFAULT_STYLE.strokeWidth) * scale;
    const textOff = DEFAULT_STYLE.textOffset * scale; // always 50
    const shaftHalf = Math.max(0, geo.lengthPx / 2 - head * 0.85);

    ctx.save();
    ctx.strokeStyle = st.stroke || '#000';
    ctx.fillStyle = st.stroke || '#000';
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.moveTo(geo.cx - Math.cos(geo.rad) * shaftHalf, geo.cy - Math.sin(geo.rad) * shaftHalf);
    ctx.lineTo(geo.cx + Math.cos(geo.rad) * shaftHalf, geo.cy + Math.sin(geo.rad) * shaftHalf);
    ctx.stroke();

    function headAt(tipX, tipY, pointingRad) {
      const back = head;
      const halfW = head * 0.55;
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
    headAt(geo.x1, geo.y1, geo.rad + Math.PI);
    headAt(geo.x2, geo.y2, geo.rad);

    const { angle: uprightAngle } = readableTextAngle(geo.rot);
    const sideSign = arrow.textSide != null ? Number(arrow.textSide) : 1;
    const textAngle = sideSign < 0 ? normalizeDeg(uprightAngle + 180) : uprightAngle;
    const tx = geo.cx + Math.cos(geo.rad + Math.PI / 2) * textOff * sideSign;
    const ty = geo.cy + Math.sin(geo.rad + Math.PI / 2) * textOff * sideSign;
    ctx.font = '700 ' + ((st.fontSize || DEFAULT_STYLE.fontSize) * scale) + 'px ' + styleFontCss(st);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(tx, ty);
    ctx.rotate((textAngle * Math.PI) / 180);
    ctx.fillStyle = st.textColor || '#000';
    ctx.fillText(arrow.label || '', 0, 0);
    ctx.restore();
  }

  async function exportMergedPng(workspaceImg, arrows, style) {
    const size = Math.max(
      1,
      workspaceImg.naturalWidth || workspaceImg.width || WORKSPACE_SIZE
    );
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(workspaceImg, 0, 0, size, size);
    (arrows || []).forEach((a) => {
      if (a.visible === false) return;
      drawArrowOnCanvas(ctx, a, style, size);
    });
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function emptyDoc() {
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
      sourceImage: {
        kind: 'custom',
        shotCode: '',
        shotSeq: '',
        fileName: '',
        originalWidth: 0,
        originalHeight: 0,
        isSquare: true,
        needsUpscale: false,
        workspaceSize: WORKSPACE_SIZE,
        baseShotIndex: null
      },
      omittedVolume: [],
      arrows: [],
      style: Object.assign({}, DEFAULT_STYLE, { textOffset: 50 })
    };
  }

  global.MdimCore = {
    WORKSPACE_SIZE,
    MAX_ARROWS,
    DEFAULT_STYLE,
    normalizeDeg,
    applyRotationRules,
    readableTextAngle,
    parseMeasureField,
    collectLabelsFromFields,
    isVolumeLabel,
    isWeightLabel,
    defaultArrowLayout,
    buildArrowsFromLabels,
    detectSourceFromFileName,
    loadHtmlImage,
    buildWorkspaceBitmap,
    arrowPixels,
    renderArrowsSvg,
    drawArrowOnCanvas,
    exportMergedPng,
    emptyDoc,
    styleFontCss
  };
})(typeof window !== 'undefined' ? window : globalThis);
