(function () {
  'use strict';

  const AUTHOR_KEY = 'imageRenamer.author';
  const BATCH_KEY = 'imageRenamer.lastBatchNumber';
  const LAST_GEN_KEY = 'imageRenamer.lastGeneration';
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];
  const OUTPUT_DPI = 72;
  const APP_VERSION = 'V1.1';

  // Local Firefly upscale service (firefly-upscaler/server.js) running on the user's PC.
  const UPSCALE_URL = 'http://127.0.0.1:5175';
  const UPSCALE_SCALE = '2x';
  const UPSCALE_MIN_SIZE = 2000;
  const UPSCALE_POLL_MS = 1000;
  const SERVICE_CHECK_MS = 10000;

  const state = {
    data: null,
    author: '',
    ean: '',
    type: null,
    variant: '',
    shots: [],
    images: [],
    activeSuggestion: -1,
    suggestions: [],
    processing: false,
    rowTarget: -1,
    upscaleOn: true,
    service: 'checking',
    startingUntil: 0
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    viewLoading: $('view-loading'),
    viewError: $('view-data-error'),
    viewMain: $('view-main'),
    btnRetry: $('btn-retry'),
    dataUpdated: $('data-updated'),
    authorName: $('author-name'),
    changeAuthor: $('change-author'),
    modal: $('author-modal'),
    authorForm: $('author-form'),
    authorInput: $('author-input'),
    authorContinue: $('btn-author-continue'),
    authorCancel: $('btn-author-cancel'),
    eanInput: $('ean-input'),
    eanHint: $('ean-hint'),
    ptSearch: $('pt-search'),
    ptList: $('pt-list'),
    ptWarning: $('pt-warning'),
    variantField: $('variant-field'),
    variantSelect: $('variant-select'),
    dataUpdatedWrap: $('data-updated-wrap'),
    fillCount: $('fill-count'),
    shotCard: $('shot-card'),
    dropSub: $('drop-sub'),
    dropMsg: $('drop-msg'),
    btnClearAll: $('btn-clear-all'),
    dropBanner: $('drop-banner'),
    dropBannerTitle: $('drop-banner-title'),
    dropBannerText: $('drop-banner-text'),
    rowFileInput: $('row-file-input'),
    shotsTitle: $('shots-title'),
    targetOutput: $('target-output'),
    shotBody: $('shot-body'),
    tableEmpty: $('table-empty'),
    btnGenerate: $('btn-generate'),
    actionReason: $('action-reason'),
    progress: $('progress'),
    progressFile: $('progress-file'),
    progressStep: $('progress-step'),
    progressBar: $('progress-bar'),
    results: $('results'),
    resultsTime: $('results-time'),
    resultsBatch: $('results-batch'),
    resultsList: $('results-list'),
    upscaleToggle: $('upscale-toggle'),
    svcStatus: $('svc-status'),
    svcText: $('svc-text'),
    svcStart: $('svc-start'),
    svcSetup: $('svc-setup'),
    saveDest: $('save-dest')
  };

  const ICONS = {
    image: '<svg width="24" height="24" viewBox="0 0 20 20" fill="#9CA3AF"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/></svg>',
    alert: '<svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
  };

  /* ---------- Utilities ---------- */

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDate(iso, withTime) {
    const d = new Date(iso);
    if (isNaN(d)) return iso || '—';
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return withTime ? `${date}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : date;
  }

  // Windows shifts UTC ("Z") XMP dates by the local offset, so write local time with an explicit offset.
  function localIsoWithOffset(d) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
      `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function isValidEan(ean) { return /^\d{13}$/.test(ean); }

  function minSize() { return state.upscaleOn ? Math.min(UPSCALE_MIN_SIZE, state.data.minSize) : state.data.minSize; }
  function outSize() { return state.data.outputSize; }

  function needsUpscale(img) {
    return !!img && state.upscaleOn && img.width > 0 && Math.min(img.width, img.height) < outSize();
  }

  function outputName(index) {
    const shot = state.shots[index];
    const ean = state.ean || 'EAN';
    if (shot.code === 'MAIN') return `${ean}_MAIN.png`;
    return `${ean}_${shot.seq || pad2(index)}_${shot.code}.png`;
  }

  /* ---------- Data loading ---------- */

  // Swap this body for a Supabase query when the backend table is ready.
  async function loadNamingData() {
    await sleep(250);
    const data = window.NAMING_DATA;
    if (!data || !Array.isArray(data.productTypes) || !data.productTypes.length) {
      throw new Error('Naming data missing or malformed');
    }
    return {
      source: data.source || '',
      updatedAt: data.updatedAt,
      minSize: Number(data.minSize) || 3000,
      outputSize: Number(data.outputSize) || 3000,
      productTypes: data.productTypes
    };
  }

  async function init() {
    showView('loading');
    try {
      state.data = await loadNamingData();
    } catch (err) {
      console.error(err);
      showView('error');
      return;
    }
    el.dataUpdated.textContent = formatDate(state.data.updatedAt);
    el.dataUpdatedWrap.title = `Last modified ${formatDate(state.data.updatedAt, true)}` +
      (state.data.source ? `\nSource: ${state.data.source}` : '');
    el.targetOutput.textContent = `Target output: ${outSize()} × ${outSize()} px PNG`;
    showView('main');
    loadGeneration();
    render();
    renderSaveDest();
    renderServiceStatus();
    checkService();
  }

  function showView(name) {
    el.viewLoading.hidden = name !== 'loading';
    el.viewError.hidden = name !== 'error';
    el.viewMain.hidden = name !== 'main';
  }

  /* ---------- Author ---------- */

  function loadAuthor() {
    state.author = localStorage.getItem(AUTHOR_KEY) || '';
    el.authorName.textContent = state.author || '—';
    if (!state.author) openAuthorModal(false);
  }

  function openAuthorModal(cancellable) {
    el.authorInput.value = state.author;
    el.authorCancel.hidden = !cancellable;
    el.modal.dataset.cancellable = cancellable ? '1' : '';
    syncAuthorButton();
    el.modal.hidden = false;
    setTimeout(() => el.authorInput.focus(), 0);
  }

  function closeAuthorModal() { el.modal.hidden = true; }

  function syncAuthorButton() {
    el.authorContinue.disabled = !el.authorInput.value.trim();
  }

  el.authorInput.addEventListener('input', syncAuthorButton);
  el.authorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.authorInput.value.trim();
    if (!name) return;
    state.author = name;
    localStorage.setItem(AUTHOR_KEY, name);
    el.authorName.textContent = name;
    closeAuthorModal();
  });
  el.authorCancel.addEventListener('click', closeAuthorModal);
  el.changeAuthor.addEventListener('click', (e) => {
    e.preventDefault();
    if (!state.processing) openAuthorModal(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden && el.modal.dataset.cancellable) closeAuthorModal();
  });

  /* ---------- EAN ---------- */

  el.eanInput.addEventListener('input', () => {
    const digits = el.eanInput.value.replace(/\D/g, '').slice(0, 13);
    if (digits !== el.eanInput.value) el.eanInput.value = digits;
    state.ean = digits;
    if (el.eanInput.classList.contains('invalid') && isValidEan(digits)) setEanError(false);
    renderTable();
    renderActions();
    renderSaveDest();
  });
  el.eanInput.addEventListener('blur', () => {
    setEanError(state.ean.length > 0 && !isValidEan(state.ean));
  });

  function setEanError(on) {
    el.eanInput.classList.toggle('invalid', on);
    el.eanHint.classList.toggle('error', on);
    el.eanHint.textContent = on ? `EAN must be 13 digits (currently ${state.ean.length}).` : '13 digits';
  }

  /* ---------- Product type combobox ---------- */

  function findSuggestions(query) {
    const q = query.trim().toLowerCase();
    const types = state.data.productTypes;
    if (!q) return types.slice().sort((a, b) => a.name.localeCompare(b.name) || a.category.localeCompare(b.category));
    return types
      .map((t) => {
        const name = t.name.toLowerCase();
        const idx = name.indexOf(q);
        if (idx === -1) return null;
        const wordStart = idx === 0 || name[idx - 1] === ' ';
        return { t, score: (idx === 0 ? 0 : wordStart ? 1 : 2) };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.t.name.localeCompare(b.t.name))
      .map((x) => x.t);
  }

  function isAmbiguous(type) {
    return state.data.productTypes.some((t) => t !== type && t.name.toLowerCase() === type.name.toLowerCase());
  }

  function highlight(name, query) {
    const q = query.trim();
    if (!q) return escapeHtml(name);
    const idx = name.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(name);
    return escapeHtml(name.slice(0, idx)) +
      '<mark>' + escapeHtml(name.slice(idx, idx + q.length)) + '</mark>' +
      escapeHtml(name.slice(idx + q.length));
  }

  function openSuggestions() {
    const query = el.ptSearch.value;
    state.suggestions = findSuggestions(query);
    state.activeSuggestion = state.suggestions.length ? 0 : -1;
    renderSuggestions(query);
  }

  function renderSuggestions(query) {
    if (!state.suggestions.length) {
      el.ptList.innerHTML = '<li class="empty" role="option" aria-disabled="true">No matching product type</li>';
    } else {
      el.ptList.innerHTML = state.suggestions.map((t, i) => `
        <li role="option" data-index="${i}" class="${i === state.activeSuggestion ? 'active' : ''}" aria-selected="${i === state.activeSuggestion}">
          <span>${highlight(t.name, query)}</span>
          <span class="cat">${escapeHtml(t.category || '')}</span>
        </li>`).join('');
    }
    el.ptList.hidden = false;
    el.ptSearch.setAttribute('aria-expanded', 'true');
    el.ptSearch.classList.toggle('warn', !state.suggestions.length && query.trim().length > 0);
    const active = el.ptList.querySelector('li.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function closeSuggestions() {
    el.ptList.hidden = true;
    el.ptSearch.setAttribute('aria-expanded', 'false');
  }

  function selectType(type) {
    el.ptSearch.value = type.name;
    el.ptSearch.classList.remove('warn');
    el.ptWarning.hidden = true;
    closeSuggestions();
    if (state.type === type) return;
    state.type = type;
    state.variant = type.variants ? Object.keys(type.variants)[0] : '';
    rebuildShots();
  }

  function clearType() {
    if (!state.type) return;
    state.type = null;
    state.variant = '';
    rebuildShots();
  }

  el.ptSearch.addEventListener('input', () => {
    if (state.type && el.ptSearch.value !== state.type.name) clearType();
    el.ptWarning.hidden = true;
    openSuggestions();
  });
  el.ptSearch.addEventListener('focus', openSuggestions);
  el.ptSearch.addEventListener('keydown', (e) => {
    const n = state.suggestions.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (el.ptList.hidden) { openSuggestions(); return; }
      if (!n) return;
      state.activeSuggestion = (state.activeSuggestion + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderSuggestions(el.ptSearch.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!el.ptList.hidden && state.activeSuggestion >= 0) selectType(state.suggestions[state.activeSuggestion]);
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });
  el.ptSearch.addEventListener('blur', () => {
    setTimeout(() => {
      closeSuggestions();
      const text = el.ptSearch.value.trim().toLowerCase();
      if (!state.type && text) {
        const exact = state.data.productTypes.filter((t) => t.name.toLowerCase() === text);
        if (exact.length === 1) selectType(exact[0]);
        else { el.ptWarning.hidden = false; el.ptSearch.classList.add('warn'); }
      }
    }, 120);
  });
  el.ptList.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-index]');
    if (!li) return;
    e.preventDefault();
    selectType(state.suggestions[Number(li.dataset.index)]);
  });

  /* ---------- Variant ---------- */

  function renderVariant() {
    const t = state.type;
    const sel = el.variantSelect;
    if (t && t.variants) {
      sel.innerHTML = Object.keys(t.variants)
        .map((v) => `<option value="${escapeHtml(v)}"${v === state.variant ? ' selected' : ''}>${escapeHtml(v)}</option>`)
        .join('');
      sel.disabled = state.processing;
      el.variantField.classList.remove('is-disabled');
    } else {
      sel.innerHTML = `<option>${t ? 'No variants for this type' : 'Select product type first'}</option>`;
      sel.disabled = true;
      el.variantField.classList.add('is-disabled');
    }
  }

  el.variantSelect.addEventListener('change', () => {
    state.variant = el.variantSelect.value;
    rebuildShots();
  });

  /* ---------- Shots & images ---------- */

  function currentShots() {
    const t = state.type;
    if (!t) return [];
    if (t.variants) return t.variants[state.variant] || [];
    return t.shots || [];
  }

  function rebuildShots() {
    state.shots = currentShots();
    const n = state.shots.length;
    if (state.type && state.images.length > n) {
      const dropped = state.images.slice(n).filter(Boolean);
      dropped.forEach(releaseImage);
      state.images.length = n;
      if (dropped.length) {
        showDropMsg(`${dropped.length} image${dropped.length > 1 ? 's were' : ' was'} removed because this product type has only ${n} shots.`);
      }
    }
    render();
  }

  function releaseImage(img) {
    if (img && img.url) URL.revokeObjectURL(img.url);
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  async function setImage(index, file) {
    releaseImage(state.images[index]);
    const entry = { file, url: '', width: 0, height: 0, status: 'loading', errors: [] };
    state.images[index] = entry;
    renderAll();
    try {
      const { url, width, height } = await readImage(file);
      if (state.images[index] !== entry) { URL.revokeObjectURL(url); return; }
      Object.assign(entry, { url, width, height });
      validateImage(entry);
    } catch (err) {
      if (state.images[index] !== entry) return;
      entry.status = 'invalid';
      entry.unreadable = true;
      entry.errors = [{ code: 'unreadable', label: 'Unreadable', text: 'Could not read the image file.' }];
    }
    renderAll();
  }

  // The minimum size depends on the AI upscale switch, so this re-runs whenever it changes.
  function validateImage(entry) {
    if (!entry || entry.unreadable || !entry.width) return;
    const { width, height } = entry;
    const min = minSize();
    entry.errors = [];
    entry.upscale = null;
    if (width < min || height < min) {
      const canUpscale = !state.upscaleOn && Math.min(width, height) >= UPSCALE_MIN_SIZE;
      entry.errors.push({
        code: 'small',
        label: 'Too small',
        text: `Use an image of ${min} × ${min} px or larger${canUpscale ? ', or turn on AI upscale' : ''}.`
      });
    }
    if (width !== height) {
      entry.errors.push({ code: 'ratio', label: 'Not square', text: 'Use a square (1:1) image.' });
    }
    entry.status = entry.errors.length ? 'invalid' : 'ready';
  }

  function clearImage(index) {
    releaseImage(state.images[index]);
    state.images[index] = null;
    renderAll();
  }

  function clearAllImages() {
    state.images.forEach(releaseImage);
    state.images = [];
    showDropMsg('');
    renderAll();
  }

  function isAccepted(file) {
    return ACCEPTED_TYPES.includes(file.type);
  }

  function rejectedMessage(names) {
    if (!names.length) return '';
    const list = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');
    return `${names.length} file${names.length > 1 ? 's' : ''} not added (${list}): only JPG or PNG images are accepted.`;
  }

  // With startIndex, the first file replaces that row and the rest fill empty rows after it, wrapping around.
  function addFiles(fileList, startIndex) {
    if (state.processing) return;
    const files = Array.from(fileList);
    const valid = files.filter(isAccepted);
    const rejected = files.filter((f) => !isAccepted(f)).map((f) => f.name);
    const msgs = [];

    if (!state.type) {
      showDropMsg('Choose a product type first so images can be matched to shots.');
      return;
    }

    const n = state.shots.length;
    const start = startIndex >= 0 ? startIndex : 0;
    let added = 0;
    if (startIndex >= 0 && valid.length) {
      setImage(startIndex, valid[0]);
      added = 1;
    }
    for (let k = 0; k < n && added < valid.length; k++) {
      const i = (start + k) % n;
      if (!state.images[i]) {
        setImage(i, valid[added]);
        added++;
      }
    }
    const overflow = valid.length - added;
    if (rejected.length) msgs.push(rejectedMessage(rejected));
    if (overflow) msgs.push(`${overflow} image${overflow > 1 ? 's were' : ' was'} not added: all shots are already filled. Clear a row to replace it.`);
    showDropMsg(msgs.join(' '));
  }

  function showDropMsg(text) {
    el.dropMsg.textContent = text;
    el.dropMsg.hidden = !text;
  }

  /* ---------- Drag & drop onto the shot list ---------- */

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const canDrop = () => !state.processing && !!state.type;

  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

  function clearRowTarget() {
    el.shotBody.querySelectorAll('.row-drop-target').forEach((r) => r.classList.remove('row-drop-target'));
  }

  function endDrag() {
    dragDepth = 0;
    el.shotCard.classList.remove('dragover', 'drag-invalid');
    clearRowTarget();
    renderFillCount();
    renderDropBanner();
  }

  // File names aren't exposed until drop, but MIME types are, so unsupported formats can be flagged mid-drag.
  function inspectDrag(e) {
    const items = Array.from(e.dataTransfer.items || []).filter((it) => it.kind === 'file');
    const bad = items.filter((it) => !ACCEPTED_TYPES.includes(it.type)).length;
    return { total: items.length, bad };
  }

  el.shotCard.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault();
    dragDepth++;
    if (dragDepth > 1) return;
    const { total, bad } = inspectDrag(e);
    el.shotCard.classList.add('dragover');
    el.shotCard.classList.toggle('drag-invalid', bad > 0);
    el.fillCount.textContent = `${total || 'Incoming'} file${total === 1 ? '' : 's'} detected`;
    el.fillCount.className = 'pill teal';
    if (bad) {
      el.dropBannerTitle.textContent = bad === total ? 'Unsupported format' : 'Some files will be skipped';
      el.dropBannerText.textContent = bad === total
        ? `${bad === 1 ? 'This file is' : 'These files are'} not JPG or PNG and will not be added.`
        : `${bad} of ${total} files are not JPG or PNG and will not be added.`;
    } else {
      el.dropBannerTitle.textContent = 'Drop to add images';
      el.dropBannerText.textContent = 'Drop on a row to fill that shot, or anywhere else to fill the next empty shots.';
    }
  });
  el.shotCard.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDrop() ? 'copy' : 'none';
    if (!canDrop()) return;
    const tr = e.target.closest('tr[data-index]');
    if (tr && tr.classList.contains('row-drop-target')) return;
    clearRowTarget();
    if (tr) tr.classList.add('row-drop-target');
  });
  el.shotCard.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) endDrag();
  });
  el.shotCard.addEventListener('drop', (e) => {
    e.preventDefault();
    const tr = e.target.closest('tr[data-index]');
    endDrag();
    if (!canDrop() || !e.dataTransfer.files.length) return;
    addFiles(e.dataTransfer.files, tr ? Number(tr.dataset.index) : -1);
  });

  el.btnClearAll.addEventListener('click', () => { if (!state.processing) clearAllImages(); });

  /* ---------- AI upscale switch & service ---------- */

  el.upscaleToggle.addEventListener('change', () => {
    if (state.processing) return;
    state.upscaleOn = el.upscaleToggle.checked;
    state.images.forEach(validateImage);
    if (state.upscaleOn) checkService();
    renderServiceStatus();
    renderAll();
  });

  async function serviceFetch(path, options) {
    const res = await fetch(UPSCALE_URL + path, Object.assign({ cache: 'no-store' }, options));
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { message = (await res.json()).error || message; } catch (_) { /* not JSON */ }
      throw new Error(message);
    }
    return res;
  }

  async function checkService() {
    if (!state.upscaleOn || state.processing) return;
    let next;
    try {
      const res = await serviceFetch('/health', { signal: AbortSignal.timeout(3000) });
      next = (await res.json()).chrome ? 'online' : 'nochrome';
    } catch (err) {
      next = (await localNetworkPermission()) === 'denied' ? 'blocked' : 'offline';
    }
    if (state.service === 'starting' && next === 'offline' && Date.now() < state.startingUntil) return;
    if (next === state.service) return;
    state.service = next;
    renderServiceStatus();
    renderActions();
  }

  setInterval(checkService, SERVICE_CHECK_MS);

  // A hosted page needs Chrome's local network permission to reach the upscaler; the name differs between Chrome versions.
  async function localNetworkPermission() {
    if (!navigator.permissions) return 'unknown';
    let result = 'unknown';
    for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
      try {
        const { state: perm } = await navigator.permissions.query({ name });
        if (perm === 'denied') return 'denied';
        if (perm === 'prompt') result = 'prompt';
      } catch (_) { /* not supported in this browser */ }
    }
    return result;
  }

  function renderServiceStatus() {
    el.svcStatus.hidden = !state.upscaleOn;
    const look = {
      checking: ['', 'Upscaler: checking…'],
      starting: ['amber', 'Upscaler: starting…'],
      online: ['green', 'Upscaler connected'],
      nochrome: ['amber', 'Upscaler: Firefly Chrome not open'],
      offline: ['red', 'Upscaler offline'],
      blocked: ['red', 'Upscaler blocked by Chrome']
    }[state.service];
    el.svcStatus.className = `pill svc ${look[0]}`;
    el.svcText.textContent = look[1];
    el.svcStart.hidden = state.service !== 'offline' && state.service !== 'nochrome';
    el.svcSetup.hidden = state.service !== 'offline';
  }

  // The link opens start-service.bat through the playground3d:// handler that Setup.bat registers.
  el.svcStart.addEventListener('click', () => {
    if (state.processing) return;
    state.service = 'starting';
    state.startingUntil = Date.now() + 60000;
    renderServiceStatus();
    renderActions();
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      await checkService();
      if (state.service !== 'starting' || tries >= 31) clearInterval(poll);
    }, 2000);
  });

  /* ---------- Save destination (one EAN.zip holding an EAN folder) ---------- */

  function renderSaveDest() {
    el.saveDest.textContent = `${state.ean || 'EAN'}.zip`;
  }

  /* ---------- Table interactions ---------- */

  el.shotBody.addEventListener('click', (e) => {
    if (state.processing) return;
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (btn.dataset.action === 'clear') clearImage(index);
    if (btn.dataset.action === 'pick') { state.rowTarget = index; el.rowFileInput.click(); }
  });

  el.rowFileInput.addEventListener('change', () => {
    const file = el.rowFileInput.files[0];
    el.rowFileInput.value = '';
    if (!file || state.rowTarget < 0) return;
    if (!isAccepted(file)) { showDropMsg(rejectedMessage([file.name])); return; }
    showDropMsg('');
    setImage(state.rowTarget, file);
    state.rowTarget = -1;
  });

  /* ---------- Rendering ---------- */

  function render() {
    renderVariant();
    renderAll();
  }

  function renderAll() {
    renderTable();
    renderFillCount();
    renderDropBanner();
    renderActions();
  }

  function statusBadge(img) {
    if (!img) return '<span class="status status-empty">Empty</span>';
    switch (img.status) {
      case 'loading': return '<span class="status status-loading">Reading…</span>';
      case 'ready': return '<span class="status status-ready">Ready</span>';
      case 'upscaling': return '<span class="status status-loading">Upscaling…</span>';
      case 'generating': return '<span class="status status-loading">Generating…</span>';
      case 'done': return '<span class="status status-done">Generated</span>';
      case 'invalid':
      case 'failed':
        return '<div class="status-stack">' +
          img.errors.map((er) => `<span class="status status-error">${escapeHtml(er.label)}</span>`).join('') +
          '</div>';
      default: return '';
    }
  }

  function isErrorStatus(s) { return s === 'invalid' || s === 'failed'; }

  const RING_C = 2 * Math.PI * 15.5;

  function ring(pct, variant) {
    const offset = RING_C * (1 - Math.max(0, Math.min(100, pct)) / 100);
    return `<svg class="ring ${variant}" viewBox="0 0 36 36" aria-hidden="true">` +
      '<circle class="ring-bg" cx="18" cy="18" r="15.5"/>' +
      `<circle class="ring-fg" cx="18" cy="18" r="15.5" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>` +
      '</svg>';
  }

  const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))} s`;

  function upscaleCell(img) {
    if (!img || img.status === 'loading') return '<span class="dash">—</span>';
    const up = img.upscale;
    if (up) {
      if (up.state === 'done') return `<span class="up-time done" title="AI upscale ${UPSCALE_SCALE} time">${secs(up.ms)}</span>`;
      if (up.state === 'failed') return '<span class="up-fail">Failed</span>';
      if (up.state === 'queued') {
        return `<span class="upscale-cell">${ring(0, 'is-queued')}<span class="up-time">Queued</span></span>`;
      }
      const waiting = up.stage === 'rate-limited' || up.stage === 'waiting';
      const sub = up.stage === 'rate-limited' ? 'Firefly busy' : `${Math.round(up.progress)}%`;
      return `<span class="upscale-cell" title="${escapeHtml(up.stage || '')}">${ring(up.progress, waiting ? 'is-waiting' : '')}` +
        `<span class="up-time">${secs(up.elapsed)}<span class="up-sub">${sub}</span></span></span>`;
    }
    if (!state.upscaleOn) return '<span class="up-muted">Off</span>';
    if (img.status === 'invalid') return '<span class="dash">—</span>';
    if (needsUpscale(img)) return `<span class="status status-upscale" title="Will be upscaled ${UPSCALE_SCALE} with Adobe Firefly">AI ${UPSCALE_SCALE}</span>`;
    return '<span class="up-muted">Not needed</span>';
  }

  function updateUpscaleCell(index) {
    const td = el.shotBody.querySelector(`td[data-up-cell="${index}"]`);
    if (td) td.innerHTML = upscaleCell(state.images[index]);
  }

  function renderTable() {
    const shots = state.shots;
    el.tableEmpty.hidden = shots.length > 0;
    el.shotsTitle.textContent = state.type
      ? `Shots for ${state.type.name}${state.variant ? ' · ' + state.variant : ''}${isAmbiguous(state.type) ? ` (${state.type.category})` : ''}`
      : 'Shots';

    el.shotBody.innerHTML = shots.map((shot, i) => {
      const img = state.images[i];
      const rowClass = !img ? 'row-empty' : isErrorStatus(img.status) ? 'row-error' : '';
      const dis = state.processing ? ' disabled' : '';
      let imageCell;
      if (!img) {
        imageCell = `<button type="button" class="slot-drop" data-action="pick" data-index="${i}"${dis}>+ Drop image</button>`;
      } else {
        const thumb = img.url ? `<img src="${img.url}" alt="">` : ICONS.image;
        const dims = img.width ? `${img.width} × ${img.height}` : (img.status === 'loading' ? 'Reading…' : '—');
        imageCell = `
          <div class="img-cell">
            <div class="thumb">${thumb}</div>
            <div>
              <span class="dims">${dims}</span>
              <span class="dims-sub" title="${escapeHtml(img.file.name)}">${escapeHtml(img.file.name)}</span>
              ${img.errors.length ? `<ul class="img-errors">${img.errors.map((er) => `<li class="img-error">${escapeHtml(er.text)}</li>`).join('')}</ul>` : ''}
            </div>
          </div>`;
      }
      const action = img
        ? `<button type="button" class="btn-clear" data-action="clear" data-index="${i}"${dis}>Clear</button>`
        : '';
      return `
        <tr class="${rowClass}" data-index="${i}">
          <td class="td-seq">${escapeHtml(shot.seq || pad2(i))}</td>
          <td class="td-name">${escapeHtml(shot.name)}${shot.note ? `<span class="note">(${escapeHtml(shot.note)})</span>` : ''}</td>
          <td class="td-code">${escapeHtml(shot.code)}</td>
          <td>${imageCell}</td>
          <td class="td-out">${escapeHtml(outputName(i))}</td>
          <td data-up-cell="${i}">${upscaleCell(img)}</td>
          <td>${statusBadge(img)}</td>
          <td class="td-action">${action}</td>
        </tr>`;
    }).join('');
  }

  function renderFillCount() {
    if (el.shotCard.classList.contains('dragover')) return;
    const total = state.shots.length;
    const filled = state.images.slice(0, total).filter(Boolean).length;
    el.fillCount.textContent = `${filled} of ${total} shots filled`;
    el.fillCount.className = 'pill' + (total && filled === total ? ' green' : '');
    el.dropSub.textContent = `JPG or PNG only. Minimum ${minSize()} × ${minSize()} px, square (1:1).` +
      (state.upscaleOn ? ` Images under ${outSize()} px are upscaled ${UPSCALE_SCALE} with Adobe Firefly (requires a Photoshop or similar Adobe subscription, and Node.js on this PC).` : '');
    el.btnClearAll.disabled = state.processing || filled === 0;
    el.upscaleToggle.disabled = state.processing;
  }

  function renderDropBanner() {
    const total = state.shots.length;
    const filled = state.images.slice(0, total).filter(Boolean).length;
    el.dropBanner.hidden = !state.type || !total || filled >= total;
    if (el.shotCard.classList.contains('dragover')) return;
    const empty = total - filled;
    el.dropBannerTitle.textContent = 'Drop to add images';
    el.dropBannerText.textContent =
      `Drag files onto a row to fill that shot, or anywhere here to fill the next ${empty === 1 ? 'empty shot' : `${empty} empty shots`}.`;
  }

  function getBlocker() {
    if (!state.type) return { level: 'warn', text: 'Choose a product type.' };
    if (!isValidEan(state.ean)) return { level: 'warn', text: 'Enter a valid EAN code (13 digits).' };
    const imgs = state.images.slice(0, state.shots.length).filter(Boolean);
    if (imgs.some((i) => i.status === 'loading')) return { level: 'info', text: 'Reading images…' };
    const bad = imgs.filter((i) => i.status === 'invalid');
    if (bad.length) {
      const allSmall = bad.every((i) => i.errors.length === 1 && i.errors[0].code === 'small');
      const what = allSmall
        ? `the image${bad.length > 1 ? 's' : ''} under ${minSize()} px`
        : `the highlighted image${bad.length > 1 ? 's' : ''}`;
      return {
        level: 'error',
        text: `${bad.length} image${bad.length > 1 ? 's need' : ' needs'} attention: replace or clear ${what}.`
      };
    }
    const ready = imgs.filter((i) => i.status === 'ready' || i.status === 'done' || i.status === 'failed');
    if (!ready.length) return { level: 'warn', text: 'Add at least one image.' };
    if (ready.some(needsUpscale) && state.service !== 'online') {
      if (state.service === 'checking') return { level: 'info', text: 'Checking the AI upscale service…' };
      if (state.service === 'starting') {
        return { level: 'info', text: 'Starting the AI upscaler… this takes about 15 seconds. If Chrome asks to access devices on your local network, click Allow.' };
      }
      if (state.service === 'blocked') {
        return {
          level: 'error',
          text: 'Chrome is blocking this page from reaching the upscaler on this PC. Click the icon left of the address bar, set "Local network access" to Allow, then reload the page.'
        };
      }
      return {
        level: 'error',
        text: state.service === 'nochrome'
          ? 'AI upscale: the Firefly Chrome window is not open. Click Start next to the upscaler status, or turn AI upscale off.'
          : 'AI upscale service is not running. Click Start next to "Upscaler offline", or turn AI upscale off. First time on this PC: click Setup, extract the zip to your user folder and run Setup.bat (installs Node.js).' +
            (location.protocol === 'https:' ? ' If Chrome asks to access devices on your local network, click Allow.' : '')
      };
    }
    return null;
  }

  function upscaleIndexes(indexes) {
    return indexes.filter((i) => needsUpscale(state.images[i]));
  }

  function renderActions() {
    if (state.processing) return;
    const blocker = getBlocker();
    el.btnGenerate.disabled = !!blocker;
    el.btnGenerate.classList.remove('is-busy');
    el.btnGenerate.querySelector('.spinner').hidden = true;

    if (blocker) {
      el.actionReason.className = 'reason ' + blocker.level;
      el.actionReason.innerHTML = (blocker.level === 'error' ? ICONS.alert : '') + `<span>${escapeHtml(blocker.text)}</span>`;
      el.actionReason.hidden = false;
      el.btnGenerate.querySelector('.btn-label').textContent = 'Generate images';
    } else {
      const indexes = generatableIndexes();
      const count = indexes.length;
      const ups = upscaleIndexes(indexes).length;
      el.btnGenerate.querySelector('.btn-label').textContent = ups
        ? `Upscale & generate ${count} image${count > 1 ? 's' : ''}`
        : `Generate ${count} image${count > 1 ? 's' : ''}`;
      el.actionReason.className = 'reason info';
      el.actionReason.textContent = `Output: ${outSize()} × ${outSize()} px PNG` +
        (ups ? ` · AI upscale ${UPSCALE_SCALE}: ${ups} image${ups > 1 ? 's' : ''}` : '') +
        ` · Author: ${state.author || '—'}`;
      el.actionReason.hidden = false;
    }
  }

  function generatableIndexes() {
    const out = [];
    state.shots.forEach((_, i) => {
      const img = state.images[i];
      if (img && (img.status === 'ready' || img.status === 'done' || img.status === 'failed')) out.push(i);
    });
    return out;
  }

  /* ---------- Generation ---------- */

  function setProcessing(on) {
    state.processing = on;
    document.body.classList.toggle('is-processing', on);
    el.eanInput.disabled = on;
    el.ptSearch.disabled = on;
    renderVariant();
    renderTable();
    renderFillCount();
  }

  function setProgress(file, step, pct) {
    el.progressFile.textContent = file;
    el.progressStep.textContent = step;
    el.progressBar.style.width = pct + '%';
  }

  function loadForDraw(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not read the image file.'));
      img.src = url;
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Uncompressed ("stored") zip: PNGs are already compressed. Entry names include the EAN folder.
  async function buildZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const name = enc.encode(f.name);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);

      const cd = new Uint8Array(46 + name.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);

      parts.push(local, data);
      central.push(cd);
      offset += local.length + data.length;
    }

    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  async function renderPng(src) {
    const size = outSize();
    const img = await loadForDraw(src);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
    return encodePngRgb(ctx.getImageData(0, 0, size, size), OUTPUT_DPI);
  }

  /* ---------- AI upscale jobs ---------- */

  async function submitUpscale(entry) {
    const res = await serviceFetch(`/jobs?scale=${UPSCALE_SCALE}&name=${encodeURIComponent(entry.file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': entry.file.type || 'image/png' },
      body: entry.file
    });
    return (await res.json()).id;
  }

  async function waitForUpscale(index, jobId, onProgress) {
    const entry = state.images[index];
    for (;;) {
      let job;
      try {
        job = await (await serviceFetch(`/jobs/${jobId}`)).json();
      } catch (err) {
        throw new Error(`lost connection to the upscale service (${err.message})`);
      }
      entry.upscale = {
        state: job.status === 'queued' ? 'queued' : 'running',
        stage: job.stage,
        progress: job.progress,
        elapsed: job.elapsedMs
      };
      updateUpscaleCell(index);
      onProgress(job);
      if (job.status === 'done') {
        const blob = await (await serviceFetch(`/jobs/${jobId}/result`)).blob();
        entry.upscale = { state: 'done', ms: job.elapsedMs };
        updateUpscaleCell(index);
        return blob;
      }
      if (job.status === 'failed') throw new Error(job.error || 'unknown error');
      await sleep(UPSCALE_POLL_MS);
    }
  }

  function upscaleStepText(job) {
    if (job.status === 'queued') return `Queued for AI upscale (position ${job.position})…`;
    switch (job.stage) {
      case 'waiting': return 'Waiting for Firefly…';
      case 'rate-limited': return 'Firefly is busy, retrying shortly…';
      case 'downloading': return 'Downloading upscaled image…';
      default: return `AI upscaling ${UPSCALE_SCALE} on Firefly… ${job.progress}%`;
    }
  }

  /* ---------- Generate ---------- */

  async function generate() {
    const blocker = getBlocker();
    if (blocker || state.processing) return;
    const indexes = generatableIndexes();
    if (!indexes.length) return;

    const zipName = `${state.ean}.zip`;
    const upIdx = new Set(upscaleIndexes(indexes));
    setProcessing(true);
    const btnLabel = el.btnGenerate.querySelector('.btn-label');
    el.btnGenerate.disabled = true;
    el.btnGenerate.classList.add('is-busy');
    el.btnGenerate.querySelector('.spinner').hidden = false;
    el.actionReason.className = 'reason info';
    el.actionReason.textContent = upIdx.size
      ? `AI upscaling ${upIdx.size} image${upIdx.size > 1 ? 's' : ''} ${UPSCALE_SCALE}, then generating PNG ${outSize()} × ${outSize()}…`
      : `Generating PNG ${outSize()} × ${outSize()} in browser memory…`;
    el.progress.hidden = false;

    const results = [];
    const zipFiles = [];
    const meta = {
      Author: state.author,
      Title: '',
      Software: `3D Playground (Beta ${APP_VERSION})`,
      'Creation Time': localIsoWithOffset(new Date())
    };

    // An AI upscale takes far longer than the PNG conversion, so it carries more of the progress bar.
    const weights = indexes.map((i) => (upIdx.has(i) ? 5 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const before = weights.map((_, n) => weights.slice(0, n).reduce((a, b) => a + b, 0));
    const pct = (n, f) => ((before[n] + weights[n] * f) / total) * 100;

    // All jobs are sent up front; the service runs them one at a time while finished ones are converted here.
    const jobs = {};
    if (upIdx.size) {
      setProgress('', `Sending ${upIdx.size} image${upIdx.size > 1 ? 's' : ''} to AI upscale…`, 0);
      for (const i of upIdx) {
        state.images[i].upscale = { state: 'queued' };
        try {
          jobs[i] = { id: await submitUpscale(state.images[i]) };
        } catch (err) {
          jobs[i] = { error: err.message };
        }
      }
      renderTable();
    }

    for (let n = 0; n < indexes.length; n++) {
      const i = indexes[n];
      const entry = state.images[i];
      const name = outputName(i);
      const label = `${state.shots[i].seq || pad2(i)} | ${name}`;
      const up = upIdx.has(i);
      const conv = (f) => pct(n, up ? 0.8 + 0.2 * f : f);
      btnLabel.textContent = `Processing ${n + 1} of ${indexes.length}…`;
      let upscaledUrl = '';
      let upscaleMs = 0;

      try {
        if (up) {
          entry.status = 'upscaling';
          renderTable();
          try {
            if (jobs[i].error) throw new Error(jobs[i].error);
            const upscaled = await waitForUpscale(i, jobs[i].id, (job) =>
              setProgress(label, upscaleStepText(job), pct(n, (0.8 * job.progress) / 100)));
            upscaledUrl = URL.createObjectURL(upscaled);
            upscaleMs = entry.upscale.ms;
          } catch (err) {
            entry.upscale = { state: 'failed' };
            throw new Error(`AI upscale failed: ${err.message}`);
          }
        }

        entry.status = 'generating';
        renderTable();
        setProgress(label, 'Converting & resizing…', conv(0.2));
        await sleep(30);
        const raw = await renderPng(upscaledUrl || entry.url);
        setProgress(label, 'Writing metadata…', conv(0.7));
        const blob = await addPngText(raw, Object.assign({}, meta, {
          Title: name.replace(/\.png$/, ''),
          Description: `${state.type.name}${state.variant ? ' · ' + state.variant : ''} · ${state.shots[i].name}`
        }));
        setProgress(label, 'Adding to zip…', conv(0.95));
        zipFiles.push({ name: `${state.ean}/${name}`, blob });
        entry.status = 'done';
        entry.errors = [];
        results.push({ ok: true, name, upscaleMs });
      } catch (err) {
        console.error(err);
        const message = err.message || 'unknown error';
        entry.status = 'failed';
        entry.errors = [{
          code: 'failed',
          label: 'Failed',
          text: message.startsWith('AI upscale') ? message : 'Generation failed: ' + message
        }];
        results.push({ ok: false, name, error: message });
      } finally {
        if (upscaledUrl) URL.revokeObjectURL(upscaledUrl);
      }
      renderTable();
    }

    if (zipFiles.length) {
      setProgress('', 'Creating zip…', 99);
      downloadBlob(await buildZip(zipFiles), zipName);
    }

    setProgress('', 'Done', 100);
    await sleep(300);
    el.progress.hidden = true;
    setProcessing(false);
    const generation = saveGeneration(results, zipFiles.length ? zipName : '');
    renderResults(generation);
    el.results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderAll();
  }

  el.btnGenerate.addEventListener('click', generate);

  function nextBatchId() {
    const last = localStorage.getItem(BATCH_KEY);
    const next = last === null || isNaN(Number(last)) ? 0 : Number(last) + 1;
    localStorage.setItem(BATCH_KEY, String(next));
    return String(next).padStart(3, '0');
  }

  function saveGeneration(results, dest) {
    const generation = {
      batch: nextBatchId(),
      time: new Date().toISOString(),
      size: outSize(),
      dest,
      results
    };
    try {
      localStorage.setItem(LAST_GEN_KEY, JSON.stringify(generation));
    } catch (err) {
      console.error('Could not save last generation', err);
    }
    return generation;
  }

  function loadGeneration() {
    try {
      const g = JSON.parse(localStorage.getItem(LAST_GEN_KEY) || 'null');
      if (g && Array.isArray(g.results)) renderResults(g);
    } catch (err) {
      console.error('Could not read last generation', err);
    }
  }

  function formatWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    return `${formatDate(iso)}, ${time}`;
  }

  function renderResults(generation) {
    const results = generation.results;
    el.resultsTime.textContent = formatWhen(generation.time);
    el.resultsBatch.textContent = `Batch ID: #${generation.batch}` + (generation.dest ? ` · Saved to ${generation.dest}` : '');
    const size = `${generation.size} × ${generation.size} · PNG`;
    el.resultsList.innerHTML = results.map((r) => r.ok
      ? `<li class="result ok">
           <div class="result-left"><span class="result-ico">${ICONS.check}</span><span class="result-name">${escapeHtml(r.name)}</span></div>
           <span class="result-meta">${size}${r.upscaleMs ? ` · AI ${UPSCALE_SCALE} in ${secs(r.upscaleMs)}` : ''}</span>
         </li>`
      : `<li class="result fail">
           <div class="result-left"><span class="result-ico">${ICONS.cross}</span><span class="result-name">${escapeHtml(r.name)}: <span>${escapeHtml(r.error)}</span></span></div>
           <span class="result-meta">Failed</span>
         </li>`).join('');
    el.results.hidden = false;
  }

  /* ---------- PNG metadata (tEXt + XMP) ---------- */

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

  function u32(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }

  // canvas.toBlob always emits 32-bit RGBA with no pHYs (shown as 96 dpi), so encode 24-bit RGB ourselves.
  async function encodePngRgb(imageData, dpi) {
    const { width, height, data } = imageData;
    const stride = width * 3;
    const raw = new Uint8Array((stride + 1) * height);
    let prev = new Uint8Array(stride);
    let cur = new Uint8Array(stride);
    const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));

    for (let y = 0; y < height; y++) {
      for (let x = 0, s = y * width * 4, d = 0; x < width; x++, s += 4, d += 3) {
        cur[d] = data[s];
        cur[d + 1] = data[s + 1];
        cur[d + 2] = data[s + 2];
      }
      // Pick the PNG filter (None, Sub, Up, Average, Paeth) with the smallest sum of absolute values.
      let best = 0;
      let bestScore = Infinity;
      for (let f = 0; f < 5; f++) {
        const out = cand[f];
        let score = 0;
        for (let i = 0; i < stride; i++) {
          const a = i >= 3 ? cur[i - 3] : 0;
          const b = prev[i];
          const c = i >= 3 ? prev[i - 3] : 0;
          let pred = 0;
          if (f === 1) pred = a;
          else if (f === 2) pred = b;
          else if (f === 3) pred = (a + b) >> 1;
          else if (f === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          }
          const v = (cur[i] - pred) & 255;
          out[i] = v;
          score += v < 128 ? v : 256 - v;
          if (score >= bestScore) break;
        }
        if (score < bestScore) { bestScore = score; best = f; }
      }
      const offset = y * (stride + 1);
      raw[offset] = best;
      raw.set(cand[best], offset + 1);
      [prev, cur] = [cur, prev];
    }

    const compressed = new Uint8Array(await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
    ).arrayBuffer());

    const ppm = Math.round(dpi / 0.0254);
    const parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', new Uint8Array([...u32(width), ...u32(height), 8, 2, 0, 0, 0])),
      pngChunk('pHYs', new Uint8Array([...u32(ppm), ...u32(ppm), 1])),
      pngChunk('IDAT', compressed),
      pngChunk('IEND', new Uint8Array(0))
    ];
    return new Blob(parts, { type: 'image/png' });
  }

  function textChunk(key, value) {
    return pngChunk('tEXt', new Uint8Array([...latin1(key), 0, ...latin1(value)]));
  }

  // iTXt layout: keyword\0, compression flag, compression method, language tag\0, translated keyword\0, UTF-8 text.
  function itxtChunk(key, text) {
    return pngChunk('iTXt', new Uint8Array([...latin1(key), 0, 0, 0, 0, 0, ...new TextEncoder().encode(text)]));
  }

  function xmlEscape(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  // Windows Explorer and most photo tools read PNG properties (Authors, Title, Comments) from XMP, not tEXt.
  function buildXmp(fields) {
    const x = (v) => xmlEscape(v || '');
    return '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/">' +
      `<dc:creator><rdf:Seq><rdf:li>${x(fields.Author)}</rdf:li></rdf:Seq></dc:creator>` +
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${x(fields.Title)}</rdf:li></rdf:Alt></dc:title>` +
      `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${x(fields.Description)}</rdf:li></rdf:Alt></dc:description>` +
      `<exif:UserComment><rdf:Alt><rdf:li xml:lang="x-default">${x(fields.Description)}</rdf:li></rdf:Alt></exif:UserComment>` +
      `<xmp:CreatorTool>${x(fields.Software)}</xmp:CreatorTool>` +
      `<xmp:CreateDate>${x(fields['Creation Time'])}</xmp:CreateDate>` +
      '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  }

  async function addPngText(blob, fields) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ihdrEnd = 8 + 4 + 4 + 13 + 4;
    const chunks = Object.entries(fields)
      .filter(([, v]) => v)
      .map(([k, v]) => textChunk(k, String(v)));
    chunks.push(itxtChunk('XML:com.adobe.xmp', buildXmp(fields)));
    const extra = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(bytes.length + extra);
    out.set(bytes.subarray(0, ihdrEnd), 0);
    let offset = ihdrEnd;
    chunks.forEach((c) => { out.set(c, offset); offset += c.length; });
    out.set(bytes.subarray(ihdrEnd), offset);
    return new Blob([out], { type: 'image/png' });
  }

  /* ---------- Boot ---------- */

  el.btnRetry.addEventListener('click', init);
  loadAuthor();
  init();
})();
