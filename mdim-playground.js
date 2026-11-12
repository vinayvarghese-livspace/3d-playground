/*! M-DIM UI for Product Replacement (wr-main). Depends on MdimCore + host callbacks. */
(function (global) {
  'use strict';

  const C = () => global.MdimCore;
  if (!C) {
    console.warn('MdimPlayground: MdimCore missing');
  }

  let host = null;
  let live = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureDraft(ws, t) {
    const Core = C();
    const LAYOUT_VERSION = global.MdimPlayground && global.MdimPlayground.LAYOUT_VERSION
      ? global.MdimPlayground.LAYOUT_VERSION
      : 3; // L bottom · B angled+flip · H right+flip
    if (!ws.mdimDraft) {
      const doc = Core.emptyDoc();
      doc.ean = String((t && t.ean) || ws.ean || '');
      doc.sourceFields = {
        productSize: String((t && t.size) || ''),
        productDimensions: String((t && t.dimensions) || ''),
        productWeightKg: String((t && t.weight) || ''),
        productCapacity: String((t && t.capacity) || '')
      };
      const packed = Core.collectLabelsFromFields(doc.sourceFields, { includeVolume: false });
      doc.omittedVolume = packed.omittedVolume.slice();
      doc.arrows = Core.buildArrowsFromLabels(packed.labels, [], false);
      doc.layoutVersion = LAYOUT_VERSION;
      doc.style = Object.assign({}, Core.DEFAULT_STYLE, doc.style || {}, { textOffset: 50 });
      ws.mdimDraft = doc;
    } else {
      // Refresh EAN fields from task if empty arrows never built
      ws.mdimDraft.ean = String((t && t.ean) || ws.mdimDraft.ean || '');
      ws.mdimDraft.sourceFields = {
        productSize: String((t && t.size) || ''),
        productDimensions: String((t && t.dimensions) || ''),
        productWeightKg: String((t && t.weight) || ''),
        productCapacity: String((t && t.capacity) || '')
      };
      if (ws.mdimDraft.layoutVersion !== LAYOUT_VERSION) {
        const packed = Core.collectLabelsFromFields(ws.mdimDraft.sourceFields, { includeVolume: false });
        ws.mdimDraft.omittedVolume = packed.omittedVolume.slice();
        ws.mdimDraft.arrows = Core.buildArrowsFromLabels(packed.labels, [], false);
        ws.mdimDraft.layoutVersion = LAYOUT_VERSION;
      }
      ws.mdimDraft.style = Object.assign({}, Core.DEFAULT_STYLE, ws.mdimDraft.style || {}, { textOffset: 50 });
    }
    return ws.mdimDraft;
  }

  function mainHtml(ctx) {
    const Core = C();
    const draft = ensureDraft(ctx.workspace, ctx.task);
    const bases = ctx.baseOptions || [];
    const warn = [];
    const src = draft.sourceImage || {};
    if (src.originalWidth && !src.isSquare) {
      warn.push('Source ' + src.originalWidth + '×' + src.originalHeight + ' is not 1:1 — fitted into 3000×3000 with white margins.');
    }
    if (src.needsUpscale) {
      warn.push('Source below 3000px. Editor uses a fitted 3000 preview. Apply burns at native size; Firefly upscale runs with Upscale & generate images.');
    }

    const flipIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 8l3-3M7 8l3 3M17 16H7M17 16l-3-3M17 16l-3 3"/></svg>';
    const xIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';

    const arrowCards = (draft.arrows || []).map((a, idx) => {
      return '<div class="mdim-label-card' + (live && live.selectedId === a.id ? ' is-active' : '') + '" data-mdim-arrow="' + esc(a.id) + '">' +
        '<div class="mdim-label-row">' +
          '<span class="mdim-label-idx">' + (idx + 1) + '</span>' +
          '<input type="text" class="mdim-label-input" data-mdim-label="' + esc(a.id) + '" value="' + esc(a.label) + '">' +
          '<button type="button" class="mdim-icon-btn' + (Number(a.textSide) < 0 ? ' is-on' : '') +
            '" data-mdim-flip-btn="' + esc(a.id) + '" title="Flip text side" aria-label="Flip text side">' + flipIcon + '</button>' +
          '<button type="button" class="mdim-icon-btn mdim-icon-danger" data-mdim-remove="' + esc(a.id) +
            '" title="Remove" aria-label="Remove">' + xIcon + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    const omitted = (draft.omittedVolume || []);
    const addVol = omitted.length
      ? '<button type="button" class="tp-btn tp-btn-ghost mdim-add-vol" data-mdim="add-volume">+ Add volume (' +
          esc(omitted.join(', ')) + ')</button>'
      : '';

    const shotBases = (bases || []).filter((b) => String(b.value) !== '__custom__');
    const baseOpts = shotBases.map((b) =>
      '<option value="' + esc(String(b.value)) + '"' +
        (String(b.value) === String(ctx.selectedBase || '') ? ' selected' : '') + '>' +
        esc(b.label) + '</option>'
    ).join('');
    const maxIcon = ctx.mainMax
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9H4v5M15 15h5v-5M4 9l5 5M20 15l-5-5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>';
    const hasOverride = !!ctx.hasOverride;

    return '' +
      '<div class="mdim-workbench" data-mdim-root>' +
        '<div class="mdim-toolbar">' +
          '<label class="mdim-base-pick">Base image ' +
            '<select data-mdim-base>' +
              '<option value="">— Select generated shot —</option>' +
              baseOpts +
              (hasOverride
                ? '<option value="__override__" selected>Override (dropped)</option>'
                : '') +
              '<option value="__custom__"' + (ctx.selectedBase === '__custom__' ? ' selected' : '') + '>Custom</option>' +
            '</select>' +
          '</label>' +
          (hasOverride
            ? '<button type="button" class="wr-text-btn" data-mdim="clear-override">Clear override</button>'
            : '') +
          '<button type="button" class="wr-icon-btn" data-mdim="toggle-main-max" title="' +
            (ctx.mainMax ? 'Exit large editor' : 'Enlarge Product Dimension') +
            '" aria-label="' + (ctx.mainMax ? 'Exit large editor' : 'Enlarge Product Dimension') + '">' +
            maxIcon +
          '</button>' +
          '<button type="button" class="tp-btn tp-btn-primary mdim-apply-btn" data-mdim="apply-export">Apply to export</button>' +
        '</div>' +
        (warn.length
          ? '<div class="mdim-warns">' + warn.map((w) => '<div class="mdim-warn">' + esc(w) + '</div>').join('') + '</div>'
          : '') +
        '<div class="mdim-body">' +
          '<div class="mdim-stage-wrap">' +
            '<div class="mdim-stage' + (ctx.hasWorkspace ? '' : ' is-empty') +
              (hasOverride ? ' has-override' : '') +
              '" data-mdim-stage data-ws-drop="mdim-base">' +
              (ctx.hasWorkspace
                ? '<div class="mdim-canvas-box">' +
                    '<img data-mdim-img alt="M-DIM base" draggable="false">' +
                    '<svg data-mdim-svg class="mdim-overlay" xmlns="http://www.w3.org/2000/svg"></svg>' +
                  '</div>'
                : '<div class="mdim-empty">Select a base, choose Custom for A·B·C·D, or drop an image here to override.</div>') +
            '</div>' +
            '<p class="mdim-hint">Drop image to override base · drag arrow · tips resize · green handle rotates (Shift = snap).</p>' +
          '</div>' +
          '<aside class="mdim-side">' +
            '<div class="wr-card-label">Labels</div>' +
            '<div class="mdim-label-list" data-mdim-list>' + (arrowCards || '<p class="muted">No measures from Shoot Tracker</p>') + '</div>' +
            addVol +
            '<div class="mdim-side-actions">' +
              '<button type="button" class="wr-text-btn" data-mdim="rebuild" title="Reset labels from Shoot Tracker">Rebuild</button>' +
              (ctx.hasDb
                ? '<button type="button" class="wr-text-btn" data-mdim="load-db" title="Load saved dimension from Prompt DB">Load from DB</button>'
                : '') +
              '<button type="button" class="wr-text-btn" data-mdim="add-label">+ Add</button>' +
            '</div>' +
          '</aside>' +
        '</div>' +
      '</div>';
  }

  function syncOverlay(root) {
    if (!live || !root) return;
    const Core = C();
    const img = root.querySelector('[data-mdim-img]');
    const svg = root.querySelector('[data-mdim-svg]');
    if (!img || !svg || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    live.displayW = rect.width;
    live.displayH = rect.height;
    Core.renderArrowsSvg(svg, live.draft.arrows, live.draft.style, live.displayW, live.displayH, live.selectedId);
  }

  function bindInteractions(root) {
    const Core = C();
    const svg = root.querySelector('[data-mdim-svg]');
    if (!svg || !live) return;

    function svgPoint(evt) {
      const rect = svg.getBoundingClientRect();
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }
    function findArrow(id) {
      return (live.draft.arrows || []).find((a) => a.id === id);
    }

    svg.onpointerdown = (evt) => {
      const t = evt.target;
      const g = t && t.closest && t.closest('.mdim-arrow');
      if (!g) {
        live.selectedId = null;
        refreshSide(root);
        syncOverlay(root);
        return;
      }
      const id = g.dataset.id;
      const role = t.dataset.role || 'move';
      live.selectedId = id;
      const arrow = findArrow(id);
      if (!arrow) return;
      const pt = svgPoint(evt);
      live.drag = {
        id, role,
        startX: pt.x, startY: pt.y,
        orig: { cx: arrow.cx, cy: arrow.cy, length: arrow.length, rotation: arrow.rotation }
      };
      svg.setPointerCapture(evt.pointerId);
      refreshSide(root);
      syncOverlay(root);
      evt.preventDefault();
    };

    svg.onpointermove = (evt) => {
      if (!live.drag) return;
      const arrow = findArrow(live.drag.id);
      if (!arrow) return;
      const pt = svgPoint(evt);
      const w = live.displayW || 1;
      const h = live.displayH || 1;
      const shift = evt.shiftKey;
      if (live.drag.role === 'move') {
        arrow.cx = Math.max(0, Math.min(1, live.drag.orig.cx + (pt.x - live.drag.startX) / w));
        arrow.cy = Math.max(0, Math.min(1, live.drag.orig.cy + (pt.y - live.drag.startY) / h));
      } else if (live.drag.role === 'end1' || live.drag.role === 'end2') {
        const cx = live.drag.orig.cx * w;
        const cy = live.drag.orig.cy * h;
        const dist = Math.hypot(pt.x - cx, pt.y - cy);
        arrow.length = Math.max(0.04, Math.min(1.2, (dist * 2) / w));
        if (evt.altKey) {
          const ang = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
          const base = live.drag.role === 'end1' ? ang + 180 : ang;
          arrow.rotation = Core.applyRotationRules(base, shift);
        }
      } else if (live.drag.role === 'rotate') {
        const cx = arrow.cx * w;
        const cy = arrow.cy * h;
        const handleAng = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
        arrow.rotation = Core.applyRotationRules(handleAng + 90, shift);
      }
      syncOverlay(root);
    };

    function endDrag(evt) {
      if (!live.drag) return;
      live.drag = null;
      try { svg.releasePointerCapture(evt.pointerId); } catch (_) { /* */ }
      if (host && host.persist) host.persist();
      refreshSide(root);
      syncOverlay(root);
    }
    svg.onpointerup = endDrag;
    svg.onpointercancel = endDrag;
  }

  function refreshSide(root) {
    if (!live || !root) return;
    root.querySelectorAll('.mdim-label-card').forEach((card) => {
      card.classList.toggle('is-active', card.getAttribute('data-mdim-arrow') === live.selectedId);
    });
    (live.draft.arrows || []).forEach((a) => {
      const flip = root.querySelector('[data-mdim-flip-btn="' + a.id + '"]');
      if (flip) flip.classList.toggle('is-on', Number(a.textSide) < 0);
    });
  }

  function ensureCanvasImg(root) {
    if (!root) return null;
    let img = root.querySelector('[data-mdim-img]');
    if (img) return img;
    const stage = root.querySelector('[data-mdim-stage]');
    if (!stage) return null;
    stage.classList.remove('is-empty');
    stage.innerHTML =
      '<div class="mdim-canvas-box">' +
        '<img data-mdim-img alt="M-DIM base" draggable="false">' +
        '<svg data-mdim-svg class="mdim-overlay" xmlns="http://www.w3.org/2000/svg"></svg>' +
      '</div>';
    return stage.querySelector('[data-mdim-img]');
  }

  /** Swap workspace image without full remount (faster base changes). */
  function setWorkspaceUrl(url) {
    if (!live) return;
    live.workspaceUrl = url;
    const root = document.querySelector('[data-mdim-root]');
    if (!root) return;
    const img = ensureCanvasImg(root);
    if (!img) return;
    if (img.getAttribute('src') === url) {
      syncOverlay(root);
      bindInteractions(root);
      return;
    }
    img.onload = () => {
      syncOverlay(root);
      bindInteractions(root);
    };
    img.src = url || '';
  }

  async function mount(root, ctx) {
    const Core = C();
    if (!root || !Core) return;
    host = ctx.host || host;
    const draft = ensureDraft(ctx.workspace, ctx.task);
    live = {
      draft,
      selectedId: (draft.arrows[0] && draft.arrows[0].id) || null,
      displayW: 0,
      displayH: 0,
      drag: null,
      workspaceUrl: ctx.workspaceUrl || null
    };

    const img = root.querySelector('[data-mdim-img]');
    if (img && live.workspaceUrl) {
      img.onload = () => {
        syncOverlay(root);
        bindInteractions(root);
      };
      img.src = live.workspaceUrl;
    } else {
      bindInteractions(root);
    }

    root.addEventListener('input', onSideInput);
    root.addEventListener('change', onSideChange);
    root.addEventListener('click', onSideClick);
    window.addEventListener('resize', onResize);

    function onResize() { syncOverlay(root); }

    function onSideInput(e) {
      const t = e.target;
      if (t.matches('[data-mdim-label]')) {
        const a = draft.arrows.find((x) => x.id === t.getAttribute('data-mdim-label'));
        if (a) { a.label = t.value; syncOverlay(root); if (host && host.persist) host.persist(); }
      }
    }

    function onSideChange(e) {
      const t = e.target;
      if (t.matches('[data-mdim-base]') && host && host.onBaseChange) {
        host.onBaseChange(t.value);
      }
    }

    function onSideClick(e) {
      const flipBtn = e.target.closest('[data-mdim-flip-btn]');
      if (flipBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = flipBtn.getAttribute('data-mdim-flip-btn');
        const a = draft.arrows.find((x) => x.id === id);
        if (a) {
          a.textSide = Number(a.textSide) < 0 ? 1 : -1;
          refreshSide(root);
          syncOverlay(root);
          if (host && host.persist) host.persist();
        }
        return;
      }
      const t = e.target.closest('[data-mdim-remove],[data-mdim],[data-mdim-arrow]');
      if (!t) return;
      if (t.hasAttribute('data-mdim-arrow') && !t.matches('input,button,label')) {
        live.selectedId = t.getAttribute('data-mdim-arrow');
        refreshSide(root);
        syncOverlay(root);
        return;
      }
      if (t.hasAttribute('data-mdim-remove')) {
        e.preventDefault();
        e.stopPropagation();
        const id = t.getAttribute('data-mdim-remove');
        draft.arrows = draft.arrows.filter((a) => a.id !== id);
        if (live.selectedId === id) live.selectedId = draft.arrows[0] ? draft.arrows[0].id : null;
        if (host && host.rerender) host.rerender();
        else if (host && host.persist) host.persist();
        return;
      }
      const act = t.getAttribute('data-mdim');
      if (act === 'toggle-main-max') {
        e.preventDefault();
        e.stopPropagation();
        if (host && host.toggleMainMax) host.toggleMainMax();
        return;
      }
      if (act === 'clear-override') {
        e.preventDefault();
        if (host && host.clearOverride) host.clearOverride();
        return;
      }
      if (act === 'rebuild') {
        e.preventDefault();
        if (host && host.rebuildFromTracker) host.rebuildFromTracker();
        else {
          const packed = Core.collectLabelsFromFields(draft.sourceFields, { includeVolume: false });
          draft.omittedVolume = packed.omittedVolume.slice();
          draft.arrows = Core.buildArrowsFromLabels(packed.labels, draft.arrows, false);
          if (host && host.rerender) host.rerender();
        }
        return;
      }
      if (act === 'load-db') {
        e.preventDefault();
        if (host && host.loadFromDb) host.loadFromDb();
        return;
      }
      if (act === 'add-volume') {
        const vol = (draft.omittedVolume || []).slice();
        draft.omittedVolume = [];
        const labels = draft.arrows.map((a) => a.label).concat(vol);
        draft.arrows = Core.buildArrowsFromLabels(labels, draft.arrows, true);
        if (host && host.rerender) host.rerender();
      } else if (act === 'add-label') {
        const n = draft.arrows.length + 1;
        const layout = Core.defaultArrowLayout(n, draft.arrows.map((a) => a.label).concat(['']));
        const pose = layout[layout.length - 1];
        draft.arrows.push({
          id: 'arrow-' + n + '-' + Date.now().toString(36),
          label: '',
          cx: pose.cx, cy: pose.cy, length: pose.length, rotation: pose.rotation,
          textSide: 1, visible: true
        });
        if (host && host.rerender) host.rerender();
      } else if (act === 'apply-export' && host && host.applyExport) {
        host.applyExport();
      }
    }

    live._cleanup = () => {
      root.removeEventListener('input', onSideInput);
      root.removeEventListener('change', onSideChange);
      root.removeEventListener('click', onSideClick);
      window.removeEventListener('resize', onResize);
    };
  }

  function unmount() {
    if (live && live._cleanup) live._cleanup();
    if (live && live.workspaceUrl && String(live.workspaceUrl).indexOf('blob:') === 0) {
      /* host owns URL lifecycle */
    }
    live = null;
  }

  function getDraft() {
    return live ? live.draft : null;
  }

  global.MdimPlayground = {
    LAYOUT_VERSION: 3,
    mainHtml,
    mount,
    unmount,
    ensureDraft,
    getDraft,
    syncOverlay,
    setWorkspaceUrl
  };
})(typeof window !== 'undefined' ? window : globalThis);
