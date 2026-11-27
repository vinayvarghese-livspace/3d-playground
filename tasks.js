(function () {
  'use strict';

  const AUTHOR_KEY = 'imageRenamer.author';
  const UPSCALE_KEY = 'imageRenamer.upscaleOn';
  const UPSCALE_URL = 'http://127.0.0.1:5175';
  const ANSWERLY_TOKEN_KEY = 'playground3d.answerly.token';
  const ANSWERLY_SIZE_KEY = 'playground3d.replace.imageSize';
  const ANSWERLY_MODEL_KEY = 'playground3d.replace.model';
  const PRODUCT_TYPE_KEY = 'playground3d.replace.productType';
  const ANSWERLY_SESSION_URL = 'https://answerly.livspace.com/api/auth/session';
  // Marketing Visualization Team workspace — job pages end with the Answerly execution id.
  const ANSWERLY_JOBS_BASE =
    'https://answerly.livspace.com/w/marketing-visualization-team-9901bfd2/jobs/';
  const IDB_NAME = 'playground3d';
  const IDB_STORE = 'replaceDrafts'; // legacy per-shot output rows
  const IDB_STORE_EAN = 'eanDrafts'; // full per-EAN Replacement drafts (A/B/C/D)
  const IDB_STORE_FEED = 'feedCache'; // last successful sheets feed (fast deep-link restore)
  const IDB_VERSION = 3;
  const FEED_CACHE_KEY = 'tasks';
  const FEED_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const ANSWERLY_MAX_BYTES = 52428800; // Answerly hard limit (~50 MB)
  const SERVICE_CHECK_MS = 10000;
  // Pick / Assign controls are only for these authors (matched on first name or full name).
  const ASSIGN_AUTHORS = ['vinay', 'aman', 'ananyo'];
  // Still appear in Artist history / past work; omitted from the Assign-to menu going forward.
  const HIDDEN_ASSIGN_ARTISTS = ['mansoor'];
  const RAIL_ZOOM_KEY = 'playground3d.replace.railZoom';
  const RAIL_WIDTH_KEY = 'playground3d.replace.railWidth';
  const RAIL_ZOOM_MIN = 0.4;
  const RAIL_ZOOM_MAX = 1;
  const RAIL_ZOOM_STEP = 0.1;
  const RAIL_WIDTH_MIN = 140;
  const RAIL_WIDTH_MAX = 360;
  const RAIL_WIDTH_DEFAULT = 220;
  // Old local picks key — cleared on load; assignments now live only in the assign / Render Tracker sheet.
  try { localStorage.removeItem('tasks.picks'); } catch (e) { /* ignore */ }

  // Web app URL (ends in /exec) of the HH Multi Sheet Reader Apps Script deployment, which reads
  // Shoot Tracker - HH, LSH-HH-Render Tracker and LSH-HH-Naming Convention-Test-2.
  const FEED_URL = 'https://script.google.com/a/macros/livspace.com/s/AKfycbxWbesitEd9mhiPkdLzZawNAb_AxwYWulrrBBA8ZqtYx5A9RX0lAGnybIQMle6W_7V8/exec';
  // Prompt Database Apps Script (Universal read + All user Rate & Approve). Separate from FEED_URL.
  const PROMPT_DB_URL = 'https://script.google.com/a/macros/livspace.com/s/AKfycbwjLPIuL9J_XtHmnEm7jdbnJHlUIEjscACqYiSIB3ISTQNXHDhKHAVyuOc9VuPaobHT/exec';
  // MTS Furniture Sheet Reader (Sheet1 only). Separate from FEED_URL — deploy dashboard/apps-script-mts-furniture.
  const MTS_FEED_URL = 'https://script.google.com/a/macros/livspace.com/s/AKfycbyMZSpmOfCpu4Dx45DjLN8et1TLqFcKRMATFgNwnZLZD_JYpn5WA0qMNuAM8tc_t-91mA/exec';
  // PDP Slides image extractor (Primary A2). Separate from FEED_URL — deploy dashboard/apps-script-pdp-slides.
  const PDP_SLIDES_URL = 'https://script.google.com/a/macros/livspace.com/s/AKfycbwqqezNL3I4DqQQEJoXWIbJyj-61oJpQrRr4ovIud8-V9CoMEJyJ8KPZcjswi5mJDNzIQ/exec';
  const FEED_TIMEOUT_MS = 90000;
  const FEED_VERSION = 40;
  const MTS_FEED_VERSION = 3;
  const CATALOG_KEY = 'tasks.catalog';
  function isPreviewApp() {
    return /preview\.html$/i.test(typeof location !== 'undefined' ? location.pathname : '');
  }
  const APP_VERSION = isPreviewApp() ? 'Preview V2.1' : 'Beta V2.0';
  // How often to re-read the assign sheet while this tab is visible (other users' picks).
  // ~2 reads/min per open browser — well under the Sheets ~60 reads/min/user cap.
  const ASSIGN_POLL_MS = 30000;

  const SHOOT_TABS_HH = [
    { category: 'Decor & Garden', tab: 'Decor and Garden' },
    { category: 'Table Top & Bath', tab: 'Table Top & Bath' },
    { category: 'Kitchen & Laundry', tab: 'Kitchen & Laundry' }
  ];
  const SHOOT_TABS = SHOOT_TABS_HH.concat([{ category: 'SF', tab: 'SF' }]);

  // Template reference images from Drive (thumbnails only).
  // Keys are the sheet value with spaces removed, lowercased: "SF 1" and "SF1" share sf1.
  // Folder: https://drive.google.com/drive/folders/1-Z-zDxQgUCI7AaPDcJCYveBihssvpEG1
  const TEMPLATE_REF_FOLDER_ID = '1-Z-zDxQgUCI7AaPDcJCYveBihssvpEG1';
  const TEMPLATE_IMAGES = {}; // match key → { id, name, thumb }
  let templateImagesLoading = false;
  let templateImagesPromise = null;
  // PDP slide image bytes keyed by objectId / contentUrl (shared across shot switches).
  const PDP_BYTE_CACHE = {};
  const PDP_BYTE_PENDING = {};
  const NAMING_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1BCUOtOmzYyMcfxptuwpSNOtvyN7PC7k792pljITUM8w/edit?pli=1&gid=476653278#gid=476653278';
  // Open as a Google Sheet (not the Drive file page) when checking pasted prop images.
  const PROP_SHEET_URL = 'https://docs.google.com/spreadsheets/d/12ckZ3NVf2bF08A7Lq6rFf08qK-gIz5mdQL65C-3l--U/';

  // Header aliases, compared on letters and digits only. An alias ending in * matches any header starting with it.
  // When several columns match (the tabs have helper copies of some columns), each row uses the first one with a value.
  const SHOOT_COLUMNS = {
    ean: ['ean code', 'ean'],
    department: ['department'],
    category: ['category'],
    subCategory: ['sub-category', 'sub category'],
    productName: ['product name*'],
    style: ['style'],
    // Prompt compiler product identity (synced from Shoot Tracker xlsx via shoot-sync).
    detailDescription: [
      'detail description - construction/quality',
      'detail description*',
      'construction/quality'
    ],
    color: ['color'],
    // Only headers that mention both Set and PCs (e.g. "SET / PCS"). Bare "set"/"pcs" matched the wrong columns.
    setPcs: ['set / pcs', 'pcs / set', 'set or pcs', 'setpcs', 'pcsset'],
    size: ['product size*', 'size*'],
    dimensions: ['product dimension*', 'dimension*'],
    capacity: ['product capacity*', 'capacity*'],
    // Exact header first so a helper column (e.g. one filled from the Naming Convention) is never used.
    shotList: ['mandatory shot list (sequence)', 'mandatory shot list', 'mandatory shot list*'],
    // Headers vary: "PDP Guideline", "PDP Guidelines", "PDP Link", or a longer label containing those words.
    pdpLink: ['pdp guideline*', 'pdp guidelines*', 'pdp link', 'pdp url', '~pdp guideline', '~guideline'],
    // Each tab names this column differently ("GDRIVE", "GDRIVE UPLOAD LINK", "GDRIVE AUTO LINK AI TESTING").
    driveLink: ['gdrive link', 'gdrive*', 'drive link', 'drive folder', 'ean folder', '~gdrive'],
    template: ['template mapping*'],
    functionalProp: ['functional prop*'],
    propsNeeded: ['styling/ props needed*', 'styling props*', 'props needed*'],
    shootStatus: ['photoshoot status*'],
    shootRemarks: ['photoshoot remarks*'],
    uploadStatus: ['upload status*'],
    uploadDate: ['upload date*'],
    shootDate: ['shoot date*']
  };
  // MTS Furniture Sheet1 — no PRODUCT NAME / STYLE / TEMPLATE; title from Detail Description;
  // PDP from Image/PPT link; Set/EACH from REMARKS; three size columns.
  const MTS_COLUMNS = {
    ean: ['ean code', 'ean'],
    department: ['department'],
    category: ['category'],
    subCategory: ['sub-category', 'sub category'],
    productName: ['detail description - construction/quality', 'detail description*'],
    detailDescription: ['detail description - construction/quality', 'detail description*'],
    range: ['range'],
    color: ['color'],
    setPcs: ['remarks (set/each)', 'remarks (set/each)*', 'set / pcs'],
    sizeW: ['product size mm w/l*', 'product size mm\nw/l*'],
    sizeD: ['product size mm d/l*', 'product size mm\nd/l*'],
    sizeHt: ['product size mm ht*', 'product size mm\nht*'],
    shotList: ['mandatory shot list (sequence)', 'mandatory shot list', 'mandatory shot list*'],
    collectionShoot: ['collection shoot', 'collection shot', 'collection*'],
    pdpLink: ['pdp guideline*', 'pdp guidelines*', 'pdp link', 'pdp url', '~pdp guideline', '~guideline'],
    driveLink: ['gdrive link', 'gdrive*', 'drive link', 'drive folder', '~gdrive'],
    propsNeeded: ['styling/ props needed*', 'styling props*', 'props needed*'],
    shootStatus: ['photoshoot status*'],
    shootRemarks: ['photoshoot remarks*'],
    uploadStatus: ['upload status*'],
    uploadDate: ['upload date*'],
    shootDate: ['shoot date*']
  };
  const LINK_COLUMNS = ['driveLink', 'pdpLink', 'outputLink'];
  const RENDER_COLUMNS = {
    ean: ['ean number', 'ean code', 'ean'],
    artist: ['artist'],
    // PDP Images dropdown on the Tracker / assign sheet (Not started, In progress, Blocked, Completed).
    // Active tab = first three; Completed tab = Completed only. Do not alias Photoshoot Status here.
    pdpImages: ['pdp images', 'pdp image', 'pdp images status', 'images status', 'pdp status'],
    photoshootStatus: ['photoshoot status'],
    startDate: ['start date'],
    endDate: ['end date'],
    // Output Drive folder on LSH-HH-Render Tracker (and later the same column on the assign sheet).
    outputLink: ['drive link', 'gdrive*', 'output folder', 'output link', 'drive folder'],
    marketingQc: ['marketing qc', 'marketing qc status', 'mkt qc', 'qc status', 'qc']
  };

  // Ordered so neighbouring groups get clearly different hues.
  const PALETTE = ['teal', 'rose', 'indigo', 'amber', 'sky', 'fuchsia', 'lime', 'violet', 'orange', 'cyan', 'pink', 'emerald', 'blue', 'yellow'];
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  const ICON = {
    chevron: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>',
    caret: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
    slides: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 8v8l5-4-5-4zm9-5H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
    prop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 4 6v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V6l-8-4zm-1 15-4-4 1.4-1.4L11 14.2l5.6-5.6L18 10l-7 7z"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>'
  };

  const STATUS = {
    not_started: { id: 'not_started', label: 'Not started' },
    in_progress: { id: 'in_progress', label: 'In progress' },
    blocked: { id: 'blocked', label: 'Blocked' },
    completed: { id: 'completed', label: 'Completed' }
  };
  const STATUS_CYCLE = ['not_started', 'in_progress', 'blocked', 'completed'];

  const state = {
    model: null,
    hhModel: null,
    mtsModel: null,
    // HH (default) | MTS Furniture. Available Tasks count always follows this catalog.
    catalog: (localStorage.getItem(CATALOG_KEY) === 'mts' ? 'mts' : 'hh'),
    loadedAt: null,
    view: 'renamer',
    myBucket: 'active',
    // UI mock only: null | { mode: 'choose'|'primary'|'replace', ean, focus, matchEan }
    workspace: null,
    workspaceShot: 0,
    author: localStorage.getItem(AUTHOR_KEY) || '',
    upscaleOn: localStorage.getItem(UPSCALE_KEY) !== 'false',
    service: 'checking',
    startFailed: false,
    startingUntil: 0,
    upscaleFolder: '',
    search: '',
    category: '',
    template: '',
    setKind: '',
    groupBy: 'subTemplate',
    artist: '',
    sort: 'oldest',
    collapsed: new Set(),
    selectedEan: null,
    drawerClosed: false,
    menuEans: null,
    images: {},
    photoIndex: -1,
    pendingAction: null,
    answerlyToken: null,
    driveFiles: null,
    answerlyModels: null,
    replaceDraftCache: {}, // in-memory EAN drafts so switching tasks keeps A/B/C/D
    primaryDraftCache: {}, // in-memory Primary drafts (A1/A2/A3/B/C/D + panel)
    renderMarkedInProgress: {},
    railScrollTop: null,
    mtsAuthNeeded: false,
  };

  function isMts() {
    return state.catalog === 'mts';
  }

  function syncCatalogUi() {
    document.body.classList.toggle('catalog-mts', isMts());
    document.body.classList.toggle('catalog-hh', !isMts());
    document.querySelectorAll('[data-catalog]').forEach((btn) => {
      const on = btn.dataset.catalog === state.catalog;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    const cat = isMts() ? 'MTS' : 'HH';
    const catEl = $('tab-cat-available');
    if (catEl) {
      catEl.textContent = cat;
      catEl.title = isMts() ? 'Showing MTS Furniture available tasks' : 'Showing HH available tasks';
    }
    const titleEl = $('view-title');
    if (titleEl && state.view === 'available') {
      titleEl.textContent = 'Available Tasks · ' + cat;
    }
    const hhGroup = document.querySelector('.tp-group-wrap[data-hh-only] .tp-seg');
    const mtsGroup = document.querySelector('.tp-group-wrap[data-mts-only] .tp-seg');
    if (hhGroup) {
      hhGroup.querySelectorAll('[data-group]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.group === state.groupBy);
      });
    }
    if (mtsGroup) {
      mtsGroup.querySelectorAll('[data-group]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.group === state.groupBy);
      });
    }
  }

  function setCatalog(next) {
    const catalog = next === 'mts' ? 'mts' : 'hh';
    if (state.catalog === catalog) return;
    state.catalog = catalog;
    try { localStorage.setItem(CATALOG_KEY, catalog); } catch (e) { /* ignore */ }
    state.model = catalog === 'mts' ? state.mtsModel : state.hhModel;
    state.category = '';
    state.template = '';
    state.artist = '';
    state.selectedEan = null;
    state.drawerClosed = false;
    state.collapsed.clear();
    // MTS has no template grouping / My Tasks yet.
    if (catalog === 'mts') {
      if (state.groupBy === 'subTemplate' || state.groupBy === 'productTemplate' || state.groupBy === 'template') {
        state.groupBy = 'subCategory';
      }
      closeWorkspace();
    } else if (state.groupBy === 'subCategory' || state.groupBy === 'product') {
      state.groupBy = 'subTemplate';
    }
    syncCatalogUi();
    if (catalog === 'mts' && state.mtsAuthNeeded) showMtsAuthDialog();
    else if (catalog !== 'mts') hideMtsAuthDialog();
    if (catalog === 'mts' && state.view === 'my') {
      setView('available', { syncHash: true });
      return;
    }
    if (state.model) {
      fillFilters();
      updateTabCounts();
      if (state.view !== 'renamer') render();
    } else {
      updateTabCounts();
    }
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    list: $('task-list'),
    count: $('task-count'),
    tabAvailable: $('tab-count-available'),
    tabMy: $('tab-count-my'),
    updated: $('updated-text'),
    synced: $('synced-text'),
    metaSynced: $('meta-synced'),
    sourcePill: $('source-pill'),
    settingsBtn: $('btn-settings'),
    settingsMenu: $('settings-menu'),
    search: $('search'),
    category: $('f-category'),
    template: $('f-template'),
    setKind: $('f-set'),
    artist: $('f-artist'),
    sort: $('sort'),
    drawer: $('drawer'),
    drawerBody: $('drawer-body'),
    menu: $('assign-menu'),
    toast: $('toast'),
    toastText: $('toast-text'),
    toastUndo: $('toast-undo'),
    nameModal: $('name-modal'),
    nameInput: $('name-input'),
    nameSave: $('name-save'),
    cropModal: $('crop-modal'),
    cropWindow: $('crop-window'),
    cropHead: $('crop-head'),
    cropTitle: $('crop-title'),
    cropHint: $('crop-hint'),
    cropStage: $('crop-stage'),
    cropSource: $('crop-source'),
    cropBox: $('crop-box'),
    cropCancel: $('crop-cancel'),
    cropConfirm: $('crop-confirm'),
    cropKeepProportion: $('crop-keep-proportion'),
    cropReset: $('crop-reset'),
    workspace: $('task-workspace'),
    myCountActive: $('my-count-active'),
    myCountCompleted: $('my-count-completed')
  };

  /* ---------- Helpers ---------- */

  // Last 4 digits in bold, the part people read out when tracking a product.
  function eanHtml(ean) {
    const s = String(ean || '');
    const head = s.length > 4 ? esc(s.slice(0, -4)) : '';
    return '<span class="tp-ean">' + head + '<b class="tp-ean-tail">' + esc(s.slice(-4)) + '</b></span>';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normHeader(h) {
    return String(h || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }

  function tidyName(s) {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    return t && t === t.toUpperCase() && /[A-Z]/.test(t) ? titleCase(t) : t;
  }

  function initials(s) {
    const words = String(s || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
  }

  // Vinay / Aman / Ananyo (and "Vinay …" full names) can Assign; everyone else cannot.
  // MTS Furniture has no Render Tracker / assign path yet.
  function canAssignTasks() {
    if (isMts()) return false;
    const n = String(state.author || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!n) return false;
    if (ASSIGN_AUTHORS.indexOf(n) >= 0) return true;
    const first = n.split(' ')[0];
    return ASSIGN_AUTHORS.indexOf(first) >= 0;
  }

  function isHiddenAssignArtist(name) {
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!n) return false;
    return HIDDEN_ASSIGN_ARTISTS.some((h) => n === h || n.indexOf(h + ' ') === 0);
  }

  function railZoomLevel() {
    const v = Number(localStorage.getItem(RAIL_ZOOM_KEY));
    if (!isFinite(v)) return RAIL_ZOOM_MAX;
    return Math.min(RAIL_ZOOM_MAX, Math.max(RAIL_ZOOM_MIN, Math.round(v * 100) / 100));
  }

  function setRailZoomLevel(next) {
    const v = Math.min(RAIL_ZOOM_MAX, Math.max(RAIL_ZOOM_MIN, Math.round(Number(next) * 100) / 100));
    localStorage.setItem(RAIL_ZOOM_KEY, String(v));
    applyRailLayoutPrefs();
    return v;
  }

  function railWidthPx() {
    const v = Number(localStorage.getItem(RAIL_WIDTH_KEY));
    if (!isFinite(v)) return RAIL_WIDTH_DEFAULT;
    return Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(v)));
  }

  function setRailWidthPx(next) {
    const v = Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(Number(next) || RAIL_WIDTH_DEFAULT)));
    localStorage.setItem(RAIL_WIDTH_KEY, String(v));
    applyRailLayoutPrefs();
    return v;
  }

  function applyRailLayoutPrefs() {
    const zoom = railZoomLevel();
    const width = railWidthPx();
    const root = document.documentElement;
    root.style.setProperty('--wr-rail-zoom', String(zoom));
    root.style.setProperty('--wr-rail-w', width + 'px');
    if (!els || !els.workspace) return;
    const rail = els.workspace.querySelector('.wr-rail');
    if (rail) {
      rail.style.setProperty('--wr-rail-zoom', String(zoom));
      rail.dataset.railZoom = zoom <= 0.55 ? 'dense' : (zoom <= 0.8 ? 'compact' : 'full');
    }
    const grid = els.workspace.querySelector('.wr-grid');
    if (grid) grid.style.setProperty('--wr-rail-w', width + 'px');
    const zoomLabel = els.workspace.querySelector('[data-wr-rail-zoom-label]');
    if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + '%';
    const zoomOut = els.workspace.querySelector('[data-ws="rail-zoom-out"]');
    const zoomIn = els.workspace.querySelector('[data-ws="rail-zoom-in"]');
    if (zoomOut) zoomOut.disabled = zoom <= RAIL_ZOOM_MIN + 0.001;
    if (zoomIn) zoomIn.disabled = zoom >= RAIL_ZOOM_MAX - 0.001;
  }

  // Hash routes: #renamer | #available | #my
  // Workspace deep-link: #my?ws=choose|replace|primary&ean=…&match=…&shot=…&drive=…
  function parseHash() {
    const raw = String(location.hash || '').replace(/^#\/?/, '');
    const qi = raw.indexOf('?');
    const path = (qi >= 0 ? raw.slice(0, qi) : raw).split('/')[0].toLowerCase();
    const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    const view = (path === 'renamer' || path === 'available' || path === 'my') ? path : '';
    return {
      view: view,
      ws: String(params.get('ws') || '').toLowerCase(),
      ean: String(params.get('ean') || '').trim(),
      match: String(params.get('match') || '').trim(),
      shot: params.get('shot'),
      drive: params.get('drive')
    };
  }

  function hashView() {
    return parseHash().view;
  }

  function syncHash(view, replace) {
    syncRoute({ view: view, replace: replace });
  }

  function syncRoute(opts) {
    opts = opts || {};
    const view = opts.view || state.view || 'renamer';
    let next = '#' + view;
    if (view === 'my' && state.workspace && state.workspace.ean) {
      const p = new URLSearchParams();
      p.set('ws', state.workspace.mode || 'choose');
      p.set('ean', String(state.workspace.ean));
      if (state.workspace.matchEan) p.set('match', String(state.workspace.matchEan));
      if (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') {
        p.set('shot', String(state.workspaceShot || 0));
        if (state.workspace.mode === 'replace' &&
            state.workspace.driveImgIndex != null && state.workspace.driveImgIndex !== '') {
          p.set('drive', String(state.workspace.driveImgIndex));
        }
      }
      next += '?' + p.toString();
    }
    if (location.hash === next) return;
    if (opts.replace !== false) history.replaceState(null, '', next);
    else location.hash = next.replace(/^#/, '');
  }

  function ensureRenamerFrame() {
    const frame = $('renamer-frame');
    if (!frame) return;
    if (!frame.getAttribute('src')) frame.setAttribute('src', 'renamer.html?embed=1');
    frame.hidden = false;
  }

  function isUrl(s) {
    return /^https?:\/\/\S+$/i.test(String(s || '').trim());
  }

  // Prefers a real http(s) URL; accepts docs.google.com pasted without a scheme.
  function pickUrl() {
    for (let i = 0; i < arguments.length; i++) {
      let s = String(arguments[i] == null ? '' : arguments[i]).trim();
      if (!s) continue;
      if (isUrl(s)) return s.replace(/[.,);]+$/, '');
      const bare = s.match(/^(?:https?:\/\/)?((?:docs|drive|slides)\.google\.com\/\S+)/i);
      if (bare) return (/^https?:\/\//i.test(s) ? s : 'https://' + bare[1]).replace(/[.,);]+$/, '');
      const embedded = s.match(/https?:\/\/\S+/i);
      if (embedded) return embedded[0].replace(/[.,);]+$/, '');
    }
    return '';
  }

  function folderIdFrom(link) {
    const m = String(link || '').match(/drive\.google\.com\/.*(?:\/folders\/|[?&]id=)([\w-]{10,})/);
    return m ? m[1] : '';
  }

  // Thumbnail only, never the full file. Drive's thumbnail link ends in a size such as "=s220"; it is swapped for
  // the width needed. Prefer lh3 hosted thumbs (work cross-origin); drive.google.com/thumbnail often blocked.
  function thumbUrl(img, width) {
    const w = width || 160;
    const t = String((img && img.thumb) || '');
    if (t) {
      if (/=[sw]\d+/i.test(t)) return t.replace(/=[sw]\d+(-[a-z0-9-]+)?$/i, '') + '=w' + w;
      return t;
    }
    if (img && img.id) return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(img.id) + '=w' + w;
    return '';
  }

  // Shoot folders: second image is the usual product preview. Output folders: first image.
  // MTS Furniture and SF: prefer the 3rd previewable image (index 2) when present.
  function prefersThirdThumb(task) {
    if (isMts() || (task && task.catalog === 'mts')) return true;
    return !!(task && String(task.category || '') === 'SF');
  }

  function defaultPhoto(list, preferFirst, task) {
    if (preferFirst) return 0;
    if (prefersThirdThumb(task)) {
      if (list.length > 2) return 2;
      return list.length ? list.length - 1 : 0;
    }
    return list.length > 1 ? 1 : 0;
  }

  // Camera RAW has no useful Drive thumbnail — never show in list/drawer.
  function isPreviewableImage(img) {
    const name = String((img && img.name) || '');
    if (/\.(cr3|cr2|crw|nef|nrw|arw|srf|sr2|dng|orf|raf|rw2|pef|ptx|raw|rwl|x3f|3fr|fff|iiq|kdc|dcr|mrw|mos|erf|mef)$/i.test(name)) {
      return false;
    }
    return true;
  }

  function previewImages(list) {
    return (Array.isArray(list) ? list : []).filter(isPreviewableImage);
  }

  // Completed My Tasks (and Completed prior-match drawers) preview the Render Tracker output folder.
  function useOutputPreview(t) {
    if (state.view !== 'my') return false;
    if (state.myBucket === 'completed') return true;
    return !!(t && isCompletedStatus(t));
  }

  function parseDate(s) {
    const v = String(s || '').trim();
    if (!v) return null;
    const year = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
    let m = v.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})$/);
    if (m && MONTHS[m[2].toLowerCase()] !== undefined) return new Date(year(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
    m = v.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (m) return new Date(year(m[3]), Number(m[2]) - 1, Number(m[1]));
    return null;
  }

  function colourAt(index) {
    return 'c-' + PALETTE[index % PALETTE.length];
  }

  // "T4" / "T2a" → T. "SF1" / "SF12a" → SF. T and SF are separate prediction series.
  function templateSeries(t) {
    const m = String(t || '').match(/^([A-Za-z]+)/);
    return m ? m[1].toUpperCase() : '';
  }

  function templateOrder(t) {
    const m = String(t || '').match(/^([A-Za-z]+)(\d+)([a-z])?(?:\s+(set(?:\s+of\s+(\d+))?))?$/i);
    if (!m) return 900000000;
    const series = m[1].toUpperCase();
    const seriesRank = series === 'T' ? 0 : 1000000 + (series.charCodeAt(0) * 1000) + (series.charCodeAt(1) || 0);
    const letter = m[3] ? m[3].toLowerCase().charCodeAt(0) - 96 : 0;
    const setOf = m[4] ? (m[5] ? Number(m[5]) : 50) : 0;
    return seriesRank + Number(m[2]) * 1000 + letter * 20 + setOf;
  }

  /* ---------- Sheet feed ---------- */

  // rows: 2D array with the header row first. links: optional map of "row,col" to the
  // hyperlink behind a cell, used when the cell only shows text such as "Open folder".
  // The returned list has a "missing" property naming the columns whose header wasn't found.
  function tableFrom(rows, columns, links) {
    if (!rows.length) return Object.assign([], { missing: Object.keys(columns) });
    // "GDRIVE LINK", "G-Drive Link" and "GDRIVE\nLINK" all squash to the same text.
    const squash = (s) => normHeader(s).replace(/[^a-z0-9]/g, '');
    const headers = rows[0].map(squash);
    const index = {};
    Object.keys(columns).forEach((key) => {
      const cols = [];
      columns[key].forEach((a) => {
        const want = squash(a);
        headers.forEach((h, c) => {
          const hit = /^~/.test(a) ? h.includes(want) : /\*$/.test(a) ? h.startsWith(want) : h === want;
          if (hit && h && !cols.includes(c)) cols.push(c);
        });
      });
      // Catch renamed headers such as "SET/PCS", "Set - Pcs", or MTS "REMARKS (Set/EACH)".
      if (key === 'setPcs') {
        headers.forEach((h, c) => {
          if (h && /set/.test(h) && (/pcs/.test(h) || /each/.test(h)) && !cols.includes(c)) cols.push(c);
        });
        cols.sort((a, b) => headers[b].length - headers[a].length);
        if (!cols.length) {
          const c = setColumnByValues_(rows);
          if (c >= 0) cols.push(c);
        }
      }
      index[key] = cols;
    });
    const keys = Object.keys(index);
    const missing = keys.filter((k) => !index[k].length);
    const folderByRow = {};
    Object.keys(links || {}).forEach((k) => {
      const row = k.split(',')[0];
      if (!folderByRow[row] && folderIdFrom(links[k])) folderByRow[row] = links[k];
    });
    // Link columns use the hyperlink; every other column keeps the cell text, and a hyperlink on it is kept as <key>Url.
    return Object.assign(rows.slice(1).map((r, n) => {
      const rec = { rowNumber: n + 2, rowFolder: folderByRow[n + 1] || '' };
      keys.forEach((k) => {
        const cells = index[k]
          .map((c) => ({ text: String(r[c] == null ? '' : r[c]).trim(), link: (links && links[(n + 1) + ',' + c]) || '' }))
          .filter((x) => x.text || x.link);
        if (k === 'shotList') {
          rec[k] = cells[0] ? cells[0].text : '';
        } else if (LINK_COLUMNS.includes(k)) {
          rec[k] = pickUrl.apply(null, cells.map((x) => x.link).concat(cells.map((x) => x.text))) ||
            (cells[0] ? cells[0].link || cells[0].text : '');
        } else if (k === 'setPcs') {
          rec[k] = pickSetValue_(cells.map((x) => x.text).filter(Boolean));
        } else {
          const cell = cells.find((x) => x.text) || cells[0];
          rec[k] = cell ? cell.text || cell.link : '';
          if (cell && cell.link) rec[k + 'Url'] = cell.link;
        }
      });
      return rec;
    }).filter((rec) => keys.some((k) => rec[k])), { missing });
  }

  // A tab whose Set / PCs header has another name: the column where most filled cells read PCs, EACH, Set or Set of N.
  function setColumnByValues_(rows) {
    const re = /^(pcs?|pieces?|each|sets?|set\s*of\s*\d+)$/i;
    let best = -1;
    let bestHits = 0;
    (rows[0] || []).forEach((h, c) => {
      let filled = 0;
      let hits = 0;
      rows.slice(1).forEach((r) => {
        const v = String(r[c] == null ? '' : r[c]).trim();
        if (!v) return;
        filled++;
        if (re.test(v)) hits++;
      });
      if (filled && hits / filled >= 0.8 && hits > bestHits) { best = c; bestHits = hits; }
    });
    return best;
  }

  // Prefer "SET OF 2" / "Set" over a stray "PCs"/"EACH" copied into a helper column on the same row.
  function pickSetValue_(vals) {
    if (!vals.length) return '';
    const rank = (v) => (/set\s*of\s*\d+/i.test(v) ? 0 : /^set\b/i.test(v) ? 1 : /^(each|pc)/i.test(v) ? 3 : 2);
    return vals.slice().sort((a, b) => rank(a) - rank(b) || b.length - a.length)[0];
  }

  function normTab(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  }

  // The sheets are organisation-only, so the feed is loaded with a <script> tag (JSONP):
  // the request carries the user's Google sign-in, which fetch() across origins would not.
  let jsonpSeq = 0;
  function jsonp(query, timeoutMs, baseUrl) {
    const root = baseUrl || FEED_URL;
    return new Promise((resolve, reject) => {
      if (!root) {
        reject(new Error(baseUrl ? 'PROMPT_DB_URL is not set.' : 'NO_FEED_URL'));
        return;
      }
      const cb = '__tasksFeed' + Date.now() + '_' + (jsonpSeq++);
      const script = document.createElement('script');
      let finished = false;
      const timer = setTimeout(() => finish(new Error('The sheet feed took too long to answer.')), timeoutMs);
      function finish(err, data) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window[cb] = function () {};
        script.remove();
        if (err) reject(err); else resolve(data);
      }
      window[cb] = (res) => {
        if (res && res.ok) finish(null, res.data);
        else finish(new Error((res && res.error) || 'The sheet feed sent an empty answer.'));
      };
      script.onerror = () => finish(new Error('NO_ACCESS'));
      // Only treat a silent load as failure — the JSONP callback normally runs before onload.
      script.onload = () => setTimeout(() => {
        if (!finished) finish(new Error('NO_ACCESS'));
      }, 250);
      script.src = root + (root.indexOf('?') >= 0 ? '&' : '?') + query + '&callback=' + cb + '&t=' + Date.now();
      document.head.appendChild(script);
    });
  }

  function buildTaskDataFromFeed(feed) {
    const warnings = [];
    if (!(feed.version >= FEED_VERSION)) {
      warnings.push('the web app is an older version (' + (feed.version || 'no version') + ', expected ' + FEED_VERSION + '): paste the latest Code.gs and deploy a new version');
    }
    const shoot = [];
    SHOOT_TABS.forEach((src) => {
      const tab = (feed.shoot || []).find((t) => normTab(t.tab) === normTab(src.tab));
      if (!tab || tab.error) { warnings.push(src.tab + ': ' + (tab ? tab.error : 'not returned')); return; }
      const rows = tableFrom(tab.values, SHOOT_COLUMNS, tab.links);
      const required = ['ean', 'template', 'setPcs'].concat(rows.some((r) => r.rowFolder) ? [] : ['driveLink']);
      const lost = missingNames(rows, SHOOT_COLUMNS, required);
      if (lost) warnings.push(src.tab + ': columns not found: ' + lost);
      shoot.push({ category: src.category, rows, modified: tab.modified });
    });
    if (!shoot.length) {
      const available = (feed.availableShootTabs && feed.availableShootTabs.length)
        ? ' Tabs currently in the Shoot Tracker: ' + feed.availableShootTabs.map((t) => '"' + t + '"').join(', ') + '.'
        : '';
      throw new Error('No Shoot Tracker tabs could be read. ' + warnings.join(' ') + available +
        ' Expected: ' + SHOOT_TABS.map((s) => '"' + s.tab + '"').join(', ') + '.');
    }
    if (feed.render && feed.render.error) warnings.push('Render Tracker: ' + feed.render.error);
    const render = tableFrom((feed.render && feed.render.values) || [], RENDER_COLUMNS);
    const lostRender = missingNames(render, RENDER_COLUMNS, ['ean', 'artist']);
    if (lostRender) warnings.push('Render Tracker: columns not found: ' + lostRender);
    // Picks written to the assign test sheet also count as assigned (EAN + Artist).
    // When the EAN is already on the Render Tracker, copy newer PDP Images / output link fields across.
    if (feed.assigns && feed.assigns.error) warnings.push('Assign sheet: ' + feed.assigns.error);
    if (feed.assigns && feed.assigns.values && feed.assigns.values.length) {
      const assigns = tableFrom(feed.assigns.values, RENDER_COLUMNS);
      const byEan = new Map();
      render.forEach((r) => {
        if (r.ean && String(r.artist || '').trim()) byEan.set(r.ean, r);
      });
      assigns.forEach((r) => {
        if (!r.ean || !String(r.artist || '').trim()) return;
        const existing = byEan.get(r.ean);
        if (!existing) {
          render.push(r);
          byEan.set(r.ean, r);
          return;
        }
        if (r.pdpImages) existing.pdpImages = r.pdpImages; // live Render Tracker is the assign write target
        if (r.outputLink && isUrl(r.outputLink)) existing.outputLink = r.outputLink;
        if (r.marketingQc) existing.marketingQc = r.marketingQc;
        if (r.startDate && !existing.startDate) existing.startDate = r.startDate;
        if (r.endDate && !existing.endDate) existing.endDate = r.endDate;
      });
    }

    return { shoot, render, warnings, xlsxSync: feed.xlsxSync || null };
  }

  function parseFurnitureFeed(mtsFeed, warnings) {
    const furniture = { rows: [], modified: '', error: '' };
    if (!mtsFeed) {
      if (!MTS_FEED_URL) {
        warnings.push('MTS Furniture: MTS_FEED_URL is not set — deploy dashboard/apps-script-mts-furniture and paste the /exec URL');
      }
      return furniture;
    }
    if (!(mtsFeed.version >= MTS_FEED_VERSION)) {
      warnings.push('MTS Furniture: web app is an older version (' + (mtsFeed.version || 'no version') +
        ', expected ' + MTS_FEED_VERSION + ')');
    }
    const block = mtsFeed.furniture || mtsFeed;
    if (block.error) {
      furniture.error = block.error;
      warnings.push('MTS Furniture: ' + block.error);
      return furniture;
    }
    if (!block.values || !block.values.length) {
      warnings.push('MTS Furniture: Sheet1 returned no rows');
      return furniture;
    }
    const rows = tableFrom(block.values, MTS_COLUMNS, block.links);
    attachMtsPdpUrls_(rows, block.values, block.links || {}, block.multiLinks || {});
    const required = ['ean', 'driveLink', 'pdpLink'];
    const lost = missingNames(rows, MTS_COLUMNS, required);
    if (lost) warnings.push('MTS Furniture: columns not found: ' + lost);
    return { rows, modified: block.modified || '', error: '' };
  }

  // Attach every PDP URL for a cell (chips + raw URLs). links key uses tableFrom's 1-based data rows.
  function attachMtsPdpUrls_(rows, values, links, multiLinks) {
    const headers = (values && values[0]) || [];
    const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9]/g, '');
    let pdpCol = -1;
    headers.forEach((h, c) => {
      const n = squash(h);
      if (pdpCol < 0 && (n.indexOf('pdpguideline') === 0 || n === 'pdplink' || n.indexOf('guideline') >= 0)) pdpCol = c;
    });
    if (pdpCol < 0) return;
    rows.forEach((rec, n) => {
      const key = (n + 1) + ',' + pdpCol;
      const fromMulti = multiLinks[key] || [];
      const fromLink = links[key] ? [links[key]] : [];
      const cellText = values[n + 1] ? values[n + 1][pdpCol] : '';
      const fromText = allHttpUrls(cellText);
      const urls = uniqueUrls([].concat(fromMulti, fromLink, fromText, rec.pdpLink || [], rec.pdpLinkUrl || []));
      rec.pdpUrls = urls;
      if (urls.length && !rec.pdpLink) rec.pdpLink = urls[0];
    });
  }

  async function loadTaskData(opts) {
    opts = opts || {};
    if (!FEED_URL) throw new Error('NO_FEED_URL');
    let feed = opts.feed || null;
    // HH only here — MTS is loaded in the background so a slow/broken MTS deploy cannot block HH.
    if (!feed) feed = await jsonp('action=tasks', FEED_TIMEOUT_MS, FEED_URL);
    const data = buildTaskDataFromFeed(feed);
    if (opts.mtsFeed) {
      if (opts.mtsFeed.__mtsError) {
        data.warnings.push('MTS Furniture: ' + opts.mtsFeed.__mtsError);
        data.furniture = { rows: [], modified: '', error: opts.mtsFeed.__mtsError };
      } else {
        data.furniture = parseFurnitureFeed(opts.mtsFeed, data.warnings);
      }
    } else {
      data.furniture = { rows: [], modified: '', error: '' };
    }
    // Cache successful live feeds so deep-link reload can restore the EAN workspace without waiting.
    if (!opts.feed && !opts.skipCache) saveFeedCache(feed);
    return data;
  }

  let mtsLoading = false;
  let mtsAuthWatch = null;
  let pdpAuthWatch = null;

  function mtsAuthPageUrl() {
    if (!MTS_FEED_URL) return '';
    return MTS_FEED_URL + (MTS_FEED_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=ping';
  }

  function pdpAuthPageUrl() {
    if (!PDP_SLIDES_URL) return '';
    return PDP_SLIDES_URL + (PDP_SLIDES_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=ping';
  }

  function pdpNeedsAuth(err) {
    const msg = String((err && err.message) || err || '');
    return msg === 'NO_ACCESS' || /authoriz|permission|access denied|login/i.test(msg);
  }

  function ensurePdpAuthDialog() {
    let dlg = document.getElementById('pdp-auth-dialog');
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.id = 'pdp-auth-dialog';
    dlg.className = 'mts-auth-dialog';
    dlg.hidden = true;
    dlg.innerHTML =
      '<div class="mts-auth-card" role="dialog" aria-modal="true" aria-labelledby="pdp-auth-title">' +
        '<h2 id="pdp-auth-title">Allow Google access</h2>' +
        '<p>Primary A2 loads camera references from the PDP Google Slides deck. The first time you open it, Google asks for permission.</p>' +
        '<ol>' +
          '<li>Click <strong>Allow access</strong>.</li>' +
          '<li>In the Google window, choose your Livspace account and click <strong>Allow</strong>.</li>' +
          '<li>Close that window. PDP images load on their own.</li>' +
        '</ol>' +
        '<button type="button" class="tp-btn tp-btn-primary mts-auth-allow" id="pdp-auth-allow">Allow access</button>' +
        '<button type="button" class="tp-btn mts-auth-retry" id="pdp-auth-retry">I already allowed it</button>' +
        '<p class="mts-auth-status" id="pdp-auth-status"></p>' +
        '<a class="mts-auth-fallback" id="pdp-auth-fallback" hidden target="_blank" rel="noopener">Open the access page in a new tab</a>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#pdp-auth-allow').addEventListener('click', openPdpAuthPopup);
    dlg.querySelector('#pdp-auth-retry').addEventListener('click', () => {
      setPdpAuthStatus('Checking access…');
      retryPdpSlidesAfterAuth();
    });
    return dlg;
  }

  function setPdpAuthStatus(text) {
    const note = document.getElementById('pdp-auth-status');
    if (note) note.textContent = text || '';
  }

  function showPdpAuthDialog(status) {
    const dlg = ensurePdpAuthDialog();
    dlg.hidden = false;
    setPdpAuthStatus(status || '');
  }

  function hidePdpAuthDialog() {
    const dlg = document.getElementById('pdp-auth-dialog');
    if (dlg) dlg.hidden = true;
    setPdpAuthStatus('');
  }

  function openPdpAuthPopup() {
    const url = pdpAuthPageUrl();
    if (!url) {
      showPdpAuthDialog('PDP slides URL is not configured.');
      return;
    }
    const fallback = document.getElementById('pdp-auth-fallback');
    const popup = window.open(url, 'pdpSlidesAuth', 'popup=yes,width=560,height=720');
    if (!popup) {
      if (fallback) {
        fallback.hidden = false;
        fallback.href = url;
      }
      showPdpAuthDialog('The Google window was blocked. Use the link below.');
      return;
    }
    if (fallback) fallback.hidden = true;
    showPdpAuthDialog('Finish Allow in the Google window, then close it.');
    if (pdpAuthWatch) clearInterval(pdpAuthWatch);
    pdpAuthWatch = setInterval(() => {
      if (popup && !popup.closed) return;
      clearInterval(pdpAuthWatch);
      pdpAuthWatch = null;
      retryPdpSlidesAfterAuth();
    }, 600);
  }

  function retryPdpSlidesAfterAuth() {
    if (!state.workspace || state.workspace.mode !== 'primary' || !state.workspace.primary) {
      hidePdpAuthDialog();
      return;
    }
    setPdpAuthStatus('Checking access…');
    const p = state.workspace.primary;
    p.pdpAttempted = false;
    p.pdpLoading = false;
    p.pdpError = '';
    p.pdp = null;
    const t = taskByEan(state.workspace.ean);
    schedulePrimaryPdpLoad(t);
  }

  function ensureMtsAuthDialog() {
    let dlg = document.getElementById('mts-auth-dialog');
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.id = 'mts-auth-dialog';
    dlg.className = 'mts-auth-dialog';
    dlg.hidden = true;
    dlg.innerHTML =
      '<div class="mts-auth-card" role="dialog" aria-modal="true" aria-labelledby="mts-auth-title">' +
        '<h2 id="mts-auth-title">Allow Google access</h2>' +
        '<p>MTS Furniture reads a separate Livspace sheet. The first time you open it, Google asks for permission.</p>' +
        '<ol>' +
          '<li>Click <strong>Allow access</strong>.</li>' +
          '<li>In the Google window, choose your Livspace account and click <strong>Allow</strong>.</li>' +
          '<li>Close that window. MTS loads on its own.</li>' +
        '</ol>' +
        '<button type="button" class="tp-btn tp-btn-primary mts-auth-allow" id="mts-auth-allow">Allow access</button>' +
        '<button type="button" class="tp-btn mts-auth-retry" id="mts-auth-retry">I already allowed it</button>' +
        '<p class="mts-auth-status" id="mts-auth-status"></p>' +
        '<a class="mts-auth-fallback" id="mts-auth-fallback" hidden target="_blank" rel="noopener">Open the access page in a new tab</a>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#mts-auth-allow').addEventListener('click', openMtsAuthPopup);
    dlg.querySelector('#mts-auth-retry').addEventListener('click', () => {
      setMtsAuthStatus('Checking access…');
      loadMtsFeedInBackground();
    });
    return dlg;
  }

  function setMtsAuthStatus(text) {
    const note = document.getElementById('mts-auth-status');
    if (note) note.textContent = text || '';
  }

  function showMtsAuthDialog(status) {
    const dlg = ensureMtsAuthDialog();
    dlg.hidden = false;
    setMtsAuthStatus(status || '');
  }

  function hideMtsAuthDialog() {
    const dlg = document.getElementById('mts-auth-dialog');
    if (dlg) dlg.hidden = true;
    setMtsAuthStatus('');
  }

  function mtsNeedsAuth(err) {
    const msg = String((err && err.message) || err || '');
    return msg === 'NO_ACCESS' || /authoriz|permission/i.test(msg);
  }

  function openMtsAuthPopup() {
    const url = mtsAuthPageUrl();
    if (!url) return;
    const fallback = document.getElementById('mts-auth-fallback');
    const popup = window.open(url, 'mtsFeedAuth', 'popup=yes,width=560,height=720');
    if (!popup) {
      if (fallback) {
        fallback.hidden = false;
        fallback.href = url;
      }
      showMtsAuthDialog('The Google window was blocked. Use the link below.');
      return;
    }
    if (fallback) fallback.hidden = true;
    showMtsAuthDialog('Finish Allow in the Google window, then close it.');
    if (mtsAuthWatch) clearInterval(mtsAuthWatch);
    mtsAuthWatch = setInterval(() => {
      if (popup && !popup.closed) return;
      clearInterval(mtsAuthWatch);
      mtsAuthWatch = null;
      loadMtsFeedInBackground();
    }, 600);
  }

  async function loadMtsFeedInBackground() {
    if (!MTS_FEED_URL || mtsLoading) return;
    mtsLoading = true;
    try {
      const mtsFeed = await jsonp('action=tasks', FEED_TIMEOUT_MS, MTS_FEED_URL);
      const warnings = [];
      const furniture = parseFurnitureFeed(mtsFeed, warnings);
      state.mtsModel = buildMtsModel({ furniture: furniture, warnings: warnings });
      if (warnings.length && isMts()) {
        showToast('MTS: ' + warnings.join('; '), false);
      }
      if (isMts()) {
        state.model = state.mtsModel;
        fillFilters();
        updateTabCounts();
        if (state.view !== 'renamer') {
          render();
          loadImages();
        }
      } else {
        updateTabCounts();
      }
      syncCatalogUi();
      state.mtsAuthNeeded = false;
      hideMtsAuthDialog();
    } catch (err) {
      const msg = String((err && err.message) || err || 'MTS feed failed');
      const needsAuth = mtsNeedsAuth(err);
      state.mtsAuthNeeded = needsAuth;
      state.mtsModel = buildMtsModel({
        furniture: { rows: [], modified: '', error: msg },
        warnings: ['MTS Furniture: ' + msg]
      });
      if (isMts()) {
        state.model = state.mtsModel;
        fillFilters();
        updateTabCounts();
        if (state.view !== 'renamer') render();
        if (needsAuth) showMtsAuthDialog();
        else showToast('MTS Furniture could not be read: ' + esc(msg), false, { error: true });
      }
    } finally {
      mtsLoading = false;
    }
  }

  function missingNames(table, columns, required) {
    return table.missing.filter((k) => required.includes(k)).map((k) => columns[k][0].toUpperCase()).join(', ');
  }

  /* ---------- Model ---------- */

  // One entry per line of the Mandatory Shot List cell. The row count and the Required Shots list both use this.
  // A line that only continues the previous one, e.g. "( Base )" on its own line, is joined back to it.
  function parseShots(text) {
    let raw = String(text || '').replace(/\u00a0/g, ' ');
    // MTS (and some HH) cells use a lone "+" between shot groups — drop it, keep the shots.
    raw = raw.replace(/(?:^|\n)\s*\+\s*(?=\n|$)/g, '\n');
    // Split jammed numbered items on one line: "2.Hero … 3.Top-down"
    raw = raw.replace(/(\S)(?=\d+[.)]\s*[A-Za-z])/g, '$1\n');
    const lines = raw
      .split(/\r\n|\r|\n|\u2022/)
      .map((l) => l.replace(/^\s*(\d+[.)]|[-*.])\s+/, '').trim())
      .filter((l) => l && !/^[-–.,+]+$/.test(l));
    const out = [];
    lines.forEach((l) => {
      if (out.length && /^[(&,]/.test(l)) out[out.length - 1] += ' ' + l;
      else out.push(l);
    });
    return out.map((name) => ({ name }));
  }

  function allHttpUrls(text) {
    const out = [];
    const seen = new Set();
    const re = /https?:\/\/[^\s<>"']+/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const url = m[0].replace(/[.,);]+$/, '');
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  function uniqueUrls(list) {
    const out = [];
    const seen = new Set();
    (list || []).forEach((u) => {
      const url = String(u || '').trim();
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    });
    return out;
  }

  function pdpLinksOf(t) {
    if (!t) return [];
    if (Array.isArray(t.pdpLinks) && t.pdpLinks.length) return t.pdpLinks;
    return t.pdpLink ? [t.pdpLink] : [];
  }

  // Sheet value as-is, except spaces inside the code are ignored so
  // "SF 1" and "SF1" are one template, and "T 4" still matches "T4".
  // A trailing "set" / "set of N" keeps its space: "T7 set" stays "T7 set".
  function tidyTemplate(s) {
    const collapsed = String(s || '').trim().replace(/\s+/g, ' ');
    if (!collapsed) return '';
    const set = collapsed.match(/^(.*?)(\s+set(?:\s+of\s+\d+)?)$/i);
    if (set && set[1].trim()) {
      return set[1].replace(/ /g, '') + set[2].toLowerCase().replace(/\s+/g, ' ');
    }
    return collapsed.replace(/ /g, '');
  }

  // Image and prompt matching. Case and spaces do not matter.
  function templateMatchKey(s) {
    return tidyTemplate(s).toLowerCase().replace(/ /g, '');
  }

  function templateCodeFromFileName(name) {
    // Ignore nested paths (subfolders); only top-level files such as "SF1.jpg" / "T 4.png".
    const base = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
    if (!base || base.indexOf('/') >= 0) return '';
    return tidyTemplate(base.replace(/\.[^.]+$/, ''));
  }

  function rebuildTemplateImageMap(list) {
    Object.keys(TEMPLATE_IMAGES).forEach((k) => { delete TEMPLATE_IMAGES[k]; });
    (Array.isArray(list) ? list : []).forEach((img) => {
      if (!img || !img.id) return;
      const rawName = String(img.name || '');
      // Prefer root-level files; still index nested ones by basename (e.g. Edited/T9.jpg).
      const baseName = rawName.replace(/\\/g, '/').split('/').pop() || '';
      const nested = rawName.indexOf('/') >= 0;
      const key = templateMatchKey(templateCodeFromFileName(baseName));
      if (!key) return;
      const existing = TEMPLATE_IMAGES[key];
      if (!existing) {
        TEMPLATE_IMAGES[key] = img;
        return;
      }
      // Root-level wins over nested when both match the same code.
      const existingNested = String(existing.name || '').indexOf('/') >= 0;
      if (existingNested && !nested) TEMPLATE_IMAGES[key] = img;
    });
  }

  // Drive file whose name matches the sheet value, ignoring spaces and case.
  // "T7 set" also falls back to a file named "T7". T9 also tries T09.
  function templateRefImage(template) {
    const label = tidyTemplate(template);
    if (!label) return null;
    const key = templateMatchKey(label);
    if (TEMPLATE_IMAGES[key]) return TEMPLATE_IMAGES[key];
    const base = label.replace(/\s+set(?:\s+of\s+\d+)?$/i, '').trim();
    const baseKey = templateMatchKey(base);
    if (baseKey && baseKey !== key && TEMPLATE_IMAGES[baseKey]) return TEMPLATE_IMAGES[baseKey];
    // Letter + digits: try zero-padded / unpadded variants (T9 ↔ T09).
    const m = String(baseKey || key).match(/^([a-z]+)0*(\d+)$/i);
    if (m) {
      const letter = m[1].toLowerCase();
      const num = String(Number(m[2]));
      const candidates = [
        letter + num,
        letter + num.padStart(2, '0'),
        letter + num.padStart(3, '0')
      ];
      for (let i = 0; i < candidates.length; i++) {
        if (TEMPLATE_IMAGES[candidates[i]]) return TEMPLATE_IMAGES[candidates[i]];
      }
      const keys = Object.keys(TEMPLATE_IMAGES);
      for (let i = 0; i < keys.length; i++) {
        const km = keys[i].match(/^([a-z]+)0*(\d+)$/i);
        if (km && km[1].toLowerCase() === letter && String(Number(km[2])) === num) {
          return TEMPLATE_IMAGES[keys[i]];
        }
      }
    }
    return null;
  }

  async function loadTemplateRefImages(force) {
    const cached = state.images[TEMPLATE_REF_FOLDER_ID];
    if (!force && Array.isArray(cached)) {
      if (!Object.keys(TEMPLATE_IMAGES).length) rebuildTemplateImageMap(cached);
      return cached;
    }
    if (!force && cached === 'error') {
      throw new Error('Template folder failed to load earlier — refresh the page.');
    }
    if (templateImagesPromise) return templateImagesPromise;
    templateImagesLoading = true;
    state.images[TEMPLATE_REF_FOLDER_ID] = 'loading';
    templateImagesPromise = jsonp('action=thumbs&ids=' + encodeURIComponent(TEMPLATE_REF_FOLDER_ID), 60000)
      .then((found) => {
        const list = (found && found[TEMPLATE_REF_FOLDER_ID]) || [];
        state.images[TEMPLATE_REF_FOLDER_ID] = list;
        rebuildTemplateImageMap(list);
        applyTemplateImages();
        return list;
      })
      .catch((err) => {
        console.error(err);
        state.images[TEMPLATE_REF_FOLDER_ID] = 'error';
        throw err;
      })
      .finally(() => {
        templateImagesLoading = false;
        templateImagesPromise = null;
      });
    return templateImagesPromise;
  }

  function applyTemplateImages() {
    if (els.list) {
      els.list.querySelectorAll('.tp-tpl-thumb[data-tpl]').forEach((el) => {
        const tpl = el.getAttribute('data-tpl') || '';
        const next = templateThumb(tpl);
        if (el.outerHTML !== next) el.outerHTML = next;
      });
    }
    if (els.drawerBody && !els.drawer.hidden && state.selectedEan) {
      const t = taskByEan(state.selectedEan);
      const ref = els.drawerBody.querySelector('.tp-tpl-ref');
      if (t && ref) ref.innerHTML = templateRefBody(t.template);
    }
  }

  function templateRefBody(template) {
    const img = templateRefImage(template);
    if (img) {
      const fileId = img.id || '';
      const fileName = img.name || ((template || 'template') + '.png');
      return '<img src="' + esc(thumbUrl(img, 480)) + '" alt="Template ' + esc(template || '') +
        ' reference" loading="lazy" referrerpolicy="no-referrer">' +
        (fileId
          ? '<button type="button" class="wr-out-download tp-tpl-download" data-ws-download-tpl="' +
              esc(fileId) + '" data-ws-download-name="' + esc(fileName) +
              '" title="Download original high-quality template" aria-label="Download original template">' +
              ICON.download +
            '</button>'
          : '');
    }
    if (state.images[TEMPLATE_REF_FOLDER_ID] === 'loading') {
      return 'Loading template reference…';
    }
    if (template) return 'No reference image mapped for ' + esc(template) + ' yet.';
    return 'No template mapped for this product.';
  }

  async function downloadTemplateRefOriginal(fileId, fileName) {
    const id = String(fileId || '').trim();
    if (!id) {
      showToast('No template file to download.', false, { error: true });
      return;
    }
    showToast('Downloading original template…', false);
    try {
      const asset = await fetchDriveFileAsset(id);
      const name = (asset && asset.name) || fileName || (id + '.png');
      downloadBlobFile(asset.blob || asset.file, name);
      showToast('Downloading ' + esc(name) + '…', false);
    } catch (err) {
      showToast((err && err.message) || 'Could not download template.', false, { error: true });
    }
  }

  function tidySet(s) {
    const v = String(s || '').trim();
    if (!v) return { label: '', kind: '' };
    const of = v.match(/set\s*of\s*(\d+)/i);
    if (of) return { label: 'Set of ' + of[1], kind: 'set' };
    if (/^sets?\b/i.test(v) || /\bset\b/i.test(v)) return { label: titleCase(v).replace(/\bOf\b/, 'of'), kind: 'set' };
    // MTS Furniture uses EACH instead of PCs.
    if (/^each\b/i.test(v)) return { label: 'EACH', kind: 'pcs' };
    if (/pc/i.test(v)) return { label: 'PCs', kind: 'pcs' };
    return { label: v, kind: 'other' };
  }

  // MTS "COLLECTION SHOOT" column — keep sheet value; blank / NO hidden. UI shows "collection shot- <value>".
  function tidyCollectionShoot(s) {
    const v = String(s || '').trim();
    if (!v) return '';
    if (/^(n|no|false|0|na|n\/?a|nil|none|-|–|—)$/i.test(v)) return '';
    return v;
  }

  function collectionShootLabel(value) {
    const v = String(value || '').trim();
    return v ? ('collection shot- ' + v) : '';
  }

  // Template rows carry defaults such as "0", "-" or "NA" in columns nobody filled in; those count as empty.
  function realValue(v) {
    const s = String(v == null ? '' : v).trim();
    return /^(0+(\.0+)?|-+|–|n\.?a\.?|nil|none|null|#n\/a)$/i.test(s) ? '' : s;
  }

  function propsNeeded(v) {
    return /^(y|yes|true|1)$/i.test(String(v || '').trim());
  }

  // Available Tasks: template mapping + real GDRIVE folder link, and not already on the Render Tracker.
  // Photoshoot / Upload Status are not gates — Upload can say "Done" with no folder link.

  // The whole cell text is shown as written, with URLs in it clickable. A hyperlink on the cell itself is added
  // after the text. A cell with neither text nor link only holds a pasted image.
  function classifyProp(text, cellUrl) {
    const v = String(text || '').trim();
    const url = isUrl(cellUrl) ? cellUrl.trim() : '';
    if (!v && !url) return { kind: 'image', html: '' };
    let html = v ? linkifyProp_(v) : '';
    if (url && v.indexOf(url) < 0) {
      html += (html ? ' ' : '') + '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + (v ? 'Open link' : esc(url)) + '</a>';
    }
    return { kind: 'text', html };
  }

  // Turns each http(s) URL into a link. Trailing "." / "," after a URL (common in the sheet) is left as plain text.
  function linkifyProp_(text) {
    const re = /https?:\/\/[^\s<>"']+/gi;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      let url = m[0];
      let tail = '';
      while (/[.,);:]+$/.test(url)) {
        tail = url.slice(-1) + tail;
        url = url.slice(0, -1);
      }
      out += '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>' + esc(tail);
      last = m.index + m[0].length;
    }
    out += esc(text.slice(last));
    return out.replace(/\n/g, '<br>');
  }

  function toProduct(r, category) {
    const set = tidySet(r.setPcs);
    // Some tabs keep the folder link in a helper column, so any Drive folder link on the row is used as a fallback.
    // "Open" / "Open folder" is label-only — never treat it as the Drive URL.
    if ((!isUrl(r.driveLink) || /^open(?:\s+folder)?$/i.test(String(r.driveLink || '').trim())) && r.rowFolder) {
      r.driveLink = r.rowFolder;
    }
    const driveRaw = r.driveLink;
    let driveResolved = pickUrl(driveRaw, r.driveLinkUrl) || (isUrl(driveRaw) ? String(driveRaw).trim() : '');
    if (!driveResolved || /^open(?:\s+folder)?$/i.test(driveResolved)) {
      driveResolved = '';
      const embedded = String(driveRaw || '').match(/drive\.google\.com\/(?:.*\/folders\/|[^\s]*[?&]id=)([\w-]{10,})/i);
      if (embedded) driveResolved = 'https://drive.google.com/drive/folders/' + embedded[1];
      if (!driveResolved && isUrl(r.driveLinkUrl)) driveResolved = String(r.driveLinkUrl).trim();
      if (!driveResolved && isUrl(r.rowFolder)) driveResolved = String(r.rowFolder).trim();
    }
    const productName = tidyName(r.productName);
    const subCategory = tidyName(r.subCategory);
    const functionalProp = String(r.functionalProp || '').trim();
    const prop = classifyProp(functionalProp, r.functionalPropUrl);
    const needsProp = !!functionalProp || !!r.functionalPropUrl || propsNeeded(r.propsNeeded);
    return {
      ean: r.ean.replace(/\s+/g, ''),
      rowNumber: r.rowNumber,
      catalog: 'hh',
      category,
      department: r.department,
      sheetCategory: tidyName(r.category),
      subCategory,
      subKey: subCategory.toLowerCase(),
      productName,
      productKey: productName.toLowerCase(),
      style: r.style,
      range: '',
      title: productName || tidyName(r.style) || 'Untitled product',
      detailDescription: String(r.detailDescription || '').trim(),
      color: String(r.color || '').trim(),
      setLabel: set.label,
      setKind: set.kind,
      size: realValue(r.size),
      sizeW: '',
      sizeD: '',
      sizeHt: '',
      dimensions: realValue(r.dimensions),
      capacity: realValue(r.capacity),
      template: tidyTemplate(r.template),
      templateRaw: String(r.template || '').trim(),
      functionalProp,
      prop,
      propsNeeded: needsProp,
      shots: parseShots(r.shotList),
      pdpLink: pickUrl(r.pdpLink, r.pdpLinkUrl),
      driveLink: driveResolved,
      driveText: driveRaw,
      folderId: folderIdFrom(driveResolved),
      shootStatus: r.shootStatus,
      uploadStatus: r.uploadStatus,
      remarks: r.shootRemarks,
      date: parseDate(r.uploadDate) || parseDate(r.shootDate)
    };
  }

  // MTS Furniture: Detail Description = title; CATEGORY drives the filter; PDP GUIDELINE LINK = PDP; no template.
  function toMtsProduct(r) {
    const set = tidySet(r.setPcs);
    if (!isUrl(r.driveLink) && r.rowFolder) r.driveLink = r.rowFolder;
    const driveRaw = r.driveLink;
    let driveResolved = pickUrl(driveRaw, r.driveLinkUrl) || (isUrl(driveRaw) ? String(driveRaw).trim() : '');
    if (!driveResolved) {
      const embedded = String(driveRaw || '').match(/drive\.google\.com\/(?:.*\/folders\/|[^\s]*[?&]id=)([\w-]{10,})/i);
      if (embedded) driveResolved = 'https://drive.google.com/drive/folders/' + embedded[1];
    }
    const pdpRaw = String(r.pdpLink || '').trim();
    // a) raw URL(s)  b) chip/hyperlink URL(s)  c) multi-line mix of titles + URLs
    const pdpLinks = uniqueUrls([].concat(
      r.pdpUrls || [],
      pickUrl(pdpRaw, r.pdpLinkUrl) || [],
      allHttpUrls(pdpRaw),
      allHttpUrls(r.pdpLinkUrl)
    ));
    const pdpResolved = pdpLinks[0] || '';
    const productName = tidyName(r.productName || r.detailDescription);
    const sheetCategory = tidyName(r.category);
    const subCategory = tidyName(r.subCategory);
    const range = tidyName(r.range);
    const sizeW = realValue(r.sizeW);
    const sizeD = realValue(r.sizeD);
    const sizeHt = realValue(r.sizeHt);
    const sizeParts = [sizeW, sizeD, sizeHt].filter(Boolean);
    const needsProp = propsNeeded(r.propsNeeded);
    const collectionShoot = tidyCollectionShoot(r.collectionShoot);
    return {
      ean: String(r.ean || '').replace(/\s+/g, ''),
      rowNumber: r.rowNumber,
      catalog: 'mts',
      // Category filter uses the sheet CATEGORY column (Dining Chair, Tables, …).
      category: sheetCategory,
      department: tidyName(r.department),
      sheetCategory,
      subCategory,
      subKey: subCategory.toLowerCase(),
      productName,
      productKey: productName.toLowerCase(),
      style: '',
      range,
      title: productName || range || 'Untitled product',
      detailDescription: String(r.detailDescription || r.productName || '').trim(),
      color: String(r.color || '').trim(),
      setLabel: set.label,
      setKind: set.kind,
      collectionShoot,
      size: sizeParts.join(' × '),
      sizeW,
      sizeD,
      sizeHt,
      dimensions: '',
      capacity: '',
      template: '',
      templateRaw: '',
      functionalProp: '',
      prop: { kind: 'text', html: '' },
      propsNeeded: needsProp,
      shots: parseShots(r.shotList),
      pdpLink: pdpResolved,
      pdpLinks: pdpLinks,
      pdpText: pdpRaw,
      driveLink: driveResolved,
      driveText: driveRaw,
      folderId: folderIdFrom(driveResolved),
      shootStatus: r.shootStatus,
      uploadStatus: r.uploadStatus,
      remarks: r.shootRemarks,
      date: parseDate(r.uploadDate) || parseDate(r.shootDate)
    };
  }

  function detectIssues(t, eanCount) {
    const issues = [];
    const warn = (key, text) => issues.push({ key, level: 'warn', text });
    if (!/^\d{13}$/.test(t.ean)) warn('ean', 'EAN "' + t.ean + '" is not 13 digits.');
    if (eanCount.get(t.ean) > 1) {
      warn('dup', 'EAN appears ' + eanCount.get(t.ean) + ' times in the ' +
        (t.catalog === 'mts' ? 'MTS Furniture sheet' : 'Shoot Tracker') + '.');
    }
    if (t.catalog !== 'mts') {
      if (!t.template) warn('template', 'Template mapping is missing.');
    }
    if (!t.shots.length) warn('shots', 'Mandatory shot list is empty.');
    if (/re-?sh(o|oo)t/i.test(t.remarks)) warn('reshoot', 'Photoshoot remarks: "' + t.remarks + '".');
    // Many rows leave Upload status and the GDRIVE cell blank and record the upload only in the Log tab,
    // so a blank status with a Drive folder is fine. Only a status that says something else is flagged.
    if (t.uploadStatus && !/^done$/i.test(t.uploadStatus)) warn('upload', 'Upload status is "' + t.uploadStatus + '". Files may not all be in Drive yet.');
    if (!t.uploadStatus && !t.driveLink) warn('upload', 'Upload status is blank and no Drive folder was found.');
    return issues;
  }

  function bump(map, key, artist) {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Map());
    const m = map.get(key);
    m.set(artist, (m.get(artist) || 0) + 1);
  }

  function buildModel(data) {
    const renderByEan = new Map();
    const artistTotals = new Map();
    // An EAN listed in the Render Tracker without an Artist is not assigned yet, so it stays available.
    data.render.forEach((r) => {
      const ean = String(r.ean || '').replace(/\s+/g, '');
      const artist = String(r.artist || '').trim();
      if (!ean || !artist) return;
      r.ean = ean;
      if (!renderByEan.has(ean)) renderByEan.set(ean, []);
      renderByEan.get(ean).push(r);
      artistTotals.set(artist, (artistTotals.get(artist) || 0) + 1);
    });

    const products = [];
    const eanCount = new Map();
    data.shoot.forEach((src) => src.rows.forEach((r) => {
      const p = toProduct(r, src.category);
      if (!p.ean) return;
      products.push(p);
      eanCount.set(p.ean, (eanCount.get(p.ean) || 0) + 1);
    }));

    // Copy Tracker PDP Images / output Drive link / Marketing QC onto matching Shoot products for My Tasks.
    products.forEach((p) => {
      const rows = renderByEan.get(p.ean) || [];
      if (!rows.length) return;
      const row = (state.author && rows.filter((r) => sameArtist(r.artist, state.author)).pop()) || rows[rows.length - 1];
      if (row.pdpImages) p.pdpImages = row.pdpImages;
      if (row.photoshootStatus) p.photoshootStatus = row.photoshootStatus;
      if (row.outputLink && isUrl(row.outputLink)) {
        p.outputLink = row.outputLink;
        p.outputFolderId = folderIdFrom(row.outputLink);
      }
      if (row.marketingQc) p.marketingQc = String(row.marketingQc).trim();
      if (row.startDate) p.assignStartDate = row.startDate;
      if (row.endDate) p.assignEndDate = row.endDate;
      if (row.artist) p.assignArtist = String(row.artist).trim();
    });

    // Who rendered what, from the Render Tracker Artist column joined to the Shoot Tracker by EAN.
    const history = { byKey: new Map(), byTemplate: new Map(), bySub: new Map() };
    products.forEach((p) => {
      (renderByEan.get(p.ean) || []).forEach((r) => {
        const artist = r.artist.trim();
        if (!artist) return;
        if (p.template) {
          // Key is the full template, so SF1 never shares history with SF2 or T1.
          bump(history.byKey, p.template + '|' + p.subKey, artist);
          bump(history.byTemplate, p.template, artist);
        }
        bump(history.bySub, p.subKey, artist);
      });
    });

    // Ready = GDRIVE folder link + template mapping. Status columns are informational only.
    const withDrive = products.filter((p) => p.driveLink);
    const withTpl = products.filter((p) => p.template);
    const ready = products.filter((p) => p.driveLink && p.template);
    const stats = {
      products: products.length,
      withDrive: withDrive.length,
      withTpl: withTpl.length,
      ready: ready.length,
      noDrive: withTpl.filter((p) => !p.driveLink).length,
      driveTextNoLink: withTpl.filter((p) => !p.driveLink && p.driveText).length,
      noTemplate: withDrive.filter((p) => !p.template).length,
      assigned: ready.filter((p) => renderByEan.has(p.ean)).length,
      open: ready.filter((p) => !renderByEan.has(p.ean)).length
    };
    const tasks = ready.filter((p) => !renderByEan.has(p.ean));
    products.forEach((p) => {
      p.search = [p.ean, p.title, p.style, p.subCategory, p.sheetCategory, p.template].join(' ').toLowerCase();
      const artist = renderByEan.has(p.ean) ? renderByEan.get(p.ean)[0].artist.trim() : '';
      p.hiddenReason = !p.driveLink
        ? (p.driveText
          ? 'GDRIVE cell shows "' + String(p.driveText).slice(0, 60) + '" but no folder link could be read'
          : 'no GDRIVE link yet')
        : !p.template
          ? 'no template mapping yet'
        : artist ? 'already assigned to ' + artist + ' in the Render Tracker'
        : '';
    });
    // Issues on every Drive + Template product (available or assigned) for the drawer / My Tasks.
    ready.forEach((t) => {
      t.issues = detectIssues(t, eanCount);
      t.hasIssue = t.issues.some((i) => i.level === 'warn' && i.key !== 'template');
    });

    // Every template in the Shoot Tracker, so the filter shows the full list even when some have no open tasks.
    const templates = new Map();
    products.forEach((p) => { if (p.template) templates.set(p.template, (templates.get(p.template) || 0) + 1); });

    return {
      tasks,
      products,
      assignedByEan: renderByEan,
      templates,
      stats,
      warnings: data.warnings,
      history,
      artists: [...artistTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
      categories: data.shoot.map((s) => s.category),
      fileSavedAt: data.shoot.map((s) => s.modified).filter(Boolean).sort().pop() || '',
      xlsxSync: data.xlsxSync || null,
      catalog: 'hh'
    };
  }

  // MTS Furniture: Available = GDRIVE link + PDP GUIDELINE LINK (no template, no Render Tracker yet).
  function buildMtsModel(data) {
    const furniture = data.furniture || { rows: [] };
    const products = [];
    const eanCount = new Map();
    (furniture.rows || []).forEach((r) => {
      const p = toMtsProduct(r);
      if (!p.ean) return;
      products.push(p);
      eanCount.set(p.ean, (eanCount.get(p.ean) || 0) + 1);
    });

    const withDrive = products.filter((p) => p.driveLink);
    const withPdp = products.filter((p) => p.pdpLink);
    const ready = products.filter((p) => p.driveLink && p.pdpLink);
    const stats = {
      products: products.length,
      withDrive: withDrive.length,
      withPdp: withPdp.length,
      withTpl: 0,
      ready: ready.length,
      noDrive: products.filter((p) => !p.driveLink).length,
      driveTextNoLink: products.filter((p) => !p.driveLink && p.driveText).length,
      noPdp: withDrive.filter((p) => !p.pdpLink).length,
      pdpTextNoLink: withDrive.filter((p) => !p.pdpLink && p.pdpText).length,
      noTemplate: 0,
      assigned: 0,
      open: ready.length
    };
    const tasks = ready.slice();
    products.forEach((p) => {
      p.search = [p.ean, p.title, p.range, p.subCategory, p.sheetCategory, p.department, p.color, p.collectionShoot]
        .join(' ').toLowerCase();
      p.hiddenReason = !p.driveLink
        ? (p.driveText
          ? 'GDRIVE cell shows "' + String(p.driveText).slice(0, 60) + '" but no folder link could be read'
          : 'no GDRIVE link yet')
        : !p.pdpLink
          ? (p.pdpText
            ? 'PDP guideline shows "' + String(p.pdpText).slice(0, 60) + '" but no link could be read'
            : 'no PDP guideline link yet')
          : '';
    });
    tasks.forEach((t) => {
      t.issues = detectIssues(t, eanCount);
      t.hasIssue = t.issues.some((i) => i.level === 'warn');
    });

    const catSet = new Map();
    products.forEach((p) => {
      if (p.category) catSet.set(p.category, (catSet.get(p.category) || 0) + 1);
    });
    const categories = [...catSet.keys()].sort((a, b) => a.localeCompare(b));

    const warnings = (data.warnings || []).filter((w) => /MTS Furniture/i.test(w));
    if (furniture.error) warnings.push('MTS Furniture: ' + furniture.error);

    return {
      tasks,
      products,
      assignedByEan: new Map(),
      templates: new Map(),
      stats,
      warnings,
      history: { byKey: new Map(), byTemplate: new Map(), bySub: new Map() },
      artists: [],
      categories,
      fileSavedAt: furniture.modified || '',
      xlsxSync: null,
      catalog: 'mts'
    };
  }

  // SF1 matches earlier SF1 work only. SF2 is a different template, and T is a different series.
  // No series-wide or sub-category fallback for T/SF — that mixed SF1 with SF2 and SF with T.
  function suggestionsFor(template, subKey) {
    const h = state.model.history;
    const series = templateSeries(template);
    const levels = [
      [template && subKey ? h.byKey.get(template + '|' + subKey) : null, 'same sub-category and template ' + template],
      [template ? h.byTemplate.get(template) : null, 'template ' + template]
    ];
    if (!series && subKey) levels.push([h.bySub.get(subKey), 'same sub-category']);
    const out = [];
    const seen = new Set();
    levels.forEach(([map, basis]) => {
      if (!map) return;
      [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ name, count, basis });
      });
    });
    return out;
  }

  function suggestFor(template, subKey) {
    return suggestionsFor(template, subKey)[0] || null;
  }

  // An artist sees tasks they have history on, plus tasks nobody has history on yet, so everyone has work to pick.
  function taskFitsArtist(t, name) {
    const list = suggestionsFor(t.template, t.subKey);
    if (!list.length) return true;
    const n = name.toLowerCase();
    return list.some((s) => s.name.toLowerCase() === n);
  }

  /* ---------- Assignments (sheet is the source of truth; no localStorage picks) ---------- */

  function assignedArtist(ean) {
    const row = assignmentRow(ean);
    return row ? String(row.artist || '').trim() : '';
  }

  // Exact match always wins. First token also matches ("Naveen" ≈ "Naveen Kumar").
  function sameArtist(a, b) {
    const x = String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const y = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!x || !y) return false;
    if (x === y) return true;
    const xf = x.split(/\s+/)[0];
    const yf = y.split(/\s+/)[0];
    if (!xf || !yf || xf !== yf) return false;
    return xf.length >= 2;
  }

  function isAssignedToMe(ean) {
    if (!state.author) return false;
    const list = state.model && state.model.assignedByEan.get(ean);
    if (!list) return false;
    return list.some((r) => sameArtist(r.artist, state.author));
  }

  // Mark EANs as assigned in the live model (after a successful sheet write or a poll).
  function applyAssignments(eans, artist) {
    if (!state.model || !eans.length) return;
    eans.forEach((ean) => {
      if (!state.model.assignedByEan.has(ean)) state.model.assignedByEan.set(ean, []);
      const list = state.model.assignedByEan.get(ean);
      if (!list.some((r) => sameArtist(r.artist, artist))) {
        list.push({ ean, artist, pdpImages: 'Blocked' });
      } else {
        const row = list.find((r) => sameArtist(r.artist, artist));
        if (row && !row.pdpImages) row.pdpImages = 'Blocked';
      }
      state.model.tasks = state.model.tasks.filter((t) => t.ean !== ean);
      const p = state.model.products.find((x) => x.ean === ean);
      if (p) {
        p.hiddenReason = 'already assigned to ' + artist + ' in the Render Tracker';
        if (!p.pdpImages) p.pdpImages = 'Blocked';
      }
    });
  }

  // Merge a fresh assign-sheet read into the model. Returns true when open list or PDP status changed.
  function mergeAssignsFromSheet(sheet) {
    if (!state.model || !sheet || !sheet.values) return false;
    const rows = tableFrom(sheet.values, RENDER_COLUMNS);
    let changed = false;
    rows.forEach((r) => {
      const ean = String(r.ean || '').replace(/\s+/g, '');
      const artist = String(r.artist || '').trim();
      if (!ean || !artist) return;
      r.ean = ean;
      if (!state.model.assignedByEan.has(ean)) state.model.assignedByEan.set(ean, []);
      const list = state.model.assignedByEan.get(ean);
      const existing = list.find((x) => sameArtist(x.artist, artist));
      const p = state.model.products.find((x) => x.ean === ean);
      if (existing) {
        // Refresh PDP Images / output / QC so In progress → Completed shows up without a full reload.
        ['pdpImages', 'photoshootStatus', 'outputLink', 'marketingQc', 'startDate', 'endDate', 'artist'].forEach((k) => {
          if (r[k] != null && String(r[k]).trim() !== '' && existing[k] !== r[k]) {
            existing[k] = r[k];
            changed = true;
          }
        });
        if (p && r.pdpImages) p.pdpImages = r.pdpImages;
        if (p && r.photoshootStatus) p.photoshootStatus = r.photoshootStatus;
        if (p && r.outputLink && isUrl(r.outputLink)) {
          p.outputLink = r.outputLink;
          p.outputFolderId = folderIdFrom(r.outputLink);
        }
        if (p && r.marketingQc) p.marketingQc = String(r.marketingQc).trim();
        return;
      }
      const wasOpen = state.model.tasks.some((t) => t.ean === ean);
      list.push(r);
      if (wasOpen) {
        state.model.tasks = state.model.tasks.filter((t) => t.ean !== ean);
        if (p) p.hiddenReason = 'already assigned to ' + artist + ' in the Render Tracker';
      }
      if (p && r.pdpImages) p.pdpImages = r.pdpImages;
      changed = true;
    });
    return changed;
  }

  function assign(eans, artist) {
    if (!eans.length) return;
    // Always requires an artist chosen from the Assign to menu (never silent self-assign).
    withAuthor(() => {
      const who = String(artist || '').trim();
      if (!who) {
        showToast('Assign failed — choose an artist from the list.', false, { error: true });
        return;
      }
      writeAssignsToSheet(eans, who);
    });
  }

  // Appends to the sheet, then updates this page immediately. Other browsers pick it up via assign polling.
  async function writeAssignsToSheet(eans, artist) {
    const who = String(artist || '').trim();
    if (!who) {
      showToast('Assign failed — artist name is required.', false, { error: true });
      return;
    }
    showToast('Saving ' + eans.length + ' task' + (eans.length === 1 ? '' : 's') + ' to the Render Tracker…', false);
    const rows = eans.map((ean) => ({ ean }));
    let written = 0;
    let skipped = 0;
    let writtenEans = [];
    let startDate = '';
    try {
      for (let i = 0; i < rows.length; i += 20) {
        const chunk = rows.slice(i, i + 20);
        const data = await jsonp(
          'action=assign&artist=' + encodeURIComponent(who) +
            '&rows=' + encodeURIComponent(JSON.stringify(chunk)),
          60000
        );
        written += data.written || 0;
        skipped += data.skipped || 0;
        if (data.writtenEans && data.writtenEans.length) writtenEans = writtenEans.concat(data.writtenEans);
        if (data.startDate) startDate = data.startDate;
      }
    } catch (err) {
      showToast('Assign failed — nothing was saved. ' + esc(err.message), false, { error: true });
      return;
    }

    if (!written && skipped) {
      showToast('Assign failed — ' + skipped + ' EAN' + (skipped === 1 ? ' is' : 's are') +
        ' already in the Render Tracker (left unchanged).', false, { error: true });
      // Sheet already has them — sync local model so the task leaves Available.
      applyAssignments(eans, who);
    render();
      return;
    }
    if (!written) {
      showToast('Assign failed — the sheet did not accept any rows.', false, { error: true });
      return;
    }

    const accepted = writtenEans.length ? writtenEans : eans;
    applyAssignments(accepted, who);
    const mine = state.author && sameArtist(who, state.author);
    const what = accepted.length === 1
      ? 'EAN <span class="tp-mono">' + esc(accepted[0]) + '</span>'
      : '<span class="tp-mono">' + accepted.length + '</span> tasks';
    showToast(
      (mine ? 'Assigned ' + what + ' to you — moved to My Tasks' : 'Assigned ' + what + ' to ' + esc(who)) +
        (startDate ? ' · Start ' + esc(startDate) + ' · PDP Images Blocked' : '') +
        (skipped ? ' · ' + skipped + ' already on the sheet (skipped)' : ''),
      false
    );
    fillFilters();
    render();
  }

  let assignRefreshRunning = false;
  async function refreshAssigns() {
    if (!state.model || assignRefreshRunning || !FEED_URL || isMts()) return;
    assignRefreshRunning = true;
    try {
      const data = await jsonp('action=assigns', 30000);
      if (mergeAssignsFromSheet(data)) {
        fillFilters();
        render();
      } else {
        // My Tasks tab count may still need a redraw if the author name was set later.
        updateTabCounts();
      }
    } catch (err) {
      /* keep last known assign state; full Refresh still works */
    } finally {
      assignRefreshRunning = false;
    }
  }

  function updateTabCounts() {
    if (!state.model) return;
    const mine = myTasks();
    const active = mine.filter((t) => !isCompletedStatus(t)).length;
    const completed = mine.filter(isCompletedStatus).length;
    els.tabAvailable.textContent = availableTasks().length;
    // Nav badge = active work only (excludes Completed).
    els.tabMy.textContent = active;
    if (els.myCountActive) els.myCountActive.textContent = active;
    if (els.myCountCompleted) els.myCountCompleted.textContent = completed;
  }

  function withAuthor(action) {
    if (state.author) { action(); return; }
    state.pendingAction = action;
    openNameModal();
  }

  /* ---------- Filtering and grouping ---------- */

  function availableTasks() {
    return state.model ? state.model.tasks.slice() : [];
  }

  // My Tasks = anything on the Render Tracker for this author (Not started / In progress / Blocked / Completed).
  // Do not require GDRIVE + template — those gates are only for Available Tasks.
  function myTasks() {
    if (!state.model || !state.author) return [];
    const list = state.model.products.filter((p) => isAssignedToMe(p.ean));
    const seen = new Set(list.map((p) => p.ean));
    // Tracker rows with no Shoot join still appear (status / Completed from the sheet).
    state.model.assignedByEan.forEach((rows, ean) => {
      if (seen.has(ean)) return;
      const mine = rows.filter((r) => sameArtist(r.artist, state.author));
      if (!mine.length) return;
      const r = mine[mine.length - 1];
      list.push({
        ean: ean,
        title: 'EAN ' + ean,
        colour: 'c-slate',
        template: '',
        templateRaw: '',
        subCategory: '',
        subKey: '',
        productName: '',
        productKey: '',
        sheetCategory: '',
        category: 'Assigned',
        setLabel: '',
        setKind: '',
        shots: [],
        driveLink: '',
        folderId: '',
        pdpImages: r.pdpImages || '',
        outputLink: r.outputLink || '',
        outputFolderId: folderIdFrom(r.outputLink || ''),
        marketingQc: r.marketingQc || '',
        propsNeeded: false,
        prop: { kind: 'none', html: '' },
        search: ean,
        hiddenReason: '',
        hasIssue: false,
        issues: []
      });
    });
    return list;
  }

  function assignmentRow(ean) {
    const list = state.model && state.model.assignedByEan.get(ean);
    if (!list || !list.length) return null;
    // Prefer this Author's row (last write wins if the EAN appears more than once).
    if (state.author) {
      const mine = list.filter((r) => sameArtist(r.artist, state.author));
      if (mine.length) return mine[mine.length - 1];
    }
    return list[list.length - 1];
  }

  // Map Tracker "PDP Images" cell text to the four UI statuses.
  // Active = Not started / In progress / Blocked. Completed tab = Completed only.
  function normalizePdpStatus(raw) {
    const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!v) return STATUS.not_started;
    // Order matters: "In progress" must not be treated as Completed.
    if (/\bblocked\b/.test(v)) return STATUS.blocked;
    if (/in\s*-?\s*progress|\bwip\b|\bworking\b/.test(v)) return STATUS.in_progress;
    if (/^(completed|complete|done|finished)$/.test(v) || /\bcompleted\b/.test(v) || /\bcomplete\b/.test(v)) {
      return STATUS.completed;
    }
    if (/not\s*-?\s*started|not\s*yet|\bpending\b|to\s*do|\btodo\b|^new$/.test(v)) return STATUS.not_started;
    return STATUS.not_started;
  }

  function statusOf(t) {
    const row = assignmentRow(t.ean);
    // PDP Images only — never Photoshoot Status / Upload "Done" (those put Active work into Completed).
    const raw = (row && row.pdpImages) || t.pdpImages || '';
    return normalizePdpStatus(raw);
  }

  function isCompletedStatus(t) {
    return statusOf(t).id === 'completed';
  }

  function outputLinkOf(t) {
    const row = assignmentRow(t.ean);
    const fromAssign = row && (row.outputLink || row.driveLink);
    if (fromAssign && isUrl(fromAssign)) return fromAssign;
    if (t.outputLink && isUrl(t.outputLink)) return t.outputLink;
    return '';
  }

  function outputFolderIdOf(t) {
    if (t.outputFolderId) return t.outputFolderId;
    return folderIdFrom(outputLinkOf(t));
  }

  function marketingQcOf(t) {
    const row = assignmentRow(t.ean);
    return String((row && row.marketingQc) || t.marketingQc || '').trim();
  }

  function qcClass(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return 'is-empty';
    if (/^(correct|ok|pass|passed|approved|good)$/.test(v) || /\bcorrect\b/.test(v)) return 'is-correct';
    if (/incorrect|wrong|fail|reject|rework|redo/.test(v)) return 'is-wrong';
    return 'is-other';
  }

  function qcHtml(t) {
    const raw = marketingQcOf(t);
    if (!raw) return '<span class="tp-qc is-empty">QC —</span>';
    return '<span class="tp-qc ' + qcClass(raw) + '">QC · ' + esc(raw) + '</span>';
  }

  // Folder used for list/drawer thumbs: Completed work uses Render Tracker output folder.
  function previewFolderId(t) {
    if (useOutputPreview(t)) return outputFolderIdOf(t) || t.folderId || '';
    return t.folderId || '';
  }

  function recommendedWorkflow(t) {
    return recommendReplace(t) ? 'replace' : 'primary';
  }

  function poolTasks() {
    if (state.view !== 'my') return availableTasks();
    const mine = myTasks();
    return state.myBucket === 'completed'
      ? mine.filter(isCompletedStatus)
      : mine.filter((t) => !isCompletedStatus(t));
  }

  // Prior work = other EANs that are Completed on the Render Tracker, joined to Shoot for template/sub-category.
  function completedPriors() {
    if (!state.model) return [];
    return state.model.products.filter((p) => {
      if (!isCompletedStatus(p)) return false;
      return !!(outputLinkOf(p) || p.folderId);
    });
  }

  function priorMatches(t) {
    if (!t || !state.model) return [];
    const others = completedPriors().filter((p) => p.ean !== t.ean);
    const list = [];
    const seen = new Set();
    function add(level, label, p) {
      if (!p || seen.has(p.ean)) return;
      seen.add(p.ean);
      const drive = outputLinkOf(p) || p.driveLink || '';
      list.push({
        level,
        label,
        best: false,
        ean: p.ean,
        title: p.title || p.productName || p.ean,
        artist: p.assignArtist || (assignmentRow(p.ean) || {}).artist || '',
        drive: drive,
        folderId: outputFolderIdOf(p) || p.folderId || '',
        product: p
      });
    }
    // Closest first: Sub-category + Template (drives Replacement), then Product + Template, then Template.
    if (t.template && t.subKey) {
      others.filter((p) => p.template === t.template && p.subKey === t.subKey)
        .forEach((p) => add('sub+template', 'Sub-category + Template', p));
    }
    if (t.template && t.productKey) {
      others.filter((p) => p.template === t.template && p.productKey === t.productKey)
        .forEach((p) => add('product+template', 'Product + Template', p));
    }
    if (t.template) {
      others.filter((p) => p.template === t.template)
        .slice(0, 8)
        .forEach((p) => add('template', 'Template only', p));
    }
    const best = list.find((m) => m.level === 'sub+template') || list[0];
    if (best) best.best = true;
    return list;
  }

  // Replacement only when another Completed EAN shares Sub-category + Template.
  function recommendReplace(t) {
    return priorMatches(t).some((m) => m.level === 'sub+template');
  }

  function matchThumbHtml(m) {
    const list = m.folderId && Array.isArray(state.images[m.folderId]) ? state.images[m.folderId] : null;
    if (list && list.length) {
      return '<img class="tp-img" src="' + esc(thumbUrl(list[0], 160)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    }
    return esc((m.title || '—').slice(0, 2).toUpperCase());
  }

  function shotCodeOf(shot, index) {
    if (shot && shot.code) return shot.code;
    const n = String((shot && shot.name) || '').toLowerCase();
    if (/dimension/.test(n)) return 'M-DIM';
    if (/lifestyle/.test(n) && /open|lid/.test(n)) return 'LS-OP';
    if (/lifestyle/.test(n)) return 'L-CTX';
    if (/close/.test(n)) return 'D-CU';
    if (/front/.test(n) && /white|main|background/.test(n)) return 'MAIN';
    if (/front/.test(n)) return 'H-FR';
    if (/angle|side/.test(n)) return 'H-SDAN';
    if (/detail/.test(n)) return 'DET';
    return 'S' + String((index || 0) + 1).padStart(2, '0');
  }

  function namingProductTypes() {
    const data = window.NAMING_DATA;
    return (data && Array.isArray(data.productTypes)) ? data.productTypes : [];
  }

  function selectedNamingType() {
    const name = state.workspace && state.workspace.productTypeName;
    if (!name) return null;
    return namingProductTypes().find((t) => t.name === name) || null;
  }

  function namingShotsForWorkspace() {
    const type = selectedNamingType();
    if (!type) return null;
    if (type.variants) {
      const keys = Object.keys(type.variants);
      const v = state.workspace.productTypeVariant || keys[0] || '';
      return type.variants[v] || [];
    }
    return type.shots || [];
  }

  function findProductTypeSuggestions(query) {
    const q = String(query || '').trim().toLowerCase();
    const types = namingProductTypes();
    if (!q) {
      return types.slice().sort((a, b) => a.name.localeCompare(b.name) || a.category.localeCompare(b.category));
    }
    return types
      .map((t) => {
        const name = t.name.toLowerCase();
        const idx = name.indexOf(q);
        if (idx < 0) return null;
        const wordStart = idx === 0 || name[idx - 1] === ' ';
        return { t: t, score: idx === 0 ? 0 : wordStart ? 1 : 2 };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.t.name.localeCompare(b.t.name))
      .map((x) => x.t);
  }

  function shotListFor(t) {
    const naming = (state.workspace &&
      (state.workspace.mode === 'replace' || state.workspace.mode === 'primary'))
      ? namingShotsForWorkspace()
      : null;
    if (naming && naming.length) {
      return naming.map((s, i) => ({
        seq: Number(s.seq) || i,
        name: s.name || ('Shot ' + (i + 1)),
        code: s.code || shotCodeOf(s, i),
        family: String(s.family || '').trim(),
        whatToShoot: String(s.whatToShoot || '').trim(),
        note: String(s.note || '').trim()
      }));
    }
    const raw = (t && t.shots && t.shots.length)
      ? t.shots
      : [
          { name: 'Hero Front - White Background', code: 'MAIN' },
          { name: 'Lifestyle Shot', code: 'L-CTX' },
          { name: 'Hero Front', code: 'H-FR' },
          { name: 'Hero Close Up', code: 'D-CU' },
          { name: 'Product Dimension', code: 'M-DIM' }
        ];
    return raw.map((s, i) => ({
      seq: s.seq != null ? s.seq : i + 1,
      name: s.name || ('Shot ' + (i + 1)),
      code: shotCodeOf(s, i),
      family: String(s.family || '').trim(),
      whatToShoot: String(s.whatToShoot || '').trim(),
      note: String(s.note || '').trim()
    }));
  }

  function hasWorkspaceProductType() {
    return !!(state.workspace && state.workspace.productTypeName && selectedNamingType());
  }

  /** Lifestyle family / L-CTX / LS-* / name containing Lifestyle (incl. variants). */
  function isLifestyleShot(shotOrName) {
    if (shotOrName == null) return false;
    if (typeof shotOrName === 'string') return /lifestyle/i.test(shotOrName);
    const name = String(shotOrName.name || '');
    const family = String(shotOrName.family || '');
    const code = String(shotOrName.code || '');
    if (/lifestyle/i.test(name) || /lifestyle/i.test(family)) return true;
    if (/^L-CTX/i.test(code) || /^LS-/i.test(code)) return true;
    return false;
  }

  function isDimensionShotName(name) {
    return /dimension/i.test(name || '');
  }

  function normDimValue(v) {
    return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Banner when new vs prior product size / dimensions / capacity (volume) differ.
  function productDimsDiffer(t, prior) {
    const p = prior && (prior.product || prior);
    if (!t || !p) return false;
    const fields = ['size', 'dimensions', 'capacity'];
    for (let i = 0; i < fields.length; i++) {
      const a = normDimValue(t[fields[i]]);
      const b = normDimValue(p[fields[i]]);
      if (!a && !b) continue;
      if (a !== b) return true;
    }
    return false;
  }

  function dimDiffSummary(t, prior) {
    const p = prior && (prior.product || prior);
    if (!t || !p) return '';
    const bits = [];
    [['size', 'Size'], ['dimensions', 'Dimensions'], ['capacity', 'Volume']].forEach((pair) => {
      const targetVal = String(t[pair[0]] || '').trim();
      const priorVal = String(p[pair[0]] || '').trim();
      if (normDimValue(targetVal) !== normDimValue(priorVal) && (targetVal || priorVal)) {
        // Prior EAN → Target EAN
        bits.push(pair[1] + ': ' + (priorVal || '—') + ' → ' + (targetVal || '—'));
      }
    });
    return bits.join(' · ');
  }

  function readProductTypePrefs() {
    try {
      const raw = localStorage.getItem(PRODUCT_TYPE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        name: String(parsed.name || '').trim(),
        variant: String(parsed.variant || '').trim()
      };
    } catch (e) {
      return null;
    }
  }

  function writeProductTypePrefs(name, variant) {
    try {
      if (!name) {
        localStorage.removeItem(PRODUCT_TYPE_KEY);
        return;
      }
      localStorage.setItem(PRODUCT_TYPE_KEY, JSON.stringify({
        name: String(name),
        variant: String(variant || '')
      }));
    } catch (e) { /* ignore */ }
  }

  function applyStoredProductTypeOnce() {
    if (!state.workspace || state.workspace.ptPrefsApplied) return;
    state.workspace.ptPrefsApplied = true;
    if (state.workspace.productTypeName) {
      state.workspace.productTypeQuery = state.workspace.productTypeName;
      return;
    }
    const prefs = readProductTypePrefs();
    if (!prefs || !prefs.name) return;
    const type = namingProductTypes().find((t) => t.name === prefs.name);
    if (!type) return;
    state.workspace.productTypeName = type.name;
    state.workspace.productTypeQuery = type.name;
    const variants = type.variants ? Object.keys(type.variants) : [];
    state.workspace.productTypeVariant =
      (prefs.variant && variants.indexOf(prefs.variant) >= 0) ? prefs.variant : (variants[0] || '');
  }

  function ensureReplaceState(t) {
    if (!state.workspace) return;
    if (!state.workspace.replaceInit) {
      state.workspace.replaceInit = true;
      if (state.workspace.panelOpen == null) state.workspace.panelOpen = true;
      if (state.workspace.panelMax == null) state.workspace.panelMax = false;
      if (state.workspace.dimSeparate == null) state.workspace.dimSeparate = false;
      if (state.workspace.mdimShowAbcd == null) state.workspace.mdimShowAbcd = false;
      if (!state.workspace.mdimDraft) state.workspace.mdimDraft = null;
      if (state.workspace.mdimBaseKey == null) state.workspace.mdimBaseKey = '';
      if (!state.workspace.mdimWorkspaceUrl) state.workspace.mdimWorkspaceUrl = null;
      if (state.workspace.mdimOverride === undefined) state.workspace.mdimOverride = null;
      if (state.workspace.mdimMainMax == null) state.workspace.mdimMainMax = false;
      if (state.workspace.mdimDbChecked == null) state.workspace.mdimDbChecked = false;
      if (state.workspace.mdimDbAvailable == null) state.workspace.mdimDbAvailable = false;
      if (state.workspace.mdimDbDoc === undefined) state.workspace.mdimDbDoc = null;
      if (state.workspace.rating == null) state.workspace.rating = 0;
      if (!state.workspace.ratings) state.workspace.ratings = {};
      if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
      if (!state.workspace.exportImages) state.workspace.exportImages = {};
      if (!state.workspace.exportCleared) state.workspace.exportCleared = {};
      if (state.workspace.comparePos == null) state.workspace.comparePos = 50;
      if (state.workspace.generating === undefined) state.workspace.generating = null;
      if (!state.workspace.shotInputs) state.workspace.shotInputs = {};
      if (!state.workspace.assets) state.workspace.assets = {};
      if (!state.workspace.prompts) state.workspace.prompts = {};
      if (!state.workspace.outputs) state.workspace.outputs = {};
      if (!state.workspace.approved) state.workspace.approved = {};
      if (!state.workspace.rejected) state.workspace.rejected = {};
      if (state.workspace.driveImgIndex === undefined) state.workspace.driveImgIndex = null;
      if (state.workspace.productTypeName == null) state.workspace.productTypeName = '';
      if (state.workspace.productTypeVariant == null) state.workspace.productTypeVariant = '';
      if (state.workspace.productTypeQuery == null) state.workspace.productTypeQuery = '';
      if (state.workspace.productTypeOpen == null) state.workspace.productTypeOpen = false;
      if (state.workspace.productTypeWarn == null) state.workspace.productTypeWarn = false;
      if (state.workspace.fileTarget === undefined) state.workspace.fileTarget = null;
      applyStoredProductTypeOnce();
    }
    if (state.workspace.panelOpen == null) state.workspace.panelOpen = true;
    if (state.workspace.productTypeName == null) state.workspace.productTypeName = '';
    if (!state.workspace.assets) state.workspace.assets = {};
    if (!state.workspace.prompts) state.workspace.prompts = {};
  }

  function ensurePrimaryState(t) {
    if (!state.workspace) return;
    if (!state.workspace.primaryInit) {
      state.workspace.primaryInit = true;
      // Primary defaults Detail & Compare collapsed to free space for A1/A2/B/C/D.
      if (state.workspace.panelOpen == null) state.workspace.panelOpen = false;
      if (state.workspace.panelMax == null) state.workspace.panelMax = false;
      if (state.workspace.rating == null) state.workspace.rating = 0;
      if (!state.workspace.ratings) state.workspace.ratings = {};
      if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
      if (!state.workspace.promptManualEdit) state.workspace.promptManualEdit = {};
      if (state.workspace.comparePos == null) state.workspace.comparePos = 50;
      if (state.workspace.generating === undefined) state.workspace.generating = null;
      if (!state.workspace.shotInputs) state.workspace.shotInputs = {};
      if (!state.workspace.assets) state.workspace.assets = {};
      if (!state.workspace.prompts) state.workspace.prompts = {};
      if (!state.workspace.outputs) state.workspace.outputs = {};
      if (!state.workspace.approved) state.workspace.approved = {};
      if (state.workspace.dimSeparate == null) state.workspace.dimSeparate = false;
      if (state.workspace.mdimShowAbcd == null) state.workspace.mdimShowAbcd = false;
      if (!state.workspace.mdimDraft) state.workspace.mdimDraft = null;
      if (state.workspace.mdimBaseKey == null) state.workspace.mdimBaseKey = '';
      if (!state.workspace.mdimWorkspaceUrl) state.workspace.mdimWorkspaceUrl = null;
      if (state.workspace.mdimOverride === undefined) state.workspace.mdimOverride = null;
      if (state.workspace.mdimMainMax == null) state.workspace.mdimMainMax = false;
      if (state.workspace.mdimDbChecked == null) state.workspace.mdimDbChecked = false;
      if (state.workspace.mdimDbAvailable == null) state.workspace.mdimDbAvailable = false;
      if (state.workspace.mdimDbDoc === undefined) state.workspace.mdimDbDoc = null;
      if (state.workspace.productTypeName == null) state.workspace.productTypeName = '';
      if (state.workspace.productTypeVariant == null) state.workspace.productTypeVariant = '';
      if (state.workspace.productTypeQuery == null) state.workspace.productTypeQuery = '';
      if (state.workspace.productTypeOpen == null) state.workspace.productTypeOpen = false;
      if (state.workspace.productTypeWarn == null) state.workspace.productTypeWarn = false;
      if (state.workspace.fileTarget === undefined) state.workspace.fileTarget = null;
      applyStoredProductTypeOnce();
    }
    if (!state.workspace.primary) {
      state.workspace.primary = {
        a1: null,
        a1Loading: false,
        a1Error: '',
        a1Attempted: false,
        a1Cleared: false,
        // Lifestyle-only optional A1 (per shot) — blank by default, never auto-loaded.
        lifestyleA1: {},
        a2: {},
        a3: {},
        showA3: {},
        pdp: null,
        pdpLoading: false,
        pdpError: '',
        pdpAttempted: false,
        a2Loading: {},
        a2Manual: {},
        a2Override: {}
      };
    }
    if (!state.workspace.primary.lifestyleA1) state.workspace.primary.lifestyleA1 = {};
    if (!state.workspace.assets) state.workspace.assets = {};
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (state.workspace.panelOpen == null) state.workspace.panelOpen = false;
  }

  function primarySlotAsset(slot, shotIndex) {
    const p = state.workspace && state.workspace.primary;
    if (!p) return null;
    if (slot === 'a1') {
      const task = taskByEan(state.workspace && state.workspace.ean);
      const shot = (shotListFor(task || {})[shotIndex]);
      // Lifestyle keeps its own optional A1 (blank unless user adds one).
      if (isLifestyleShot(shot)) {
        return (p.lifestyleA1 && p.lifestyleA1[String(shotIndex)]) || null;
      }
      return p.a1 || null;
    }
    const map = slot === 'a3' ? p.a3 : p.a2;
    return (map && map[String(shotIndex)]) || null;
  }

  function primaryShowA3(shotIndex) {
    const p = state.workspace && state.workspace.primary;
    return !!(p && p.showA3 && p.showA3[String(shotIndex)]);
  }

  function setPrimaryShowA3(shotIndex, on) {
    if (!state.workspace || !state.workspace.primary) return;
    if (!state.workspace.primary.showA3) state.workspace.primary.showA3 = {};
    state.workspace.primary.showA3[String(shotIndex)] = !!on;
    if (!on) {
      const prev = primarySlotAsset('a3', shotIndex);
      revokeAssetUrl(prev);
      if (state.workspace.primary.a3) delete state.workspace.primary.a3[String(shotIndex)];
    }
    maybeRefreshAutomatedPrimaryPrompt(shotIndex);
  }

  async function setPrimarySlotFromFile(slot, shotIndex, file) {
    if (!state.workspace || !isAcceptedImageFile(file)) {
      showToast('Use JPG or PNG images only.', false);
      return;
    }
    ensurePrimaryState();
    warnIfOverAnswerlyLimit(file, file.name || 'Primary ref');
    try {
      const loaded = await readLocalImageFile(file);
      const p = state.workspace.primary;
      if (slot === 'a1') {
        const task = taskByEan(state.workspace.ean);
        const shot = shotListFor(task || {})[shotIndex];
        if (isLifestyleShot(shot)) {
          if (!p.lifestyleA1) p.lifestyleA1 = {};
          revokeAssetUrl(p.lifestyleA1[String(shotIndex)]);
          p.lifestyleA1[String(shotIndex)] = loaded;
        } else {
          revokeAssetUrl(p.a1);
          const code = tidyTemplate(task && task.template);
          if (code) {
            loaded.label = code;
            loaded.name = code;
          }
          p.a1 = loaded;
          p.a1Error = '';
          p.a1Loading = false;
          p.a1Attempted = true;
          p.a1Cleared = false;
        }
      } else if (slot === 'a3') {
        if (!p.a3) p.a3 = {};
        revokeAssetUrl(p.a3[String(shotIndex)]);
        p.a3[String(shotIndex)] = loaded;
        setPrimaryShowA3(shotIndex, true);
      } else {
        if (!p.a2) p.a2 = {};
        if (!p.a2Manual) p.a2Manual = {};
        revokeAssetUrl(p.a2[String(shotIndex)]);
        p.a2[String(shotIndex)] = loaded;
        p.a2Manual[String(shotIndex)] = true;
      }
      maybeRefreshAutomatedPrimaryPrompt(shotIndex);
      renderWorkspace();
      persistCurrentPrimaryDraft();
      const shotNow = shotListFor(taskByEan(state.workspace && state.workspace.ean) || {})[shotIndex];
      const lifeNow = isLifestyleShot(shotNow);
      showToast(
        (slot === 'a1'
          ? (lifeNow ? 'A1 · Optional lifestyle ref' : 'A1 · Template image')
          : (slot === 'a3'
            ? 'A3 · Custom ref'
            : (lifeNow
              ? 'A2 · PDP Lifestyle reference'
              : 'A2 · PDP camera reference'))) +
          ' · ' + esc(loaded.name || 'image') +
          (loaded.w && loaded.h ? ' (' + loaded.w + '×' + loaded.h + ')' : ''),
        false
      );
    } catch (err) {
      showToast(err.message || 'Could not set image.', false, { error: true });
    }
  }

  function clearPrimarySlot(slot, shotIndex) {
    if (!state.workspace || !state.workspace.primary) return;
    const p = state.workspace.primary;
    if (slot === 'a1') {
      const task = taskByEan(state.workspace.ean);
      const shot = shotListFor(task || {})[shotIndex];
      if (isLifestyleShot(shot)) {
        if (p.lifestyleA1) {
          revokeAssetUrl(p.lifestyleA1[String(shotIndex)]);
          delete p.lifestyleA1[String(shotIndex)];
        }
      } else {
        // Keep Drive template recoverable — same idea as Clear override on Replace A.
        if (p.a1 && !p.a1Cleared) p.a1Cleared = true;
        revokeAssetUrl(p.a1);
        p.a1 = null;
        p.a1Error = '';
        p.a1Attempted = true;
        p.a1Loading = false;
      }
    } else if (slot === 'a3') {
      if (p.a3) {
        revokeAssetUrl(p.a3[String(shotIndex)]);
        delete p.a3[String(shotIndex)];
      }
      // Keep A3 card visible after Clear — Hide is the only way to remove the slot.
    } else if (p.a2) {
      revokeAssetUrl(p.a2[String(shotIndex)]);
      delete p.a2[String(shotIndex)];
      if (p.a2Manual) delete p.a2Manual[String(shotIndex)];
      if (p.a2Loading) delete p.a2Loading[String(shotIndex)];
    }
    maybeRefreshAutomatedPrimaryPrompt(shotIndex);
    renderWorkspace();
    persistCurrentPrimaryDraft();
    if (slot === 'a2' && state.workspace.mode === 'primary') {
      schedulePrimaryA2ForShot(shotIndex);
    }
  }

  function primaryPdpLink(t) {
    const links = pdpLinksOf(t || {});
    const prefer = links.find((u) => /presentation\/d\//i.test(u)) || links[0] || '';
    return String(prefer || (t && t.pdpLink) || '').trim();
  }

  function primaryPdpImages() {
    const p = state.workspace && state.workspace.primary;
    return (p && p.pdp && Array.isArray(p.pdp.images)) ? p.pdp.images : [];
  }

  function pdpCacheKey(meta) {
    if (!meta) return '';
    return String(meta.objectId || meta.contentUrl || ('seq:' + meta.seq) || '');
  }

  function shotNameForPdpSeq(seq, shots) {
    const list = shots || [];
    const n = Number(seq);
    if (n > 0) {
      const bySeq = list.find((s) => Number(s.seq) === n);
      if (bySeq && bySeq.name) return String(bySeq.name);
    }
    // Non-MAIN shots in naming order align to PDP reading order when seq is missing.
    const nonMain = list.filter((s) => !isMainShot(s));
    const hit = nonMain[n > 0 ? n - 1 : -1];
    return (hit && hit.name) || (n > 0 ? ('Seq ' + n) : 'PDP image');
  }

  function primaryA2DisplayName(shot, meta, asset) {
    if (asset && asset.label) return String(asset.label);
    if (shot && shot.name) return String(shot.name);
    if (meta && meta.seq != null) return shotNameForPdpSeq(meta.seq, shotListFor(taskByEan(state.workspace && state.workspace.ean) || {}));
    return isLifestyleShot(shot) ? 'PDP Lifestyle reference' : 'PDP camera reference';
  }

  function pdpMetaForShot(shot, shotIndex) {
    const p = state.workspace && state.workspace.primary;
    const images = primaryPdpImages();
    if (!images.length) return null;
    const key = String(shotIndex);
    const override = p && p.a2Override && p.a2Override[key];
    if (override) {
      if (override.objectId) {
        const byId = images.find((img) => img.objectId === override.objectId);
        if (byId) return byId;
      }
      if (override.seq != null) {
        const bySeq = images.find((img) => Number(img.seq) === Number(override.seq));
        if (bySeq) return bySeq;
      }
    }
    // MAIN has no auto PDP camera (Replace uses Hero Front / 01 D as A).
    if (isMainShot(shot)) return null;
    const seq = Number(shot && shot.seq);
    if (seq > 0) {
      const bySeq = images.find((img) => Number(img.seq) === seq);
      if (bySeq) return bySeq;
      if (images[seq - 1]) return images[seq - 1];
    }
    // Fall back: position among non-MAIN shots ↔ PDP reading order.
    const task = taskByEan(state.workspace && state.workspace.ean);
    const shots = shotListFor(task || {});
    const nonMain = shots
      .map((s, idx) => ({ s: s, idx: idx }))
      .filter((x) => !isMainShot(x.s));
    const pos = nonMain.findIndex((x) => x.idx === Number(shotIndex));
    if (pos >= 0 && images[pos]) return images[pos];
    return images[Number(shotIndex) || 0] || null;
  }

  function assetFromPdpBytes(data, meta, label) {
    const mime = (data && data.mime) || 'image/jpeg';
    const blob = base64ToBlob(data.base64, mime);
    const url = URL.createObjectURL(blob);
    const display = String(label || shotNameForPdpSeq(meta && meta.seq, []) || ('Seq ' + ((meta && meta.seq) || '?')))
      .replace(/\.(jpe?g|png|webp)$/i, '')
      .trim();
    return {
      id: 'pdp_' + ((meta && meta.objectId) || display),
      name: display,
      label: display,
      source: 'pdp-slides',
      blob: blob,
      file: blob,
      url: url,
      _blobRef: blob,
      mime: mime,
      size: (data && data.size) || blob.size,
      w: 0,
      h: 0,
      pdpSeq: meta && meta.seq,
      pdpObjectId: meta && meta.objectId,
      contentUrl: meta && meta.contentUrl
    };
  }

  function clonePdpAsset(asset, label) {
    if (!asset) return null;
    const display = String(label || asset.label || asset.name || 'PDP')
      .replace(/\.(jpe?g|png|webp)$/i, '')
      .trim();
    // Reuse the same blob URL — do not revoke while other shots may share the cache entry.
    return {
      id: asset.id,
      name: display,
      label: display,
      source: asset.source || 'pdp-slides',
      blob: asset.blob,
      file: asset.file || asset.blob,
      url: asset.url || asset.contentUrl || '',
      _blobRef: asset._blobRef || asset.blob,
      mime: asset.mime,
      size: asset.size,
      w: asset.w || 0,
      h: asset.h || 0,
      pdpSeq: asset.pdpSeq,
      pdpObjectId: asset.pdpObjectId,
      contentUrl: asset.contentUrl,
      sharedCache: true
    };
  }

  function loadPdpBytesCached(meta) {
    const key = pdpCacheKey(meta);
    if (!key || !meta || !meta.contentUrl) {
      return Promise.reject(new Error('Missing PDP image meta'));
    }
    if (PDP_BYTE_CACHE[key]) return Promise.resolve(PDP_BYTE_CACHE[key]);
    if (PDP_BYTE_PENDING[key]) return PDP_BYTE_PENDING[key];
    const q = 'action=pdpImage&contentUrl=' + encodeURIComponent(meta.contentUrl) +
      (meta.seq != null ? '&seq=' + encodeURIComponent(meta.seq) : '') +
      (meta.objectId ? '&objectId=' + encodeURIComponent(meta.objectId) : '');
    PDP_BYTE_PENDING[key] = jsonp(q, 120000, PDP_SLIDES_URL)
      .then((data) => {
        if (!data || !data.base64) throw new Error('PDP image had no bytes.');
        const label = shotNameForPdpSeq(meta.seq, shotListFor(taskByEan(state.workspace && state.workspace.ean) || {}));
        const asset = assetFromPdpBytes(data, meta, label);
        PDP_BYTE_CACHE[key] = asset;
        return asset;
      })
      .finally(() => {
        delete PDP_BYTE_PENDING[key];
      });
    return PDP_BYTE_PENDING[key];
  }

  function prefetchPrimaryPdpBytes(t) {
    const images = primaryPdpImages();
    if (!images.length) return;
    const shots = shotListFor(t || {});
    // Warm cache for every PDP cell; active shot is prioritized first.
    const activeMeta = pdpMetaForShot(shots[state.workspaceShot || 0], state.workspaceShot || 0);
    const ordered = images.slice().sort((a, b) => {
      const aActive = activeMeta && pdpCacheKey(a) === pdpCacheKey(activeMeta) ? 0 : 1;
      const bActive = activeMeta && pdpCacheKey(b) === pdpCacheKey(activeMeta) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (Number(a.seq) || 0) - (Number(b.seq) || 0);
    });
    let i = 0;
    const workers = 3;
    function next() {
      if (i >= ordered.length) return;
      if (!state.workspace || state.workspace.mode !== 'primary') return;
      const meta = ordered[i++];
      loadPdpBytesCached(meta).then(() => next()).catch(() => next());
    }
    for (let w = 0; w < workers; w++) next();
  }

  function schedulePrimaryA2ForShot(shotIndex) {
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    const p = state.workspace.primary;
    if (!p || !p.pdp) return;
    const key = String(shotIndex);
    if (p.a2Manual && p.a2Manual[key]) return;
    if (p.a2 && p.a2[key] && p.a2[key].blob) return;
    if (p.a2Loading && p.a2Loading[key]) return;
    const task = taskByEan(state.workspace.ean);
    const shots = shotListFor(task || {});
    const shot = shots[shotIndex];
    const meta = pdpMetaForShot(shot, shotIndex);
    if (!meta || !meta.contentUrl) return;
    if (!p.a2Loading) p.a2Loading = {};
    const cacheKey = pdpCacheKey(meta);
    const label = primaryA2DisplayName(shot, meta, null);
    if (PDP_BYTE_CACHE[cacheKey]) {
      if (!p.a2) p.a2 = {};
      p.a2[key] = clonePdpAsset(PDP_BYTE_CACHE[cacheKey], label);
      delete p.a2Loading[key];
      maybeRefreshAutomatedPrimaryPrompt(shotIndex);
      renderWorkspace();
      return;
    }
    if (p.a2Loading[key]) return;
    p.a2Loading[key] = true;
    // Show contentUrl preview immediately while bytes fetch.
    if (!p.a2) p.a2 = {};
    if (!p.a2[key] || !p.a2[key].blob) {
      p.a2[key] = {
        id: 'pdp_url_' + (meta.objectId || meta.seq),
        name: label,
        label: label,
        source: 'pdp-slides-url',
        url: meta.contentUrl,
        contentUrl: meta.contentUrl,
        pdpSeq: meta.seq,
        pdpObjectId: meta.objectId,
        w: 0,
        h: 0
      };
      maybeRefreshAutomatedPrimaryPrompt(shotIndex);
      requestAnimationFrame(() => {
        if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
      });
    }
    loadPdpBytesCached(meta)
      .then((asset) => {
        if (!state.workspace || state.workspace.mode !== 'primary' || !state.workspace.primary) return;
        if (state.workspace.primary.a2Manual && state.workspace.primary.a2Manual[key]) return;
        // Still the same PDP cell for this shot?
        const still = pdpMetaForShot(shotListFor(taskByEan(state.workspace.ean) || {})[shotIndex], shotIndex);
        if (still && pdpCacheKey(still) !== cacheKey) return;
        if (!state.workspace.primary.a2) state.workspace.primary.a2 = {};
        state.workspace.primary.a2[key] = clonePdpAsset(asset, label);
        if (state.workspace.primary.a2Loading) delete state.workspace.primary.a2Loading[key];
        maybeRefreshAutomatedPrimaryPrompt(shotIndex);
        renderWorkspace();
      })
      .catch((err) => {
        if (!state.workspace || !state.workspace.primary) return;
        if (state.workspace.primary.a2Loading) delete state.workspace.primary.a2Loading[key];
        console.warn('PDP A2 load', err);
        if (pdpNeedsAuth(err)) {
          state.workspace.primary.pdpError = 'PDP slides need Google access.';
          showPdpAuthDialog('PDP image download needs your permission. Click Allow access.');
        }
        if (state.workspace.mode === 'primary') renderWorkspace();
      });
  }

  function assignPrimaryA2FromPdp(shotIndex, meta) {
    if (!state.workspace || !state.workspace.primary || !meta) return;
    const p = state.workspace.primary;
    const key = String(shotIndex);
    if (!p.a2Override) p.a2Override = {};
    p.a2Override[key] = { seq: meta.seq, objectId: meta.objectId || '' };
    if (p.a2Manual) delete p.a2Manual[key];
    if (p.a2) {
      revokeAssetUrl(p.a2[key]);
      delete p.a2[key];
    }
    if (p.a2Loading) delete p.a2Loading[key];
    renderWorkspace();
    schedulePrimaryA2ForShot(shotIndex);
  }

  function openPrimaryA2Picker(shotIndex) {
    const p = state.workspace && state.workspace.primary;
    const images = primaryPdpImages();
    if (!p || !images.length) {
      showToast('PDP images are not loaded yet.', false, { error: true });
      return;
    }
    const task = taskByEan(state.workspace.ean);
    const shots = shotListFor(task || {});
    const shot = shots[shotIndex] || shots[0];
    const current = pdpMetaForShot(shot, shotIndex);
    let overlay = document.getElementById('wr-primary-a2-picker');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wr-primary-a2-picker';
      overlay.className = 'wr-prompt-modal wr-a2-picker-modal';
      overlay.hidden = true;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target.closest('[data-wr-a2-close]')) {
          overlay.hidden = true;
          return;
        }
        const pick = e.target.closest('[data-wr-a2-pick]');
        if (!pick) return;
        const seq = Number(pick.getAttribute('data-wr-a2-pick'));
        const objectId = pick.getAttribute('data-wr-a2-oid') || '';
        const rawIdx = overlay.dataset.shotIndex;
        const idx = rawIdx != null && rawIdx !== '' ? Number(rawIdx) : NaN;
        if (isNaN(idx)) return;
        const meta = primaryPdpImages().find((img) =>
          (objectId && img.objectId === objectId) || Number(img.seq) === seq
        );
        if (!meta) return;
        assignPrimaryA2FromPdp(idx, meta);
        overlay.hidden = true;
        showToast('A2 set to ' + esc(shotNameForPdpSeq(meta.seq, shotListFor(taskByEan(state.workspace.ean) || {}))), false);
      });
    }
    overlay.dataset.shotIndex = String(shotIndex);
    const tiles = images.map((img) => {
      const label = shotNameForPdpSeq(img.seq, shots);
      const cacheKey = pdpCacheKey(img);
      const cached = PDP_BYTE_CACHE[cacheKey];
      const thumb = (cached && ensureAssetDisplayUrl(cached)) || img.contentUrl || '';
      const selected = current && (
        (current.objectId && current.objectId === img.objectId) ||
        Number(current.seq) === Number(img.seq)
      );
      return '<button type="button" class="wr-a2-pick' + (selected ? ' is-selected' : '') +
        '" data-wr-a2-pick="' + esc(String(img.seq)) +
        '" data-wr-a2-oid="' + esc(img.objectId || '') +
        '" title="' + esc(label) + '">' +
        '<span class="wr-a2-pick-thumb">' +
          (thumb
            ? '<img src="' + esc(thumb) + '" alt="" referrerpolicy="no-referrer">'
            : '<span class="wr-ph">—</span>') +
        '</span>' +
        '<span class="wr-a2-pick-seq">Seq ' + esc(String(img.seq)) + '</span>' +
        '<span class="wr-a2-pick-name">' + esc(label) + '</span>' +
      '</button>';
    }).join('');
    const a2PickerLabel = isLifestyleShot(shot)
      ? 'Change PDP Lifestyle reference'
      : 'Change PDP camera reference';
    overlay.innerHTML =
      '<div class="wr-prompt-modal-backdrop" data-wr-a2-close></div>' +
      '<div class="wr-prompt-modal-panel wr-a2-picker-panel" role="dialog" aria-modal="true" aria-label="' +
        esc(a2PickerLabel) + '">' +
        '<div class="wr-prompt-modal-head">' +
          '<div class="wr-prompt-modal-title">' + esc(a2PickerLabel) +
            (shot && shot.name ? ' · ' + esc(shot.name) : '') +
          '</div>' +
          '<button type="button" class="wr-icon-btn" data-wr-a2-close title="Close" aria-label="Close">✕</button>' +
        '</div>' +
        '<p class="wr-a2-picker-note">' +
          (isLifestyleShot(shot)
            ? 'Pick the PDP lifestyle scene for this shot. Product B replaces the main product in that scene.'
            : 'Pick the PDP sequence that matches this shot. Names follow Required shots order.') +
        '</p>' +
        '<div class="wr-a2-picker-grid">' + tiles + '</div>' +
      '</div>';
    overlay.hidden = false;
    // Prefetch any missing thumbs into cache while the picker is open.
    images.forEach((img) => {
      loadPdpBytesCached(img).then(() => {
        if (overlay.hidden) return;
        const btn = overlay.querySelector('[data-wr-a2-pick="' + String(img.seq) + '"] img');
        const cached = PDP_BYTE_CACHE[pdpCacheKey(img)];
        const url = cached && ensureAssetDisplayUrl(cached);
        if (btn && url) btn.src = url;
      }).catch(() => {});
    });
  }

  function schedulePrimaryPdpLoad(t) {
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    ensurePrimaryState(t);
    const p = state.workspace.primary;
    if (!p || p.pdpLoading || p.pdpAttempted) return;
    const link = primaryPdpLink(t);
    if (!link) {
      p.pdpAttempted = true;
      p.pdpError = 'No PDP guideline link on this task.';
      return;
    }
    if (!PDP_SLIDES_URL) {
      p.pdpAttempted = true;
      p.pdpError = 'PDP_SLIDES_URL is not set.';
      return;
    }
    p.pdpAttempted = true;
    p.pdpLoading = true;
    p.pdpError = '';
    requestAnimationFrame(() => {
      if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
    });
    let q = 'action=pdpSlideImages&url=' + encodeURIComponent(link);
    const title = String((t && (t.title || t.productName)) || '').trim();
    // If the sheet link has no slide=id.…, search by product title.
    if (title && !/[#&?]slide=id\./i.test(link)) {
      q += '&q=' + encodeURIComponent(title);
    }
    jsonp(q, 120000, PDP_SLIDES_URL)
      .then((data) => {
        if (!state.workspace || state.workspace.mode !== 'primary' || !state.workspace.primary) return;
        hidePdpAuthDialog();
        state.workspace.primary.pdp = data || null;
        state.workspace.primary.pdpLoading = false;
        const count = (data && data.images && data.images.length) || 0;
        if (!count) {
          state.workspace.primary.pdpError = 'No product images found on that PDP slide.';
        } else {
          state.workspace.primary.pdpError = '';
          const shots = shotListFor(t);
          const nonMainCount = shots.filter((s) => !isMainShot(s)).length;
          const mismatch = nonMainCount && count !== nonMainCount
            ? ' · PDP ' + count + ' vs ' + nonMainCount + ' angle shots'
            : '';
          showToast('PDP camera refs loaded · ' + count + ' image' + (count === 1 ? '' : 's') +
            ' (seq order)' + mismatch, false);
        }
        renderWorkspace();
        schedulePrimaryA2ForShot(state.workspaceShot || 0);
        prefetchPrimaryPdpBytes(t);
      })
      .catch((err) => {
        if (!state.workspace || !state.workspace.primary) return;
        state.workspace.primary.pdpLoading = false;
        if (pdpNeedsAuth(err)) {
          // Allow retry after the Google Allow popup — do not leave Attempted locked.
          state.workspace.primary.pdpAttempted = false;
          state.workspace.primary.pdpError = 'PDP slides need Google access.';
          showPdpAuthDialog('PDP camera refs need your permission. Click Allow access.');
        } else {
          state.workspace.primary.pdpError = (err && err.message) || 'Could not load PDP slide images.';
        }
        if (state.workspace.mode === 'primary') renderWorkspace();
      });
  }

  function schedulePrimaryA1Load(t, opts) {
    opts = opts || {};
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    ensurePrimaryState(t);
    const p = state.workspace.primary;
    if (!p || p.a1 || p.a1Loading) return;
    // Lifestyle (+ variants) never use the template plate — do not auto-load A1.
    const shots = shotListFor(t || {});
    const cur = shots[state.workspaceShot || 0];
    if (isLifestyleShot(cur) && !opts.force) return;
    if (!opts.force && p.a1Attempted) return;
    p.a1Attempted = true;
    p.a1Cleared = false;
    const tpl = t && t.template;
    if (!tpl) {
      p.a1Error = 'No template mapped for this product.';
      return;
    }
    p.a1Loading = true;
    p.a1Error = '';
    // Refresh badge after paint; fetch runs async.
    requestAnimationFrame(() => {
      if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
    });
    Promise.resolve()
      .then(() => loadTemplateRefImages(!!opts.force))
      .then(() => {
        let img = templateRefImage(tpl);
        if (!img || !img.id) {
          // Folder list may have been empty/stale — force one refresh.
          return loadTemplateRefImages(true).then(() => {
            img = templateRefImage(tpl);
            if (!img || !img.id) {
              throw new Error('No reference image mapped for ' + tpl + ' yet.');
            }
            return fetchDriveFileAsset(img.id);
          });
        }
        return fetchDriveFileAsset(img.id);
      })
      .then((asset) => {
        if (!state.workspace || state.workspace.mode !== 'primary' || !state.workspace.primary) return;
        // Prefer sheet template code for the meta label (avoid long Drive names / ellipsis).
        const code = tidyTemplate(tpl);
        if (code) {
          asset.label = code;
          asset.name = code;
        }
        state.workspace.primary.a1 = asset;
        state.workspace.primary.a1Loading = false;
        state.workspace.primary.a1Error = '';
        state.workspace.primary.a1Cleared = false;
        maybeRefreshAutomatedPrimaryPrompt(state.workspaceShot || 0);
        renderWorkspace();
      })
      .catch((err) => {
        if (!state.workspace || !state.workspace.primary) return;
        state.workspace.primary.a1Loading = false;
        state.workspace.primary.a1Error = (err && err.message) || 'Could not load template.';
        if (state.workspace.mode === 'primary') renderWorkspace();
      });
  }

  function restorePrimaryA1() {
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    ensurePrimaryState();
    const p = state.workspace.primary;
    if (!p) return;
    p.a1Attempted = false;
    p.a1Cleared = false;
    p.a1Error = '';
    const task = taskByEan(state.workspace.ean);
    schedulePrimaryA1Load(task, { force: true });
  }

  /** Inject primary-prompt-core.js once if the page forgot the script tag (e.g. old index.html). */
  function ensurePrimaryPromptCoreScript() {
    if (window.PrimaryPromptCore && window.PrimaryPromptCore.compilePrompt) return;
    if (document.querySelector('script[data-primary-prompt-core]')) return;
    const s = document.createElement('script');
    s.src = 'primary-prompt/primary-prompt-core.js?v=6';
    s.setAttribute('data-primary-prompt-core', '1');
    s.onload = function () {
      if (!(window.PrimaryPromptCore && window.PrimaryPromptCore.compilePrompt)) return;
      if (state.workspace && state.workspace.mode === 'primary') {
        const task = taskByEan(state.workspace.ean);
        if (task) syncAutomatedPrimaryPromptsToLatestCompile(task);
        renderWorkspace();
      }
    };
    s.onerror = function () {
      console.warn('Could not load primary-prompt/primary-prompt-core.js');
    };
    (document.head || document.documentElement).appendChild(s);
  }

  /**
   * Ordered Answerly slots for Primary: A1 → A2 → A3 → B1..B4 (skip missing A*).
   * B is compulsory (1–4); only the starting index changes with A* presence.
   * Logic shared with primary-prompt/primary-prompt-lab.html via PrimaryPromptCore.
   */
  /** Hero Front / seq 01 generated D as a Primary A2-style asset for MAIN. */
  function primaryMainHeroOutputAsset(shots) {
    const list = shots || shotListFor(taskByEan(state.workspace && state.workspace.ean) || {});
    const angleIdx = angleSourceShotIndex(list);
    if (angleIdx < 0) return null;
    const out = shotAssets(angleIdx).output;
    if (!(out && (out.blob || out.file || out.url))) return null;
    const angle = list[angleIdx] || {};
    return Object.assign({}, out, {
      name: out.name || ((angle.name || angle.code || 'Hero Front') + ' D'),
      label: (angle.name || angle.code || 'Hero Front') + ' · generated D',
      fromHeroFront: true,
      angleShotIndex: angleIdx
    });
  }

  function primaryInputPlan(shotIndex, opts) {
    const options = opts || {};
    const idx = shotIndex != null ? Number(shotIndex) : (state.workspaceShot || 0);
    const task = taskByEan(state.workspace && state.workspace.ean);
    const shots = options.shots || shotListFor(task || {});
    const shot = shots[idx];
    const lifestyle = isLifestyleShot(shot);
    // Lifestyle: optional A1 only if user added one for this shot (never template auto-load).
    const a1 = lifestyle
      ? (options.a1 !== undefined ? options.a1 : primarySlotAsset('a1', idx))
      : (options.a1 !== undefined
        ? options.a1
        : (state.workspace && state.workspace.primary && state.workspace.primary.a1) || null);
    // MAIN: camera/composition from Hero Front / 01 D (same rule as Replace), not PDP.
    let a2;
    let mainFromHero = false;
    if (options.a2 !== undefined) {
      a2 = options.a2;
      mainFromHero = !!(a2 && a2.fromHeroFront);
    } else if (isMainShot(shot)) {
      a2 = primaryMainHeroOutputAsset(shots);
      mainFromHero = !!a2;
    } else {
      a2 = primarySlotAsset('a2', idx);
    }
    // Lifestyle: no A3 — A2 scene + B (+ optional A1) mirrors Product Replacement.
    const a3Asset = lifestyle
      ? null
      : (options.a3 !== undefined ? options.a3 : primarySlotAsset('a3', idx));
    const showA3 = lifestyle
      ? false
      : (options.showA3 != null
        ? !!options.showA3
        : (primaryShowA3(idx) || !!a3Asset));
    const a3 = showA3 ? a3Asset : null;
    // MAIN may borrow Hero Front / 01 B at generate time (not shown on MAIN rail).
    const ownInputs = (shotAssets(idx).inputs || []).slice(0, 4);
    const borrowed = isMainShot(shot) && !ownInputs.length
      ? productInputsForShot(idx, shots)
      : { inputs: ownInputs, borrowed: false };
    const inputs = options.inputs || (borrowed.inputs || []).slice(0, 4);
    // B compulsory: at least 1 product slot in the plan / prompt numbering.
    const bCount = options.bCount != null
      ? (window.PrimaryPromptCore
        ? window.PrimaryPromptCore.clampBCount(options.bCount)
        : Math.max(1, Math.min(4, Number(options.bCount) || 1)))
      : Math.max(1, Math.min(4, inputs.length || 1));

    // Lifestyle replace-style order: A2 scene = url_1, optional A1, then B (matches Replacement).
    if (lifestyle) {
      const slots = [];
      let n = 1;
      if (a2) {
        slots.push({
          role: 'a2',
          refKey: 'reference_image_url_' + n,
          inputImage: n,
          label: 'LIFESTYLE SCENE / CAMERA REFERENCE',
          asset: a2
        });
        n += 1;
      }
      if (a1) {
        slots.push({
          role: 'a1',
          refKey: 'reference_image_url_' + n,
          inputImage: n,
          label: 'OPTIONAL REFERENCE',
          asset: a1
        });
        n += 1;
      }
      const bStart = n;
      for (let i = 0; i < bCount; i++) {
        slots.push({
          role: 'b',
          bIndex: i,
          refKey: 'reference_image_url_' + n,
          inputImage: n,
          label: 'PRODUCT REFERENCE',
          asset: inputs[i] || null
        });
        n += 1;
      }
      return {
        shotIndex: idx,
        hasA1: !!a1,
        hasA2: !!a2,
        hasA3: false,
        bCount: bCount,
        bStartNum: bStart,
        slots: slots,
        a1: a1,
        a2: a2,
        a3: null,
        inputs: inputs,
        isMain: isMainShot(shot),
        isLifestyle: true,
        mainFromHero: mainFromHero,
        borrowedProductFromAngle: !!borrowed.borrowed
      };
    }

    const corePlan = window.PrimaryPromptCore
      ? window.PrimaryPromptCore.buildPlan({
          hasA1: !!a1,
          hasA2: !!a2,
          hasA3: !!a3,
          bCount: bCount
        })
      : null;
    const slots = (corePlan && corePlan.slots ? corePlan.slots : []).map((s) => {
      if (s.role === 'a1') return Object.assign({}, s, { asset: a1 });
      if (s.role === 'a2') return Object.assign({}, s, { asset: a2 });
      if (s.role === 'a3') return Object.assign({}, s, { asset: a3 });
      if (s.role === 'b') return Object.assign({}, s, { asset: inputs[s.bIndex] || null });
      return s;
    });
    // Fallback if core script failed to load.
    if (!slots.length) {
      let n = 1;
      if (a1) {
        slots.push({ role: 'a1', refKey: 'reference_image_url_' + n, inputImage: n, label: 'MASTER BACKGROUND', asset: a1 });
        n += 1;
      }
      if (a2) {
        slots.push({ role: 'a2', refKey: 'reference_image_url_' + n, inputImage: n, label: 'CAMERA REFERENCE ONLY', asset: a2 });
        n += 1;
      }
      if (a3) {
        slots.push({ role: 'a3', refKey: 'reference_image_url_' + n, inputImage: n, label: 'OPTIONAL REFERENCE', asset: a3 });
        n += 1;
      }
      const bStart = n;
      for (let i = 0; i < bCount; i++) {
        slots.push({
          role: 'b', bIndex: i, refKey: 'reference_image_url_' + n, inputImage: n,
          label: 'PRODUCT REFERENCE', asset: inputs[i] || null
        });
        n += 1;
      }
      return {
        shotIndex: idx, hasA1: !!a1, hasA2: !!a2, hasA3: !!a3,
        bCount: bCount, bStartNum: bStart, slots: slots,
        a1: a1, a2: a2, a3: a3, inputs: inputs,
        isMain: isMainShot(shot),
        isLifestyle: lifestyle,
        mainFromHero: mainFromHero,
        borrowedProductFromAngle: !!borrowed.borrowed
      };
    }
    return {
      shotIndex: idx,
      hasA1: !!a1,
      hasA2: !!a2,
      hasA3: !!a3,
      bCount: bCount,
      bStartNum: corePlan.bStartNum,
      slots: slots,
      a1: a1,
      a2: a2,
      a3: a3,
      inputs: inputs,
      isMain: isMainShot(shot),
      isLifestyle: lifestyle,
      mainFromHero: mainFromHero,
      borrowedProductFromAngle: !!borrowed.borrowed
    };
  }

  /**
   * Product replacement Final successful prompt from Prompt DB (Universal).
   * Same pool as Replacement; prefer a full PRODUCT REPLACEMENT body (shot or master).
   */
  function resolveProductReplacementFinalPrompt(shot, productTypeName) {
    function isFullReplaceBody(text) {
      return /^#\s*PRODUCT REPLACEMENT/i.test(String(text || '').trim());
    }
    function masterFromPool(pool) {
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        if (!isReplaceWorkflow(row)) continue;
        if (!String(row.imageName || '').trim() && !String(row.imageShortCode || '').trim() &&
            String(row.prompt || '').trim()) {
          return { prompt: row.prompt, label: 'master', row: row };
        }
      }
      return null;
    }
    const resolved = resolveUniversalPrompt(shot, productTypeName, { workflow: 'replace' });
    if (resolved && isFullReplaceBody(resolved.prompt)) return resolved;
    const live = (state.universalRows && state.universalRows.length)
      ? state.universalRows.filter(isReplaceWorkflow)
      : [];
    const liveMaster = masterFromPool(live);
    if (liveMaster && isFullReplaceBody(liveMaster.prompt)) return liveMaster;
    const embed = window.UNIVERSAL_REPLACE_PROMPTS;
    const embedRows = (embed && embed.rows) || [];
    const embedMaster = masterFromPool(embedRows);
    if (embedMaster) return embedMaster;
    if (resolved && String(resolved.prompt || '').trim()) return resolved;
    return { prompt: '', label: 'missing', row: null };
  }

  /**
   * Lifestyle Primary: same iteration as Replacement (Final successful + product/target +
   * INPUT IMAGE blocks). A2 = scene (url_1); optional A1; B = product refs.
   */
  function compilePrimaryLifestylePrompt(t, shot, opts) {
    const options = opts || {};
    const productTypeName = (state.workspace && state.workspace.productTypeName) || options.productTypeName || '';
    const shots = options.shots || (t ? shotListFor(t) : []);
    const shotIndex = options.shotIndex != null
      ? Number(options.shotIndex)
      : (shots.indexOf(shot) >= 0 ? shots.indexOf(shot) : (state.workspaceShot || 0));
    const plan = primaryInputPlan(shotIndex, Object.assign({}, options.planOpts || {}, { shots: shots }));
    const resolved = resolveProductReplacementFinalPrompt(shot, productTypeName);
    const hasOptA1 = !!plan.hasA1;
    const actualB = Math.min(4, ((plan.inputs && plan.inputs.length) || (shotAssets(shotIndex).inputs || []).length || 0));
    const bCount = Math.max(1, actualB || plan.bCount || 1);
    const bStart = Math.max(2, Number(plan.bStartNum) || (hasOptA1 ? 3 : 2));
    // DB Final successful body, adapted only for present product images + lifestyle labels.
    let base = clarifyReplaceInputImageWording(ensureFullRemoveRule(resolved.prompt), {
      productCount: bCount,
      productStartNum: bStart
    });
    base = String(base || '')
      .replace(
        /\*\*INPUT IMAGE 1\s*[—\-]\s*`reference_image_url_1`\s*[—\-]\s*PRIOR\s*\/\s*MASTER\*\*/gi,
        '**INPUT IMAGE 1 — `reference_image_url_1` — LIFESTYLE SCENE / CAMERA REFERENCE**'
      )
      .replace(
        /The original scene to be edited\. Preserve this image exactly, except for the main product\./gi,
        'The lifestyle scene / camera reference to be edited. Preserve this image exactly, except for the main product.'
      )
      .replace(/PRIOR\s*\/\s*MASTER/gi, 'LIFESTYLE SCENE / CAMERA REFERENCE')
      .replace(/\bmaster image\b/gi, 'lifestyle scene')
      .replace(/\bprior product\b/gi, 'original product in the lifestyle scene');

    if (hasOptA1) {
      base = base.replace(
        /(\*\*INPUT IMAGE 1[^*\n]*\*\*[\s\S]*?)(\n\*\*INPUT IMAGE)/i,
        '$1\n\n**INPUT IMAGE 2 — `reference_image_url_2` — OPTIONAL REFERENCE (A1)**\n\n' +
          'Optional supporting reference only. Do not let it override product identity from the product reference images.\n$2'
      );
    }

    // Same light shot iteration as Replacement (product line + target) — no duplicate INPUT blocks.
    const productLine = productInsertSentence(t, shot);
    const cleaned = cleanWhatToShoot(shot, shots);
    const camera = cameraHintForShot(shot, cleaned);
    const family = String((shot && shot.family) || '').trim();
    const shotName = String((shot && shot.name) || '').trim() || 'this shot';
    let target = 'Target ' + shotName;
    if (family) target += ' — ' + family;
    target += '.';
    if (cleaned) target += ' ' + cleaned;
    if (camera && cleaned.toLowerCase().indexOf(camera.replace(/^Camera:\s*/i, '').slice(0, 24).toLowerCase()) < 0) {
      target += (/\.$/.test(target.trim()) ? ' ' : '. ') + camera;
    }

    const lines = [];
    if (base) lines.push(base);
    if (productLine) lines.push('', productLine);
    if (target) lines.push('', target);
    return {
      text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      slots: plan.slots,
      plan: plan,
      fromDb: !!(resolved.prompt && String(resolved.prompt).trim()),
      lifestyle: true,
      universalLabel: (resolved.label && resolved.label !== 'missing'
        ? ('replace · ' + resolved.label)
        : 'replace · master'),
      universalRow: resolved.row || null,
      cleanedWhatToShoot: cleaned
    };
  }

  function compilePrimaryPrompt(t, shot, opts) {
    const options = opts || {};
    const productTypeName = (state.workspace && state.workspace.productTypeName) || options.productTypeName || '';
    const shots = options.shots || (t ? shotListFor(t) : []);
    const shotIndex = options.shotIndex != null
      ? Number(options.shotIndex)
      : (shots.indexOf(shot) >= 0 ? shots.indexOf(shot) : (state.workspaceShot || 0));
    if (isLifestyleShot(shot)) {
      return compilePrimaryLifestylePrompt(t, shot, Object.assign({}, options, { shotIndex: shotIndex, shots: shots }));
    }
    const plan = primaryInputPlan(shotIndex, options.planOpts || {});
    const mainShot = isMainShot(shot);
    const productLine = productInsertSentence(t, shot);
    const cleaned = cleanWhatToShoot(shot, shots);
    const camera = cameraHintForShot(shot, cleaned);
    const family = String((shot && shot.family) || '').trim();
    const shotName = String((shot && shot.name) || '').trim() || 'this shot';
    let target = 'Target ' + shotName;
    if (family) target += ' — ' + family;
    target += '.';
    if (cleaned) target += ' ' + cleaned;
    if (camera && cleaned.toLowerCase().indexOf(camera.replace(/^Camera:\s*/i, '').slice(0, 24).toLowerCase()) < 0) {
      target += (/\.$/.test(target.trim()) ? ' ' : '. ') + camera;
    }

    // MAIN: same pattern as Replacement — Universal MAIN Final successful almost intact.
    if (mainShot) {
      const resolved = resolvePrimaryMainUniversal(productTypeName);
      let base = String(resolved.prompt || '').trim();
      // Light key modernization only when the MAIN body is Product-replacement shaped.
      if (/^#\s*PRODUCT REPLACEMENT/i.test(base)) {
        base = clarifyReplaceInputImageWording(ensureFullRemoveRule(base), {
          productCount: Math.max(1, plan.bCount || 1),
          productStartNum: Math.max(2, plan.bStartNum || 2)
        });
      }
      const lines = [];
      if (base) lines.push(base);
      if (productLine) lines.push('', productLine);
      if (target) lines.push('', target);
      return {
        text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        slots: plan.slots,
        plan: plan,
        fromDb: !!base,
        lifestyle: false,
        universalLabel: (resolved.label && String(resolved.label).trim()) || 'MAIN',
        universalRow: resolved.row || null,
        cleanedWhatToShoot: cleaned
      };
    }

    // Non-MAIN: Prompt DB Universal (Primary workflow) with live A1→A2→A3→B renumbering.
    const resolved = resolveUniversalPrompt(shot, productTypeName, { workflow: 'primary' });
    let dbText = String(resolved.prompt || '').trim();
    const isCompositionTemplate = /^#\s*PHOTOREALISTIC PRODUCT COMPOSITION/i.test(dbText);
    let extraUniversalNote = '';
    if (dbText && !isCompositionTemplate && !/^#\s*PRODUCT REPLACEMENT/i.test(dbText)) {
      extraUniversalNote = dbText;
      dbText = '';
      const master = resolvePrimaryUniversalMaster(productTypeName);
      if (master && master.prompt) dbText = String(master.prompt || '').trim();
    }
    const appendixParts = [];
    if (extraUniversalNote) appendixParts.push(extraUniversalNote);
    if (productLine) appendixParts.push(productLine);
    if (target) appendixParts.push(target);
    const appendix = appendixParts.join('\n\n');

    ensurePrimaryPromptCoreScript();
    let text = '';
    let fromDb = false;
    if (window.PrimaryPromptCore && window.PrimaryPromptCore.compileFromUniversal) {
      const compiled = window.PrimaryPromptCore.compileFromUniversal(dbText, {
        hasA1: plan.hasA1,
        hasA2: plan.hasA2,
        hasA3: plan.hasA3,
        bCount: plan.bCount,
        appendix: appendix
      });
      text = compiled.text;
      fromDb = !!compiled.fromDb;
    } else if (window.PrimaryPromptCore && window.PrimaryPromptCore.compilePrompt) {
      text = window.PrimaryPromptCore.compilePrompt({
        hasA1: plan.hasA1,
        hasA2: plan.hasA2,
        hasA3: plan.hasA3,
        bCount: plan.bCount,
        appendix: appendix
      }).text;
    } else {
      text = [
        '# PHOTOREALISTIC PRODUCT COMPOSITION',
        '',
        'Loading Primary prompt core… (refresh if this stays).',
        appendix ? ('\n## SHOT-SPECIFIC TARGET\n\n' + appendix) : ''
      ].join('\n').trim();
    }

    return {
      text: text,
      slots: plan.slots,
      plan: plan,
      fromDb: fromDb,
      lifestyle: false,
      universalLabel: resolved.label || (fromDb ? 'master' : 'core'),
      universalRow: resolved.row || null,
      cleanedWhatToShoot: cleaned
    };
  }

  /** Blank Image Name + short code Primary Universal master (composition body). */
  function resolvePrimaryUniversalMaster(productTypeName) {
    const rows = (state.universalRows && state.universalRows.length)
      ? state.universalRows
      : embeddedUniversalRows();
    const pt = normPromptKey(productTypeName);
    const primaryRows = rows.filter(isPrimaryWorkflow);
    function typeOk(row) {
      const rpt = normPromptKey(row.productType);
      return !rpt || !pt || rpt === pt;
    }
    for (let i = 0; i < primaryRows.length; i++) {
      const row = primaryRows[i];
      if (!String(row.imageName || '').trim() && !String(row.imageShortCode || '').trim() && typeOk(row)) {
        return row;
      }
    }
    for (let j = 0; j < primaryRows.length; j++) {
      const row = primaryRows[j];
      if (!String(row.imageName || '').trim() && !String(row.imageShortCode || '').trim()) return row;
    }
    return primaryRows[0] || null;
  }

  /** If C was not human-edited, recompile after A1/A2/A3/B slot changes (no yellow). */
  function maybeRefreshAutomatedPrimaryPrompt(shotIndex) {
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    const task = taskByEan(state.workspace.ean);
    if (!task) return;
    const idx = shotIndex != null ? Number(shotIndex) : (state.workspaceShot || 0);
    // Human typing wins — script must not overwrite or yellow.
    if (isPromptManualEdit(idx)) return;
    const shots = shotListFor(task);
    const shot = shots[idx] || shots[0];
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
    const compiled = compilePrimaryPrompt(task, shot, { shotIndex: idx });
    state.workspace.prompts[idx] = compiled.text;
    rememberPromptBaseline(idx, compiled.text);
    setPromptManualEdit(idx, false);
  }

  /** Replacement: refresh C when B count changes unless the user typed in C. */
  function maybeRefreshAutomatedReplacePrompt(shotIndex) {
    if (!state.workspace || state.workspace.mode !== 'replace') return;
    const task = taskByEan(state.workspace.ean);
    if (!task) return;
    const idx = shotIndex != null ? Number(shotIndex) : (state.workspaceShot || 0);
    if (isPromptManualEdit(idx)) return;
    const shots = shotListFor(task);
    const shot = shots[idx] || shots[0];
    const prior = resolveWorkspaceMatch(task).selected;
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
    const compiled = compileReplacePrompt(task, shot, prior, { shotIndex: idx });
    state.workspace.prompts[idx] = compiled.text;
    rememberPromptBaseline(idx, compiled.text);
    setPromptManualEdit(idx, false);
  }

  function maybeRefreshAutomatedPromptForShot(shotIndex) {
    if (!state.workspace) return;
    if (state.workspace.mode === 'primary') maybeRefreshAutomatedPrimaryPrompt(shotIndex);
    else if (state.workspace.mode === 'replace') maybeRefreshAutomatedReplacePrompt(shotIndex);
  }

  /* ---------- Replace workspace image assets (local File / Blob in memory) ---------- */

  function shotAssets(shotIndex) {
    if (!state.workspace) return { inputs: [], priorOverride: null, output: null, error: null };
    if (!state.workspace.assets) state.workspace.assets = {};
    const key = String(shotIndex);
    if (!state.workspace.assets[key]) {
      state.workspace.assets[key] = { inputs: [], priorOverride: null, output: null, error: null };
    }
    return state.workspace.assets[key];
  }

  function revokeAssetUrl(asset) {
    // Shared PDP cache entries keep their blob URL for other shots / the picker.
    if (asset && asset.sharedCache) return;
    if (asset && asset.url && String(asset.url).indexOf('blob:') === 0) {
      const dead = asset.url;
      try { URL.revokeObjectURL(dead); } catch (e) { /* ignore */ }
      asset.url = '';
      asset._blobRef = null;
      // Drop any export-row thumbs that still pointed at the revoked blob (stops console spam).
      if (state.workspace && state.workspace.exportImages) {
        Object.keys(state.workspace.exportImages).forEach((k) => {
          const img = state.workspace.exportImages[k];
          if (img && img.url === dead) {
            img.url = '';
            img._blobRef = null;
            ensureExportDisplayUrl(img);
          }
        });
      }
      if (state.workspace && state.workspace.approved) {
        Object.keys(state.workspace.approved).forEach((k) => {
          const rec = state.workspace.approved[k];
          if (rec && rec.url === dead) {
            rec.url = ensureAssetDisplayUrl(shotAssets(k).output) || '';
          }
        });
      }
    }
  }

  /**
   * Safe display URL for local assets.
   * Never reuse a bare blob: string — those die after revoke / EAN switch / refresh and
   * Chrome keeps retrying them (ERR_FILE_NOT_FOUND spam). Always mint from blob/file.
   */
  function ensureAssetDisplayUrl(asset) {
    if (!asset) return '';
    if (asset.url && /^https?:/i.test(asset.url)) return asset.url;
    const blob = asset.blob || asset.file;
    if (blob) {
      if (asset.url && asset._blobRef === blob) return asset.url;
      if (asset.url && String(asset.url).indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(asset.url); } catch (_) { /* ignore */ }
      }
      try {
        asset.url = URL.createObjectURL(blob);
        asset._blobRef = blob;
        return asset.url;
      } catch (_) { /* ignore */ }
    }
    // Orphan blob: URL with no backing file — drop it so <img> is not painted dead.
    if (asset.url && String(asset.url).indexOf('blob:') === 0) asset.url = '';
    return '';
  }

  function ensureExportDisplayUrl(img) {
    if (!img) return '';
    if (img.url && /^https?:/i.test(img.url)) return img.url;
    const blob = img.blob || img.file;
    if (blob) {
      if (img.url && img._blobRef === blob) return img.url;
      if (img.url && String(img.url).indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(img.url); } catch (_) { /* ignore */ }
      }
      try {
        img.url = URL.createObjectURL(blob);
        img._blobRef = blob;
        return img.url;
      } catch (_) { /* ignore */ }
    }
    if (img.url && String(img.url).indexOf('blob:') === 0) img.url = '';
    return '';
  }

  /** After restoring a draft (memory/IDB), drop dead blob: URLs so prior EANs don't spam the console. */
  function healWorkspaceBlobUrls() {
    if (!state.workspace) return;
    const assets = state.workspace.assets || {};
    Object.keys(assets).forEach((k) => {
      const a = assets[k];
      if (!a) return;
      (a.inputs || []).forEach((inp) => ensureAssetDisplayUrl(inp));
      if (a.priorOverride) ensureAssetDisplayUrl(a.priorOverride);
      if (a.output) ensureAssetDisplayUrl(a.output);
      if (a._previousOutput) ensureAssetDisplayUrl(a._previousOutput);
    });
    if (state.workspace.exportImages) {
      Object.keys(state.workspace.exportImages).forEach((k) => {
        const img = state.workspace.exportImages[k];
        if (!img) return;
        // Re-link export thumb to live D output blob when possible.
        const out = shotAssets(k).output;
        if (out && (out.blob || out.file)) {
          img.blob = out.blob || out.file;
          img.file = out.file || img.file || null;
        }
        ensureExportDisplayUrl(img);
      });
    }
    if (state.workspace.approved) {
      Object.keys(state.workspace.approved).forEach((k) => {
        const rec = state.workspace.approved[k];
        if (!rec) return;
        if (rec.url && String(rec.url).indexOf('blob:') === 0) {
          const out = shotAssets(k).output;
          const live = ensureAssetDisplayUrl(out);
          rec.url = live || '';
        }
      });
    }
  }

  function syncShotInputNames(shotIndex) {
    if (!state.workspace) return;
    if (!state.workspace.shotInputs) state.workspace.shotInputs = {};
    state.workspace.shotInputs[shotIndex] = shotAssets(shotIndex).inputs.map((a) => a.name);
  }

  function revokeAllWorkspaceAssets() {
    if (!state.workspace || !state.workspace.assets) return;
    Object.keys(state.workspace.assets).forEach((key) => {
      const a = state.workspace.assets[key];
      (a.inputs || []).forEach(revokeAssetUrl);
      revokeAssetUrl(a.priorOverride);
      revokeAssetUrl(a.output);
    });
  }

  function isAcceptedImageFile(file) {
    if (!file) return false;
    if (/image\/(jpeg|png|webp)/i.test(file.type || '')) return true;
    // Some OS/browsers leave type empty — fall back to extension.
    return /\.(jpe?g|png|webp)$/i.test(file.name || '');
  }

  function readLocalImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({
        id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: file.name || 'image.png',
        source: 'local',
        file: file,
        blob: file,
        url: url,
        _blobRef: file,
        w: img.naturalWidth,
        h: img.naturalHeight
      });
      img.onerror = () => {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        reject(new Error('Could not read image'));
      };
      img.src = url;
    });
  }

  async function addLocalFilesToShot(shotIndex, fileList) {
    if (!state.workspace) return;
    const files = Array.prototype.slice.call(fileList || []).filter(isAcceptedImageFile);
    if (!files.length) {
      showToast('Use JPG or PNG images only.', false);
      return;
    }
    const assets = shotAssets(shotIndex);
    const room = 4 - assets.inputs.length;
    if (room <= 0) {
      showToast('Maximum 4 input images per shot.', false);
      return;
    }
    const take = files.slice(0, room);
    if (files.length > room) {
      showToast('Only ' + room + ' more image' + (room === 1 ? '' : 's') + ' fit (max 4).', false);
    }
    take.forEach((f) => warnIfOverAnswerlyLimit(f, f.name || 'Product image'));
    try {
      persistReplacePromptFromDom();
      const loaded = await Promise.all(take.map(readLocalImageFile));
      assets.inputs = assets.inputs.concat(loaded);
      syncShotInputNames(shotIndex);
      maybeRefreshAutomatedPromptForShot(shotIndex);
      renderWorkspace();
      persistCurrentReplaceDraft();
      showToast(
        'Added ' + loaded.length + ' product image' + (loaded.length === 1 ? '' : 's') +
          ' to B · ' + assets.inputs.length + '/4 · click tile to crop',
        false
      );
    } catch (err) {
      showToast(err.message || 'Could not add image(s).', false, { error: true });
    }
  }

  async function setPriorOverrideFromFile(shotIndex, file) {
    if (!state.workspace || !isAcceptedImageFile(file)) {
      showToast('Use JPG or PNG images only.', false);
      return;
    }
    warnIfOverAnswerlyLimit(file, file.name || 'Prior image');
    persistReplacePromptFromDom();
    const assets = shotAssets(shotIndex);
    try {
      const loaded = await readLocalImageFile(file);
      revokeAssetUrl(assets.priorOverride);
      assets.priorOverride = loaded;
      // Force A to show the local override (Drive prior stays available after Clear override).
      state.workspaceShot = Number(shotIndex) || 0;
      await persistCurrentReplaceDraft();
      renderWorkspace();
      showToast('Prior override set · ' + esc(loaded.name || 'image') + ' (' + loaded.w + '×' + loaded.h + ')', false);
    } catch (err) {
      showToast(err.message || 'Could not set prior image.', false, { error: true });
    }
  }

  function removeShotInput(shotIndex, inputIndex) {
    const assets = shotAssets(shotIndex);
    const gone = assets.inputs[inputIndex];
    if (!gone) return;
    revokeAssetUrl(gone);
    assets.inputs = assets.inputs.filter((_, j) => j !== inputIndex);
    syncShotInputNames(shotIndex);
    maybeRefreshAutomatedPromptForShot(shotIndex);
    persistCurrentReplaceDraft();
  }

  /** Drop onto an existing B tile replaces that slot (then opens crop). */
  async function replaceShotInput(shotIndex, inputIndex, file) {
    if (!state.workspace || !isAcceptedImageFile(file)) {
      showToast('Use JPG or PNG images only.', false);
      return;
    }
    warnIfOverAnswerlyLimit(file, file.name || 'Product image');
    const assets = shotAssets(shotIndex);
    if (!assets.inputs || !assets.inputs[inputIndex]) {
      return addLocalFilesToShot(shotIndex, [file]);
    }
    try {
      persistReplacePromptFromDom();
      const loaded = await readLocalImageFile(file);
      revokeAssetUrl(assets.inputs[inputIndex]);
      assets.inputs[inputIndex] = loaded;
      syncShotInputNames(shotIndex);
      maybeRefreshAutomatedPromptForShot(shotIndex);
      renderWorkspace();
      persistCurrentReplaceDraft();
      showToast('Replaced B image · click tile to crop', false);
    } catch (err) {
      showToast(err.message || 'Could not replace image.', false, { error: true });
    }
  }

  function clearPriorOverride(shotIndex) {
    const assets = shotAssets(shotIndex);
    revokeAssetUrl(assets.priorOverride);
    assets.priorOverride = null;
    persistCurrentReplaceDraft();
  }

  /* ---------- Crop (B product inputs / prior / export) ---------- */

  let cropSession = null;
  let cropDrag = null;
  let cropWinDrag = null;

  function placeCropWindow(preferRight) {
    if (!els.cropWindow) return;
    const w = Math.min(420, window.innerWidth - 24);
    const margin = 12;
    let left = preferRight
      ? Math.max(margin, window.innerWidth - w - margin)
      : margin;
    let top = Math.max(margin, Math.min(88, window.innerHeight - 120));
    // Keep last dragged position if still on-screen.
    if (cropSession && cropSession.winLeft != null && cropSession.winTop != null) {
      left = cropSession.winLeft;
      top = cropSession.winTop;
    }
    left = Math.max(margin, Math.min(window.innerWidth - 80, left));
    top = Math.max(margin, Math.min(window.innerHeight - 80, top));
    els.cropWindow.style.left = left + 'px';
    els.cropWindow.style.top = top + 'px';
    els.cropWindow.style.right = 'auto';
    els.cropWindow.style.bottom = 'auto';
  }

  function cropKeepProportionOn() {
    return !(els.cropKeepProportion) || !!els.cropKeepProportion.checked;
  }

  function cropMinSize(nw, nh) {
    return Math.max(32, Math.round(Math.min(nw, nh) * 0.08));
  }

  function normalizeCropBox(box) {
    if (!box) return null;
    if (box.w != null && box.h != null) {
      return {
        x: Number(box.x) || 0,
        y: Number(box.y) || 0,
        w: Number(box.w) || 0,
        h: Number(box.h) || 0
      };
    }
    const size = Number(box.size) || 0;
    return {
      x: Number(box.x) || 0,
      y: Number(box.y) || 0,
      w: size,
      h: size
    };
  }

  function defaultCropBox(nw, nh, keepProportion) {
    if (keepProportion) {
      const size = Math.min(nw, nh);
      return {
        x: Math.round((nw - size) / 2),
        y: Math.round((nh - size) / 2),
        w: size,
        h: size
      };
    }
    return { x: 0, y: 0, w: nw, h: nh };
  }

  function clampCropBox(box, nw, nh, keepProportion) {
    const keep = keepProportion != null ? !!keepProportion : cropKeepProportionOn();
    const min = cropMinSize(nw, nh);
    let b = normalizeCropBox(box) || defaultCropBox(nw, nh, keep);
    let x = Math.round(b.x);
    let y = Math.round(b.y);
    let w = Math.round(b.w);
    let h = Math.round(b.h);
    if (keep) {
      let size = Math.min(Math.max(min, Math.min(w, h)), Math.min(nw, nh));
      x = Math.max(0, Math.min(nw - size, x));
      y = Math.max(0, Math.min(nh - size, y));
      return { x: x, y: y, w: size, h: size };
    }
    w = Math.min(Math.max(min, w), nw);
    h = Math.min(Math.max(min, h), nh);
    x = Math.max(0, Math.min(nw - w, x));
    y = Math.max(0, Math.min(nh - h, y));
    return { x: x, y: y, w: w, h: h };
  }

  function cropBoxToSquare(box, nw, nh) {
    const b = normalizeCropBox(box) || defaultCropBox(nw, nh, true);
    const size = Math.max(cropMinSize(nw, nh), Math.min(b.w, b.h, nw, nh));
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return clampCropBox({
      x: Math.round(cx - size / 2),
      y: Math.round(cy - size / 2),
      w: size,
      h: size
    }, nw, nh, true);
  }

  function cropImageLayout() {
    if (!els.cropStage || !els.cropSource) return null;
    const img = els.cropSource;
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (!nw || !nh) return null;
    const sw = els.cropStage.clientWidth;
    const sh = els.cropStage.clientHeight;
    const scale = Math.min(sw / nw, sh / nh);
    const dw = nw * scale;
    const dh = nh * scale;
    return {
      nw: nw,
      nh: nh,
      scale: scale,
      left: (sw - dw) / 2,
      top: (sh - dh) / 2,
      dw: dw,
      dh: dh
    };
  }

  function paintCropBox() {
    if (!cropSession || !els.cropBox) return;
    const layout = cropImageLayout();
    if (!layout) return;
    const box = normalizeCropBox(cropSession.box);
    if (!box) return;
    els.cropBox.hidden = false;
    els.cropBox.style.left = (layout.left + box.x * layout.scale) + 'px';
    els.cropBox.style.top = (layout.top + box.y * layout.scale) + 'px';
    els.cropBox.style.width = (box.w * layout.scale) + 'px';
    els.cropBox.style.height = (box.h * layout.scale) + 'px';
  }

  function stagePointToNatural(clientX, clientY) {
    const layout = cropImageLayout();
    if (!layout || !els.cropStage) return null;
    const rect = els.cropStage.getBoundingClientRect();
    const sx = clientX - rect.left - layout.left;
    const sy = clientY - rect.top - layout.top;
    return {
      x: sx / layout.scale,
      y: sy / layout.scale,
      layout: layout
    };
  }

  function cropModalCopy(kind) {
    const keep = cropKeepProportionOn();
    const shape = keep ? 'square' : 'frame';
    if (els.cropTitle) {
      els.cropTitle.textContent = kind === 'prior'
        ? 'Crop prior (A)'
        : (kind === 'export' ? 'Crop before upscale' : 'Crop product image');
    }
    if (els.cropHint) {
      els.cropHint.textContent = kind === 'export'
        ? ('Adjust the ' + shape + ' to frame the product. Confirm updates this image for export / upscale')
        : ('Adjust the ' + shape + ' to frame the product. Confirm sends this cropped image to Generate');
    }
    if (els.cropReset) {
      els.cropReset.title = keep ? 'Reset to full square' : 'Reset to full image';
    }
  }

  function onCropKeepProportionChange() {
    if (!cropSession) return;
    const layout = cropImageLayout();
    if (!layout) return;
    const keep = cropKeepProportionOn();
    if (keep) {
      cropSession.box = cropBoxToSquare(cropSession.box, layout.nw, layout.nh);
    } else {
      cropSession.box = clampCropBox(cropSession.box, layout.nw, layout.nh, false);
    }
    cropModalCopy(cropSession.kind || 'input');
    paintCropBox();
  }

  function exportImageAt(shotIndex) {
    if (!state.workspace || !state.workspace.exportImages) return null;
    return state.workspace.exportImages[String(shotIndex)] || state.workspace.exportImages[shotIndex] || null;
  }

  /**
   * target: { kind:'input', shotIndex, inputIndex }
   *       | { kind:'prior', shotIndex }
   *       | { kind:'export', shotIndex }
   */
  async function openCropModal(target) {
    if (!els.cropModal || !els.cropSource || !state.workspace) return;
    if (typeof target === 'number') {
      // Legacy: openCropModal(shotIndex, inputIndex)
      target = { kind: 'input', shotIndex: arguments[0], inputIndex: arguments[1] || 0 };
    }
    const kind = target && target.kind;
    const shotIndex = Number(target && target.shotIndex) || 0;
    const inputIndex = Number(target && target.inputIndex) || 0;
    if (!kind) return;

    let sourceAsset = null;
    let url = '';
    try {
      if (kind === 'input') {
        sourceAsset = shotAssets(shotIndex).inputs && shotAssets(shotIndex).inputs[inputIndex];
        url = ensureAssetDisplayUrl(sourceAsset);
      } else if (kind === 'prior') {
        const assets = shotAssets(shotIndex);
        if (assets.priorOverride && (assets.priorOverride.blob || assets.priorOverride.file)) {
          sourceAsset = assets.priorOverride;
          url = ensureAssetDisplayUrl(sourceAsset);
        } else {
          showToast('Loading prior for crop…', false);
          const resolved = await resolvePriorAsset(shotIndex, {});
          if (!resolved || !resolved.asset) {
            showToast('No prior image available to crop.', false, { error: true });
            return;
          }
          sourceAsset = resolved.asset;
          url = ensureAssetDisplayUrl(sourceAsset);
        }
      } else if (kind === 'export') {
        sourceAsset = exportImageAt(shotIndex);
        url = ensureExportDisplayUrl(sourceAsset);
      }
    } catch (err) {
      showToast((err && err.message) || 'Could not load image for crop.', false, { error: true });
      return;
    }
    if (!sourceAsset || !url) {
      showToast('Image is not ready to crop yet.', false, { error: true });
      return;
    }

    const prevPos = cropSession
      ? { winLeft: cropSession.winLeft, winTop: cropSession.winTop }
      : (els.cropWindow && els.cropWindow.dataset.winLeft
        ? { winLeft: Number(els.cropWindow.dataset.winLeft), winTop: Number(els.cropWindow.dataset.winTop) }
        : null);
    if (els.cropKeepProportion) els.cropKeepProportion.checked = true;
    cropSession = {
      kind: kind,
      shotIndex: shotIndex,
      inputIndex: inputIndex,
      assetId: sourceAsset.id || '',
      sourceAsset: sourceAsset,
      box: null,
      winLeft: prevPos && isFinite(prevPos.winLeft) ? prevPos.winLeft : null,
      winTop: prevPos && isFinite(prevPos.winTop) ? prevPos.winTop : null
    };
    cropDrag = null;
    cropWinDrag = null;
    cropModalCopy(kind);
    els.cropBox.hidden = true;
    els.cropModal.hidden = false;
    placeCropWindow(true);
    const onReady = () => {
      if (!cropSession) return;
      const nw = els.cropSource.naturalWidth;
      const nh = els.cropSource.naturalHeight;
      const keep = cropKeepProportionOn();
      cropSession.box = clampCropBox(defaultCropBox(nw, nh, keep), nw, nh, keep);
      paintCropBox();
    };
    els.cropSource.onload = onReady;
    els.cropSource.onerror = () => {
      showToast('Could not load image for crop.', false, { error: true });
      closeCropModal();
    };
    if (els.cropSource.src === url && els.cropSource.complete && els.cropSource.naturalWidth) {
      onReady();
    } else {
      els.cropSource.src = url;
    }
  }

  function closeCropModal() {
    if (cropSession && els.cropWindow) {
      els.cropWindow.dataset.winLeft = String(cropSession.winLeft != null ? cropSession.winLeft : '');
      els.cropWindow.dataset.winTop = String(cropSession.winTop != null ? cropSession.winTop : '');
    }
    cropDrag = null;
    cropWinDrag = null;
    cropSession = null;
    if (els.cropModal) els.cropModal.hidden = true;
    if (els.cropBox) els.cropBox.hidden = true;
    if (els.cropSource) {
      els.cropSource.onload = null;
      els.cropSource.onerror = null;
      els.cropSource.removeAttribute('src');
    }
  }

  function startCropWindowDrag(e) {
    if (!els.cropWindow || !els.cropModal || els.cropModal.hidden) return;
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('.wr-crop-stage') || e.target.closest('.tp-modal-actions')) return;
    if (!e.target.closest('#crop-head')) return;
    e.preventDefault();
    const r = els.cropWindow.getBoundingClientRect();
    cropWinDrag = {
      startX: e.clientX,
      startY: e.clientY,
      left: r.left,
      top: r.top
    };
  }

  function moveCropWindowDrag(e) {
    if (!cropWinDrag || !els.cropWindow) return;
    e.preventDefault();
    const margin = 8;
    let left = cropWinDrag.left + (e.clientX - cropWinDrag.startX);
    let top = cropWinDrag.top + (e.clientY - cropWinDrag.startY);
    left = Math.max(margin, Math.min(window.innerWidth - 80, left));
    top = Math.max(margin, Math.min(window.innerHeight - 80, top));
    els.cropWindow.style.left = left + 'px';
    els.cropWindow.style.top = top + 'px';
    if (cropSession) {
      cropSession.winLeft = left;
      cropSession.winTop = top;
    }
  }

  function endCropWindowDrag() {
    cropWinDrag = null;
  }

  function resetCropBox() {
    if (!cropSession) return;
    const layout = cropImageLayout();
    if (!layout) return;
    const keep = cropKeepProportionOn();
    cropSession.box = clampCropBox(defaultCropBox(layout.nw, layout.nh, keep), layout.nw, layout.nh, keep);
    paintCropBox();
  }

  function startCropDrag(e) {
    if (!cropSession || !els.cropModal || els.cropModal.hidden) return;
    if (e.button != null && e.button !== 0) return;
    const handle = e.target.closest('[data-handle]');
    const onBox = e.target.closest('#crop-box');
    const pt = stagePointToNatural(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    const keep = cropKeepProportionOn();
    const box = normalizeCropBox(cropSession.box) ||
      defaultCropBox(pt.layout.nw, pt.layout.nh, keep);
    if (handle) {
      cropDrag = {
        mode: 'resize',
        handle: handle.getAttribute('data-handle'),
        startX: pt.x,
        startY: pt.y,
        keep: keep,
        orig: Object.assign({}, box)
      };
    } else if (onBox) {
      cropDrag = {
        mode: 'move',
        startX: pt.x,
        startY: pt.y,
        keep: keep,
        orig: Object.assign({}, box)
      };
    } else {
      // Drag on image → create a new crop from this corner.
      const x = Math.max(0, Math.min(pt.layout.nw, pt.x));
      const y = Math.max(0, Math.min(pt.layout.nh, pt.y));
      const min = cropMinSize(pt.layout.nw, pt.layout.nh);
      cropDrag = {
        mode: 'create',
        keep: keep,
        anchorX: x,
        anchorY: y
      };
      cropSession.box = clampCropBox({ x: x, y: y, w: min, h: min }, pt.layout.nw, pt.layout.nh, keep);
      paintCropBox();
    }
  }

  function moveCropDrag(e) {
    if (!cropDrag || !cropSession) return;
    const pt = stagePointToNatural(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    const nw = pt.layout.nw;
    const nh = pt.layout.nh;
    const min = cropMinSize(nw, nh);
    const keep = cropDrag.keep != null ? !!cropDrag.keep : cropKeepProportionOn();

    if (cropDrag.mode === 'move') {
      const dx = pt.x - cropDrag.startX;
      const dy = pt.y - cropDrag.startY;
      cropSession.box = clampCropBox({
        x: cropDrag.orig.x + dx,
        y: cropDrag.orig.y + dy,
        w: cropDrag.orig.w,
        h: cropDrag.orig.h
      }, nw, nh, keep);
      paintCropBox();
      return;
    }

    if (cropDrag.mode === 'create') {
      const ax = cropDrag.anchorX;
      const ay = cropDrag.anchorY;
      const dx = pt.x - ax;
      const dy = pt.y - ay;
      if (keep) {
        let size = Math.max(min, Math.max(Math.abs(dx), Math.abs(dy)));
        let x = dx < 0 ? ax - size : ax;
        let y = dy < 0 ? ay - size : ay;
        if (x < 0) { size += x; x = 0; }
        if (y < 0) { size += y; y = 0; }
        if (x + size > nw) size = nw - x;
        if (y + size > nh) size = nh - y;
        size = Math.max(min, Math.min(size, Math.min(nw, nh)));
        cropSession.box = clampCropBox({ x: x, y: y, w: size, h: size }, nw, nh, true);
      } else {
        let x = Math.min(ax, pt.x);
        let y = Math.min(ay, pt.y);
        let w = Math.abs(dx);
        let h = Math.abs(dy);
        if (x < 0) { w += x; x = 0; }
        if (y < 0) { h += y; y = 0; }
        if (x + w > nw) w = nw - x;
        if (y + h > nh) h = nh - y;
        cropSession.box = clampCropBox({ x: x, y: y, w: w, h: h }, nw, nh, false);
      }
      paintCropBox();
      return;
    }

    if (cropDrag.mode === 'resize') {
      const o = cropDrag.orig;
      const handle = cropDrag.handle;
      const dx = pt.x - cropDrag.startX;
      const dy = pt.y - cropDrag.startY;
      let x = o.x;
      let y = o.y;
      let w = o.w;
      let h = o.h;
      if (keep) {
        let size = o.w;
        // Keep opposite corner/edge anchored; grow as a square.
        if (handle === 'se') {
          size = Math.max(min, o.w + Math.max(dx, dy));
        } else if (handle === 'nw') {
          size = Math.max(min, o.w - Math.min(dx, dy));
          x = o.x + o.w - size;
          y = o.y + o.h - size;
        } else if (handle === 'ne') {
          size = Math.max(min, o.w + Math.max(dx, -dy));
          y = o.y + o.h - size;
        } else if (handle === 'sw') {
          size = Math.max(min, o.w + Math.max(-dx, dy));
          x = o.x + o.w - size;
        } else if (handle === 'e') {
          size = Math.max(min, o.w + dx);
          y = o.y + (o.h - size) / 2;
        } else if (handle === 'w') {
          size = Math.max(min, o.w - dx);
          x = o.x + o.w - size;
          y = o.y + (o.h - size) / 2;
        } else if (handle === 's') {
          size = Math.max(min, o.h + dy);
          x = o.x + (o.w - size) / 2;
        } else if (handle === 'n') {
          size = Math.max(min, o.h - dy);
          x = o.x + (o.w - size) / 2;
          y = o.y + o.h - size;
        }
        cropSession.box = clampCropBox({ x: x, y: y, w: size, h: size }, nw, nh, true);
      } else {
        if (handle.indexOf('e') >= 0) w = o.w + dx;
        if (handle.indexOf('s') >= 0) h = o.h + dy;
        if (handle.indexOf('w') >= 0) {
          w = o.w - dx;
          x = o.x + dx;
        }
        if (handle.indexOf('n') >= 0) {
          h = o.h - dy;
          y = o.y + dy;
        }
        cropSession.box = clampCropBox({ x: x, y: y, w: w, h: h }, nw, nh, false);
      }
      paintCropBox();
    }
  }

  function endCropDrag() {
    cropDrag = null;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      if (!canvas.toBlob) {
        try {
          const data = canvas.toDataURL(type || 'image/png');
          const bin = atob(data.split(',')[1] || '');
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type || 'image/png' }));
        } catch (err) {
          reject(err);
        }
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Crop export failed'));
        else resolve(blob);
      }, type || 'image/png', quality);
    });
  }

  function buildCroppedAsset(sourceAsset, blob, width, height) {
    const base = String((sourceAsset && sourceAsset.name) || 'image').replace(/\.[^.]+$/, '');
    const cropName = base.replace(/_crop$/i, '') + '_crop.png';
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height != null ? height : width));
    return {
      id: ((sourceAsset && sourceAsset.id) || 'local') + '_crop_' + Date.now().toString(36),
      name: cropName,
      source: (sourceAsset && sourceAsset.source) || 'local',
      blob: blob,
      file: blob,
      mime: 'image/png',
      w: w,
      h: h,
      cropped: true,
      url: '',
      _blobRef: null
    };
  }

  async function confirmCropModal() {
    if (!cropSession || !cropSession.box) return;
    const kind = cropSession.kind || 'input';
    const shotIndex = cropSession.shotIndex;
    const inputIndex = cropSession.inputIndex;
    const layout = cropImageLayout();
    if (!layout) return;
    const keep = cropKeepProportionOn();
    const box = clampCropBox(cropSession.box, layout.nw, layout.nh, keep);
    const src = els.cropSource;
    const outW = Math.max(1, Math.round(box.w));
    const outH = Math.max(1, Math.round(box.h));
    const sx = Math.max(0, Math.round(box.x));
    const sy = Math.max(0, Math.round(box.y));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, outW, outH, 0, 0, outW, outH);
    try {
      const blob = await canvasToBlob(canvas, 'image/png');
      const sourceAsset = cropSession.sourceAsset;
      const cropped = buildCroppedAsset(sourceAsset, blob, outW, outH);
      ensureAssetDisplayUrl(cropped);
      const dimLabel = outW + '×' + outH;

      if (kind === 'input') {
        const assets = shotAssets(shotIndex);
        const asset = assets.inputs && assets.inputs[inputIndex];
        if (!asset) {
          closeCropModal();
          return;
        }
        revokeAssetUrl(asset);
        assets.inputs[inputIndex] = cropped;
        syncShotInputNames(shotIndex);
        closeCropModal();
        renderWorkspace();
        persistCurrentReplaceDraft();
        showToast('Cropped B · ' + dimLabel + ' · ready for Generate', false);
        return;
      }

      if (kind === 'prior') {
        const assets = shotAssets(shotIndex);
        revokeAssetUrl(assets.priorOverride);
        assets.priorOverride = cropped;
        closeCropModal();
        renderWorkspace();
        persistCurrentReplaceDraft();
        showToast('Cropped A · ' + dimLabel + ' · ready for Generate', false);
        return;
      }

      if (kind === 'export') {
        if (!state.workspace.exportImages) state.workspace.exportImages = {};
        const key = String(shotIndex);
        const prev = exportImageAt(shotIndex);
        if (prev && prev.url && String(prev.url).indexOf('blob:') === 0 && prev.url !== cropped.url) {
          try { URL.revokeObjectURL(prev.url); } catch (_) { /* ignore */ }
        }
        state.workspace.exportImages[key] = Object.assign({}, prev || {}, {
          url: cropped.url,
          _blobRef: cropped.blob,
          name: cropped.name,
          blob: cropped.blob,
          file: cropped.blob,
          w: outW,
          h: outH,
          cropped: true,
          status: (prev && prev.status) || 'ready',
          upscale: null
        });
        closeCropModal();
        renderWorkspace();
        persistCurrentReplaceDraft();
        showToast('Cropped export image · ' + dimLabel + ' · ready for upscale', false);
        return;
      }

      closeCropModal();
    } catch (err) {
      showToast((err && err.message) || 'Crop failed.', false, { error: true });
    }
  }

  /* ---------- Answerly bridge (local firefly-upscaler :5175) ---------- */

  // Chrome Local Network Access: public HTTPS → http://127.0.0.1 needs loopback permission.
  // targetAddressSpace triggers the Allow prompt and exempts mixed-content blocking.
  function bridgeFetchInit(opts) {
    const init = Object.assign({ cache: 'no-store' }, opts || {});
    init.targetAddressSpace = 'loopback';
    return init;
  }

  function bridgeFetch(path, opts) {
    return fetch(UPSCALE_URL + path, bridgeFetchInit(opts));
  }

  function friendlyBridgeError(err) {
    const msg = String((err && err.message) || err || '');
    if (/failed to fetch|networkerror|load failed|network request failed|Forbidden/i.test(msg)) {
      return 'Cannot reach the Answerly bridge at ' + UPSCALE_URL +
        '. Confirm Connect bridge / start-answerly (or full Start Firefly). If Chrome blocked local network access, Allow it for this site, then reload.';
    }
    return msg || 'Request failed';
  }

  function isStaleBridgeError(text) {
    return /Cannot reach the (local |Answerly )?bridge|Start firefly-upscaler|bridge_offline|Failed to fetch|local network access/i
      .test(String(text || ''));
  }

  function clearStaleBridgeShotErrors() {
    if (!state.workspace || !state.workspace.assets) return false;
    let cleared = false;
    Object.keys(state.workspace.assets).forEach((k) => {
      const a = state.workspace.assets[k];
      if (a && a.error && isStaleBridgeError(a.error)) {
        a.error = null;
        cleared = true;
      }
    });
    return cleared;
  }

  function decodeJwtExpClient(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64 + '==='.slice((b64.length + 3) % 4);
      const json = atob(pad);
      const payload = JSON.parse(json);
      return typeof payload.exp === 'number' ? payload.exp : null;
    } catch (e) {
      return null;
    }
  }

  function formatWorkspaceLabel(tok) {
    if (!tok) return 'Marketing Visualization';
    const name = String(tok.workspaceName || '').trim();
    if (/marketing\s*visualization/i.test(name)) return 'Marketing Visualization';
    if (name) return name;
    if (String(tok.workspaceKind || '').toLowerCase() === 'personal') return 'Personal (switch needed)';
    return 'Marketing Visualization';
  }

  function formatTokenRemaining(tok) {
    if (!tok || typeof tok.secondsLeft !== 'number') return '';
    const mins = Math.max(0, Math.round(tok.secondsLeft / 60));
    if (mins >= 120) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return '~' + h + 'h' + (m ? ' ' + m + 'm' : '');
    }
    return '~' + mins + 'm left';
  }

  function formatTokenExpiry(tok) {
    // Chip label — keep short, but always show remaining time when known.
    if (!tok || tok.bridgeOffline) return 'Bridge Answerly';
    if (!tok.hasToken) return 'Answerly Bridge · no token';
    if (tok.expired) return 'Answerly Bridge · expired';
    const left = formatTokenRemaining(tok);
    return left ? ('Answerly Bridge · ' + left) : 'Answerly Bridge';
  }

  function formatTokenExpiryDetail(tok) {
    const ws = formatWorkspaceLabel(tok);
    if (!tok || !tok.hasToken) return ws + ' · No token — click to paste';
    if (tok.expired) {
      return ws + ' · ' + (tok.expiresAt
        ? 'expired ' + new Date(tok.expiresAt).toLocaleString()
        : 'expired') + ' — click to refresh';
    }
    if (tok.expiresAt) {
      const mins = typeof tok.secondsLeft === 'number' ? Math.max(0, Math.round(tok.secondsLeft / 60)) : null;
      return ws + ' · expires ' + new Date(tok.expiresAt).toLocaleString() +
        (mins != null ? ' · ~' + mins + 'm' : '') + ' — click to refresh';
    }
    return ws + ' · token saved — click to refresh';
  }

  function tokenChipClass(tok) {
    if (!tok || !tok.hasToken) return 'is-bad';
    if (tok.expired) return 'is-bad';
    if (typeof tok.secondsLeft === 'number' && tok.secondsLeft < 30 * 60) return 'is-warn';
    return 'is-ok';
  }

  // Accepts raw JWT, or full /api/auth/session JSON (extracts accessToken).
  function extractAnswerlyAccessToken(raw) {
    let text = String(raw || '').trim();
    if (!text) return { error: 'Paste the session JSON or accessToken first.' };
    if (/^https?:\/\/answerly\.livspace\.com\/api\/auth\/session\/?$/i.test(text) ||
        /answerly\.livspace\.com\/api\/auth\/session/i.test(text) && text.indexOf('{') < 0) {
      return {
        error: 'That looks like the session URL, not the token. Open the session page while logged into Answerly, Select All → Copy the JSON, then paste it here.'
      };
    }
    if (text.charAt(0) === '{' || text.charAt(0) === '[') {
      try {
        const obj = JSON.parse(text);
        const token = obj.accessToken || obj.access_token ||
          (obj.user && (obj.user.accessToken || obj.user.access_token)) ||
          (obj.session && (obj.session.accessToken || obj.session.access_token)) ||
          (obj.data && (obj.data.accessToken || obj.data.access_token));
        if (!token) {
          return { error: 'JSON parsed, but no accessToken field was found. Copy the full /api/auth/session response.' };
        }
        text = String(token).trim();
      } catch (e) {
        return { error: 'Could not parse JSON. Paste the full session response or the accessToken string only.' };
      }
    }
    // Strip quotes if user copied "eyJ..."
    if ((text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') ||
        (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'")) {
      text = text.slice(1, -1).trim();
    }
    if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text)) {
      return { error: 'Could not find a JWT accessToken. Paste the session JSON or the accessToken value (starts with eyJ).' };
    }
    const exp = decodeJwtExpClient(text);
    if (exp && exp <= Math.floor(Date.now() / 1000)) {
      return {
        error: 'This accessToken is already expired (' + new Date(exp * 1000).toLocaleString() +
          '). Open ' + ANSWERLY_SESSION_URL + ' while logged in, copy a fresh JSON response, and paste again.',
        token: text,
        expired: true,
        exp: exp
      };
    }
    return { token: text, exp: exp };
  }

  async function answerlyFetch(path, opts) {
    let res;
    try {
      res = await bridgeFetch(path, opts);
    } catch (err) {
      throw new Error(friendlyBridgeError(err));
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.detail || json.message || res.statusText);
      return json;
    }
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    return res;
  }

  async function answerlyHealth() {
    return answerlyFetch('/answerly/health');
  }

  async function refreshAnswerlyTokenState() {
    try {
      const health = await answerlyHealth();
      const tok = health.token || { hasToken: false, expired: true };
      // Prefer live health workspace fields when token payload is sparse.
      if (health.workspaceId && !tok.workspaceId) tok.workspaceId = health.workspaceId;
      if (health.workspaceName && !tok.workspaceName) tok.workspaceName = health.workspaceName;
      if (health.workspaceKind && !tok.workspaceKind) tok.workspaceKind = health.workspaceKind;
      state.answerlyToken = tok;
      // Drop stale “bridge offline” D errors once the bridge answers again.
      if (clearStaleBridgeShotErrors() && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        renderWorkspace();
      }
      return state.answerlyToken;
    } catch (err) {
      state.answerlyToken = {
        hasToken: false,
        expired: true,
        bridgeOffline: true,
        error: friendlyBridgeError(err)
      };
      return state.answerlyToken;
    }
  }

  async function answerlyEnsureToken() {
    const health = await answerlyHealth();
    state.answerlyToken = health.token || null;
    if (health.token && health.token.hasToken && !health.token.expired) return health;
    const saved = localStorage.getItem(ANSWERLY_TOKEN_KEY) || '';
    if (!saved) {
      const err = new Error('No Answerly token. Use Refresh token in the bar (or Settings → Answerly token).');
      err.code = 'no_token';
      throw err;
    }
    const extracted = extractAnswerlyAccessToken(saved);
    if (extracted.error) {
      const err = new Error(extracted.error);
      err.code = extracted.expired ? 'token_expired' : 'no_token';
      throw err;
    }
    try {
      await answerlyFetch('/answerly/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: extracted.token,
          workspaceId: '9901bfd2-4c06-4746-8d63-aa2867248f1e'
        })
      });
    } catch (err) {
      const e = new Error(friendlyBridgeError(err));
      if (/expired/i.test(e.message)) e.code = 'token_expired';
      else if (/failed to fetch|Cannot reach the local bridge/i.test(e.message)) e.code = 'bridge_offline';
      else e.code = 'no_token';
      throw e;
    }
    const next = await answerlyHealth();
    state.answerlyToken = next.token || null;
    return next;
  }

  /** Preflight for Generate / Generate all — toast + Answerly modal when bridge/token is down. */
  async function ensureAnswerlyReadyForGenerate() {
    const tok = await refreshAnswerlyTokenState();
    if (tok && tok.bridgeOffline) {
      const msg = tok.error || ('Cannot reach the Answerly bridge at ' + UPSCALE_URL + '.');
      showToast(esc(msg), false, { error: true });
      openAnswerlyModal();
      return false;
    }
    try {
      await answerlyEnsureToken();
      return true;
    } catch (err) {
      showToast(esc((err && err.message) || 'Answerly is not ready'), false, { error: true });
      openAnswerlyModal();
      return false;
    }
  }

  /* ---------- IndexedDB + memory drafts (A/B/C/D kept across EANs and refresh) ---------- */

  function idbReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB error'));
    });
  }

  function openReplaceIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_EAN)) {
          db.createObjectStore(IDB_STORE_EAN, { keyPath: 'ean' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_FEED)) {
          db.createObjectStore(IDB_STORE_FEED, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'));
    });
  }

  async function saveFeedCache(feed) {
    if (!feed) return;
    try {
      const db = await openReplaceIdb();
      if (!db.objectStoreNames.contains(IDB_STORE_FEED)) {
        db.close();
        return;
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_FEED, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('feed cache write failed'));
        tx.objectStore(IDB_STORE_FEED).put({
          key: FEED_CACHE_KEY,
          feed: feed,
          savedAt: Date.now()
        });
      });
      db.close();
    } catch (err) {
      console.warn('Could not cache sheet feed', err);
    }
  }

  async function loadFeedCache() {
    try {
      const db = await openReplaceIdb();
      if (!db.objectStoreNames.contains(IDB_STORE_FEED)) {
        db.close();
        return null;
      }
      const row = await idbReq(db.transaction(IDB_STORE_FEED, 'readonly').objectStore(IDB_STORE_FEED).get(FEED_CACHE_KEY));
      db.close();
      if (!row || !row.feed) return null;
      if (Date.now() - (row.savedAt || 0) > FEED_CACHE_MAX_AGE_MS) return null;
      return row;
    } catch (err) {
      console.warn('Could not read cached sheet feed', err);
      return null;
    }
  }

  function replaceDraftKey(ean, shotIndex) {
    return String(ean || '') + '::' + String(shotIndex);
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function assetByteSize(asset) {
    if (!asset) return 0;
    const blob = asset.blob || asset.file;
    return (blob && blob.size) || asset.size || 0;
  }

  function warnIfOverAnswerlyLimit(fileOrAsset, label) {
    const size = fileOrAsset && fileOrAsset.size != null
      ? fileOrAsset.size
      : assetByteSize(fileOrAsset);
    if (size > ANSWERLY_MAX_BYTES) {
      showToast(
        (label || 'Image') + ' is ' + formatBytes(size) +
          ' — Answerly may reject files over ' + formatBytes(ANSWERLY_MAX_BYTES) + '.',
        false,
        { error: true }
      );
      return true;
    }
    return false;
  }

  function serializeAssetForIdb(asset) {
    if (!asset) return null;
    const blob = asset.blob || asset.file;
    if (!blob) return null;
    return {
      name: asset.name || 'image.png',
      mime: asset.mime || blob.type || 'image/png',
      w: asset.w || 0,
      h: asset.h || 0,
      model: asset.model || '',
      size: asset.size || '',
      workflow: asset.workflow || '',
      source: asset.source || '',
      id: asset.id || '',
      cropped: !!asset.cropped,
      jobId: asset.jobId || '',
      executionId: asset.executionId || '',
      priorSource: asset.priorSource || '',
      resultUrl: asset.resultUrl || '',
      inputUrl: asset.inputUrl || '',
      inputUrls: Array.isArray(asset.inputUrls) ? asset.inputUrls.slice() : [],
      blob: blob
    };
  }

  function reviveAssetFromIdb(row) {
    if (!row || !row.blob) return null;
    const url = URL.createObjectURL(row.blob);
    return {
      name: row.name || 'image.png',
      mime: row.mime || row.blob.type || 'image/png',
      w: row.w || 0,
      h: row.h || 0,
      model: row.model || '',
      size: row.size || '',
      workflow: row.workflow || '',
      source: row.source || 'draft',
      id: row.id || '',
      cropped: !!row.cropped,
      jobId: row.jobId || '',
      executionId: row.executionId || '',
      priorSource: row.priorSource || '',
      resultUrl: row.resultUrl || '',
      inputUrl: row.inputUrl || '',
      inputUrls: Array.isArray(row.inputUrls) ? row.inputUrls.slice() : [],
      blob: row.blob,
      file: row.blob,
      url: url,
      _blobRef: row.blob,
      fromDraft: true,
      approved: false
    };
  }

  function answerlyJobUrl(executionId) {
    const id = String(executionId || '').trim();
    if (!id) return '';
    return ANSWERLY_JOBS_BASE + encodeURIComponent(id);
  }

  function shotExecutionId(shotIndex) {
    // Prefer the shared EAN Answerly thread (first gen id) so all shots open the same job.
    const root = state.workspace && String(state.workspace.answerlyRootExecutionId || '').trim();
    if (root) return root;
    const assets = shotAssets(shotIndex);
    const out = assets && assets.output;
    if (out && out.executionId) return String(out.executionId).trim();
    const approved = state.workspace && state.workspace.approved && state.workspace.approved[shotIndex];
    if (approved && approved.executionId) return String(approved.executionId).trim();
    return '';
  }

  /** First Answerly execution id for this EAN workspace — reused as parent/thread for later gens. */
  function rememberAnswerlyRootExecution(executionId) {
    if (!state.workspace) return;
    const id = String(executionId || '').trim();
    if (!id) return;
    if (!state.workspace.answerlyRootExecutionId) {
      state.workspace.answerlyRootExecutionId = id;
    }
  }

  function answerlyJobTitleForShot(task, shot, shotIndex) {
    const ean = String((task && task.ean) || (state.workspace && state.workspace.ean) || '').trim();
    // First gen for this EAN: name the Answerly job with the EAN so the thread is easy to find.
    // Later gens: shoot name + short code (Answerly defaults to "Image to Image" without a title).
    const first = !(state.workspace &&
      (state.workspace.answerlyNamedOnce || state.workspace.answerlyRootExecutionId));
    if (first) return ean || 'Untitled';
    const code = String((shot && shot.code) || '').trim();
    const name = String((shot && shot.name) || '').trim();
    if (name && code && name !== code) return name + ' · ' + code;
    return name || code || ('Shot ' + (shotIndex + 1));
  }

  function answerlyQueueExtras(task, shot, shotIndex) {
    const root = state.workspace && String(state.workspace.answerlyRootExecutionId || '').trim();
    const ean = String((task && task.ean) || (state.workspace && state.workspace.ean) || '').trim();
    const title = answerlyJobTitleForShot(task, shot, shotIndex);
    if (state.workspace && !state.workspace.answerlyNamedOnce) {
      state.workspace.answerlyNamedOnce = true;
    }
    return {
      title: title,
      parent_execution_id: root || undefined,
      metadata: {
        ean: ean,
        shot_code: String((shot && shot.code) || ''),
        shot_index: shotIndex,
        workflow_mode: (state.workspace && state.workspace.mode) || '',
        thread_id: root || ean || undefined
      }
    };
  }

  function buildEanDraftRecord() {
    if (!state.workspace) return null;
    persistReplacePromptFromDom();
    const ean = String(state.workspace.ean || '');
    if (!ean) return null;
    const shots = {};
    const outputs = Object.assign({}, state.workspace.outputs || {});
    const assetsMap = state.workspace.assets || {};
    Object.keys(assetsMap).forEach((k) => {
      const a = assetsMap[k] || {};
      const out = a.output || a._previousOutput;
      shots[k] = {
        inputs: (a.inputs || []).map(serializeAssetForIdb).filter(Boolean),
        priorOverride: serializeAssetForIdb(a.priorOverride),
        // Keep last good D while a regen is in flight (_previousOutput).
        output: serializeAssetForIdb(out),
        error: a.error || null
      };
      if (out) outputs[k] = true;
    });
    return {
      ean: ean,
      matchEan: state.workspace.matchEan || '',
      workspaceShot: state.workspaceShot || 0,
      driveImgIndex: state.workspace.driveImgIndex,
      productTypeName: state.workspace.productTypeName || '',
      productTypeVariant: state.workspace.productTypeVariant || '',
      productTypeQuery: state.workspace.productTypeQuery || '',
      prompts: Object.assign({}, state.workspace.prompts || {}),
      outputs: outputs,
      approved: Object.assign({}, state.workspace.approved || {}),
      rejected: Object.assign({}, state.workspace.rejected || {}),
      dimSeparate: !!state.workspace.dimSeparate,
      mdimShowAbcd: !!state.workspace.mdimShowAbcd,
      mdimDraft: state.workspace.mdimDraft || null,
      mdimBaseKey: state.workspace.mdimBaseKey || '',
      mdimOverride: serializeAssetForIdb(state.workspace.mdimOverride),
      panelOpen: state.workspace.panelOpen !== false,
      panelMax: !!state.workspace.panelMax,
      rating: Number(state.workspace.rating) || 0,
      ratings: Object.assign({}, state.workspace.ratings || {}),
      promptBaselines: Object.assign({}, state.workspace.promptBaselines || {}),
      promptManualEdit: Object.assign({}, state.workspace.promptManualEdit || {}),
      genCounts: Object.assign({}, state.workspace.genCounts || {}),
      shots: shots,
      savedAt: Date.now()
    };
  }

  function primaryDraftIdbKey(ean) {
    return String(ean || '') + '::primary';
  }

  function serializePrimarySlotMap(map) {
    const out = {};
    Object.keys(map || {}).forEach((k) => {
      const row = serializeAssetForIdb(map[k]);
      if (row) out[k] = row;
    });
    return out;
  }

  function revivePrimarySlotMap(map) {
    const out = {};
    Object.keys(map || {}).forEach((k) => {
      const asset = reviveAssetFromIdb(map[k]);
      if (asset) out[k] = asset;
    });
    return out;
  }

  function buildPrimaryDraftRecord() {
    if (!state.workspace || state.workspace.mode !== 'primary') return null;
    persistReplacePromptFromDom();
    const ean = String(state.workspace.ean || '');
    if (!ean) return null;
    const shots = {};
    const outputs = Object.assign({}, state.workspace.outputs || {});
    const assetsMap = state.workspace.assets || {};
    Object.keys(assetsMap).forEach((k) => {
      const a = assetsMap[k] || {};
      const out = a.output || a._previousOutput;
      shots[k] = {
        inputs: (a.inputs || []).map(serializeAssetForIdb).filter(Boolean),
        output: serializeAssetForIdb(out),
        error: a.error || null
      };
      if (out) outputs[k] = true;
    });
    const p = state.workspace.primary || {};
    return {
      ean: primaryDraftIdbKey(ean),
      sourceEan: ean,
      workflow: 'primary',
      workspaceShot: state.workspaceShot || 0,
      productTypeName: state.workspace.productTypeName || '',
      productTypeVariant: state.workspace.productTypeVariant || '',
      productTypeQuery: state.workspace.productTypeQuery || '',
      prompts: Object.assign({}, state.workspace.prompts || {}),
      outputs: outputs,
      panelOpen: !!state.workspace.panelOpen,
      panelMax: !!state.workspace.panelMax,
      dimSeparate: !!state.workspace.dimSeparate,
      mdimShowAbcd: !!state.workspace.mdimShowAbcd,
      mdimDraft: state.workspace.mdimDraft || null,
      mdimBaseKey: state.workspace.mdimBaseKey || '',
      mdimOverride: serializeAssetForIdb(state.workspace.mdimOverride),
      ratings: Object.assign({}, state.workspace.ratings || {}),
      promptBaselines: Object.assign({}, state.workspace.promptBaselines || {}),
      promptManualEdit: Object.assign({}, state.workspace.promptManualEdit || {}),
      genCounts: Object.assign({}, state.workspace.genCounts || {}),
      answerlyRootExecutionId: String(state.workspace.answerlyRootExecutionId || ''),
      answerlyNamedOnce: !!(state.workspace.answerlyNamedOnce || state.workspace.answerlyRootExecutionId),
      primary: {
        a1: serializeAssetForIdb(p.a1),
        a1Cleared: !!p.a1Cleared,
        lifestyleA1: serializePrimarySlotMap(p.lifestyleA1),
        a2: serializePrimarySlotMap(p.a2),
        a3: serializePrimarySlotMap(p.a3),
        showA3: Object.assign({}, p.showA3 || {}),
        a2Manual: Object.assign({}, p.a2Manual || {}),
        a2Override: Object.assign({}, p.a2Override || {})
      },
      shots: shots,
      savedAt: Date.now()
    };
  }

  function stashReplaceDraftInMemory() {
    if (!state.workspace || state.workspace.mode !== 'replace') return;
    persistReplacePromptFromDom();
    const ean = String(state.workspace.ean || '');
    if (!ean) return;
    if (!state.replaceDraftCache) state.replaceDraftCache = {};
    // Transfer live asset object references (do not revoke) so switching EANs is instant.
    state.replaceDraftCache[ean] = {
      matchEan: state.workspace.matchEan || '',
      workspaceShot: state.workspaceShot || 0,
      driveImgIndex: state.workspace.driveImgIndex,
      productTypeName: state.workspace.productTypeName || '',
      productTypeVariant: state.workspace.productTypeVariant || '',
      productTypeQuery: state.workspace.productTypeQuery || '',
      prompts: Object.assign({}, state.workspace.prompts || {}),
      outputs: Object.assign({}, state.workspace.outputs || {}),
      approved: Object.assign({}, state.workspace.approved || {}),
      rejected: Object.assign({}, state.workspace.rejected || {}),
      dimSeparate: !!state.workspace.dimSeparate,
      mdimShowAbcd: !!state.workspace.mdimShowAbcd,
      mdimDraft: state.workspace.mdimDraft || null,
      mdimBaseKey: state.workspace.mdimBaseKey || '',
      mdimOverride: state.workspace.mdimOverride || null,
      panelOpen: state.workspace.panelOpen !== false,
      panelMax: !!state.workspace.panelMax,
      assets: state.workspace.assets || {},
      rating: Number(state.workspace.rating) || 0,
      ratings: Object.assign({}, state.workspace.ratings || {}),
      promptBaselines: Object.assign({}, state.workspace.promptBaselines || {}),
      promptManualEdit: Object.assign({}, state.workspace.promptManualEdit || {}),
      genCounts: Object.assign({}, state.workspace.genCounts || {}),
      savedAt: Date.now()
    };
    // Detach so closeWorkspace revoke does not wipe the cache.
    state.workspace.assets = {};
  }

  function stashPrimaryDraftInMemory() {
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    persistReplacePromptFromDom();
    const ean = String(state.workspace.ean || '');
    if (!ean) return;
    if (!state.primaryDraftCache) state.primaryDraftCache = {};
    state.primaryDraftCache[ean] = {
      workspaceShot: state.workspaceShot || 0,
      productTypeName: state.workspace.productTypeName || '',
      productTypeVariant: state.workspace.productTypeVariant || '',
      productTypeQuery: state.workspace.productTypeQuery || '',
      prompts: Object.assign({}, state.workspace.prompts || {}),
      outputs: Object.assign({}, state.workspace.outputs || {}),
      panelOpen: !!state.workspace.panelOpen,
      panelMax: !!state.workspace.panelMax,
      dimSeparate: !!state.workspace.dimSeparate,
      mdimShowAbcd: !!state.workspace.mdimShowAbcd,
      mdimDraft: state.workspace.mdimDraft || null,
      mdimBaseKey: state.workspace.mdimBaseKey || '',
      mdimOverride: state.workspace.mdimOverride || null,
      assets: state.workspace.assets || {},
      primary: state.workspace.primary || null,
      ratings: Object.assign({}, state.workspace.ratings || {}),
      promptBaselines: Object.assign({}, state.workspace.promptBaselines || {}),
      promptManualEdit: Object.assign({}, state.workspace.promptManualEdit || {}),
      genCounts: Object.assign({}, state.workspace.genCounts || {}),
      answerlyRootExecutionId: String(state.workspace.answerlyRootExecutionId || ''),
      answerlyNamedOnce: !!(state.workspace.answerlyNamedOnce || state.workspace.answerlyRootExecutionId),
      savedAt: Date.now()
    };
    state.workspace.assets = {};
    state.workspace.primary = null;
  }

  function applyMemoryDraftToWorkspace(ean, opts) {
    opts = opts || {};
    const draft = state.replaceDraftCache && state.replaceDraftCache[ean];
    if (!draft || !state.workspace) return false;
    const lockedMatch = opts.keepMatchEan != null && opts.keepMatchEan !== ''
      ? String(opts.keepMatchEan)
      : '';
    state.workspace.assets = draft.assets || {};
    state.workspace.prompts = Object.assign({}, draft.prompts || {});
    state.workspace.outputs = Object.assign({}, draft.outputs || {});
    state.workspace.approved = Object.assign({}, draft.approved || {});
    state.workspace.rejected = Object.assign({}, draft.rejected || {});
    // Keep Drive selection only when already set for this session; otherwise first image.
    if (state.workspace.driveImgIndex == null || state.workspace.driveImgIndex === '') {
      state.workspace.driveImgIndex = 0;
    }
    state.workspace.productTypeName = draft.productTypeName || state.workspace.productTypeName || '';
    state.workspace.productTypeVariant = draft.productTypeVariant || state.workspace.productTypeVariant || '';
    state.workspace.productTypeQuery = draft.productTypeQuery || state.workspace.productTypeName || '';
    state.workspace.dimSeparate = !!draft.dimSeparate;
    state.workspace.mdimShowAbcd = !!draft.mdimShowAbcd;
    state.workspace.mdimDraft = draft.mdimDraft || null;
    state.workspace.mdimBaseKey = draft.mdimBaseKey || '';
    state.workspace.mdimOverride = draft.mdimOverride || null;
    state.workspace.ratings = Object.assign({}, draft.ratings || {});
    state.workspace.promptBaselines = Object.assign({}, draft.promptBaselines || {});
    state.workspace.promptManualEdit = Object.assign({}, draft.promptManualEdit || {});
    state.workspace.genCounts = Object.assign({}, draft.genCounts || {});
    if (draft.panelOpen != null) state.workspace.panelOpen = !!draft.panelOpen;
    if (draft.panelMax != null) state.workspace.panelMax = !!draft.panelMax;
    state.workspace.rating = 0;
    state.workspace.exportImages = {};
    // Prefer the match chosen on Continue / Choose workflow over a stale draft prior.
    if (lockedMatch) state.workspace.matchEan = lockedMatch;
    else if (draft.matchEan) state.workspace.matchEan = draft.matchEan;
    state.workspaceShot = draft.workspaceShot || 0;
    state.workspace.draftsLoaded = true;
    state.workspace.ptPrefsApplied = true;
    const task = taskByEan(state.workspace.ean);
    if (task) scrubBorrowedMainInputs(shotListFor(task));
    healWorkspaceBlobUrls();
    return true;
  }

  function applyMemoryPrimaryDraftToWorkspace(ean) {
    const draft = state.primaryDraftCache && state.primaryDraftCache[ean];
    if (!draft || !state.workspace) return false;
    state.workspace.assets = draft.assets || {};
    state.workspace.primary = draft.primary || state.workspace.primary || null;
    state.workspace.prompts = Object.assign({}, draft.prompts || {});
    state.workspace.outputs = Object.assign({}, draft.outputs || {});
    state.workspace.productTypeName = draft.productTypeName || state.workspace.productTypeName || '';
    state.workspace.productTypeVariant = draft.productTypeVariant || state.workspace.productTypeVariant || '';
    state.workspace.productTypeQuery = draft.productTypeQuery || state.workspace.productTypeName || '';
    state.workspace.ratings = Object.assign({}, draft.ratings || {});
    state.workspace.promptBaselines = Object.assign({}, draft.promptBaselines || {});
    state.workspace.promptManualEdit = Object.assign({}, draft.promptManualEdit || {});
    state.workspace.genCounts = Object.assign({}, draft.genCounts || {});
    if (draft.answerlyRootExecutionId) {
      state.workspace.answerlyRootExecutionId = String(draft.answerlyRootExecutionId);
    }
    if (draft.answerlyNamedOnce || draft.answerlyRootExecutionId) {
      state.workspace.answerlyNamedOnce = true;
    }
    if (draft.panelOpen != null) state.workspace.panelOpen = !!draft.panelOpen;
    if (draft.panelMax != null) state.workspace.panelMax = !!draft.panelMax;
    state.workspace.dimSeparate = !!draft.dimSeparate;
    state.workspace.mdimShowAbcd = !!draft.mdimShowAbcd;
    state.workspace.mdimDraft = draft.mdimDraft || null;
    state.workspace.mdimBaseKey = draft.mdimBaseKey || '';
    state.workspace.mdimOverride = draft.mdimOverride || null;
    state.workspaceShot = draft.workspaceShot || 0;
    state.workspace.draftsLoaded = true;
    state.workspace.ptPrefsApplied = true;
    seedAnswerlyRootFromOutputs();
    healWorkspaceBlobUrls();
    return true;
  }

  async function saveEanDraftToIdb(record) {
    if (!record || !record.ean) return;
    try {
      const db = await openReplaceIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_EAN, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IDB write aborted'));
        tx.objectStore(IDB_STORE_EAN).put(record);
      });
      db.close();
    } catch (err) {
      console.warn('Could not persist EAN draft', err);
    }
  }

  async function persistCurrentReplaceDraft() {
    if (!state.workspace) return;
    if (state.workspace.mode === 'primary') {
      await persistCurrentPrimaryDraft();
      return;
    }
    if (state.workspace.mode !== 'replace') return;
    const record = buildEanDraftRecord();
    if (!record) return;
    // Refresh memory cache snapshot with current blobs still attached.
    if (!state.replaceDraftCache) state.replaceDraftCache = {};
    state.replaceDraftCache[record.ean] = {
      matchEan: record.matchEan,
      workspaceShot: record.workspaceShot,
      driveImgIndex: record.driveImgIndex,
      productTypeName: record.productTypeName,
      productTypeVariant: record.productTypeVariant,
      productTypeQuery: record.productTypeQuery,
      prompts: record.prompts,
      outputs: record.outputs,
      approved: record.approved,
      rejected: record.rejected,
      dimSeparate: record.dimSeparate,
      panelOpen: record.panelOpen,
      panelMax: record.panelMax,
      rating: record.rating,
      ratings: record.ratings,
      promptBaselines: record.promptBaselines,
      promptManualEdit: record.promptManualEdit,
      genCounts: record.genCounts || {},
      assets: state.workspace.assets || {},
      savedAt: record.savedAt
    };
    await saveEanDraftToIdb(record);
  }

  async function persistCurrentPrimaryDraft() {
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    const record = buildPrimaryDraftRecord();
    if (!record) return;
    const ean = record.sourceEan;
    if (!state.primaryDraftCache) state.primaryDraftCache = {};
    state.primaryDraftCache[ean] = {
      workspaceShot: record.workspaceShot,
      productTypeName: record.productTypeName,
      productTypeVariant: record.productTypeVariant,
      productTypeQuery: record.productTypeQuery,
      prompts: record.prompts,
      outputs: record.outputs,
      panelOpen: record.panelOpen,
      panelMax: record.panelMax,
      dimSeparate: record.dimSeparate,
      mdimShowAbcd: record.mdimShowAbcd,
      mdimDraft: record.mdimDraft || null,
      mdimBaseKey: record.mdimBaseKey || '',
      mdimOverride: state.workspace.mdimOverride || null,
      ratings: record.ratings,
      promptBaselines: record.promptBaselines,
      promptManualEdit: record.promptManualEdit,
      genCounts: record.genCounts || {},
      assets: state.workspace.assets || {},
      primary: state.workspace.primary || null,
      savedAt: record.savedAt
    };
    await saveEanDraftToIdb(record);
  }

  function applyIdbPrimaryDraftToWorkspace(row) {
    if (!row || !state.workspace) return false;
    if (!state.workspace.assets) state.workspace.assets = {};
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.outputs) state.workspace.outputs = {};
    if (row.prompts) state.workspace.prompts = Object.assign({}, row.prompts);
    if (row.outputs) state.workspace.outputs = Object.assign({}, row.outputs);
    if (row.productTypeName) {
      state.workspace.productTypeName = row.productTypeName;
      state.workspace.productTypeQuery = row.productTypeQuery || row.productTypeName;
      state.workspace.productTypeVariant = row.productTypeVariant || '';
      state.workspace.ptPrefsApplied = true;
    }
    if (row.workspaceShot != null) state.workspaceShot = row.workspaceShot || 0;
    if (row.panelOpen != null) state.workspace.panelOpen = !!row.panelOpen;
    if (row.panelMax != null) state.workspace.panelMax = !!row.panelMax;
    state.workspace.dimSeparate = !!row.dimSeparate;
    state.workspace.mdimShowAbcd = !!row.mdimShowAbcd;
    state.workspace.mdimDraft = row.mdimDraft || null;
    state.workspace.mdimBaseKey = row.mdimBaseKey || '';
    state.workspace.mdimOverride = reviveAssetFromIdb(row.mdimOverride);
    state.workspace.ratings = Object.assign({}, row.ratings || {});
    state.workspace.promptBaselines = Object.assign({}, row.promptBaselines || {});
    state.workspace.promptManualEdit = Object.assign({}, row.promptManualEdit || {});
    state.workspace.genCounts = Object.assign({}, row.genCounts || {});
    if (row.answerlyRootExecutionId) {
      state.workspace.answerlyRootExecutionId = String(row.answerlyRootExecutionId);
    }
    if (row.answerlyNamedOnce || row.answerlyRootExecutionId) {
      state.workspace.answerlyNamedOnce = true;
    }
    ensurePrimaryState();
    const p = state.workspace.primary;
    const saved = row.primary || {};
    if (saved.a1) p.a1 = reviveAssetFromIdb(saved.a1);
    p.a1Cleared = !!saved.a1Cleared;
    p.lifestyleA1 = revivePrimarySlotMap(saved.lifestyleA1);
    p.a2 = revivePrimarySlotMap(saved.a2);
    p.a3 = revivePrimarySlotMap(saved.a3);
    p.showA3 = Object.assign({}, saved.showA3 || {});
    p.a2Manual = Object.assign({}, saved.a2Manual || {});
    p.a2Override = Object.assign({}, saved.a2Override || {});
    Object.keys(row.shots || {}).forEach((k) => {
      const s = row.shots[k] || {};
      const assets = shotAssets(k);
      assets.inputs = (s.inputs || []).map(reviveAssetFromIdb).filter(Boolean);
      assets.output = reviveAssetFromIdb(s.output);
      assets.error = (s.error && !isStaleBridgeError(s.error)) ? s.error : null;
      if (assets.output) state.workspace.outputs[k] = true;
      syncShotInputNames(k);
    });
    seedAnswerlyRootFromOutputs();
    state.workspace.draftsLoaded = true;
    healWorkspaceBlobUrls();
    return true;
  }

  /** Recover shared Answerly thread id from any shot that already has an executionId. */
  function seedAnswerlyRootFromOutputs() {
    if (!state.workspace) return;
    if (state.workspace.answerlyRootExecutionId) return;
    const assetsMap = state.workspace.assets || {};
    const keys = Object.keys(assetsMap);
    for (let i = 0; i < keys.length; i++) {
      const out = assetsMap[keys[i]] && assetsMap[keys[i]].output;
      const id = out && String(out.executionId || '').trim();
      if (id) {
        state.workspace.answerlyRootExecutionId = id;
        return;
      }
    }
  }

  async function restorePrimaryDraftsIntoWorkspace() {
    if (!state.workspace || state.workspace.mode !== 'primary' || state.workspace.draftsLoaded) return;
    const ean = String(state.workspace.ean || '');
    if (!ean) return;
    if (applyMemoryPrimaryDraftToWorkspace(ean)) {
      state.workspace.draftsLoaded = true;
      renderWorkspace();
      return;
    }
    const row = await loadEanDraftFromIdb(primaryDraftIdbKey(ean));
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    if (row && (row.workflow === 'primary' || String(row.ean || '').indexOf('::primary') >= 0)) {
      applyIdbPrimaryDraftToWorkspace(row);
      if (!state.primaryDraftCache) state.primaryDraftCache = {};
      state.primaryDraftCache[ean] = {
        workspaceShot: state.workspaceShot || 0,
        productTypeName: state.workspace.productTypeName || '',
        productTypeVariant: state.workspace.productTypeVariant || '',
        productTypeQuery: state.workspace.productTypeQuery || '',
        prompts: Object.assign({}, state.workspace.prompts || {}),
        outputs: Object.assign({}, state.workspace.outputs || {}),
        panelOpen: !!state.workspace.panelOpen,
        panelMax: !!state.workspace.panelMax,
        ratings: Object.assign({}, state.workspace.ratings || {}),
        promptBaselines: Object.assign({}, state.workspace.promptBaselines || {}),
        promptManualEdit: Object.assign({}, state.workspace.promptManualEdit || {}),
        genCounts: Object.assign({}, state.workspace.genCounts || {}),
        assets: state.workspace.assets || {},
        primary: state.workspace.primary || null,
        savedAt: Date.now()
      };
    }
    state.workspace.draftsLoaded = true;
    renderWorkspace();
  }

  async function saveReplaceOutputDraft(ean, shotIndex, output) {
    if (!ean || !output || !output.blob) return;
    try {
      const db = await openReplaceIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction([IDB_STORE, IDB_STORE_EAN], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IDB write aborted'));
        tx.objectStore(IDB_STORE).put({
          key: replaceDraftKey(ean, shotIndex),
          ean: String(ean),
          shotIndex: Number(shotIndex) || 0,
          name: output.name || '',
          model: output.model || '',
          size: output.size || '',
          workflow: output.workflow || '',
          mime: (output.blob && output.blob.type) || 'image/png',
          blob: output.blob,
          savedAt: Date.now()
        });
      });
      db.close();
    } catch (err) {
      console.warn('Could not persist output draft', err);
    }
    // Also refresh the full EAN draft so B/C/D stay in sync across tasks.
    persistCurrentReplaceDraft();
  }

  async function loadEanDraftFromIdb(ean) {
    if (!ean) return null;
    try {
      const db = await openReplaceIdb();
      let row = null;
      if (db.objectStoreNames.contains(IDB_STORE_EAN)) {
        row = await idbReq(db.transaction(IDB_STORE_EAN, 'readonly').objectStore(IDB_STORE_EAN).get(String(ean)));
      }
      // Migrate legacy per-shot outputs if no ean draft yet.
      if ((!row || !row.shots) && db.objectStoreNames.contains(IDB_STORE)) {
        const all = await idbReq(db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll());
        const shots = {};
        const outputs = {};
        (all || []).forEach((r) => {
          if (!r || String(r.ean) !== String(ean) || !r.blob) return;
          shots[r.shotIndex] = {
            inputs: [],
            priorOverride: null,
            output: {
              name: r.name || '',
              mime: r.mime || 'image/png',
              model: r.model || '',
              size: r.size || '',
              workflow: r.workflow || '',
              blob: r.blob
            },
            error: null
          };
          outputs[r.shotIndex] = true;
        });
        if (Object.keys(shots).length) {
          row = {
            ean: String(ean),
            prompts: {},
            outputs: outputs,
            shots: shots,
            savedAt: Date.now()
          };
        }
      }
      db.close();
      return row || null;
    } catch (err) {
      console.warn('Could not load EAN draft', err);
      return null;
    }
  }

  function applyIdbDraftToWorkspace(row, opts) {
    opts = opts || {};
    if (!row || !state.workspace) return false;
    const lockedMatch = opts.keepMatchEan != null && opts.keepMatchEan !== ''
      ? String(opts.keepMatchEan)
      : '';
    if (!state.workspace.assets) state.workspace.assets = {};
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.outputs) state.workspace.outputs = {};
    if (row.prompts) state.workspace.prompts = Object.assign({}, row.prompts);
    if (row.outputs) state.workspace.outputs = Object.assign({}, row.outputs);
    state.workspace.approved = Object.assign({}, row.approved || {});
    state.workspace.rejected = Object.assign({}, row.rejected || {});
    if (state.workspace.driveImgIndex == null || state.workspace.driveImgIndex === '') {
      state.workspace.driveImgIndex = 0;
    }
    if (row.productTypeName) {
      state.workspace.productTypeName = row.productTypeName;
      state.workspace.productTypeQuery = row.productTypeQuery || row.productTypeName;
      state.workspace.productTypeVariant = row.productTypeVariant || '';
      state.workspace.ptPrefsApplied = true;
    }
    if (lockedMatch) state.workspace.matchEan = lockedMatch;
    else if (row.matchEan) state.workspace.matchEan = row.matchEan;
    if (row.workspaceShot != null) state.workspaceShot = row.workspaceShot || 0;
    state.workspace.dimSeparate = !!row.dimSeparate;
    state.workspace.mdimShowAbcd = !!row.mdimShowAbcd;
    state.workspace.mdimDraft = row.mdimDraft || null;
    state.workspace.mdimBaseKey = row.mdimBaseKey || '';
    state.workspace.mdimOverride = reviveAssetFromIdb(row.mdimOverride);
    state.workspace.ratings = Object.assign({}, row.ratings || {});
    state.workspace.promptBaselines = Object.assign({}, row.promptBaselines || {});
    state.workspace.promptManualEdit = Object.assign({}, row.promptManualEdit || {});
    state.workspace.genCounts = Object.assign({}, row.genCounts || {});
    if (row.panelOpen != null) state.workspace.panelOpen = !!row.panelOpen;
    if (row.panelMax != null) state.workspace.panelMax = !!row.panelMax;
    state.workspace.rating = 0; // unused shared field — ratings are per-shot only
    Object.keys(row.shots || {}).forEach((k) => {
      const s = row.shots[k] || {};
      const assets = shotAssets(k);
      assets.inputs = (s.inputs || []).map(reviveAssetFromIdb).filter(Boolean);
      assets.priorOverride = reviveAssetFromIdb(s.priorOverride);
      assets.output = reviveAssetFromIdb(s.output);
      // Never revive old bridge-offline noise into D after the bridge is back.
      assets.error = (s.error && !isStaleBridgeError(s.error)) ? s.error : null;
      if (assets.output) state.workspace.outputs[k] = true;
      syncShotInputNames(k);
    });
    const task = taskByEan(state.workspace.ean);
    if (task) scrubBorrowedMainInputs(shotListFor(task));
    state.workspace.exportImages = {};
    state.workspace.draftsLoaded = true;
    healWorkspaceBlobUrls();
    return true;
  }

  // Choose workflow: pull approved/rejected/outputs from memory or IDB so the banner can show.
  async function hydrateChooseApprovalState() {
    if (!state.workspace || state.workspace.mode !== 'choose') return;
    const ean = String(state.workspace.ean || '');
    if (!ean) return;
    const mem = state.replaceDraftCache && state.replaceDraftCache[ean];
    if (mem) {
      state.workspace.outputs = Object.assign({}, mem.outputs || {});
      state.workspace.approved = Object.assign({}, mem.approved || {});
      state.workspace.rejected = Object.assign({}, mem.rejected || {});
      state.workspace.productTypeName = mem.productTypeName || state.workspace.productTypeName || '';
      state.workspace.productTypeVariant = mem.productTypeVariant || '';
      renderWorkspace();
      return;
    }
    const row = await loadEanDraftFromIdb(ean);
    if (!row || !state.workspace || state.workspace.mode !== 'choose') return;
    state.workspace.outputs = Object.assign({}, row.outputs || {});
    state.workspace.approved = Object.assign({}, row.approved || {});
    state.workspace.rejected = Object.assign({}, row.rejected || {});
    if (row.productTypeName) state.workspace.productTypeName = row.productTypeName;
    if (row.productTypeVariant) state.workspace.productTypeVariant = row.productTypeVariant;
    renderWorkspace();
  }

  async function restoreReplaceDraftsIntoWorkspace(opts) {
    opts = opts || {};
    if (!state.workspace || state.workspace.mode !== 'replace' || state.workspace.draftsLoaded) return;
    const ean = String(state.workspace.ean || '');
    const keepMatchEan = opts.keepMatchEan != null && opts.keepMatchEan !== ''
      ? String(opts.keepMatchEan)
      : String(state.workspace.matchEan || '');
    if (applyMemoryDraftToWorkspace(ean, { keepMatchEan: keepMatchEan })) {
      if (keepMatchEan && state.replaceDraftCache && state.replaceDraftCache[ean]) {
        state.replaceDraftCache[ean].matchEan = keepMatchEan;
      }
      if (state.workspace.mode === 'replace') renderWorkspace();
      return;
    }
    // Do not mark draftsLoaded until IDB apply finishes — parallel restores were skipping B restore.
    const row = await loadEanDraftFromIdb(ean);
    if (!state.workspace || state.workspace.mode !== 'replace' || String(state.workspace.ean) !== ean) return;
    if (row) {
      applyIdbDraftToWorkspace(row, { keepMatchEan: keepMatchEan });
      if (!state.replaceDraftCache) state.replaceDraftCache = {};
      state.replaceDraftCache[ean] = {
        matchEan: state.workspace.matchEan || keepMatchEan || '',
        workspaceShot: state.workspaceShot || 0,
        driveImgIndex: state.workspace.driveImgIndex,
        productTypeName: state.workspace.productTypeName || '',
        productTypeVariant: state.workspace.productTypeVariant || '',
        productTypeQuery: state.workspace.productTypeQuery || '',
        prompts: Object.assign({}, state.workspace.prompts || {}),
        outputs: Object.assign({}, state.workspace.outputs || {}),
        approved: Object.assign({}, state.workspace.approved || {}),
        rejected: Object.assign({}, state.workspace.rejected || {}),
        dimSeparate: !!state.workspace.dimSeparate,
        rating: 0,
        ratings: Object.assign({}, state.workspace.ratings || {}),
        promptBaselines: Object.assign({}, state.workspace.promptBaselines || {}),
        assets: state.workspace.assets || {},
        savedAt: row.savedAt || Date.now()
      };
    } else if (keepMatchEan) {
      state.workspace.matchEan = keepMatchEan;
    }
    state.workspace.draftsLoaded = true;
    if (state.workspace.mode === 'replace') renderWorkspace();
  }

  async function loadAnswerlyModels() {
    try {
      // Bridge merges image_to_image + image_edit + image_generate when tool=all.
      const data = await answerlyFetch('/answerly/models?tool=all');
      const models = (data && data.models) || [];
      if (models.length) {
        state.answerlyModels = models.slice().sort((a, b) =>
          String(a.label || a.id).localeCompare(String(b.label || b.id))
        );
        if (data.default_model_id && !localStorage.getItem(ANSWERLY_MODEL_KEY)) {
          localStorage.setItem(ANSWERLY_MODEL_KEY, data.default_model_id);
        }
      }
    } catch (err) {
      console.warn('Could not load Answerly models', err);
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(new Error('Could not read image bytes'));
      reader.readAsDataURL(blob);
    });
  }

  function selectedDrivePriorMeta(forceIdx) {
    if (!state.workspace) return null;
    const task = taskByEan(state.workspace.ean);
    const prior = resolveWorkspaceMatch(task).selected;
    const imgs = priorDriveImages(prior);
    if (!imgs.length) return null;
    const raw = forceIdx != null ? forceIdx : state.workspace.driveImgIndex;
    const idx = Math.min(Math.max(0, Number(raw) || 0), imgs.length - 1);
    const img = imgs[idx];
    if (!img || !img.id) return null;
    return { prior: prior, img: img, index: idx };
  }

  function markShotBusy(shotIndex, stage) {
    if (!state.workspace) return;
    if (!state.workspace.busyShots) state.workspace.busyShots = {};
    state.workspace.busyShots[shotIndex] = stage || 'In progress';
    syncGenFocus(shotIndex);
  }

  function clearShotBusy(shotIndex) {
    if (!state.workspace || !state.workspace.busyShots) return;
    delete state.workspace.busyShots[shotIndex];
    syncGenFocus();
  }

  /** Busy = per-shot only. Multiple shots may generate in parallel. */
  function isShotBusy(shotIndex) {
    if (!state.workspace) return false;
    return !!(state.workspace.busyShots && state.workspace.busyShots[shotIndex]);
  }

  function busyShotIndexes() {
    if (!state.workspace || !state.workspace.busyShots) return [];
    return Object.keys(state.workspace.busyShots).map(Number).filter((n) => !isNaN(n));
  }

  function anyShotBusy() {
    return busyShotIndexes().length > 0;
  }

  /** Keep legacy generating/genStage in sync without blocking other shots. */
  function syncGenFocus(preferShot) {
    if (!state.workspace) return;
    const busy = busyShotIndexes();
    if (!busy.length) {
      state.workspace.generating = null;
      if (!state.workspace.genAllBatch) state.workspace.genStage = '';
      return;
    }
    const prefer = preferShot != null ? Number(preferShot) : NaN;
    const focus = (!isNaN(prefer) && busy.indexOf(prefer) >= 0)
      ? prefer
      : (busy.indexOf(state.workspaceShot || 0) >= 0
        ? (state.workspaceShot || 0)
        : busy[0]);
    state.workspace.generating = focus;
    if (state.workspace.genAllBatch) return;
    const stage = (state.workspace.busyShots && state.workspace.busyShots[focus]) || 'In progress';
    state.workspace.genStage = busy.length > 1
      ? (busy.length + ' in parallel · shot ' + (focus + 1) + ' · ' + stage)
      : stage;
  }

  function driveFileCache() {
    if (!state.driveFiles) state.driveFiles = {};
    return state.driveFiles;
  }

  function base64ToBlob(base64, mime) {
    const bin = atob(String(base64 || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  }

  async function fetchDriveFileAsset(fileId) {
    const id = String(fileId || '');
    const cache = driveFileCache();
    if (cache[id] && cache[id].blob) return cache[id];
    if (!FEED_URL) throw new Error('Sheet reader is not connected (FEED_URL).');
    const data = await jsonp('action=file&id=' + encodeURIComponent(id), 120000);
    if (!data || !data.base64) throw new Error('Drive file response had no image bytes.');
    const mime = data.mimeType || 'image/jpeg';
    const blob = base64ToBlob(data.base64, mime);
    const url = URL.createObjectURL(blob);
    const asset = {
      id: data.id || id,
      name: data.name || 'prior.png',
      source: 'drive',
      blob: blob,
      file: blob,
      url: url,
      _blobRef: blob,
      mime: mime,
      size: data.size || blob.size,
      w: 0,
      h: 0,
      downscaled: !!data.downscaled,
      originalSize: data.originalSize || 0,
      previewWidth: data.previewWidth || 0
    };
    cache[id] = asset;
    if (asset.downscaled) {
      const from = asset.originalSize ? formatBytes(asset.originalSize) : 'over 12 MB';
      showToast(
        'Prior was ' + from + ' on Drive — using a high-res preview for A (same base64 workflow).',
        false
      );
    }
    warnIfOverAnswerlyLimit(asset, asset.name || 'Drive prior');
    return asset;
  }

  async function resolvePriorAsset(shotIndex, opts) {
    opts = opts || {};
    const assets = shotAssets(shotIndex);
    if (assets.priorOverride && (assets.priorOverride.blob || assets.priorOverride.file)) {
      return { asset: assets.priorOverride, source: 'override' };
    }

    // MAIN is generated from Hero Front (or seq 01): prefer that angle source as INPUT IMAGE 1.
    const task = state.workspace ? taskByEan(state.workspace.ean) : null;
    const shots = shotListFor(task || {});
    const shot = shots[shotIndex];
    if (shot && isMainShot(shot)) {
      const angle = mainAngleSourceShot(shots);
      if (angle) {
        const angleIdx = shots.findIndex((s) => s === angle ||
          (String(s.code || '').toUpperCase() === String(angle.code || '').toUpperCase() &&
            String(s.name || '') === String(angle.name || '')));
        if (angleIdx >= 0) {
          const angleOut = shotAssets(angleIdx).output;
          if (angleOut && (angleOut.blob || angleOut.file)) {
            return { asset: angleOut, source: 'main-from-hero-output', angleShot: angle };
          }
        }
        // Generate all / auto-MAIN must use Hero Front D as A — never the Drive prior plate.
        if (opts.requireMainFromHeroOutput) {
          return null;
        }
        const prior = resolveWorkspaceMatch(task || {}).selected;
        const imgs = priorDriveImages(prior);
        const want = String(angle.code || '').toUpperCase();
        let imgIdx = imgs.findIndex((img) => String(driveImgLabel(img.name) || '').toUpperCase() === want);
        if (imgIdx < 0 && want) {
          imgIdx = imgs.findIndex((img) => {
            const label = String(driveImgLabel(img.name) || '').toUpperCase();
            return label === want || label.indexOf(want) >= 0 || want.indexOf(label) >= 0;
          });
        }
        if (imgIdx < 0) {
          // Seq 01 fallback by filename _01_
          const seq = String(angle.seq != null ? angle.seq : '').padStart(2, '0');
          if (seq) {
            imgIdx = imgs.findIndex((img) => new RegExp('_' + seq + '_', 'i').test(String(img.name || '')));
          }
        }
        if (imgIdx >= 0 && imgs[imgIdx] && imgs[imgIdx].id) {
          const asset = await fetchDriveFileAsset(imgs[imgIdx].id);
          return {
            asset: asset,
            source: 'main-from-hero-drive',
            angleShot: angle,
            meta: { prior: prior, img: imgs[imgIdx], index: imgIdx }
          };
        }
      }
    }

    const meta = selectedDrivePriorMeta(opts.driveImgIndex);
    if (!meta) return null;
    const asset = await fetchDriveFileAsset(meta.img.id);
    return { asset: asset, source: 'drive', meta: meta };
  }

  // Product refs for Answerly: MAIN may borrow Hero Front / 01 B at generate time only
  // (never copy into MAIN's visible B / wr-shot-inputs).
  function productInputsForShot(shotIndex, shots) {
    const assets = shotAssets(shotIndex);
    const own = (assets.inputs || []).filter((a) => a && (a.blob || a.file));
    if (own.length) return { inputs: own, borrowed: false };
    const shot = shots && shots[shotIndex];
    if (!shot || !isMainShot(shot)) return { inputs: [], borrowed: false };
    const angleIdx = angleSourceShotIndex(shots || []);
    if (angleIdx < 0) return { inputs: [], borrowed: false };
    const fromAngle = (shotAssets(angleIdx).inputs || []).filter((a) => a && (a.blob || a.file));
    return { inputs: fromAngle.slice(), borrowed: fromAngle.length > 0 };
  }

  // Product Replacement always uses Image to Image: prior (master) + product input(s).
  function pickAnswerlyReplacePayload(shotIndex, priorAsset, opts) {
    opts = opts || {};
    const assets = shotAssets(shotIndex);
    const prior = priorAsset && (priorAsset.blob || priorAsset.file) ? priorAsset : null;
    const task = state.workspace ? taskByEan(state.workspace.ean) : null;
    const shots = opts.shots || shotListFor(task || {});
    const resolved = productInputsForShot(shotIndex, shots);
    const inputs = resolved.inputs;
    if (!prior) {
      return {
        ok: false,
        code: 'no_prior',
        error: 'Could not load prior full-res from Drive for this shot.'
      };
    }
    if (!inputs.length) {
      return {
        ok: false,
        code: 'no_product',
        error: isMainShot(shots[shotIndex])
          ? 'Add a product image on B for Hero Front / 01 (or MAIN) first.'
          : 'Drop at least one new product image onto B.'
      };
    }
    return {
      ok: true,
      workflow: 'image-to-image-workflow',
      prior: prior,
      inputs: inputs,
      borrowedProductFromAngle: !!resolved.borrowed,
      reason: (resolved.borrowed
        ? 'MAIN A from Hero Front D + product B borrowed from Hero Front / 01 (not shown on MAIN)'
        : 'Prior + ' + inputs.length + ' product input' + (inputs.length > 1 ? 's' : '')) +
        ' → Image to Image'
    };
  }

  /** Primary: ordered refs from primaryInputPlan (A1→A2→A3→B), blobs required. */
  function pickAnswerlyPrimaryPayload(shotIndex) {
    const task = state.workspace ? taskByEan(state.workspace.ean) : null;
    const shots = shotListFor(task || {});
    const shot = shots[shotIndex];
    const plan = primaryInputPlan(shotIndex, { shots: shots });
    // MAIN requires Hero Front / seq 01 generated D (same gate as Replacement).
    if (isMainShot(shot)) {
      const angleIdx = angleSourceShotIndex(shots);
      if (angleIdx < 0) {
        return {
          ok: false,
          code: 'main_needs_hero',
          error: 'MAIN needs a Hero Front / seq 01 shot in this Product Type.'
        };
      }
      if (!shotHasGeneratedOutput(angleIdx)) {
        const angle = shots[angleIdx] || {};
        return {
          ok: false,
          code: 'main_needs_hero_output',
          error: 'Generate ' + (angle.name || angle.code || 'Hero Front / 01') +
            ' first — MAIN uses that D as the camera / composition reference.'
        };
      }
      if (!(plan.a2 && (plan.a2.blob || plan.a2.file))) {
        return {
          ok: false,
          code: 'main_needs_hero_output',
          error: 'MAIN needs Hero Front / 01 generated D as A2 — wait for that shot first.'
        };
      }
    }
    if (plan.isLifestyle && !plan.hasA2) {
      return {
        ok: false,
        code: 'no_lifestyle_ref',
        error: 'A2 PDP Lifestyle reference is required (A1 is optional for lifestyle).'
      };
    }
    if (!plan.hasA1 && !plan.hasA2) {
      return {
        ok: false,
        code: 'no_ref',
        error: isMainShot(shot)
          ? 'Generate Hero Front / 01 first (MAIN uses that D as A2), or add A1 template.'
          : 'A1 template image or A2 PDP camera reference is required.'
      };
    }
    function hasBytes(a) {
      return !!(a && (a.blob || a.file));
    }
    if (plan.hasA1 && plan.a1 && !hasBytes(plan.a1)) {
      return {
        ok: false,
        code: 'a1_loading',
        error: 'A1 template is still loading — wait a moment and try again.'
      };
    }
    if (plan.hasA2 && plan.a2 && !hasBytes(plan.a2)) {
      return {
        ok: false,
        code: 'a2_loading',
        error: plan.mainFromHero
          ? 'Hero Front / 01 D is not ready as a file yet — wait a moment and try again.'
          : (plan.isLifestyle
            ? 'A2 PDP Lifestyle reference is still loading — wait a moment and try again.'
            : 'A2 PDP camera image is still loading — wait a moment and try again.')
      };
    }
    if (plan.hasA3 && plan.a3 && !hasBytes(plan.a3)) {
      return {
        ok: false,
        code: 'a3_loading',
        error: 'A3 custom ref is still loading — wait a moment and try again.'
      };
    }
    const ordered = [];
    (plan.slots || []).forEach((s) => {
      if (!s || !hasBytes(s.asset)) return;
      ordered.push({
        role: s.role,
        asset: s.asset,
        refKey: s.refKey,
        inputImage: s.inputImage
      });
    });
    const products = ordered.filter((x) => x.role === 'b');
    const refs = ordered.filter((x) => x.role !== 'b');
    if (!products.length) {
      return {
        ok: false,
        code: 'no_product',
        error: isMainShot(shot)
          ? 'Add a product image on B for Hero Front / 01 (or MAIN) first.'
          : 'Drop at least one product image onto B.'
      };
    }
    if (!refs.length) {
      return {
        ok: false,
        code: 'no_ref_bytes',
        error: plan.isLifestyle
          ? 'A2 PDP Lifestyle reference must be a loaded image file before generating.'
          : 'A1 or A2 must be a loaded image file before generating.'
      };
    }
    return {
      ok: true,
      workflow: 'image-to-image-workflow',
      plan: plan,
      refs: refs,
      products: products,
      ordered: ordered,
      reason: 'Primary · ' +
        (plan.isLifestyle
          ? 'Lifestyle replace (A2 scene + B)'
          : (plan.mainFromHero ? 'MAIN from Hero Front D' : (refs.map((r) => r.role.toUpperCase()).join('+')))) +
        (plan.borrowedProductFromAngle ? ' + B borrowed from Hero Front' : (' + B×' + products.length)) +
        ' → Image to Image'
    };
  }

  // Clear MAIN B that was previously copied from Hero Front so the rail does not show 3/4.
  function scrubBorrowedMainInputs(shots) {
    if (!state.workspace) return;
    const mainIdx = mainShotIndex(shots);
    const angleIdx = angleSourceShotIndex(shots);
    if (mainIdx < 0 || angleIdx < 0) return;
    const mainA = shotAssets(mainIdx);
    const angleA = shotAssets(angleIdx);
    const mIn = mainA.inputs || [];
    const aIn = angleA.inputs || [];
    if (!mIn.length || !aIn.length) return;
    function inputFingerprint(inp) {
      if (!inp) return '';
      const name = String(inp.name || '').toLowerCase();
      const size = (inp.blob && inp.blob.size) || (inp.file && inp.file.size) || inp.size || 0;
      return name + '::' + size;
    }
    const same = mIn.length === aIn.length && mIn.every((inp, i) => {
      const other = aIn[i];
      if (!inp || !other) return false;
      if (inp === other) return true;
      if (inp.id && other.id && inp.id === other.id) return true;
      if (inp.url && other.url && inp.url === other.url) return true;
      if (inp.blob && other.blob && inp.blob === other.blob) return true;
      if (inp.file && other.file && inp.file === other.file) return true;
      const fa = inputFingerprint(inp);
      const fb = inputFingerprint(other);
      return !!(fa && fa === fb && fa !== '::0');
    });
    if (!same) return;
    // Drop cloned copies; Answerly still borrows H-FR B at submit via productInputsForShot.
    mIn.forEach((inp) => revokeAssetUrl(inp));
    mainA.inputs = [];
    syncShotInputNames(mainIdx);
  }

  function prefetchSelectedDrivePrior() {
    const meta = selectedDrivePriorMeta();
    if (!meta || !state.workspace) return;
    const id = meta.img.id;
    if (driveFileCache()[id] && driveFileCache()[id].blob) {
      state.workspace.priorFetch = { id: id, status: 'ok' };
      return;
    }
    if (state.workspace.priorFetch && state.workspace.priorFetch.id === id &&
        (state.workspace.priorFetch.status === 'loading' || state.workspace.priorFetch.status === 'ok')) {
      return;
    }
    state.workspace.priorFetch = { id: id, status: 'loading' };
    fetchDriveFileAsset(id).then(() => {
      if (!state.workspace) return;
      if (state.workspace.priorFetch && state.workspace.priorFetch.id === id) {
        state.workspace.priorFetch = { id: id, status: 'ok' };
        if (state.workspace.mode === 'replace') renderWorkspace();
      }
    }).catch((err) => {
      if (!state.workspace) return;
      if (state.workspace.priorFetch && state.workspace.priorFetch.id === id) {
        state.workspace.priorFetch = {
          id: id,
          status: 'error',
          error: (err && err.message) || 'Failed to load Drive file'
        };
        if (state.workspace.mode === 'replace') renderWorkspace();
      }
    });
  }

  function assetToImagePayload(asset) {
    const file = asset.blob || asset.file;
    return blobToBase64(file).then((base64) => ({
      base64: base64,
      name: asset.name || 'image.png',
      mime: (file && file.type) || 'image/png'
    }));
  }

  function shotGenerationCount(shotIndex) {
    if (!state.workspace || !state.workspace.genCounts) return 0;
    return Number(state.workspace.genCounts[String(shotIndex)]) || 0;
  }

  function bumpShotGenerationCount(shotIndex) {
    if (!state.workspace) return 0;
    if (!state.workspace.genCounts) state.workspace.genCounts = {};
    const key = String(shotIndex);
    state.workspace.genCounts[key] = (Number(state.workspace.genCounts[key]) || 0) + 1;
    return state.workspace.genCounts[key];
  }

  function clearShotGenerationCount(shotIndex) {
    if (!state.workspace || !state.workspace.genCounts) return;
    delete state.workspace.genCounts[String(shotIndex)];
  }

  function makeCancelledError(message) {
    const err = new Error(message || 'Cancelled');
    err.code = 'cancelled';
    return err;
  }

  function isCancelError(err) {
    return !!(err && (err.code === 'cancelled' || /cancelled|canceled/i.test(String(err.message || ''))));
  }

  function isShotCancelRequested(shotIndex) {
    if (!state.workspace) return true;
    if (state.workspace.cancelAll) return true;
    if (state.workspace.genAllBatch && state.workspace.genAllBatch.cancelRequested) return true;
    if (state.workspace.cancelShots && state.workspace.cancelShots[shotIndex]) return true;
    return false;
  }

  function clearCancelFlags() {
    if (!state.workspace) return;
    delete state.workspace.cancelAll;
    delete state.workspace.cancelShots;
    if (state.workspace.genAllBatch) delete state.workspace.genAllBatch.cancelRequested;
  }

  function trackActiveJob(shotIndex, jobId) {
    if (!state.workspace) return;
    if (!state.workspace.activeJobIds) state.workspace.activeJobIds = {};
    if (jobId) state.workspace.activeJobIds[shotIndex] = jobId;
  }

  function untrackActiveJob(shotIndex) {
    if (!state.workspace || !state.workspace.activeJobIds) return;
    delete state.workspace.activeJobIds[shotIndex];
  }

  async function cancelBridgeJobs(jobIds) {
    const ids = (jobIds || []).filter(Boolean);
    await Promise.all(ids.map((id) =>
      answerlyFetch('/answerly/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' })
        .catch(() => null)
    ));
  }

  /** Cancel one shot, or the whole parallel batch when opts.all. */
  async function cancelAnswerlyGeneration(opts) {
    opts = opts || {};
    if (!state.workspace) return;
    const batch = state.workspace.genAllBatch;
    // Explicit Cancel all, or single-shot cancel with no shot index while a batch is active.
    const cancelAll = !!opts.all || (opts.shotIndex == null && !!batch);
    if (cancelAll) {
      state.workspace.cancelAll = true;
      if (batch) batch.cancelRequested = true;
      const ids = Object.keys(state.workspace.activeJobIds || {}).map((k) => state.workspace.activeJobIds[k]);
      await cancelBridgeJobs(ids);
      try {
        await answerlyFetch('/answerly/jobs/cancel-all', { method: 'POST' });
      } catch (e) { /* bridge may be restarting */ }
      showToast('Cancelling all Answerly jobs…', false);
      renderWorkspace();
      return;
    }
    const shotIndex = opts.shotIndex != null ? opts.shotIndex : state.workspace.generating;
    if (shotIndex == null) return;
    if (!state.workspace.cancelShots) state.workspace.cancelShots = {};
    state.workspace.cancelShots[shotIndex] = true;
    const jobId = state.workspace.activeJobIds && state.workspace.activeJobIds[shotIndex];
    if (jobId) await cancelBridgeJobs([jobId]);
    markShotBusy(shotIndex, 'Cancelling…');
    showToast('Cancelling generation…', false);
    renderWorkspace();
  }

  async function pollAnswerlyJob(id, onProgress, opts) {
    opts = opts || {};
    for (;;) {
      if (typeof opts.shouldCancel === 'function' && opts.shouldCancel()) {
        try {
          await answerlyFetch('/answerly/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
        } catch (e) { /* ignore */ }
        throw makeCancelledError();
      }
      const job = await answerlyFetch('/answerly/jobs/' + encodeURIComponent(id));
      if (typeof onProgress === 'function') onProgress(job);
      if (job.status === 'done') return job;
      if (job.status === 'cancelled' || job.status === 'canceled') throw makeCancelledError();
      if (job.status === 'failed') throw new Error(job.error || 'Answerly job failed');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async function runAnswerlyForShot(shotIndex, promptText, opts) {
    opts = opts || {};
    await answerlyEnsureToken();
    const resolvedPrior = await resolvePriorAsset(shotIndex, {
      driveImgIndex: opts.driveImgIndex,
      requireMainFromHeroOutput: !!opts.requireMainFromHeroOutput
    });
    if (opts.requireMainFromHeroOutput && !(resolvedPrior && resolvedPrior.asset &&
        String(resolvedPrior.source || '').indexOf('main-from-hero-output') === 0)) {
      const err = new Error('MAIN needs Hero Front / 01 generated D as A — wait for that shot first.');
      err.code = 'main_needs_hero_output';
      throw err;
    }
    const source = pickAnswerlyReplacePayload(shotIndex, resolvedPrior && resolvedPrior.asset, {
      shots: shotListFor(taskByEan(state.workspace && state.workspace.ean) || {})
    });
    if (!source.ok) {
      const err = new Error(source.error);
      err.code = source.code;
      throw err;
    }
    warnIfOverAnswerlyLimit(source.prior, 'Prior (A)');
    source.inputs.forEach((a, i) => warnIfOverAnswerlyLimit(a, 'Product input B' + (i + 1)));
    const sizeEl = els.workspace && els.workspace.querySelector('.wr-size-select');
    const modelEl = els.workspace && els.workspace.querySelector('.wr-model-select');
    const imageSize = (sizeEl && sizeEl.value) || localStorage.getItem(ANSWERLY_SIZE_KEY) || '2K';
    const model = (modelEl && modelEl.value) || localStorage.getItem(ANSWERLY_MODEL_KEY) || 'gemini-3.1-flash-image';
    localStorage.setItem(ANSWERLY_SIZE_KEY, imageSize);
    localStorage.setItem(ANSWERLY_MODEL_KEY, model);

    // Order: INPUT IMAGE 1 = prior/master, 2+ = each product B as its own Answerly reference slot
    // (second_reference_url, third_reference_url, fourth_reference_url, …).
    // Krea / Grok accept at most 1 reference — send prior only; product stays in the prompt text.
    const maxRefs = modelMaxReferenceImages(model);
    const productInputs = source.inputs.slice(0, Math.max(0, maxRefs - 1));
    const assetList = maxRefs <= 1
      ? [source.prior]
      : [source.prior].concat(productInputs);
    const images = await Promise.all(assetList.map(assetToImagePayload));
    let prompt = String(promptText || '').trim();
    if (!prompt) throw new Error('Prompt is empty');
    const priorLabel = (resolvedPrior && resolvedPrior.source && String(resolvedPrior.source).indexOf('main-from-hero') === 0)
      ? (source.prior.name || 'hero_angle_source.png') + ' (angle source for MAIN)'
      : (source.prior.name || 'prior.png');
    if (maxRefs <= 1) {
      prompt += '\n\n---\nINPUT IMAGE 1 — PRIOR / MASTER (only reference; this model accepts 1 image): ' +
        priorLabel +
        '\nProduct likeness from prompt + B filenames: ' +
        source.inputs.map((a) => a.name || 'product.png').join(', ');
      source.reason = (source.reason || 'Image to Image') + ' · 1-ref model (prior only)';
    } else {
      prompt += '\n\n---\nINPUT IMAGE 1 — PRIOR / MASTER: ' + priorLabel +
        '\n' + productInputs.map((a, i) =>
          'INPUT IMAGE ' + (i + 2) + ' — PRODUCT REFERENCE: ' + (a.name || ('product_' + (i + 1) + '.png'))
        ).join('\n');
      source.reason = (source.reason || 'Image to Image') +
        ' · ' + assetList.length + ' refs (A + ' + productInputs.length + ' B)';
      if (source.inputs.length > productInputs.length) {
        source.reason += ' · capped ' + productInputs.length + '/' + source.inputs.length + ' B';
      }
    }
    if (resolvedPrior && resolvedPrior.source && String(resolvedPrior.source).indexOf('main-from-hero') === 0) {
      source.reason = 'MAIN from ' +
        ((resolvedPrior.angleShot && (resolvedPrior.angleShot.name || resolvedPrior.angleShot.code)) || 'Hero Front') +
        ' + product input(s) → Image to Image' +
        (maxRefs <= 1 ? ' · 1-ref model (prior only)' : '');
    }

    const taskForJob = taskByEan(state.workspace.ean) || { ean: state.workspace.ean };
    const shotsForJob = shotListFor(taskForJob);
    const shotForJob = shotsForJob[shotIndex] || { seq: shotIndex + 1, code: 'OUT' };
    const body = Object.assign({
      workflow: source.workflow,
      model: model,
      image_size: imageSize,
      prompt: prompt,
      images: images
    }, answerlyQueueExtras(taskForJob, shotForJob, shotIndex));

    if (isShotCancelRequested(shotIndex)) throw makeCancelledError();
    markShotBusy(shotIndex, 'Queued…');
    try {
      const queued = await answerlyFetch('/answerly/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      trackActiveJob(shotIndex, queued.id);
      if (isShotCancelRequested(shotIndex)) {
        await cancelBridgeJobs([queued.id]);
        throw makeCancelledError();
      }
      let lastStage = '';
      const job = await pollAnswerlyJob(queued.id, (j) => {
        if (!state.workspace || state.workspace.mode !== 'replace') return;
        const stage = (j.stage || j.status || 'running') +
          (typeof j.progress === 'number' ? ' · ' + j.progress + '%' : '');
        markShotBusy(shotIndex, stage);
        if (state.workspace.genAllBatch) {
          const nBusy = Object.keys(state.workspace.busyShots || {}).length;
          state.workspace.genStage = nBusy + ' in parallel · ' + stage;
        }
        if (stage !== lastStage) {
          lastStage = stage;
          renderWorkspace();
        }
      }, {
        shouldCancel: () => isShotCancelRequested(shotIndex)
      });

      if (isShotCancelRequested(shotIndex)) throw makeCancelledError();

      const resultRes = await bridgeFetch('/answerly/jobs/' + encodeURIComponent(job.id) + '/result');
      if (!resultRes.ok) throw new Error('Could not download Answerly result');
      if (isShotCancelRequested(shotIndex)) throw makeCancelledError();
      const outBlob = await resultRes.blob();
      const outUrl = URL.createObjectURL(outBlob);
      const assets = shotAssets(shotIndex);
      const task = taskForJob;
      const shots = shotsForJob;
      const priorMatch = resolveWorkspaceMatch(task).selected;
      const driveImgs = priorDriveImages(priorMatch);
      const preferredDriveIdx = opts.driveImgIndex != null
        ? opts.driveImgIndex
        : state.workspace.driveImgIndex;
      const driveIdx = driveImgs.length
        ? Math.min(Math.max(0, Number(preferredDriveIdx) || 0), driveImgs.length - 1)
        : -1;
      const activeShot = shotForJob;
      let driveName = driveIdx >= 0 ? (driveImgs[driveIdx] && driveImgs[driveIdx].name) : '';
      // MAIN is generated from Hero Front / seq 01 — keep output filename as MAIN, not the angle source.
      if (isMainShot(activeShot)) {
        const mainDrive = driveImgs.find((img) => /^MAIN$/i.test(driveImgLabel(img.name)));
        driveName = mainDrive ? mainDrive.name : '';
      }
      revokeAssetUrl(assets.output);
      const dims = await measureBlobDims(outBlob);
      const execId = job.rootExecutionId || job.executionId || '';
      rememberAnswerlyRootExecution(execId || job.executionId);
      assets.output = {
        blob: outBlob,
        url: outUrl,
        _blobRef: outBlob,
        name: synthesizeFileName(task, driveName, activeShot),
        model: model,
        size: imageSize,
        workflow: source.workflow,
        approved: false,
        jobId: job.id || '',
        executionId: execId || job.executionId || '',
        resultUrl: job.resultUrl || '',
        inputUrl: job.inputUrl || (Array.isArray(job.inputUrls) && job.inputUrls[0]) || '',
        inputUrls: Array.isArray(job.inputUrls)
          ? job.inputUrls.filter(Boolean).map(String)
          : (job.inputUrl ? [String(job.inputUrl)] : []),
        priorSource: (resolvedPrior && resolvedPrior.source) || '',
        w: dims.w || 0,
        h: dims.h || 0
      };
      assets.error = null;
      if (!state.workspace.outputs) state.workspace.outputs = {};
      state.workspace.outputs[shotIndex] = true;
      // Keep export card in sync when D is (re)generated — leave manual drops alone.
      if (state.workspace.exportImages) {
        const exKey = String(shotIndex);
        const existingExport = state.workspace.exportImages[exKey] || state.workspace.exportImages[shotIndex];
        if (!exportImageSkipsRating(existingExport)) {
          state.workspace.exportImages[exKey] = {
            url: outUrl,
            _blobRef: outBlob,
            name: assets.output.name,
            blob: outBlob,
            file: outBlob,
            w: dims.w || 0,
            h: dims.h || 0,
            status: 'ready',
            fromApproved: false,
            manualDrop: false,
            skipRating: false,
            upscale: null
          };
        }
      }
      // Fresh generate → rating must start blank for this shot (do not carry prior stars).
      clearShotRating(shotIndex);
      bumpShotGenerationCount(shotIndex);
      saveReplaceOutputDraft(state.workspace.ean, shotIndex, assets.output);
      // Keep Product Dimension base in sync when any shot D is (re)generated.
      mdimOnShotOutputChanged(shotIndex);
      // First successful generate for this EAN → Render Tracker "In progress".
      markRenderInProgress(state.workspace.ean);
      return { job: job, source: source, output: assets.output };
    } finally {
      untrackActiveJob(shotIndex);
      clearShotBusy(shotIndex);
    }
  }

  async function runAnswerlyPrimaryForShot(shotIndex, promptText) {
    await answerlyEnsureToken();
    const source = pickAnswerlyPrimaryPayload(shotIndex);
    if (!source.ok) {
      const err = new Error(source.error);
      err.code = source.code;
      throw err;
    }
    source.ordered.forEach((item) => {
      const label = item.role === 'b'
        ? ('Product B' + ((item.inputImage != null ? item.inputImage : '') || ''))
        : (item.role.toUpperCase() + ' ref');
      warnIfOverAnswerlyLimit(item.asset, label);
    });
    const sizeEl = els.workspace && els.workspace.querySelector('.wr-size-select');
    const modelEl = els.workspace && els.workspace.querySelector('.wr-model-select');
    const imageSize = (sizeEl && sizeEl.value) || localStorage.getItem(ANSWERLY_SIZE_KEY) || '2K';
    const model = (modelEl && modelEl.value) || localStorage.getItem(ANSWERLY_MODEL_KEY) || 'gemini-3.1-flash-image';
    localStorage.setItem(ANSWERLY_SIZE_KEY, imageSize);
    localStorage.setItem(ANSWERLY_MODEL_KEY, model);

    const maxRefs = modelMaxReferenceImages(model, { primary: true });
    const ordered = source.ordered.slice();
    let assetList;
    if (maxRefs <= 1) {
      // Prefer A1 (background), else A2 (camera), else first available.
      const prefer = ordered.find((x) => x.role === 'a1') ||
        ordered.find((x) => x.role === 'a2') ||
        ordered[0];
      assetList = prefer ? [prefer] : [];
      source.reason += ' · 1-ref model (' + (prefer && prefer.role ? prefer.role.toUpperCase() : 'ref') + ' only)';
    } else {
      assetList = ordered.slice(0, maxRefs);
      if (ordered.length > assetList.length) {
        source.reason += ' · capped ' + assetList.length + '/' + ordered.length + ' refs';
      }
    }
    if (!assetList.length) throw new Error('No Primary reference images ready.');
    const images = await Promise.all(assetList.map((item) => assetToImagePayload(item.asset)));
    let prompt = String(promptText || '').trim();
    if (!prompt) throw new Error('Prompt is empty');
    prompt += '\n\n---\n' + assetList.map((item) =>
      'INPUT IMAGE ' + item.inputImage + ' — `' + item.refKey + '` — ' +
        (item.role === 'a1' ? 'MASTER BACKGROUND'
          : (item.role === 'a2' ? 'CAMERA REFERENCE'
            : (item.role === 'a3' ? 'OPTIONAL REFERENCE' : 'PRODUCT REFERENCE'))) +
        ': ' + ((item.asset && item.asset.name) || item.refKey)
    ).join('\n');

    const taskForJob = taskByEan(state.workspace.ean) || { ean: state.workspace.ean };
    const shotsForJob = shotListFor(taskForJob);
    const shotForJob = shotsForJob[shotIndex] || { seq: shotIndex + 1, code: 'OUT' };
    const body = Object.assign({
      workflow: source.workflow,
      model: model,
      image_size: imageSize,
      prompt: prompt,
      images: images
    }, answerlyQueueExtras(taskForJob, shotForJob, shotIndex));

    if (isShotCancelRequested(shotIndex)) throw makeCancelledError();
    markShotBusy(shotIndex, 'Queued…');
    try {
      const queued = await answerlyFetch('/answerly/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      trackActiveJob(shotIndex, queued.id);
      if (isShotCancelRequested(shotIndex)) {
        await cancelBridgeJobs([queued.id]);
        throw makeCancelledError();
      }
      let lastStage = '';
      const job = await pollAnswerlyJob(queued.id, (j) => {
        if (!state.workspace || state.workspace.mode !== 'primary') return;
        const stage = (j.stage || j.status || 'running') +
          (typeof j.progress === 'number' ? ' · ' + j.progress + '%' : '');
        markShotBusy(shotIndex, stage);
        if (stage !== lastStage) {
          lastStage = stage;
          renderWorkspace();
        }
      }, {
        shouldCancel: () => isShotCancelRequested(shotIndex)
      });

      if (isShotCancelRequested(shotIndex)) throw makeCancelledError();

      const resultRes = await bridgeFetch('/answerly/jobs/' + encodeURIComponent(job.id) + '/result');
      if (!resultRes.ok) throw new Error('Could not download Answerly result');
      if (isShotCancelRequested(shotIndex)) throw makeCancelledError();
      const outBlob = await resultRes.blob();
      const outUrl = URL.createObjectURL(outBlob);
      const assets = shotAssets(shotIndex);
      const task = taskForJob;
      const activeShot = shotForJob;
      revokeAssetUrl(assets.output);
      const dims = await measureBlobDims(outBlob);
      const execId = job.rootExecutionId || job.executionId || '';
      rememberAnswerlyRootExecution(execId || job.executionId);
      assets.output = {
        blob: outBlob,
        url: outUrl,
        _blobRef: outBlob,
        name: synthesizeFileName(task, '', activeShot),
        model: model,
        size: imageSize,
        workflow: source.workflow,
        approved: false,
        jobId: job.id || '',
        executionId: execId || job.executionId || '',
        resultUrl: job.resultUrl || '',
        inputUrl: job.inputUrl || (Array.isArray(job.inputUrls) && job.inputUrls[0]) || '',
        inputUrls: Array.isArray(job.inputUrls)
          ? job.inputUrls.filter(Boolean).map(String)
          : (job.inputUrl ? [String(job.inputUrl)] : []),
        priorSource: 'primary',
        w: dims.w || 0,
        h: dims.h || 0
      };
      assets.error = null;
      if (!state.workspace.outputs) state.workspace.outputs = {};
      state.workspace.outputs[shotIndex] = true;
      // Keep export card in sync when D is (re)generated — leave manual drops alone.
      if (state.workspace.exportImages) {
        const exKey = String(shotIndex);
        const existingExport = state.workspace.exportImages[exKey] || state.workspace.exportImages[shotIndex];
        if (!exportImageSkipsRating(existingExport)) {
          state.workspace.exportImages[exKey] = {
            url: outUrl,
            _blobRef: outBlob,
            name: assets.output.name,
            blob: outBlob,
            file: outBlob,
            w: dims.w || 0,
            h: dims.h || 0,
            status: 'ready',
            fromApproved: false,
            manualDrop: false,
            skipRating: false,
            upscale: null
          };
        }
      }
      clearShotRating(shotIndex);
      bumpShotGenerationCount(shotIndex);
      mdimOnShotOutputChanged(shotIndex);
      markRenderInProgress(state.workspace.ean);
      return { job: job, source: source, output: assets.output };
    } finally {
      untrackActiveJob(shotIndex);
      clearShotBusy(shotIndex);
    }
  }

  function persistReplacePromptFromDom() {
    if (!state.workspace || !els.workspace) return;
    if (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary') return;
    const promptEl = els.workspace.querySelector('[data-ws-prompt]');
    if (!promptEl) return;
    if (!state.workspace.prompts) state.workspace.prompts = {};
    const key = promptEl.getAttribute('data-ws-prompt');
    const idx = key != null && key !== '' ? Number(key) : (state.workspaceShot || 0);
    state.workspace.prompts[idx] = promptEl.value;
  }

  function syncPromptExpandHighlight() {
    const overlay = document.getElementById('wr-prompt-expand');
    if (!overlay || overlay.hidden || !state.workspace) return;
    const ta = overlay.querySelector('.wr-prompt-modal-text');
    const hl = overlay.querySelector('[data-ws-prompt-modal-highlight]');
    if (!ta || !hl) return;
    const idx = Number(overlay.dataset.shotIndex);
    const shotIdx = isNaN(idx) ? (state.workspaceShot || 0) : idx;
    const task = taskByEan(state.workspace.ean);
    if (!task) {
      hl.innerHTML = esc(ta.value || '').replace(/\n/g, '<br>');
      return;
    }
    const shots = shotListFor(task);
    const shot = shots[shotIdx] || shots[0];
    const prior = state.workspace.mode === 'primary' ? null : resolveWorkspaceMatch(task).selected;
    const text = ta.value || '';
    const manual = isPromptManualEdit(shotIdx);
    const baseline = manual ? promptDefaultForDiff(task, shot, prior, shotIdx) : text;
    hl.innerHTML = (manual
      ? promptDiffHighlightHtml(text, baseline)
      : formatPromptOverlayHtml(esc(text).replace(/\n/g, '<br>'))) +
      (text && !/\n$/.test(text) ? '<br>' : '');
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }

  function openPromptExpandModal(text, shotIndex) {
    let overlay = document.getElementById('wr-prompt-expand');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wr-prompt-expand';
      overlay.className = 'wr-prompt-modal';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="wr-prompt-modal-backdrop" data-wr-prompt-close></div>' +
        '<div class="wr-prompt-modal-panel" role="dialog" aria-modal="true" aria-label="Full prompt">' +
          '<div class="wr-prompt-modal-head">' +
            '<div class="wr-prompt-modal-title">Prompt</div>' +
            '<button type="button" class="wr-icon-btn" data-wr-prompt-close title="Close" aria-label="Close">✕</button>' +
          '</div>' +
          '<div class="wr-prompt-modal-wrap">' +
            '<div class="wr-prompt-modal-highlight" data-ws-prompt-modal-highlight aria-hidden="true"></div>' +
            '<textarea class="wr-prompt-modal-text" spellcheck="false"></textarea>' +
          '</div>' +
          '<div class="wr-prompt-modal-foot">' +
            '<button type="button" class="wr-text-btn" data-wr-prompt-copy>Copy</button>' +
            '<button type="button" class="tp-btn tp-btn-primary" data-wr-prompt-apply>Apply &amp; close</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target.closest('[data-wr-prompt-close]')) {
          overlay.hidden = true;
          return;
        }
        if (e.target.closest('[data-wr-prompt-copy]')) {
          const ta = overlay.querySelector('.wr-prompt-modal-text');
          const val = ta ? ta.value : '';
          if (!val) return;
          navigator.clipboard.writeText(val).then(() => showToast('Prompt copied.', false))
            .catch(() => showToast('Could not copy prompt.', false, { error: true }));
          return;
        }
        if (e.target.closest('[data-wr-prompt-apply]')) {
          const ta = overlay.querySelector('.wr-prompt-modal-text');
          const rawIdx = overlay.dataset.shotIndex;
          const idx = rawIdx != null && rawIdx !== '' ? Number(rawIdx) : (state.workspaceShot || 0);
          if (state.workspace && !isNaN(idx)) {
            if (!state.workspace.prompts) state.workspace.prompts = {};
            const next = ta ? ta.value : '';
            state.workspace.prompts[idx] = next;
            const task = taskByEan(state.workspace.ean);
            const shots = task ? shotListFor(task) : [];
            const shot = shots[idx] || shots[0];
            const prior = state.workspace.mode === 'primary' ? null
              : (task ? resolveWorkspaceMatch(task).selected : null);
            const liveDefault = task
              ? liveCompiledPromptText(task, shot, prior)
              : '';
            setPromptManualEdit(idx,
              normalizePromptCompare(next) !== normalizePromptCompare(liveDefault));
            const live = els.workspace && els.workspace.querySelector('[data-ws-prompt]');
            if (live && String(live.getAttribute('data-ws-prompt')) === String(idx)) {
              live.value = state.workspace.prompts[idx];
            }
            if (state.workspace.mode === 'replace') persistCurrentReplaceDraft();
            renderWorkspace();
            refreshPromptOriginUi();
          }
          overlay.hidden = true;
          showToast('Prompt updated.', false);
        }
      });
      overlay.addEventListener('input', (e) => {
        if (!e.target.matches('.wr-prompt-modal-text')) return;
        const rawIdx = overlay.dataset.shotIndex;
        const idx = rawIdx != null && rawIdx !== '' ? Number(rawIdx) : (state.workspaceShot || 0);
        if (!isNaN(idx)) setPromptManualEdit(idx, true);
        syncPromptExpandHighlight();
      });
      overlay.addEventListener('scroll', (e) => {
        if (!e.target.matches || !e.target.matches('.wr-prompt-modal-text')) return;
        const hl = overlay.querySelector('[data-ws-prompt-modal-highlight]');
        if (!hl) return;
        hl.scrollTop = e.target.scrollTop;
        hl.scrollLeft = e.target.scrollLeft;
      }, true);
    }
    // Recreate wrap markup if an older modal without highlight is still in the DOM.
    if (!overlay.querySelector('[data-ws-prompt-modal-highlight]')) {
      const oldTa = overlay.querySelector('.wr-prompt-modal-text');
      const panel = overlay.querySelector('.wr-prompt-modal-panel');
      if (panel && oldTa) {
        const wrap = document.createElement('div');
        wrap.className = 'wr-prompt-modal-wrap';
        wrap.innerHTML =
          '<div class="wr-prompt-modal-highlight" data-ws-prompt-modal-highlight aria-hidden="true"></div>';
        oldTa.replaceWith(wrap);
        wrap.appendChild(oldTa);
      }
    }
    overlay.dataset.shotIndex = String(shotIndex != null ? shotIndex : 0);
    const ta = overlay.querySelector('.wr-prompt-modal-text');
    if (ta) ta.value = String(text || '');
    overlay.hidden = false;
    syncPromptExpandHighlight();
    if (ta) {
      ta.focus();
      ta.setSelectionRange(0, 0);
    }
  }

  function openReplaceFilePicker(target) {
    if (!state.workspace) return;
    state.workspace.fileTarget = target || { kind: 'inputs', shotIndex: state.workspaceShot || 0 };
    // Keep the file input on document.body so renderWorkspace() innerHTML rebuilds do not destroy it mid-pick.
    // Do NOT use the HTML `hidden` attribute — some browsers refuse input.click() on hidden file inputs.
    let input = document.getElementById('wr-file-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'wr-file-input';
      input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
      input.multiple = true;
      input.className = 'wr-file-input-native';
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        // Snapshot FileList BEFORE clearing — input.files is live; value='' empties it.
        const picked = Array.prototype.slice.call(input.files || []);
        const dest = state.workspace && state.workspace.fileTarget
          ? Object.assign({}, state.workspace.fileTarget)
          : null;
        try { input.value = ''; } catch (_) { /* ignore */ }
        if (!picked.length || !dest || !state.workspace) return;
        if (dest.kind === 'prior') {
          setPriorOverrideFromFile(dest.shotIndex, picked[0]);
        } else if (dest.kind === 'primary-a1' || dest.kind === 'primary-a2' || dest.kind === 'primary-a3') {
          const slot = dest.kind === 'primary-a1' ? 'a1' : (dest.kind === 'primary-a3' ? 'a3' : 'a2');
          setPrimarySlotFromFile(slot, dest.shotIndex, picked[0]);
        } else if (dest.kind === 'export') {
          addExportImageToShot(dest.shotIndex, picked[0]);
        } else if (dest.kind === 'export-fill') {
          fillNextExportSlots(picked);
        } else {
          addLocalFilesToShot(dest.shotIndex, picked);
        }
      });
    }
    const singleKinds = { prior: 1, 'primary-a1': 1, 'primary-a2': 1, 'primary-a3': 1 };
    input.multiple = !(state.workspace.fileTarget && singleKinds[state.workspace.fileTarget.kind]);
    // Defer click one tick so the user-gesture chain stays intact after React-less re-renders.
    try {
      input.click();
    } catch (err) {
      showToast('Could not open file picker — try dropping a JPG/PNG onto B.', false, { error: true });
    }
  }

  function normPromptKey(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function embeddedUniversalRows() {
    const replace = window.UNIVERSAL_REPLACE_PROMPTS;
    const primary = window.UNIVERSAL_PRIMARY_PROMPTS;
    const rows = [];
    if (replace && Array.isArray(replace.rows)) rows.push.apply(rows, replace.rows);
    if (primary && Array.isArray(primary.rows)) rows.push.apply(rows, primary.rows);
    return rows;
  }

  function parseUniversalGrid(values) {
    const grid = values || [];
    if (!grid.length) return [];
    const headers = (grid[0] || []).map((h) => normPromptKey(h));
    function col() {
      for (let a = 0; a < arguments.length; a++) {
        const want = normPromptKey(arguments[a]);
        const i = headers.indexOf(want);
        if (i >= 0) return i;
      }
      return -1;
    }
    const iWorkflow = col('Primary/Product replacement', 'workflow');
    const iProductType = col('Product Type');
    const iCode = col('Image short code', 'Shot Code');
    const iName = col('Image Name');
    const iPrompt = col('Final successful prompt', 'prompt');
    const rows = [];
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const prompt = String(iPrompt >= 0 ? row[iPrompt] : '').trim();
      if (!prompt) continue;
      rows.push({
        workflow: String(iWorkflow >= 0 ? row[iWorkflow] : '').trim(),
        productType: String(iProductType >= 0 ? row[iProductType] : '').trim(),
        imageShortCode: String(iCode >= 0 ? row[iCode] : '').trim(),
        imageName: String(iName >= 0 ? row[iName] : '').trim(),
        prompt: prompt
      });
    }
    return rows;
  }

  async function ensureApprovedCustomPrompts(force) {
    if (state.approvedCustomsReady && !force) return state.approvedCustoms || [];
    state.approvedCustomsReady = true;
    state.approvedCustoms = state.approvedCustoms || [];
    if (!PROMPT_DB_URL) return state.approvedCustoms;
    try {
      const data = await jsonp('action=approvedCustoms&limit=250', 45000, PROMPT_DB_URL);
      const rows = (data && data.rows) || [];
      state.approvedCustoms = Array.isArray(rows) ? rows : [];
      state.approvedCustomsSource = 'live';
    } catch (err) {
      // Older Prompt DB deploys lack approvedCustoms — reuse stays off until redeploy.
      state.approvedCustomsError = (err && err.message) || 'approvedCustoms failed';
      if (!state.approvedCustoms) state.approvedCustoms = [];
    }
    return state.approvedCustoms || [];
  }

  function findReusedCustomPrompt(t, shot) {
    const rows = state.approvedCustoms || [];
    if (!t || !shot || !rows.length) return null;
    const tpl = templateMatchKey(t.template);
    const sub = normPromptKey(t.subCategory);
    const code = normPromptKey(shot.code);
    const name = normPromptKey(shot.name);
    if (!tpl || !sub) return null;
    // Newest-first list from the sheet — first match wins.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (templateMatchKey(row.template) !== tpl) continue;
      if (normPromptKey(row.subCategory) !== sub) continue;
      const rowCode = normPromptKey(row.imageShortCode);
      const rowName = normPromptKey(row.imageName);
      const codeOk = code && rowCode && code === rowCode;
      const nameOk = name && rowName && (name === rowName || name.indexOf(rowName) >= 0 || rowName.indexOf(name) >= 0);
      // MAIN: also accept Universal MAIN / marketplace main naming.
      const mainOk = isMainShot(shot) && (rowCode === 'main' || /main/.test(rowName));
      if (!(codeOk || nameOk || mainOk)) continue;
      if (String(row.ean) === String(t.ean)) continue; // not self
      const prompt = String(row.prompt || '').trim();
      if (!prompt) continue;
      return row;
    }
    return null;
  }

  async function ensureUniversalPrompts(force) {
    if (state.universalReady && !force) return state.universalRows || [];
    state.universalReady = true;
    state.universalRows = embeddedUniversalRows();
    state.universalSource = 'embed';
    if (!PROMPT_DB_URL) return state.universalRows;
    try {
      const data = await jsonp('action=universal', 45000, PROMPT_DB_URL);
      const live = parseUniversalGrid(data && data.values);
      if (live.length) {
        // Prefer live Prompt DB. If Primary master is not in the sheet yet, keep
        // the embedded Primary composition so Primary C still has a body.
        const liveHasPrimary = live.some(isPrimaryWorkflow);
        const embedPrimary = embeddedUniversalRows().filter(isPrimaryWorkflow);
        state.universalRows = liveHasPrimary ? live : live.concat(embedPrimary);
        state.universalSource = liveHasPrimary ? 'live' : 'live+embed-primary';
      }
    } catch (err) {
      // Keep embed fallback; do not block Replacement UI.
      state.universalError = (err && err.message) || 'Universal load failed';
    }
    // After Universal refresh, keep automated prompts aligned so approve stays Automated.
    // Always refresh MAIN prompts from the Universal MAIN row (avoid stuck Hero Front soft-match).
    if (state.workspace && state.workspace.mode === 'replace') {
      const task = taskByEan(state.workspace.ean);
      if (task) {
        const prior = resolveWorkspaceMatch(task).selected;
        syncAutomatedPromptsToLatestCompile(task, prior);
        forceRefreshMainPrompts(task, prior);
      }
    } else if (state.workspace && state.workspace.mode === 'primary') {
      const taskP = taskByEan(state.workspace.ean);
      if (taskP) {
        syncAutomatedPrimaryPromptsToLatestCompile(taskP);
        forceRefreshMainPrompts(taskP, null);
      }
    }
    return state.universalRows || [];
  }

  function forceRefreshMainPrompts(t, prior) {
    if (!state.workspace || !t) return;
    const shots = shotListFor(t);
    if (!state.workspace.prompts) state.workspace.prompts = {};
    const isPrimary = state.workspace.mode === 'primary';
    let changed = false;
    shots.forEach((shot, idx) => {
      if (!isMainShot(shot)) return;
      const compiled = isPrimary
        ? compilePrimaryPrompt(t, shot, { shotIndex: idx })
        : compileReplacePrompt(t, shot, prior);
      const cur = state.workspace.prompts[idx];
      const curN = normalizePromptCompare(cur);
      const nextN = normalizePromptCompare(compiled.text);
      if (curN === nextN) return;
      if (isPrimary) {
        // Always refresh automated Primary MAIN from Universal MAIN Final successful.
        // (Default / Universal reload must not keep a wrong soft-matched body.)
        if (isPromptManualEdit(idx)) return;
      } else if (cur != null && curN !== nextN) {
        // Keep any author edit (differs from live Universal MAIN compile), including cleared text.
        return;
      }
      state.workspace.prompts[idx] = compiled.text;
      rememberPromptBaseline(idx, compiled.text);
      if (isPrimary) setPromptManualEdit(idx, false);
      changed = true;
    });
    if (changed) {
      if (isPrimary) persistCurrentPrimaryDraft();
      else if (state.workspace.mode === 'replace') persistCurrentReplaceDraft();
      renderWorkspace();
    }
  }

  // MAIN is generated from Hero Front. If no Hero Front, use the Naming shot marked seq 01.
  function mainAngleSourceShot(shots) {
    const list = shots || [];
    const hero = list.find((s) => {
      if (isMainShot(s)) return false;
      const code = String(s.code || '').toUpperCase();
      const name = String(s.name || '');
      if (/^H-FR(?:-SET)?$/i.test(code)) return true;
      if (/^hero\s*front$/i.test(name.trim())) return true;
      if (/^hero\s*front\s*-\s*set$/i.test(name.trim())) return true;
      return false;
    });
    if (hero) return hero;
    const seq01 = list.find((s) => {
      if (isMainShot(s)) return false;
      const seq = String(s.seq != null ? s.seq : '').trim();
      return seq === '01' || seq === '1' || Number(seq) === 1;
    });
    return seq01 || null;
  }

  function isReplaceWorkflow(row) {
    const w = String((row && row.workflow) || '');
    if (!w.trim()) return true; // legacy blank = Product replacement
    return /product\s*replacement/i.test(w) && !/^primary$/i.test(w.trim());
  }

  function isPrimaryWorkflow(row) {
    return /^primary$/i.test(String((row && row.workflow) || '').trim()) ||
      /primary\s*workflow/i.test(String((row && row.workflow) || ''));
  }

  function isUniversalMainRow(row) {
    if (!row) return false;
    // Same rules as isMainShot so Universal MAIN / white-background rows resolve.
    return isMainShot({
      code: row.imageShortCode,
      name: row.imageName,
      note: ''
    });
  }

  /**
   * Primary MAIN Final successful from Prompt DB — same idea as Replacement:
   * prefer Primary-workflow MAIN row, else Product-replacement MAIN, else Primary master.
   */
  function resolvePrimaryMainUniversal(productTypeName) {
    const rows = (state.universalRows && state.universalRows.length)
      ? state.universalRows
      : embeddedUniversalRows();
    const pt = normPromptKey(productTypeName);
    const primaryRows = rows.filter(isPrimaryWorkflow);
    const replaceRows = rows.filter(isReplaceWorkflow);

    function typeOk(row) {
      const rpt = normPromptKey(row.productType);
      return !rpt || !pt || rpt === pt;
    }
    function labelFor(row) {
      const name = String(row.imageName || '').trim();
      const code = String(row.imageShortCode || '').trim();
      if (name && code) return name + ' (' + code + ')';
      return name || code || 'MAIN';
    }
    function findMain(pool, typed) {
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        if (!isUniversalMainRow(row)) continue;
        if (typed && !typeOk(row)) continue;
        if (!String(row.prompt || '').trim()) continue;
        return { prompt: row.prompt, label: labelFor(row), row: row };
      }
      return null;
    }

    return findMain(primaryRows, true) ||
      findMain(primaryRows, false) ||
      findMain(replaceRows, true) ||
      findMain(replaceRows, false) ||
      (function () {
        const master = resolvePrimaryUniversalMaster(productTypeName);
        if (master && master.prompt) {
          return { prompt: master.prompt, label: 'MAIN · master', row: master };
        }
        return { prompt: '', label: 'missing', row: null };
      }());
  }

  function resolveUniversalPrompt(shot, productTypeName, opts) {
    const options = opts || {};
    const wantPrimary = options.workflow === 'primary' ||
      (state.workspace && state.workspace.mode === 'primary' && options.workflow !== 'replace');
    const rows = (state.universalRows && state.universalRows.length)
      ? state.universalRows
      : embeddedUniversalRows();
    const primaryRows = rows.filter(isPrimaryWorkflow);
    const replaceRows = rows.filter(isReplaceWorkflow);
    // Primary mode: prefer Primary Universal rows; do not fall back to Replacement text
    // (that would inject "remove prior product" into the Primary appendix).
    const pool = wantPrimary
      ? (primaryRows.length ? primaryRows : [])
      : (replaceRows.length ? replaceRows : rows);
    const shotCode = normPromptKey(shot && shot.code);
    const shotName = normPromptKey(shot && shot.name);
    const pt = normPromptKey(productTypeName);
    const mainShot = isMainShot(shot);

    function typeOk(row) {
      const rpt = normPromptKey(row.productType);
      return !rpt || !pt || rpt === pt;
    }

    function labelFor(row, kind) {
      if (kind === 'master') return 'master';
      const name = String(row.imageName || '').trim();
      const code = String(row.imageShortCode || '').trim();
      if (name && code) return name + ' (' + code + ')';
      return name || code || 'shot-specific';
    }

    // MAIN shots: always prefer the Universal MAIN row — never soft-match Hero Front / H-FR.
    if (mainShot) {
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        if (isUniversalMainRow(row) && typeOk(row)) {
          return { prompt: row.prompt, label: labelFor(row, 'shot'), row: row };
        }
      }
      // Type filter may have skipped MAIN — try again without product-type filter.
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        if (isUniversalMainRow(row)) {
          return { prompt: row.prompt, label: labelFor(row, 'shot'), row: row };
        }
      }
      // Fall through to master only (skip Hero Front contains-match below).
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        if (!String(row.imageName || '').trim() && !String(row.imageShortCode || '').trim() && typeOk(row)) {
          return { prompt: row.prompt, label: labelFor(row, 'master'), row: row };
        }
      }
      if (pool[0] && pool[0].prompt) {
        return { prompt: pool[0].prompt, label: labelFor(pool[0], 'master'), row: pool[0] };
      }
      return { prompt: '', label: 'missing', row: null };
    }

    // 1) Exact Image short code
    if (shotCode) {
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        const code = normPromptKey(row.imageShortCode);
        if (code && code === shotCode && typeOk(row)) {
          return { prompt: row.prompt, label: labelFor(row, 'shot'), row: row };
        }
      }
    }
    // 2) Exact Image Name
    if (shotName) {
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        const name = normPromptKey(row.imageName);
        if (name && name === shotName && typeOk(row)) {
          return { prompt: row.prompt, label: labelFor(row, 'shot'), row: row };
        }
      }
    }
    // 3) Alias / contains (only when Universal Image Name is specifically filled).
    // Never pick a MAIN universal row for a non-MAIN shot.
    if (shotName) {
      for (let i = 0; i < pool.length; i++) {
        const row = pool[i];
        if (isUniversalMainRow(row)) continue;
        const name = normPromptKey(row.imageName);
        if (!name || !typeOk(row)) continue;
        if (shotName === name || shotName.indexOf(name) >= 0 || name.indexOf(shotName) >= 0) {
          return { prompt: row.prompt, label: labelFor(row, 'shot'), row: row };
        }
      }
    }
    // 4) Master — blank Image Name and Image short code
    for (let i = 0; i < pool.length; i++) {
      const row = pool[i];
      if (!String(row.imageName || '').trim() && !String(row.imageShortCode || '').trim() && typeOk(row)) {
        return { prompt: row.prompt, label: labelFor(row, 'master'), row: row };
      }
    }
    if (pool[0] && pool[0].prompt) {
      return { prompt: pool[0].prompt, label: labelFor(pool[0], 'master'), row: pool[0] };
    }
    return { prompt: '', label: 'missing', row: null };
  }

  function isDimensionShot(shot) {
    if (shot == null) return false;
    if (typeof shot === 'string') return isDimensionShotName(shot);
    const name = String(shot.name || '');
    const code = String(shot.code || '');
    const family = String(shot.family || '');
    return /dimension/i.test(name) || /^M-DIM/i.test(code) || /^Size$/i.test(family) ||
      isDimensionShotName(name);
  }

  /** Prefer 3/4 when 3 dims; else Hero Front / Lifestyle. */
  function mdimBaseOptions(t, shots, dimIndex) {
    const opts = [];
    const prefer = (shot) => {
      const code = String((shot && shot.code) || '');
      const name = String((shot && shot.name) || '').toLowerCase();
      if (/3\/4|three.?quarter|3-4|34/i.test(name) || /3\/4|H-34|H-3-4/i.test(code)) return 0;
      if (/^H-FR/i.test(code) || /hero\s*front/.test(name)) return 1;
      if (/^L-CTX/i.test(code) || /lifestyle/.test(name)) return 2;
      if (/close\s*up|top/i.test(name) || /^H-/i.test(code)) return 3;
      return 5;
    };
    const ranked = shots.map((s, idx) => ({ s, idx, p: prefer(s) }))
      .filter((x) => x.idx !== dimIndex && !isDimensionShot(x.s))
      .sort((a, b) => a.p - b.p || a.idx - b.idx);
    ranked.forEach((x) => {
      const assets = shotAssets(x.idx);
      const out = assets && assets.output;
      const exp = state.workspace.exportImages && state.workspace.exportImages[x.idx];
      if (!out && !exp) return;
      const code = shotCodeOf(x.s, x.idx);
      const name = x.s.name || code;
      opts.push({
        value: 'shot:' + x.idx,
        label: code && name && code !== name ? (code + ' · ' + name) : (name || code),
        shotIndex: x.idx,
        asset: out || exp
      });
    });
    // Custom is a single hardcoded option in the M-DIM select — do not duplicate here.
    return opts;
  }

  function mdimRevokeCacheKey(key) {
    const cache = mdimWorkspaceCache();
    const hit = cache[key];
    if (!hit) return;
    if (hit.url && String(hit.url).indexOf('blob:') === 0) {
      try { URL.revokeObjectURL(hit.url); } catch (_) { /* */ }
    }
    delete cache[key];
  }

  /** Drop cached M-DIM workspace when a shot’s D is (re)generated; refresh editor only if that base is active. */
  function mdimOnShotOutputChanged(shotIndex) {
    if (!state.workspace) return;
    const key = 'shot:' + shotIndex;
    const t = taskByEan(state.workspace.ean);
    const shots = shotListFor(t);
    const isDim = isDimensionShot(shots[shotIndex]);
    const cur = String(state.workspace.mdimBaseKey || '');
    const dimSi = Math.min(state.workspaceShot, Math.max(0, shots.length - 1));
    const onDimEditor = (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') &&
      isDimensionShot(shots[dimSi]) &&
      !state.workspace.mdimShowAbcd;
    // Only the currently selected base should update the full-view editor — never jump to
    // whichever shot finished generating last.
    const watching = cur === key || (isDim && cur === '__custom__');

    const cache = mdimWorkspaceCache();
    const stale = watching ? (cache[cur] || cache[key]) : cache[key];
    mdimRevokeCacheKey(key);
    if (isDim) mdimRevokeCacheKey('__custom__');

    if (!onDimEditor || !watching) return;
    // Manual override owns the canvas — leave it alone when other Ds finish.
    if (state.workspace.mdimOverride && cur !== '__override__') return;

    const adoptKey = (cur && cur !== '__custom__') ? cur : key;
    state.workspace.mdimBaseKey = adoptKey;

    const options = mdimBaseOptions(t, shots, dimSi);
    const asset = mdimAssetForBaseKey(adoptKey, options) || shotAssets(shotIndex).output;
    if (!asset) return;
    mdimEnsureWorkspaceFromAsset(asset, asset.name, adoptKey).then(function (wsUrl) {
      if (wsUrl && window.MdimPlayground && window.MdimPlayground.setWorkspaceUrl &&
          els.workspace && els.workspace.querySelector('[data-mdim-img]')) {
        window.MdimPlayground.setWorkspaceUrl(wsUrl);
        const root = els.workspace.querySelector('[data-mdim-root]');
        mdimRefreshWarnDom(root);
        const selectEl = root && root.querySelector('[data-mdim-base]');
        if (selectEl) selectEl.value = adoptKey;
        persistCurrentReplaceDraft();
      } else {
        persistCurrentReplaceDraft();
        renderWorkspace();
      }
      if (stale && stale.url && stale.url !== wsUrl && String(stale.url).indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(stale.url); } catch (_) { /* */ }
      }
    }).catch(function () { /* next render retries */ });
  }

  function clearMdimWorkspaceState() {
    if (!state.workspace) return;
    if (state.workspace.mdimOverride) revokeAssetUrl(state.workspace.mdimOverride);
    state.workspace.mdimOverride = null;
    const cache = state.workspace.mdimWsCache || {};
    Object.keys(cache).forEach(function (k) { mdimRevokeCacheKey(k); });
    state.workspace.mdimWsCache = {};
    state.workspace.mdimWorkspaceUrl = null;
    state.workspace.mdimWorkspaceBlob = null;
    state.workspace.mdimSourceAsset = null;
    state.workspace.mdimBaseKey = '';
    state.workspace.mdimDraft = null;
    state.workspace.mdimShowAbcd = false;
    state.workspace.mdimMainMax = false;
    state.workspace.mdimDbChecked = false;
    state.workspace.mdimDbAvailable = false;
    state.workspace.mdimDbDoc = null;
  }

  function mdimPrefetchBaseOptions(options) {
    (options || []).forEach(function (o) {
      if (!o || !o.asset || !o.value) return;
      mdimEnsureWorkspaceFromAsset(o.asset, o.asset.name, o.value).catch(function () { /* quiet */ });
    });
  }

  function mdimLinearDimCount(t) {
    if (!window.MdimCore || !t) return 0;
    const packed = window.MdimCore.collectLabelsFromFields({
      productSize: t.size || '',
      productDimensions: t.dimensions || '',
      productWeightKg: t.weight || '',
      productCapacity: t.capacity || ''
    }, { includeVolume: false });
    return (packed.labels || []).filter(function (lab) {
      return !window.MdimCore.isVolumeLabel(lab) && !window.MdimCore.isWeightLabel(lab);
    }).length;
  }

  function mdimDefaultBaseKey(options, t) {
    if (!options || !options.length) return '';
    const dims = mdimLinearDimCount(t);
    if (dims >= 3) {
      const threeQ = options.find((o) => /3\/4|three.?quarter|3-4|34/i.test(o.label));
      if (threeQ) return threeQ.value;
    }
    const hero = options.find((o) => /hero\s*front|^H-FR/i.test(o.label));
    const life = options.find((o) => /lifestyle|^L-CTX/i.test(o.label));
    return (hero || life || options[0]).value;
  }

  function mdimAssetForBaseKey(key, options) {
    if (!key) return null;
    const hit = (options || []).find((o) => String(o.value) === String(key));
    return hit ? hit.asset : null;
  }

  function mdimWorkspaceCache() {
    if (!state.workspace.mdimWsCache) state.workspace.mdimWsCache = {};
    return state.workspace.mdimWsCache;
  }

  function mdimCacheKeyIsActiveWorkspace(key) {
    if (!state.workspace) return false;
    const cur = String(state.workspace.mdimBaseKey || '');
    if (cur === '__override__') return key === '__override__';
    if (cur === '__custom__') return key === '__custom__';
    return String(key) === cur;
  }

  // Prefetch fills the cache only; live preview globals update when the key is the active base.
  function mdimAdoptWorkspaceFromCacheEntry(key, entry) {
    if (!mdimCacheKeyIsActiveWorkspace(key) || !entry) return;
    state.workspace.mdimWorkspaceUrl = entry.url;
    state.workspace.mdimWorkspaceBlob = entry.blob;
    if (entry.sourceAsset) state.workspace.mdimSourceAsset = entry.sourceAsset;
    const draft = window.MdimPlayground
      ? window.MdimPlayground.ensureDraft(state.workspace, taskByEan(state.workspace.ean))
      : (state.workspace.mdimDraft || window.MdimCore.emptyDoc());
    if (entry.meta) Object.assign(draft.sourceImage || (draft.sourceImage = {}), entry.meta);
    state.workspace.mdimDraft = draft;
  }

  async function mdimEnsureWorkspaceFromAsset(asset, fileNameHint, cacheKey) {
    if (!window.MdimCore || !asset) return null;
    const key = cacheKey || fileNameHint || asset.name || 'base';
    const cache = mdimWorkspaceCache();
    if (cache[key] && cache[key].url && cache[key].blob) {
      mdimAdoptWorkspaceFromCacheEntry(key, cache[key]);
      return cache[key].url;
    }
    const url = ensureAssetDisplayUrl(asset) || ensureExportDisplayUrl(asset);
    if (!url) return null;
    const built = await window.MdimCore.buildWorkspaceBitmap(url);
    const detected = window.MdimCore.detectSourceFromFileName(
      fileNameHint || asset.name || '',
      state.workspace && state.workspace.ean
    );
    const wsUrl = URL.createObjectURL(built.blob);
    const meta = {
      kind: detected.kind,
      shotCode: detected.shotCode || '',
      shotSeq: detected.shotSeq || '',
      fileName: detected.fileName || fileNameHint || asset.name || '',
      originalWidth: built.originalWidth,
      originalHeight: built.originalHeight,
      isSquare: built.isSquare,
      needsUpscale: built.needsUpscale,
      workspaceSize: window.MdimCore.WORKSPACE_SIZE
    };
    cache[key] = { url: wsUrl, blob: built.blob, meta: meta, sourceAsset: asset };
    mdimAdoptWorkspaceFromCacheEntry(key, cache[key]);
    return cache[key].url;
  }

  function mountMdimWorkbench() {
    if (!window.MdimPlayground || !els.workspace || !state.workspace) return;
    const root = els.workspace.querySelector('[data-mdim-root]');
    if (!root) return;
    const t = taskByEan(state.workspace.ean);
    const shots = shotListFor(t);
    const i = Math.min(state.workspaceShot, Math.max(0, shots.length - 1));
    const options = mdimBaseOptions(t, shots, i);
    // Re-sync active base from cache so background prefetch cannot leave a stale preview URL.
    const activeKey = state.workspace.mdimBaseKey;
    const activeHit = activeKey && mdimWorkspaceCache()[activeKey];
    if (activeHit) mdimAdoptWorkspaceFromCacheEntry(activeKey, activeHit);
    window.MdimPlayground.unmount();
    window.MdimPlayground.mount(root, {
      workspace: state.workspace,
      task: t,
      workspaceUrl: state.workspace.mdimWorkspaceUrl || null,
      host: {
        persist: function () { persistCurrentReplaceDraft(); },
        rerender: function () { renderWorkspace(); },
        onBaseChange: function (key) {
          state.workspace.mdimBaseKey = key;
          // Custom always opens A·B·C·D — never auto-load a previous D into the editor.
          if (key === '__custom__') {
            state.workspace.mdimShowAbcd = true;
            persistCurrentReplaceDraft();
            renderWorkspace();
            return;
          }
          // Switching to a generated shot clears a local drop override.
          if (state.workspace.mdimOverride) {
            revokeAssetUrl(state.workspace.mdimOverride);
            state.workspace.mdimOverride = null;
            mdimRevokeCacheKey('__override__');
          }
          const asset = mdimAssetForBaseKey(key, options);
          if (!asset) {
            showToast('No image for that base yet.', false);
            return;
          }
          const selectEl = root.querySelector('[data-mdim-base]');
          if (selectEl) selectEl.disabled = true;
          const cache = mdimWorkspaceCache();
          const cached = cache[key] && cache[key].url;
          const applyWs = function (wsUrl) {
            if (selectEl) selectEl.disabled = false;
            persistCurrentReplaceDraft();
            if (wsUrl && window.MdimPlayground && window.MdimPlayground.setWorkspaceUrl) {
              window.MdimPlayground.setWorkspaceUrl(wsUrl);
              mdimRefreshWarnDom(root);
              return;
            }
            renderWorkspace();
          };
          if (cached) {
            state.workspace.mdimWorkspaceUrl = cache[key].url;
            state.workspace.mdimWorkspaceBlob = cache[key].blob;
            state.workspace.mdimSourceAsset = cache[key].sourceAsset || asset;
            const draft = window.MdimPlayground
              ? window.MdimPlayground.ensureDraft(state.workspace, t)
              : (state.workspace.mdimDraft || window.MdimCore.emptyDoc());
            if (cache[key].meta) Object.assign(draft.sourceImage || (draft.sourceImage = {}), cache[key].meta);
            state.workspace.mdimDraft = draft;
            applyWs(cache[key].url);
            return;
          }
          mdimEnsureWorkspaceFromAsset(asset, asset.name, key).then(applyWs).catch(function (err) {
            if (selectEl) selectEl.disabled = false;
            showToast('M-DIM base failed: ' + (err && err.message ? err.message : err), false);
          });
        },
        toggleMainMax: function () {
          state.workspace.mdimMainMax = !state.workspace.mdimMainMax;
          // Large editor is for Product Dimension itself — never open Detail & Compare.
          if (state.workspace.mdimMainMax) {
            state.workspace.panelOpen = false;
            state.workspace.panelMax = false;
          }
          persistCurrentReplaceDraft();
          renderWorkspace();
        },
        clearOverride: function () {
          clearMdimBaseOverride();
        },
        rebuildFromTracker: function () {
          rebuildMdimFromShootTracker(t);
          persistCurrentReplaceDraft();
          renderWorkspace();
          showToast('Labels rebuilt from Shoot Tracker.', false);
        },
        loadFromDb: function () {
          if (!state.workspace.mdimDbDoc && !state.workspace.mdimDbAvailable) {
            showToast('No Prompt DB dimension for this EAN.', false);
            return;
          }
          const applyDoc = function (doc) {
            if (!doc) {
              showToast('No Prompt DB dimension for this EAN.', false);
              return;
            }
            applyMdimDocToWorkspace(doc, t);
            persistCurrentReplaceDraft();
            renderWorkspace();
            showToast('Loaded dimension from Prompt DB.', false);
          };
          if (state.workspace.mdimDbDoc) {
            applyDoc(state.workspace.mdimDbDoc);
            return;
          }
          fetchMdimJsonFromPromptDb(state.workspace.ean).then(function (doc) {
            state.workspace.mdimDbAvailable = !!doc;
            state.workspace.mdimDbDoc = doc;
            applyDoc(doc);
          }).catch(function (err) {
            showToast('Could not load from Prompt DB: ' + ((err && err.message) || err), false, { error: true });
          });
        },
        applyExport: function () {
          applyMdimToExport(i).catch(function (err) {
            showToast('M-DIM export failed: ' + (err && err.message ? err.message : err), false);
          });
        }
      }
    });
    // Warm cache for other bases so dropdown switches stay instant.
    mdimPrefetchBaseOptions(options);
  }

  function mdimRefreshWarnDom(root) {
    if (!root) return;
    let warnHost = root.querySelector('.mdim-warns');
    const src = (state.workspace.mdimDraft && state.workspace.mdimDraft.sourceImage) || {};
    const msgs = [];
    if (src.originalWidth && !src.isSquare) {
      msgs.push('Source ' + src.originalWidth + '×' + src.originalHeight + ' is not 1:1 — fitted into 3000×3000 with white margins.');
    }
    if (src.needsUpscale) {
                  msgs.push('Source below 3000px. Editor uses a fitted 3000 preview. Apply burns at native size; Firefly upscale runs with Upscale & generate images.');
    }
    if (!warnHost && msgs.length) {
      const tb = root.querySelector('.mdim-toolbar');
      warnHost = document.createElement('div');
      warnHost.className = 'mdim-warns';
      if (tb && tb.parentNode) tb.parentNode.insertBefore(warnHost, tb.nextSibling);
    }
    if (warnHost) {
      warnHost.innerHTML = msgs.map(function (m) {
        return '<div class="mdim-warn">' + esc(m) + '</div>';
      }).join('');
      warnHost.hidden = !msgs.length;
    }
  }

  async function applyMdimOverrideAsset(loaded, toastName) {
    if (!state.workspace || !loaded) return;
    if (state.workspace.mdimOverride) revokeAssetUrl(state.workspace.mdimOverride);
    mdimRevokeCacheKey('__override__');
    state.workspace.mdimOverride = loaded;
    state.workspace.mdimBaseKey = '__override__';
    state.workspace.mdimShowAbcd = false;
    state.workspace.mdimMainMax = !!state.workspace.mdimMainMax;
    const wsUrl = await mdimEnsureWorkspaceFromAsset(loaded, loaded.name, '__override__');
    persistCurrentReplaceDraft();
    renderWorkspace();
    if (wsUrl && window.MdimPlayground && window.MdimPlayground.setWorkspaceUrl) {
      requestAnimationFrame(function () {
        window.MdimPlayground.setWorkspaceUrl(wsUrl);
      });
    }
    showToast('M-DIM base override set · ' + esc(toastName || loaded.name || 'image'), false);
  }

  async function setMdimBaseOverrideFromFile(file) {
    if (!state.workspace || !window.MdimCore) return;
    if (!isAcceptedImageFile(file)) {
      showToast('Use JPG or PNG images only.', false);
      return;
    }
    try {
      const loaded = await readLocalImageFile(file);
      await applyMdimOverrideAsset(loaded, loaded.name);
    } catch (err) {
      showToast(err.message || 'Could not set M-DIM override.', false, { error: true });
    }
  }

  /** Use a Drive prior rail image as M-DIM override (stay on Product Dimension). */
  async function setMdimOverrideFromDriveIndex(imgIdx) {
    if (!state.workspace) return;
    const task = taskByEan(state.workspace.ean);
    const prior = resolveWorkspaceMatch(task).selected;
    const imgs = priorDriveImages(prior);
    const img = imgs[imgIdx];
    if (!img || !img.id) {
      showToast('No Drive image for that rail item.', false);
      return;
    }
    try {
      showToast('Loading Drive image for M-DIM…', false);
      const asset = await fetchDriveFileAsset(img.id);
      await applyMdimOverrideAsset(asset, img.name || asset.name);
    } catch (err) {
      showToast('Could not load Drive image: ' + ((err && err.message) || err), false, { error: true });
    }
  }

  /** Use another shot’s D (or its Drive prior) as M-DIM override. */
  async function setMdimOverrideFromShotIndex(shotIndex) {
    if (!state.workspace) return;
    const task = taskByEan(state.workspace.ean);
    const shots = shotListFor(task);
    const out = shotAssets(shotIndex).output;
    if (out && (out.blob || out.file || out.url)) {
      try {
        await applyMdimOverrideAsset(out, out.name);
      } catch (err) {
        showToast('Could not use shot output: ' + ((err && err.message) || err), false, { error: true });
      }
      return;
    }
    const prior = resolveWorkspaceMatch(task).selected;
    const map = priorTargetCodeMap(prior, shots);
    const mapped = (map.mapped || []).find((m) => m.shotIdx === shotIndex);
    if (mapped && mapped.imgIdx != null) {
      await setMdimOverrideFromDriveIndex(mapped.imgIdx);
      return;
    }
    showToast('That rail item has no generated D or Drive prior to use as override.', false);
  }

  function clearMdimBaseOverride() {
    if (!state.workspace) return;
    if (state.workspace.mdimOverride) revokeAssetUrl(state.workspace.mdimOverride);
    state.workspace.mdimOverride = null;
    mdimRevokeCacheKey('__override__');
    state.workspace.mdimWorkspaceUrl = null;
    state.workspace.mdimWorkspaceBlob = null;
    state.workspace.mdimSourceAsset = null;
    const t = taskByEan(state.workspace.ean);
    const shots = shotListFor(t);
    const si = Math.min(state.workspaceShot, Math.max(0, shots.length - 1));
    const options = mdimBaseOptions(t, shots, si);
    state.workspace.mdimBaseKey = mdimDefaultBaseKey(options, t);
    const asset = mdimAssetForBaseKey(state.workspace.mdimBaseKey, options);
    persistCurrentReplaceDraft();
    if (asset) {
      mdimEnsureWorkspaceFromAsset(asset, asset.name, state.workspace.mdimBaseKey).then(function () {
        renderWorkspace();
      }).catch(function () { renderWorkspace(); });
    } else {
      renderWorkspace();
    }
    showToast('M-DIM override cleared.', false);
  }

  function mdimWorkbenchSectionHtml(t, shot, shotIndex) {
    if (!window.MdimPlayground || !window.MdimCore) {
      return '<div class="mdim-workbench"><p class="muted">M-DIM modules failed to load (mdim-core.js / mdim-playground.js).</p></div>';
    }
    const options = mdimBaseOptions(t, shotListFor(t), shotIndex);
    if (!state.workspace.mdimBaseKey) {
      state.workspace.mdimBaseKey = mdimDefaultBaseKey(options, t);
    }
    if (state.workspace.mdimBaseKey === '__override__' && !state.workspace.mdimOverride) {
      state.workspace.mdimBaseKey = mdimDefaultBaseKey(options, t) || '';
    }
    window.MdimPlayground.ensureDraft(state.workspace, t);
    return window.MdimPlayground.mainHtml({
      workspace: state.workspace,
      task: t,
      baseOptions: options,
      selectedBase: state.workspace.mdimBaseKey || '',
      hasWorkspace: !!state.workspace.mdimWorkspaceUrl,
      hasOverride: !!state.workspace.mdimOverride,
      mainMax: !!state.workspace.mdimMainMax,
      hasDb: !!state.workspace.mdimDbAvailable
    });
  }

  async function applyMdimToExport(shotIndex) {
    if (!window.MdimCore || !state.workspace) return;
    const draft = state.workspace.mdimDraft;
    if (!draft) {
      showToast('Load a base image in M-DIM first.', false);
      return;
    }
    const options = mdimBaseOptions(taskByEan(state.workspace.ean), shotListFor(taskByEan(state.workspace.ean)), shotIndex);
    let sourceAsset = state.workspace.mdimOverride ||
      state.workspace.mdimSourceAsset ||
      mdimAssetForBaseKey(state.workspace.mdimBaseKey, options) ||
      null;
    let workBlob = (sourceAsset && (sourceAsset.blob || sourceAsset.file)) || state.workspace.mdimWorkspaceBlob;
    if (!workBlob) {
      showToast('Load a base image in M-DIM first.', false);
      return;
    }

    const srcMeta = draft.sourceImage || {};
    // No Firefly here — burn at native letterbox size; Upscale & generate handles AI upscale like other shots.
    const ow = Number(srcMeta.originalWidth) || 0;
    const oh = Number(srcMeta.originalHeight) || 0;
    const nativeSide = Math.max(ow, oh, 1);

    const tmpUrl = URL.createObjectURL(workBlob);
    let workspaceImg;
    let burnUrl = '';
    try {
      const built = await window.MdimCore.buildWorkspaceBitmap(tmpUrl, {
        size: nativeSide,
        mime: 'image/png'
      });
      burnUrl = URL.createObjectURL(built.blob);
      workspaceImg = await window.MdimCore.loadHtmlImage(burnUrl);
      draft.sourceImage = Object.assign(draft.sourceImage || {}, {
        originalWidth: built.originalWidth,
        originalHeight: built.originalHeight,
        isSquare: built.isSquare,
        needsUpscale: built.needsUpscale,
        workspaceSize: built.workspaceSize
      });
    } finally {
      try { URL.revokeObjectURL(tmpUrl); } catch (_) { /* */ }
    }

    const outBlob = await window.MdimCore.exportMergedPng(workspaceImg, draft.arrows, draft.style);
    if (burnUrl) {
      try { URL.revokeObjectURL(burnUrl); } catch (_) { /* */ }
    }
    if (!outBlob) throw new Error('PNG encode failed');
    const ean = state.workspace.ean || 'EAN';
    const shots = shotListFor(taskByEan(ean));
    const shot = shots[shotIndex] || {};
    const seq = String(shot.seq != null ? shot.seq : shotIndex).replace(/\D/g, '') || String(shotIndex).padStart(2, '0');
    const code = shot.code || 'M-DIM';
    const file = new File([outBlob], ean + '_' + String(seq).padStart(2, '0') + '_' + code + '.png', { type: 'image/png' });
    await addExportImageToShot(shotIndex, file);

    // Keep Required shots rail in sync — export row alone does not update D / rail thumbs.
    const exportEntry = state.workspace.exportImages && state.workspace.exportImages[String(shotIndex)];
    const assets = shotAssets(shotIndex);
    revokeAssetUrl(assets.output);
    assets.output = {
      blob: (exportEntry && exportEntry.blob) || outBlob,
      file: (exportEntry && exportEntry.file) || file,
      name: (exportEntry && exportEntry.name) || file.name,
      w: (exportEntry && (exportEntry.w || 0)) || 0,
      h: (exportEntry && (exportEntry.h || 0)) || 0,
      fromMdim: true,
      approved: false
    };
    ensureAssetDisplayUrl(assets.output);
    if (!state.workspace.outputs) state.workspace.outputs = {};
    state.workspace.outputs[shotIndex] = true;

    // Apply = approval for M-DIM (no star rating). Persist JSON to Prompt DB by EAN (upsert).
    try {
      await saveMdimJsonToPromptDb(ean, draft);
      showToast('M-DIM applied to export row. Prompt DB updated. Upscale runs with Upscale & generate images if needed.', false);
    } catch (err) {
      showToast(
        'M-DIM applied to export, but JSON was not saved: ' + esc((err && err.message) || err),
        false,
        { error: true }
      );
    }
    renderWorkspace();
  }

  function mdimJsonPayload(ean, draft) {
    const d = draft || {};
    const style = Object.assign({}, (window.MdimCore && window.MdimCore.DEFAULT_STYLE) || {}, d.style || {}, { textOffset: 50 });
    return {
      version: d.version || 1,
      layoutVersion: d.layoutVersion || null,
      ean: String(ean || d.ean || ''),
      code: 'M-DIM',
      sourceFields: d.sourceFields || {},
      sourceImage: d.sourceImage || {},
      omittedVolume: d.omittedVolume || [],
      arrows: d.arrows || [],
      style: style
    };
  }

  async function saveMdimJsonToPromptDb(ean, draft) {
    if (!PROMPT_DB_URL) throw new Error('PROMPT_DB_URL is not set.');
    const id = String(ean || '').replace(/\D/g, '');
    if (!id) throw new Error('EAN is required to save M-DIM JSON.');
    const author = String(state.author || '').trim();
    if (!author) throw new Error('Set your author name before Apply to export (needed for Prompt DB).');
    const ver = await pingPromptDbVersion();
    if (ver < 15) {
      throw new Error(
        'Prompt DB web app is outdated (v' + (ver || '?') + ', need v15+ for M-DIM). ' +
        'Copy dashboard/apps-script-prompt-db/Code.gs → Deploy → New version.'
      );
    }
    const json = JSON.stringify(mdimJsonPayload(id, draft));
    const uploadId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    const chunks = splitPromptForJsonp(json, 1400);
    for (let i = 0; i < chunks.length; i++) {
      await jsonp(
        [
          'action=promptChunk',
          'uploadId=' + encodeURIComponent(uploadId),
          'i=' + i,
          'n=' + chunks.length,
          'data=' + encodeURIComponent(chunks[i])
        ].join('&'),
        45000,
        PROMPT_DB_URL
      );
    }
    const data = await jsonp(
      [
        'action=mdimSave',
        'ean=' + encodeURIComponent(id),
        'author=' + encodeURIComponent(author),
        'appVersion=' + encodeURIComponent(APP_VERSION),
        'uploadId=' + encodeURIComponent(uploadId)
      ].join('&'),
      60000,
      PROMPT_DB_URL
    );
    state.workspace.mdimDbAvailable = true;
    state.workspace.mdimDbDoc = mdimJsonPayload(id, draft);
    return data;
  }

  async function fetchMdimJsonFromPromptDb(ean) {
    if (!PROMPT_DB_URL) return null;
    const id = String(ean || '').replace(/\D/g, '');
    if (!id) return null;
    const ver = await pingPromptDbVersion();
    if (ver < 15) return null;
    const data = await jsonp(
      'action=mdimGet&ean=' + encodeURIComponent(id),
      45000,
      PROMPT_DB_URL
    );
    if (!(data && data.found && data.json)) return null;
    try {
      const doc = JSON.parse(String(data.json));
      if (!doc || typeof doc !== 'object') return null;
      return doc;
    } catch (err) {
      return null;
    }
  }

  function applyMdimDocToWorkspace(doc, t) {
    if (!state.workspace || !window.MdimCore || !doc) return;
    const Core = window.MdimCore;
    const base = Core.emptyDoc();
    const layoutVer = (window.MdimPlayground && window.MdimPlayground.LAYOUT_VERSION) || 3;
    state.workspace.mdimDraft = Object.assign(base, {
      version: doc.version || 1,
      ean: String((t && t.ean) || doc.ean || state.workspace.ean || ''),
      code: 'M-DIM',
      sourceFields: doc.sourceFields || {
        productSize: String((t && t.size) || ''),
        productDimensions: String((t && t.dimensions) || ''),
        productWeightKg: String((t && t.weight) || ''),
        productCapacity: String((t && t.capacity) || '')
      },
      sourceImage: Object.assign({}, base.sourceImage, doc.sourceImage || {}),
      omittedVolume: Array.isArray(doc.omittedVolume) ? doc.omittedVolume.slice() : [],
      arrows: Array.isArray(doc.arrows) ? doc.arrows.map(function (a) { return Object.assign({}, a); }) : [],
      style: Object.assign({}, Core.DEFAULT_STYLE, doc.style || {}, { textOffset: 50 }),
      layoutVersion: layoutVer
    });
    state.workspace.mdimDbDoc = doc;
    state.workspace.mdimDbAvailable = true;
  }

  function rebuildMdimFromShootTracker(t) {
    if (!state.workspace || !window.MdimCore) return;
    const Core = window.MdimCore;
    const doc = Core.emptyDoc();
    doc.ean = String((t && t.ean) || state.workspace.ean || '');
    doc.sourceFields = {
      productSize: String((t && t.size) || ''),
      productDimensions: String((t && t.dimensions) || ''),
      productWeightKg: String((t && t.weight) || ''),
      productCapacity: String((t && t.capacity) || '')
    };
    const packed = Core.collectLabelsFromFields(doc.sourceFields, { includeVolume: false });
    doc.omittedVolume = packed.omittedVolume.slice();
    doc.arrows = Core.buildArrowsFromLabels(packed.labels, [], false);
    doc.layoutVersion = (window.MdimPlayground && window.MdimPlayground.LAYOUT_VERSION) || 3;
    if (state.workspace.mdimDraft && state.workspace.mdimDraft.sourceImage) {
      doc.sourceImage = Object.assign({}, doc.sourceImage, state.workspace.mdimDraft.sourceImage);
    }
    state.workspace.mdimDraft = doc;
  }

  /** Prefer Prompt DB M-DIM JSON when present; else keep local / Shoot Tracker defaults. */
  async function hydrateMdimDraftForEan(forceDb) {
    if (!state.workspace ||
        (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
    const ean = state.workspace.ean;
    const t = taskByEan(ean);
    if (state.workspace.mdimDbChecked && !forceDb) return;
    state.workspace.mdimDbChecked = true;
    try {
      const doc = await fetchMdimJsonFromPromptDb(ean);
      state.workspace.mdimDbAvailable = !!doc;
      state.workspace.mdimDbDoc = doc || null;
      if (doc) {
        // DB wins on EAN load (and on forced reload).
        applyMdimDocToWorkspace(doc, t);
      } else if (!state.workspace.mdimDraft && window.MdimPlayground) {
        window.MdimPlayground.ensureDraft(state.workspace, t);
      }
    } catch (err) {
      state.workspace.mdimDbAvailable = false;
      if (!state.workspace.mdimDraft && window.MdimPlayground) {
        window.MdimPlayground.ensureDraft(state.workspace, taskByEan(ean));
      }
    }
  }

  function mdimDimDiffHeadHtml(t, prior) {
    const note = dimDiffSummary(t, prior);
    if (!note) return '';
    // Prefer Size values; otherwise first differ bit — strip field name (Size/Dimensions/Volume).
    const bits = note.split(' · ');
    const sizeBit = bits.find(function (b) { return /^Size:/i.test(b); }) || bits[0] || '';
    const values = String(sizeBit).replace(/^(Size|Dimensions|Volume):\s*/i, '').trim();
    return '<span class="wr-dim-head" title="' + esc(note) + '">' +
      '<span class="wr-dim-head-label">Dimension differ:</span>' +
      (values ? '<span class="wr-dim-head-size">' + esc(values) + '</span>' : '') +
    '</span>';
  }

  function isMainShot(shot) {
    const name = String((shot && shot.name) || '');
    const code = String((shot && shot.code) || '');
    const note = String((shot && shot.note) || '');
    return code === 'MAIN' || /white background|marketplace\s*main/i.test(name) || /marketplace main/i.test(note);
  }

  function cleanWhatToShoot(shot, shots) {
    if (!shot) return '';
    if (isDimensionShot(shot)) return '';
    // MAIN: do not name Hero Front / seq 01 in text — that image is sent as INPUT IMAGE 1.
    // Framing comes from the Universal MAIN prompt + the attached angle-source image.
    if (isMainShot(shot)) return '';

    let text = String(shot.whatToShoot || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';

    text = text
      .replace(/\bAmazon and Flipkart[^.]*\./gi, '')
      .replace(/\bThis file does NOT appear[^.]*\./gi, '')
      .replace(/\bThe same angle as the Hero Front(?:\s*-\s*Set)? below[^.]*\./gi, '')
      .replace(/\bonly shoot this if the product actually has it\.?/gi, '')
      .replace(/,?\s*so shoppers see what matches\.?/gi, '')
      .replace(/\bShow all the pieces together\.?/gi, '')
      .replace(/\bShow one piece from the set on its own\.?/gi, '')
      .replace(/,?\s*plain background\.?/gi, '')
      .replace(/,?\s*on pure white with no styling and no background objects\.?/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/^[,.\s]+|[,.\s]+$/g, '')
      .trim();

    const isLifestyle = /lifestyle/i.test(shot.family || '') || /lifestyle/i.test(shot.name || '');
    if (isLifestyle) {
      text = text.replace(/^The product styled in a real room or in use\.?\s*/i, '').trim();
      if (!text) return '';
    }

    // Re-join stripped mid-sentence leftovers into readable sentences.
    text = text.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim();
    if (text && !/[.!?]$/.test(text)) text += '.';
    // Prefer ". " between two clauses that lost their join after plain-background strip
    text = text.replace(/([a-z])\s+(Show\b)/g, '$1. $2');
    return text;
  }

  function cameraHintForShot(shot, cleanedWhat) {
    if (!shot || isDimensionShot(shot)) return '';
    const name = String(shot.name || '');
    const family = String(shot.family || '');
    const cleaned = String(cleanedWhat || '').toLowerCase();
    const hints = [];

    if (isMainShot(shot)) {
      // MAIN cue already in cleaned What to Shoot
      return '';
    }
    if (/lifestyle/i.test(family) || /lifestyle/i.test(name)) {
      hints.push('keep the prior lifestyle scene; replace only the product; do not change background, props, or lighting');
    }
    if (/close\s*up|close-up/i.test(family) || /close\s*up/i.test(name)) {
      if (!/tight crop/i.test(cleaned)) hints.push('keep the prior close-up crop; do not zoom out to a full hero');
      else hints.push('keep the prior close-up crop; do not zoom out to a full hero');
    } else if (/hero\s*front/i.test(name) && !/lid|open|lit|set|individual/i.test(name)) {
      hints.push('keep the prior hero framing and zoom; do not reframe as a close-up or lifestyle');
    }
    if (/lid\s*open|product open|opened/i.test(name) && !/lid open|opened/i.test(cleaned)) {
      hints.push('match the prior open state and framing');
    }
    if (/candle\s*lit|\blit\b/i.test(name) && !/candle lit|glow/i.test(cleaned)) {
      hints.push('keep the prior lit framing; glow must belong to the new product');
    }
    if (/flat\s*lay/i.test(name) && !/directly above|flat/i.test(cleaned)) {
      hints.push('keep the prior top-down flat-lay framing');
    }
    if (!hints.length) return '';
    return 'Camera: ' + hints[0] + '.';
  }

  function isCloseUpShot(shot) {
    if (!shot) return false;
    const blob = [
      String(shot.name || ''),
      String(shot.code || ''),
      String(shot.family || ''),
      String(shot.whatToShoot || '')
    ].join(' ');
    return /close[\s\-]*up/i.test(blob);
  }

  function productInsertSentence(t, shot) {
    if (!t) return '';
    // Close-up shots: product-insert metadata often fights the crop / framing.
    if (isCloseUpShot(shot)) return '';
    const parts = [];
    const name = String(t.productName || t.title || '').trim();
    if (name) parts.push(name);
    const dept = String(t.department || '').trim();
    if (dept) parts.push(dept + ' department');
    const cat = String(t.sheetCategory || t.category || '').trim();
    if (cat) parts.push(cat + ' category');
    const sub = String(t.subCategory || '').trim();
    if (sub) parts.push(sub + ' sub-category');
    if (t.setKind === 'set' && t.setLabel) {
      parts.push('sold as a ' + String(t.setLabel).replace(/^sold as a\s+/i, ''));
    }
    const color = String(t.color || '').trim();
    if (color) parts.push(color + ' colour/material');

    let sentence = parts.length ? ('Product to insert: ' + parts.join(', ') + '.') : '';
    const detail = String(t.detailDescription || '').trim();
    if (detail) sentence += (sentence ? ' ' : '') + 'Detail: ' + detail + (/[.!?]$/.test(detail) ? '' : '.');
    const size = String(t.size || '').trim();
    if (size && (!detail || detail.toLowerCase().indexOf(size.toLowerCase()) < 0)) {
      sentence += (sentence ? ' ' : '') + 'Size: ' + size + (/[.!?]$/.test(size) ? '' : '.');
    }
    return sentence.trim();
  }

  function priorLookSentence(priorTask) {
    if (!priorTask) return '';
    const bits = [];
    const name = String(priorTask.productName || priorTask.title || '').trim();
    if (name) bits.push(name);
    const color = String(priorTask.color || '').trim();
    if (color) bits.push(color);
    const detail = String(priorTask.detailDescription || '').trim();
    if (detail) {
      const short = detail.length > 120 ? detail.slice(0, 117) + '…' : detail;
      bits.push(short);
    }
    if (!bits.length) return '';
    return 'Prior product look: ' + bits.join(', ') + '.';
  }

  function ensureFullRemoveRule(universalText) {
    const text = String(universalText || '').trim();
    if (!text) return text;
    if (/fully remove the prior product/i.test(text) || /do not leave remnants/i.test(text)) return text;
    return text + '\n\nFully remove the prior product silhouette from INPUT IMAGE 1 and insert the new product. Do not leave remnants or blend products.';
  }

  /** Build product-reference bullets for only the B images that are actually present. */
  function productReferenceBlockForCount(productCount, productStartNum) {
    const count = Math.max(0, Math.min(4, Number(productCount) || 0));
    const start = Math.max(2, Number(productStartNum) || 2);
    const ordinals = ['first', 'second', 'third', 'fourth'];
    if (count <= 0) {
      return (
        '**INPUT IMAGE ' + start + ' — `reference_image_url_' + start + '` — PRODUCT REFERENCE**\n\n' +
        'Add at least one product reference image.'
      );
    }
    if (count === 1) {
      return (
        '**INPUT IMAGE ' + start + ' — `reference_image_url_' + start + '` — PRODUCT REFERENCE**\n\n' +
        'This product photo is INPUT IMAGE ' + start + ' — `reference_image_url_' + start + '`.'
      );
    }
    const nums = [];
    const bullets = [];
    for (let i = 0; i < count; i++) {
      const n = start + i;
      nums.push(String(n));
      bullets.push(
        '- INPUT IMAGE ' + n + ' — `reference_image_url_' + n + '` — ' +
          ordinals[i] + ' product reference'
      );
    }
    const numList = nums.length === 2
      ? (nums[0] + ' and ' + nums[1])
      : (nums.slice(0, -1).join(', ') + ', and ' + nums[nums.length - 1]);
    return (
      '**INPUT IMAGES ' + numList + ' — `reference_image_url_' + start +
        '` onward — PRODUCT REFERENCES**\n\n' +
      'Each product photo is its own input image, numbered in order:\n' +
      bullets.join('\n')
    );
  }

  /**
   * Adapt Universal Product-replacement Final successful wording:
   * - modernize old second_reference_url keys
   * - list only product refs that are actually present (no “if provided”)
   * - drop the generic “Together, these product reference images…” paragraph
   */
  function clarifyReplaceInputImageWording(universalText, opts) {
    const options = opts || {};
    const productCount = options.productCount != null ? Number(options.productCount) : 1;
    const productStartNum = options.productStartNum != null ? Number(options.productStartNum) : 2;
    let text = String(universalText || '');
    if (!text) return text;

    text = text.replace(
      /\*\*INPUT IMAGE 1\s*[—\-]\s*`reference_image_url`\*\*/gi,
      '**INPUT IMAGE 1 — `reference_image_url_1` — PRIOR / MASTER**'
    );
    text = text.replace(/`second_reference_url`/gi, '`reference_image_url_2`');
    text = text.replace(/`third_reference_url`/gi, '`reference_image_url_3`');
    text = text.replace(/`fourth_reference_url`/gi, '`reference_image_url_4`');

    const productBlock = productReferenceBlockForCount(productCount, productStartNum);

    // Replace the whole product-references section through ### INSTRUCTIONS (or next heading).
    const productSectionRe =
      /\*\*INPUT IMAGE(?:S)?\s+2[^*\n]*\*\*[\s\S]*?(?=\n###\s|\n##\s|\n#\s[A-Z]|$)/i;
    if (productSectionRe.test(text)) {
      text = text.replace(productSectionRe, productBlock + '\n\n');
    } else {
      // Fallback: old 2+ heading only.
      text = text.replace(
        /\*\*INPUT IMAGE 2\+\s*[—\-]\s*`[^`]+`\*\*[^\n]*/i,
        productBlock
      );
    }

    // Safety: strip leftover Together / if-provided wording if DB variant differed.
    text = text.replace(
      /\n*Together, these product reference images define the complete and exclusive identity and appearance of the replacement product\.\s*Use all of them that are supplied\.\n*/gi,
      '\n'
    );
    text = text.replace(
      /^[ \t]*-[ \t]*INPUT IMAGE\s+\d+[^\n]*\(if provided\)[^\n]*\n?/gim,
      ''
    );

    // Instruction line: name only the product images that exist.
    const count = Math.max(0, Math.min(4, Number(productCount) || 0));
    const start = Math.max(2, Number(productStartNum) || 2);
    let fromLabel = 'INPUT IMAGE ' + start;
    if (count > 1) {
      const nums = [];
      for (let i = 0; i < count; i++) nums.push(String(start + i));
      fromLabel = 'INPUT IMAGES ' + (nums.length === 2
        ? (nums[0] + ' and ' + nums[1])
        : (nums.slice(0, -1).join(', ') + ', and ' + nums[nums.length - 1]));
    }
    text = text.replace(
      /from INPUT IMAGES?\s+2(?:\s*,\s*3(?:\s*,\s*4)?)?(?:\s*…|\s*\.\.\.)?(?:\s*\(whichever product references are provided\))?/gi,
      'from ' + fromLabel
    );
    text = text.replace(/INPUT IMAGE 2\+/g, fromLabel);

    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  function compileReplacePrompt(t, shot, priorMatch, opts) {
    const options = opts || {};
    const productTypeName = (state.workspace && state.workspace.productTypeName) || options.productTypeName || '';
    const shots = options.shots || (t ? shotListFor(t) : []);
    const shotIndex = options.shotIndex != null
      ? Number(options.shotIndex)
      : (shots.indexOf(shot) >= 0 ? shots.indexOf(shot) : (state.workspaceShot || 0));
    const resolved = resolveUniversalPrompt(shot, productTypeName);
    const bCount = Math.min(4, ((shotAssets(shotIndex).inputs || []).length) || 0);
    // Keep DB Final successful body almost intact — adapt product-ref list to images present.
    const base = clarifyReplaceInputImageWording(ensureFullRemoveRule(resolved.prompt), {
      productCount: Math.max(1, bCount),
      productStartNum: 2
    });
    const productLine = productInsertSentence(t, shot);
    const cleaned = cleanWhatToShoot(shot, shots);
    const camera = cameraHintForShot(shot, cleaned);
    const family = String((shot && shot.family) || '').trim();
    const shotName = String((shot && shot.name) || '').trim() || 'this shot';

    let target = 'Target ' + shotName;
    if (family) target += ' — ' + family;
    target += '.';
    if (cleaned) target += ' ' + cleaned;
    if (camera && cleaned.toLowerCase().indexOf(camera.replace(/^Camera:\s*/i, '').slice(0, 24).toLowerCase()) < 0) {
      target += (/\.$/.test(target.trim()) ? ' ' : '. ') + camera;
    }

    const priorTask = priorMatch ? (taskByEan(priorMatch.ean) || priorMatch) : null;
    const priorLook = priorLookSentence(priorTask);

    const lines = [];
    if (base) lines.push(base);
    if (productLine) lines.push('', productLine);
    if (target) lines.push('', target);
    if (priorLook) {
      lines.push('');
      lines.push('INPUT IMAGE 1 prior look: ' + priorLook.replace(/^Prior product look:\s*/i, ''));
    }

    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      text: text,
      // MAIN always surfaces as MAIN so authors can confirm the PDP Universal row.
      universalLabel: isMainShot(shot)
        ? (resolved.label && /main/i.test(resolved.label) ? resolved.label : 'MAIN')
        : (resolved.label || 'master'),
      universalRow: resolved.row || null,
      cleanedWhatToShoot: cleaned
    };
  }

  function defaultReplacePrompt(t, shot, prior) {
    return compileReplacePrompt(t, shot, prior, { shotIndex: state.workspaceShot || 0 }).text;
  }

  function normalizePromptCompare(s) {
    // Normalize line endings / trailing spaces only — keep real wording differences.
    return String(s || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .trim();
  }

  function rememberPromptBaseline(shotIndex, text) {
    if (!state.workspace) return;
    if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
    state.workspace.promptBaselines[shotIndex] = String(text || '');
  }

  function isPromptManualEdit(shotIndex) {
    if (!state.workspace || !state.workspace.promptManualEdit) return false;
    const idx = shotIndex != null ? shotIndex : (state.workspaceShot || 0);
    return !!state.workspace.promptManualEdit[idx];
  }

  function setPromptManualEdit(shotIndex, on) {
    if (!state.workspace) return;
    if (!state.workspace.promptManualEdit) state.workspace.promptManualEdit = {};
    const idx = shotIndex != null ? shotIndex : (state.workspaceShot || 0);
    if (on) state.workspace.promptManualEdit[idx] = true;
    else delete state.workspace.promptManualEdit[idx];
  }

  function shotRating(shotIndex) {
    if (!state.workspace || !state.workspace.ratings) return 0;
    const v = state.workspace.ratings[String(shotIndex)];
    return v != null ? (Number(v) || 0) : 0;
  }

  function setShotRating(shotIndex, stars) {
    if (!state.workspace) return;
    if (!state.workspace.ratings) state.workspace.ratings = {};
    const key = String(shotIndex);
    const n = Number(stars) || 0;
    if (n <= 0) delete state.workspace.ratings[key];
    else state.workspace.ratings[key] = n;
  }

  function clearShotRating(shotIndex) {
    if (!state.workspace) return;
    if (state.workspace.ratings) delete state.workspace.ratings[String(shotIndex)];
    if (state.workspace.approved) delete state.workspace.approved[shotIndex];
    if (state.workspace.rejected) delete state.workspace.rejected[shotIndex];
  }

  function liveCompiledPromptText(t, shot, prior) {
    const idx = state.workspaceShot || 0;
    if (state.workspace && state.workspace.mode === 'primary') {
      return compilePrimaryPrompt(t, shot, { shotIndex: idx }).text;
    }
    return compileReplacePrompt(t, shot, prior, { shotIndex: idx }).text;
  }

  function promptOriginForShot(t, shot, prior, promptText, shotIndex) {
    // Strict rule: differs from the live compiled default → Custom (saved to DB).
    // Exact match (or empty-vs-empty) → Automated (DB prompt cell blank).
    // Clear (empty vs non-empty default) stays Custom — same as Replacement.
    const norm = normalizePromptCompare(promptText);
    const liveN = normalizePromptCompare(liveCompiledPromptText(t, shot, prior));
    return norm === liveN ? 'Automated' : 'Custom';
  }

  function storedPromptBaseline(shotIndex) {
    if (!state.workspace || !state.workspace.promptBaselines) return '';
    const idx = shotIndex != null ? shotIndex : (state.workspaceShot || 0);
    return state.workspace.promptBaselines[idx] != null
      ? String(state.workspace.promptBaselines[idx])
      : '';
  }

  /** Default text used for yellow-diff: stored baseline if set, else live compile. */
  function promptDefaultForDiff(t, shot, prior, shotIndex) {
    const stored = storedPromptBaseline(shotIndex);
    if (stored) return stored;
    return liveCompiledPromptText(t, shot, prior);
  }

  /**
   * Display-only markdown for Primary + Replace overlays.
   * Textarea / Answerly keep raw # / **; the overlay strips markers and shows bold headers.
   * (Caret can drift slightly on marked lines — formatting preference.)
   */
  function formatPromptOverlayHtml(html) {
    let out = String(html || '');
    out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong class="wr-md-strong">$1</strong>');
    out = out.replace(/(^|<br>)(#{1,6})\s+([^<]*)/g, function (_, br, hashes, rest) {
      return br + '<span class="wr-md-h wr-md-h' + Math.min(3, hashes.length) + '">' + rest + '</span>';
    });
    return out;
  }

  function promptDiffHighlightHtml(current, baseline) {
    const cur = String(current || '');
    const base = String(baseline || '');
    if (!cur) return '';
    if (normalizePromptCompare(cur) === normalizePromptCompare(base)) {
      return formatPromptOverlayHtml(esc(cur).replace(/\n/g, '<br>'));
    }
    // Yellow = whole new tokens vs Default. Partial deletes / in-place edits of the
    // expected next baseline word stay unhighlighted (prefix/suffix of that word).
    const curParts = cur.split(/(\s+)/);
    const baseTokens = normalizePromptCompare(base).split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
    let bi = 0;
    let html = '';
    curParts.forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        html += esc(part).replace(/\n/g, '<br>');
        return;
      }
      const token = part.toLowerCase();
      let found = -1;
      for (let j = bi; j < baseTokens.length; j++) {
        if (baseTokens[j] === token) {
          found = j;
          break;
        }
      }
      if (found >= 0) {
        bi = found + 1;
        html += esc(part);
        return;
      }
      // Partial of the next expected baseline token (deleting/typing inside that word).
      const next = baseTokens[bi];
      if (next && token && next.indexOf(token) === 0) {
        // Shorter remnant / prefix of baseline word — not a new insertion.
        html += esc(part);
        bi += 1;
        return;
      }
      html += '<mark class="wr-prompt-mark">' + esc(part) + '</mark>';
    });
    return formatPromptOverlayHtml(html);
  }

  function syncPromptHighlightOverlay() {
    if (!els.workspace || !state.workspace) return;
    if (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary') return;
    const wrap = els.workspace.querySelector('.wr-prompt-wrap');
    const promptEl = els.workspace.querySelector('[data-ws-prompt]');
    const overlay = els.workspace.querySelector('[data-ws-prompt-highlight]');
    if (!wrap || !promptEl || !overlay) return;
    const task = taskByEan(state.workspace.ean);
    if (!task) return;
    const idx = state.workspaceShot || 0;
    const shots = shotListFor(task);
    const shot = shots[idx] || shots[0];
    const prior = state.workspace.mode === 'primary' ? null : resolveWorkspaceMatch(task).selected;
    const text = promptEl.value || '';
    // Yellow only after human typing — script/slot recompiles never highlight.
    const manual = isPromptManualEdit(idx);
    const baseline = manual ? promptDefaultForDiff(task, shot, prior, idx) : text;
    wrap.classList.toggle('has-diff', manual && !!normalizePromptCompare(text) &&
      normalizePromptCompare(text) !== normalizePromptCompare(baseline));
    overlay.innerHTML = (manual
      ? promptDiffHighlightHtml(text, baseline)
      : formatPromptOverlayHtml(esc(text).replace(/\n/g, '<br>'))) +
      (text && !/\n$/.test(text) ? '<br>' : '');
    overlay.scrollTop = promptEl.scrollTop;
    overlay.scrollLeft = promptEl.scrollLeft;
  }

  function promptOriginNoteHtml(t, shot, compiled, origin, reuseMeta) {
    const isPrimary = state.workspace && state.workspace.mode === 'primary';
    const source = isPrimary
      ? (isMainShot(shot)
        ? 'Prompt source: Primary · Universal <strong>MAIN</strong> from Prompt DB. '
        : 'Prompt source: Primary · Prompt DB Universal ' + esc(compiled.universalLabel || 'master') +
          (compiled.fromDb ? '' : ' · core fallback') + '. Refs renumber with A1/A2/A3/B. ')
      : (isMainShot(shot)
        ? 'Prompt source: Universal <strong>MAIN</strong> (PDP). '
        : 'Prompt source: Universal · ' + esc(compiled.universalLabel) + '. ');
    const yellowLegend = ' <span class="wr-prompt-legend"><mark class="wr-prompt-mark">Yellow</mark> = added vs Default</span>';
    if (reuseMeta && reuseMeta.ean && origin === 'Custom') {
      return source + '<strong>Custom</strong> — reused from EAN <span class="tp-mono">' +
        esc(String(reuseMeta.ean)) + '</span> (same Sub-category + Template)' +
        (reuseMeta.author ? ' by ' + esc(reuseMeta.author) : '') +
        '. Edit freely; Approve saves a new All user row.' + yellowLegend;
    }
    if (origin === 'Custom') {
      return source + '<strong>Custom</strong> — edited from the compiled default. Will be saved to Prompt DB on Approve.' +
        yellowLegend;
    }
    return source + '<strong>Automated</strong> — compiled default (stored as Default snapshot)' +
      (isPrimary
        ? '. Default restores it. Rate 4–5★, then Approve.'
        : ' (prompt cell stays blank in DB). Default restores it. Rate 4–5★, then Approve.') +
      yellowLegend;
  }

  function refreshPromptOriginUi() {
    if (!els.workspace || !state.workspace) return;
    if (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary') return;
    const task = taskByEan(state.workspace.ean);
    if (!task) return;
    const idx = state.workspaceShot || 0;
    const shots = shotListFor(task);
    const shot = shots[idx] || shots[0];
    const isPrimary = state.workspace.mode === 'primary';
    const prior = isPrimary ? null : resolveWorkspaceMatch(task).selected;
    const compiled = isPrimary
      ? compilePrimaryPrompt(task, shot, { shotIndex: idx })
      : compileReplacePrompt(task, shot, prior, { shotIndex: idx });
    const promptEl = els.workspace.querySelector('[data-ws-prompt]');
    const promptText = promptEl
      ? promptEl.value
      : ((state.workspace.prompts && state.workspace.prompts[idx]) || '');
    const origin = promptOriginForShot(task, shot, prior, promptText, idx);
    const reuseMeta = state.workspace.promptReuse && state.workspace.promptReuse[idx];
    const note = els.workspace.querySelector('.wr-prompt-note');
    if (note) note.innerHTML = promptOriginNoteHtml(task, shot, compiled, origin, reuseMeta);
    const badge = els.workspace.querySelector('[data-ws-prompt-origin]');
    if (badge) {
      badge.textContent = origin;
      badge.className = 'wr-badge-ghost' + (origin === 'Custom' ? ' is-custom' : ' is-automated');
      badge.setAttribute('data-ws-prompt-origin', origin);
    }
    syncPromptHighlightOverlay();
  }

  function syncAutomatedPromptsToLatestCompile(t, prior) {
    if (!state.workspace || !t) return;
    const shots = shotListFor(t);
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
    shots.forEach((shot, idx) => {
      if (isPromptManualEdit(idx)) return;
      const compiled = compileReplacePrompt(t, shot, prior, { shotIndex: idx }).text;
      state.workspace.prompts[idx] = compiled;
      rememberPromptBaseline(idx, compiled);
      setPromptManualEdit(idx, false);
    });
  }

  function syncAutomatedPrimaryPromptsToLatestCompile(t) {
    if (!state.workspace || !t || state.workspace.mode !== 'primary') return;
    const shots = shotListFor(t);
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
    shots.forEach((shot, idx) => {
      if (isPromptManualEdit(idx)) return;
      const compiled = compilePrimaryPrompt(t, shot, { shotIndex: idx }).text;
      state.workspace.prompts[idx] = compiled;
      rememberPromptBaseline(idx, compiled);
      setPromptManualEdit(idx, false);
    });
  }

  const EXPORT_OUT_SIZE = 3000; // Match Renamer target output (3000 × 3000).

  function exportOutputName(t, shot, idx) {
    const ean = (t && t.ean) || 'EAN';
    if (isMainShot(shot)) return ean + '_MAIN.png';
    const seqRaw = shot && shot.seq != null ? String(shot.seq) : String(idx);
    const seq = seqRaw.replace(/\D/g, '') ? String(parseInt(seqRaw, 10) || idx).padStart(2, '0') : String(idx).padStart(2, '0');
    return ean + '_' + seq + '_' + (shot && shot.code ? shot.code : 'SHOT') + '.png';
  }

  function measureBlobDims(blobOrUrl) {
    return new Promise((resolve) => {
      if (!blobOrUrl) {
        resolve({ w: 0, h: 0 });
        return;
      }
      const revoke = typeof blobOrUrl !== 'string';
      const url = revoke ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
      const img = new Image();
      img.onload = () => {
        const dims = { w: img.naturalWidth || 0, h: img.naturalHeight || 0 };
        if (revoke) {
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        }
        resolve(dims);
      };
      img.onerror = () => {
        if (revoke) {
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        }
        resolve({ w: 0, h: 0 });
      };
      img.src = url;
    });
  }

  function exportNeedsUpscale(img) {
    if (!img || !upscaleOn()) return false;
    // Unknown size → treat as needing upscale so 1K Answerly outputs are not marked "Not needed".
    if (!(img.w > 0 && img.h > 0)) return true;
    return Math.min(img.w, img.h) < EXPORT_OUT_SIZE;
  }

  function ensureExportImageDims(entry, key) {
    if (!entry || (entry.w > 0 && entry.h > 0) || entry._measuring) return;
    // Prefer blob/file — never measure a stale blob: string (causes ERR_FILE_NOT_FOUND).
    const src = entry.blob || entry.file ||
      (entry.url && /^https?:/i.test(entry.url) ? entry.url : '');
    if (!src) return;
    entry._measuring = true;
    measureBlobDims(src).then((dims) => {
      if (!state.workspace || !state.workspace.exportImages) return;
      const cur = state.workspace.exportImages[key];
      if (!cur || cur !== entry) return;
      entry.w = dims.w;
      entry.h = dims.h;
      entry._measuring = false;
      // Also stamp dims onto the live D output when missing.
      if (dims.w && dims.h) {
        const out = shotAssets(key).output;
        if (out && !(out.w > 0 && out.h > 0)) {
          out.w = dims.w;
          out.h = dims.h;
        }
      }
      if (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') {
        renderWorkspace();
      }
    });
  }

  function ensureExportImageFromApproved(idx) {
    if (!state.workspace) return null;
    if (!state.workspace.exportImages) state.workspace.exportImages = {};
    if (!state.workspace.exportCleared) state.workspace.exportCleared = {};
    const key = String(idx);
    // User cleared this row — do not re-seed from approved/D until they drop again.
    if (state.workspace.exportCleared[key]) return null;
    const approved = state.workspace.approved && state.workspace.approved[idx];
    const out = shotAssets(idx).output;
    const blob = (out && (out.blob || out.file)) || null;
    if (state.workspace.exportImages[key]) {
      const existing = state.workspace.exportImages[key];
      // Keep manual wr-slot-drop fills as-is (e.g. dimension) — do not overwrite with D.
      if (exportImageSkipsRating(existing)) {
        ensureExportImageDims(existing, key);
        return existing;
      }
      // Refresh backing blob from live D so thumbs survive revoke / EAN switch.
      if (blob) {
        existing.blob = blob;
        existing.file = out.file || existing.file || null;
        existing.manualDrop = false;
        existing.skipRating = false;
      }
      if (!ensureExportDisplayUrl(existing)) {
        delete state.workspace.exportImages[key];
        delete state.workspace.exportImages[idx];
      } else {
        ensureExportImageDims(existing, key);
        return existing;
      }
    }
    const liveUrl = ensureAssetDisplayUrl(out);
    if (!liveUrl && !blob) return null;
    const entry = {
      url: '',
      name: (approved && approved.outputName) || (out && out.name) || '',
      blob: blob,
      file: (out && out.file) || null,
      w: (out && out.w) || 0,
      h: (out && out.h) || 0,
      status: 'ready',
      fromApproved: !!approved,
      manualDrop: false,
      skipRating: false,
      upscale: null
    };
    entry.url = ensureExportDisplayUrl(entry) || liveUrl;
    if (!entry.url) return null;
    state.workspace.exportImages[key] = entry;
    ensureExportImageDims(entry, key);
    return entry;
  }

  function seedExportImagesFromApproved(shots) {
    if (!state.workspace) return;
    (shots || []).forEach((_, idx) => ensureExportImageFromApproved(idx));
  }

  const EXPORT_RING_C = 2 * Math.PI * 15.5;

  function exportUpscaleRing(pct, variant) {
    const offset = EXPORT_RING_C * (1 - Math.max(0, Math.min(100, Number(pct) || 0)) / 100);
    return '<svg class="ring' + (variant ? ' ' + variant : '') + '" viewBox="0 0 36 36" aria-hidden="true">' +
      '<circle class="ring-bg" cx="18" cy="18" r="15.5"/>' +
      '<circle class="ring-fg" cx="18" cy="18" r="15.5" stroke-dasharray="' + EXPORT_RING_C.toFixed(2) +
        '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
      '</svg>';
  }

  function exportUpscaleSecs(ms) {
    return Math.max(0, Math.round((Number(ms) || 0) / 1000)) + ' s';
  }

  function exportUpscaleCellHtml(img, upOn) {
    if (!img) return '<span class="dash">—</span>';
    const up = img.upscale;
    if (up) {
      if (up.state === 'done') {
        return '<span class="up-time done" title="AI upscale 2x time">' +
          (up.ms != null ? exportUpscaleSecs(up.ms) : 'Done') + '</span>';
      }
      if (up.state === 'failed') return '<span class="up-fail">Failed</span>';
      if (up.state === 'queued') {
        return '<span class="upscale-cell">' + exportUpscaleRing(0, 'is-queued') +
          '<span class="up-time">Queued</span></span>';
      }
      if (up.state === 'converting') {
        return '<span class="upscale-cell">' + exportUpscaleRing(up.progress || 90, '') +
          '<span class="up-time">PNG…</span></span>';
      }
      const waiting = up.stage === 'rate-limited' || up.stage === 'waiting';
      const sub = up.stage === 'rate-limited' ? 'Firefly busy'
        : (typeof up.progress === 'number' ? Math.round(up.progress) + '%' : '…');
      return '<span class="upscale-cell" title="' + esc(up.stage || '') + '">' +
        exportUpscaleRing(up.progress || 0, waiting ? 'is-waiting' : '') +
        '<span class="up-time">' + exportUpscaleSecs(up.elapsed) +
          '<span class="up-sub">' + esc(sub) + '</span></span></span>';
    }
    if (!upOn) return '<span class="up-muted">Off</span>';
    if (!(img.w > 0 && img.h > 0)) return '<span class="up-muted">Measuring…</span>';
    if (exportNeedsUpscale(img)) {
      return '<span class="status status-upscale" title="Will be upscaled 2x with Adobe Firefly">AI 2x</span>';
    }
    return '<span class="up-muted">Not needed</span>';
  }

  function setExportProgress(file, step, pct) {
    if (!state.workspace) return;
    state.workspace.exportProgress = { file: file || '', step: step || '', pct: pct || 0 };
    if (!els.workspace) return;
    let box = els.workspace.querySelector('.wr-export-progress');
    if (!box) {
      const card = els.workspace.querySelector('.wr-approved-card');
      if (!card) return;
      box = document.createElement('div');
      box.className = 'wr-export-progress';
      box.setAttribute('aria-live', 'polite');
      box.innerHTML =
        '<div class="wr-export-progress-file"></div>' +
        '<div class="wr-export-progress-step"></div>' +
        '<div class="wr-export-progress-track"><div class="wr-export-progress-bar"></div></div>';
      card.appendChild(box);
    }
    const fileEl = box.querySelector('.wr-export-progress-file');
    const stepEl = box.querySelector('.wr-export-progress-step');
    const barEl = box.querySelector('.wr-export-progress-bar');
    if (fileEl) fileEl.textContent = file || '';
    if (stepEl) stepEl.textContent = step || '';
    if (barEl) barEl.style.width = Math.max(0, Math.min(100, Number(pct) || 0)) + '%';
  }

  function updateExportUpscaleCell(idx) {
    if (!els.workspace || !state.workspace) return;
    const td = els.workspace.querySelector('td[data-up-cell="' + idx + '"]');
    if (!td) return;
    const img = state.workspace.exportImages &&
      (state.workspace.exportImages[String(idx)] || state.workspace.exportImages[idx]);
    td.innerHTML = exportUpscaleCellHtml(img, upscaleOn());
  }

  function restoreExportImageFromGenerated(idx) {
    if (!state.workspace) return;
    const key = String(idx);
    if (state.workspace.exportCleared) delete state.workspace.exportCleared[key];
    if (state.workspace.exportImages) {
      delete state.workspace.exportImages[key];
      delete state.workspace.exportImages[idx];
    }
    const entry = ensureExportImageFromApproved(idx);
    if (!entry) {
      showToast('No generated image available for this shot.', false, { error: true });
      return;
    }
    renderWorkspace();
    showToast('Restored generated image into export row.', false);
  }

  async function resetEanReplaceDraft() {
    if (!state.workspace || state.workspace.mode !== 'replace') return;
    const task = taskByEan(state.workspace.ean) || { ean: state.workspace.ean };
    const prior = resolveWorkspaceMatch(task).selected;
    const shots = shotListFor(task);
    const msg = 'Reset all Gen Img & Prompt?\n\nThis clears product inputs (B), outputs (D), and per-image ratings for every shot, and restores prompts to Universal defaults.\n\nApprovals for this EAN are cleared too. A (prior) overrides stay.';
    if (!window.confirm(msg)) return;
    Object.keys(state.workspace.assets || {}).forEach((k) => {
      const a = shotAssets(k);
      (a.inputs || []).forEach(revokeAssetUrl);
      a.inputs = [];
      revokeAssetUrl(a.output);
      a.output = null;
      a._previousOutput = null;
      a.error = null;
      // Keep priorOverride (A) — user asked for B, D, rating, prompt only.
    });
    state.workspace.outputs = {};
    state.workspace.approved = {};
    state.workspace.rejected = {};
    state.workspace.ratings = {};
    state.workspace.rating = 0;
    state.workspace.genCounts = {};
    state.workspace.exportImages = {};
    state.workspace.prompts = {};
    state.workspace.promptBaselines = {};
    state.workspace.shotInputs = {};
    clearMdimWorkspaceState();
    shots.forEach((shot, idx) => {
      const compiled = compileReplacePrompt(task, shot, prior).text;
      state.workspace.prompts[idx] = compiled;
      rememberPromptBaseline(idx, compiled);
    });
    await persistCurrentReplaceDraft();
    renderWorkspace();
    showToast('Reset all Gen Img & Prompt — B, D, M-DIM base, ratings cleared; prompts restored to Universal defaults.', false);
  }

  async function resetEanPrimaryDraft() {
    if (!state.workspace || state.workspace.mode !== 'primary') return;
    const task = taskByEan(state.workspace.ean) || { ean: state.workspace.ean };
    const shots = shotListFor(task);
    const msg = 'Reset all Gen Img & Prompt?\n\nThis clears product inputs (B), outputs (D), and per-image ratings for every shot, and restores prompts from Universal Prompt DB.\n\nApprovals for this EAN are cleared too. A1 template / A2 PDP / A3 stay.';
    if (!window.confirm(msg)) return;
    Object.keys(state.workspace.assets || {}).forEach((k) => {
      const a = shotAssets(k);
      (a.inputs || []).forEach(revokeAssetUrl);
      a.inputs = [];
      revokeAssetUrl(a.output);
      a.output = null;
      a._previousOutput = null;
      a.error = null;
    });
    state.workspace.outputs = {};
    state.workspace.approved = {};
    state.workspace.rejected = {};
    state.workspace.ratings = {};
    state.workspace.rating = 0;
    state.workspace.genCounts = {};
    state.workspace.exportImages = {};
    state.workspace.prompts = {};
    state.workspace.promptBaselines = {};
    state.workspace.promptManualEdit = {};
    if (state.workspace.promptReuse) state.workspace.promptReuse = {};
    clearMdimWorkspaceState();
    shots.forEach((shot, idx) => {
      const compiled = compilePrimaryPrompt(task, shot, { shotIndex: idx }).text;
      state.workspace.prompts[idx] = compiled;
      rememberPromptBaseline(idx, compiled);
      setPromptManualEdit(idx, false);
    });
    await persistCurrentPrimaryDraft();
    renderWorkspace();
    showToast('Reset all Gen Img & Prompt — B, D, ratings cleared; prompts restored from Universal Prompt DB.', false);
  }

  /** Drag/drop onto export row (wr-slot-drop) — e.g. manual M-DIM — skip rating gate. */
  function exportImageSkipsRating(img) {
    return !!(img && (img.manualDrop || img.skipRating));
  }

  function exportRowNeedsRating(idx) {
    const img = state.workspace && state.workspace.exportImages &&
      (state.workspace.exportImages[String(idx)] || state.workspace.exportImages[idx]);
    if (!img || !ensureExportDisplayUrl(img)) return false;
    if (exportImageSkipsRating(img)) return false;
    return shotRating(idx) < 1;
  }

  async function addExportImageToShot(shotIndex, file) {
    if (!state.workspace || !isAcceptedImageFile(file)) {
      showToast('Use JPG or PNG images only.', false);
      return;
    }
    try {
      const loaded = await readLocalImageFile(file);
      if (!state.workspace.exportImages) state.workspace.exportImages = {};
      if (!state.workspace.exportCleared) state.workspace.exportCleared = {};
      delete state.workspace.exportCleared[String(shotIndex)];
      state.workspace.exportImages[String(shotIndex)] = {
        url: loaded.url,
        _blobRef: loaded.blob || loaded.file,
        name: loaded.name,
        blob: loaded.blob || loaded.file,
        file: loaded.file || loaded.blob,
        w: loaded.w || 0,
        h: loaded.h || 0,
        status: 'ready',
        fromApproved: false,
        // Manual drop into export table — not Answerly-generated; do not block zip on stars.
        manualDrop: true,
        skipRating: true,
        upscale: null
      };
      renderWorkspace();
    } catch (err) {
      showToast((err && err.message) || 'Could not add image.', false, { error: true });
    }
  }

  async function fillNextExportSlots(fileList) {
    if (!state.workspace) return;
    const task = taskByEan(state.workspace.ean);
    const shots = shotListFor(task || {});
    const files = Array.prototype.slice.call(fileList || []).filter(isAcceptedImageFile);
    if (!files.length) {
      showToast('Use JPG or PNG images only.', false);
      return;
    }
    const empties = orderedRailShots(shots).map(({ idx }) => idx).filter((idx) => {
      const img = state.workspace.exportImages && state.workspace.exportImages[idx];
      return !(img && img.url);
    });
    if (!empties.length) {
      showToast('All export shots are already filled.', false);
      return;
    }
    const take = files.slice(0, empties.length);
    for (let n = 0; n < take.length; n++) {
      await addExportImageToShot(empties[n], take[n]);
    }
  }

  function downloadBlobFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 4000);
  }

  async function buildSimpleZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    function crc32(bytes) {
      let c = ~0;
      for (let i = 0; i < bytes.length; i++) {
        c ^= bytes[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      return ~c >>> 0;
    }
    for (let fi = 0; fi < files.length; fi++) {
      const f = files[fi];
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
    return new Blob(parts.concat(central).concat([end]), { type: 'application/zip' });
  }

  // Firefly upscale is optional and separate from Answerly. Returns health when ready.
  async function ensureFireflyUpscalerForExport() {
    async function readHealth() {
      const res = await bridgeFetch('/health', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('Bridge offline');
      return res.json();
    }
    let health;
    try {
      health = await readHealth();
    } catch (_) {
      throw new Error(
        'Local bridge offline. For AI upscale, start the Firefly upscaler (Settings → Setup). Or turn off AI upscale to export without Firefly.'
      );
    }
    // Answerly-only process cannot run /jobs — start the full Firefly service.
    if (health.answerlyOnly || health.service === 'answerly-bridge') {
      showToast('Starting Firefly upscaler for AI upscale…', false);
      try { location.href = 'playground3d://start'; } catch (_) { /* ignore */ }
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          health = await readHealth();
          if (health.ok && !health.answerlyOnly && health.service === 'firefly-upscaler') break;
        } catch (_) { /* keep waiting */ }
      }
    }
    if (!health || health.answerlyOnly || health.service !== 'firefly-upscaler') {
      throw new Error(
        'AI upscale needs the Firefly upscaler. Start it from Settings → Setup, or turn off AI upscale to finish export without Firefly.'
      );
    }
    if (!health.chrome) {
      throw new Error(
        'Firefly Chrome is not open. Click Start in Setup (leave the Firefly window open), or turn off AI upscale to export without Firefly.'
      );
    }
    return health;
  }

  async function upscaleBlobForExport(entry, name, opts) {
    opts = opts || {};
    const blob = entry.blob || entry.file;
    if (!blob) throw new Error('No image bytes for ' + name);
    entry.upscale = { state: 'queued', progress: 0, elapsed: 0, stage: 'queued' };
    if (typeof opts.onProgress === 'function') opts.onProgress(entry.upscale);
    else if (opts.shotIndex != null) updateExportUpscaleCell(opts.shotIndex);
    const res = await bridgeFetch('/jobs?scale=2x&name=' + encodeURIComponent(name || 'image.png'), {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/png' },
      body: blob
    });
    if (!res.ok) {
      let detail = 'Upscale submit failed (' + res.status + ')';
      try {
        const errBody = await res.json();
        if (errBody && errBody.error) detail = errBody.error;
      } catch (_) { /* ignore */ }
      throw new Error(detail);
    }
    const job = await res.json();
    const id = job && job.id;
    if (!id) throw new Error('Upscale service returned no job id');
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = await bridgeFetch('/jobs/' + encodeURIComponent(id));
      if (!st.ok) throw new Error('Lost connection to upscale service');
      const info = await st.json();
      entry.upscale = {
        state: info.status === 'queued' ? 'queued' : (info.status === 'done' ? 'done' : 'running'),
        stage: info.stage,
        progress: info.progress,
        elapsed: info.elapsedMs
      };
      if (typeof opts.onProgress === 'function') opts.onProgress(entry.upscale, info);
      else if (opts.shotIndex != null) updateExportUpscaleCell(opts.shotIndex);
      else if (state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        renderWorkspace();
      }
      if (info.status === 'done') {
        const out = await bridgeFetch('/jobs/' + encodeURIComponent(id) + '/result');
        entry.upscale = { state: 'done', ms: info.elapsedMs };
        if (opts.shotIndex != null) updateExportUpscaleCell(opts.shotIndex);
        return await out.blob();
      }
      if (info.status === 'failed') throw new Error(info.error || 'Upscale failed');
    }
  }

  /* ---------- Renamer-parity PNG output (3000×3000, 72 dpi, tEXt + XMP) ---------- */
  const EXPORT_OUTPUT_DPI = 72;
  const EXPORT_PNG_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function exportPngCrc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = EXPORT_PNG_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function exportLatin1(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      out[i] = code < 256 ? code : 63;
    }
    return out;
  }

  function exportPngChunk(type, data) {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(exportLatin1(type), 4);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, exportPngCrc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
  }

  function exportU32(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }

  function exportXmlEscape(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function exportLocalIsoWithOffset(d) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
  }

  async function encodeExportPngRgb(imageData, dpi) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
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
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            pred = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
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
      const swap = prev; prev = cur; cur = swap;
    }
    const compressed = new Uint8Array(await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
    ).arrayBuffer());
    const ppm = Math.round(dpi / 0.0254);
    const parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      exportPngChunk('IHDR', new Uint8Array(exportU32(width).concat(exportU32(height), [8, 2, 0, 0, 0]))),
      exportPngChunk('pHYs', new Uint8Array(exportU32(ppm).concat(exportU32(ppm), [1]))),
      exportPngChunk('IDAT', compressed),
      exportPngChunk('IEND', new Uint8Array(0))
    ];
    return new Blob(parts, { type: 'image/png' });
  }

  function exportBuildXmp(fields) {
    const x = (v) => exportXmlEscape(v || '');
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

  async function addExportPngText(blob, fields) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ihdrEnd = 8 + 4 + 4 + 13 + 4;
    function textChunk(key, value) {
      const k = exportLatin1(key);
      const v = exportLatin1(String(value));
      const data = new Uint8Array(k.length + 1 + v.length);
      data.set(k, 0);
      data[k.length] = 0;
      data.set(v, k.length + 1);
      return exportPngChunk('tEXt', data);
    }
    function itxtChunk(key, text) {
      const k = exportLatin1(key);
      const v = new TextEncoder().encode(text);
      const data = new Uint8Array(k.length + 5 + v.length);
      data.set(k, 0);
      data[k.length] = 0;
      data[k.length + 1] = 0;
      data[k.length + 2] = 0;
      data[k.length + 3] = 0;
      data[k.length + 4] = 0;
      data.set(v, k.length + 5);
      return exportPngChunk('iTXt', data);
    }
    const chunks = Object.keys(fields).filter((k) => fields[k]).map((k) => textChunk(k, fields[k]));
    chunks.push(itxtChunk('XML:com.adobe.xmp', exportBuildXmp(fields)));
    const extra = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(bytes.length + extra);
    out.set(bytes.subarray(0, ihdrEnd), 0);
    let offset = ihdrEnd;
    chunks.forEach((c) => { out.set(c, offset); offset += c.length; });
    out.set(bytes.subarray(ihdrEnd), offset);
    return new Blob([out], { type: 'image/png' });
  }

  function loadImageForExportDraw(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read image for export'));
      img.src = url;
    });
  }

  async function renderExportPng(srcUrl) {
    const size = EXPORT_OUT_SIZE;
    const img = await loadImageForExportDraw(srcUrl);
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
    return encodeExportPngRgb(ctx.getImageData(0, 0, size, size), EXPORT_OUTPUT_DPI);
  }

  async function generateApprovedExportZip() {
    if (!state.workspace ||
        (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
    if (state.workspace.exportBusy) return;
    const task = taskByEan(state.workspace.ean);
    if (!task) {
      showToast('Task not found for this EAN.', false, { error: true });
      return;
    }
    const shots = shotListFor(task);
    seedExportImagesFromApproved(shots);
    const indexes = orderedRailShots(shots).map(({ idx }) => idx).filter((idx) => {
      const img = state.workspace.exportImages && state.workspace.exportImages[String(idx)];
      return !!(img && ensureExportDisplayUrl(img));
    });
    if (!indexes.length) {
      showToast('Add at least one image.', false, { error: true });
      return;
    }
    const unrated = indexes.filter((idx) => exportRowNeedsRating(idx));
    if (unrated.length) {
      showToast(
        'Rate every generated/approved image before export (1–5 stars). ' +
          unrated.length + ' still unrated. Manual drops (e.g. dimension) are skipped.',
        false,
        { error: true }
      );
      return;
    }
    const upOn = upscaleOn();
    const typeName = state.workspace.productTypeName || '';
    const variant = state.workspace.productTypeVariant || '';
    const needsFirefly = upOn && indexes.some((idx) => {
      const img = state.workspace.exportImages[String(idx)] || state.workspace.exportImages[idx];
      return exportNeedsUpscale(img);
    });
    state.workspace.exportBusy = true;
    state.workspace.exportProgress = {
      file: '',
      step: needsFirefly ? 'Checking Firefly upscaler…' : 'Starting…',
      pct: 0
    };
    renderWorkspace();
    try {
      if (needsFirefly) await ensureFireflyUpscalerForExport();
      const zipFiles = [];
      const metaBase = {
        Author: state.author || '',
        Software: '3D Playground (' + APP_VERSION + ')',
        'Creation Time': exportLocalIsoWithOffset(new Date())
      };
      const total = indexes.length;
      for (let n = 0; n < indexes.length; n++) {
        const idx = indexes[n];
        const shot = shots[idx] || {};
        const entry = state.workspace.exportImages[String(idx)] || state.workspace.exportImages[idx];
        const outName = exportOutputName(task, shot, idx);
        const label = (shot.seq != null ? shot.seq : String(idx).padStart(2, '0')) + ' · ' + outName;
        const basePct = (n / total) * 100;
        const span = 100 / total;
        let srcUrl = entry.url;
        let blob = entry.blob || entry.file;
        if (!blob && entry.url) {
          const res = await fetch(entry.url);
          blob = await res.blob();
          entry.blob = blob;
        }
        if (!blob && !srcUrl) throw new Error('Missing image data for ' + outName);
        if (!(entry.w > 0 && entry.h > 0) && blob) {
          const dims = await measureBlobDims(blob);
          entry.w = dims.w;
          entry.h = dims.h;
        }
        let workUrl = srcUrl;
        let revokeWork = false;
        if (exportNeedsUpscale(entry)) {
          try {
            setExportProgress(label, 'Sending to AI upscale…', basePct + span * 0.05);
            const upBlob = await upscaleBlobForExport(entry, outName, {
              shotIndex: idx,
              onProgress: (up, info) => {
                updateExportUpscaleCell(idx);
                const p = typeof up.progress === 'number' ? up.progress : 0;
                const step = up.state === 'queued'
                  ? 'Queued for AI upscale…'
                  : (up.stage === 'rate-limited'
                    ? 'Firefly busy, retrying…'
                    : (up.stage === 'downloading'
                      ? 'Downloading upscaled image…'
                      : 'AI upscaling 2x… ' + Math.round(p) + '%'));
                setExportProgress(label, step, basePct + span * (0.1 + 0.7 * (p / 100)));
              }
            });
            workUrl = URL.createObjectURL(upBlob);
            revokeWork = true;
          } catch (err) {
            entry.upscale = { state: 'failed' };
            updateExportUpscaleCell(idx);
            throw err;
          }
        } else if (!workUrl && blob) {
          workUrl = URL.createObjectURL(blob);
          revokeWork = true;
        }
        try {
          entry.upscale = Object.assign({}, entry.upscale || {}, { state: 'converting', progress: 92 });
          updateExportUpscaleCell(idx);
          setExportProgress(label, 'Converting to ' + EXPORT_OUT_SIZE + '×' + EXPORT_OUT_SIZE + ' PNG…', basePct + span * 0.85);
          const raw = await renderExportPng(workUrl);
          setExportProgress(label, 'Writing metadata…', basePct + span * 0.92);
          const titled = outName.replace(/\.png$/i, '');
          const finalBlob = await addExportPngText(raw, Object.assign({}, metaBase, {
            Title: titled,
            Description: typeName + (variant ? ' · ' + variant : '') + ' · ' + (shot.name || shot.code || '')
          }));
          zipFiles.push({ name: task.ean + '/' + outName, blob: finalBlob });
          entry.exportW = EXPORT_OUT_SIZE;
          entry.exportH = EXPORT_OUT_SIZE;
          if (entry.upscale && entry.upscale.state === 'converting') {
            entry.upscale = entry.upscale.ms != null
              ? { state: 'done', ms: entry.upscale.ms }
              : (exportNeedsUpscale({ w: entry.w, h: entry.h }) ? entry.upscale : null);
          }
          if (entry.upscale && entry.upscale.state === 'done') updateExportUpscaleCell(idx);
          else if (!exportNeedsUpscale(entry)) {
            entry.upscale = null;
            updateExportUpscaleCell(idx);
          }
        } finally {
          if (revokeWork && workUrl) {
            try { URL.revokeObjectURL(workUrl); } catch (e) { /* ignore */ }
          }
        }
      }
      setExportProgress('', 'Creating zip…', 99);
      const zip = await buildSimpleZip(zipFiles);
      downloadBlobFile(zip, task.ean + '.zip');
      showToast(
        'Downloaded ' + task.ean + '.zip · ' + zipFiles.length + ' PNG' +
          (zipFiles.length === 1 ? '' : 's') + ' at ' + EXPORT_OUT_SIZE + '×' + EXPORT_OUT_SIZE + '.',
        false
      );
      openCompleteDriveModal(task.ean);
    } catch (err) {
      showToast('Export failed: ' + esc((err && err.message) || err), false, { error: true });
    } finally {
      if (state.workspace) {
        state.workspace.exportBusy = false;
        delete state.workspace.exportProgress;
      }
      renderWorkspace();
    }
  }

  function approvedExportCardHtml(t, shots) {
    seedExportImagesFromApproved(shots);
    const list = orderedRailShots(shots);
    const filledRows = list.filter(({ idx }) => {
      const img = state.workspace.exportImages && state.workspace.exportImages[idx];
      return !!(img && ensureExportDisplayUrl(img));
    });
    const filled = filledRows.length;
    const unratedFilled = filledRows.filter(({ idx }) => exportRowNeedsRating(idx)).length;
    const canExport = filled > 0 && unratedFilled === 0 && !(state.workspace && state.workspace.exportBusy);
    const exportDisabledTitle = !filled
      ? 'Add at least one image'
      : (unratedFilled
        ? 'Rate generated/approved images first (' + unratedFilled + ' unrated). Manual drops skip rating.'
        : '');
    const upOn = upscaleOn();
    const typeName = state.workspace.productTypeName || '';
    const variant = state.workspace.productTypeVariant || '';
    return '<section class="card shot-card wr-approved-card" aria-label="Final shots ready for export">' +
      '<div class="card-head">' +
        '<div class="card-head-left">' +
          '<h2 class="card-title">Shots for ' + esc(typeName || 'product') +
            (variant ? ' · ' + esc(variant) : '') + '</h2>' +
          '<span class="muted">(Auto-configured from naming data sheet)</span>' +
        '</div>' +
        '<div class="card-head-right">' +
          '<span class="pill' + (filled === list.length && list.length ? ' is-full' : '') + '">' +
            filled + ' of ' + list.length + ' shots filled</span>' +
          '<label class="switch" title="Upscale images under ' + EXPORT_OUT_SIZE + 'px 2x with Adobe Firefly before generating">' +
            '<input type="checkbox" data-ws="export-upscale-toggle" role="switch"' + (upOn ? ' checked' : '') + '>' +
            '<span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>' +
            '<span class="switch-label">AI upscale</span>' +
          '</label>' +
          '<button type="button" class="btn btn-outline btn-sm btn-clear-all" data-ws="export-clear-all"' +
            (filled ? '' : ' disabled') + '>Clear all</button>' +
        '</div>' +
      '</div>' +
      '<div class="shot-subhead">' +
        '<span>JPG or PNG. AI upscale (Firefly) is optional — only used when the toggle is on and an image is under ' +
          EXPORT_OUT_SIZE + ' px. Turn it off to export without Firefly.</span>' +
        '<span class="subhead-right">Target output: ' + EXPORT_OUT_SIZE + ' × ' + EXPORT_OUT_SIZE + ' px PNG</span>' +
      '</div>' +
      '<div class="drop-banner wr-approved-drop-banner" data-ws-drop="approved-upscale">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>' +
        '<strong>Drop to add images</strong>' +
        '<span>Drag files onto a row to fill that shot, or anywhere here to fill the next empty shots.</span>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="shot-table wr-approved-table">' +
          '<thead><tr>' +
            '<th class="c-seq">Seq</th>' +
            '<th class="c-name">Image Name</th>' +
            '<th class="c-code">Shot Code</th>' +
            '<th class="c-img">Image</th>' +
            '<th class="c-out">Output File Name</th>' +
            '<th class="c-up">Upscale</th>' +
            '<th class="c-status">Status</th>' +
            '<th class="c-action">Action</th>' +
          '</tr></thead>' +
          '<tbody>' +
            list.map(({ s, idx }) => {
              const img = state.workspace.exportImages && state.workspace.exportImages[idx];
              const imgUrl = ensureExportDisplayUrl(img);
              const outName = exportOutputName(t, s, idx);
              const approvedRec = state.workspace.approved && state.workspace.approved[idx];
              const approved = !!approvedRec;
              const outForRestore = shotAssets(idx).output;
              let imageCell;
              const canRestoreGenerated = !!(
                (state.workspace.exportCleared && state.workspace.exportCleared[String(idx)]) &&
                ((approvedRec && (approvedRec.url || (outForRestore && (outForRestore.blob || outForRestore.file)))) ||
                  (outForRestore && (outForRestore.url || outForRestore.blob || outForRestore.file)))
              );
              if (!img || !imgUrl) {
                imageCell = '<button type="button" class="wr-slot-drop" data-ws-drop-export="' + idx + '">+ Drop image</button>';
              } else {
                imageCell =
                  '<div class="wr-export-img-cell' + (img.cropped ? ' is-cropped' : '') +
                    '" data-ws-drop-export="' + idx + '" data-ws-crop-export="' + idx +
                    '" title="Click thumb to crop before upscale">' +
                    '<img class="wr-approved-thumb" draggable="false" src="' + esc(imgUrl) + '" alt="">' +
                    '<div class="wr-export-img-meta">' +
                      '<span class="dims">' + (img.w && img.h ? (img.w + ' × ' + img.h) : '—') + '</span>' +
                      (img.name ? '<span class="dims-sub" title="' + esc(img.name) + '">' + esc(img.name) + '</span>' : '') +
                    '</div>' +
                  '</div>';
              }
              const upCell = exportUpscaleCellHtml(img, upOn);
              const seqDisp = s && s.seq != null
                ? String(parseInt(String(s.seq), 10) || 0).padStart(2, '0')
                : String(idx).padStart(2, '0');
              const rated = shotRating(idx) >= 1;
              const manualExport = !!(img && exportImageSkipsRating(img));
              const statusWithRate = !img ? '<span class="pill is-empty">Empty</span>'
                : (manualExport
                  ? '<span class="pill is-ready" title="Manual drop — rating not required for export">Manual</span>'
                  : (!rated
                    ? '<span class="pill is-empty" title="Rate this shot (stars above) before export">Needs rating</span>'
                    : (approved ? '<span class="pill">Approved</span>' : '<span class="pill is-ready">Ready</span>')));
              return '<tr data-export-row="' + idx + '">' +
                '<td class="c-seq tp-mono">' + esc(seqDisp) + '</td>' +
                '<td class="c-name">' + esc(s.name || '') + '</td>' +
                '<td class="c-code tp-mono">' + esc(s.code || '') + '</td>' +
                '<td class="c-img">' + imageCell + '</td>' +
                '<td class="c-out tp-mono">' + esc(outName) + '</td>' +
                '<td class="c-up" data-up-cell="' + idx + '">' + upCell + '</td>' +
                '<td class="c-status">' + statusWithRate + '</td>' +
                '<td class="c-action">' +
                  (img
                    ? '<button type="button" class="btn-clear" data-ws-clear-export="' + idx + '">Clear</button>'
                    : (canRestoreGenerated
                      ? '<button type="button" class="btn-clear wr-restore-generated" data-ws-restore-export="' + idx +
                          '" title="Put the generated / approved D image back into this row">Use generated</button>'
                      : '')) +
                '</td>' +
              '</tr>';
            }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="wr-approved-actions">' +
        '<div class="wr-approved-save">' +
          '<span class="wr-approved-save-label">Save to: <strong class="tp-mono">' + esc((t.ean || 'EAN') + '.zip') + '</strong></span>' +
          '<span class="muted">All PNGs download as one zip with a folder named after the EAN. Generated/approved rows need a rating; manual drops (e.g. dimension) do not.</span>' +
        '</div>' +
        '<button type="button" class="tp-btn tp-btn-primary" data-ws="export-generate"' +
          (canExport ? '' : ' disabled') +
          (exportDisabledTitle ? ' title="' + esc(exportDisabledTitle) + '"' : '') + '>' +
          (state.workspace && state.workspace.exportBusy
            ? 'Working…'
            : (upOn ? 'Upscale &amp; generate images' : 'Generate images')) +
        '</button>' +
      '</div>' +
      ((state.workspace && state.workspace.exportBusy && state.workspace.exportProgress)
        ? '<div class="wr-export-progress" aria-live="polite">' +
            '<div class="wr-export-progress-file">' + esc(state.workspace.exportProgress.file || '') + '</div>' +
            '<div class="wr-export-progress-step">' + esc(state.workspace.exportProgress.step || '') + '</div>' +
            '<div class="wr-export-progress-track"><div class="wr-export-progress-bar" style="width:' +
              Math.max(0, Math.min(100, Number(state.workspace.exportProgress.pct) || 0)) + '%"></div></div>' +
          '</div>'
        : '') +
    '</section>';
  }

  function modelMaxReferenceImages(modelId, opts) {
    const low = String(modelId || '').toLowerCase();
    if (/krea|grok|xai\//.test(low)) return 1;
    // Primary: A1+A2+A3 + up to 4 B. Replace: prior + up to 4 B.
    if (opts && opts.primary) return 8;
    return 5;
  }

  // JSONP URLs cannot carry long Custom prompts in one query — split into CacheService chunks.
  function splitPromptForJsonp(text, maxEncodedLen) {
    const src = String(text || '');
    const max = Math.max(400, Number(maxEncodedLen) || 1400);
    const chunks = [];
    let i = 0;
    while (i < src.length) {
      let lo = i + 1;
      let hi = Math.min(src.length, i + Math.max(200, Math.floor(max / 2)));
      let best = lo;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const enc = encodeURIComponent(src.slice(i, mid)).length;
        if (enc <= max) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best <= i) best = i + 1;
      chunks.push(src.slice(i, best));
      i = best;
    }
    return chunks.length ? chunks : [''];
  }

  async function pingPromptDbVersion() {
    try {
      const data = await jsonp('action=ping', 20000, PROMPT_DB_URL);
      return Number((data && data.version) || 0) || 0;
    } catch (err) {
      return 0;
    }
  }

  async function writePromptApprove(payload) {
    if (!PROMPT_DB_URL) throw new Error('PROMPT_DB_URL is not set.');
    let origin = String(payload.promptOrigin || '');
    if (/^custom$/i.test(origin)) origin = 'Custom';
    else if (/^automated$/i.test(origin)) origin = 'Automated';
    else throw new Error('promptOrigin must be Automated or Custom');

    // Automated → blank prompt cell.
    // Custom → always upload via promptChunk (never put the full prompt in the approve URL —
    // long query strings were truncating promptOrigin back to a failed/blank Automated write).
    let promptUploadId = '';
    if (origin === 'Custom') {
      const promptOut = String(payload.prompt || '');
      if (!promptOut.trim()) {
        throw new Error('Custom prompt is empty — edit the prompt or use Default before Approve.');
      }
      const ver = await pingPromptDbVersion();
      if (ver < 6) {
        throw new Error(
          'Prompt DB web app is outdated (v' + (ver || '?') + ', need v7). ' +
          'Copy dashboard/apps-script-prompt-db/Code.gs into the Prompt Database Apps Script → ' +
          'Deploy → Manage deployments → Edit → Version: New version → Deploy. Then Approve again.'
        );
      }
      promptUploadId = 'p' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      const chunks = splitPromptForJsonp(promptOut, 1400);
      try {
        for (let i = 0; i < chunks.length; i++) {
          await jsonp(
            [
              'action=promptChunk',
              'uploadId=' + encodeURIComponent(promptUploadId),
              'i=' + i,
              'n=' + chunks.length,
              'data=' + encodeURIComponent(chunks[i])
            ].join('&'),
            45000,
            PROMPT_DB_URL
          );
        }
      } catch (err) {
        const msg = String((err && err.message) || err || '');
        if (/Unknown action:\s*promptChunk/i.test(msg)) {
          throw new Error(
            'Prompt DB deploy is missing promptChunk. Paste latest Code.gs, then ' +
            'Deploy → Manage deployments → Edit → New version → Deploy (keep same URL).'
          );
        }
        throw err;
      }
    }

    // promptOrigin + qualityRating early so they cannot be dropped if the URL is truncated.
    const q = [
      'action=promptApprove',
      'promptOrigin=' + encodeURIComponent(origin),
      'qualityRating=' + encodeURIComponent(payload.qualityRating || ''),
      'promptUploadId=' + encodeURIComponent(promptUploadId),
      'prompt=',
      'ean=' + encodeURIComponent(payload.ean || ''),
      'author=' + encodeURIComponent(payload.author || ''),
      'workflow=' + encodeURIComponent(payload.workflow || 'Product replacement'),
      'productType=' + encodeURIComponent(payload.productType || ''),
      'productTypeVariant=' + encodeURIComponent(payload.productTypeVariant || ''),
      'subCategory=' + encodeURIComponent(payload.subCategory || ''),
      'template=' + encodeURIComponent(payload.template || ''),
      'priorEan=' + encodeURIComponent(payload.priorEan || ''),
      'matchLevel=' + encodeURIComponent(payload.matchLevel || ''),
      'model=' + encodeURIComponent(payload.model || ''),
      'imageSize=' + encodeURIComponent(payload.imageSize || ''),
      'imageShortCode=' + encodeURIComponent(payload.imageShortCode || ''),
      'imageName=' + encodeURIComponent(payload.imageName || ''),
      'shotSeq=' + encodeURIComponent(payload.shotSeq != null ? payload.shotSeq : ''),
      'appVersion=' + encodeURIComponent(payload.appVersion || APP_VERSION),
      'priorImage=' + encodeURIComponent(payload.priorImage || ''),
      'productImage=' + encodeURIComponent(payload.productImage || ''),
      'universalRow=' + encodeURIComponent(payload.universalRow || ''),
      'generationCount=' + encodeURIComponent(
        payload.generationCount != null ? payload.generationCount : (payload.regenCount != null ? payload.regenCount : '')
      ),
      'answerlyExecutionId=' + encodeURIComponent(payload.answerlyExecutionId || ''),
      'answerlyJobId=' + encodeURIComponent(payload.answerlyJobId || ''),
      'answerlyResultUrl=' + encodeURIComponent(payload.answerlyResultUrl || ''),
      'workflowTool=' + encodeURIComponent(payload.workflowTool || ''),
      'priorSource=' + encodeURIComponent(payload.priorSource || ''),
      'answerlyInputUrlA=' + encodeURIComponent(payload.answerlyInputUrlA || ''),
      'answerlyInputUrlB1=' + encodeURIComponent(payload.answerlyInputUrlB1 || ''),
      'answerlyInputUrlB2=' + encodeURIComponent(payload.answerlyInputUrlB2 || ''),
      'answerlyInputUrlB3=' + encodeURIComponent(payload.answerlyInputUrlB3 || ''),
      'answerlyInputUrlB4=' + encodeURIComponent(payload.answerlyInputUrlB4 || ''),
      'answerlyInputUrlB5=' + encodeURIComponent(payload.answerlyInputUrlB5 || ''),
      'answerlyInputUrlB6=' + encodeURIComponent(payload.answerlyInputUrlB6 || ''),
      'answerlyInputUrlB7=' + encodeURIComponent(payload.answerlyInputUrlB7 || ''),
      'answerlyInputUrlB8=' + encodeURIComponent(payload.answerlyInputUrlB8 || '')
    ].join('&');
    const data = await jsonp(q, 60000, PROMPT_DB_URL);
    if (data && !data.promptOrigin) data.promptOrigin = origin;
    if (data && data.qualityRating == null) data.qualityRating = payload.qualityRating || '';
    return data;
  }

  async function markRenderInProgress(ean) {
    const id = String(ean || '').replace(/\s+/g, '');
    if (!id || !FEED_URL) return;
    if (state.renderMarkedInProgress && state.renderMarkedInProgress[id]) return;
    try {
      const data = await jsonp(
        'action=pdpStatus&ean=' + encodeURIComponent(id) +
          '&status=' + encodeURIComponent('In progress'),
        30000
      );
      if (!state.renderMarkedInProgress) state.renderMarkedInProgress = {};
      state.renderMarkedInProgress[id] = true;
      const t = taskByEan(id);
      if (t) t.pdpImages = (data && data.pdpImages) || 'In progress';
      const row = assignmentRow(id);
      if (row) row.pdpImages = (data && data.pdpImages) || 'In progress';
    } catch (err) {
      console.warn('Could not set Render Tracker In progress', err);
    }
  }

  async function markRenderCompleted(ean, outputLink) {
    const id = String(ean || '').replace(/\s+/g, '');
    const link = String(outputLink || '').trim();
    if (!id || !FEED_URL) throw new Error('FEED_URL is not set.');
    if (!link || !/^https?:\/\//i.test(link)) {
      throw new Error('Paste a valid Google Drive folder/file link (https://…).');
    }
    const data = await jsonp(
      'action=pdpStatus&ean=' + encodeURIComponent(id) +
        '&status=' + encodeURIComponent('Completed') +
        '&outputLink=' + encodeURIComponent(link),
      45000
    );
    const t = taskByEan(id);
    if (t) {
      t.pdpImages = (data && data.pdpImages) || 'Completed';
      if (link) {
        t.outputLink = link;
        t.outputFolderId = folderIdFrom(link) || t.outputFolderId;
      }
    }
    const row = assignmentRow(id);
    if (row) {
      row.pdpImages = (data && data.pdpImages) || 'Completed';
      if (link) row.outputLink = link;
    }
    return data;
  }

  function closeCompleteDriveModal() {
    const modal = document.getElementById('wr-complete-drive-modal');
    if (modal) modal.hidden = true;
  }

  function openCompleteDriveModal(ean) {
    let modal = document.getElementById('wr-complete-drive-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'wr-complete-drive-modal';
      modal.className = 'wr-complete-modal';
      modal.hidden = true;
      modal.innerHTML =
        '<div class="wr-complete-modal-backdrop" data-complete-dismiss></div>' +
        '<div class="wr-complete-modal-panel" role="dialog" aria-modal="true" aria-labelledby="wr-complete-title">' +
          '<div class="wr-complete-modal-head">' +
            '<h2 id="wr-complete-title" class="wr-complete-modal-title">Mark task Completed?</h2>' +
            '<button type="button" class="wr-icon-btn" data-complete-dismiss title="Close" aria-label="Close">✕</button>' +
          '</div>' +
          '<p class="wr-complete-modal-copy">' +
            'Upload the zip to Google Drive, then paste the Drive folder (or file) link below. ' +
            'Submitting sets <strong>PDP Images = Completed</strong> on the Render Tracker and saves the link. ' +
            'Close without submitting to leave the task In progress.' +
          '</p>' +
          '<label class="wr-complete-field">' +
            '<span>Google Drive link</span>' +
            '<input type="url" class="wr-complete-input" data-complete-link ' +
              'placeholder="https://drive.google.com/drive/folders/…" autocomplete="off">' +
          '</label>' +
          '<p class="wr-complete-ean muted">EAN <span class="tp-mono" data-complete-ean></span></p>' +
          '<div class="wr-complete-modal-foot">' +
            '<button type="button" class="tp-btn tp-btn-ghost" data-complete-dismiss>Close without completing</button>' +
            '<button type="button" class="tp-btn tp-btn-primary" data-complete-submit>Submit &amp; mark Completed</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target.closest('[data-complete-dismiss]')) {
          closeCompleteDriveModal();
          showToast('Zip downloaded. Task left unchanged (not marked Completed).', false);
          return;
        }
        if (e.target.closest('[data-complete-submit]')) {
          const input = modal.querySelector('[data-complete-link]');
          const link = input ? String(input.value || '').trim() : '';
          const eanVal = modal.getAttribute('data-ean') || '';
          const btn = e.target.closest('[data-complete-submit]');
          if (btn) btn.disabled = true;
          markRenderCompleted(eanVal, link).then((data) => {
            closeCompleteDriveModal();
            showToast(
              'Render Tracker Updated · Completed' +
                (data && data.driveCol > 0 ? ' · Drive link saved' : '') +
                ' · EAN <span class="tp-mono">' + esc(eanVal) + '</span>.',
              false
            );
            if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
            else render();
          }).catch((err) => {
            if (btn) btn.disabled = false;
            showToast('Could not mark Completed: ' + esc((err && err.message) || err), false, { error: true });
          });
        }
      });
    }
    modal.setAttribute('data-ean', String(ean || ''));
    const eanEl = modal.querySelector('[data-complete-ean]');
    if (eanEl) eanEl.textContent = String(ean || '');
    const input = modal.querySelector('[data-complete-link]');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
    const submitBtn = modal.querySelector('[data-complete-submit]');
    if (submitBtn) submitBtn.disabled = false;
    modal.hidden = false;
  }

  function replaceApprovalBadge(t) {
    if (!t || !t.ean) return null;
    const ean = t.ean;
    let approved = {};
    let outputs = {};
    let rejected = {};
    let productType = '';
    if (state.workspace && state.workspace.ean === ean &&
        (state.workspace.mode === 'replace' || state.workspace.mode === 'choose')) {
      approved = state.workspace.approved || {};
      outputs = state.workspace.outputs || {};
      rejected = state.workspace.rejected || {};
      productType = state.workspace.productTypeName || '';
    } else if (state.replaceDraftCache && state.replaceDraftCache[ean]) {
      const d = state.replaceDraftCache[ean];
      approved = d.approved || {};
      outputs = d.outputs || {};
      rejected = d.rejected || {};
      productType = d.productTypeName || '';
    }
    const approvedN = Object.keys(approved).length;
    const rejectedN = Object.keys(rejected).filter((k) => rejected[k] && !approved[k]).length;
    const outputN = Object.keys(outputs).filter((k) => outputs[k]).length;
    if (!outputN && !approvedN && !rejectedN) return null;

    let expected = 0;
    try {
      const prevPt = state.workspace && state.workspace.productTypeName;
      const prevVar = state.workspace && state.workspace.productTypeVariant;
      if (state.workspace && productType) {
        state.workspace.productTypeName = productType;
        if (state.replaceDraftCache && state.replaceDraftCache[ean]) {
          state.workspace.productTypeVariant = state.replaceDraftCache[ean].productTypeVariant || '';
        }
      }
      const shots = shotListFor(t).filter((s) => !isDimensionShot(s));
      expected = shots.length;
      if (state.workspace && productType) {
        state.workspace.productTypeName = prevPt;
        state.workspace.productTypeVariant = prevVar;
      }
    } catch (e) {
      expected = 0;
    }

    if (expected > 0 && approvedN >= expected) {
      return {
        cls: 'is-approved-all',
        label: 'All approved',
        detail: approvedN + ' shot' + (approvedN === 1 ? '' : 's') + ' rated & approved'
      };
    }
    if (rejectedN > 0 && approvedN === 0) {
      return {
        cls: 'is-rejected',
        label: 'Rejected · needs rework',
        detail: rejectedN + ' shot' + (rejectedN === 1 ? '' : 's') + ' rated 1–3★ — regenerate before approve'
      };
    }
    if (approvedN > 0 || rejectedN > 0) {
      return {
        cls: 'is-partial',
        label: 'Partially approved',
        detail: approvedN + (expected ? '/' + expected : '') + ' approved' +
          (rejectedN ? ' · ' + rejectedN + ' rejected' : '') +
          (outputN > approvedN ? ' · ' + (outputN - approvedN) + ' still pending' : '')
      };
    }
    if (outputN > 0) {
      return {
        cls: 'is-pending',
        label: 'Approval pending',
        detail: outputN + ' generated shot' + (outputN === 1 ? '' : 's') + ' waiting for Rate & Approve'
      };
    }
    return null;
  }

  function orderedRailShots(shots) {
    return (shots || []).map((s, idx) => ({ s: s, idx: idx })).sort((a, b) => {
      const am = isMainShot(a.s) ? 1 : 0;
      const bm = isMainShot(b.s) ? 1 : 0;
      if (am !== bm) return am - bm;
      return a.idx - b.idx;
    });
  }

  function mainShotIndex(shots) {
    return (shots || []).findIndex((s) => isMainShot(s));
  }

  // Prefer first angle / content shot (not MAIN) — same idea as Replace starting on H-FR Drive rail.
  function defaultWorkspaceShotIndex(shots) {
    const list = shots || [];
    const first = list.findIndex((s) => !isMainShot(s));
    return first >= 0 ? first : 0;
  }

  function isAngleSourceShot(shot, shots) {
    if (!shot || isMainShot(shot)) return false;
    const src = mainAngleSourceShot(shots || []);
    if (!src) return false;
    return String(src.code || '').toUpperCase() === String(shot.code || '').toUpperCase() &&
      String(src.name || '') === String(shot.name || '');
  }

  async function maybeAutoGenerateMain(fromShotIndex) {
    if (!state.workspace) return;
    const mode = state.workspace.mode;
    if (mode !== 'replace' && mode !== 'primary') return;
    const task = taskByEan(state.workspace.ean);
    if (!task) return;
    const shots = shotListFor(task);
    const fromShot = shots[fromShotIndex];
    if (!fromShot || !isAngleSourceShot(fromShot, shots)) return;
    const mainIdx = mainShotIndex(shots);
    if (mainIdx < 0) return;
    if (state.workspace.outputs && state.workspace.outputs[mainIdx] &&
        shotAssets(mainIdx).output && shotAssets(mainIdx).output.url) {
      return; // already have MAIN
    }
    // Do not copy Hero Front B onto MAIN UI — borrow only at Answerly submit time.
    const productRefs = productInputsForShot(mainIdx, shots);
    if (!productRefs.inputs.length) {
      showToast('MAIN ready to auto-run after Hero Front — add product input B on Hero Front / 01 (or MAIN) first.', false);
      return;
    }
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (state.workspace.prompts[mainIdx] == null || !String(state.workspace.prompts[mainIdx]).trim()) {
      if (mode === 'primary') {
        state.workspace.prompts[mainIdx] =
          compilePrimaryPrompt(task, shots[mainIdx], { shotIndex: mainIdx }).text;
      } else {
        const prior = resolveWorkspaceMatch(task).selected;
        state.workspace.prompts[mainIdx] = compileReplacePrompt(task, shots[mainIdx], prior).text;
      }
    }
    const promptText = state.workspace.prompts[mainIdx];
    state.workspaceShot = mainIdx;
    markShotBusy(mainIdx, 'Auto MAIN…');
    state.workspace.panelOpen = true;
    renderWorkspace();
    clearCancelFlags();
    try {
      if (mode === 'primary') {
        await runAnswerlyPrimaryForShot(mainIdx, promptText);
      } else {
        await runAnswerlyForShot(mainIdx, promptText, { requireMainFromHeroOutput: true });
      }
      showToast('MAIN auto-generated from ' + (fromShot.name || fromShot.code || 'Hero Front') + ' D.', false);
    } catch (err) {
      if (isCancelError(err)) showToast('MAIN auto-generate cancelled.', false);
      else showToast('MAIN auto-generate failed: ' + esc((err && err.message) || err), false, { error: true });
    } finally {
      if (state.workspace) {
        clearShotBusy(mainIdx);
        clearCancelFlags();
        if (mode === 'primary') persistCurrentPrimaryDraft();
        else persistCurrentReplaceDraft();
        renderWorkspace();
      }
    }
  }

  function shotHasGeneratedOutput(shotIdx) {
    const out = shotAssets(shotIdx).output;
    if (!(out && (out.blob || out.file || out.url))) return false;
    // outputs[] flag may lag; blob/file is enough proof D exists for MAIN gating.
    return true;
  }

  function shotHasProductInputs(shotIdx) {
    const a = shotAssets(shotIdx);
    return !!(a.inputs && a.inputs.length);
  }

  function angleSourceShotIndex(shots) {
    const angle = mainAngleSourceShot(shots);
    if (!angle) return -1;
    return (shots || []).findIndex((s) =>
      String(s.code || '').toUpperCase() === String(angle.code || '').toUpperCase() &&
      String(s.name || '') === String(angle.name || ''));
  }

  // MAIN in Generate all: only when Hero Front / 01 already has D, or will run (has B).
  // Other shots: only when that shot has its own B.
  function shotEligibleForGenAll(shotIdx, shots) {
    const shot = shots && shots[shotIdx];
    if (shot && isMainShot(shot)) {
      const angleIdx = angleSourceShotIndex(shots);
      if (angleIdx < 0) return false;
      const angleHasD = shotHasGeneratedOutput(angleIdx);
      const angleWillRun = shotHasProductInputs(angleIdx);
      if (!angleHasD && !angleWillRun) return false;
      // Product refs: MAIN B or borrow from angle B (same as approve → auto-MAIN).
      return shotHasProductInputs(shotIdx) || shotHasProductInputs(angleIdx);
    }
    return shotHasProductInputs(shotIdx);
  }

  /** Primary gen-all eligibility (MAIN waits on Hero Front / 01 like Replacement). */
  function shotEligibleForPrimaryGenAll(shotIdx, shots) {
    const shot = shots && shots[shotIdx];
    if (!shot || isDimensionShot(shot)) return false;
    if (isMainShot(shot)) {
      const angleIdx = angleSourceShotIndex(shots);
      if (angleIdx < 0) return false;
      const angleHasD = shotHasGeneratedOutput(angleIdx);
      const angleWillRun = shotHasProductInputs(angleIdx) &&
        !!(primaryInputPlan(angleIdx, { shots: shots }).hasA1 ||
          primaryInputPlan(angleIdx, { shots: shots }).hasA2);
      if (!angleHasD && !angleWillRun) return false;
      return productInputsForShot(shotIdx, shots).inputs.length > 0;
    }
    const ready = pickAnswerlyPrimaryPayload(shotIdx);
    return !!(ready && ready.ok);
  }

  /** Primary gen-all: ready A1|A2 + B; MAIN last after Hero Front / 01. Skips M-DIM. */
  function primaryGenAllPendingCandidates(task, shots, opts) {
    opts = opts || {};
    const includeDone = !!opts.includeDone;
    const list = [];
    (shots || []).forEach((shot, shotIdx) => {
      if (!shot || isDimensionShot(shot)) return;
      if (!includeDone && shotHasGeneratedOutput(shotIdx)) return;
      if (!shotEligibleForPrimaryGenAll(shotIdx, shots)) return;
      // Non-MAIN must be Answerly-ready now; MAIN may be waiting on Hero Front D.
      if (!isMainShot(shot)) {
        const ready = pickAnswerlyPrimaryPayload(shotIdx);
        if (!(ready && ready.ok)) return;
      } else {
        // MAIN: include when Hero Front has/will have D and product B exists.
        const angleIdx = angleSourceShotIndex(shots);
        if (angleIdx < 0) return;
        if (!productInputsForShot(shotIdx, shots).inputs.length) return;
      }
      list.push({ shotIdx: shotIdx, code: shot.code || ('S' + (shotIdx + 1)) });
    });
    return list.slice().sort((a, b) => {
      const am = isMainShot(shots[a.shotIdx]) ? 1 : 0;
      const bm = isMainShot(shots[b.shotIdx]) ? 1 : 0;
      if (am !== bm) return am - bm;
      return a.shotIdx - b.shotIdx;
    });
  }

  function countGeneratedPrimaryShots(shots) {
    let n = 0;
    (shots || []).forEach((shot, idx) => {
      if (shot && !isDimensionShot(shot) && shotHasGeneratedOutput(idx)) n += 1;
    });
    return n;
  }

  async function genAllPrimaryOneShot(task, shots, item) {
    if (isShotCancelRequested(item.shotIdx)) throw makeCancelledError();
    const shot = shots[item.shotIdx];
    const assets = shotAssets(item.shotIdx);
    if (isMainShot(shot)) {
      const angleIdx = angleSourceShotIndex(shots);
      if (angleIdx < 0) throw new Error('No Hero Front / seq 01 shot to build MAIN from');
      if (!productInputsForShot(item.shotIdx, shots).inputs.length) {
        throw new Error('No product B on Hero Front / 01 (or MAIN) — skipped');
      }
      markShotBusy(item.shotIdx, 'Waiting for Hero Front…');
      await waitForAngleSourceOutput(shots, angleIdx, { mainIdx: item.shotIdx });
    }
    const ready = pickAnswerlyPrimaryPayload(item.shotIdx);
    if (!(ready && ready.ok)) throw new Error(ready.error || 'Primary inputs not ready');
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (state.workspace.prompts[item.shotIdx] == null ||
        !String(state.workspace.prompts[item.shotIdx]).trim()) {
      state.workspace.prompts[item.shotIdx] =
        compilePrimaryPrompt(task, shot, { shotIndex: item.shotIdx }).text;
    }
    const promptText = state.workspace.prompts[item.shotIdx];
    assets.error = null;
    markShotBusy(item.shotIdx, isMainShot(shot) ? 'MAIN from Hero Front…' : 'Queued…');
    await runAnswerlyPrimaryForShot(item.shotIdx, promptText);
  }

  function startGenerateAllPrimaryBatch(task, shots, pending, includeDone) {
    const batchEan = String(task.ean);
    const mainItems = pending.filter((p) => isMainShot(shots[p.shotIdx]));
    const otherItems = pending.filter((p) => !isMainShot(shots[p.shotIdx]));
    const skipNote = [];
    let withoutB = 0;
    (shots || []).forEach((shot, idx) => {
      if (!shot || isDimensionShot(shot)) return;
      if (shotEligibleForPrimaryGenAll(idx, shots)) return;
      if (!includeDone && shotHasGeneratedOutput(idx)) return;
      withoutB += 1;
    });
    if (withoutB) skipNote.push(withoutB + ' without A1/A2 + B');
    skipNote.push('M-DIM skipped');
    clearCancelFlags();
    state.workspace.busyShots = {};
    state.workspace.activeJobIds = {};
    otherItems.forEach((item) => { markShotBusy(item.shotIdx, 'Queued…'); });
    mainItems.forEach((item) => { markShotBusy(item.shotIdx, 'Waiting for Hero Front…'); });
    state.workspace.genAllBatch = {
      ean: batchEan,
      total: pending.length,
      mode: includeDone ? 'regen' : 'skip',
      parallel: true,
      primary: true,
      cancelRequested: false
    };
    state.workspace.genStage = otherItems.length
      ? (otherItems.length + ' in parallel' + (mainItems.length ? ' · MAIN after H-FR' : ''))
      : (mainItems.length ? 'MAIN after Hero Front' : '');
    state.workspace.panelOpen = true;
    renderWorkspace();
    showToast(
      (includeDone ? 'Regenerating ' : 'Generating ') + otherItems.length + ' Primary shot' +
        (otherItems.length === 1 ? '' : 's') +
        (mainItems.length ? ' + MAIN after Hero Front / 01' : '') +
        (skipNote.length ? ' — skipped ' + skipNote.join(', ') : '') +
        '. Jobs need product image(s) on B.',
      false
    );

    // Non-MAIN in parallel; MAIN after Hero Front D (wait inside genAllPrimaryOneShot).
    Promise.all(otherItems.map((item) =>
      genAllPrimaryOneShot(task, shots, item).catch((err) => {
        if (!isCancelError(err)) {
          shotAssets(item.shotIdx).error = (err && err.message) || 'Generation failed';
        }
        clearShotBusy(item.shotIdx);
      })
    )).then(() => Promise.all(mainItems.map((item) =>
      genAllPrimaryOneShot(task, shots, item).catch((err) => {
        if (!isCancelError(err)) {
          shotAssets(item.shotIdx).error = (err && err.message) || 'Generation failed';
        }
        clearShotBusy(item.shotIdx);
      })
    ))).then(() => {
      if (!state.workspace || String(state.workspace.ean) !== batchEan) return;
      delete state.workspace.genAllBatch;
      syncGenFocus();
      persistCurrentPrimaryDraft();
      showToast('Primary Generate all finished.', false);
      renderWorkspace();
    }).catch(() => {
      if (!state.workspace || String(state.workspace.ean) !== batchEan) return;
      delete state.workspace.genAllBatch;
      syncGenFocus();
      persistCurrentPrimaryDraft();
      renderWorkspace();
    });
  }

  // opts.includeDone = true → regenerate (include shots that already have D).
  // Only shots with their own B are queued. MAIN is also queued when H-FR / 01 has B.
  // Product Dimension (M-DIM) is never included — it uses Apply to export, not Answerly generate.
  function genAllPendingCandidates(task, prior, shots, opts) {
    opts = opts || {};
    const includeDone = !!opts.includeDone;
    const mapInfo = priorTargetCodeMap(prior, shots);
    const list = (mapInfo.mapped || []).filter((m) => {
      const shot = shots[m.shotIdx];
      if (!shot) return false;
      if (isDimensionShot(shot)) return false;
      if (!includeDone && shotHasGeneratedOutput(m.shotIdx)) return false;
      if (!shotEligibleForGenAll(m.shotIdx, shots)) return false;
      return true;
    });
    // MAIN last: include when eligible via own B or Hero Front / seq 01 B.
    const mainIdx = mainShotIndex(shots);
    if (mainIdx >= 0 && !isDimensionShot(shots[mainIdx])) {
      const hasMainOut = shotHasGeneratedOutput(mainIdx);
      if ((includeDone || !hasMainOut) &&
          shotEligibleForGenAll(mainIdx, shots) &&
          !list.some((m) => m.shotIdx === mainIdx)) {
        const angle = mainAngleSourceShot(shots);
        const angleMap = angle
          ? (mapInfo.mapped || []).find((m) => {
              const s = shots[m.shotIdx];
              return s && String(s.code || '').toUpperCase() === String(angle.code || '').toUpperCase();
            })
          : null;
        list.push({
          shotIdx: mainIdx,
          imgIdx: angleMap ? angleMap.imgIdx : (list[0] ? list[0].imgIdx : 0),
          code: (shots[mainIdx] && shots[mainIdx].code) || 'MAIN'
        });
      }
    }
    // MAIN last so angle-source shots (e.g. H-FR) run first when batching.
    return list.slice().sort((a, b) => {
      const am = isMainShot(shots[a.shotIdx]) ? 1 : 0;
      const bm = isMainShot(shots[b.shotIdx]) ? 1 : 0;
      if (am !== bm) return am - bm;
      return a.shotIdx - b.shotIdx;
    });
  }

  function countGeneratedMappedShots(task, prior, shots) {
    const mapInfo = priorTargetCodeMap(prior, shots);
    let n = 0;
    (mapInfo.mapped || []).forEach((m) => {
      if (shotHasGeneratedOutput(m.shotIdx)) n++;
    });
    const mainIdx = mainShotIndex(shots);
    if (mainIdx >= 0 && shotHasGeneratedOutput(mainIdx) &&
        !(mapInfo.mapped || []).some((m) => m.shotIdx === mainIdx)) {
      n++;
    }
    return n;
  }

  function openGenAllChoiceModal(doneCount, pendingCount, onSkip, onRegen) {
    let overlay = document.getElementById('wr-gen-all-choice');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'wr-gen-all-choice';
    overlay.className = 'wr-gen-all-modal';
    overlay.innerHTML =
      '<div class="wr-gen-all-modal-backdrop" data-gen-all-close></div>' +
      '<div class="wr-gen-all-modal-card" role="dialog" aria-modal="true" aria-labelledby="wr-gen-all-title">' +
        '<h3 id="wr-gen-all-title">Generate all pending</h3>' +
        '<p><strong>' + doneCount + '</strong> shot' + (doneCount === 1 ? '' : 's') +
          ' already have an image in D. How should Generate all continue?</p>' +
        '<ul class="wr-gen-all-modal-list">' +
          '<li><strong>Skip already generated</strong> — only run the ' + pendingCount +
            ' empty shot' + (pendingCount === 1 ? '' : 's') + ' (safe mid-process).</li>' +
          '<li><strong>Regenerate all</strong> — overwrite every mapped shot including ones already in D.</li>' +
        '</ul>' +
        '<div class="wr-gen-all-modal-actions">' +
          '<button type="button" class="tp-btn tp-btn-ghost" data-gen-all-close>Cancel</button>' +
          '<button type="button" class="tp-btn tp-btn-ghost" data-gen-all-regen>Regenerate all</button>' +
          '<button type="button" class="tp-btn tp-btn-primary" data-gen-all-skip>Skip already generated</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    function close() {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-gen-all-close]')) {
        close();
        return;
      }
      if (e.target.closest('[data-gen-all-skip]')) {
        close();
        if (typeof onSkip === 'function') onSkip();
        return;
      }
      if (e.target.closest('[data-gen-all-regen]')) {
        close();
        if (typeof onRegen === 'function') onRegen();
      }
    });
  }

  function mainHasProductRefs(mainIdx, shots) {
    return productInputsForShot(mainIdx, shots).inputs.length > 0;
  }

  async function waitForAngleSourceOutput(shots, angleIdx, opts) {
    opts = opts || {};
    const label = (shots[angleIdx] && (shots[angleIdx].name || shots[angleIdx].code)) || 'Hero Front';
    const deadline = Date.now() + (opts.timeoutMs || 12 * 60 * 1000);
    while (Date.now() < deadline) {
      if (isShotCancelRequested(opts.mainIdx != null ? opts.mainIdx : -1) ||
          (state.workspace && state.workspace.cancelAll) ||
          (state.workspace && state.workspace.genAllBatch && state.workspace.genAllBatch.cancelRequested)) {
        throw makeCancelledError();
      }
      if (shotHasGeneratedOutput(angleIdx)) {
        const out = shotAssets(angleIdx).output;
        if (out && (out.blob || out.file || out.url)) return out;
      }
      // Angle failed permanently — stop waiting.
      const err = shotAssets(angleIdx).error;
      if (err && !isShotBusy(angleIdx)) {
        throw new Error(label + ' failed — MAIN needs its D as A (' + err + ')');
      }
      markShotBusy(opts.mainIdx != null ? opts.mainIdx : angleIdx, 'Waiting for ' + label + '…');
      if (state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        state.workspace.genStage = 'MAIN waiting for ' + label;
        renderWorkspace();
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    throw new Error('Timed out waiting for ' + label + ' before MAIN');
  }

  async function genAllOneShot(task, prior, shots, item) {
    if (isShotCancelRequested(item.shotIdx)) throw makeCancelledError();
    const shot = shots[item.shotIdx];
    // MAIN: wait for Hero Front / 01 D → that becomes A; MAIN prompt → D.
    // Same as approve→auto-MAIN, except Generate all does not wait for Rate & Approve.
    if (isMainShot(shot)) {
      const angleIdx = angleSourceShotIndex(shots);
      if (angleIdx < 0) throw new Error('No Hero Front / seq 01 shot to build MAIN from');
      if (!mainHasProductRefs(item.shotIdx, shots)) {
        throw new Error('No product B on Hero Front / 01 (or MAIN) — skipped');
      }
      markShotBusy(item.shotIdx, 'Waiting for Hero Front…');
      await waitForAngleSourceOutput(shots, angleIdx, { mainIdx: item.shotIdx });
      const angleOut = shotAssets(angleIdx).output;
      if (!(angleOut && (angleOut.blob || angleOut.file))) {
        throw new Error('Hero Front / 01 D missing — cannot build MAIN');
      }
    }
    const assets = shotAssets(item.shotIdx);
    if (!isMainShot(shot) && !(assets.inputs && assets.inputs.length)) {
      throw new Error('No product input B — skipped (add B on this shot)');
    }
    if (isMainShot(shot) && !mainHasProductRefs(item.shotIdx, shots)) {
      throw new Error('No product B on Hero Front / 01 (or MAIN) — skipped');
    }
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (state.workspace.prompts[item.shotIdx] == null ||
        !String(state.workspace.prompts[item.shotIdx]).trim()) {
      state.workspace.prompts[item.shotIdx] = compileReplacePrompt(task, shot, prior).text;
    }
    const promptText = state.workspace.prompts[item.shotIdx];
    assets.error = null;
    markShotBusy(item.shotIdx, isMainShot(shot) ? 'MAIN from Hero Front…' : 'Queued…');
    await runAnswerlyForShot(item.shotIdx, promptText, {
      driveImgIndex: item.imgIdx,
      requireMainFromHeroOutput: isMainShot(shot)
    });
  }

  // Parallel Answerly for normal shots; MAIN runs after Hero Front / 01 D is ready.
  function startGenerateAllBatch(task, prior, shots, pending, mapInfo, includeDone) {
    const mainIdx = mainShotIndex(shots);
    const angleIdx = angleSourceShotIndex(shots);
    const mainItems = pending.filter((p) => isMainShot(shots[p.shotIdx]));
    let otherItems = pending.filter((p) => !isMainShot(shots[p.shotIdx]));

    // If MAIN is queued but Hero Front isn't in the batch and has no D yet, add H-FR when it has B.
    if (mainItems.length && angleIdx >= 0 && !shotHasGeneratedOutput(angleIdx) &&
        !otherItems.some((p) => p.shotIdx === angleIdx)) {
      if (shotHasProductInputs(angleIdx)) {
        const mapInfoItem = (mapInfo.mapped || []).find((m) => m.shotIdx === angleIdx);
        otherItems = otherItems.concat([{
          shotIdx: angleIdx,
          imgIdx: mapInfoItem ? mapInfoItem.imgIdx : 0,
          code: (shots[angleIdx] && shots[angleIdx].code) || 'H-FR'
        }]);
      }
    }

    if (mainItems.length && mainIdx >= 0) {
      scrubBorrowedMainInputs(shots);
    }

    const skipNote = [];
    const withoutB = (mapInfo.mapped || []).filter((m) =>
      !shotEligibleForGenAll(m.shotIdx, shots) &&
      (includeDone || !shotHasGeneratedOutput(m.shotIdx))
    ).length;
    if (withoutB) skipNote.push(withoutB + ' without B');
    if (mapInfo.unmappedPrior && mapInfo.unmappedPrior.length) {
      skipNote.push(mapInfo.unmappedPrior.length + ' unmatched prior');
    }
    if (mapInfo.missingTarget && mapInfo.missingTarget.length) {
      skipNote.push(mapInfo.missingTarget.length + ' new shot' + (mapInfo.missingTarget.length === 1 ? '' : 's'));
    }
    if (state.workspace.dimSeparate) skipNote.push('M-DIM (dim separate)');
    const totalN = otherItems.length + mainItems.length;
    showToast(
      (includeDone ? 'Regenerating ' : 'Generating ') + otherItems.length + ' shot' +
        (otherItems.length === 1 ? '' : 's') +
        (mainItems.length ? ' + MAIN after Hero Front / 01' : '') +
        (skipNote.length ? ' — skipped ' + skipNote.join(', ') : '') +
        '. Jobs need product image(s) on B.',
      false
    );
    pending = otherItems.concat(mainItems);

    const batchEan = String(task.ean);
    // Pin live asset map so jobs keep working if the user leaves this EAN mid-batch.
    const pinnedAssets = state.workspace.assets;
    const pinnedPrompts = state.workspace.prompts || {};
    const pinnedOutputs = state.workspace.outputs || {};
    clearCancelFlags();
    state.workspace.busyShots = {};
    state.workspace.activeJobIds = {};
    otherItems.forEach((item) => { markShotBusy(item.shotIdx, 'Queued…'); });
    mainItems.forEach((item) => { markShotBusy(item.shotIdx, 'Waiting for Hero Front…'); });
    state.workspace.genAllBatch = {
      ean: batchEan,
      total: totalN,
      mode: includeDone ? 'regen' : 'skip',
      parallel: true,
      cancelRequested: false
    };
    state.workspace.genStage = otherItems.length
      ? (otherItems.length + ' in parallel' + (mainItems.length ? ' · MAIN after H-FR' : ''))
      : (mainItems.length ? 'MAIN after Hero Front' : '');
    state.workspace.panelOpen = true;
    renderWorkspace();

    function withBatchWorkspace(fn) {
      const stillHere = state.workspace &&
        state.workspace.mode === 'replace' &&
        String(state.workspace.ean) === batchEan;
      if (stillHere) return fn();
      if (!(state.replaceDraftCache && state.replaceDraftCache[batchEan])) {
        return Promise.reject(new Error('draft assets missing after leaving EAN'));
      }
      const prev = state.workspace;
      state.workspace = {
        mode: 'replace',
        ean: batchEan,
        assets: pinnedAssets || state.replaceDraftCache[batchEan].assets,
        prompts: pinnedPrompts,
        outputs: pinnedOutputs,
        approved: state.replaceDraftCache[batchEan].approved || {},
        rejected: state.replaceDraftCache[batchEan].rejected || {},
        productTypeName: state.replaceDraftCache[batchEan].productTypeName || '',
        productTypeVariant: state.replaceDraftCache[batchEan].productTypeVariant || '',
        matchEan: state.replaceDraftCache[batchEan].matchEan || '',
        dimSeparate: !!state.replaceDraftCache[batchEan].dimSeparate,
        busyShots: (prev && prev.busyShots) || {},
        genAllBatch: {
          ean: batchEan,
          total: totalN,
          mode: includeDone ? 'regen' : 'skip',
          parallel: true,
          cancelRequested: !!(prev && prev.genAllBatch && prev.genAllBatch.cancelRequested)
        },
        cancelAll: !!(prev && prev.cancelAll),
        panelOpen: false
      };
      return Promise.resolve()
        .then(fn)
        .then((value) => {
          state.replaceDraftCache[batchEan].assets = state.workspace.assets;
          state.replaceDraftCache[batchEan].outputs = Object.assign({}, state.workspace.outputs || {});
          state.replaceDraftCache[batchEan].prompts = Object.assign({}, state.workspace.prompts || {});
          state.replaceDraftCache[batchEan].savedAt = Date.now();
          state.workspace = prev;
          return value;
        }, (err) => {
          if (state.workspace && String(state.workspace.ean) === batchEan) {
            state.replaceDraftCache[batchEan].assets = state.workspace.assets;
            state.replaceDraftCache[batchEan].outputs = Object.assign({}, state.workspace.outputs || {});
          }
          state.workspace = prev;
          throw err;
        });
    }

    function settleOne(item) {
      return withBatchWorkspace(() => genAllOneShot(task, prior, shots, item))
        .then(() => ({ ok: true, item: item }))
        .catch((err) => {
          const cancelled = isCancelError(err);
          const msg = cancelled ? 'Cancelled' : ((err && err.message) || 'Generation failed');
          try {
            withBatchWorkspace(() => {
              const a = shotAssets(item.shotIdx);
              if (cancelled) a.error = null;
              else a.error = msg;
            });
          } catch (e) { /* ignore */ }
          return {
            ok: false,
            cancelled: cancelled,
            item: item,
            error: msg,
            code: (shots[item.shotIdx] && shots[item.shotIdx].code) || String(item.shotIdx)
          };
        });
    }

    // 1) Parallel non-MAIN shots  2) Then MAIN after Hero Front / 01 D exists.
    Promise.resolve()
      .then(() => Promise.allSettled(otherItems.map(settleOne)))
      .then((otherSettled) => {
        const otherResults = otherSettled.map((r) =>
          r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) }
        );
        return mainItems.reduce((chain, item) => chain.then((acc) =>
          settleOne(item).then((val) => acc.concat([val]))
        ), Promise.resolve(otherResults));
      })
      .then((results) => {
      let okCount = 0;
      let failCount = 0;
      let cancelCount = 0;
      const failReasons = [];
      results.forEach((val) => {
        if (val && val.ok) okCount++;
        else if (val && val.cancelled) cancelCount++;
        else {
          failCount++;
          if (val && val.error) failReasons.push((val.code || '') + ': ' + val.error);
        }
      });
      const stillHere = state.workspace &&
        state.workspace.mode === 'replace' &&
        String(state.workspace.ean) === batchEan;
      if (stillHere) {
        state.workspace.generating = null;
        state.workspace.genStage = '';
        state.workspace.busyShots = {};
        state.workspace.activeJobIds = {};
        clearCancelFlags();
        delete state.workspace.genAllBatch;
        persistCurrentReplaceDraft();
        renderWorkspace();
      } else if (state.replaceDraftCache && state.replaceDraftCache[batchEan]) {
        state.replaceDraftCache[batchEan].savedAt = Date.now();
      }
      const failHint = failReasons.length
        ? ' · ' + failReasons.slice(0, 2).join('; ')
        : '';
      const wasCancelled = cancelCount > 0;
      showToast(
        (wasCancelled ? 'Generate all cancelled' : 'Generate all done') +
          ' · EAN ' + batchEan + ' · ' + okCount + ' ok' +
          (cancelCount ? ' · ' + cancelCount + ' cancelled' : '') +
          (failCount ? ' · ' + failCount + ' failed' + failHint : '') + '.',
        false,
        failCount && !wasCancelled ? { error: true } : undefined
      );
    })
    .catch((err) => {
      console.error(err);
      if (state.workspace && String(state.workspace.ean) === batchEan) {
        state.workspace.generating = null;
        state.workspace.genStage = '';
        state.workspace.busyShots = {};
        clearCancelFlags();
        delete state.workspace.genAllBatch;
        renderWorkspace();
      }
      showToast('Generate all failed: ' + esc((err && err.message) || err), false, { error: true });
    });
  }

  function priorFileName(prior, shot) {
    if (!prior) return 'prior_output.png';
    return prior.ean + '_' + String(shot.seq).padStart(2, '0') + '_' + shot.code + '.png';
  }

  function outputFileName(t, shot) {
    return t.ean + '_' + String(shot.seq).padStart(2, '0') + '_' + shot.code + '.png';
  }

  // Output name follows the selected Drive image (e.g. Front → …_01_H-FR.png), with the current task EAN.
  function synthesizeFileName(t, driveName, shot) {
    const base = String(driveName || '').replace(/^.*\//, '');
    if (base) {
      if (/^\d{13}_/i.test(base)) return t.ean + '_' + base.replace(/^\d{13}_/i, '');
      return t.ean + '_' + base;
    }
    return outputFileName(t, shot);
  }

  function priorFolderImages(prior) {
    if (!prior || !prior.folderId) return [];
    const list = state.images[prior.folderId];
    return Array.isArray(list) ? list : [];
  }

  // H-FR first, MAIN last; everything else in natural filename order.
  function driveSortBucket(name) {
    const n = String(name || '');
    if (/(?:^|[_-])H-FR(?:[_.-]|$)/i.test(n) || /_01_H-FR\b/i.test(n)) return 0;
    if (/(?:^|[_-])MAIN(?:[_.-]|$)/i.test(n)) return 2;
    return 1;
  }

  function sortPriorDriveImages(list) {
    return list.slice().sort((a, b) => {
      const ka = driveSortBucket(a.name);
      const kb = driveSortBucket(b.name);
      if (ka !== kb) return ka - kb;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  function priorDriveImages(prior) {
    return sortPriorDriveImages(priorFolderImages(prior));
  }

  function defaultDriveImgIndex(/* prior */) {
    // Always the first Drive image in the sorted rail (page open / refresh).
    return 0;
  }

  function resetDriveImgSelectionToFirst() {
    if (!state.workspace) return;
    state.workspace.driveImgIndex = 0;
    state.workspace.priorFetch = null;
  }

  function priorImgAt(prior, index, width) {
    const list = priorDriveImages(prior);
    if (!list.length) {
      return prior ? '<span class="wr-ph">' + esc((prior.title || '—').slice(0, 2).toUpperCase()) + '</span>' : '';
    }
    const img = list[Math.min(Math.max(0, index), list.length - 1)];
    return '<img class="tp-img" src="' + esc(thumbUrl(img, width || 320)) + '" alt="' + esc(img.name || '') + '" loading="lazy" referrerpolicy="no-referrer">';
  }

  function driveImgLabel(name) {
    const base = String(name || '').replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    const main = base.match(/(?:^|[_-])(MAIN)(?:[_.-]|$)/i);
    if (main) return 'MAIN';
    const code = base.match(/_(\d{2})_([A-Za-z0-9-]+)$/) || base.match(/_([A-Za-z0-9-]{2,})$/);
    if (code) return code[code.length - 1];
    return base || 'Image';
  }

  function shotIndexForDriveName(shots, name) {
    const label = driveImgLabel(name).toLowerCase();
    const list = shots || [];
    const byCode = list.findIndex((s) => String(s.code || '').toLowerCase() === label);
    if (byCode >= 0) return byCode;
    return list.findIndex((s) => {
      const code = String(s.code || '').toLowerCase();
      return code && (label.indexOf(code) >= 0 || code.indexOf(label) >= 0);
    });
  }

  // Compare prior Drive shot codes vs target Product Type + Variant shot list.
  // MAIN can be generated from Hero Front (or seq 01) even when prior has no MAIN file.
  function priorTargetCodeMap(prior, targetShots) {
    const imgs = priorDriveImages(prior);
    const shots = targetShots || [];
    const mapped = [];
    const unmappedPrior = [];
    const usedTarget = new Set();
    imgs.forEach((img, idx) => {
      const code = driveImgLabel(img.name);
      const shotIdx = shotIndexForDriveName(shots, img.name);
      if (shotIdx >= 0) {
        mapped.push({ imgIdx: idx, shotIdx: shotIdx, code: code, name: img.name });
        usedTarget.add(String(shots[shotIdx].code || '').toUpperCase());
      } else {
        unmappedPrior.push({ imgIdx: idx, code: code, name: img.name });
      }
    });

    const mainIdx = shots.findIndex((s) => isMainShot(s));
    if (mainIdx >= 0 && !usedTarget.has(String(shots[mainIdx].code || 'MAIN').toUpperCase())) {
      const angle = mainAngleSourceShot(shots);
      if (angle) {
        const angleCode = String(angle.code || '').toUpperCase();
        let imgIdx = imgs.findIndex((img) => String(driveImgLabel(img.name) || '').toUpperCase() === angleCode);
        if (imgIdx < 0 && angleCode) {
          imgIdx = imgs.findIndex((img) => {
            const label = String(driveImgLabel(img.name) || '').toUpperCase();
            return label === angleCode || label.indexOf(angleCode) >= 0 || angleCode.indexOf(label) >= 0;
          });
        }
        if (imgIdx < 0) {
          const seq = String(angle.seq != null ? angle.seq : '').padStart(2, '0');
          if (seq) {
            imgIdx = imgs.findIndex((img) => new RegExp('_' + seq + '_', 'i').test(String(img.name || '')));
          }
        }
        if (imgIdx >= 0) {
          mapped.push({
            imgIdx: imgIdx,
            shotIdx: mainIdx,
            code: 'MAIN',
            name: imgs[imgIdx].name,
            fromAngleSource: true
          });
          usedTarget.add(String(shots[mainIdx].code || 'MAIN').toUpperCase());
        }
      }
    }

    const missingTarget = shots.filter((s) => !usedTarget.has(String(s.code || '').toUpperCase()));
    return {
      mapped: mapped,
      unmappedPrior: unmappedPrior,
      missingTarget: missingTarget,
      hasConflict: !!(unmappedPrior.length || missingTarget.length) && !!shots.length && !!imgs.length
    };
  }

  function codeMapWarnHtml(mapInfo) {
    if (!mapInfo || !mapInfo.hasConflict) return '';
    const unmapped = mapInfo.unmappedPrior.map((x) => x.code).filter(Boolean);
    const missing = mapInfo.missingTarget.map((s) => s.code).filter(Boolean);
    const mappedN = mapInfo.mapped.length;
    return '<div class="wr-map-warn" role="status">' +
      '<div class="wr-map-warn-title">Shot-code mismatch between Prior Drive images and Target Product Type</div>' +
      '<div class="wr-map-warn-body">' +
        '<span><b>' + mappedN + '</b> can map and generate</span>' +
        (unmapped.length
          ? '<span>Unmapped prior: <span class="tp-mono">' + esc(unmapped.join(', ')) + '</span></span>'
          : '') +
        (missing.length
          ? '<span>Missing on prior: <span class="tp-mono">' + esc(missing.join(', ')) + '</span></span>'
          : '') +
      '</div>' +
      '<div class="wr-map-warn-note">Generate all pending only runs mapped shots that already have B. MAIN waits for Hero Front / 01 D, then uses that as A with the MAIN prompt (no Rate &amp; Approve).</div>' +
    '</div>';
  }

  function driveImgFullName(name, shots) {
    const label = driveImgLabel(name);
    const list = shots || [];
    const byCode = list.find((s) => String(s.code || '').toUpperCase() === String(label).toUpperCase());
    if (byCode && byCode.name) return byCode.name;
    const idx = shotIndexForDriveName(list, name);
    if (idx >= 0 && list[idx] && list[idx].name) return list[idx].name;
    if (/^main$/i.test(label)) return 'Hero Front - White Background';
    if (/^m-dim/i.test(label)) return 'Product Dimension';
    return label;
  }

  function isMDimCode(code) {
    return /^M-DIM/i.test(String(code || ''));
  }

  function productTypePickerHtml() {
    const selected = (state.workspace && state.workspace.productTypeName) || '';
    const query = state.workspace && state.workspace.productTypeQuery != null
      ? state.workspace.productTypeQuery
      : selected;
    const type = selectedNamingType();
    const variants = type && type.variants ? Object.keys(type.variants) : [];
    const variant = (state.workspace && state.workspace.productTypeVariant) || (variants[0] || '');
    const open = !!(state.workspace && state.workspace.productTypeOpen);
    const suggestions = findProductTypeSuggestions(query).slice(0, 40);
    const warn = !!(state.workspace && state.workspace.productTypeWarn);
    const listHtml = !suggestions.length
      ? '<li class="wr-pt-empty" role="option" aria-disabled="true">No matching product type</li>'
      : suggestions.map((t, i) =>
          '<li role="option" data-ws-pt-pick="' + esc(t.name) + '"' +
            (t.name === selected ? ' aria-selected="true" class="is-active"' : '') + '>' +
            '<span>' + esc(t.name) + '</span>' +
            '<span class="wr-pt-cat">' + esc(t.category || '') + '</span>' +
          '</li>').join('');
    return '<div class="wr-pt-block">' +
      '<div class="wr-pt-row">' +
        '<div class="wr-pt-field wr-pt-combo">' +
          '<label for="wr-pt-search">Product Type <span class="wr-pt-req">*</span></label>' +
          '<input id="wr-pt-search" type="text" class="wr-pt-input' + (warn ? ' is-warn' : '') + '" data-ws-pt-search' +
            ' placeholder="Search type..." autocomplete="off" role="combobox" aria-expanded="' + (open ? 'true' : 'false') + '"' +
            ' aria-controls="wr-pt-list" value="' + esc(query) + '">' +
          '<ul id="wr-pt-list" class="wr-pt-suggest" role="listbox" data-ws-pt-list' + (open ? '' : ' hidden') + '>' + listHtml + '</ul>' +
        '</div>' +
        '<div class="wr-pt-field' + (variants.length ? '' : ' is-disabled') + '">' +
          '<label for="wr-pt-variant">Variant</label>' +
          '<select id="wr-pt-variant" class="wr-pt-input" data-ws-pt-variant' + (variants.length ? '' : ' disabled') + '>' +
            (variants.length
              ? variants.map((v) =>
                  '<option value="' + esc(v) + '"' + (v === variant ? ' selected' : '') + '>' + esc(v) + '</option>').join('')
              : '<option>' + (type ? 'No variants' : 'Select type first') + '</option>') +
          '</select>' +
        '</div>' +
      '</div>' +
      (warn ? '<p class="wr-pt-warn">Choose a product type from the list.</p>' : '') +
      (!selected ? '<p class="wr-pt-hint">Required before generation — same list as Renamer.</p>' : '') +
    '</div>';
  }

  function eanCopyHtml(ean) {
    return '<span class="tp-mono">' + eanHtml(ean) +
      '<span class="tp-copy" data-action="copy-match" data-ean="' + esc(ean) + '" title="Copy EAN" aria-label="Copy EAN">' +
      ICON.copy + '</span></span>';
  }

  function searchQuery() {
    const q = state.search.trim().toLowerCase();
    return /^[\d\s]+$/.test(q) ? q.replace(/\s+/g, '') : q;
  }

  function matchesFilters(t) {
    if (state.category && t.category !== state.category) return false;
    if (!isMts() && state.template && t.template !== state.template) return false;
    if (state.view === 'available') {
      if (state.setKind && !(state.setKind === 'set' ? isSet(t) : t.setKind === state.setKind)) return false;
      if (!isMts() && artistFilterName() && !taskFitsArtist(t, artistFilterName())) return false;
    }
    return true;
  }

  function visibleTasks() {
    const q = searchQuery();
    return poolTasks().filter((t) => (!q || t.search.includes(q)) && matchesFilters(t));
  }

  // "Set" in the filter means anything filled in that is not PCs: Set, SET OF 2, SET OF 3 and any other value.
  function isSet(t) {
    return !!t.setLabel && t.setKind !== 'pcs';
  }

  function hasFilters() {
    if (isMts()) {
      return !!(state.category || (state.view === 'available' && state.setKind));
    }
    return !!(state.category || state.template ||
      (state.view === 'available' && (state.setKind || state.artist)));
  }

  // When a search finds nothing, says why each matching product is not listed.
  function searchMissHtml(q) {
    const m = state.model;
    const hits = m.products.filter((p) => p.search.includes(q)).slice(0, 8);
    const sourceLabel = isMts() ? 'MTS Furniture Sheet1' : 'Shoot Tracker tabs that were read';
    if (!hits.length) return '<strong>No product matches "' + esc(state.search.trim()) + '"</strong>It is not in the ' + sourceLabel + '.';
    const lines = hits.map((p) => {
      const artist = isMts() ? '' : assignedArtist(p.ean);
      const why = p.hiddenReason || (artist ? 'assigned to ' + artist + ' in the Render Tracker'
        : !matchesFilters(p) ? 'hidden by the filters above' : 'available');
      return '<span class="tp-state-line"><span class="tp-mono">' + esc(p.ean) + '</span> ' + esc(p.title) + ': ' + esc(why) + '</span>';
    });
    const clear = hits.some((p) => !p.hiddenReason && (isMts() || !assignedArtist(p.ean))) && hasFilters()
      ? '<div class="tp-state-actions"><button type="button" class="tp-btn tp-btn-ghost" data-clear-filters>Clear filters</button></div>' : '';
    return '<strong>Not in the list</strong>' + lines.join('') + clear;
  }

  // Per category: how many products pass each listing rule, so a low count can be traced to one rule.
  function dataCheckHtml() {
    const m = state.model;
    if (isMts()) {
      const rows = m.categories.map((cat) => {
        const ps = m.products.filter((p) => p.category === cat);
        const drive = ps.filter((p) => p.driveLink);
        const both = drive.filter((p) => p.pdpLink);
        const open = both.filter((p) => !p.hiddenReason);
        return '<tr><th>' + esc(cat) + '</th><td>' + ps.length + '</td><td>' + drive.length +
          '</td><td>' + both.length + '</td><td>' + open.length + '</td><td>' + open.filter(isSet).length + '</td></tr>';
      });
      const saved = m.fileSavedAt ? new Date(m.fileSavedAt) : null;
      const savedLine = saved
        ? 'MTS Furniture last updated: ' + saved.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) +
          '. Open = GDRIVE folder link + PDP GUIDELINE LINK (no template / Render Tracker yet).'
        : 'Open = GDRIVE folder link + PDP GUIDELINE LINK (no template / Render Tracker yet).';
      return '<details class="tp-datacheck"' + (state.dataCheckOpen ? ' open' : '') + '><summary>Data check per MTS category</summary>' +
        '<div class="tp-datacheck-body"><p>' + esc(savedLine) + '</p>' +
        '<table><thead><tr><th>Category</th><th>Products</th><th>+ Drive folder</th>' +
        '<th>+ PDP guideline</th><th>Open</th><th>Open sets</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody></table></div></details>';
    }
    const notes = [];
    const rows = m.categories.map((cat) => {
      const ps = m.products.filter((p) => p.category === cat);
      const drive = ps.filter((p) => p.driveLink);
      const tpl = drive.filter((p) => p.template);
      const assigned = tpl.filter((p) => /^already assigned/.test(p.hiddenReason)).length;
      const open = tpl.filter((p) => !p.hiddenReason);
      const tplNoDrive = ps.filter((p) => p.template && !p.driveLink).length;
      const tplDriveText = ps.filter((p) => p.template && !p.driveLink && p.driveText).length;
      if (tplNoDrive) {
        notes.push(cat + ': ' + tplNoDrive + ' have template but no GDRIVE folder link' +
          (tplDriveText ? ' (' + tplDriveText + ' still show text in the GDRIVE cell)' : ''));
      }
      const badTpl = drive.filter((p) => !p.template && p.templateRaw).length;
      if (badTpl) notes.push(cat + ': ' + badTpl + ' template mappings are blank after reading the sheet.');
      return '<tr><th>' + esc(cat) + '</th><td>' + ps.length + '</td><td>' + drive.length + '</td><td>' +
        tpl.length + '</td><td>' + assigned + '</td><td>' + open.length + '</td><td>' + open.filter(isSet).length + '</td></tr>';
    });
    const saved = m.fileSavedAt ? new Date(m.fileSavedAt) : null;
    const savedLine = saved
      ? 'Shoot Tracker last updated: ' + saved.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) +
        '. Open = GDRIVE folder link + template mapping, and not yet on the Render Tracker.'
      : '';
    return '<details class="tp-datacheck"' + (state.dataCheckOpen ? ' open' : '') + '><summary>Data check per Shoot Tracker tab</summary>' +
      '<div class="tp-datacheck-body">' + (savedLine ? '<p>' + esc(savedLine) + '</p>' : '') +
      '<table><thead><tr><th>Tab</th><th>Products</th><th>+ Drive folder</th>' +
      '<th>+ Template</th><th>Has artist in Render Tracker</th><th>Open</th><th>Open sets</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody></table>' +
      notes.map((n) => '<p>' + esc(n) + '</p>').join('') + '</div></details>';
  }

  // Counts why products that fit the category / template / Set filters are not open tasks.
  function filterMissHtml() {
    const fits = state.model.products.filter((p) =>
      (!state.category || p.category === state.category) &&
      (isMts() || !state.template || p.template === state.template) &&
      (!state.setKind || (state.setKind === 'set' ? isSet(p) : p.setKind === state.setKind)));
    if (!fits.length) {
      return '<span class="tp-state-line">No product in the ' +
        (isMts() ? 'MTS Furniture sheet' : 'Shoot Tracker') + ' fits these filters.</span>';
    }
    const counts = new Map();
    fits.forEach((p) => {
      const why = !p.hiddenReason
        ? (isMts() ? 'hidden by filters' : 'hidden by the Artist filter')
        : /^already assigned/.test(p.hiddenReason) ? 'already assigned in the Render Tracker'
        : /^GDRIVE cell/.test(p.hiddenReason) || /^no GDRIVE/.test(p.hiddenReason) ? 'no readable GDRIVE folder link'
        : /^PDP guideline/.test(p.hiddenReason) || /^no PDP/.test(p.hiddenReason) ? 'no readable PDP guideline link'
        : /^template mapping/.test(p.hiddenReason) || /^no template/.test(p.hiddenReason) ? 'no template mapping'
        : p.hiddenReason;
      counts.set(why, (counts.get(why) || 0) + 1);
    });
    return '<span class="tp-state-line">' + fits.length + ' products fit these filters, none open:</span>' +
      [...counts.entries()].sort((a, b) => b[1] - a[1])
        .map(([why, n]) => '<span class="tp-state-line">' + n + ' · ' + esc(why) + '</span>').join('');
  }

  function clearFilters() {
    state.category = state.template = state.setKind = state.artist = '';
    els.category.value = els.template.value = els.setKind.value = els.artist.value = '';
    render();
  }

  // "~me" follows the Author name.
  function artistFilterName() {
    return (state.artist === '~me' ? state.author : state.artist).trim();
  }

  // My Tasks Active: In progress → Not started → Blocked (groups follow their best status).
  const ACTIVE_STATUS_RANK = { in_progress: 0, not_started: 1, blocked: 2, completed: 3 };

  function activeStatusRank(t) {
    const id = statusOf(t).id;
    return Object.prototype.hasOwnProperty.call(ACTIVE_STATUS_RANK, id) ? ACTIVE_STATUS_RANK[id] : 1;
  }

  function groupActiveRank(g) {
    let best = 99;
    g.tasks.forEach((t) => {
      const r = activeStatusRank(t);
      if (r < best) best = r;
    });
    return best;
  }

  function compareTasks(a, b) {
    if (state.view === 'my' && state.myBucket === 'active') {
      const byStatus = activeStatusRank(a) - activeStatusRank(b);
      if (byStatus) return byStatus;
    }
    const sort = state.view === 'my' ? 'oldest' : state.sort;
    if (sort === 'shots') return b.shots.length - a.shots.length || dateCmp(a, b, 1);
    return dateCmp(a, b, sort === 'newest' ? -1 : 1);
  }

  function dateCmp(a, b, dir) {
    if (!a.date && !b.date) return a.ean.localeCompare(b.ean);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return (a.date - b.date) * dir || a.ean.localeCompare(b.ean);
  }

  // HH: subTemplate / productTemplate / template.
  // MTS: subCategory / product (no template). My Tasks (HH only) always groups by Sub-category + Template.
  function groupTasks(tasks) {
    const by = isMts()
      ? (state.groupBy === 'product' ? 'product' : 'subCategory')
      : (state.view === 'my' ? 'subTemplate' : state.groupBy);
    const groups = new Map();
    tasks.forEach((t) => {
      let key;
      if (by === 'template') key = t.template;
      else if (by === 'productTemplate') key = t.productKey + '|' + t.template;
      else if (by === 'product') key = t.productKey || t.title.toLowerCase();
      else if (by === 'subCategory') key = t.subKey || '(none)';
      else key = t.subKey + '|' + t.template;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          template: by === 'subCategory' || by === 'product' ? '' : t.template,
          subCategory: by === 'template' || by === 'productTemplate' || by === 'product' ? '' : t.subCategory,
          subKey: by === 'template' || by === 'productTemplate' || by === 'product' ? '' : t.subKey,
          productName: by === 'productTemplate' || by === 'product' ? t.productName : '',
          productKey: by === 'productTemplate' || by === 'product' ? t.productKey : '',
          tasks: []
        });
      }
      groups.get(key).tasks.push(t);
    });
    const list = [...groups.values()];
    list.forEach((g) => g.tasks.sort(compareTasks));
    list.sort((a, b) => {
      if (state.view === 'my' && state.myBucket === 'active') {
        const byStatus = groupActiveRank(a) - groupActiveRank(b);
        if (byStatus) return byStatus;
      }
      if (!isMts()) {
      if (!a.template !== !b.template) return a.template ? -1 : 1;
      return compareTasks(a.tasks[0], b.tasks[0]) || templateOrder(a.template) - templateOrder(b.template);
      }
      const an = (a.productName || a.subCategory || '').toLowerCase();
      const bn = (b.productName || b.subCategory || '').toLowerCase();
      return an.localeCompare(bn) || compareTasks(a.tasks[0], b.tasks[0]);
    });
    return list;
  }

  /* ---------- Rendering ---------- */

  function setView(view, opts) {
    opts = opts || {};
    if (view !== 'renamer' && view !== 'available' && view !== 'my') return;
    // MTS Furniture: My Tasks / assign / Render Tracker are on hold.
    if (view === 'my' && isMts()) {
      view = 'available';
    }
    if (view === 'my' && !state.author) {
      withAuthor(() => setView('my', opts));
      return;
    }
    if (!opts.keepWorkspace) closeWorkspace();
    state.view = view;
    state.selectedEan = null;
    state.drawerClosed = false;
    state.collapsed.clear();
    document.body.classList.toggle('view-renamer', view === 'renamer');
    document.body.classList.toggle('view-available', view === 'available');
    document.body.classList.toggle('view-my', view === 'my');
    const frame = $('renamer-frame');
    if (view === 'renamer') {
      ensureRenamerFrame();
    } else if (frame) {
      frame.hidden = true;
    }
    const title = view === 'renamer' ? 'Renamer'
      : view === 'my' ? 'My Tasks'
      : ('Available Tasks · ' + (isMts() ? 'MTS' : 'HH'));
    const ver = isPreviewApp() ? 'PREVIEW V2.1' : 'BETA V2.0';
    document.title = title + ' · 3D Playground (' + ver + ')';
    const titleEl = $('view-title');
    if (titleEl) titleEl.textContent = title;
    syncCatalogUi();
    const tabs = { renamer: $('tab-renamer'), available: $('tab-available'), my: $('tab-my') };
    Object.keys(tabs).forEach((k) => {
      const el = tabs[k];
      if (!el) return;
      const on = k === view;
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    if (opts.syncHash !== false) syncHash(view, !!opts.replace);
    syncMyBucketTabs();
    if (view !== 'renamer' && state.model) { fillFilters(); render(); loadImages(); }
  }

  function syncMyBucketTabs() {
    document.querySelectorAll('[data-my-bucket]').forEach((btn) => {
      const on = btn.dataset.myBucket === state.myBucket;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  function render() {
    if (!state.model) return;
    if (state.workspace) {
      renderWorkspace();
      return;
    }
    const available = availableTasks();
    const mine = myTasks();
    const pool = poolTasks();
    const visible = visibleTasks();
    updateTabCounts();
    els.count.textContent = visible.length + (visible.length === 1 ? ' task' : ' tasks');

    if (!visible.length) {
      const q = searchQuery();
      if (state.view === 'my') {
        const emptyBucket = state.myBucket === 'completed'
          ? '<div class="tp-state"><strong>No completed tasks yet</strong>' +
            '<span class="tp-state-line">Finished PDP work will show up in this tab.</span></div>'
          : '<div class="tp-state"><strong>No active tasks</strong>' +
            '<span class="tp-state-line">Pick tasks from Available Tasks — Not started, In progress and Blocked show here.</span></div>';
        els.list.innerHTML = q
          ? '<div class="tp-state"><strong>No tasks match "' + esc(state.search.trim()) + '"</strong>Nothing in this My Tasks tab matches this search.</div>'
          : mine.length && !pool.length
            ? emptyBucket
            : pool.length
              ? '<div class="tp-state"><strong>No tasks match these filters</strong>' +
                '<div class="tp-state-actions"><button type="button" class="tp-btn tp-btn-ghost" data-clear-filters>Clear filters</button></div></div>'
              : '<div class="tp-state"><strong>No tasks assigned to you yet</strong>' +
                '<span class="tp-state-line">Pick tasks from Available Tasks — they will show up here.</span></div>';
      } else {
      els.list.innerHTML = q
        ? '<div class="tp-state">' + searchMissHtml(q) + '</div>'
          : pool.length
          ? '<div class="tp-state"><strong>No tasks match these filters</strong>' + filterMissHtml() +
            '<div class="tp-state-actions"><button type="button" class="tp-btn tp-btn-ghost" data-clear-filters>Clear filters</button></div></div>'
          : '<div class="tp-state"><strong>No available tasks</strong>' + emptyReason() + '</div>' + dataCheckHtml();
      }
      renderDrawer(null);
      return;
    }

    const groups = groupTasks(visible);
    groups.forEach((g, i) => {
      g.colour = colourAt(i);
      g.tasks.forEach((t) => { t.colour = g.colour; });
    });
    els.list.innerHTML = groups.map(groupHtml).join('') + (state.view === 'available' ? dataCheckHtml() : '');

    let selected = visible.find((t) => t.ean === state.selectedEan);
    if (!selected && !state.drawerClosed && window.matchMedia('(min-width: 1181px)').matches) {
      selected = groups[0].tasks[0];
      state.selectedEan = selected.ean;
    }
    renderDrawer(state.drawerClosed ? null : selected);
    markSelected();
    if (state.view === 'my') loadImages();
  }

  function emptyReason() {
    const s = state.model.stats;
    if (isMts()) {
    const lines = [
        s.products + ' products read from MTS Furniture (Sheet1).',
        s.withDrive + ' have a GDRIVE folder link, ' + (s.withPdp || 0) + ' have a PDP guideline link, ' +
          s.ready + ' have both (Available).',
        s.noDrive + ' have no GDRIVE folder link yet' +
          (s.driveTextNoLink ? ' (' + s.driveTextNoLink + ' still show text in the GDRIVE cell with no readable URL)' : '') + '.',
        (s.noPdp || 0) + ' have a GDRIVE link but no readable PDP guideline link' +
          (s.pdpTextNoLink ? ' (' + s.pdpTextNoLink + ' still show text in the PDP cell)' : '') + '.',
        'Available Tasks (MTS) = GDRIVE folder link + PDP GUIDELINE LINK. No template. Assign / My Tasks / Render Tracker are on hold.'
      ];
      if (state.model.warnings.length) lines.push('Check: ' + state.model.warnings.join('; ') + '.');
      return lines.map((l) => '<span class="tp-state-line">' + esc(l) + '</span>').join('');
    }
    const lines = [
      s.products + ' products read from the Shoot Tracker.',
      s.withDrive + ' have a GDRIVE folder link, ' + s.withTpl + ' have a template mapping, ' +
        s.ready + ' have both, ' + s.open + ' of those are not yet on the Render Tracker.',
      s.noDrive + ' have a template but no GDRIVE folder link' +
        (s.driveTextNoLink ? ' (' + s.driveTextNoLink + ' still show text in the GDRIVE cell with no readable URL)' : '') + '.',
      s.noTemplate + ' have a GDRIVE link but no template mapping, ' +
        s.assigned + ' with both are already assigned in the Render Tracker.'
    ];
    lines.push('Available Tasks = GDRIVE folder link + template mapping, and not already in the Render Tracker. Upload/Photoshoot Status is ignored.');
    if (state.model.warnings.length) lines.push('Check: ' + state.model.warnings.join('; ') + '.');
    return lines.map((l) => '<span class="tp-state-line">' + esc(l) + '</span>').join('');
  }

  function groupHtml(g) {
    const colour = g.colour;
    const collapsed = state.collapsed.has(g.key);
    const isMy = state.view === 'my';
    const mts = isMts();
    const groupBy = mts
      ? (state.groupBy === 'product' ? 'product' : 'subCategory')
      : (isMy ? 'subTemplate' : state.groupBy);
    const suggestions = (isMy || mts) ? [] : suggestionsFor(g.template, groupBy === 'template' ? '' : (g.subKey || g.tasks[0].subKey));
    const tpl = g.template || '—';
    const name = groupBy === 'template' ? 'Template ' + g.template
      : groupBy === 'productTemplate' || groupBy === 'product' ? (g.productName || 'Unnamed product')
      : (g.subCategory || 'No sub-category');
    const cats = [...new Set(g.tasks.map((t) => t.sheetCategory || t.category).filter(Boolean))];
    const catText = cats.length > 2 ? cats.slice(0, 2).join(', ') + ' +' + (cats.length - 2) : cats.join(', ');
    const tabs = [...new Set(g.tasks.map((t) => t.category))].join(', ');
    const tasksText = g.tasks.length + (g.tasks.length === 1 ? ' task' : ' tasks');
    const countText = groupBy === 'template'
      ? tasksText + ' · ' + new Set(g.tasks.map((t) => t.subKey)).size + ' sub-categories'
      : tasksText;
    const shown = suggestions.slice(0, 3);
    const tip = suggestions.map((s) => s.name + ': ' + s.count + ' done (' + s.basis + ')').join('\n');
    const suggestHtml = (isMy || mts) ? '' : (suggestions.length
      ? '<span class="tp-suggest" title="' + esc(tip) + '">Suggested: ' +
        shown.map((s) => '<span class="tp-suggest-person"><span class="tp-mini-avatar">' + esc(initials(s.name)) + '</span><b>' + esc(s.name) + '</b></span>').join('') +
        (suggestions.length > shown.length ? '<span class="tp-suggest-more">+' + (suggestions.length - shown.length) + '</span>' : '') +
        '</span>'
      : '<span class="tp-suggest tp-suggest-none" title="Nobody has done this ' + esc(templateSeries(g.template) || 'template') + ' template yet, so it is open to everyone">Open to anyone</span>');
    const pickAllHtml = (!isMy && canAssignTasks())
      ? '<button type="button" class="tp-assign-btn" data-action="assign-all-menu" aria-haspopup="menu">Assign to</button>'
      : '';
    const tplBits = mts
      ? ''
      : templateThumb(g.template) + '<span class="tp-tpl-chip">' + esc(tpl) + '</span>';
    return '<section class="tp-group ' + colour + (collapsed ? ' is-collapsed' : '') + '" data-key="' + esc(g.key) + '">' +
      '<header class="tp-group-head">' +
        '<button type="button" class="tp-chevron" data-action="toggle-group" aria-expanded="' + !collapsed + '" aria-label="Collapse group">' + ICON.chevron + '</button>' +
        tplBits +
        '<span class="tp-group-name">' + esc(name) + '</span>' +
        (catText ? '<span class="tp-group-cat" title="' + esc(tabs + ' > ' + cats.join(', ')) + '">' + esc(catText) + '</span>' : '') +
        '<span class="tp-group-count">· ' + esc(countText) + '</span>' +
        '<span class="tp-spacer"></span>' +
        suggestHtml +
        pickAllHtml +
      '</header>' +
      '<div class="tp-rows">' + g.tasks.map((t) => rowHtml(t)).join('') + '</div>' +
    '</section>';
  }

  function templateThumb(template) {
    const img = templateRefImage(template);
    const label = template || '—';
    if (!img) {
      return '<span class="tp-tpl-thumb" data-tpl="' + esc(template || '') + '">' + esc(label) + '</span>';
    }
    return '<span class="tp-tpl-thumb has-img" data-tpl="' + esc(template || '') + '" title="' + esc(label) + '">' +
      '<img src="' + esc(thumbUrl(img, 128)) + '" alt="' + esc(label) + '" loading="lazy" referrerpolicy="no-referrer">' +
      '</span>';
  }

  function rowHtml(t) {
    const tip = (t.shots && t.shots.length) ? t.shots.map((s) => s.name).join(' · ') : 'No shot list';
    const propTip = t.prop && t.prop.kind === 'image' ? 'Prop image pasted in the sheet'
      : (t.functionalProp || 'Functional prop');
    const isMy = state.view === 'my';
    const st = isMy ? statusOf(t) : null;
    const done = st && st.id === 'completed';
    const flow = isMy && !done ? recommendedWorkflow(t) : '';
    const out = isMy ? outputLinkOf(t) : '';
    const actions = isMy
      ? (done
        ? (out
          ? '<a class="tp-btn-outline-sm tp-row-out" href="' + esc(out) + '" target="_blank" rel="noopener" data-action="output">Output folder</a>'
          : '<span class="tp-status is-completed">Completed</span>')
        : '<button type="button" class="tp-btn-outline-sm" data-action="start">Start</button>')
      : (canAssignTasks()
        ? '<button type="button" class="tp-assign-btn" data-action="assign-menu" aria-haspopup="menu">Assign to</button>'
        : '');
    const statusHtml = st
      ? '<span class="tp-status is-' + st.id + '">' + esc(st.label) + '</span>'
      : '';
    const flowHtml = flow
      ? '<span class="tp-flow-tag is-' + flow + '" title="' +
        (flow === 'replace'
          ? 'Recommended: Product Replacement — a Completed Sub-category + Template match exists on the Render Tracker'
          : 'Recommended: Primary workflow — no Completed Sub-category + Template work yet') +
        '">' + (flow === 'replace' ? 'Replacement' : 'Primary') + '</span>'
      : '';
    const qcTag = done ? qcHtml(t) : '';
    return '<div class="tp-row ' + t.colour + (isMy ? ' is-mine' : '') + (done ? ' is-completed-row' : '') +
      '" data-ean="' + esc(t.ean) + '" tabindex="0" role="button" aria-label="' + esc(t.title + ', EAN ' + t.ean) + '">' +
      '<div class="tp-row-main">' +
        thumbHtml(t) +
        '<div class="tp-row-text">' +
          '<span class="tp-row-title" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
          '<span class="tp-row-ean">' + eanHtml(t.ean) +
            '<button type="button" class="tp-copy" data-action="copy" title="Copy EAN" aria-label="Copy EAN">' + ICON.copy + '</button>' +
            flowHtml +
            qcTag +
            (t.propsNeeded ? '<span class="tp-prop-tag" title="' + esc(propTip) + '">' + ICON.prop + 'Prop</span>' : '') +
            (t.hasIssue ? '<span class="tp-dot" title="Possible data issue - see details"></span>' : '') +
          '</span>' +
        '</div>' +
      '</div>' +
      '<span class="tp-pills">' +
        // EACH / PCs stay off the row; only SET (and other set-like values) keep the rose pill.
        (isSet(t)
          ? '<span class="tp-pill is-set">' + esc(t.setLabel) + '</span>'
          : '') +
        (t.collectionShoot
          ? '<span class="tp-pill is-collection" title="' + esc(collectionShootLabel(t.collectionShoot)) + '">' +
            esc(collectionShootLabel(t.collectionShoot)) + '</span>'
          : '') +
      '</span>' +
      '<span class="tp-shots" data-tip="' + esc(tip) + '">' + ICON.camera + (t.shots ? t.shots.length : 0) + ' shots</span>' +
      (isMts()
        ? (t.range ? '<span class="tp-range-chip" title="Range">' + esc(t.range) + '</span>' : '<span class="tp-range-chip" style="opacity:.45">—</span>')
        : '<span class="tp-tpl-code' + (t.template ? '' : ' is-empty') + '">' + esc(t.template || '—') + '</span>') +
      (isMy ? statusHtml + actions : actions) +
    '</div>';
  }

  function imagesOf(t) {
    const id = previewFolderId(t);
    const list = id ? state.images[id] : null;
    if (!Array.isArray(list)) return null;
    return previewImages(list);
  }

  function thumbImgTag(imgObj, width) {
    if (!imgObj || !imgObj.id) return '';
    const w = width || 160;
    const src = thumbUrl(imgObj, w);
    if (!src) return '';
    return '<img class="tp-img" src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-drive-id="' +
      esc(imgObj.id) + '" data-thumb-w="' + w + '">';
  }

  function thumbHtml(t) {
    const list = imagesOf(t);
    const preferFirst = useOutputPreview(t);
    const img = list && list.length
      ? thumbImgTag(list[defaultPhoto(list, preferFirst, t)], 160)
      : '';
    return '<div class="tp-thumb" aria-hidden="true"><span>' + esc(initials(t.productName || t.title)) + '</span>' + img + '</div>';
  }

  function photoHtml(t) {
    const folderId = previewFolderId(t);
    const list = imagesOf(t);
    const status = folderId ? state.images[folderId] : null;
    const preferFirst = useOutputPreview(t);
    if (list && list.length) {
      const i = state.photoIndex < 0 ? defaultPhoto(list, preferFirst, t) : Math.min(state.photoIndex, list.length - 1);
      const main = list[i];
      const strip = list.length > 1
        ? '<div class="tp-photo-strip">' + list.map((p, n) =>
            '<button type="button" class="tp-photo-pick' + (n === i ? ' is-active' : '') + '" data-photo="' + n + '" title="' + esc(p.name) + '">' +
              thumbImgTag(p, 120) + '</button>').join('') +
          '</div>'
        : '';
      return '<a class="tp-photo has-img" href="https://drive.google.com/file/d/' + esc(encodeURIComponent(main.id)) + '/view" target="_blank" rel="noopener" title="' + esc(main.name) + ' (opens in Drive)">' +
          '<div class="tp-photo-initials">' + esc(initials(t.productName || t.title)) + '</div>' +
          thumbImgTag(main, 800).replace(' alt=""', ' alt="' + esc(main.name) + '"') +
          '<span class="tp-photo-count">' + (i + 1) + ' / ' + list.length + '</span>' +
        '</a>' + strip;
    }
    const note = !folderId
      ? (useOutputPreview(t) ? 'No output Drive folder on the Render Tracker' : 'No Drive folder link for this product')
      : status === 'loading' || status === undefined ? 'Loading photos from Drive…'
      : status === 'error' ? 'Photos could not be loaded from Drive'
      : (Array.isArray(status) && status.length && !previewImages(status).length
        ? 'No previewable photos (RAW/CR3 files are skipped)'
        : 'No photos in the Drive folder yet');
    return '<div class="tp-photo"><div class="tp-photo-initials">' + esc(initials(t.productName || t.title)) + '</div>' +
      '<span class="tp-photo-note">' + esc(note) + '</span></div>';
  }

  // Lists the images in each task's Drive folder, the selected task first, in batches.
  let imagesRunning = false;
  async function loadImages() {
    loadTemplateRefImages();
    if (imagesRunning || !state.model) return;
    imagesRunning = true;
    try {
      const selected = state.selectedEan ? taskByEan(state.selectedEan) : null;
      const wsTask = state.workspace && taskByEan(state.workspace.ean);
      const order = (selected ? [selected] : []).concat(wsTask && (!selected || selected.ean !== wsTask.ean) ? [wsTask] : []).concat(visibleTasks());
      const matchIds = (state.workspace && wsTask && (state.workspace.mode === 'choose' || state.workspace.mode === 'replace'))
        ? priorMatches(wsTask).map((m) => m.folderId)
        : [];
      const ids = [...new Set(order.map((t) => previewFolderId(t)).concat(matchIds)
        .filter((id) => id && state.images[id] === undefined))];
      for (let i = 0; i < ids.length; i += 40) {
        const chunk = ids.slice(i, i + 40);
        chunk.forEach((id) => { state.images[id] = 'loading'; });
        try {
          const found = await jsonp('action=thumbs&ids=' + chunk.map(encodeURIComponent).join(','), 60000);
          chunk.forEach((id) => { state.images[id] = (found && found[id]) || []; });
        } catch (err) {
          console.error(err);
          chunk.forEach((id) => { state.images[id] = 'error'; });
        }
        applyImages(chunk);
      }
    } finally {
      imagesRunning = false;
    }
  }

  function applyImages(folderIds) {
    const changed = new Set(folderIds);
    els.list.querySelectorAll('.tp-row').forEach((row) => {
      const t = taskByEan(row.dataset.ean);
      if (t && changed.has(previewFolderId(t))) {
        const thumb = row.querySelector('.tp-thumb');
        if (thumb) thumb.outerHTML = thumbHtml(t);
      }
    });
    if (els.workspace && !els.workspace.hidden) {
      els.workspace.querySelectorAll('[data-ws-match]').forEach((btn) => {
        const slot = btn.querySelector('.tw-match-thumb');
        if (!slot) return;
        const ean = btn.dataset.wsMatch;
        const t = taskByEan(ean);
        const folderId = slot.dataset.folder || (t ? outputFolderIdOf(t) : '');
        if (!folderId || !changed.has(folderId)) return;
        const list = state.images[folderId];
        if (!Array.isArray(list) || !list.length) return;
        slot.innerHTML = '<img class="tp-img" src="' + esc(thumbUrl(list[0], 160)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
      });
      els.workspace.querySelectorAll('[data-folder]').forEach((slot) => {
        const folderId = slot.dataset.folder;
        if (!folderId || !changed.has(folderId)) return;
        const sorted = sortPriorDriveImages(Array.isArray(state.images[folderId]) ? state.images[folderId] : []);
        if (!sorted.length) return;
        const imgIdx = slot.dataset.driveImg !== undefined ? Number(slot.dataset.driveImg) : 0;
        const imgObj = sorted[Math.min(Math.max(0, imgIdx), sorted.length - 1)];
        const wide = slot.classList.contains('wr-frame') || slot.classList.contains('wr-compare-overlay-inner');
        const img = '<img class="tp-img" src="' + esc(thumbUrl(imgObj, wide ? 640 : 360)) + '" alt="' + esc(imgObj.name || '') + '" loading="lazy" referrerpolicy="no-referrer">';
        if (slot.classList.contains('wr-shot-thumb')) {
          const name = slot.querySelector('.wr-shot-name');
          const busy = slot.querySelector('.wr-shot-busy');
          const done = slot.querySelector('.wr-shot-done');
          slot.innerHTML = img + (name ? name.outerHTML : '') + (busy ? busy.outerHTML : '') + (done ? done.outerHTML : '');
        } else if (slot.classList.contains('wr-frame') || slot.classList.contains('wr-compare-overlay-inner')) {
          slot.innerHTML = img;
        }
      });
      const wsTask = state.workspace && taskByEan(state.workspace.ean);
      if (wsTask && changed.has(previewFolderId(wsTask))) {
        const topThumb = els.workspace.querySelector('.tw-top-thumb');
        if (topThumb) {
          topThumb.innerHTML = thumbHtml(wsTask).replace('class="tp-thumb"', 'class="tp-thumb tw-top-thumb-inner"');
        }
      }
      if (state.workspace && state.workspace.mode === 'replace' && wsTask) {
        const prior = resolveWorkspaceMatch(wsTask).selected;
        if (prior && prior.folderId && changed.has(prior.folderId) && priorDriveImages(prior).length) {
          const rail = els.workspace.querySelector('.wr-rail-list');
          if (rail && !rail.querySelector('[data-ws-drive-img]')) {
            renderWorkspace();
            return;
          }
        }
      }
    }
    const selected = state.selectedEan && taskByEan(state.selectedEan);
    if (selected && !els.drawer.hidden && changed.has(previewFolderId(selected))) {
      const scroll = els.drawerBody.scrollTop;
      renderDrawer(selected);
      els.drawerBody.scrollTop = scroll;
    }
  }

  function markSelected() {
    els.list.querySelectorAll('.tp-row').forEach((row) => {
      row.classList.toggle('is-selected', !state.drawerClosed && row.dataset.ean === state.selectedEan);
    });
  }

  function renderDrawer(t) {
    if (!t) { els.drawer.hidden = true; return; }
    els.drawer.hidden = false;
    els.drawer.className = 'tp-drawer ' + (t.colour || 'c-slate');
    const mts = isMts() || t.catalog === 'mts';
    const crumb = [t.department, t.sheetCategory, t.subCategory].filter(Boolean).join(' > ');
    const kv = mts
      ? [
      ['EAN code', t.ean, true],
          [isSet(t) ? 'Set / EACH' : '', isSet(t) ? t.setLabel : ''],
          ['Collection shoot', collectionShootLabel(t.collectionShoot)],
          ['Range', t.range],
          ['Color', t.color],
          ['Product Size mm W/L (Dining)', t.sizeW],
          ['Product Size mm D/L (Bed)', t.sizeD],
          ['Product Size mm HT', t.sizeHt]
        ].filter((r) => r[1])
      : [
          ['EAN code', t.ean, true],
          [isSet(t) ? 'Set / PCs' : '', isSet(t) ? t.setLabel : ''],
      ['Style', t.style && t.style !== t.title ? t.style : ''],
      ['Product size', t.size],
      ['Product dimensions', t.dimensions !== t.size ? t.dimensions : ''],
      ['Product capacity', t.capacity]
    ].filter((r) => r[1]);

    let propBody = '';
    if (t.prop && t.prop.kind === 'image') {
      propBody = '<p>Prop image was pasted into the sheet.</p>' +
        '<span class="tp-prop-note">Open the <a href="' + esc(PROP_SHEET_URL) + '" target="_blank" rel="noopener">sheet</a> to view it.</span>';
    } else if (t.prop && t.prop.html) {
      propBody = '<p class="tp-prop-text">' + t.prop.html + '</p>';
    }
    const prop = !mts && t.propsNeeded && propBody
      ? '<div class="tp-prop"><div class="tp-prop-head">' + ICON.prop + '<span>Functional prop</span></div>' +
        propBody + '</div>'
      : '';

    const tplBody = mts ? '' : templateRefBody(t.template);

    const shotCount = t.shots ? t.shots.length : 0;
    const shots = shotCount
      ? '<ol class="tp-shot-list">' + t.shots.map((s) => '<li>' + esc(s.name) + '</li>').join('') + '</ol>'
      : '<p class="tp-empty-note">No mandatory shot list in the ' + (mts ? 'MTS Furniture sheet' : 'Shoot Tracker') + '.</p>';
    const pdps = pdpLinksOf(t);
    const pdpRef = pdps.length
      ? pdps.map((url, i) => '<a href="' + esc(url) + '" target="_blank" rel="noopener">PDP' +
        (pdps.length > 1 ? ' ' + (i + 1) : '') + '</a>').join(' · ')
      : 'PDP';
    const shotNotes = '<ul class="tp-shot-warn">' +
      '<li>' + ICON.warning + '<span>Always refer to the ' + pdpRef + ' for the final shot list.</span></li>' +
      (isSet(t) ? '<li>' + ICON.warning + '<span>Marked as <b>' + esc(t.setLabel) + '</b> in the sheet, so the ' + pdpRef +
        ' should show a set. If it does not, confirm before working: the sheet may have a data error.</span></li>' : '') +
      (t.collectionShoot
        ? '<li>' + ICON.warning + '<span><b>' + esc(collectionShootLabel(t.collectionShoot)) + '</b> — include collection framing from the ' +
          pdpRef + ' when shooting / rendering.</span></li>'
        : '') +
      '</ul>';

    const drive = t.driveLink
      ? linkHtml(t.driveLink, 'tp-link-folder', ICON.folder, 'Shoot folder', '')
      : linkHtml('', 'tp-link-folder', ICON.folder, 'Shoot folder', t.driveText ? 'Link not included in this export' : 'Not available');
    const pdp = pdps.length
      ? pdps.map((url, i) => linkHtml(url, 'tp-link-slides', ICON.slides,
        pdps.length > 1 ? ('PDP guideline ' + (i + 1)) : 'PDP guideline', '')).join('')
      : linkHtml('', 'tp-link-slides', ICON.slides, 'PDP guideline',
        t.pdpText ? 'Title only — no URL' : 'Not available');
    const outHref = outputLinkOf(t);
    const output = state.view === 'my'
      ? (outHref
        ? linkHtml(outHref, 'tp-link-folder', ICON.folder, 'Output folder', '')
        : linkHtml('', 'tp-link-folder', ICON.folder, 'Output folder', 'Not on the Render Tracker yet'))
      : '';

    const st = state.view === 'my' ? statusOf(t) : null;
    const flow = state.view === 'my' && st && st.id !== 'completed' ? recommendedWorkflow(t) : '';
    const myMeta = state.view === 'my'
      ? '<div class="tp-my-drawer-meta">' +
          '<span class="tp-status is-' + st.id + '">' + esc(st.label) + '</span>' +
          (st && st.id === 'completed' ? qcHtml(t) : '') +
          (flow ? '<span class="tp-flow-tag is-' + flow + '">' + (flow === 'replace' ? 'Replacement recommended' : 'Primary recommended') + '</span>' : '') +
        '</div>'
      : '';

    const issues = (t.issues && t.issues.length)
      ? '<div class="tp-issue"><div class="tp-issue-head">' + ICON.warning + '<span>Possible data issues</span></div><ul>' +
        t.issues.map((i) => '<li>' + esc(i.text) + '</li>').join('') + '</ul></div>'
      : '';

    const tplSection = mts ? '' : (
      '<div>' +
        '<div class="tp-section-head"><span class="tp-section-title">Template Reference</span>' +
          (t.template ? '<span class="tp-tpl-badge">' + esc(t.template) + '</span>' : '') + '</div>' +
        '<div class="tp-tpl-ref">' + tplBody + '</div>' +
      '</div>'
    );
    const namingLink = mts ? '' :
      '<a class="tp-section-link" href="' + esc(NAMING_SHEET_URL) + '" target="_blank" rel="noopener" title="Open Naming Convention Shot List">Find shot codes' + ICON.external + '</a>';

    els.drawerBody.innerHTML =
      '<div class="tp-photo-wrap">' + photoHtml(t) + '</div>' +
      '<div>' +
        (crumb ? '<div class="tp-crumb">' + esc(crumb) + '</div>' : '') +
        '<h2 class="tp-drawer-title">' + esc(t.title) + '</h2>' +
        myMeta +
      '</div>' +
      prop +
      '<div class="tp-kv">' + kv.map((r) =>
        '<div class="tp-kv-row"><span>' + esc(r[0]) + '</span>' + (r[2]
          ? '<span class="tp-mono tp-kv-copy">' + eanHtml(r[1]) +
            '<button type="button" class="tp-copy" data-copy="' + esc(r[1]) + '" title="Copy EAN" aria-label="Copy EAN">' + ICON.copy + '</button></span>'
          : '<span>' + esc(r[1]) + '</span>') + '</div>').join('') +
      '</div>' +
      '<div class="tp-links">' + drive + output + pdp + '</div>' +
      tplSection +
      '<div><div class="tp-section-head"><span class="tp-section-title">Required Shots' + (shotCount ? ' (' + shotCount + ')' : '') + '</span>' +
        namingLink + '</div>' +
        shotNotes + shots + '</div>' +
      issues;
    els.drawerBody.scrollTop = 0;
  }

  function linkHtml(href, cls, icon, label, hint) {
    const left = '<span class="tp-link-left ' + cls + '">' + icon + '<span>' + esc(label) + '</span></span>';
    if (href) {
      return '<a class="tp-link" href="' + esc(href) + '" target="_blank" rel="noopener">' + left + ICON.external + '</a>';
    }
    return '<span class="tp-link is-disabled">' + left + '<span class="tp-link-hint">' + esc(hint) + '</span></span>';
  }

  function fillFilters() {
    const m = state.model;
    if (!m) return;
    els.category.innerHTML = '<option value="">All categories</option>' +
      m.categories.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    els.category.value = m.categories.includes(state.category) ? state.category : '';
    state.category = els.category.value;

    if (isMts()) {
      state.template = '';
      state.artist = '';
      if (els.template) {
        els.template.innerHTML = '<option value="">All Templates</option>';
        els.template.value = '';
      }
      if (els.artist) {
        els.artist.innerHTML = '<option value="">Artist history: anyone</option>';
        els.artist.value = '';
      }
      return;
    }

    const open = new Map();
    poolTasks().forEach((t) => open.set(t.template, (open.get(t.template) || 0) + 1));
    const templates = [...open.keys()].sort((a, b) => templateOrder(a) - templateOrder(b));
    const countLabel = state.view === 'my' ? ' mine' : ' open';
    els.template.innerHTML = '<option value="">All Templates</option>' +
      templates.map((t) => '<option value="' + esc(t) + '">' + esc(t) + ' · ' + open.get(t) + countLabel + '</option>').join('');
    els.template.value = templates.includes(state.template) ? state.template : '';
    state.template = els.template.value;

    // One entry for the current author (Suggested for me / their name), then every other artist once.
    const authorNorm = (state.author || '').toLowerCase();
    const others = m.artists.filter((a) => a.toLowerCase() !== authorNorm);
    // Lists every Render Tracker artist. Filtering keeps tasks on templates/sub-categories that artist has done before.
    els.artist.innerHTML = '<option value="">Artist history: anyone</option>' +
      (state.author
        ? '<option value="~me">' + esc(state.author) + '</option>'
        : '<option value="~me">My history</option>') +
      others.map((a) => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('');
    els.artist.value = state.artist === '~me' || m.artists.includes(state.artist) ? state.artist : '';
    state.artist = els.artist.value;
  }

  function updateTimestamp() {
    if (!state.loadedAt) return;
    const mins = Math.floor((Date.now() - state.loadedAt) / 60000);
    els.updated.textContent = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : Math.floor(mins / 60) + ' h ago';
  }

  function formatSheetTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // "Data last sync" = when shoot-sync last wrote the native Shoot Tracker from the .xlsx download.
  function renderXlsxSync(meta) {
    if (!els.synced) return;
    const sync = meta && !meta.error ? meta : null;
    const at = sync && sync.xlsxSyncedAt;
    els.synced.textContent = at ? formatSheetTime(at) : '—';
  }

  function renderSource(data) {
    const pill = els.sourcePill;
    const times = data.shoot.map((s) => s.modified).filter(Boolean).map((m) => new Date(m));
    const latest = times.length ? new Date(Math.max.apply(null, times)) : null;
    pill.hidden = false;
    pill.className = 'tp-source ' + (data.warnings.length ? 'is-local' : 'is-live');
    pill.textContent = 'Live sheets';
    const syncAt = data.xlsxSync && data.xlsxSync.xlsxSyncedAt
      ? '\nShoot Tracker last synced from .xlsx: ' + formatSheetTime(data.xlsxSync.xlsxSyncedAt)
      : '';
    pill.title = 'Reads Shoot Tracker and Render Tracker. Assign appends Artist rows on the live Render Tracker; ' +
      'other users see it within about ' + Math.round(ASSIGN_POLL_MS / 1000) + ' seconds.' +
      (latest ? '\nShoot Tracker file last saved: ' + latest.toLocaleString() : '') +
      syncAt +
      (data.warnings.length ? '\n\nNot loaded: ' + data.warnings.join('; ') : '');
    renderXlsxSync(data.xlsxSync);
  }

  function renderUser() {
    $('user-name').textContent = state.author || '—';
  }

  /* ---------- My Tasks workspace (UI mock only — no save / upload) ---------- */

  function manualPriorMatchFromEan(ean) {
    const key = String(ean || '').replace(/\D/g, '');
    if (!/^\d{8,}$/.test(key)) return null;
    const p = taskByEan(key) ||
      (state.model && state.model.products || []).find((x) => String(x.ean) === key) ||
      null;
    if (!p) return null;
    const drive = outputLinkOf(p) || p.driveLink || '';
    const folderId = outputFolderIdOf(p) || p.folderId || '';
    if (!drive && !folderId) return null;
    return {
      level: 'manual',
      label: 'Manual EAN',
      best: false,
      ean: p.ean,
      title: p.title || p.productName || p.ean,
      artist: p.assignArtist || (assignmentRow(p.ean) || {}).artist || '',
      drive: drive,
      folderId: folderId,
      product: p
    };
  }

  function resolveWorkspaceMatch(t) {
    const matches = t ? priorMatches(t) : [];
    const want = String((state.workspace && state.workspace.matchEan) || '').replace(/\D/g, '');
    let selected = matches.find((m) => String(m.ean).replace(/\D/g, '') === want) || null;
    if (!selected && want) selected = manualPriorMatchFromEan(want);
    // Only fall back to Best match when the author has not locked a prior EAN.
    if (!selected && !want && matches.length) selected = matches.find((m) => m.best) || matches[0];
    if (state.workspace) {
      // Keep a typed manual EAN even when it is not in the recommended list.
      if (selected) state.workspace.matchEan = String(selected.ean);
      else if (!want) state.workspace.matchEan = '';
    }
    return { matches: matches, selected: selected };
  }

  function openWorkspace(mode, ean, opts) {
    opts = opts || {};
    const t = taskByEan(ean);
    // Leaving another EAN's Replacement — stash A/B/C/D first.
    if (state.workspace && state.workspace.mode === 'replace' &&
        String(state.workspace.ean) !== String(ean)) {
      persistCurrentReplaceDraft();
      stashReplaceDraftInMemory();
    } else if (state.workspace && state.workspace.mode === 'replace' &&
        String(state.workspace.ean) === String(ean)) {
      persistCurrentReplaceDraft();
    } else if (state.workspace && state.workspace.mode === 'primary' &&
        String(state.workspace.ean) !== String(ean)) {
      persistCurrentPrimaryDraft();
      stashPrimaryDraftInMemory();
    } else if (state.workspace && state.workspace.mode === 'primary' &&
        String(state.workspace.ean) === String(ean)) {
      persistCurrentPrimaryDraft();
    }
    state.workspace = {
      mode: mode || 'choose',
      ean: ean,
      focus: opts.focus || (recommendReplace(t) ? 'replace' : 'primary'),
      matchEan: opts.matchEan || '',
      draftsLoaded: false
    };
    resolveWorkspaceMatch(t);
    if (opts.matchEan) state.workspace.matchEan = String(opts.matchEan);
    {
      const shotsOpen = shotListFor(t || {});
      if (opts.shot != null && opts.shot !== '') {
        const n = Number(opts.shot);
        state.workspaceShot = isNaN(n) ? defaultWorkspaceShotIndex(shotsOpen) : n;
      } else if (mode === 'replace' || mode === 'primary') {
        // Same as Replacement: prefer first non-MAIN angle (MAIN is last on the rail).
        state.workspaceShot = defaultWorkspaceShotIndex(shotsOpen);
      } else {
        state.workspaceShot = 0;
      }
    }
    // Drive images rail always starts on the first image when opening a page / EAN.
    state.workspace.driveImgIndex = 0;
    state.selectedEan = ean;
    document.body.classList.add('view-workspace');
    if (els.workspace) els.workspace.hidden = false;
    renderDrawer(null);
    renderWorkspace();
    syncRoute({ replace: true });
    loadImages();
    if (state.workspace.mode === 'choose') {
      hydrateChooseApprovalState();
    }
    if (state.workspace.mode === 'replace') {
      prefetchSelectedDrivePrior();
      restoreReplaceDraftsIntoWorkspace().then(function () {
        return hydrateMdimDraftForEan(false);
      }).then(function () {
        if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
      }).catch(function () { /* soft */ });
      ensureUniversalPrompts(true).then(() => {
        if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
      });
      ensureApprovedCustomPrompts(true).then(() => {
        if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
      });
      loadAnswerlyModels().then(() => {
        if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
      });
    } else if (state.workspace.mode === 'primary') {
      ensurePrimaryState(t);
      restorePrimaryDraftsIntoWorkspace().then(function () {
        return hydrateMdimDraftForEan(false);
      }).then(function () {
        if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
      }).catch(function () { /* soft */ });
      ensureUniversalPrompts(true).then(() => {
        if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
      });
      loadAnswerlyModels().then(() => {
        if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
      });
    }
    refreshAnswerlyTokenState().then(() => {
      if (state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        renderWorkspace();
      }
    });
    window.scrollTo(0, 0);
  }

  function closeWorkspace() {
    if (state.workspace && state.workspace.mode === 'replace') {
      persistCurrentReplaceDraft();
      stashReplaceDraftInMemory();
    } else if (state.workspace && state.workspace.mode === 'primary') {
      persistCurrentPrimaryDraft();
      stashPrimaryDraftInMemory();
    }
    // After stash, workspace.assets is empty — safe to revoke leftovers only.
    revokeAllWorkspaceAssets();
    state.workspace = null;
    state.workspaceShot = 0;
    document.body.classList.remove('view-workspace', 'ws-choose', 'ws-replace', 'ws-primary', 'mdim-main-max');
    document.documentElement.classList.remove('mdim-main-max');
    if (els.workspace) {
      els.workspace.hidden = true;
      els.workspace.innerHTML = '';
    }
    if (state.view === 'my') syncRoute({ replace: true });
  }

  function restoreWorkspaceFromRoute(route) {
    route = route || parseHash();
    if (!state.model || !route || route.view !== 'my') return false;
    const ws = route.ws;
    if (!ws || !route.ean) return false;
    if (!taskByEan(route.ean)) return false;
    if (ws !== 'choose' && ws !== 'replace' && ws !== 'primary') return false;
    if (state.workspace && String(state.workspace.ean) === String(route.ean) &&
        state.workspace.mode === ws) {
      if (route.match) state.workspace.matchEan = route.match;
      if (route.shot != null && route.shot !== '') state.workspaceShot = Number(route.shot) || 0;
      // Refresh / deep-link: keep Drive images selection on the first rail image.
      resetDriveImgSelectionToFirst();
      renderWorkspace();
      if (ws === 'replace') {
        prefetchSelectedDrivePrior();
        restoreReplaceDraftsIntoWorkspace();
        refreshAnswerlyTokenState().then(() => syncAnswerlyTokenChip());
      }
      return true;
    }
    openWorkspace(ws, route.ean, {
      matchEan: route.match || '',
      shot: route.shot,
      drive: route.drive,
      focus: ws === 'primary' ? 'primary' : 'replace'
    });
    return true;
  }

  function captureRailScroll() {
    if (!els.workspace) return;
    const list = els.workspace.querySelector('.wr-rail-list');
    if (list) state.railScrollTop = list.scrollTop;
  }

  function restoreRailScroll() {
    if (state.railScrollTop == null || !els.workspace) return;
    const top = state.railScrollTop;
    const apply = () => {
      const list = els.workspace && els.workspace.querySelector('.wr-rail-list');
      if (list) list.scrollTop = top;
    };
    apply();
    requestAnimationFrame(apply);
  }

  function renderWorkspace() {
    if (!els.workspace || !state.workspace) return;
    persistReplacePromptFromDom();
    const t = taskByEan(state.workspace.ean);
    if (!t) {
      closeWorkspace();
      render();
      return;
    }
    const mode = state.workspace.mode;
    document.body.classList.toggle('ws-choose', mode === 'choose');
    document.body.classList.toggle('ws-replace', mode === 'replace');
    document.body.classList.toggle('ws-primary', mode === 'primary');
    const mdimMax = (mode === 'replace' || mode === 'primary') &&
      !!state.workspace.mdimMainMax && !state.workspace.mdimShowAbcd;
    document.body.classList.toggle('mdim-main-max', mdimMax);
    document.documentElement.classList.toggle('mdim-main-max', mdimMax);
    els.workspace.innerHTML = mode === 'primary' ? workspacePrimaryHtml(t)
      : mode === 'replace' ? workspaceReplaceHtml(t)
      : workspaceChooseHtml(t);
    if (mode === 'replace' || mode === 'primary') {
      applyRailLayoutPrefs();
      restoreRailScroll();
      syncPromptHighlightOverlay();
      if (mode === 'replace') prefetchSelectedDrivePrior();
      if (mode === 'primary') {
        schedulePrimaryA1Load(t);
        schedulePrimaryPdpLoad(t);
        schedulePrimaryA2ForShot(state.workspaceShot || 0);
      }
      const compare = els.workspace.querySelector('[data-ws-compare]');
      if (compare) {
        const pos = Number(state.workspace.comparePos) || 50;
        syncCompareSlider(compare, pos);
        requestAnimationFrame(() => syncCompareSlider(compare, pos));
      }
      requestAnimationFrame(() => {
        syncRailToMainHeight();
        restoreRailScroll();
        syncPromptHighlightOverlay();
        // Keep the active Required-shot row visible (do not jump to MAIN at rail end).
        const activeShot = els.workspace.querySelector('.wr-shot.is-active, .tw-shot-btn.is-active');
        if (activeShot && activeShot.scrollIntoView) {
          const railList = els.workspace.querySelector('.wr-rail-list');
          if (railList) {
            const r = railList.getBoundingClientRect();
            const b = activeShot.getBoundingClientRect();
            if (b.top < r.top || b.bottom > r.bottom) {
              activeShot.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              state.railScrollTop = railList.scrollTop;
            }
          }
        }
        requestAnimationFrame(() => {
          syncRailToMainHeight();
          restoreRailScroll();
          if ((mode === 'replace' || mode === 'primary') &&
              window.MdimPlayground && window.MdimPlayground.syncOverlay) {
            const root = els.workspace.querySelector('[data-mdim-root]');
            if (root) window.MdimPlayground.syncOverlay(root);
          }
        });
        if (mode === 'replace' || mode === 'primary') {
          const shotsNow = shotListFor(t);
          const si = Math.min(state.workspaceShot, Math.max(0, shotsNow.length - 1));
          if (isDimensionShot(shotsNow[si]) && !state.workspace.mdimShowAbcd) {
            ensureMdimDefaultBaseThenMount(t, shotsNow, si);
          } else if (window.MdimPlayground) {
            window.MdimPlayground.unmount();
          }
        } else if (window.MdimPlayground) {
          window.MdimPlayground.unmount();
        }
      });
    } else {
      document.body.classList.remove('mdim-main-max');
      document.documentElement.classList.remove('mdim-main-max');
    }
  }

  function ensureMdimDefaultBaseThenMount(t, shots, si) {
    const options = mdimBaseOptions(t, shots, si);
    if (state.workspace.mdimOverride) {
      state.workspace.mdimBaseKey = '__override__';
    } else if (!state.workspace.mdimBaseKey ||
        (state.workspace.mdimBaseKey === '__override__' && !state.workspace.mdimOverride)) {
      state.workspace.mdimBaseKey = mdimDefaultBaseKey(options, t);
    }
    const key = state.workspace.mdimBaseKey;
    const needBuild = !state.workspace.mdimWorkspaceUrl && key;
    const finish = () => mountMdimWorkbench();
    if (!needBuild) {
      finish();
      mdimPrefetchBaseOptions(options);
      return;
    }
    const asset = (key === '__override__' ? state.workspace.mdimOverride : null) ||
      mdimAssetForBaseKey(key, options) ||
      (key === '__custom__' ? shotAssets(si).output : null);
    if (!asset) {
      finish();
      return;
    }
    mdimEnsureWorkspaceFromAsset(asset, asset.name, key).then(function (wsUrl) {
      if (wsUrl && window.MdimPlayground && window.MdimPlayground.setWorkspaceUrl) {
        finish();
        window.MdimPlayground.setWorkspaceUrl(wsUrl);
        mdimPrefetchBaseOptions(options);
        return;
      }
      renderWorkspace();
    }).catch(function () {
      finish();
    });
  }

  function syncRailToMainHeight() {
    if (!els.workspace || !state.workspace ||
        (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
    const rail = els.workspace.querySelector('.wr-rail');
    const main = els.workspace.querySelector('.wr-main');
    if (!rail || !main) return;
    rail.style.height = 'auto';
    const h = Math.round(main.getBoundingClientRect().height);
    if (h > 0) rail.style.height = h + 'px';
  }

  function workspaceTopHtml(t, kicker, backAction) {
    const st = statusOf(t);
    const pdp = t.pdpLink
      ? '<a class="tw-chip tw-chip-link" href="' + esc(t.pdpLink) + '" target="_blank" rel="noopener">PDP guideline</a>'
      : '';
    return '<div class="tw-top">' +
      '<button type="button" class="tw-back" data-ws="' + esc(backAction) + '">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>' +
        'Back</button>' +
      '<div class="tw-top-text">' +
        '<div class="tw-top-main">' +
          '<div class="tw-top-thumb" aria-hidden="true">' + thumbHtml(t).replace('class="tp-thumb"', 'class="tp-thumb tw-top-thumb-inner"') + '</div>' +
          '<div class="tw-top-copy">' +
            '<div class="tw-kicker">' + esc(kicker) + '</div>' +
            '<h1 class="tw-heading">' + esc(t.title || 'Untitled product') + '</h1>' +
            '<p class="tw-sub">EAN <span class="tp-mono">' + esc(t.ean) + '</span>' +
              (t.subCategory ? ' · ' + esc(t.subCategory) : '') +
              (t.template ? ' · Template ' + esc(t.template) : '') + '</p>' +
            '<div class="tw-meta-row">' +
              '<span class="tp-status is-' + st.id + '">' + esc(st.label) + '</span>' +
              (t.template ? '<span class="tw-chip">Template <span class="tp-mono">' + esc(t.template) + '</span></span>' : '') +
              (t.setLabel ? '<span class="tw-chip">' + esc(t.setLabel) + '</span>' : '') +
              '<span class="tw-chip">' + shotListFor(t).length + ' shots</span>' +
              pdp +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function workspaceChooseHtml(t) {
    const preferReplace = recommendReplace(t);
    const ws = state.workspace || {};
    const focus = ws.focus === 'primary' || ws.focus === 'replace'
      ? ws.focus
      : (preferReplace ? 'replace' : 'primary');
    const resolved = resolveWorkspaceMatch(t);
    const matches = resolved.matches;
    const selected = resolved.selected;
    const st = statusOf(t);
    const shotCount = shotListFor(t).length;
    const pdp = t.pdpLink
      ? '<a class="tw-chip tw-chip-link" href="' + esc(t.pdpLink) + '" target="_blank" rel="noopener">PDP guideline' + ICON.external + '</a>'
      : '';
    // Product Replacement is always available — with a selected prior, a typed EAN, or none
    // (drop A in the workspace). Primary remains always available.
    const canReplace = true;

    const draftMatchEan = (state.replaceDraftCache && state.replaceDraftCache[t.ean] &&
      state.replaceDraftCache[t.ean].matchEan) || (state.workspace && state.workspace.matchEan) || '';
    const workBadge = replaceApprovalBadge(t);
    const matchHtml = matches.length
      ? '<div class="tw-match-list">' + matches.map((m) => {
          const isSel = selected && selected.ean === m.ean;
          const isWorkPrior = !!(workBadge && (
            String(draftMatchEan) === String(m.ean) ||
            (isSel && (!draftMatchEan || String(draftMatchEan) === String(m.ean)))
          ));
          const rowBadge = isWorkPrior ? workBadge : null;
          return '<div class="tw-match-row' + (isSel ? ' is-selected' : '') +
            (rowBadge ? ' has-approve-state ' + rowBadge.cls : '') +
            '" data-ws-match="' + esc(m.ean) + '">' +
            '<label class="tw-match-select">' +
              '<input type="radio" name="tw-selected-match" value="' + esc(m.ean) + '"' + (isSel ? ' checked' : '') + '>' +
              '<div class="tw-match-thumb" data-folder="' + esc(m.folderId || '') + '">' + matchThumbHtml(m) + '</div>' +
              '<div class="tw-match-body">' +
                '<div class="tw-match-title-row">' +
                  '<span class="tw-match-title">' + esc(m.title) + '</span>' +
                  '<span class="tw-match-level' + (m.best ? ' is-best' : '') + '">' +
                    (m.best ? 'Best match · ' : '') + esc(m.label) + '</span>' +
                '</div>' +
                '<div class="tw-match-meta">EAN <span class="tp-mono">' + eanHtml(m.ean) +
                  '<span class="tp-copy" data-action="copy-match" data-ean="' + esc(m.ean) + '" title="Copy EAN" aria-label="Copy EAN">' + ICON.copy + '</span></span>' +
                  (m.artist ? ' <span class="tw-dot">·</span> by ' + esc(m.artist) : '') +
                '</div>' +
                (rowBadge
                  ? '<div class="tw-match-approve ' + rowBadge.cls + '" title="' + esc(rowBadge.detail || rowBadge.label) + '">' +
                      '<span class="tw-match-approve-label">' + esc(rowBadge.label) + '</span>' +
                      (rowBadge.detail
                        ? '<span class="tw-match-approve-detail">' + esc(rowBadge.detail) + '</span>'
                        : '') +
                    '</div>'
                  : '') +
              '</div>' +
            '</label>' +
            (m.drive
              ? '<a class="tw-match-folder" href="' + esc(m.drive) + '" target="_blank" rel="noopener" data-action="output">Output folder' + ICON.external + '</a>'
              : '<span class="tw-empty-matches">No output link</span>') +
          '</div>';
        }).join('') + '</div>'
      : '<p class="tw-empty-matches">No Completed work on the Render Tracker matches this Sub-category + Template yet. Primary is recommended — or continue with Product Replacement: enter a Completed EAN above, or drop prior images onto A in the workspace.</p>';

    const replaceSummary = selected
      ? 'Selected: <strong class="tp-mono">EAN ' + esc(selected.ean) + '</strong> (' + esc(selected.title) + ')' +
        (selected.best ? ' <span class="tw-dot">·</span> Best match' : '') +
        ' <span class="tw-dot">·</span> ' + esc(selected.label) +
        (selected.artist ? ' <span class="tw-dot">·</span> by ' + esc(selected.artist) : '')
      : (matches.length
        ? 'Select a prior match to continue with Product Replacement.'
        : 'No recommended prior match — enter a Completed EAN above, or continue and drop images onto A.');
    const summary = focus === 'primary'
      ? 'Primary workflow selected — A1 template + A2 PDP camera refs per shot, then B · C · D.'
      : replaceSummary;
    const continueAction = focus === 'primary' ? 'start-primary' : 'start-replace';
    const continueLabel = focus === 'primary' ? 'Continue with Primary workflow' : 'Continue with Product Replacement';
    // Primary and Product Replacement are both always available (PR can start without a prior match).
    const continueDisabled = focus === 'replace' && !canReplace;

    return '<div class="tw-shell tw-shell-choose">' +
      '<nav class="tw-crumb" aria-label="Breadcrumb">' +
        '<button type="button" class="tw-back-pill" data-ws="close">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>' +
          'Back to My Tasks</button>' +
        '<span class="tw-crumb-sep" aria-hidden="true">|</span>' +
        '<ol class="tw-crumb-list">' +
          '<li>My Tasks</li><li aria-hidden="true">›</li>' +
          '<li>Active</li><li aria-hidden="true">›</li>' +
          '<li aria-current="page">Choose workflow</li>' +
        '</ol>' +
      '</nav>' +

      '<section class="tw-product-card">' +
        '<div class="tw-top-thumb" aria-hidden="true">' +
          thumbHtml(t).replace('class="tp-thumb"', 'class="tp-thumb tw-top-thumb-inner"') +
        '</div>' +
        '<div class="tw-top-copy">' +
          '<div class="tw-kicker">Choose workflow</div>' +
          '<h1 class="tw-heading">' + esc(t.title || 'Untitled product') + '</h1>' +
          '<p class="tw-sub">EAN <span class="tp-mono">' + esc(t.ean) + '</span>' +
            (t.subCategory ? ' · ' + esc(t.subCategory) : '') +
            (t.template ? ' · Template ' + esc(t.template) : '') + '</p>' +
          '<div class="tw-meta-row">' +
            '<span class="tp-status is-' + st.id + '">' + esc(st.label) + '</span>' +
            (t.template ? '<span class="tw-chip">Template <span class="tp-mono">' + esc(t.template) + '</span></span>' : '') +
            (t.setLabel ? '<span class="tw-chip">' + esc(t.setLabel) + '</span>' : '') +
            '<span class="tw-chip">' + shotCount + ' shots</span>' +
            pdp +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="tw-card">' +
        '<div class="tw-card-head tw-card-head-stack">' +
          '<div class="tw-card-title tw-card-title-caps">How do you want to work this task?</div>' +
          '<div class="tw-card-note">Based on earlier Sub-category + Template / Product + Template / Template work.</div>' +
        '</div>' +
        '<div class="tw-card-body">' +
          '<div class="tw-flow-grid">' +
            '<button type="button" class="tw-flow-opt' +
              (focus === 'replace' ? ' is-focus' : '') +
              (preferReplace ? ' is-recommended' : '') +
              '" data-ws-focus="replace">' +
              (preferReplace ? '<span class="tw-rec-badge">Recommended</span>' : '') +
              '<div class="tw-flow-name"><span class="tw-flow-dot" aria-hidden="true"></span>Product Replacement</div>' +
              '<p class="tw-flow-desc">Use when someone already completed a similar Sub-category + Template (or a close Product / Template match). Map each required shot to the new product images one-to-one.</p>' +
              '<div class="tw-flow-steps-box"><ol class="tw-flow-steps">' +
                '<li>Review the best prior outputs</li>' +
                '<li>Map each shot to new product inputs</li>' +
                '<li>Generate / refine per shot</li>' +
              '</ol></div>' +
              '<div class="tw-flow-foot' + (matches.length ? ' is-ok' : '') + '">' +
                (matches.length
                  ? '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg> Prior completions found below for this template'
                  : 'No prior completions for this template yet') +
              '</div>' +
            '</button>' +
            '<button type="button" class="tw-flow-opt' +
              (focus === 'primary' ? ' is-focus' : '') +
              (!preferReplace ? ' is-recommended' : '') +
              '" data-ws-focus="primary">' +
              (!preferReplace ? '<span class="tw-rec-badge">Recommended</span>' : '') +
              '<div class="tw-flow-name">Primary workflow</div>' +
              '<p class="tw-flow-desc">Use for a new Sub-category + Template type. A1 auto-loads the template plate; A2 is the PDP camera ref per shot (A1 or A2 required). Optional A3 for rare custom refs. Then B product, C prompt, D output.</p>' +
              '<div class="tw-flow-steps-box is-muted"><ol class="tw-flow-steps">' +
                '<li>A1 template + A2 PDP camera (optional A3)</li>' +
                '<li>Drop product inputs on B and refine C</li>' +
                '<li>Generate D per required shot</li>' +
              '</ol></div>' +
              '<div class="tw-flow-foot">Start fresh — no prior match needed</div>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>' +

      (focus === 'primary'
        ? ''
        : '<section class="tw-card">' +
            '<div class="tw-card-head">' +
              '<div>' +
                '<div class="tw-card-title tw-card-title-caps">Possible previous matches</div>' +
                '<div class="tw-card-note">Best match first. Select a prior match to reuse outputs, or open Drive links to view folder assets.</div>' +
              '</div>' +
              '<div class="tw-match-head-right">' +
                '<form class="tw-manual-ean" data-ws-manual-ean-form>' +
                  '<label class="tw-manual-ean-label" for="tw-manual-ean-input">Or enter EAN</label>' +
                  '<input id="tw-manual-ean-input" class="tw-manual-ean-input" type="text" inputmode="numeric" ' +
                    'pattern="[0-9]*" maxlength="18" placeholder="e.g. 8909…" ' +
                    'value="' + esc((selected && selected.level === 'manual') ? String(selected.ean) : '') + '" ' +
                    'aria-label="Enter a Completed EAN for Product Replacement">' +
                  '<button type="submit" class="tp-btn tp-btn-ghost tw-manual-ean-btn">Use EAN</button>' +
                '</form>' +
                '<span class="tw-match-count">' + matches.length + ' match' + (matches.length === 1 ? '' : 'es') + ' found</span>' +
              '</div>' +
            '</div>' +
            '<div class="tw-card-body">' +
              (selected && selected.level === 'manual'
                ? '<div class="tw-manual-ean-selected">Using manual prior EAN <strong class="tp-mono">' +
                    esc(String(selected.ean)) + '</strong> — ' + esc(selected.title || '') +
                    '. Continue with Product Replacement below, or pick a recommended match.</div>'
                : '') +
              matchHtml +
            '</div>' +
          '</section>') +

      '<footer class="tw-confirm-bar">' +
        '<div class="tw-confirm-summary">' +
          '<span class="tw-confirm-check" aria-hidden="true">' +
            '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>' +
          '</span>' +
          '<span class="tw-confirm-text">' + summary + '</span>' +
        '</div>' +
        '<div class="tw-confirm-actions">' +
          '<button type="button" class="tp-btn tp-btn-primary tw-confirm-primary" data-ws="' + continueAction + '"' +
            (continueDisabled ? ' disabled' : '') + '>' +
            esc(continueLabel) +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>' +
          '</button>' +
        '</div>' +
      '</footer>' +
    '</div>';
  }

  function dropzoneHtml(opts) {
    const multi = !!opts.multi;
    return '<div class="tw-drop' + (multi ? ' is-multi' : '') + '" data-drop="' + esc(opts.id || '') + '" role="button" tabindex="0">' +
      '<div class="tw-drop-title">' + esc(opts.title || 'Drop images here') + '</div>' +
      '<div class="tw-drop-hint">' + esc(opts.hint || (multi ? 'One or more images · JPG / PNG' : 'Usually one image · JPG / PNG')) + '</div>' +
      '<div class="tw-drop-files">' +
        (opts.samples || []).map((n) => '<span class="tw-drop-file">' + esc(n) + '</span>').join('') +
      '</div>' +
    '</div>';
  }

  function workspaceShotNavHtml(t, shots, activeIndex) {
    return '<aside class="tw-shot-nav tw-card">' +
      '<div class="tw-card-head"><div class="tw-card-title">Required shots</div></div>' +
      '<div class="tw-card-body">' + shots.map((s, i) => {
        const shotStatus = i === 0 ? STATUS.in_progress : STATUS.not_started;
        return '<button type="button" class="tw-shot-btn' + (i === activeIndex ? ' is-active' : '') + '" data-ws-shot="' + i + '">' +
          '<span class="tw-shot-btn-name">' + esc(s.name) + '</span>' +
          '<span class="tw-shot-btn-meta">Seq ' + esc(s.seq) + '</span>' +
          '<span class="tp-status is-' + shotStatus.id + '">' + esc(shotStatus.label) + '</span>' +
        '</button>';
      }).join('') + '</div></aside>';
  }

  function primaryAssetDisplayLabel(asset, fallback) {
    const raw = String(
      (asset && (asset.label || asset.name)) || fallback || ''
    ).trim();
    if (!raw) return '';
    // Strip only a trailing image extension — keep codes like T9 / SF1 intact.
    return raw.replace(/\.(jpe?g|png|webp)$/i, '').trim() || raw;
  }

  function primaryRefFrameHtml(slot, shotIndex, opts) {
    const o = opts || {};
    const asset = o.asset || null;
    const url = asset ? ensureAssetDisplayUrl(asset) : '';
    const loading = !!o.loading;
    const err = o.error || '';
    const emptyTitle = o.emptyTitle || 'Drop image';
    const emptyHint = o.emptyHint || 'JPG / PNG · one image';
    // Prefer explicit displayName (e.g. sheet template code T9) over Drive file names.
    const displayName = String(o.displayName || '').trim() ||
      primaryAssetDisplayLabel(asset, '');
    const showChange = slot === 'a2' && !!o.canChange;
    return '<div class="wr-frame wr-frame-primary' +
      (url ? ' has-img' : '') +
      (loading ? ' is-loading' : '') +
      '" data-ws-drop="primary-' + slot + '"' +
      (url ? ' title="Drop to replace"' : '') + '>' +
      (url
        ? '<img class="tp-img" src="' + esc(url) + '" alt="' + esc(displayName || slot) +
            '" referrerpolicy="no-referrer">'
        : (loading
          ? '<span class="wr-frame-empty">Loading…</span>'
          : '<span class="wr-frame-empty">' +
              '<span class="wr-in-empty-title">' + esc(emptyTitle) + '</span>' +
              '<span class="wr-in-empty-hint">' + esc(err || emptyHint) + '</span>' +
            '</span>')) +
    '</div>' +
    '<div class="wr-card-meta">' +
      '<span class="wr-card-meta-name">' +
        '<span class="tp-mono" title="' + esc(displayName) + '">' +
          esc(displayName || (loading ? 'Loading…' : (err ? '—' : '—'))) +
        '</span>' +
        (showChange
          ? '<button type="button" class="wr-text-btn wr-a2-change" data-ws="change-primary-a2" title="Change PDP sequence for this shot">Change</button>'
          : '') +
      '</span>' +
      '<span>' + (asset && asset.w && asset.h
        ? asset.w + '×' + asset.h
        : (slot === 'a1' ? 'Template' : (asset && asset.pdpSeq != null ? 'PDP #' + asset.pdpSeq : '1 image'))) +
      '</span>' +
    '</div>';
  }

  function workspacePrimaryHtml(t) {
    ensurePrimaryState(t);
    const shots = shotListFor(t);
    const i = Math.min(state.workspaceShot, Math.max(0, shots.length - 1));
    const shot = shots[i] || shots[0];
    const st = statusOf(t);
    const assets = shotAssets(i);
    const inputAssets = assets.inputs || [];
    const primary = state.workspace.primary || {};
    const isMainView = isMainShot(shot);
    const isLifestyleView = isLifestyleShot(shot);
    const inputPlan = primaryInputPlan(i, { shots: shots });
    // Lifestyle A1 = optional per-shot only (blank by default). Other shots use template A1.
    const a1 = inputPlan.a1 || primarySlotAsset('a1', i);
    // MAIN A2 = Hero Front / 01 D; lifestyle / other = PDP.
    const a2 = inputPlan.a2 || primarySlotAsset('a2', i);
    const a3 = isLifestyleView ? null : primarySlotAsset('a3', i);
    const showA3 = !isLifestyleView && (primaryShowA3(i) || !!a3);
    const a1Loading = !isLifestyleView && !!primary.a1Loading;
    const a1Error = isLifestyleView ? '' : (primary.a1Error || '');
    const a2Loading = !isMainView && !!(primary.a2Loading && primary.a2Loading[String(i)]);
    const pdpMeta = isMainView ? null : pdpMetaForShot(shot, i);
    const pdpLoading = !!primary.pdpLoading;
    const pdpError = primary.pdpError || '';
    const pdpCount = (primary.pdp && primary.pdp.images && primary.pdp.images.length) || 0;
    const angleIdxForMain = isMainView ? angleSourceShotIndex(shots) : -1;
    const angleShotForMain = angleIdxForMain >= 0 ? shots[angleIdxForMain] : null;
    const mainHeroReady = isMainView && !!inputPlan.mainFromHero;
    const compiled = compilePrimaryPrompt(t, shot, { shotIndex: i });
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
    if (state.workspace.prompts[i] == null) {
      state.workspace.prompts[i] = compiled.text;
      rememberPromptBaseline(i, compiled.text);
      setPromptManualEdit(i, false);
    } else if (!isPromptManualEdit(i) &&
        normalizePromptCompare(state.workspace.prompts[i]) !== normalizePromptCompare(compiled.text)) {
      // Slot/script recompile — keep Automated, never yellow.
      state.workspace.prompts[i] = compiled.text;
      rememberPromptBaseline(i, compiled.text);
      setPromptManualEdit(i, false);
    } else if (state.workspace.promptBaselines[i] == null &&
        normalizePromptCompare(state.workspace.prompts[i]) === normalizePromptCompare(compiled.text)) {
      rememberPromptBaseline(i, compiled.text);
      setPromptManualEdit(i, false);
    }
    const promptText = state.workspace.prompts[i];
    const promptOriginPreview = promptOriginForShot(t, shot, null, promptText, i);
    const outAsset = assets.output || null;
    const outUrl = ensureAssetDisplayUrl(outAsset);
    const hasOutput = !!outUrl || !!(state.workspace.outputs && state.workspace.outputs[i]);
    const shotError = assets.error || null;
    const panelOpen = !!state.workspace.panelOpen;
    const panelMax = !!state.workspace.panelMax;
    const priorForDim = resolveWorkspaceMatch(t).selected;
    const dimsDiffer = productDimsDiffer(t, priorForDim);
    const pdp = t.pdpLink
      ? '<a class="tw-chip tw-chip-link" href="' + esc(t.pdpLink) + '" target="_blank" rel="noopener">PDP guideline' + ICON.external + '</a>'
      : '';
    const shootHref = t.driveLink || '';
    const driveChip = shootHref
      ? '<a class="tw-chip tw-chip-link" href="' + esc(shootHref) + '" target="_blank" rel="noopener">Shoot folder' + ICON.external + '</a>'
      : '';
    const genStage = state.workspace.genStage || '';
    const rating = shotRating(i);
    const comparePos = Math.min(100, Math.max(0, Number(state.workspace.comparePos) || 50));
    const canGenerate = hasWorkspaceProductType();
    const savedSize = localStorage.getItem(ANSWERLY_SIZE_KEY) || '2K';
    const savedModel = localStorage.getItem(ANSWERLY_MODEL_KEY) || 'gemini-3.1-flash-image';
    const modelOptions = (state.answerlyModels && state.answerlyModels.length)
      ? state.answerlyModels.map((m) => [m.id, m.label || m.id])
      : [
          ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'],
          ['gemini-3-pro-image', 'Gemini 3 Pro Image'],
          ['gemini-nano-banana-2.1', 'Nano Banana 2.1'],
          ['openai/gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'],
          ['krea/krea-realtime', 'Krea Realtime'],
          ['xai/grok-imagine', 'Grok Imagine']
        ];
    const productReady = isMainView
      ? productInputsForShot(i, shots).inputs.length > 0
      : inputAssets.length > 0;
    const refReady = isLifestyleView ? !!a2 : !!(a1 || a2);
    const a1Bytes = !!(a1 && (a1.blob || a1.file));
    const a2Bytes = !!(a2 && (a2.blob || a2.file));
    const a3Bytes = !!(a3 && (a3.blob || a3.file));
    const refsBytesReady = isLifestyleView
      ? (a2Bytes && (!a1 || a1Bytes))
      : ((!!a1 ? a1Bytes : true) && (!!a2 ? a2Bytes : true) &&
        (!!a3 ? a3Bytes : true) && !!(a1Bytes || a2Bytes));
    const primaryPayload = pickAnswerlyPrimaryPayload(i);
    const canRunShot = canGenerate && primaryPayload.ok && !isShotBusy(i);
    const canApprove = hasOutput && rating >= 4;
    const headCode = (shot && shot.code) || '';
    const headName = (shot && shot.name) || '';
    const synthName = (outAsset && outAsset.name) ||
      ((t.ean || 'EAN') + '_' + (headCode || ('S' + String(i + 1).padStart(2, '0'))) + '.png');
    const bStartNum = inputPlan.bStartNum;
    const primaryPending = canGenerate
      ? primaryGenAllPendingCandidates(t, shots, { includeDone: false })
      : [];
    const primaryPendingAll = canGenerate
      ? primaryGenAllPendingCandidates(t, shots, { includeDone: true })
      : [];
    const primaryDoneCount = canGenerate ? countGeneratedPrimaryShots(shots) : 0;
    const canGenAllPrimary = canGenerate && primaryPendingAll.length > 0 && !anyShotBusy();

    // Same as Replace: MAIN last. PDP A2 still maps by shot seq / override (not rail order).
    const rail = orderedRailShots(shots).map(({ s, idx }) => {
      const done = !!(state.workspace.outputs && state.workspace.outputs[idx]);
      const busy = isShotBusy(idx);
      const approved = !!(state.workspace.approved && state.workspace.approved[idx]);
      const inputCount = (shotAssets(idx).inputs || []).length;
      const isMain = isMainShot(s);
      const outThumb = done ? ensureAssetDisplayUrl(shotAssets(idx).output) : '';
      const pdpForShot = pdpMetaForShot(s, idx);
      return '<button type="button" class="wr-shot' +
        (idx === i ? ' is-active' : '') +
        (busy ? ' is-busy' : '') +
        (done ? ' is-done' : '') +
        (approved ? ' is-approved' : '') +
        (isMain ? ' is-main' : '') +
        '" data-ws-shot="' + idx + '" data-ws-drop-shot="' + idx + '" draggable="false">' +
        '<div class="wr-shot-thumb" draggable="false">' +
          (outThumb
            ? '<img class="tp-img" draggable="false" src="' + esc(outThumb) + '" alt="">'
            : '<span class="wr-ph is-pending">Yet to generate</span>') +
          (busy ? '<span class="wr-shot-busy">In progress</span>' : '') +
          (approved && !busy ? '<span class="wr-shot-done">Approved</span>' :
            (done && !busy ? '<span class="wr-shot-done">Done</span>' : '')) +
          (isMain && !busy ? '<span class="wr-shot-main-tag">MAIN</span>' : '') +
          (inputCount ? '<span class="wr-shot-inputs">' + inputCount + '/4</span>' : '') +
          (pdpForShot && pdpForShot.seq != null
            ? '<span class="wr-shot-a2-tag" title="PDP seq ' + esc(String(pdpForShot.seq)) + '">S' +
                esc(String(pdpForShot.seq)) + '</span>'
            : '') +
        '</div>' +
        '<div class="wr-shot-meta">' +
          '<span class="wr-shot-code-lbl">' + esc(s.code) + '</span>' +
          '<span class="wr-shot-full">' + esc(s.name) + '</span>' +
        '</div>' +
      '</button>';
    }).join('');

    const cappedInputs = inputAssets.slice(0, 4);
    const inputTiles = cappedInputs.length
      ? cappedInputs.map((asset, n) => {
          const thumbUrl = ensureAssetDisplayUrl(asset);
          const answerlyNum = bStartNum + n;
          return '<div class="wr-in-tile' + (asset.cropped ? ' is-cropped' : '') +
            '" data-ws-crop-input="' + n + '" title="Click to crop">' +
            '<span class="wr-in-num" title="reference_image_url_' + answerlyNum +
              ' · Answerly INPUT IMAGE ' + answerlyNum + ' (product B' + (n + 1) + ')">' +
              answerlyNum +
            '</span>' +
            '<button type="button" class="wr-in-remove" data-ws-remove-input="' + n + '" title="Remove">×</button>' +
            (thumbUrl
              ? '<img class="wr-in-thumb" src="' + esc(thumbUrl) + '" alt="' + esc(asset.name) + '">'
              : '<div class="wr-in-glyph" aria-hidden="true"></div>') +
            '<div class="wr-in-name" title="' + esc(asset.name) + '">' + esc(asset.name) + '</div>' +
            '<div class="wr-in-dim">' + (asset.w && asset.h ? asset.w + '×' + asset.h : '') + '</div>' +
          '</div>';
        }).join('') +
        (cappedInputs.length < 4
          ? '<div class="wr-in-empty wr-in-empty-slot" data-ws="add-input" role="button" tabindex="0">' +
              '<span class="wr-in-empty-title">Add more</span>' +
              '<span class="wr-in-empty-hint">Drop or browse</span>' +
            '</div>'
          : '')
      : '<div class="wr-in-empty" data-ws="add-input" role="button" tabindex="0">' +
          '<span class="wr-in-empty-title">Drop new product image(s)</span>' +
          '<span class="wr-in-empty-hint">JPG / PNG · up to 4 · local files</span>' +
        '</div>';

    const slotRefBadge = function (role, fallbackHtml) {
      const slot = (inputPlan.slots || []).find((s) => s.role === role);
      if (!slot) return fallbackHtml;
      return '<span class="wr-badge-teal" title="' + esc(slot.refKey) + '">#' + slot.inputImage + '</span> ' + fallbackHtml;
    };
    const a1Badge = slotRefBadge('a1', isLifestyleView
      ? (a1
        ? '<span class="wr-badge-ok">Added</span>'
        : '<span class="wr-badge-ghost">Optional</span>')
      : (a1
        ? '<span class="wr-badge-ok">Template</span>'
        : (a1Loading
          ? '<span class="wr-badge-ghost">Loading…</span>'
          : (a1Error
            ? '<span class="wr-badge-muted">Missing</span>'
            : '<span class="wr-badge-ghost">Auto</span>'))));
    const a2Badge = slotRefBadge('a2', isMainView
      ? (mainHeroReady
        ? '<span class="wr-badge-ok">Hero Front D</span>'
        : (angleShotForMain
          ? '<span class="wr-badge-muted">Needs ' + esc(angleShotForMain.code || 'H-FR') + ' D</span>'
          : '<span class="wr-badge-muted">Needs Hero Front / 01</span>'))
      : (a2
        ? '<span class="wr-badge-teal">Seq ' + esc(String((a2.pdpSeq != null ? a2.pdpSeq : (pdpMeta && pdpMeta.seq)) || '—')) + '</span>'
        : (a2Loading || pdpLoading
          ? '<span class="wr-badge-ghost">Loading…</span>'
          : (pdpError
            ? '<span class="wr-badge-muted">PDP</span>'
            : (pdpMeta
              ? '<span class="wr-badge-ghost">Seq ' + esc(String(pdpMeta.seq)) + '</span>'
              : '<span class="wr-badge-ghost">PDP seq</span>')))));
    const a3Badge = slotRefBadge('a3', a3
      ? '<span class="wr-badge-teal">Custom</span>'
      : '<span class="wr-badge-ghost">Optional</span>');
    const pdpMatchNote = isMainView
      ? (mainHeroReady
        ? 'MAIN A2 ← ' + ((angleShotForMain && (angleShotForMain.name || angleShotForMain.code)) || 'Hero Front / 01') + ' D'
        : 'MAIN requires Hero Front / 01 generated D first')
      : (pdpCount
        ? (pdpCount === shots.length
          ? pdpCount + ' PDP · ' + shots.length + ' shots matched'
          : pdpCount + ' PDP · ' + shots.length + ' shots (check seq)')
        : (pdpLoading ? 'Loading PDP slide…' : (pdpError || 'PDP not loaded')));

    return '<div class="tw-shell tw-shell-replace tw-shell-primary">' +
      '<nav class="tw-crumb" aria-label="Breadcrumb">' +
        '<button type="button" class="tw-back-pill" data-ws="choose">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>' +
          'Choose workflow</button>' +
        '<span class="tw-crumb-sep" aria-hidden="true">/</span>' +
        '<ol class="tw-crumb-list">' +
          '<li>My Tasks</li><li aria-hidden="true">›</li>' +
          '<li><button type="button" class="tw-crumb-link" data-ws="choose">Choose workflow</button></li>' +
          '<li aria-hidden="true">›</li>' +
          '<li aria-current="page">Primary workflow</li>' +
        '</ol>' +
      '</nav>' +

      '<section class="wr-product">' +
        '<div class="wr-product-main">' +
          '<div class="tw-top-thumb" aria-hidden="true">' +
            thumbHtml(t).replace('class="tp-thumb"', 'class="tp-thumb tw-top-thumb-inner"') +
          '</div>' +
          '<div class="tw-top-copy">' +
            '<div class="tw-kicker">Primary workflow</div>' +
            '<h1 class="tw-heading">' + esc(t.title || 'Untitled product') + '</h1>' +
            '<p class="tw-sub">EAN ' + eanCopyHtml(t.ean) +
              (t.subCategory ? ' · ' + esc(t.subCategory) : '') +
              (t.template ? ' · Template ' + esc(t.template) : '') + '</p>' +
            '<div class="tw-meta-row">' +
              '<span class="tp-status is-' + st.id + '">' + esc(st.label) + '</span>' +
              (t.template ? '<span class="tw-chip">Template <span class="tp-mono">' + esc(t.template) + '</span></span>' : '') +
              (t.setLabel ? '<span class="tw-chip">' + esc(t.setLabel) + '</span>' : '') +
              '<span class="tw-chip">' + (canGenerate ? shots.length + ' shots' : 'Select product type') + '</span>' +
              pdp + driveChip +
              '<button type="button" class="tw-reset-ean" data-ws="reset-ean" title="Clear all generated images (B/D), ratings, and restore Universal Prompt DB defaults for this EAN">' +
                'Reset all Gen Img &amp; Prompt</button>' +
            '</div>' +
          '</div>' +
          productTypePickerHtml() +
        '</div>' +
        '<div class="wr-prior-bar">' +
          '<div class="wr-prior-meta">' +
            '<span>' +
              (isLifestyleView
                ? 'Lifestyle · A1 mostly not required'
                : ('A1 template image' + (t.template ? ' · ' + esc(t.template) : ''))) +
            '</span>' +
            '<span class="tw-dot">·</span>' +
            '<span>' + esc(pdpMatchNote) + '</span>' +
            '<span class="tw-dot">·</span>' +
            '<span>' +
              (isLifestyleView
                ? 'A2 lifestyle scene + B · Product replacement Final successful prompt'
                : (isMainView
                  ? 'MAIN requires Hero Front / 01 D · A1 optional · Prompt from Universal DB'
                  : 'A1 or A2 required · A3 optional · Prompt from Universal DB')) +
            '</span>' +
          '</div>' +
          (function () {
            const execId = shotExecutionId(i);
            const jobHref = answerlyJobUrl(execId);
            if (!execId || !jobHref) return '';
            const shortId = String(execId).split('-')[0] || execId.slice(0, 8);
            return '<span class="wr-answerly-job-wrap">' +
              '<span class="wr-answerly-id tp-mono" title="' + esc(execId) + '">' + esc(shortId) + '</span>' +
              '<button type="button" class="tp-copy wr-answerly-copy" data-ws-copy-exec="' + esc(execId) +
                '" title="Copy Answerly id" aria-label="Copy Answerly id">' + ICON.copy + '</button>' +
              '<a class="wr-answerly-job" href="' + esc(jobHref) +
                '" target="_blank" rel="noopener" title="Open in Answerly · ' + esc(execId) + '">' +
                'Open in answerly' +
              '</a>' +
            '</span>';
          }()) +
          '<div class="wr-prior-actions">' +
            '<button type="button" class="wr-token-chip ' + tokenChipClass(state.answerlyToken) +
              '" data-ws="answerly-token" title="' +
              esc((state.answerlyToken && state.answerlyToken.error) || formatTokenExpiryDetail(state.answerlyToken)) + '">' +
              esc(formatTokenExpiry(state.answerlyToken)) +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<div class="wr-grid' + (panelOpen && !panelMax ? '' : ' is-panel-closed') + '">' +
        '<aside class="wr-rail" data-ws-drop="rail" data-rail-zoom="' +
          (railZoomLevel() <= 0.55 ? 'dense' : (railZoomLevel() <= 0.8 ? 'compact' : 'full')) + '">' +
          '<div class="wr-rail-head">' +
            '<div class="wr-rail-title-row">' +
              '<div class="wr-rail-title">Required shots (' + shots.length + ')</div>' +
              '<div class="wr-rail-zoom" role="group" aria-label="Thumbnail size">' +
                '<button type="button" class="wr-rail-zoom-btn" data-ws="rail-zoom-out" title="Smaller thumbnails" aria-label="Zoom out">−</button>' +
                '<span class="wr-rail-zoom-label" data-wr-rail-zoom-label>' + Math.round(railZoomLevel() * 100) + '%</span>' +
                '<button type="button" class="wr-rail-zoom-btn" data-ws="rail-zoom-in" title="Larger thumbnails (max = default)" aria-label="Zoom in">+</button>' +
              '</div>' +
            '</div>' +
            '<div class="wr-rail-sub">MAIN last · blank until D · A2 follows shot seq</div>' +
          '</div>' +
          '<nav class="wr-rail-list">' + rail + '</nav>' +
          '<div class="wr-rail-foot">' +
            (anyShotBusy()
              ? '<button type="button" class="wr-btn-outline wr-cancel-all-btn" data-ws="cancel-gen" data-cancel-all="1" title="Stop all in-flight Answerly jobs">' +
                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18"/></svg>' +
                  (busyShotIndexes().length > 1 || state.workspace.genAllBatch
                    ? 'Cancel all (' + busyShotIndexes().length + ')'
                    : 'Cancel generation') +
                '</button>'
              : '<button type="button" class="wr-btn-outline" data-ws="gen-all-primary"' +
                  (!canGenAllPrimary ? ' disabled' : '') +
                  (canGenerate
                    ? (primaryPendingAll.length
                        ? ' title="' +
                          (primaryDoneCount
                            ? primaryDoneCount + ' already in D · choose skip or regenerate'
                            : 'Generate ' + primaryPending.length + ' shot' + (primaryPending.length > 1 ? 's' : '') + ' ready with A1|A2 + B') +
                          ' (skips M-DIM · parallel)"'
                        : ' title="No shots ready — need A1 or A2 plus B on each shot"')
                    : ' title="Select a Product Type first"') + '>' +
                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>' +
                  'Generate all pending</button>') +
          '</div>' +
        '</aside>' +
        '<div class="wr-rail-splitter" data-ws-rail-split title="Drag to resize shots panel" role="separator" aria-orientation="vertical" aria-label="Resize shots panel"></div>' +

        '<div class="wr-main-wrap">' +
        (isDimensionShot(shot) && !state.workspace.mdimShowAbcd && state.workspace.mdimMainMax
          ? '<div class="wr-mdim-max-backdrop" data-mdim="toggle-main-max" title="Exit large editor"></div>'
          : '') +
        '<section class="wr-main' +
          (isDimensionShot(shot) && !state.workspace.mdimShowAbcd && state.workspace.mdimMainMax ? ' is-max' : '') +
          '">' +
          '<header class="wr-main-head">' +
            '<h2 class="wr-main-title">' + esc(headName) + '</h2>' +
            '<span class="wr-code">' + esc(headCode) + '</span>' +
            (isDimensionShot(shot) && dimsDiffer ? mdimDimDiffHeadHtml(t, priorForDim) : '') +
            (isShotBusy(i)
              ? '<span class="wr-pill-progress">' +
                  esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'In progress') +
                '</span>'
              : '') +
            (shotError && !isShotBusy(i)
              ? '<span class="wr-pill-error" title="' + esc(shotError) + '">Failed</span>'
              : '') +
          '</header>' +

          (isDimensionShot(shot) && !state.workspace.mdimShowAbcd
            ? mdimWorkbenchSectionHtml(t, shot, i)
            : '' +
          (isDimensionShot(shot) && state.workspace.mdimShowAbcd
            ? '<div class="mdim-abcd-bar">' +
                '<span class="mdim-abcd-note">A1·A2·B·C·D for a custom plate. Generate a new D, then return — or drop an image on the dimension editor to override.</span>' +
                '<button type="button" class="tp-btn tp-btn-primary" data-mdim="back-editor">Back to dimension editor</button>' +
              '</div>'
            : '') +

          '<div class="wr-pair wr-pair-primary-a' +
            (isLifestyleView ? ' is-lifestyle-optional-a1' : '') +
            (showA3 ? ' has-a3' : '') + '">' +
            '<div class="wr-card' + (isLifestyleView && !a1 ? ' is-optional-empty' : '') + '">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">' +
                  (isLifestyleView
                    ? 'A1 · Optional ' + a1Badge +
                      '<span class="wr-a1-optional-note" title="Mostly not required for lifestyle">mostly not required</span>'
                    : ('A1 · Template image ' + a1Badge)) +
                '</div>' +
                '<div class="wr-card-head-actions">' +
                  (a1
                    ? '<button type="button" class="wr-text-btn" data-ws="clear-primary-a1" title="' +
                        (isLifestyleView
                          ? 'Clear optional A1'
                          : 'Clear template image (Drive copy stays restorable)') +
                      '">Clear</button>'
                    : (
                        (!isLifestyleView && (primary.a1Cleared || t.template)
                          ? '<button type="button" class="wr-text-btn" data-ws="restore-primary-a1" title="Reload template image from Drive">Restore template</button>'
                          : '') +
                        '<button type="button" class="wr-text-btn" data-ws="browse-primary-a1">+ Browse</button>'
                      )) +
                '</div>' +
              '</div>' +
              primaryRefFrameHtml('a1', i, {
                asset: a1,
                loading: a1Loading && !a1,
                error: a1Error,
                displayName: isLifestyleView
                  ? primaryAssetDisplayLabel(a1, 'Optional A1')
                  : (tidyTemplate(t.template) ||
                    primaryAssetDisplayLabel(a1, '') ||
                    String(t.template || '').trim()),
                emptyTitle: isLifestyleView
                  ? 'Optional — mostly not required'
                  : (t.template ? ('Drop ' + tidyTemplate(t.template) + ' image') : 'Drop template image'),
                emptyHint: isLifestyleView
                  ? 'Lifestyle uses A2 scene + B · add A1 only if needed'
                  : (a1Error || (primary.a1Cleared
                    ? 'Cleared — Restore template from Drive, or drop JPG/PNG'
                    : 'Auto-loads from template folder · or drop JPG/PNG'))
              }) +
            '</div>' +

            '<div class="wr-card">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">' +
                  (isMainView
                    ? 'A2 · Hero Front / 01 D (required) '
                    : (isLifestyleView
                      ? 'A2 · PDP Lifestyle reference '
                      : 'A2 · PDP camera reference ')) +
                  a2Badge +
                '</div>' +
                '<div class="wr-card-head-actions">' +
                  (isMainView
                    ? (mainHeroReady
                      ? '<span class="wr-badge-ghost">From ' +
                          esc((angleShotForMain && (angleShotForMain.code || angleShotForMain.name)) || 'H-FR') +
                        '</span>'
                      : '<span class="wr-badge-muted">Generate Hero Front first</span>')
                    : (pdpNeedsAuth({ message: pdpError })
                      ? '<button type="button" class="wr-text-btn" data-ws="pdp-allow-access" title="Grant Google access for PDP slides">Allow access</button>'
                      : (a2
                        ? '<button type="button" class="wr-text-btn" data-ws="clear-primary-a2">Clear</button>'
                        : '<button type="button" class="wr-text-btn" data-ws="browse-primary-a2">+ Browse</button>'))) +
                  (!isLifestyleView && !showA3
                    ? '<button type="button" class="wr-text-btn" data-ws="add-primary-a3" title="Rare custom reference">+ A3</button>'
                    : '') +
                '</div>' +
              '</div>' +
              primaryRefFrameHtml('a2', i, {
                asset: a2,
                loading: !isMainView && (a2Loading || pdpLoading) && !(a2 && ensureAssetDisplayUrl(a2)),
                error: !a2
                  ? (isMainView
                    ? ((angleShotForMain && (angleShotForMain.name || angleShotForMain.code))
                      ? ('Generate ' + (angleShotForMain.name || angleShotForMain.code) + ' first')
                      : 'Generate Hero Front / seq 01 first')
                    : (pdpError || ''))
                  : '',
                displayName: isMainView
                  ? primaryAssetDisplayLabel(a2, (angleShotForMain && (angleShotForMain.name || angleShotForMain.code)) || 'Hero Front D')
                  : primaryA2DisplayName(shot, pdpMeta, a2),
                canChange: !isMainView && pdpCount > 0,
                emptyTitle: isMainView
                  ? 'Waiting for Hero Front / 01 D'
                  : (isLifestyleView ? 'PDP Lifestyle reference' : 'PDP camera reference'),
                emptyHint: isMainView
                  ? 'Same rule as Product Replacement — MAIN uses that generated D as camera / composition'
                  : (isLifestyleView
                    ? (pdpError
                      ? pdpError
                      : ('Lifestyle scene · shot seq ' + esc(String((shot && shot.seq) || (i + 1))) +
                        (pdpMeta ? ' · PDP #' + pdpMeta.seq : '') +
                        ' · replace product in this scene · or Change'))
                    : (pdpError
                      ? pdpError
                      : ('Shot seq ' + esc(String((shot && shot.seq) || (i + 1))) +
                        (pdpMeta ? ' · PDP #' + pdpMeta.seq : '') +
                        ' · auto from presentation · or Change')))
              }) +
            '</div>' +

            (showA3
              ? '<div class="wr-card">' +
                  '<div class="wr-card-head">' +
                    '<div class="wr-card-label">A3 · Custom ref ' + a3Badge + '</div>' +
                    '<div class="wr-card-head-actions">' +
                      (a3
                        ? '<button type="button" class="wr-text-btn" data-ws="clear-primary-a3">Clear</button>'
                        : '<button type="button" class="wr-text-btn" data-ws="browse-primary-a3">+ Browse</button>') +
                      '<button type="button" class="wr-text-btn" data-ws="hide-primary-a3" title="Hide optional A3">Hide</button>' +
                    '</div>' +
                  '</div>' +
                  primaryRefFrameHtml('a3', i, {
                    asset: a3,
                    emptyTitle: 'Optional custom ref',
                    emptyHint: 'Rare · one image · e.g. floor cushion extras'
                  }) +
                '</div>'
              : '') +
          '</div>' +

          '<div class="wr-pair wr-pair-primary-bcd">' +
            '<div class="wr-card">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">B · New product input ' +
                  (cappedInputs.length
                    ? '<span class="wr-badge-teal">' + cappedInputs.length + ' / 4</span>'
                    : '') +
                '</div>' +
                (cappedInputs.length < 4
                  ? '<button type="button" class="wr-text-btn" data-ws="add-input">+ Browse</button>'
                  : '<span class="wr-badge-ghost">Max 4</span>') +
              '</div>' +
              '<div class="wr-in-grid wr-in-count-' + Math.max(1, Math.min(4, cappedInputs.length + (cappedInputs.length && cappedInputs.length < 4 ? 1 : 0))) +
                (cappedInputs.length ? '' : ' is-empty') + '" data-ws-drop="inputs">' +
                inputTiles +
              '</div>' +
            '</div>' +

            '<div class="wr-card wr-card-prompt">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">C · Prompt</div>' +
                '<div class="wr-prompt-head-actions">' +
                  '<span class="wr-badge-ghost' +
                    (promptOriginPreview === 'Custom' ? ' is-custom' : ' is-automated') +
                    '" data-ws-prompt-origin="' + esc(promptOriginPreview) + '">' +
                    esc(promptOriginPreview) +
                  '</span>' +
                  '<button type="button" class="wr-icon-btn wr-prompt-expand" data-ws="prompt-expand" title="Expand prompt" aria-label="Expand prompt">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>' +
                  '</button>' +
                '</div>' +
              '</div>' +
              '<div class="wr-prompt-wrap' +
                (isPromptManualEdit(i) && normalizePromptCompare(promptText) &&
                  normalizePromptCompare(promptText) !== normalizePromptCompare(
                    storedPromptBaseline(i) || compiled.text)
                  ? ' has-diff' : '') + '">' +
                '<div class="wr-prompt-highlight" data-ws-prompt-highlight aria-hidden="true">' +
                  (isPromptManualEdit(i)
                    ? promptDiffHighlightHtml(promptText, storedPromptBaseline(i) || compiled.text)
                    : formatPromptOverlayHtml(esc(promptText).replace(/\n/g, '<br>'))) +
                '</div>' +
                '<textarea class="wr-prompt" data-ws-prompt="' + i + '" rows="8" placeholder="Compiled Primary prompt">' + esc(promptText) + '</textarea>' +
              '</div>' +
              '<div class="wr-prompt-foot">' +
                '<span class="wr-prompt-note">' +
                  promptOriginNoteHtml(t, shot, compiled, promptOriginPreview, null) +
                '</span>' +
                '<div class="wr-prompt-actions">' +
                  '<button type="button" class="wr-text-btn" data-ws="prompt-reset" title="Restore the compiled Primary prompt">Default</button>' +
                  '<button type="button" class="wr-text-btn" data-ws="prompt-clear" title="Clear the prompt field">Clear</button>' +
                  '<button type="button" class="wr-text-btn" data-ws="prompt-copy">Copy</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div class="wr-card wr-card-out">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">D · Output · Answerly</div>' +
                '<span class="' + (isShotBusy(i) ? 'wr-badge-busy' : (shotError ? 'wr-badge-muted' : 'wr-badge-ok')) + '"' +
                  (isShotBusy(i)
                    ? ' title="' + esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'Working…') + '"'
                    : '') + '>' +
                  (isShotBusy(i)
                    ? esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'Working…')
                    : (shotError ? 'Failed' : (hasOutput ? 'Done' : 'Ready'))) +
                '</span>' +
              '</div>' +
              '<div class="wr-out-controls">' +
                '<label class="wr-size-label">Size <select class="wr-size-select">' +
                  ['1K', '2K', '4K'].map((s) =>
                    '<option value="' + s + '"' + (s === savedSize ? ' selected' : '') + '>' + s + '</option>'
                  ).join('') +
                '</select></label>' +
                '<label class="wr-model-label">Model <select class="wr-model-select">' +
                  modelOptions.map((opt) =>
                    '<option value="' + esc(opt[0]) + '"' + (opt[0] === savedModel ? ' selected' : '') + '>' +
                      esc(opt[1]) + '</option>'
                  ).join('') +
                '</select></label>' +
              '</div>' +
              '<div class="wr-out-frame' +
                (isShotBusy(i) ? ' is-busy'
                  : (shotError ? ' has-error'
                    : (hasOutput ? ' has-result' : ''))) + '">' +
                (isShotBusy(i)
                  ? '<div class="wr-out-progress" aria-live="polite">' +
                      '<div class="wr-out-progress-title">' +
                        esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'Generating…') +
                      '</div>' +
                      '<div class="wr-out-progress-sub">Answerly is working on this shot</div>' +
                      '<div class="tp-mono">' + esc(synthName) + '</div>' +
                    '</div>'
                  : shotError
                    ? '<div class="wr-out-error" aria-live="assertive">' + esc(shotError) + '</div>' +
                      '<div class="tp-mono">' + esc(synthName) + '</div>'
                    : (outUrl
                      ? '<img class="wr-out-img" src="' + esc(outUrl) + '" alt="Answerly output">' +
                        '<button type="button" class="wr-out-download" data-ws="download-out" title="Download generated image" aria-label="Download generated image">' +
                          ICON.download +
                        '</button>' +
                        '<div class="wr-out-meta">' +
                          '<div class="tp-mono">' + esc(synthName) + '</div>' +
                          (outAsset.w && outAsset.h
                            ? '<div class="wr-out-dims">' + outAsset.w + ' × ' + outAsset.h + '</div>'
                            : '') +
                        '</div>'
                      : '<div class="wr-out-ready">' +
                          (!canGenerate
                            ? 'Select Product Type to start'
                            : (!primaryPayload.ok
                              ? esc(primaryPayload.error || 'Inputs not ready')
                              : (isShotBusy(i)
                                ? 'Generation in progress…'
                                : 'Ready — Generate this shot'))) +
                        '</div><div class="tp-mono">' + esc(synthName) + '</div>')) +
              '</div>' +
              (isShotBusy(i)
                ? '<button type="button" class="tp-btn tp-btn-ghost wr-gen-btn wr-cancel-btn" data-ws="cancel-gen" data-shot="' + i + '"' +
                    ' title="Stop this Answerly job">' +
                    ((state.workspace.cancelShots && state.workspace.cancelShots[i]) || state.workspace.cancelAll
                      ? 'Cancelling…'
                      : 'Cancel generation') +
                  '</button>'
                : '<button type="button" class="tp-btn tp-btn-primary wr-gen-btn" data-ws="gen-primary-shot"' +
                    (!canRunShot ? ' disabled' : '') +
                    ' title="' +
                      (!canGenerate
                        ? 'Select a Product Type first'
                        : (!primaryPayload.ok
                          ? esc(primaryPayload.error || 'Inputs not ready')
                          : (hasOutput ? 'Regenerate with Answerly' : 'Generate with Answerly'))) +
                    '">' +
                    (hasOutput ? 'Regenerate this shot' : 'Generate this shot') +
                  '</button>') +
            '</div>' +
          '</div>' +
            '') +
        '</section>' +
        (!panelOpen
          ? '<button type="button" class="wr-panel-tab" data-ws-panel="open" title="Open Detail &amp; Compare">Detail &amp; Compare</button>'
          : '') +
        '</div>' +

        (panelOpen
          ? '<aside class="wr-panel' + (panelMax ? ' is-max' : '') + '">' +
              '<div class="wr-panel-head">' +
                '<div class="wr-panel-title">Detail &amp; Compare</div>' +
                '<div class="wr-panel-tools">' +
                  '<button type="button" class="wr-icon-btn" data-ws-panel="max" title="Maximize">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>' +
                  '</button>' +
                  '<button type="button" class="wr-icon-btn" data-ws-panel="close" title="Close">✕</button>' +
                '</div>' +
              '</div>' +
              '<div class="wr-compare" data-ws-compare>' +
                '<div class="wr-compare-base">' +
                  (outUrl
                    ? '<img class="wr-compare-img" src="' + esc(outUrl) + '" alt="Generated output">'
                    : hasOutput
                      ? '<div class="wr-compare-ph is-out">Generated</div>'
                      : '<div class="wr-compare-ph">Generate to compare</div>') +
                '</div>' +
                '<div class="wr-compare-overlay" style="width:' + comparePos + '%">' +
                  (a2 && ensureAssetDisplayUrl(a2)
                    ? '<div class="wr-compare-overlay-inner is-override" title="' +
                        (isMainView
                          ? 'A2 · Hero Front / 01 D'
                          : (isLifestyleView
                            ? 'A2 · PDP Lifestyle reference'
                            : 'A2 · PDP camera reference')) + '">' +
                        '<img class="tp-img wr-compare-img" src="' + esc(ensureAssetDisplayUrl(a2)) +
                          '" alt="' + esc(a2.name || 'A2') + '">' +
                      '</div>'
                    : (a1 && ensureAssetDisplayUrl(a1)
                      ? '<div class="wr-compare-overlay-inner is-override" title="A1 · Template image">' +
                          '<img class="tp-img wr-compare-img" src="' + esc(ensureAssetDisplayUrl(a1)) +
                            '" alt="' + esc(a1.name || 'A1') + '">' +
                        '</div>'
                      : '<div class="wr-compare-ph">' +
                          (isLifestyleView ? 'A2 Lifestyle' : 'A1 / A2') +
                        '</div>')) +
                '</div>' +
                '<input class="wr-compare-range" type="range" min="0" max="100" value="' + comparePos + '" aria-label="Compare slider">' +
                '<div class="wr-compare-handle" style="left:' + comparePos + '%" aria-hidden="true"></div>' +
              '</div>' +
              '<div class="wr-specs">' +
                '<div class="wr-spec"><span>Resolution</span><span class="tp-mono">Square</span></div>' +
                '<div class="wr-spec"><span>Target EAN</span>' + eanCopyHtml(t.ean) + '</div>' +
                '<div class="wr-spec"><span>Refs</span><span class="tp-mono">' +
                  (isLifestyleView
                    ? ((a2 ? 'A2 Lifestyle' : '—') + (a1 ? ' · A1 opt' : ''))
                    : ((a1 ? 'A1' : '—') + (a2 ? ' · A2' : '') + (showA3 && a3 ? ' · A3' : ''))) +
                '</span></div>' +
                '<div class="wr-spec"><span>Model</span><span class="tp-mono">' +
                  esc((outAsset && outAsset.model) || savedModel) + '</span></div>' +
              '</div>' +
              '<div class="wr-panel-actions">' +
                '<div class="wr-rating">' +
                  '<span class="wr-rating-label">Quality Rating</span>' +
                  '<div class="wr-stars" role="radiogroup" aria-label="Quality rating">' +
                    [1, 2, 3, 4, 5].map((n) =>
                      '<button type="button" class="wr-star' + (rating >= n ? ' is-on' : '') + '" data-ws-rating="' + n + '"' +
                        (hasOutput ? '' : ' disabled') +
                        ' aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">★</button>'
                    ).join('') +
                  '</div>' +
                '</div>' +
                '<button type="button" class="wr-btn-outline" data-ws="reroll-prompt"' +
                  (hasOutput ? '' : ' disabled title="Generate an image first"') + '>Re-roll with prompt tweaks</button>' +
                '<button type="button" class="tp-btn tp-btn-primary" data-ws="prompt-approve"' +
                  (canApprove ? '' : ' disabled title="Generate and rate 4–5 stars first"') +
                  '>Rate &amp; Approve</button>' +
                (rating >= 1 && rating <= 3
                  ? '<div class="wr-approve-hint">1–3 stars: re-roll only — Rate &amp; Approve stays off so low quality does not go to production.</div>'
                  : '') +
              '</div>' +
            '</aside>'
          : '') +
      '</div>' +

      (canGenerate && shots.length ? approvedExportCardHtml(t, shots) : '') +
    '</div>';
  }

  function workspaceReplaceHtml(t) {
    ensureReplaceState(t);
    const shots = shotListFor(t);
    scrubBorrowedMainInputs(shots);
    const i = Math.min(state.workspaceShot, Math.max(0, shots.length - 1));
    const shot = shots[i] || shots[0];
    const prior = resolveWorkspaceMatch(t).selected;
    const st = statusOf(t);
    const assets = shotAssets(i);
    const inputAssets = assets.inputs || [];
    const priorOverride = assets.priorOverride || null;
    const mainBorrowNote = isMainShot(shot) && !inputAssets.length && mainHasProductRefs(i, shots);
    const compiled = compileReplacePrompt(t, shot, prior, { shotIndex: i });
    if (!state.workspace.prompts) state.workspace.prompts = {};
    if (!state.workspace.promptBaselines) state.workspace.promptBaselines = {};
    // First fill: prefer a prior Custom prompt from the same Sub-category + Template (+ shot).
    const reusedCustom = (state.workspace.prompts[i] == null) ? findReusedCustomPrompt(t, shot) : null;
    if (state.workspace.prompts[i] == null) {
      state.workspace.prompts[i] = (reusedCustom && reusedCustom.prompt) || compiled.text;
      rememberPromptBaseline(i, compiled.text);
      if (reusedCustom && reusedCustom.prompt) {
        if (!state.workspace.promptReuse) state.workspace.promptReuse = {};
        state.workspace.promptReuse[i] = {
          ean: reusedCustom.ean,
          author: reusedCustom.author || '',
          rating: reusedCustom.qualityRating || ''
        };
      }
    } else if (state.workspace.promptBaselines[i] == null &&
        normalizePromptCompare(state.workspace.prompts[i]) === normalizePromptCompare(compiled.text)) {
      rememberPromptBaseline(i, compiled.text);
    }
    const promptText = state.workspace.prompts[i];
    const promptOriginPreview = promptOriginForShot(t, shot, prior, promptText, i);
    const reuseMeta = state.workspace.promptReuse && state.workspace.promptReuse[i];
    const outAsset = assets.output || null;
    const outUrl = ensureAssetDisplayUrl(outAsset);
    const hasOutput = !!outUrl || !!(state.workspace.outputs && state.workspace.outputs[i]);
    const shotError = assets.error || null;
    const dimsDiffer = productDimsDiffer(t, prior);
    const panelOpen = state.workspace.panelOpen !== false;
    const panelMax = !!state.workspace.panelMax;
    const pdp = t.pdpLink
      ? '<a class="tw-chip tw-chip-link" href="' + esc(t.pdpLink) + '" target="_blank" rel="noopener">PDP guideline' + ICON.external + '</a>'
      : '';
    // Target EAN photoshoot Drive folder (Shoot Tracker), not prior/output.
    const shootHref = t.driveLink || '';
    const driveChip = shootHref
      ? '<a class="tw-chip tw-chip-link" href="' + esc(shootHref) + '" target="_blank" rel="noopener">Shoot folder' + ICON.external + '</a>'
      : '';
    const generating = state.workspace.generating;
    const genStage = state.workspace.genStage || '';
    const rating = shotRating(i);
    const comparePos = Math.min(100, Math.max(0, Number(state.workspace.comparePos) || 50));
    const driveImgs = priorDriveImages(prior);
    if (state.workspace.driveImgIndex == null && driveImgs.length) {
      state.workspace.driveImgIndex = defaultDriveImgIndex(prior);
    }
    const driveImgIndex = driveImgs.length
      ? Math.min(Math.max(0, Number(state.workspace.driveImgIndex) || 0), driveImgs.length - 1)
      : 0;
    const canGenerate = hasWorkspaceProductType();
    const codeMap = canGenerate ? priorTargetCodeMap(prior, shots) : { mapped: [], unmappedPrior: [], missingTarget: [], hasConflict: false };
    const unmappedIdx = new Set((codeMap.unmappedPrior || []).map((x) => x.imgIdx));
    const mappedPending = canGenerate
      ? genAllPendingCandidates(t, prior, shots, { includeDone: false })
      : [];
    const mappedAll = canGenerate
      ? genAllPendingCandidates(t, prior, shots, { includeDone: true })
      : [];
    const mappedDoneCount = canGenerate ? countGeneratedMappedShots(t, prior, shots) : 0;
    const canGenAll = canGenerate && mappedAll.length > 0 && !anyShotBusy();
    const selectedMapped = !driveImgs.length || !canGenerate || !unmappedIdx.has(driveImgIndex);
    const drivePriorMeta = selectedDrivePriorMeta();
    const priorFetch = state.workspace.priorFetch || null;
    const priorLoading = !!(drivePriorMeta && !priorOverride && priorFetch && priorFetch.id === drivePriorMeta.img.id && priorFetch.status === 'loading');
    const priorFetchError = !!(drivePriorMeta && !priorOverride && priorFetch && priorFetch.id === drivePriorMeta.img.id && priorFetch.status === 'error');
    const selectedDriveName = (driveImgs[driveImgIndex] && driveImgs[driveImgIndex].name) || '';
    const synthName = (outAsset && outAsset.name) || synthesizeFileName(t, selectedDriveName, shot);
    const headCode = shot.code || (selectedDriveName ? driveImgLabel(selectedDriveName) : '');
    const headName = shot.name || (selectedDriveName ? driveImgFullName(selectedDriveName, shots) : '');
    const showDimBanner = isMDimCode(headCode) && dimsDiffer;
    const dimSeparate = !!state.workspace.dimSeparate && showDimBanner;
    const dimNote = dimDiffSummary(t, prior);
    const savedSize = localStorage.getItem(ANSWERLY_SIZE_KEY) || '2K';
    const savedModel = localStorage.getItem(ANSWERLY_MODEL_KEY) || 'gemini-3.1-flash-image';
    const modelOptions = (state.answerlyModels && state.answerlyModels.length)
      ? state.answerlyModels.map((m) => [m.id, m.label || m.id])
      : [
          ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'],
          ['gemini-3-pro-image', 'Gemini 3 Pro Image'],
          ['gemini-nano-banana-2.1', 'Nano Banana 2.1'],
          ['openai/gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'],
          ['krea/krea-realtime', 'Krea Realtime'],
          ['xai/grok-imagine', 'Grok Imagine']
        ];

    // Target Product Type shot rail. Prior Drive match when available; else blank A (override any image).
    const mappedByShot = {};
    (codeMap.mapped || []).forEach((m) => {
      if (mappedByShot[m.shotIdx] == null) mappedByShot[m.shotIdx] = m;
    });
    const activeMap = mappedByShot[i];
    const shotHasPriorDrive = !!(activeMap && driveImgs[activeMap.imgIdx]);
    const shotNeedsPriorOverride = canGenerate && !shotHasPriorDrive;
    const priorReady = !!(priorOverride || (shotHasPriorDrive && drivePriorMeta));
    // MAIN uses Hero Front / seq 01 D as A when available; B may be own or borrowed from angle.
    const angleSrcIdx = angleSourceShotIndex(shots);
    const mainHeroDReady = isMainShot(shot) && angleSrcIdx >= 0 && shotHasGeneratedOutput(angleSrcIdx);
    const mainAngleReady = isMainShot(shot) && !!mainAngleSourceShot(shots);
    const productReady = isMainShot(shot)
      ? mainHasProductRefs(i, shots)
      : inputAssets.length > 0;
    const mainPriorOk = isMainShot(shot) &&
      (!!priorOverride || mainHeroDReady || mainAngleReady);
    const canRunShot = canGenerate && productReady && (
      isMainShot(shot)
        ? mainPriorOk
        : (priorReady && !(shotHasPriorDrive && priorLoading && !priorOverride))
    );
    // Keep Generate enabled after a result so user can regenerate when B (+ prompt C) are present.
    const canApprove = hasOutput && rating >= 4;
    const approvedCount = state.workspace.approved
      ? Object.keys(state.workspace.approved).length
      : 0;

    const rail = canGenerate
      ? orderedRailShots(shots).map(({ s, idx }) => {
          const map = mappedByShot[idx];
          const driveIdxForShot = map ? map.imgIdx : -1;
          const blank = !map;
          const done = !!(state.workspace.outputs && state.workspace.outputs[idx]);
          const busy = isShotBusy(idx);
          const approved = !!(state.workspace.approved && state.workspace.approved[idx]);
          const inputCount = (shotAssets(idx).inputs || []).length;
          const hasOverride = !!(shotAssets(idx).priorOverride);
          const isMain = isMainShot(s);
          return '<button type="button" class="wr-shot' +
            (idx === i ? ' is-active' : '') +
            (busy ? ' is-busy' : '') +
            (done ? ' is-done' : '') +
            (blank ? ' is-blank-prior' : '') +
            (approved ? ' is-approved' : '') +
            (isMain ? ' is-main' : '') +
            '" data-ws-shot="' + idx + '"' +
            // Drive index is stored for A/prior only — do not also mark as data-ws-drive-img
            // on shot buttons (that caused the Drive handler to fight shot selection).
            ' data-ws-drop-shot="' + idx + '" draggable="false">' +
            '<div class="wr-shot-thumb" draggable="false"' +
              (driveIdxForShot >= 0
                ? ' data-folder="' + esc((prior && prior.folderId) || '') + '" data-drive-img="' + driveIdxForShot + '"'
                : '') + '>' +
              (driveIdxForShot >= 0
                ? String(priorImgAt(prior, driveIdxForShot, 360) || '').replace(/<img /g, '<img draggable="false" ')
                : (hasOverride
                  ? '<img class="tp-img" draggable="false" src="' + esc(ensureAssetDisplayUrl(shotAssets(idx).priorOverride)) + '" alt="">'
                  : '<span class="wr-ph">—</span>')) +
              (busy ? '<span class="wr-shot-busy">In progress</span>' : '') +
              (approved && !busy ? '<span class="wr-shot-done">Approved</span>' :
                (done && !busy ? '<span class="wr-shot-done">Done</span>' : '')) +
              (blank && !hasOverride && !isMain ? '<span class="wr-shot-conflict">New shot</span>' : '') +
              (isMain && !busy ? '<span class="wr-shot-main-tag">MAIN</span>' : '') +
              (inputCount ? '<span class="wr-shot-inputs">' + inputCount + '/4</span>' : '') +
            '</div>' +
            '<div class="wr-shot-meta">' +
              '<span class="wr-shot-code-lbl">' + esc(s.code) + '</span>' +
              '<span class="wr-shot-full">' + esc(s.name) + '</span>' +
            '</div>' +
          '</button>';
        }).join('')
      : (driveImgs.length
        ? driveImgs.map((img, idx) => {
            const active = idx === driveImgIndex;
            const label = driveImgLabel(img.name);
            return '<button type="button" class="wr-shot' + (active ? ' is-active' : '') + '" data-ws-drive-img="' + idx + '">' +
              '<div class="wr-shot-thumb" data-folder="' + esc((prior && prior.folderId) || '') + '" data-drive-img="' + idx + '">' +
                priorImgAt(prior, idx, 360) +
              '</div>' +
              '<div class="wr-shot-meta">' +
                '<span class="wr-shot-code-lbl">' + esc(label) + '</span>' +
                '<span class="wr-shot-full">' + esc(driveImgFullName(img.name, shots)) + '</span>' +
              '</div>' +
            '</button>';
          }).join('')
        : shots.map((s, idx) =>
            '<button type="button" class="wr-shot' + (idx === i ? ' is-active' : '') + '" data-ws-shot="' + idx + '">' +
              '<div class="wr-shot-thumb"><span class="wr-ph">—</span></div>' +
              '<div class="wr-shot-meta">' +
                '<span class="wr-shot-code-lbl">' + esc(s.code) + '</span>' +
                '<span class="wr-shot-full">' + esc(s.name) + '</span>' +
              '</div>' +
            '</button>'
          ).join(''));

    const cappedInputs = inputAssets.slice(0, 4);
    const inputTiles = cappedInputs.length
      ? cappedInputs.map((asset, n) => {
          const thumbUrl = ensureAssetDisplayUrl(asset);
          // Answerly slots: A = INPUT IMAGE 1, first B = 2, second B = 3, …
          const answerlyNum = n + 2;
          return '<div class="wr-in-tile' + (asset.cropped ? ' is-cropped' : '') +
            '" data-ws-crop-input="' + n + '" title="Click to crop">' +
            '<span class="wr-in-num" title="Answerly INPUT IMAGE ' + answerlyNum + ' (product B' + (n + 1) + ')">' +
              answerlyNum +
            '</span>' +
            '<button type="button" class="wr-in-remove" data-ws-remove-input="' + n + '" title="Remove">×</button>' +
            (thumbUrl
              ? '<img class="wr-in-thumb" src="' + esc(thumbUrl) + '" alt="' + esc(asset.name) + '">'
              : '<div class="wr-in-glyph" aria-hidden="true"></div>') +
            '<div class="wr-in-name" title="' + esc(asset.name) + '">' + esc(asset.name) + '</div>' +
            '<div class="wr-in-dim">' + (asset.w && asset.h ? asset.w + '×' + asset.h : '') + '</div>' +
          '</div>';
        }).join('') +
        (cappedInputs.length < 4
          ? '<div class="wr-in-empty wr-in-empty-slot" data-ws="add-input" role="button" tabindex="0">' +
              '<span class="wr-in-empty-title">Add more</span>' +
              '<span class="wr-in-empty-hint">Drop or browse</span>' +
            '</div>'
          : '')
      : '<div class="wr-in-empty' + (mainBorrowNote ? ' is-borrow-note' : '') + '" data-ws="add-input" role="button" tabindex="0">' +
          '<span class="wr-in-empty-title">' +
            (mainBorrowNote
              ? 'Uses Hero Front / 01 product B at generate'
              : 'Drop new product image(s)') +
          '</span>' +
          '<span class="wr-in-empty-hint">' +
            (mainBorrowNote
              ? 'Optional: drop MAIN-only B here · not copied from Hero Front'
              : 'JPG / PNG · up to 4 · local files') +
          '</span>' +
        '</div>';

    return '<div class="tw-shell tw-shell-replace">' +
      '<nav class="tw-crumb" aria-label="Breadcrumb">' +
        '<button type="button" class="tw-back-pill" data-ws="choose">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>' +
          'Choose workflow</button>' +
        '<span class="tw-crumb-sep" aria-hidden="true">/</span>' +
        '<ol class="tw-crumb-list">' +
          '<li>My Tasks</li><li aria-hidden="true">›</li>' +
          '<li><button type="button" class="tw-crumb-link" data-ws="choose">Choose workflow</button></li>' +
          '<li aria-hidden="true">›</li>' +
          '<li aria-current="page">Product Replacement</li>' +
        '</ol>' +
      '</nav>' +

      '<section class="wr-product">' +
        '<div class="wr-product-main">' +
          '<div class="tw-top-thumb" aria-hidden="true">' +
            thumbHtml(t).replace('class="tp-thumb"', 'class="tp-thumb tw-top-thumb-inner"') +
          '</div>' +
          '<div class="tw-top-copy">' +
            '<div class="tw-kicker">Product Replacement</div>' +
            '<h1 class="tw-heading">' + esc(t.title || 'Untitled product') + '</h1>' +
            '<p class="tw-sub">EAN ' + eanCopyHtml(t.ean) +
              (t.subCategory ? ' · ' + esc(t.subCategory) : '') +
              (t.template ? ' · Template ' + esc(t.template) : '') + '</p>' +
            '<div class="tw-meta-row">' +
              '<span class="tp-status is-' + st.id + '">' + esc(st.label) + '</span>' +
              (t.template ? '<span class="tw-chip">Template <span class="tp-mono">' + esc(t.template) + '</span></span>' : '') +
              (t.setLabel ? '<span class="tw-chip">' + esc(t.setLabel) + '</span>' : '') +
              '<span class="tw-chip">' + (canGenerate ? shots.length + ' shots' : 'Select product type') + '</span>' +
              pdp + driveChip +
              '<button type="button" class="tw-reset-ean" data-ws="reset-ean" title="Clear all generated images (B/D), ratings, and restore default prompts for this EAN">' +
                'Reset all Gen Img &amp; Prompt</button>' +
            '</div>' +
          '</div>' +
          productTypePickerHtml() +
        '</div>' +
        '<div class="wr-prior-bar">' +
          '<div class="wr-prior-meta">' +
            (prior
              ? '<span>Prior EAN ' + eanCopyHtml(prior.ean) + '</span>' +
                '<span class="tw-dot">·</span>' +
                '<span class="tw-match-level is-best">' + (prior.best ? 'Best match · ' : '') + esc(prior.label) + '</span>' +
                (prior.artist ? '<span class="tw-dot">·</span><span>by ' + esc(prior.artist) + '</span>' : '')
              : '<span>No prior match selected</span>') +
          '</div>' +
          (function () {
            const execId = shotExecutionId(i);
            const jobHref = answerlyJobUrl(execId);
            if (!execId || !jobHref) return '';
            const shortId = String(execId).split('-')[0] || execId.slice(0, 8);
            return '<span class="wr-answerly-job-wrap">' +
              '<span class="wr-answerly-id tp-mono" title="' + esc(execId) + '">' + esc(shortId) + '</span>' +
              '<button type="button" class="tp-copy wr-answerly-copy" data-ws-copy-exec="' + esc(execId) +
                '" title="Copy Answerly id" aria-label="Copy Answerly id">' + ICON.copy + '</button>' +
              '<a class="wr-answerly-job" href="' + esc(jobHref) +
                '" target="_blank" rel="noopener" title="Open in Answerly · ' + esc(execId) + '">' +
                'Open in answerly' +
              '</a>' +
            '</span>';
          }()) +
          '<div class="wr-prior-actions">' +
            '<button type="button" class="wr-token-chip ' + tokenChipClass(state.answerlyToken) +
              '" data-ws="answerly-token" title="' +
              esc((state.answerlyToken && state.answerlyToken.error) || formatTokenExpiryDetail(state.answerlyToken)) + '">' +
              esc(formatTokenExpiry(state.answerlyToken)) +
            '</button>' +
          '</div>' +
        '</div>' +
        codeMapWarnHtml(codeMap) +
      '</section>' +

      '<div class="wr-grid' + (panelOpen && !panelMax ? '' : ' is-panel-closed') + '">' +
        '<aside class="wr-rail" data-ws-drop="rail" data-rail-zoom="' +
          (railZoomLevel() <= 0.55 ? 'dense' : (railZoomLevel() <= 0.8 ? 'compact' : 'full')) + '">' +
          '<div class="wr-rail-head">' +
            '<div class="wr-rail-title-row">' +
              '<div class="wr-rail-title">Drive images (' + (driveImgs.length || shots.length) + ')</div>' +
              '<div class="wr-rail-zoom" role="group" aria-label="Thumbnail size">' +
                '<button type="button" class="wr-rail-zoom-btn" data-ws="rail-zoom-out" title="Smaller thumbnails" aria-label="Zoom out">−</button>' +
                '<span class="wr-rail-zoom-label" data-wr-rail-zoom-label>' + Math.round(railZoomLevel() * 100) + '%</span>' +
                '<button type="button" class="wr-rail-zoom-btn" data-ws="rail-zoom-in" title="Larger thumbnails (max = default)" aria-label="Zoom in">+</button>' +
              '</div>' +
            '</div>' +
            (canGenerate
              ? '<div class="wr-rail-sub">' + codeMap.mapped.length + ' mapped' +
                  (codeMap.unmappedPrior.length ? ' · ' + codeMap.unmappedPrior.length + ' no match' : '') + '</div>'
              : '<div class="wr-rail-sub">Drop JPG/PNG onto a shot to attach inputs</div>') +
          '</div>' +
          '<nav class="wr-rail-list">' + rail + '</nav>' +
          '<div class="wr-rail-foot">' +
            (anyShotBusy()
              ? '<button type="button" class="wr-btn-outline wr-cancel-all-btn" data-ws="cancel-gen" data-cancel-all="1" title="Stop all in-flight Answerly jobs (other shots can still Generate in parallel until you cancel)">' +
                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18"/></svg>' +
                  (busyShotIndexes().length > 1 || state.workspace.genAllBatch
                    ? 'Cancel all (' + busyShotIndexes().length + ')'
                    : 'Cancel generation') +
                '</button>'
              : '<button type="button" class="wr-btn-outline" data-ws="gen-all"' +
                  (!canGenAll ? ' disabled' : '') +
                  (canGenerate
                    ? (mappedAll.length
                        ? ' title="' +
                          (mappedDoneCount
                            ? mappedDoneCount + ' already in D · choose skip or regenerate'
                            : 'Generate ' + mappedPending.length + ' shot' + (mappedPending.length > 1 ? 's' : '') + ' that have B') +
                          ' (skips shots without B; always skips M-DIM' +
                          '; MAIN waits for Hero Front / 01 D as A · parallel)"'
                        : ' title="No mapped shots to generate"')
                    : ' title="Select a Product Type first"') + '>' +
                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>' +
                  'Generate all pending</button>') +
          '</div>' +
        '</aside>' +
        '<div class="wr-rail-splitter" data-ws-rail-split title="Drag to resize Drive images panel" role="separator" aria-orientation="vertical" aria-label="Resize Drive images panel"></div>' +

        '<div class="wr-main-wrap">' +
        (isDimensionShot(shot) && !state.workspace.mdimShowAbcd && state.workspace.mdimMainMax
          ? '<div class="wr-mdim-max-backdrop" data-mdim="toggle-main-max" title="Exit large editor"></div>'
          : '') +
        '<section class="wr-main' +
          (isDimensionShot(shot) && !state.workspace.mdimShowAbcd && state.workspace.mdimMainMax ? ' is-max' : '') +
          '">' +
          '<header class="wr-main-head">' +
            '<h2 class="wr-main-title">' + esc(headName) + '</h2>' +
            '<span class="wr-code">' + esc(headCode) + '</span>' +
            (isDimensionShot(shot) && dimsDiffer ? mdimDimDiffHeadHtml(t, prior) : '') +
            (isShotBusy(i)
              ? '<span class="wr-pill-progress">' +
                  esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'In progress') +
                '</span>'
              : '') +
            (shotError && !isShotBusy(i)
              ? '<span class="wr-pill-error" title="' + esc(shotError) + '">Failed</span>'
              : '') +
          '</header>' +

          /* M-DIM uses the compact head chip — never the old wr-dim-banner (incl. Custom/ABCD). */
          (showDimBanner && !isDimensionShot(shot)
            ? '<div class="wr-dim-banner">' +
                '<label class="wr-dim-toggle">' +
                  '<input type="checkbox" data-ws-dim-toggle' + (state.workspace.dimSeparate ? ' checked' : '') + '>' +
                  '<span>Dimensions differ — create as a separate image (skip 1:1 map)</span>' +
                '</label>' +
                '<span class="wr-dim-note">' + esc(dimNote || 'Optional exception') + '</span>' +
              '</div>'
            : '') +

          (isDimensionShot(shot) && !state.workspace.mdimShowAbcd
            ? mdimWorkbenchSectionHtml(t, shot, i)
            : '' +
          (isDimensionShot(shot) && state.workspace.mdimShowAbcd
            ? '<div class="mdim-abcd-bar">' +
                '<span class="mdim-abcd-note">A·B·C·D for a custom plate. Generate a new D, then return — or drop an image on the dimension editor to override.</span>' +
                '<button type="button" class="tp-btn tp-btn-primary" data-mdim="back-editor">Back to dimension editor</button>' +
              '</div>'
            : '') +

          '<div class="wr-pair">' +
            '<div class="wr-card' + (dimSeparate ? ' is-muted' : '') + '">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">A · Prior output ' +
                  (dimSeparate
                    ? '<span class="wr-badge-muted">Skipped</span>'
                    : (priorOverride
                        ? '<span class="wr-badge-teal">Local override</span>'
                        : (shotNeedsPriorOverride
                          ? '<span class="wr-badge-muted">No prior match</span>'
                          : (priorLoading
                            ? '<span class="wr-badge-ghost">Loading Drive…</span>'
                            : (priorFetchError
                              ? '<span class="wr-badge-muted">Drive error</span>'
                              : '<span class="wr-badge-ok">From Drive</span>'))))) +
                '</div>' +
                (priorOverride
                  ? '<button type="button" class="wr-text-btn" data-ws="clear-prior">Clear override</button>'
                  : '') +
              '</div>' +
              '<div class="wr-frame wr-frame-prior' + (priorOverride ? ' has-override' : '') +
                (shotNeedsPriorOverride && !priorOverride ? ' is-blank-prior' : '') +
                (priorOverride && priorOverride.cropped ? ' is-cropped' : '') +
                ((priorOverride || shotHasPriorDrive) ? ' is-croppable' : '') +
                '" data-ws-drop="prior"' +
                ((priorOverride || shotHasPriorDrive) ? ' data-ws-crop-prior="1" title="Click to crop prior (A)"' : '') +
                ' data-folder="' +
                esc((prior && prior.folderId) || '') + '" data-drive-img="' +
                (shotHasPriorDrive && activeMap ? activeMap.imgIdx : driveImgIndex) + '">' +
                (priorOverride
                  ? '<img class="tp-img" src="' + esc(ensureAssetDisplayUrl(priorOverride)) + '" alt="' + esc(priorOverride.name) + '">'
                  : (shotHasPriorDrive
                    ? priorImgAt(prior, activeMap.imgIdx, 640)
                    : '<span class="wr-frame-empty">' +
                        (shotNeedsPriorOverride
                          ? 'No matching prior — drop any image here'
                          : 'No prior') +
                      '</span>')) +
              '</div>' +
              '<div class="wr-card-meta">' +
                '<span class="tp-mono" title="' + esc(priorOverride
                  ? priorOverride.name
                  : (shotHasPriorDrive && driveImgs[activeMap.imgIdx]
                    ? driveImgs[activeMap.imgIdx].name
                    : (shotNeedsPriorOverride ? 'Add a prior image to generate this new shot' : priorFileName(prior, shot)))) + '">' +
                  esc(priorOverride
                    ? priorOverride.name
                    : (shotHasPriorDrive && driveImgs[activeMap.imgIdx]
                      ? driveImgs[activeMap.imgIdx].name
                      : (shotNeedsPriorOverride ? '—' : priorFileName(prior, shot)))) + '</span>' +
                '<span>' + (priorOverride && priorOverride.w ? priorOverride.w + '×' + priorOverride.h : 'Square') + '</span>' +
              '</div>' +
            '</div>' +

            '<div class="wr-card">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">B · New product input ' +
                  (cappedInputs.length
                    ? '<span class="wr-badge-teal">' + cappedInputs.length + ' / 4</span>'
                    : (mainBorrowNote ? '<span class="wr-badge-ghost">From Hero Front</span>' : '')) +
                '</div>' +
                (cappedInputs.length < 4
                  ? '<button type="button" class="wr-text-btn" data-ws="add-input">+ Browse</button>'
                  : '<span class="wr-badge-ghost">Max 4</span>') +
              '</div>' +
              '<div class="wr-in-grid wr-in-count-' + Math.max(1, Math.min(4, cappedInputs.length + (cappedInputs.length && cappedInputs.length < 4 ? 1 : 0))) +
                (cappedInputs.length ? '' : ' is-empty') + '" data-ws-drop="inputs">' +
                inputTiles +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="wr-pair wr-pair-bottom">' +
            '<div class="wr-card wr-card-prompt">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">C · Prompt</div>' +
                '<div class="wr-prompt-head-actions">' +
                  '<span class="wr-badge-ghost' +
                    (promptOriginPreview === 'Custom' ? ' is-custom' : ' is-automated') +
                    '" data-ws-prompt-origin="' + esc(promptOriginPreview) + '">' +
                    esc(promptOriginPreview) +
                  '</span>' +
                  '<button type="button" class="wr-icon-btn wr-prompt-expand" data-ws="prompt-expand" title="Expand prompt" aria-label="Expand prompt">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>' +
                  '</button>' +
                '</div>' +
              '</div>' +
              '<div class="wr-prompt-wrap' +
                (isPromptManualEdit(i) && normalizePromptCompare(promptText) &&
                  normalizePromptCompare(promptText) !== normalizePromptCompare(
                    storedPromptBaseline(i) || compiled.text)
                  ? ' has-diff' : '') + '">' +
                '<div class="wr-prompt-highlight" data-ws-prompt-highlight aria-hidden="true">' +
                  (isPromptManualEdit(i)
                    ? promptDiffHighlightHtml(promptText, storedPromptBaseline(i) || compiled.text)
                    : formatPromptOverlayHtml(esc(promptText).replace(/\n/g, '<br>'))) +
                '</div>' +
                '<textarea class="wr-prompt" data-ws-prompt="' + i + '" rows="8" placeholder="Compiled from Universal + Shoot Tracker + Naming">' + esc(promptText) + '</textarea>' +
              '</div>' +
              '<div class="wr-prompt-foot">' +
                '<span class="wr-prompt-note">' +
                  promptOriginNoteHtml(t, shot, compiled, promptOriginPreview, reuseMeta) +
                '</span>' +
                '<div class="wr-prompt-actions">' +
                  '<button type="button" class="wr-text-btn" data-ws="prompt-reset" title="Restore the compiled Universal prompt">Default</button>' +
                  '<button type="button" class="wr-text-btn" data-ws="prompt-clear" title="Clear the prompt field so you can paste a new one">Clear</button>' +
                  '<button type="button" class="wr-text-btn" data-ws="prompt-copy">Copy</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div class="wr-card wr-card-out">' +
              '<div class="wr-card-head">' +
                '<div class="wr-card-label">D · Output · Answerly</div>' +
                '<span class="' + (isShotBusy(i) ? 'wr-badge-busy' : (shotError ? 'wr-badge-muted' : 'wr-badge-ok')) + '"' +
                  (isShotBusy(i)
                    ? ' title="' + esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'Working…') + '"' 
                    : '') + '>' +
                  (isShotBusy(i)
                    ? esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'Working…')
                    : (shotError ? 'Failed' : (hasOutput ? 'Done' : 'Ready'))) +
                '</span>' +
              '</div>' +
              '<div class="wr-out-controls">' +
                '<label class="wr-size-label">Size <select class="wr-size-select">' +
                  ['1K', '2K', '4K'].map((s) =>
                    '<option value="' + s + '"' + (s === savedSize ? ' selected' : '') + '>' + s + '</option>'
                  ).join('') +
                '</select></label>' +
                '<label class="wr-model-label">Model <select class="wr-model-select">' +
                  modelOptions.map((opt) =>
                    '<option value="' + esc(opt[0]) + '"' + (opt[0] === savedModel ? ' selected' : '') + '>' +
                      esc(opt[1]) + '</option>'
                  ).join('') +
                '</select></label>' +
              '</div>' +
              '<div class="wr-out-frame' +
                (isShotBusy(i) ? ' is-busy'
                  : (shotError ? ' has-error'
                    : (hasOutput ? ' has-result' : ''))) + '">' +
                (isShotBusy(i)
                  ? '<div class="wr-out-progress" aria-live="polite">' +
                      '<div class="wr-out-progress-title">' +
                        esc((state.workspace.busyShots && state.workspace.busyShots[i]) || genStage || 'Generating…') +
                      '</div>' +
                      '<div class="wr-out-progress-sub">Answerly is working on this shot</div>' +
                      '<div class="tp-mono">' + esc(synthName) + '</div>' +
                    '</div>'
                  : shotError
                    ? '<div class="wr-out-error" aria-live="assertive">' + esc(shotError) + '</div>' +
                      '<div class="tp-mono">' + esc(synthName) + '</div>' +
                      (outUrl
                        ? '<div class="wr-out-error-hint">Previous result kept — fix the issue and regenerate</div>'
                        : '')
                    : (outUrl
                      ? '<img class="wr-out-img" src="' + esc(outUrl) + '" alt="Answerly output">' +
                        '<button type="button" class="wr-out-download" data-ws="download-out" title="Download generated image" aria-label="Download generated image">' +
                          ICON.download +
                        '</button>' +
                        '<div class="wr-out-meta">' +
                          '<div class="tp-mono">' + esc(synthName) + '</div>' +
                          (outAsset.w && outAsset.h
                            ? '<div class="wr-out-dims">' + outAsset.w + ' × ' + outAsset.h + '</div>'
                            : '') +
                        '</div>'
                      : canGenerate
                        ? '<div class="wr-out-ready">' +
                            (priorFetchError
                              ? esc((priorFetch && priorFetch.error) || 'Could not load prior from Drive')
                              : (priorLoading
                                ? 'Loading prior full-res from Drive…'
                                  : (!(priorReady || mainPriorOk)
                                    ? (shotNeedsPriorOverride && !isMainShot(shot)
                                    ? 'No prior match — drop any image onto A'
                                    : (isMainShot(shot)
                                      ? 'Generate Hero Front / 01 first, or drop an image onto A'
                                      : 'Select a prior on the left rail, or drop any image onto A'))
                                  : (!productReady
                                    ? 'Drop a JPG/PNG product input onto B, then Generate'
                                    : 'Ready to generate (Image to Image)')))) +
                          '</div><div class="tp-mono">' + esc(synthName) + '</div>'
                        : '<div class="wr-out-ready">Select Product Type to start</div><div class="tp-mono">' + esc(synthName) + '</div>')) +
              '</div>' +
              (isShotBusy(i)
                ? '<button type="button" class="tp-btn tp-btn-ghost wr-gen-btn wr-cancel-btn" data-ws="cancel-gen" data-shot="' + i + '"' +
                    ' title="Stop this Answerly job">' +
                    ((state.workspace.cancelShots && state.workspace.cancelShots[i]) || state.workspace.cancelAll
                      ? 'Cancelling…'
                      : 'Cancel generation') +
                  '</button>'
                : '<button type="button" class="tp-btn tp-btn-primary wr-gen-btn" data-ws="gen-shot"' +
                    (!canRunShot || isShotBusy(i) ? ' disabled' : '') +
                    (!canGenerate
                      ? ' title="Select a Product Type first"'
                      : (isMainShot(shot) && !mainPriorOk
                        ? ' title="Generate Hero Front / 01 first (MAIN uses that D as A), or drop an image onto A"'
                        : (shotNeedsPriorOverride && !priorOverride && !mainAngleReady
                          ? ' title="This shot has no prior match — drop any image onto A first"'
                          : (priorLoading && !priorOverride && !mainAngleReady
                            ? ' title="Loading prior full-res from Drive…"'
                            : (priorFetchError && !priorOverride && !mainAngleReady
                              ? ' title="Prior Drive file failed to load — drop a local image onto A or re-select"'
                              : (!(priorReady || mainPriorOk)
                                ? ' title="Add a prior image on A first"'
                                : (!productReady
                                  ? ' title="Drop a JPG/PNG product input onto B first (or on Hero Front / 01 for MAIN)"'
                                  : (hasOutput
                                    ? ' title="Regenerate with current B inputs and prompt C"'
                                    : ' title="Image to Image: prior + product input(s)"')))))))) + '>' +
                    (hasOutput ? 'Regenerate this shot' : 'Generate this shot') + '</button>') +
            '</div>' +
          '</div>' +
            '') +
        '</section>' +
        (!panelOpen
          ? '<button type="button" class="wr-panel-tab" data-ws-panel="open" title="Open Detail &amp; Compare">Detail &amp; Compare</button>'
          : '') +
        '</div>' +

        (panelOpen
          ? '<aside class="wr-panel' + (panelMax ? ' is-max' : '') + '">' +
              '<div class="wr-panel-head">' +
                '<div class="wr-panel-title">Detail &amp; Compare</div>' +
                '<div class="wr-panel-tools">' +
                  '<button type="button" class="wr-icon-btn" data-ws-panel="max" title="Maximize">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>' +
                  '</button>' +
                  '<button type="button" class="wr-icon-btn" data-ws-panel="close" title="Close">✕</button>' +
                '</div>' +
              '</div>' +
              '<div class="wr-compare" data-ws-compare>' +
                '<div class="wr-compare-base">' +
                  (outUrl
                    ? '<img class="wr-compare-img" src="' + esc(outUrl) + '" alt="Generated output">'
                    : hasOutput
                      ? '<div class="wr-compare-ph is-out">Generated</div>'
                      : '<div class="wr-compare-ph">Generate to compare</div>') +
                '</div>' +
                '<div class="wr-compare-overlay" style="width:' + comparePos + '%">' +
                  (priorOverride && ensureAssetDisplayUrl(priorOverride)
                    ? '<div class="wr-compare-overlay-inner is-override" title="A · Local override">' +
                        '<img class="tp-img wr-compare-img" src="' + esc(ensureAssetDisplayUrl(priorOverride)) +
                          '" alt="' + esc(priorOverride.name || 'Prior override') + '">' +
                      '</div>'
                    : '<div class="wr-compare-overlay-inner" data-folder="' + esc((prior && prior.folderId) || '') +
                        '" data-drive-img="' + driveImgIndex + '">' +
                        priorImgAt(prior, driveImgIndex, 640) +
                      '</div>') +
                '</div>' +
                '<input class="wr-compare-range" type="range" min="0" max="100" value="' + comparePos + '" aria-label="Compare slider">' +
                '<div class="wr-compare-handle" style="left:' + comparePos + '%" aria-hidden="true"></div>' +
              '</div>' +
              '<div class="wr-specs">' +
                '<div class="wr-spec"><span>Resolution</span><span class="tp-mono">Square</span></div>' +
                '<div class="wr-spec"><span>Target EAN</span>' + eanCopyHtml(t.ean) + '</div>' +
                '<div class="wr-spec"><span>Prior EAN</span>' +
                  (prior ? eanCopyHtml(prior.ean) : '<span class="tp-mono">—</span>') + '</div>' +
                '<div class="wr-spec"><span>Model</span><span class="tp-mono">' +
                  esc((outAsset && outAsset.model) || savedModel) + '</span></div>' +
              '</div>' +
              '<div class="wr-panel-actions">' +
                '<div class="wr-rating">' +
                  '<span class="wr-rating-label">Quality Rating</span>' +
                  '<div class="wr-stars" role="radiogroup" aria-label="Quality rating">' +
                    [1, 2, 3, 4, 5].map((n) =>
                      '<button type="button" class="wr-star' + (rating >= n ? ' is-on' : '') + '" data-ws-rating="' + n + '"' +
                        (hasOutput ? '' : ' disabled') +
                        ' aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">★</button>'
                    ).join('') +
                  '</div>' +
                  (shotGenerationCount(i) > 0
                    ? '<span class="wr-gen-count" title="Successful Generate clicks for this shot before Approve">' +
                        'Gens: ' + shotGenerationCount(i) +
                      '</span>'
                    : '') +
                '</div>' +
                '<button type="button" class="tp-btn tp-btn-primary" data-ws="prompt-approve"' +
                  (canApprove ? '' : ' disabled title="' +
                    (!hasOutput
                      ? 'Generate an image first'
                      : (rating < 1
                        ? 'Set a Quality Rating first'
                        : 'Need 4 or 5 stars to approve for production — use Re-roll for 1–3 stars')) + '"') +
                  '>Rate &amp; Approve</button>' +
                '<button type="button" class="wr-btn-outline" data-ws="reroll-prompt"' +
                  (hasOutput ? '' : ' disabled title="Generate an image first"') + '>Re-roll with prompt tweaks</button>' +
                (rating >= 1 && rating <= 3
                  ? '<div class="wr-approve-hint">1–3 stars: re-roll only — Rate &amp; Approve stays off so low quality does not go to production.</div>'
                  : '') +
              '</div>' +
            '</aside>'
          : '') +
      '</div>' +

      (canGenerate && shots.length ? approvedExportCardHtml(t, shots) : '') +
    '</div>';
  }

  /* ---------- Assign menu ---------- */

  function openMenu(anchor, eans, suggestion) {
    const ordered = [];
    const seen = new Set();
    function addName(n) {
      const t = String(n || '').trim();
      if (!t) return;
      if (isHiddenAssignArtist(t)) return; // history stays; Assign menu hides retired artists
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      ordered.push(t);
    }
    if (suggestion && !isHiddenAssignArtist(suggestion.name)) addName(suggestion.name);
    addName(state.author);
    (state.model.artists || []).forEach(addName);
    if (!ordered.length) {
      showToast('Assign failed — no artists found on the Render Tracker yet. Enter your author name in Settings.', false, { error: true });
      return;
    }
    els.menu.innerHTML = '<div class="tp-menu-label">Assign to</div>' + ordered.map((name) => {
      const sug = suggestion && name === suggestion.name;
      return '<button type="button" class="tp-menu-item' + (sug ? ' is-suggested' : '') + '" role="menuitem" data-artist="' + esc(name) + '">' +
        '<span>' + esc(name) + '</span>' + (sug ? '<span class="tp-menu-tag">Suggested</span>' : '') + '</button>';
    }).join('');
    state.menuEans = eans;
    els.menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const mh = els.menu.offsetHeight;
    const mw = els.menu.offsetWidth;
    const top = r.bottom + 4 + mh > window.innerHeight ? Math.max(8, r.top - 4 - mh) : r.bottom + 4;
    els.menu.style.top = top + 'px';
    els.menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
  }

  function closeMenu() {
    els.menu.hidden = true;
    state.menuEans = null;
  }

  /* ---------- Toast ---------- */

  let toastTimer = null;
  function showToast(html, undoable, opts) {
    opts = opts || {};
    els.toast.classList.toggle('is-error', !!opts.error);
    els.toastText.innerHTML = html;
    els.toastUndo.hidden = !undoable || !!opts.error;
    els.toast.hidden = false;
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.error ? 9000 : 6000);
  }

  function hideToast() {
    els.toast.hidden = true;
    els.toast.classList.remove('is-error');
  }

  /* ---------- Name modal ---------- */

  function openNameModal() {
    els.nameInput.value = state.author;
    els.nameSave.disabled = !state.author;
    els.nameModal.hidden = false;
    setTimeout(() => els.nameInput.focus(), 0);
  }

  function closeNameModal() {
    els.nameModal.hidden = true;
    state.pendingAction = null;
  }

  /* ---------- Events ---------- */

  function taskByEan(ean) {
    if (!state.model) return null;
    return state.model.tasks.find((t) => t.ean === ean) ||
      state.model.products.find((p) => p.ean === ean) || null;
  }

  function groupOf(el) {
    const section = el.closest('.tp-group');
    return section ? section.dataset.key : null;
  }

  function groupSuggestion(key) {
    const g = groupTasks(visibleTasks()).find((x) => x.key === key);
    if (!g) return null;
    const subKey = g.subKey || (g.tasks[0] && g.tasks[0].subKey) || '';
    return { group: g, suggestion: suggestFor(g.template, subKey) };
  }

  els.list.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    const row = e.target.closest('.tp-row');
    const action = actionEl ? actionEl.dataset.action : null;

    if (action === 'toggle-group') {
      const key = groupOf(actionEl);
      if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
      const section = actionEl.closest('.tp-group');
      section.classList.toggle('is-collapsed');
      actionEl.setAttribute('aria-expanded', String(!section.classList.contains('is-collapsed')));
      return;
    }
    if (action === 'assign-all-menu') {
      if (!canAssignTasks()) return;
      const info = groupSuggestion(groupOf(actionEl));
      if (!info) return;
      const eans = info.group.tasks.map((t) => t.ean);
      if (!els.menu.hidden && state.menuEans && state.menuEans.length === eans.length && state.menuEans[0] === eans[0]) {
        closeMenu();
        return;
      }
      openMenu(actionEl, eans, info.suggestion);
      return;
    }
    if (!row) return;
    const ean = row.dataset.ean;
    if (action === 'copy') {
      navigator.clipboard.writeText(ean).then(() => showToast('Copied EAN <span class="tp-mono">' + esc(ean) + '</span>', false));
      return;
    }
    if (action === 'output') return;
    if (action === 'start') {
      openWorkspace('choose', ean);
      return;
    }
    if (action === 'assign-menu') {
      if (!canAssignTasks()) return;
      const info = groupSuggestion(groupOf(actionEl));
      if (!els.menu.hidden && state.menuEans && state.menuEans[0] === ean) { closeMenu(); return; }
      openMenu(actionEl, [ean], info && info.suggestion);
      return;
    }
    selectTask(ean);
  });

  els.list.addEventListener('keydown', (e) => {
    const row = e.target.closest('.tp-row');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selectTask(row.dataset.ean);
    }
  });

  function selectTask(ean) {
    if (state.selectedEan !== ean) state.photoIndex = -1;
    state.selectedEan = ean;
    state.drawerClosed = false;
    renderDrawer(taskByEan(ean));
    markSelected();
    loadImages();
  }

  els.drawerBody.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const ean = copy.dataset.copy;
      navigator.clipboard.writeText(ean).then(() => showToast('Copied EAN <span class="tp-mono">' + esc(ean) + '</span>', false));
      return;
    }
    const tplDl = e.target.closest('[data-ws-download-tpl]');
    if (tplDl) {
      e.preventDefault();
      e.stopPropagation();
      downloadTemplateRefOriginal(
        tplDl.getAttribute('data-ws-download-tpl'),
        tplDl.getAttribute('data-ws-download-name')
      );
      return;
    }
    const pick = e.target.closest('[data-photo]');
    if (!pick) return;
    state.photoIndex = Number(pick.dataset.photo);
    els.drawerBody.querySelector('.tp-photo-wrap').innerHTML = photoHtml(taskByEan(state.selectedEan));
  });

  // A thumbnail that fails (no access, or a file type Drive can't preview) tries one alternate URL, then initials.
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'IMG' || !el.classList.contains('tp-img')) return;
    const id = el.getAttribute('data-drive-id') || '';
    const w = el.getAttribute('data-thumb-w') || '160';
    if (id && el.getAttribute('data-thumb-try') !== '1') {
      el.setAttribute('data-thumb-try', '1');
      el.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + w;
      return;
    }
    el.remove();
  }, true);

  els.menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-artist]');
    if (!item || !state.menuEans) return;
    const eans = state.menuEans;
    closeMenu();
    withAuthor(() => assign(eans, item.dataset.artist));
  });

  document.addEventListener('click', (e) => {
    if (!els.menu.hidden && !e.target.closest('#assign-menu') && !e.target.closest('[data-action="assign-menu"]') && !e.target.closest('[data-action="assign-all-menu"]')) {
      closeMenu();
    }
    if (!els.settingsMenu.hidden && !e.target.closest('.settings')) closeSettings();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const genAllModal = document.getElementById('wr-gen-all-choice');
    if (genAllModal) {
      genAllModal.remove();
      return;
    }
    const a2Picker = document.getElementById('wr-primary-a2-picker');
    if (a2Picker && !a2Picker.hidden) {
      a2Picker.hidden = true;
      return;
    }
    const promptExpand = document.getElementById('wr-prompt-expand');
    if (promptExpand) {
      promptExpand.remove();
      return;
    }
    if (els.cropModal && !els.cropModal.hidden) closeCropModal();
    else if (!els.nameModal.hidden) closeNameModal();
    else if (els.answerlyModal && !els.answerlyModal.hidden) closeAnswerlyModal();
    else if (els.setupModal && !els.setupModal.hidden) closeSetupModal();
    else if (!els.menu.hidden) closeMenu();
    else if (!els.settingsMenu.hidden) closeSettings();
    else if (state.workspace && state.workspace.mdimMainMax) {
      // Exit full-view dimension editor only — stay on M-DIM / replace.
      state.workspace.mdimMainMax = false;
      persistCurrentReplaceDraft();
      renderWorkspace();
    }
    else if (state.workspace &&
        (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') &&
        state.workspace.panelMax) {
      state.workspace.panelMax = false;
      renderWorkspace();
    }
    else if (state.workspace &&
        (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') &&
        state.workspace.panelOpen !== false) {
      // Close Detail & Compare; do not leave Image Generation.
      state.workspace.panelOpen = false;
      state.workspace.panelMax = false;
      renderWorkspace();
    }
    else if (state.workspace && state.workspace.mode === 'choose') {
      closeWorkspace();
      render();
    }
    // replace / primary: Esc must not jump back to the start of the flow.
  });

  // Lock page scroll while Product Dimension is enlarged (same idea as a modal popup).
  document.addEventListener('wheel', (e) => {
    if (!document.body.classList.contains('mdim-main-max')) return;
    if (e.target && e.target.closest && e.target.closest('.wr-main.is-max')) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!document.body.classList.contains('mdim-main-max')) return;
    if (e.target && e.target.closest && e.target.closest('.wr-main.is-max')) return;
    e.preventDefault();
  }, { passive: false });

  function closeSettings() {
    els.settingsMenu.hidden = true;
    els.settingsBtn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- AI upscale setup guide (Settings › AI upscale setup) ---------- */

  els.setupModal = $('setup-modal');
  els.menuSetup = $('menu-setup');
  els.setupPill = $('setup-pill');
  els.setupPillText = $('setup-pill-text');
  els.setupStatusText = $('setup-status-text');
  els.setupStart = $('setup-start');
  let setupPoll = null;

  function upscaleOn() {
    return localStorage.getItem(UPSCALE_KEY) !== 'false';
  }

  async function localNetworkPermission() {
    if (!navigator.permissions) return 'unknown';
    let result = 'unknown';
    for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
      try {
        const { state: perm } = await navigator.permissions.query({ name });
        if (perm === 'denied') return 'denied';
        if (perm === 'prompt') result = 'prompt';
      } catch (_) { /* not supported */ }
    }
    return result;
  }

  async function checkUpscalerService() {
    if (!upscaleOn() && (!els.setupModal || els.setupModal.hidden)) return;
    let next;
    try {
      const res = await bridgeFetch('/health', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const health = await res.json();
      if (health.folder) state.upscaleFolder = health.folder;
      // Answerly-only bridge is not the Firefly upscaler — show offline so Start can upgrade it.
      if (health.answerlyOnly || health.service === 'answerly-bridge') {
        state.answerlyOnlyBridge = true;
        next = 'offline';
      } else {
        state.answerlyOnlyBridge = false;
        next = health.chrome ? 'online' : 'nochrome';
      }
    } catch (_) {
      state.answerlyOnlyBridge = false;
      next = (await localNetworkPermission()) === 'denied' ? 'blocked' : 'offline';
    }
    if (state.service === 'starting' && (next === 'offline' || next === 'nochrome')) {
      if (Date.now() < state.startingUntil) return;
      state.startFailed = true;
    }
    if (next === 'online') state.startFailed = false;
    if (next === state.service) {
      renderSetupStatus();
      return;
    }
    state.service = next;
    renderSetupStatus();
  }

  function renderSetupStatus() {
    if (!els.setupPill) return;
    const look = {
      checking: ['', 'Upscaler: checking…'],
      starting: ['amber', 'Upscaler: starting…'],
      online: ['green', 'Upscaler connected'],
      nochrome: ['amber', 'Upscaler: Firefly Chrome not open'],
      offline: ['red', 'Upscaler offline'],
      blocked: ['red', 'Upscaler blocked by Chrome']
    }[state.service] || ['', 'Upscaler: checking…'];
    const needsSetup = upscaleOn() && (state.service === 'offline' || state.service === 'blocked');
    if (els.settingsBtn) els.settingsBtn.classList.toggle('has-alert', needsSetup);
    if (els.menuSetup) els.menuSetup.classList.toggle('has-alert', needsSetup);
    if (state.upscaleFolder) {
      const pathText = $('setup-path-text');
      const pathCode = $('setup-path');
      if (pathText) {
        pathText.textContent = 'The installed files are in this folder. To open it, paste this into the File Explorer address bar and press Enter:';
      }
      if (pathCode) pathCode.textContent = state.upscaleFolder;
    }
    if (els.setupStart) {
      els.setupStart.hidden = state.service !== 'offline' && state.service !== 'nochrome';
    }
    els.setupPill.className = 'pill svc ' + look[0];
    if (els.setupPillText) els.setupPillText.textContent = look[1].replace(/^Upscaler: /, '');
    if (els.setupStatusText) {
      els.setupStatusText.textContent = {
        checking: 'Checking whether the upscaler is running on this PC…',
        starting: 'Starting the upscaler… this can take up to a minute. If Chrome asks to access devices on your local network, click Allow.',
        online: 'All set. AI upscale is ready to use on this PC.',
        nochrome: 'The upscaler is running, but the Firefly Chrome window is closed. Click Start.',
        offline: state.answerlyOnlyBridge
          ? 'Answerly bridge is running (Product Replacement OK). Click Start to switch on the Firefly upscaler for AI upscale — leave that window open until status turns green.'
          : (state.startFailed
            ? 'The upscaler did not respond. Check the “3D Playground upscaler” window, then click Start again.'
            : 'Firefly upscaler not running. New PC? Follow the steps below. Already set up? Click Start.'),
        blocked: 'Chrome is blocking the connection. See "Upscaler blocked by Chrome" under Something not working.'
      }[state.service] || '';
    }
  }

  function openSetupModal() {
    if (!els.setupModal) return;
    els.setupModal.hidden = false;
    renderSetupStatus();
    checkUpscalerService();
    clearInterval(setupPoll);
    setupPoll = setInterval(checkUpscalerService, 3000);
  }

  function closeSetupModal() {
    if (!els.setupModal) return;
    els.setupModal.hidden = true;
    clearInterval(setupPoll);
  }

  function waitForUpscaler(ms) {
    state.service = 'starting';
    state.startFailed = false;
    state.startingUntil = Date.now() + ms;
    renderSetupStatus();
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      await checkUpscalerService();
      if (state.service !== 'starting' || tries >= ms / 2000 + 1) clearInterval(poll);
    }, 2000);
  }

  if (els.menuSetup) {
    els.menuSetup.addEventListener('click', () => { closeSettings(); openSetupModal(); });
  }
  if (els.setupModal) {
    const closeBtn = $('btn-setup-close');
    const doneBtn = $('btn-setup-done');
    if (closeBtn) closeBtn.addEventListener('click', closeSetupModal);
    if (doneBtn) doneBtn.addEventListener('click', closeSetupModal);
    els.setupModal.addEventListener('click', (e) => {
      if (e.target === els.setupModal) closeSetupModal();
    });
    els.setupModal.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      try {
        await navigator.clipboard.writeText($(btn.dataset.copy).textContent);
        btn.textContent = 'Copied';
      } catch (_) {
        btn.textContent = 'Select & copy';
      }
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  }
  if (els.setupStart) {
    els.setupStart.addEventListener('click', () => waitForUpscaler(60000));
  }
  if (new URLSearchParams(location.search).has('setup')) {
    openSetupModal();
    waitForUpscaler(90000);
  }
  setInterval(checkUpscalerService, SERVICE_CHECK_MS);
  checkUpscalerService();

  window.addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('resize', () => {
    closeMenu();
    syncRailToMainHeight();
  });

  $('drawer-close').addEventListener('click', () => {
    state.drawerClosed = true;
    renderDrawer(null);
    markSelected();
  });

  els.search.addEventListener('input', () => { state.search = els.search.value; render(); });
  els.category.addEventListener('change', () => { state.category = els.category.value; render(); });
  els.template.addEventListener('change', () => { state.template = els.template.value; render(); });
  els.setKind.addEventListener('change', () => { state.setKind = els.setKind.value; render(); });
  els.artist.addEventListener('change', () => {
    state.artist = els.artist.value;
    if (state.artist === '~me' && !state.author) withAuthor(() => { fillFilters(); render(); });
    render();
  });
  els.sort.addEventListener('change', () => { state.sort = els.sort.value; render(); });
  document.querySelectorAll('.tp-seg [data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.groupBy = btn.dataset.group;
      state.collapsed.clear();
      const seg = btn.closest('.tp-seg');
      if (seg) seg.querySelectorAll('[data-group]').forEach((b) => b.classList.toggle('is-active', b === btn));
      render();
    });
  });

  document.querySelectorAll('[data-catalog]').forEach((btn) => {
    btn.addEventListener('click', () => setCatalog(btn.dataset.catalog));
  });

  els.toastUndo.addEventListener('click', hideToast);
  $('toast-close').addEventListener('click', hideToast);

  window.addEventListener('hashchange', () => {
    const route = parseHash();
    const v = route.view || 'available';
    if (v !== state.view) setView(v, { syncHash: false, keepWorkspace: true });
    if (v === 'my' && route.ws && route.ean && state.model) {
      restoreWorkspaceFromRoute(route);
    } else if (v === 'my' && state.workspace && !route.ws) {
      closeWorkspace();
      render();
    } else if (v !== 'my' && state.workspace) {
      closeWorkspace();
      render();
    }
  });
  // Nav uses <a href="#…">; hashchange drives the view. Keep a click fallback for same-hash re-clicks.
  ['renamer', 'available', 'my'].forEach((v) => {
    const tab = $('tab-' + v);
    if (!tab) return;
    tab.addEventListener('click', (e) => {
      if (hashView() === v && state.view === v) {
        e.preventDefault();
        setView(v, { syncHash: false });
      }
    });
  });

  document.querySelectorAll('[data-my-bucket]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.myBucket = btn.dataset.myBucket;
      syncMyBucketTabs();
      render();
    });
  });

  function previewPriorMatch(ean, row) {
    const existing = taskByEan(ean);
    const drive = ((row && row.querySelector('.tw-match-folder')) || {}).href || '';
    const stub = existing || {
      ean: ean,
      title: ((row && row.querySelector('.tw-match-title')) || {}).textContent || ean,
      colour: 'c-teal',
      template: '',
      shots: [],
      driveLink: '',
      outputLink: drive,
      outputFolderId: folderIdFrom(drive),
      prop: null,
      propsNeeded: false,
      issues: [],
      setLabel: '',
      pdpImages: 'Completed'
    };
    state.photoIndex = -1;
    state.selectedEan = ean;
    state.drawerClosed = false;
    renderDrawer(stub);
    loadImages();
  }

  if (els.workspace) {
    els.workspace.addEventListener('mousedown', (e) => {
      const split = e.target.closest('[data-ws-rail-split]');
      if (split && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        e.preventDefault();
        const grid = els.workspace.querySelector('.wr-grid');
        const startX = e.clientX;
        const startW = railWidthPx();
        if (grid) grid.classList.add('is-rail-resizing');
        document.body.classList.add('is-rail-resizing');
        function onMove(ev) {
          setRailWidthPx(startW + (ev.clientX - startX));
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (grid) grid.classList.remove('is-rail-resizing');
          document.body.classList.remove('is-rail-resizing');
          syncRailToMainHeight();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }
      const ptPick = e.target.closest('[data-ws-pt-pick]');
      if (!ptPick || !state.workspace ||
          (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
      e.preventDefault();
      const name = String(ptPick.dataset.wsPtPick || '');
      const type = namingProductTypes().find((t) => t.name === name);
      if (!type) return;
      state.workspace.productTypeName = type.name;
      state.workspace.productTypeQuery = type.name;
      state.workspace.productTypeVariant = type.variants ? Object.keys(type.variants)[0] : '';
      state.workspace.productTypeOpen = false;
      state.workspace.productTypeWarn = false;
      // New Product Type → new Naming shots; rebuild compiled prompts.
      state.workspace.prompts = {};
      state.workspace.promptBaselines = {};
      state.workspace.promptManualEdit = {};
      const taskPt = taskByEan(state.workspace.ean);
      state.workspaceShot = defaultWorkspaceShotIndex(shotListFor(taskPt || {}));
      writeProductTypePrefs(state.workspace.productTypeName, state.workspace.productTypeVariant);
      if (state.workspace.mode === 'primary' && state.workspace.primary) {
        // Remap A2 to the new shot list / PDP seq after type change.
        const p = state.workspace.primary;
        if (p.a2) {
          Object.keys(p.a2).forEach((k) => {
            if (p.a2Manual && p.a2Manual[k]) return;
            revokeAssetUrl(p.a2[k]);
            delete p.a2[k];
          });
        }
        p.a2Loading = {};
      }
      renderWorkspace();
      syncRoute({ replace: true });
    });

    els.workspace.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-ws-manual-ean-form]');
      if (!form || !state.workspace || state.workspace.mode !== 'choose') return;
      e.preventDefault();
      const input = form.querySelector('.tw-manual-ean-input');
      const raw = String((input && input.value) || '').replace(/\D/g, '');
      if (!/^\d{8,}$/.test(raw)) {
        showToast('Enter a valid EAN (digits only).', false, { error: true });
        return;
      }
      const task = taskByEan(state.workspace.ean);
      if (task && String(task.ean) === raw) {
        showToast('Pick a different EAN than the current task.', false, { error: true });
        return;
      }
      const manual = manualPriorMatchFromEan(raw);
      if (!manual) {
        showToast('No Completed product with an output folder found for EAN ' + raw + '.', false, { error: true });
        return;
      }
      state.workspace.matchEan = String(manual.ean);
      state.workspace.focus = 'replace';
      if (!state.replaceDraftCache) state.replaceDraftCache = {};
      if (!state.replaceDraftCache[state.workspace.ean]) {
        state.replaceDraftCache[state.workspace.ean] = {
          matchEan: String(manual.ean),
          assets: {},
          prompts: {},
          outputs: {}
        };
      } else {
        state.replaceDraftCache[state.workspace.ean].matchEan = String(manual.ean);
      }
      previewPriorMatch(manual.ean, null);
      renderWorkspace();
      syncRoute({ replace: true });
      showToast('Using prior EAN <span class="tp-mono">' + esc(String(manual.ean)) + '</span> for Product Replacement.', false);
    });

    els.workspace.addEventListener('click', (e) => {
      const mdimBack = e.target.closest('[data-mdim="back-editor"]');
      if (mdimBack && state.workspace) {
        e.preventDefault();
        state.workspace.mdimShowAbcd = false;
        // Prefer a fresh drop override; else use this shot’s latest D when returning from Custom/ABCD.
        if (state.workspace.mdimOverride) {
          state.workspace.mdimBaseKey = '__override__';
          mdimEnsureWorkspaceFromAsset(
            state.workspace.mdimOverride,
            state.workspace.mdimOverride.name,
            '__override__'
          ).then(function () {
            persistCurrentReplaceDraft();
            renderWorkspace();
          }).catch(function () {
            persistCurrentReplaceDraft();
            renderWorkspace();
          });
          return;
        }
        const dimOut = shotAssets(state.workspaceShot).output;
        if (dimOut) {
          mdimRevokeCacheKey('__custom__');
          state.workspace.mdimBaseKey = '__custom__';
          mdimEnsureWorkspaceFromAsset(dimOut, dimOut.name, '__custom__').then(function () {
            persistCurrentReplaceDraft();
            renderWorkspace();
          }).catch(function () {
            persistCurrentReplaceDraft();
            renderWorkspace();
          });
        } else {
          persistCurrentReplaceDraft();
          renderWorkspace();
        }
        return;
      }
      const copyExec = e.target.closest('[data-ws-copy-exec]');
      if (copyExec) {
        e.preventDefault();
        e.stopPropagation();
        const id = copyExec.getAttribute('data-ws-copy-exec') || '';
        if (!id) return;
        navigator.clipboard.writeText(id).then(() =>
          showToast('Copied Answerly id <span class="tp-mono">' + esc(id) + '</span>', false)
        );
        return;
      }
      const copyMatch = e.target.closest('[data-action="copy-match"]');
      if (copyMatch) {
        e.preventDefault();
        e.stopPropagation();
        const ean = copyMatch.dataset.ean;
        navigator.clipboard.writeText(ean).then(() => showToast('Copied EAN <span class="tp-mono">' + esc(ean) + '</span>', false));
        return;
      }
      if (e.target.closest('[data-action="output"]')) {
        e.stopPropagation();
        return;
      }
      const ratingBtn = e.target.closest('[data-ws-rating]');
      if (ratingBtn && state.workspace) {
        const shotIdx = state.workspaceShot || 0;
        if (!(state.workspace.outputs && state.workspace.outputs[shotIdx])) {
          showToast('Generate an image before rating.', false);
          return;
        }
        const stars = Number(ratingBtn.dataset.wsRating) || 0;
        setShotRating(shotIdx, stars);
        if (!state.workspace.rejected) state.workspace.rejected = {};
        if (stars >= 1 && stars <= 3) {
          state.workspace.rejected[shotIdx] = { rating: stars, at: Date.now() };
          if (state.workspace.approved) delete state.workspace.approved[shotIdx];
        } else if (stars >= 4) {
          delete state.workspace.rejected[shotIdx];
        }
        persistCurrentReplaceDraft();
        renderWorkspace();
        return;
      }
      const restoreExport = e.target.closest('[data-ws-restore-export]');
      if (restoreExport && state.workspace) {
        e.preventDefault();
        e.stopPropagation();
        restoreExportImageFromGenerated(Number(restoreExport.getAttribute('data-ws-restore-export')));
        return;
      }
      const clearExport = e.target.closest('[data-ws-clear-export]');
      if (clearExport && state.workspace) {
        e.preventDefault();
        e.stopPropagation();
        const idx = clearExport.getAttribute('data-ws-clear-export');
        const key = String(idx);
        if (!state.workspace.exportCleared) state.workspace.exportCleared = {};
        state.workspace.exportCleared[key] = true;
        if (state.workspace.exportImages) {
          delete state.workspace.exportImages[key];
          delete state.workspace.exportImages[Number(idx)];
        }
        renderWorkspace();
        return;
      }
      const panelBtn = e.target.closest('[data-ws-panel]');
      if (panelBtn && state.workspace) {
        const act = panelBtn.dataset.wsPanel;
        if (act === 'max') {
          state.workspace.panelMax = !state.workspace.panelMax;
          state.workspace.panelOpen = true;
        } else if (act === 'close') {
          if (state.workspace.panelMax) state.workspace.panelMax = false;
          else {
            state.workspace.panelOpen = false;
            state.workspace.panelMax = false;
          }
        } else {
          state.workspace.panelOpen = true;
          state.workspace.panelMax = false;
        }
        if (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') {
          persistCurrentReplaceDraft();
        }
        renderWorkspace();
        return;
      }
      const focusBtn = e.target.closest('[data-ws-focus]');
      if (focusBtn && state.workspace) {
        state.workspace.focus = focusBtn.dataset.wsFocus === 'primary' ? 'primary' : 'replace';
        renderWorkspace();
        syncRoute({ replace: true });
        return;
      }
      const matchRow = e.target.closest('[data-ws-match]');
      if (matchRow && state.workspace && state.workspace.mode === 'choose') {
        const ean = String(matchRow.dataset.wsMatch || '');
        state.workspace.matchEan = ean;
        if (!state.replaceDraftCache) state.replaceDraftCache = {};
        if (!state.replaceDraftCache[state.workspace.ean]) {
          state.replaceDraftCache[state.workspace.ean] = {
            matchEan: ean, assets: {}, prompts: {}, outputs: {}
          };
        } else {
          state.replaceDraftCache[state.workspace.ean].matchEan = ean;
        }
        previewPriorMatch(ean, matchRow);
        renderWorkspace();
        syncRoute({ replace: true });
        return;
      }
      if (matchRow) {
        previewPriorMatch(matchRow.dataset.wsMatch, matchRow);
        return;
      }
      const removeIn = e.target.closest('[data-ws-remove-input]');
      if (removeIn && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        e.preventDefault();
        e.stopPropagation();
        persistReplacePromptFromDom();
        const idx = state.workspaceShot || 0;
        const n = Number(removeIn.dataset.wsRemoveInput);
        removeShotInput(idx, n);
        renderWorkspace();
        return;
      }
      const cropTile = e.target.closest('[data-ws-crop-input]');
      if (cropTile && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') &&
          !e.target.closest('[data-ws-remove-input]')) {
        e.preventDefault();
        e.stopPropagation();
        openCropModal({
          kind: 'input',
          shotIndex: state.workspaceShot || 0,
          inputIndex: Number(cropTile.dataset.wsCropInput) || 0
        });
        return;
      }
      const cropPrior = e.target.closest('[data-ws-crop-prior]');
      if (cropPrior && state.workspace && state.workspace.mode === 'replace' &&
          !e.target.closest('[data-ws="clear-prior"]')) {
        e.preventDefault();
        e.stopPropagation();
        openCropModal({ kind: 'prior', shotIndex: state.workspaceShot || 0 });
        return;
      }
      const cropExport = e.target.closest('[data-ws-crop-export]');
      if (cropExport && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') &&
          !e.target.closest('[data-ws-clear-export]') &&
          e.target.closest('.wr-approved-thumb')) {
        e.preventDefault();
        e.stopPropagation();
        openCropModal({
          kind: 'export',
          shotIndex: Number(cropExport.dataset.wsCropExport) || 0
        });
        return;
      }
      // Backdrop / chrome for enlarged Product Dimension (outside mdim-root).
      const mdimMaxToggle = e.target.closest('[data-mdim="toggle-main-max"]');
      if (mdimMaxToggle && state.workspace && !e.target.closest('[data-mdim-root]')) {
        e.preventDefault();
        state.workspace.mdimMainMax = !state.workspace.mdimMainMax;
        if (state.workspace.mdimMainMax) {
          state.workspace.panelOpen = false;
          state.workspace.panelMax = false;
        }
        persistCurrentReplaceDraft();
        renderWorkspace();
        return;
      }
      // Prefer explicit shot clicks over Drive-index remapping so only one rail item stays active.
      const shotBtn = e.target.closest('[data-ws-shot]');
      if (shotBtn && state.workspace) {
        captureRailScroll();
        if (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') {
          const promptEl = els.workspace.querySelector('[data-ws-prompt]');
          if (promptEl) {
            if (!state.workspace.prompts) state.workspace.prompts = {};
            state.workspace.prompts[state.workspaceShot || 0] = promptEl.value;
          }
        }
        const taskNow = taskByEan(state.workspace.ean);
        const shotsNow = shotListFor(taskNow || {});
        // Use getAttribute — avoid dataset edge cases; allow index 0 without || fallback to MAIN.
        const rawShot = shotBtn.getAttribute('data-ws-shot');
        const clickIdx = rawShot != null && rawShot !== '' ? Number(rawShot) : NaN;
        if (isNaN(clickIdx)) return;
        // Always switch to the clicked shot. M-DIM editor only shows when M-DIM is selected;
        // base overrides are via drop / base select, not rail clicks.
        state.workspaceShot = clickIdx;
        if (state.workspace.mode === 'replace') {
          // Sync Drive prior index to this shot's mapped prior when available.
          const priorNow = resolveWorkspaceMatch(taskNow).selected;
          const mapNow = priorTargetCodeMap(priorNow, shotsNow);
          const mapped = (mapNow.mapped || []).find((m) => m.shotIdx === state.workspaceShot);
          if (mapped && mapped.imgIdx != null) {
            state.workspace.driveImgIndex = mapped.imgIdx;
            state.workspace.priorFetch = null;
          }
          persistCurrentReplaceDraft();
        } else if (state.workspace.mode === 'primary') {
          maybeRefreshAutomatedPrimaryPrompt(clickIdx);
          // Non-lifestyle shots may need template A1; lifestyle never loads it.
          if (!isLifestyleShot(shotsNow[clickIdx])) schedulePrimaryA1Load(taskNow);
        }
        renderWorkspace();
        syncRoute({ replace: true });
        return;
      }
      const driveImgBtn = e.target.closest('[data-ws-drive-img]');
      if (driveImgBtn && state.workspace && state.workspace.mode === 'replace') {
        captureRailScroll();
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        if (promptEl) {
          if (!state.workspace.prompts) state.workspace.prompts = {};
          state.workspace.prompts[state.workspaceShot || 0] = promptEl.value;
        }
        const imgIdx = Number(driveImgBtn.dataset.wsDriveImg) || 0;
        state.workspace.driveImgIndex = imgIdx;
        const task = taskByEan(state.workspace.ean);
        const shotsNow = shotListFor(task || {});
        const curShot = shotsNow[state.workspaceShot || 0];
        // MAIN: pick Drive image as A, stay on MAIN. Otherwise switch to the mapped shot.
        if (!isMainShot(curShot)) {
          const prior = resolveWorkspaceMatch(task).selected;
          const imgs = priorDriveImages(prior);
          const shotIdx = shotIndexForDriveName(shotsNow, (imgs[imgIdx] && imgs[imgIdx].name) || '');
          if (shotIdx >= 0) state.workspaceShot = shotIdx;
        }
        state.workspace.priorFetch = null;
        persistCurrentReplaceDraft();
        renderWorkspace();
        syncRoute({ replace: true });
        return;
      }
      // Browse / empty-slot for B — handle before generic [data-ws] so the file dialog
      // stays inside the user-gesture window (and is not lost to a later re-render).
      const addInputEl = e.target.closest('[data-ws="add-input"]');
      if (addInputEl && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        e.preventDefault();
        e.stopPropagation();
        if (addInputEl.hasAttribute('disabled') || addInputEl.disabled) return;
        const idx = state.workspaceShot || 0;
        if (shotAssets(idx).inputs.length >= 4) {
          showToast('Maximum 4 input images per shot.', false);
          return;
        }
        openReplaceFilePicker({ kind: 'inputs', shotIndex: idx });
        return;
      }

      const actionEl = e.target.closest('[data-ws]');
      if (!actionEl || actionEl.hasAttribute('disabled') || actionEl.disabled) return;
      const action = actionEl.dataset.ws;
      if (action === 'rail-zoom-out' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        setRailZoomLevel(railZoomLevel() - RAIL_ZOOM_STEP);
        return;
      }
      if (action === 'rail-zoom-in' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        setRailZoomLevel(railZoomLevel() + RAIL_ZOOM_STEP);
        return;
      }
      if (action === 'close') { closeWorkspace(); render(); return; }
      if (action === 'choose' && state.workspace) {
        if (state.workspace.mode === 'replace') {
          persistCurrentReplaceDraft();
          stashReplaceDraftInMemory();
          state.workspace.focus = 'replace';
        } else if (state.workspace.mode === 'primary') {
          state.workspace.focus = 'primary';
        }
        state.workspace.mode = 'choose';
        renderWorkspace();
        syncRoute({ replace: true });
        window.scrollTo(0, 0);
        return;
      }
      if (action === 'start-primary' && state.workspace) {
        const taskPrimary = taskByEan(state.workspace.ean);
        if (state.workspace.mode === 'replace') {
          persistCurrentReplaceDraft();
          stashReplaceDraftInMemory();
        }
        state.workspace.mode = 'primary';
        state.workspace.focus = 'primary';
        state.workspace.draftsLoaded = false;
        ensurePrimaryState(taskPrimary);
        state.workspaceShot = defaultWorkspaceShotIndex(shotListFor(taskPrimary || {}));
        state.railScrollTop = 0;
        if (state.workspace.panelOpen == null) state.workspace.panelOpen = false;
        if (state.workspace.panelMax == null) state.workspace.panelMax = false;
        renderDrawer(null);
        renderWorkspace();
        syncRoute({ replace: true });
        restorePrimaryDraftsIntoWorkspace().then(() => {
          return hydrateMdimDraftForEan(false);
        }).then(() => {
          if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
        });
        ensureUniversalPrompts(true).then(() => {
          if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
        });
        loadAnswerlyModels().then(() => {
          if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
        });
        refreshAnswerlyTokenState().then(() => {
          if (state.workspace && state.workspace.mode === 'primary') renderWorkspace();
        });
        window.scrollTo(0, 0);
        return;
      }
      if (action === 'browse-primary-a1' && state.workspace && state.workspace.mode === 'primary') {
        openReplaceFilePicker({ kind: 'primary-a1', shotIndex: state.workspaceShot || 0 });
        return;
      }
      if (action === 'browse-primary-a2' && state.workspace && state.workspace.mode === 'primary') {
        openReplaceFilePicker({ kind: 'primary-a2', shotIndex: state.workspaceShot || 0 });
        return;
      }
      if (action === 'browse-primary-a3' && state.workspace && state.workspace.mode === 'primary') {
        openReplaceFilePicker({ kind: 'primary-a3', shotIndex: state.workspaceShot || 0 });
        return;
      }
      if (action === 'change-primary-a2' && state.workspace && state.workspace.mode === 'primary') {
        openPrimaryA2Picker(state.workspaceShot || 0);
        return;
      }
      if (action === 'clear-primary-a1' && state.workspace && state.workspace.mode === 'primary') {
        clearPrimarySlot('a1', state.workspaceShot || 0);
        return;
      }
      if (action === 'restore-primary-a1' && state.workspace && state.workspace.mode === 'primary') {
        const lifeShot = shotListFor(taskByEan(state.workspace.ean) || {})[state.workspaceShot || 0];
        if (isLifestyleShot(lifeShot)) {
          showToast('Lifestyle A1 stays optional — browse to add an image if needed.', false);
          return;
        }
        restorePrimaryA1();
        return;
      }
      if (action === 'clear-primary-a2' && state.workspace && state.workspace.mode === 'primary') {
        clearPrimarySlot('a2', state.workspaceShot || 0);
        return;
      }
      if (action === 'clear-primary-a3' && state.workspace && state.workspace.mode === 'primary') {
        clearPrimarySlot('a3', state.workspaceShot || 0);
        return;
      }
      if (action === 'add-primary-a3' && state.workspace && state.workspace.mode === 'primary') {
        setPrimaryShowA3(state.workspaceShot || 0, true);
        renderWorkspace();
        return;
      }
      if (action === 'hide-primary-a3' && state.workspace && state.workspace.mode === 'primary') {
        setPrimaryShowA3(state.workspaceShot || 0, false);
        renderWorkspace();
        return;
      }
      if (action === 'pdp-allow-access' && state.workspace && state.workspace.mode === 'primary') {
        showPdpAuthDialog('PDP camera refs need your permission. Click Allow access.');
        return;
      }
      if (action === 'gen-primary-shot' && state.workspace && state.workspace.mode === 'primary') {
        if (!hasWorkspaceProductType()) {
          state.workspace.productTypeWarn = true;
          state.workspace.productTypeOpen = true;
          showToast('Select a Product Type before generating.', false);
          renderWorkspace();
          return;
        }
        persistReplacePromptFromDom();
        const idx = state.workspaceShot || 0;
        if (isShotBusy(idx)) {
          showToast('This shot is already generating — switch to another shot to run more in parallel.', false);
          return;
        }
        const plan = primaryInputPlan(idx);
        if (plan.isLifestyle && !plan.hasA2) {
          showToast('A2 PDP Lifestyle reference is required.', false, { error: true });
          return;
        }
        if (!plan.isLifestyle && !plan.hasA1 && !plan.hasA2) {
          showToast('A1 template or A2 PDP camera reference is required.', false, { error: true });
          return;
        }
        if (!(shotAssets(idx).inputs && shotAssets(idx).inputs.length)) {
          showToast('Drop at least one new product image onto B.', false, { error: true });
          return;
        }
        const ready = pickAnswerlyPrimaryPayload(idx);
        if (!ready.ok) {
          showToast(ready.error || 'Primary inputs not ready.', false, { error: true });
          return;
        }
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        const promptText = (state.workspace.prompts && state.workspace.prompts[idx] != null)
          ? state.workspace.prompts[idx]
          : ((promptEl && promptEl.value) || '');
        if (!String(promptText || '').trim()) {
          showToast('Prompt is empty — click Default or paste a prompt in C.', false, { error: true });
          return;
        }
        const assets = shotAssets(idx);
        assets.error = null;
        if (state.workspace.cancelShots) delete state.workspace.cancelShots[idx];
        delete state.workspace.cancelAll;
        const previousOutput = assets.output;
        const hadPreviousOutput = !!(state.workspace.outputs && state.workspace.outputs[idx]);
        assets._previousOutput = previousOutput || assets._previousOutput || null;
        assets.output = null;
        if (state.workspace.outputs) delete state.workspace.outputs[idx];
        // Mark busy immediately so other shots stay free to Generate in parallel.
        markShotBusy(idx, 'Starting Primary…');
        renderWorkspace();
        runAnswerlyPrimaryForShot(idx, promptText).then((result) => {
          if (!state.workspace || state.workspace.mode !== 'primary') return;
          const prev = shotAssets(idx)._previousOutput;
          if (prev && prev !== result.output) revokeAssetUrl(prev);
          delete shotAssets(idx)._previousOutput;
          clearShotBusy(idx);
          persistCurrentPrimaryDraft();
          showToast('Primary Answerly done · ' + esc((result.source && result.source.reason) || 'ok'), false);
          renderWorkspace();
        }).catch((err) => {
          if (!state.workspace || state.workspace.mode !== 'primary') return;
          const prev = shotAssets(idx)._previousOutput || previousOutput;
          if (prev) {
            shotAssets(idx).output = prev;
            if (!state.workspace.outputs) state.workspace.outputs = {};
            if (hadPreviousOutput || prev) state.workspace.outputs[idx] = true;
          }
          delete shotAssets(idx)._previousOutput;
          const cancelled = isCancelError(err);
          shotAssets(idx).error = cancelled ? null : ((err && err.message) || 'Generation failed');
          clearShotBusy(idx);
          if (state.workspace.cancelShots) delete state.workspace.cancelShots[idx];
          persistCurrentPrimaryDraft();
          showToast(
            cancelled ? 'Primary generation cancelled.' : esc(shotAssets(idx).error || 'Primary generation failed'),
            false,
            cancelled ? undefined : { error: true }
          );
          renderWorkspace();
          if (err && (err.code === 'no_token' || err.code === 'token_expired' ||
              err.code === 'bridge_offline' || isStaleBridgeError(err.message || err))) {
            openAnswerlyModal();
          }
        });
        return;
      }
      if (action === 'start-replace' && state.workspace) {
        const task = taskByEan(state.workspace.ean);
        const resolved = resolveWorkspaceMatch(task);
        // Allow Product Replacement with or without a Completed prior match.
        // No match → blank A rail; user drops priors or uses Choose → Or enter EAN later.
        const lockedMatch = resolved.selected ? String(resolved.selected.ean) : '';
        const cachedMatch = state.replaceDraftCache && state.replaceDraftCache[state.workspace.ean]
          ? String(state.replaceDraftCache[state.workspace.ean].matchEan || '')
          : '';
        if (state.workspace.mode === 'primary') {
          persistCurrentPrimaryDraft();
          stashPrimaryDraftInMemory();
        }
        state.workspace.mode = 'replace';
        state.workspace.focus = 'replace';
        // Prefer first non-MAIN shot (drafts may override after restore).
        state.workspaceShot = defaultWorkspaceShotIndex(shotListFor(task || {}));
        state.railScrollTop = 0;
        state.workspace.matchEan = lockedMatch;
        state.workspace.draftsLoaded = false;
        if (lockedMatch && cachedMatch &&
            cachedMatch.replace(/\D/g, '') !== lockedMatch.replace(/\D/g, '')) {
          // New prior EAN — reset Drive rail / prior fetch so A/B map to the manual prior.
          state.workspace.driveImgIndex = null;
          state.workspace.priorFetch = null;
        }
        if (!lockedMatch) {
          state.workspace.driveImgIndex = null;
          state.workspace.priorFetch = null;
        }
        renderDrawer(null);
        renderWorkspace();
        syncRoute({ replace: true });
        restoreReplaceDraftsIntoWorkspace({ keepMatchEan: lockedMatch }).then(() => {
          if (!state.workspace || state.workspace.mode !== 'replace') return;
          state.workspace.matchEan = lockedMatch;
          if (!state.replaceDraftCache) state.replaceDraftCache = {};
          if (!state.replaceDraftCache[state.workspace.ean]) {
            state.replaceDraftCache[state.workspace.ean] = {
              matchEan: lockedMatch,
              assets: {},
              prompts: {},
              outputs: {}
            };
          } else {
            state.replaceDraftCache[state.workspace.ean].matchEan = lockedMatch;
          }
          persistCurrentReplaceDraft();
          if (lockedMatch) prefetchSelectedDrivePrior();
          renderWorkspace();
        });
        ensureUniversalPrompts(true).then(() => {
          if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
        });
        ensureApprovedCustomPrompts(true).then(() => {
          if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
        });
        loadAnswerlyModels().then(() => {
          if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
        });
        refreshAnswerlyTokenState().then(() => {
          if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
        });
        window.scrollTo(0, 0);
        if (!lockedMatch) {
          showToast('Product Replacement opened without a prior match — drop images onto A, or go back and enter a Completed EAN.', false);
        }
        return;
      }
      if (action === 'reset-ean' && state.workspace) {
        if (state.workspace.mode === 'replace') resetEanReplaceDraft();
        else if (state.workspace.mode === 'primary') resetEanPrimaryDraft();
        return;
      }
      if (action === 'export-upscale-toggle' && state.workspace) {
        // Handled via change listener; keep click from bubbling as noop.
        return;
      }
      if (action === 'export-clear-all' && state.workspace) {
        e.preventDefault();
        e.stopPropagation();
        const task = taskByEan(state.workspace.ean);
        const shots = shotListFor(task || {});
        if (!state.workspace.exportCleared) state.workspace.exportCleared = {};
        orderedRailShots(shots).forEach(({ idx }) => {
          state.workspace.exportCleared[String(idx)] = true;
        });
        state.workspace.exportImages = {};
        renderWorkspace();
        showToast('Cleared export images for this EAN.', false);
        return;
      }
      if (action === 'export-generate' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        generateApprovedExportZip();
        return;
      }
      if (action === 'gen-all-primary' && state.workspace && state.workspace.mode === 'primary') {
        if (!hasWorkspaceProductType()) {
          state.workspace.productTypeWarn = true;
          state.workspace.productTypeOpen = true;
          showToast('Select a Product Type before generating.', false);
          renderWorkspace();
          return;
        }
        if (anyShotBusy()) {
          showToast('A generation is already running — Cancel it first.', false);
          return;
        }
        const taskP = taskByEan(state.workspace.ean);
        if (!taskP) {
          showToast('Task not found for this EAN.', false, { error: true });
          return;
        }
        const shotsP = shotListFor(taskP);
        const pendingSkip = primaryGenAllPendingCandidates(taskP, shotsP, { includeDone: false });
        const pendingAll = primaryGenAllPendingCandidates(taskP, shotsP, { includeDone: true });
        const doneCount = countGeneratedPrimaryShots(shotsP);
        if (!pendingAll.length) {
          showToast(
            'No shots ready — add product image(s) on B (and A1 or A2). Jobs will not run without B. M-DIM is skipped.',
            false
          );
          return;
        }
        function beginPrimaryGenAll(mode) {
          const includeDone = mode === 'regen';
          const pending = includeDone ? pendingAll : pendingSkip;
          if (!pending.length) {
            showToast(includeDone
              ? 'No shots with B to regenerate. Add product image(s) on B first.'
              : 'Nothing left — shots with B already have D. Choose Regenerate all to overwrite, or add B on more shots.', false);
            return;
          }
          ensureAnswerlyReadyForGenerate().then((ok) => {
            if (!ok || !state.workspace || state.workspace.mode !== 'primary') return;
            startGenerateAllPrimaryBatch(taskP, shotsP, pending, includeDone);
          });
        }
        if (doneCount > 0) {
          openGenAllChoiceModal(doneCount, pendingSkip.length, function () {
            beginPrimaryGenAll('skip');
          }, function () {
            beginPrimaryGenAll('regen');
          });
          return;
        }
        beginPrimaryGenAll('skip');
        return;
      }
      if (action === 'prompt-reset' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        const idx = state.workspaceShot || 0;
        const task = taskByEan(state.workspace.ean) || { ean: state.workspace.ean };
        const shots = shotListFor(task);
        const shot = shots[idx] || shots[0];
        const compiled = state.workspace.mode === 'primary'
          ? compilePrimaryPrompt(task, shot, { shotIndex: idx })
          : compileReplacePrompt(task, shot, resolveWorkspaceMatch(task).selected, { shotIndex: idx });
        if (!state.workspace.prompts) state.workspace.prompts = {};
        state.workspace.prompts[idx] = compiled.text;
        rememberPromptBaseline(idx, compiled.text);
        setPromptManualEdit(idx, false);
        // Clear reuse stamp so badge/note follow the live compiled default.
        if (state.workspace.promptReuse) delete state.workspace.promptReuse[idx];
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        if (promptEl) promptEl.value = compiled.text;
        if (state.workspace.mode === 'primary') persistCurrentPrimaryDraft();
        else persistCurrentReplaceDraft();
        renderWorkspace();
        refreshPromptOriginUi();
        showToast('Prompt restored to Default · Universal ' + compiled.universalLabel + '.', false);
        return;
      }
      if (action === 'prompt-clear' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        const idx = state.workspaceShot || 0;
        if (!state.workspace.prompts) state.workspace.prompts = {};
        state.workspace.prompts[idx] = '';
        setPromptManualEdit(idx, true);
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        if (promptEl) {
          promptEl.value = '';
          promptEl.focus();
        }
        if (state.workspace.mode === 'primary') persistCurrentPrimaryDraft();
        else persistCurrentReplaceDraft();
        renderWorkspace();
        showToast('Prompt cleared — paste a new one.', false);
        return;
      }
      if (action === 'prompt-approve' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        const isPrimaryApprove = state.workspace.mode === 'primary';
        persistReplacePromptFromDom();
        const idx = state.workspaceShot || 0;
        const task = taskByEan(state.workspace.ean);
        if (!task) {
          showToast('Task not found for this EAN.', false, { error: true });
          return;
        }
        const assets = shotAssets(idx);
        if (!(assets.output && (assets.output.url || assets.output.blob || assets.output.file))) {
          showToast('Generate an image before Rate & Approve.', false, { error: true });
          return;
        }
        const rating = shotRating(idx);
        if (rating < 4) {
          showToast(rating < 1
            ? 'Set a Quality Rating before approving.'
            : 'Need 4 or 5 stars to Rate & Approve. Use Re-roll for 1–3 star results.', false, { error: true });
          return;
        }
        const author = String(state.author || '').trim();
        if (!author) {
          showToast('Set your author name in the header before approving.', false, { error: true });
          return;
        }
        const shots = shotListFor(task);
        const shot = shots[idx] || shots[0] || { name: '', code: '' };
        const prior = isPrimaryApprove ? null : resolveWorkspaceMatch(task).selected;
        // Always prefer the live textarea — state can lag behind typing.
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        const promptText = promptEl
          ? String(promptEl.value || '')
          : ((state.workspace.prompts && state.workspace.prompts[idx] != null)
            ? state.workspace.prompts[idx]
            : (isPrimaryApprove
              ? compilePrimaryPrompt(task, shot, { shotIndex: idx }).text
              : defaultReplacePrompt(task, shot, prior)));
        if (!state.workspace.prompts) state.workspace.prompts = {};
        state.workspace.prompts[idx] = promptText;
        if (!String(promptText || '').trim()) {
          showToast('Prompt is empty.', false, { error: true });
          return;
        }
        const compiled = isPrimaryApprove
          ? compilePrimaryPrompt(task, shot, { shotIndex: idx })
          : compileReplacePrompt(task, shot, prior);
        let origin = promptOriginForShot(task, shot, prior, promptText, idx);
        if (origin === 'Automated') {
          rememberPromptBaseline(idx, compiled.text);
        } else {
          // Keep baseline as the compiled default so future compares stay correct.
          if (!(state.workspace.promptBaselines && state.workspace.promptBaselines[idx] != null)) {
            rememberPromptBaseline(idx, compiled.text);
          }
          // Re-confirm after baseline lock — must stay Custom when text differs.
          origin = promptOriginForShot(task, shot, prior, promptText, idx);
          if (origin !== 'Custom') {
            showToast('Could not mark prompt as Custom — text still matches the compiled default.', false, { error: true });
            return;
          }
        }
        const primary = state.workspace.primary || {};
        const a1 = primary.a1 || null;
        const a2 = primarySlotAsset('a2', idx);
        const a3 = primarySlotAsset('a3', idx);
        const priorMeta = isPrimaryApprove ? null : selectedDrivePriorMeta();
        const priorImageName = isPrimaryApprove
          ? [
              a1 && (a1.name || 'A1 template'),
              a2 && (a2.name || 'A2 camera'),
              a3 && (a3.name || 'A3 optional')
            ].filter(Boolean).join(' · ')
          : ((assets.priorOverride && assets.priorOverride.name) ||
            (priorMeta && priorMeta.img && priorMeta.img.name) ||
            (isMainShot(shot) ? 'Hero Front / seq 01 (angle source)' : ''));
        const productImageNames = (assets.inputs || []).map((a) => a.name || 'product.png').filter(Boolean);
        showToast('Saving approval to Prompt DB…', false);
        writePromptApprove({
          ean: task.ean,
          author: author,
          workflow: isPrimaryApprove ? 'Primary' : 'Product replacement',
          productType: state.workspace.productTypeName || '',
          productTypeVariant: state.workspace.productTypeVariant || '',
          subCategory: task.subCategory || '',
          template: task.template || '',
          priorEan: prior && prior.ean ? String(prior.ean) : '',
          matchLevel: prior ? ((prior.best ? 'Best · ' : '') + (prior.label || prior.level || '')) : '',
          model: (assets.output && assets.output.model) || localStorage.getItem(ANSWERLY_MODEL_KEY) || '',
          imageSize: (assets.output && assets.output.size) || localStorage.getItem(ANSWERLY_SIZE_KEY) || '',
          imageShortCode: shot.code || '',
          imageName: shot.name || '',
          shotSeq: shot.seq != null ? shot.seq : idx,
          qualityRating: String(rating),
          appVersion: APP_VERSION,
          prompt: promptText,
          priorImage: priorImageName,
          productImage: productImageNames.join(', '),
          promptOrigin: origin,
          universalRow: compiled.universalLabel || 'master',
          generationCount: shotGenerationCount(idx),
          answerlyExecutionId: (assets.output && assets.output.executionId) || '',
          answerlyJobId: (assets.output && assets.output.jobId) || '',
          answerlyResultUrl: (assets.output && assets.output.resultUrl) || '',
          workflowTool: (assets.output && assets.output.workflow) || '',
          priorSource: (assets.output && assets.output.priorSource) ||
            (isPrimaryApprove ? 'primary' : (assets.priorOverride ? 'override' : '')),
          answerlyInputUrlA: (function () {
            const urls = (assets.output && assets.output.inputUrls) || [];
            return urls[0] || (assets.output && assets.output.inputUrl) || '';
          }()),
          answerlyInputUrlB1: ((assets.output && assets.output.inputUrls) || [])[1] || '',
          answerlyInputUrlB2: ((assets.output && assets.output.inputUrls) || [])[2] || '',
          answerlyInputUrlB3: ((assets.output && assets.output.inputUrls) || [])[3] || '',
          answerlyInputUrlB4: ((assets.output && assets.output.inputUrls) || [])[4] || '',
          answerlyInputUrlB5: ((assets.output && assets.output.inputUrls) || [])[5] || '',
          answerlyInputUrlB6: ((assets.output && assets.output.inputUrls) || [])[6] || '',
          answerlyInputUrlB7: ((assets.output && assets.output.inputUrls) || [])[7] || '',
          answerlyInputUrlB8: ((assets.output && assets.output.inputUrls) || [])[8] || ''
        }).then((data) => {
          if (!state.workspace) return;
          if (!state.workspace.approved) state.workspace.approved = {};
          const liveOutUrl = ensureAssetDisplayUrl(assets.output);
          state.workspace.approved[idx] = {
            seq: shot.seq != null ? shot.seq : idx,
            shotName: shot.name || '',
            code: shot.code || '',
            outputName: (assets.output && assets.output.name) || '',
            url: liveOutUrl,
            rating: rating,
            promptOrigin: origin,
            approvedAt: Date.now(),
            executionId: (assets.output && assets.output.executionId) || '',
            jobId: (assets.output && assets.output.jobId) || ''
          };
          if (assets.output) assets.output.approved = true;
          if (state.workspace.rejected) delete state.workspace.rejected[idx];
          // Seed renamer-style export row from this approved output (live blob, not a stale URL).
          if (!state.workspace.exportImages) state.workspace.exportImages = {};
          const exportEntry = {
            url: '',
            name: (assets.output && assets.output.name) || '',
            blob: (assets.output && (assets.output.blob || assets.output.file)) || null,
            file: (assets.output && assets.output.file) || null,
            w: (assets.output && assets.output.w) || 0,
            h: (assets.output && assets.output.h) || 0,
            status: 'ready',
            fromApproved: true,
            upscale: null
          };
          exportEntry.url = ensureExportDisplayUrl(exportEntry) || liveOutUrl;
          state.workspace.exportImages[idx] = exportEntry;
          if (isPrimaryApprove) persistCurrentPrimaryDraft();
          else persistCurrentReplaceDraft();
          const savedOrigin = (data && data.promptOrigin) || origin;
          const chars = data && data.promptChars != null ? Number(data.promptChars) : 0;
          const savedRating = (data && data.qualityRating) || String(rating);
          const savedGens = (data && data.generationCount != null && data.generationCount !== '')
            ? data.generationCount
            : shotGenerationCount(idx);
          showToast(
            'Approved · ' + savedOrigin +
              ' · ' + savedRating + '★' +
              (savedGens !== '' && savedGens != null ? (' · ' + savedGens + ' gen' + (Number(savedGens) === 1 ? '' : 's')) : '') +
              (savedOrigin === 'Custom'
                ? (' · prompt saved (' + (chars || String(promptText || '').length) + ' chars)')
                : ' · prompt blank in DB') +
              ' · All user row ' + ((data && data.row) || '') + '.',
            false
          );
          // Refresh reuse cache so the next EAN in this Sub-category + Template can pick it up.
          if (savedOrigin === 'Custom') {
            state.approvedCustomsReady = false;
            ensureApprovedCustomPrompts(true).catch(() => {});
          }
          renderWorkspace();
          // Hero Front / seq 01 Rate & Approve → auto-generate MAIN (Replace + Primary).
          return maybeAutoGenerateMain(idx);
        }).catch((err) => {
          showToast('Could not write All user: ' + esc((err && err.message) || err), false, { error: true });
        });
        return;
      }
      if (action === 'prompt-expand' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        persistReplacePromptFromDom();
        const idx = state.workspaceShot || 0;
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        const text = (promptEl && promptEl.value) ||
          ((state.workspace.prompts && state.workspace.prompts[idx]) || '');
        openPromptExpandModal(text, idx);
        return;
      }
      if (action === 'reroll-prompt' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        persistReplacePromptFromDom();
        const idx = state.workspaceShot || 0;
        if (!(state.workspace.outputs && state.workspace.outputs[idx])) {
          showToast('Generate an image before re-rolling.', false);
          return;
        }
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        if (promptEl) {
          promptEl.focus();
          promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        showToast(
          state.workspace.mode === 'primary'
            ? 'Tweak the prompt in C, then Generate this shot again.'
            : 'Tweak the prompt in C, then Generate this shot again.',
          false
        );
        return;
      }
      if (action === 'prompt-copy' && state.workspace &&
          (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        const text = promptEl ? promptEl.value : '';
        if (!text) {
          showToast('Prompt is empty.', false);
          return;
        }
        navigator.clipboard.writeText(text).then(() => {
          showToast('Prompt copied.', false);
        }).catch(() => {
          showToast('Could not copy prompt.', false, { error: true });
        });
        return;
      }
      if (action === 'browse-prior' && state.workspace) {
        openReplaceFilePicker({ kind: 'prior', shotIndex: state.workspaceShot || 0 });
        return;
      }
      if (action === 'clear-prior' && state.workspace) {
        clearPriorOverride(state.workspaceShot || 0);
        renderWorkspace();
        return;
      }
      if (action === 'download-out' && state.workspace) {
        const idx = state.workspaceShot || 0;
        const out = shotAssets(idx).output;
        if (!(out && (out.blob || out.file || out.url))) {
          showToast('No generated image to download.', false, { error: true });
          return;
        }
        const name = out.name || ((state.workspace.ean || 'output') + '.png');
        if (out.blob || out.file) {
          downloadBlobFile(out.blob || out.file, name);
        } else {
          const a = document.createElement('a');
          a.href = out.url;
          a.download = name;
          a.target = '_blank';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        showToast('Downloading ' + esc(name) + '…', false);
        return;
      }
      if (action === 'cancel-gen' && state.workspace) {
        const cancelAll = actionEl.getAttribute('data-cancel-all') === '1' || !!state.workspace.genAllBatch;
        const shotAttr = actionEl.getAttribute('data-shot');
        const shotIndex = shotAttr != null && shotAttr !== '' ? Number(shotAttr) : null;
        // During a parallel batch, the per-shot Cancel stops that shot only;
        // rail "Cancel all" sets data-cancel-all and stops everything.
        cancelAnswerlyGeneration(
          actionEl.getAttribute('data-cancel-all') === '1'
            ? { all: true }
            : { shotIndex: shotIndex != null && !isNaN(shotIndex) ? shotIndex : undefined }
        );
        return;
      }
      if (action === 'gen-all' && state.workspace) {
        if (!hasWorkspaceProductType()) {
          state.workspace.productTypeWarn = true;
          state.workspace.productTypeOpen = true;
          showToast('Select a Product Type before generating.', false);
          renderWorkspace();
          return;
        }
        if (anyShotBusy()) {
          showToast('A generation is already running — Cancel it first.', false);
          return;
        }
        const task = taskByEan(state.workspace.ean);
        if (!task) {
          showToast('Task not found for this EAN.', false, { error: true });
          return;
        }
        const prior = resolveWorkspaceMatch(task).selected;
        const shots = shotListFor(task);
        const mapInfo = priorTargetCodeMap(prior, shots);
        const pendingSkip = genAllPendingCandidates(task, prior, shots, { includeDone: false });
        const pendingAll = genAllPendingCandidates(task, prior, shots, { includeDone: true });
        const doneCount = countGeneratedMappedShots(task, prior, shots);
        if (!pendingAll.length) {
          const anyMapped = (mapInfo.mapped || []).length > 0;
          showToast(
            anyMapped
              ? 'No shots ready — add a product image on B for each shot you want. Jobs will not run without B (MAIN can use Hero Front / 01 B).'
              : (mapInfo.hasConflict
                ? 'No mapped shots. Unmapped / new shots and dim-separate M-DIM were skipped.'
                : 'No mapped shots to generate.'),
            false
          );
          return;
        }

        function beginGenAll(mode) {
          const includeDone = mode === 'regen';
          const pending = includeDone ? pendingAll : pendingSkip;
          if (!pending.length) {
            showToast(includeDone
              ? 'No shots with B to regenerate. Add a product image on B first.'
              : 'Nothing left — shots with B already have D. Choose Regenerate all to overwrite, or add B on more shots.', false);
            return;
          }
          ensureAnswerlyReadyForGenerate().then((ok) => {
            if (!ok || !state.workspace || state.workspace.mode !== 'replace') return;
            startGenerateAllBatch(task, prior, shots, pending, mapInfo, includeDone);
          });
        }

        if (doneCount > 0) {
          openGenAllChoiceModal(doneCount, pendingSkip.length, function () {
            beginGenAll('skip');
          }, function () {
            beginGenAll('regen');
          });
          return;
        }
        beginGenAll('skip');
        return;
      }
      if (action === 'gen-shot' && state.workspace) {
        if (!hasWorkspaceProductType()) {
          state.workspace.productTypeWarn = true;
          state.workspace.productTypeOpen = true;
          showToast('Select a Product Type before generating.', false);
          renderWorkspace();
          return;
        }
        persistReplacePromptFromDom();
        // Use the shot currently on screen (B inputs belong here). Do not remap on click —
        // Product Type changes can shift Drive→shot mapping and would look like "B is empty".
        const idx = state.workspaceShot || 0;
        const taskNow = taskByEan(state.workspace.ean);
        const shotsNow = shotListFor(taskNow || {});
        const activeShot = shotsNow[idx];
        const isMain = isMainShot(activeShot);
        if (!isMain && !(shotAssets(idx).inputs && shotAssets(idx).inputs.length)) {
          showToast('Drop at least one new product image onto B.', false, { error: true });
          return;
        }
        if (isMain && !mainHasProductRefs(idx, shotsNow)) {
          showToast('Add a product image on B for Hero Front / 01 (or MAIN) first.', false, { error: true });
          return;
        }
        if (!shotAssets(idx).priorOverride) {
          const mapForPrior = priorTargetCodeMap(
            resolveWorkspaceMatch(taskNow).selected,
            shotsNow
          );
          const hasMappedPrior = (mapForPrior.mapped || []).some((m) => m.shotIdx === idx);
          const mainOk = isMain && !!mainAngleSourceShot(shotsNow);
          if (!hasMappedPrior && !mainOk) {
            showToast('No matching prior for this shot — drop any image onto A.', false, { error: true });
            return;
          }
        }
        const promptEl = els.workspace.querySelector('[data-ws-prompt]');
        const promptText = (state.workspace.prompts && state.workspace.prompts[idx] != null)
          ? state.workspace.prompts[idx]
          : ((promptEl && promptEl.value) || '');
        if (isShotBusy(idx)) {
          showToast('This shot is already generating — switch to another shot to run more in parallel.', false);
          return;
        }
        const assets = shotAssets(idx);
        assets.error = null;
        if (state.workspace.cancelShots) delete state.workspace.cancelShots[idx];
        delete state.workspace.cancelAll;
        // Hide previous D while regenerating; keep blob on _previousOutput so drafts
        // survive EAN switches / reload if the job is still running or fails.
        const previousOutput = assets.output;
        const hadPreviousOutput = !!(state.workspace.outputs && state.workspace.outputs[idx]);
        assets._previousOutput = previousOutput || assets._previousOutput || null;
        assets.output = null;
        if (state.workspace.outputs) delete state.workspace.outputs[idx];
        // Mark busy immediately so other shots stay free to Generate in parallel.
        markShotBusy(idx, 'Loading prior…');
        renderWorkspace();
        // Manual Generate/Regenerate: prefer Hero Front D as A when present, but do not
        // hard-block if the user set an A override or Drive prior — only auto/gen-all requires hero D.
        runAnswerlyForShot(idx, promptText, {
          requireMainFromHeroOutput: false
        }).then((result) => {
          if (!state.workspace || state.workspace.mode !== 'replace') return;
          const prev = shotAssets(idx)._previousOutput;
          if (prev && prev !== result.output) revokeAssetUrl(prev);
          delete shotAssets(idx)._previousOutput;
          clearShotBusy(idx);
          persistCurrentReplaceDraft();
          showToast('Answerly done · ' + esc((result.source && result.source.reason) || 'ok'), false);
          renderWorkspace();
        }).catch((err) => {
          if (!state.workspace || state.workspace.mode !== 'replace') return;
          // Restore prior D so a failed/cancelled regen does not wipe a good output.
          const prev = shotAssets(idx)._previousOutput || previousOutput;
          if (prev) {
            shotAssets(idx).output = prev;
            if (!state.workspace.outputs) state.workspace.outputs = {};
            if (hadPreviousOutput || prev) state.workspace.outputs[idx] = true;
          }
          delete shotAssets(idx)._previousOutput;
          const cancelled = isCancelError(err);
          shotAssets(idx).error = cancelled ? null : ((err && err.message) || 'Generation failed');
          clearShotBusy(idx);
          if (state.workspace.cancelShots) delete state.workspace.cancelShots[idx];
          persistCurrentReplaceDraft();
          showToast(
            cancelled ? 'Generation cancelled.' : esc(shotAssets(idx).error || 'Generation failed'),
            false,
            cancelled ? undefined : { error: true }
          );
          renderWorkspace();
          if (err && (err.code === 'no_token' || err.code === 'token_expired' ||
              err.code === 'bridge_offline' || isStaleBridgeError(err.message || err))) {
            openAnswerlyModal();
          }
        });
        return;
      }
      if (action === 'answerly-token') {
        openAnswerlyModal();
        return;
      }
      if (action === 'noop') {
        if (e.target.closest('[disabled]')) return;
        showToast('UI mock only — this action is not wired yet.', false);
      }
    });

    els.workspace.addEventListener('change', (e) => {
      if (!state.workspace ||
          (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
      if (e.target.matches('[data-ws-dim-toggle]')) {
        if (state.workspace.mode !== 'replace') return;
        state.workspace.dimSeparate = !!e.target.checked;
        renderWorkspace();
        return;
      }
      if (e.target.matches('.wr-size-select')) {
        localStorage.setItem(ANSWERLY_SIZE_KEY, e.target.value || '2K');
        return;
      }
      if (e.target.matches('.wr-model-select')) {
        localStorage.setItem(ANSWERLY_MODEL_KEY, e.target.value || 'gemini-3.1-flash-image');
        return;
      }
      if (e.target.matches('[data-ws-pt-variant]')) {
        state.workspace.productTypeVariant = e.target.value;
        state.workspace.prompts = {};
        state.workspace.promptBaselines = {};
        state.workspace.promptManualEdit = {};
        const taskVar = taskByEan(state.workspace.ean);
        state.workspaceShot = defaultWorkspaceShotIndex(shotListFor(taskVar || {}));
        writeProductTypePrefs(state.workspace.productTypeName, state.workspace.productTypeVariant);
        if (state.workspace.mode === 'primary' && state.workspace.primary) {
          const p = state.workspace.primary;
          if (p.a2) {
            Object.keys(p.a2).forEach((k) => {
              if (p.a2Manual && p.a2Manual[k]) return;
              revokeAssetUrl(p.a2[k]);
              delete p.a2[k];
            });
          }
          p.a2Loading = {};
        }
        renderWorkspace();
        syncRoute({ replace: true });
      }
    });

    els.workspace.addEventListener('focusin', (e) => {
      if (!state.workspace ||
          (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
      if (!e.target.matches('[data-ws-pt-search]')) return;
      state.workspace.productTypeOpen = true;
      refreshProductTypeSuggestDom();
    });

    els.workspace.addEventListener('focusout', (e) => {
      if (!state.workspace ||
          (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
      if (!e.target.matches('[data-ws-pt-search]')) return;
      setTimeout(() => {
        if (!state.workspace ||
            (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
        const active = document.activeElement;
        if (active && els.workspace.contains(active) && active.closest('.wr-pt-combo')) return;
        const text = String(state.workspace.productTypeQuery || '').trim().toLowerCase();
        if (!state.workspace.productTypeName && text) {
          const exact = namingProductTypes().filter((t) => t.name.toLowerCase() === text);
          if (exact.length === 1) {
            state.workspace.productTypeName = exact[0].name;
            state.workspace.productTypeQuery = exact[0].name;
            state.workspace.productTypeVariant = exact[0].variants ? Object.keys(exact[0].variants)[0] : '';
            state.workspace.productTypeWarn = false;
            writeProductTypePrefs(state.workspace.productTypeName, state.workspace.productTypeVariant);
          } else {
            state.workspace.productTypeWarn = true;
          }
        }
        state.workspace.productTypeOpen = false;
        renderWorkspace();
      }, 140);
    });

    els.workspace.addEventListener('input', (e) => {
      if (!state.workspace ||
          (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
      if (e.target.matches('[data-ws-pt-search]')) {
        const val = e.target.value;
        if (state.workspace.productTypeName && val !== state.workspace.productTypeName) {
          state.workspace.productTypeName = '';
          state.workspace.productTypeVariant = '';
        }
        state.workspace.productTypeQuery = val;
        state.workspace.productTypeOpen = true;
        state.workspace.productTypeWarn = false;
        refreshProductTypeSuggestDom();
        return;
      }
      if (e.target.matches('[data-ws-prompt]')) {
        const key = e.target.getAttribute('data-ws-prompt');
        const idx = key != null && key !== '' ? Number(key) : (state.workspaceShot || 0);
        setPromptManualEdit(idx, true);
        persistReplacePromptFromDom();
        refreshPromptOriginUi();
        return;
      }
      if (!e.target.matches('.wr-compare-range')) return;
      const pos = Number(e.target.value) || 0;
      state.workspace.comparePos = pos;
      const compare = e.target.closest('[data-ws-compare]');
      if (!compare) return;
      syncCompareSlider(compare, pos);
    });

    els.workspace.addEventListener('scroll', (e) => {
      if (!e.target || !e.target.matches || !e.target.matches('[data-ws-prompt]')) return;
      const overlay = els.workspace.querySelector('[data-ws-prompt-highlight]');
      if (!overlay) return;
      overlay.scrollTop = e.target.scrollTop;
      overlay.scrollLeft = e.target.scrollLeft;
    }, true);

    els.workspace.addEventListener('focusout', (e) => {
      if (!state.workspace ||
          (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary')) return;
      if (!e.target.matches('[data-ws-prompt]')) return;
      persistReplacePromptFromDom();
      if (state.workspace.mode === 'replace' || state.workspace.mode === 'primary') {
        persistCurrentReplaceDraft();
      }
    });

    function replaceDropHasFiles(e) {
      const types = e.dataTransfer && e.dataTransfer.types;
      if (!types) return false;
      return Array.prototype.indexOf.call(types, 'Files') >= 0;
    }

    function resolveReplaceDropTarget(el) {
      if (!el || !state.workspace) return null;
      const mode = state.workspace.mode;
      if (mode !== 'replace' && mode !== 'primary') return null;

      if (mode === 'primary') {
        const a1 = el.closest('[data-ws-drop="primary-a1"]');
        if (a1) return { kind: 'primary-a1', shotIndex: state.workspaceShot || 0, highlight: a1 };
        const a2 = el.closest('[data-ws-drop="primary-a2"]');
        if (a2) return { kind: 'primary-a2', shotIndex: state.workspaceShot || 0, highlight: a2 };
        const a3 = el.closest('[data-ws-drop="primary-a3"]');
        if (a3) return { kind: 'primary-a3', shotIndex: state.workspaceShot || 0, highlight: a3 };
        const inputTileP = el.closest('[data-ws-crop-input]');
        if (inputTileP && inputTileP.getAttribute('data-ws-crop-input') !== '') {
          return {
            kind: 'inputs-replace',
            shotIndex: state.workspaceShot || 0,
            inputIndex: Number(inputTileP.getAttribute('data-ws-crop-input')) || 0,
            highlight: inputTileP
          };
        }
        const shotBtnP = el.closest('[data-ws-drop-shot]');
        if (shotBtnP && shotBtnP.getAttribute('data-ws-drop-shot') !== '') {
          return {
            kind: 'inputs',
            shotIndex: Number(shotBtnP.getAttribute('data-ws-drop-shot')) || 0,
            highlight: shotBtnP,
            switchShot: true,
            keepDriveIndex: true
          };
        }
        const inputsP = el.closest('[data-ws-drop="inputs"]');
        if (inputsP) return { kind: 'inputs', shotIndex: state.workspaceShot || 0, highlight: inputsP };
        const railP = el.closest('[data-ws-drop="rail"]');
        if (railP) return { kind: 'inputs', shotIndex: state.workspaceShot || 0, highlight: railP };
        return null;
      }

      const exportSlot = el.closest('[data-ws-drop-export]');
      if (exportSlot && exportSlot.getAttribute('data-ws-drop-export') !== '') {
        return {
          kind: 'export',
          shotIndex: Number(exportSlot.getAttribute('data-ws-drop-export')) || 0,
          highlight: exportSlot.closest('tr') || exportSlot
        };
      }
      const exportBanner = el.closest('[data-ws-drop="approved-upscale"]');
      if (exportBanner) {
        return { kind: 'export-fill', highlight: exportBanner };
      }
      const mdimBase = el.closest('[data-ws-drop="mdim-base"]');
      if (mdimBase) {
        return { kind: 'mdim-base', shotIndex: state.workspaceShot || 0, highlight: mdimBase };
      }
      const prior = el.closest('[data-ws-drop="prior"]');
      if (prior) return { kind: 'prior', shotIndex: state.workspaceShot || 0, highlight: prior };
      const inputTile = el.closest('[data-ws-crop-input]');
      if (inputTile && inputTile.getAttribute('data-ws-crop-input') !== '') {
        return {
          kind: 'inputs-replace',
          shotIndex: state.workspaceShot || 0,
          inputIndex: Number(inputTile.getAttribute('data-ws-crop-input')) || 0,
          highlight: inputTile
        };
      }
      const shotBtn = el.closest('[data-ws-drop-shot]');
      if (shotBtn && shotBtn.getAttribute('data-ws-drop-shot') !== '') {
        const dropShotIdx = Number(shotBtn.getAttribute('data-ws-drop-shot')) || 0;
        const taskDrop = taskByEan(state.workspace.ean);
        const shotsDrop = shotListFor(taskDrop || {});
        if (isDimensionShot(shotsDrop[dropShotIdx])) {
          return {
            kind: 'mdim-base',
            shotIndex: dropShotIdx,
            highlight: shotBtn,
            switchShot: true,
            keepDriveIndex: true
          };
        }
        return {
          kind: 'inputs',
          shotIndex: dropShotIdx,
          highlight: shotBtn,
          // Keep rail order stable — switch active shot for B attach, but do not remap Drive thumbs.
          switchShot: true,
          keepDriveIndex: true
        };
      }
      const inputs = el.closest('[data-ws-drop="inputs"]');
      if (inputs) return { kind: 'inputs', shotIndex: state.workspaceShot || 0, highlight: inputs };
      const rail = el.closest('[data-ws-drop="rail"]');
      if (rail) {
        const taskRail = taskByEan(state.workspace.ean);
        const shotsRail = shotListFor(taskRail || {});
        const cur = state.workspaceShot || 0;
        if (isDimensionShot(shotsRail[cur])) {
          return { kind: 'mdim-base', shotIndex: cur, highlight: rail };
        }
        return { kind: 'inputs', shotIndex: cur, highlight: rail };
      }
      return null;
    }

    els.workspace.addEventListener('dragenter', (e) => {
      if (!replaceDropHasFiles(e)) return;
      const dest = resolveReplaceDropTarget(e.target);
      if (!dest) return;
      e.preventDefault();
    });

    els.workspace.addEventListener('dragover', (e) => {
      if (!replaceDropHasFiles(e)) return;
      const dest = resolveReplaceDropTarget(e.target);
      if (!dest) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      els.workspace.querySelectorAll('.is-drop-target').forEach((node) => {
        if (node !== dest.highlight) node.classList.remove('is-drop-target');
      });
      if (dest.highlight) dest.highlight.classList.add('is-drop-target');
    });

    els.workspace.addEventListener('dragleave', (e) => {
      const leaving = e.target.closest && e.target.closest('.is-drop-target');
      if (!leaving) return;
      const related = e.relatedTarget;
      if (related && leaving.contains(related)) return;
      leaving.classList.remove('is-drop-target');
    });

    els.workspace.addEventListener('drop', (e) => {
      if (!replaceDropHasFiles(e)) return;
      const dest = resolveReplaceDropTarget(e.target);
      els.workspace.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
      if (!dest) return;
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      if (dest.switchShot) {
        captureRailScroll();
        persistReplacePromptFromDom();
        state.workspaceShot = dest.shotIndex;
        if (!dest.keepDriveIndex) {
          const task = taskByEan(state.workspace.ean);
          const prior = resolveWorkspaceMatch(task).selected;
          const imgs = priorDriveImages(prior);
          const matchImg = imgs.findIndex((_, idx) => {
            const sIdx = shotIndexForDriveName(shotListFor(task || {}), (imgs[idx] && imgs[idx].name) || '');
            return sIdx === dest.shotIndex;
          });
          if (matchImg >= 0) state.workspace.driveImgIndex = matchImg;
        }
      }
      if (dest.kind === 'mdim-base') {
        setMdimBaseOverrideFromFile(files[0]);
      } else if (dest.kind === 'prior') {
        setPriorOverrideFromFile(dest.shotIndex, files[0]);
      } else if (dest.kind === 'primary-a1' || dest.kind === 'primary-a2' || dest.kind === 'primary-a3') {
        const slot = dest.kind === 'primary-a1' ? 'a1' : (dest.kind === 'primary-a3' ? 'a3' : 'a2');
        setPrimarySlotFromFile(slot, dest.shotIndex, files[0]);
      } else if (dest.kind === 'inputs-replace') {
        replaceShotInput(dest.shotIndex, dest.inputIndex, files[0]);
      } else if (dest.kind === 'export') {
        addExportImageToShot(dest.shotIndex, files[0]);
      } else if (dest.kind === 'export-fill') {
        fillNextExportSlots(files);
      } else {
        addLocalFilesToShot(dest.shotIndex, files);
      }
    });

    els.workspace.addEventListener('change', (e) => {
      const toggle = e.target.closest('[data-ws="export-upscale-toggle"]');
      if (!toggle) return;
      localStorage.setItem(UPSCALE_KEY, String(!!toggle.checked));
      state.upscaleOn = !!toggle.checked;
      if (toggle.checked) checkUpscalerService();
      renderWorkspace();
    });
  }

  function refreshProductTypeSuggestDom() {
    if (!els.workspace || !state.workspace) return;
    const list = els.workspace.querySelector('[data-ws-pt-list]');
    const input = els.workspace.querySelector('[data-ws-pt-search]');
    if (!list || !input) return;
    const query = state.workspace.productTypeQuery || '';
    const selected = state.workspace.productTypeName || '';
    const suggestions = findProductTypeSuggestions(query).slice(0, 40);
    list.hidden = !state.workspace.productTypeOpen;
    input.setAttribute('aria-expanded', state.workspace.productTypeOpen ? 'true' : 'false');
    input.classList.toggle('is-warn', !!state.workspace.productTypeWarn);
    list.innerHTML = !suggestions.length
      ? '<li class="wr-pt-empty" role="option" aria-disabled="true">No matching product type</li>'
      : suggestions.map((t) =>
          '<li role="option" data-ws-pt-pick="' + esc(t.name) + '"' +
            (t.name === selected ? ' aria-selected="true" class="is-active"' : '') + '>' +
            '<span>' + esc(t.name) + '</span>' +
            '<span class="wr-pt-cat">' + esc(t.category || '') + '</span>' +
          '</li>').join('');
  }

  function syncCompareSlider(compare, pos) {
    if (!compare) return;
    const overlay = compare.querySelector('.wr-compare-overlay');
    const inner = compare.querySelector('.wr-compare-overlay-inner');
    const handle = compare.querySelector('.wr-compare-handle');
    if (overlay) overlay.style.width = pos + '%';
    if (handle) handle.style.left = pos + '%';
    if (inner) inner.style.width = compare.clientWidth + 'px';
  }

  els.settingsBtn.addEventListener('click', () => {
    const open = els.settingsMenu.hidden;
    els.settingsMenu.hidden = !open;
    els.settingsBtn.setAttribute('aria-expanded', String(open));
  });
  $('menu-author').addEventListener('click', () => { closeSettings(); openNameModal(); });
  // menu-setup wired in the AI upscale setup block above

  /* ---------- Answerly token (Settings › Answerly token) ---------- */
  els.answerlyModal = $('answerly-modal');
  els.answerlyForm = $('answerly-form');
  els.answerlyToken = $('answerly-token');
  els.answerlyStatus = $('answerly-status');
  els.answerlyHint = $('answerly-hint');
  els.menuAnswerly = $('menu-answerly');

  function setAnswerlyStatus(text, ok) {
    if (!els.answerlyStatus) return;
    els.answerlyStatus.textContent = text;
    els.answerlyStatus.classList.toggle('is-ok', ok === true);
    els.answerlyStatus.classList.toggle('is-bad', ok === false);
  }

  function setAnswerlyHint(text) {
    if (!els.answerlyHint) return;
    const msg = String(text || '').trim();
    els.answerlyHint.hidden = !msg;
    els.answerlyHint.textContent = msg;
  }

  function setAnswerlyActionVisible(id, visible) {
    const btn = $(id);
    if (btn) btn.hidden = !visible;
  }

  // Only show the actions that matter for the current bridge/token state.
  async function syncAnswerlyModalActions(tok) {
    const offline = !!(tok && tok.bridgeOffline);
    const perm = offline ? await localNetworkPermission() : 'unknown';
    const blocked = offline && perm === 'denied';
    const hasSaved = !!(localStorage.getItem(ANSWERLY_TOKEN_KEY) || (tok && tok.hasToken));

    setAnswerlyActionVisible('answerly-connect-bridge', offline);
    setAnswerlyActionVisible('answerly-open-session', !offline);
    setAnswerlyActionVisible('answerly-save', !offline);
    setAnswerlyActionVisible('answerly-clear', !offline && hasSaved);

    if (!offline) {
      setAnswerlyHint('');
      return;
    }
    if (blocked) {
      setAnswerlyHint(
        'Chrome blocked this site earlier. Lock icon → Site settings → Local network / Loopback network → Allow → reload, then click Connect bridge.'
      );
    } else {
      setAnswerlyHint(
        'Connect bridge starts the Answerly bridge only (no Firefly). Leave that window open and Allow if Chrome asks. Check: http://127.0.0.1:5175/answerly/health'
      );
    }
  }

  async function refreshAnswerlyStatus() {
    setAnswerlyStatus('Checking bridge…');
    setAnswerlyHint('');
    const tok = await refreshAnswerlyTokenState();
    await syncAnswerlyModalActions(tok);
    if (tok && tok.bridgeOffline) {
      setAnswerlyStatus(
        (await localNetworkPermission()) === 'denied'
          ? 'Bridge blocked by Chrome'
          : 'Bridge not connected',
        false
      );
      return;
    }
    if (tok && tok.hasToken && !tok.expired) {
      const personal = String(tok.workspaceKind || '').toLowerCase() === 'personal';
      setAnswerlyStatus(
        'Connected · ' + formatTokenExpiryDetail(tok) +
          (personal ? ' — still on Personal; save again to use Marketing Visualization' : ''),
        !personal
      );
    } else if (tok && tok.hasToken && tok.expired) {
      setAnswerlyStatus('Connected · token expired — paste a fresh session', false);
    } else {
      setAnswerlyStatus('Connected · paste a session token to continue', false);
    }
    syncAnswerlyTokenChip();
    if (state.workspace &&
        (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
      renderWorkspace();
    }
  }

  function openAnswerlyModal() {
    if (!els.answerlyModal) return;
    closeSettings();
    const saved = localStorage.getItem(ANSWERLY_TOKEN_KEY) || '';
    els.answerlyToken.value = saved && saved.charAt(0) === '{' ? saved : '';
    els.answerlyToken.placeholder = saved && saved.charAt(0) !== '{'
      ? 'Token on file (hidden). Paste a fresh session JSON to replace it.'
      : 'Paste the session JSON (or accessToken) here';
    els.answerlyModal.hidden = false;
    // Hide action buttons until status check finishes (avoids a busy first paint).
    setAnswerlyActionVisible('answerly-connect-bridge', false);
    setAnswerlyActionVisible('answerly-open-session', false);
    setAnswerlyActionVisible('answerly-save', false);
    setAnswerlyActionVisible('answerly-clear', false);
    setAnswerlyHint('');
    refreshAnswerlyStatus();
    setTimeout(() => els.answerlyToken.focus(), 30);
  }

  function closeAnswerlyModal() {
    if (!els.answerlyModal) return;
    els.answerlyModal.hidden = true;
  }

  if (els.menuAnswerly) {
    els.menuAnswerly.addEventListener('click', () => openAnswerlyModal());
  }
  if ($('answerly-cancel')) {
    $('answerly-cancel').addEventListener('click', closeAnswerlyModal);
  }
  if ($('answerly-connect-bridge')) {
    $('answerly-connect-bridge').addEventListener('click', async () => {
      setAnswerlyStatus('Connecting…');
      setAnswerlyHint('If Chrome asks for local/loopback access, click Allow. Leave the Answerly bridge window open.');
      // 1) Ask Chrome for loopback access (needs a user gesture).
      try {
        const res = await bridgeFetch('/answerly/health', { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          await refreshAnswerlyStatus();
          showToast('Answerly bridge connected', false);
          return;
        }
      } catch (_) { /* start Answerly-only process next */ }

      // 2) Start Answerly-only bridge (does not start Firefly Chrome).
      setAnswerlyStatus('Starting Answerly bridge…');
      try { location.href = 'playground3d://answerly'; } catch (_) { /* ignore */ }

      let connected = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await bridgeFetch('/answerly/health', { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            connected = true;
            break;
          }
        } catch (_) { /* keep waiting */ }
        setAnswerlyStatus('Waiting for Answerly bridge… ' + (i + 1) + '/20');
      }

      if (connected) {
        await refreshAnswerlyStatus();
        showToast('Answerly bridge connected', false);
        return;
      }

      const perm = await localNetworkPermission();
      setAnswerlyStatus(perm === 'denied' ? 'Bridge blocked by Chrome' : 'Bridge not connected', false);
      await syncAnswerlyModalActions({ bridgeOffline: true });
      if (perm === 'denied') {
        setAnswerlyHint(
          'Chrome blocked this site earlier. Lock icon → Site settings → Local network / Loopback network → Allow → reload, then click Connect bridge.'
        );
      } else {
        setAnswerlyHint(
          'Still offline. Open http://127.0.0.1:5175/answerly/health in a new tab. If that fails, run “Setup Answerly.bat” from the latest zip (no Firefly needed).'
        );
      }
    });
  }
  if ($('answerly-open-session')) {
    $('answerly-open-session').addEventListener('click', () => {
      window.open(ANSWERLY_SESSION_URL, '_blank', 'noopener');
    });
  }
  if ($('answerly-clear')) {
    $('answerly-clear').addEventListener('click', async () => {
      localStorage.removeItem(ANSWERLY_TOKEN_KEY);
      els.answerlyToken.value = '';
      try {
        await answerlyFetch('/answerly/token', { method: 'DELETE' });
        await refreshAnswerlyTokenState();
        setAnswerlyStatus('Saved token cleared', true);
        await syncAnswerlyModalActions(state.answerlyToken);
        if (state.workspace && state.workspace.mode === 'replace') renderWorkspace();
      } catch (err) {
        setAnswerlyStatus(friendlyBridgeError(err), false);
      }
    });
  }
  if (els.answerlyModal) {
    els.answerlyModal.addEventListener('click', (e) => {
      if (e.target === els.answerlyModal) closeAnswerlyModal();
    });
  }

  if (els.cropModal) {
    if (els.cropCancel) els.cropCancel.addEventListener('click', closeCropModal);
    if (els.cropConfirm) els.cropConfirm.addEventListener('click', () => { confirmCropModal(); });
    if (els.cropKeepProportion) {
      els.cropKeepProportion.addEventListener('change', onCropKeepProportionChange);
    }
    if (els.cropReset) els.cropReset.addEventListener('click', resetCropBox);
    if (els.cropHead) els.cropHead.addEventListener('pointerdown', startCropWindowDrag);
    if (els.cropStage) {
      els.cropStage.addEventListener('pointerdown', startCropDrag);
    }
    window.addEventListener('pointermove', (e) => {
      moveCropWindowDrag(e);
      moveCropDrag(e);
    });
    window.addEventListener('pointerup', () => {
      endCropWindowDrag();
      endCropDrag();
    });
    window.addEventListener('pointercancel', () => {
      endCropWindowDrag();
      endCropDrag();
    });
    window.addEventListener('resize', () => {
      if (els.cropModal && !els.cropModal.hidden) {
        placeCropWindow(true);
        paintCropBox();
      }
    });
  }
  if (els.answerlyForm) {
    els.answerlyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const extracted = extractAnswerlyAccessToken(els.answerlyToken.value);
      if (extracted.error) {
        setAnswerlyStatus(extracted.error, false);
        return;
      }
      setAnswerlyStatus('Saving for Marketing Visualization Team…');
      try {
        const saved = await answerlyFetch('/answerly/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: extracted.token,
            // Force shared team workspace (not personal).
            workspaceId: '9901bfd2-4c06-4746-8d63-aa2867248f1e'
          })
        });
        localStorage.setItem(ANSWERLY_TOKEN_KEY, extracted.token);
        state.answerlyToken = (saved && saved.token) || null;
        if (saved && saved.workspace) {
          state.answerlyToken = Object.assign({}, state.answerlyToken || {}, {
            workspaceId: saved.workspace.id,
            workspaceName: saved.workspace.name,
            workspaceKind: saved.workspace.kind
          });
        }
        // Drop stale “expired” chip immediately (Primary used to keep showing it until re-render).
        if (state.answerlyToken) {
          delete state.answerlyToken.error;
          if (state.answerlyToken.hasToken && !state.answerlyToken.expired) {
            state.answerlyToken.bridgeOffline = false;
          }
        }
        syncAnswerlyTokenChip();
        await refreshAnswerlyStatus();
        syncAnswerlyTokenChip();
        showToast('Answerly token saved · ' + formatTokenExpiryDetail(state.answerlyToken), false);
        closeAnswerlyModal();
      } catch (err) {
        setAnswerlyStatus(friendlyBridgeError(err), false);
      }
    });
  }

  function syncAnswerlyTokenChip() {
    if (!els.workspace || !state.workspace) return;
    if (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary') return;
    const chip = els.workspace.querySelector('.wr-token-chip');
    if (!chip) return;
    const tok = state.answerlyToken;
    chip.className = 'wr-token-chip ' + tokenChipClass(tok);
    chip.title = (tok && tok.error) || formatTokenExpiryDetail(tok);
    chip.textContent = formatTokenExpiry(tok);
  }

  // Keep expiry chip fresh while Replace / Primary is open (avoid full re-render so the prompt isn't disrupted).
  setInterval(() => {
    if (!state.workspace) return;
    if (state.workspace.mode !== 'replace' && state.workspace.mode !== 'primary') return;
    if (document.visibilityState !== 'visible') return;
    refreshAnswerlyTokenState().then(() => syncAnswerlyTokenChip());
  }, 60000);

  const menuStats = $('menu-stats');
  if (menuStats) {
    menuStats.addEventListener('click', () => {
      closeSettings();
      window.open('stats/index.html', '_blank', 'noopener,noreferrer');
    });
  }
  $('menu-refresh').addEventListener('click', () => { closeSettings(); load(); });
  $('btn-refresh').addEventListener('click', () => load());
  $('name-cancel').addEventListener('click', () => {
    closeNameModal();
    if (!state.author && hashView() === 'my') {
      syncHash(state.view === 'my' ? 'available' : state.view, true);
    }
  });
  els.nameInput.addEventListener('input', () => { els.nameSave.disabled = !els.nameInput.value.trim(); });
  $('name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = els.nameInput.value.trim();
    if (!name) return;
    state.author = name;
    localStorage.setItem(AUTHOR_KEY, name);
    renderUser();
    if (state.model) fillFilters();
    const action = state.pendingAction;
    closeNameModal();
    if (action) action(); else render();
  });

  /* ---------- Load ---------- */

  let loading = false;
  async function applyFeedData(data, opts) {
    opts = opts || {};
    state.hhModel = buildModel(data);
    try {
      state.mtsModel = buildMtsModel(data);
    } catch (err) {
      console.warn('MTS model build failed', err);
      state.mtsModel = buildMtsModel({
        furniture: { rows: [], modified: '', error: String((err && err.message) || err) },
        warnings: []
      });
    }
    if (isMts() && state.groupBy !== 'subCategory' && state.groupBy !== 'product') {
      state.groupBy = 'subCategory';
    }
    if (!isMts() && (state.groupBy === 'subCategory' || state.groupBy === 'product')) {
      state.groupBy = 'subTemplate';
    }
    state.model = isMts() ? state.mtsModel : state.hhModel;
    state.loadedAt = Date.now();
    syncCatalogUi();
    renderSource(data);
    fillFilters();
    updateTimestamp();
    updateTabCounts();
    const route = parseHash();
    if (isMts() && route && route.view === 'my') {
      setView('available', { syncHash: true, replace: true });
    } else if (!restoreWorkspaceFromRoute(route)) {
      render();
    }
    if (!opts.silentWarnings && data.warnings && data.warnings.length) {
      showToast('Some tabs could not be read: ' + esc(data.warnings.join('; ')), false);
    }
    // Drive thumbs only when needed for the open EAN workspace / list — avoid extra full reloads mid-edit.
    if (!opts.skipImages) loadImages();
    if (!isMts()) loadTemplateRefImages();
  }

  async function load() {
    if (loading) return;
    loading = true;
    const route = parseHash();
    const deepReplace = route && route.view === 'my' && route.ws === 'replace' && route.ean;
    els.updated.textContent = 'Loading…';
    if (els.synced) els.synced.textContent = '…';

    // Deep-link into Replacement: restore cached feed + this EAN's drafts first (no full sheet wait).
    if (deepReplace && !state.model) {
      try {
        const cached = await loadFeedCache();
        if (cached && cached.feed) {
          const data = buildTaskDataFromFeed(cached.feed);
          await applyFeedData(data, { silentWarnings: true, skipImages: false });
          els.updated.textContent = 'Cached sheets · refreshing…';
        } else if (!state.model) {
          els.list.innerHTML = '<div class="tp-state"><span class="tp-spinner"></span>Opening EAN ' +
            esc(String(route.ean)) + '… loading sheets once for this session.</div>';
        }
      } catch (e) {
        console.warn('Cached feed restore failed', e);
      }
    } else if (!state.model) {
      els.list.innerHTML = '<div class="tp-state"><span class="tp-spinner"></span>Reading the live sheets… the first load can take up to a minute.</div>';
    }

    try {
      const data = await loadTaskData();
      // Keep the open Replacement workspace; only refresh the model underneath.
      const keepWs = state.workspace && state.workspace.mode === 'replace'
        ? {
            ean: state.workspace.ean,
            matchEan: state.workspace.matchEan,
            shot: state.workspaceShot,
            drive: state.workspace.driveImgIndex,
            draftsLoaded: state.workspace.draftsLoaded,
            assets: state.workspace.assets,
            prompts: state.workspace.prompts,
            outputs: state.workspace.outputs,
            approved: state.workspace.approved,
            rejected: state.workspace.rejected,
            ratings: state.workspace.ratings,
            exportImages: state.workspace.exportImages,
            exportCleared: state.workspace.exportCleared,
            productTypeName: state.workspace.productTypeName,
            productTypeVariant: state.workspace.productTypeVariant,
            productTypeQuery: state.workspace.productTypeQuery,
            dimSeparate: state.workspace.dimSeparate,
            mdimShowAbcd: state.workspace.mdimShowAbcd,
            mdimDraft: state.workspace.mdimDraft,
            mdimBaseKey: state.workspace.mdimBaseKey,
            mdimOverride: state.workspace.mdimOverride,
            mdimWorkspaceUrl: state.workspace.mdimWorkspaceUrl,
            mdimWorkspaceBlob: state.workspace.mdimWorkspaceBlob,
            mdimSourceAsset: state.workspace.mdimSourceAsset,
            mdimWsCache: state.workspace.mdimWsCache,
            promptBaselines: state.workspace.promptBaselines,
            promptManualEdit: state.workspace.promptManualEdit
          }
        : null;
      await applyFeedData(data);
      if (keepWs && state.workspace && String(state.workspace.ean) === String(keepWs.ean) &&
          state.workspace.mode === 'replace') {
        // Re-attach live in-memory A/B/C/D after model refresh so B is not wiped.
        state.workspace.assets = keepWs.assets || state.workspace.assets;
        state.workspace.prompts = keepWs.prompts || state.workspace.prompts;
        state.workspace.outputs = keepWs.outputs || state.workspace.outputs;
        state.workspace.approved = keepWs.approved || state.workspace.approved;
        state.workspace.rejected = keepWs.rejected || state.workspace.rejected;
        state.workspace.ratings = keepWs.ratings || state.workspace.ratings;
        state.workspace.exportImages = keepWs.exportImages || state.workspace.exportImages;
        state.workspace.exportCleared = keepWs.exportCleared || state.workspace.exportCleared;
        state.workspace.productTypeName = keepWs.productTypeName || state.workspace.productTypeName;
        state.workspace.productTypeVariant = keepWs.productTypeVariant || state.workspace.productTypeVariant;
        state.workspace.productTypeQuery = keepWs.productTypeQuery || state.workspace.productTypeQuery;
        state.workspace.dimSeparate = keepWs.dimSeparate;
        state.workspace.mdimShowAbcd = keepWs.mdimShowAbcd;
        state.workspace.mdimDraft = keepWs.mdimDraft || state.workspace.mdimDraft;
        state.workspace.mdimBaseKey = keepWs.mdimBaseKey || state.workspace.mdimBaseKey;
        state.workspace.mdimOverride = keepWs.mdimOverride || state.workspace.mdimOverride;
        state.workspace.mdimWorkspaceUrl = keepWs.mdimWorkspaceUrl || state.workspace.mdimWorkspaceUrl;
        state.workspace.mdimWorkspaceBlob = keepWs.mdimWorkspaceBlob || state.workspace.mdimWorkspaceBlob;
        state.workspace.mdimSourceAsset = keepWs.mdimSourceAsset || state.workspace.mdimSourceAsset;
        state.workspace.mdimWsCache = keepWs.mdimWsCache || state.workspace.mdimWsCache;
        state.workspace.promptBaselines = keepWs.promptBaselines || state.workspace.promptBaselines;
        state.workspace.promptManualEdit = keepWs.promptManualEdit || state.workspace.promptManualEdit;
        state.workspace.draftsLoaded = !!keepWs.draftsLoaded;
        if (keepWs.matchEan) state.workspace.matchEan = keepWs.matchEan;
        if (keepWs.shot != null) state.workspaceShot = keepWs.shot;
        if (keepWs.drive != null) state.workspace.driveImgIndex = keepWs.drive;
        renderWorkspace();
      }
      // MTS after HH so a slow/broken furniture deploy cannot block Available Tasks.
      loadMtsFeedInBackground();
    } catch (err) {
      console.error(err);
      if (state.model) {
        updateTimestamp();
        if (state.model.xlsxSync) renderXlsxSync(state.model.xlsxSync);
        showToast('Refresh failed: ' + esc(err.message === 'NO_ACCESS' ? 'could not reach the sheet reader.' : err.message) + ' Showing the last loaded data.', false);
        loadMtsFeedInBackground();
      } else {
        els.updated.textContent = 'Not loaded';
        if (els.synced) els.synced.textContent = '—';
        showLoadError(err);
      }
    } finally {
      loading = false;
    }
  }

  function showLoadError(err) {
    renderDrawer(null);
    let body;
    if (err.message === 'NO_FEED_URL') {
      body = 'The sheet reader is not connected yet. Paste the Apps Script web app URL (ending in <code>/exec</code>) into <code>FEED_URL</code> in <code>tasks.js</code>.';
    } else if (err.message === 'NO_ACCESS') {
      body = 'Sign in with your Livspace Google account and allow access: <a href="' + esc(FEED_URL) + '" target="_blank" rel="noopener">open the sheet reader</a> once, then click Retry.<br>' +
        'If you are signed in to more than one Google account, use a browser profile with only your Livspace account.';
    } else {
      body = esc(err.message);
    }
    els.list.innerHTML = '<div class="tp-state"><strong>The live sheets could not be read</strong>' + body +
      (FEED_URL ? '<span class="tp-state-actions"><button type="button" class="tp-btn tp-btn-primary" data-load>Retry</button></span>' : '') +
      '</div>';
  }

  els.list.addEventListener('click', (e) => {
    if (e.target.closest('[data-load]')) load();
    if (e.target.closest('[data-clear-filters]')) clearFilters();
  });

  els.list.addEventListener('toggle', (e) => {
    if (e.target.classList && e.target.classList.contains('tp-datacheck')) state.dataCheckOpen = e.target.open;
  }, true);

  renderUser();
  syncCatalogUi();
  ensurePrimaryPromptCoreScript();
  {
    // No hash → #renamer so the live index.html URL opens Renamer (same as before V1.2).
    const initial = hashView() || 'renamer';
    // MTS has no My Tasks yet — land on Available instead.
    setView(isMts() && initial === 'my' ? 'available' : initial, { syncHash: !hashView(), replace: true });
  }
  setInterval(updateTimestamp, 30000);
  // Poll only while the tab is visible so background tabs do not burn Sheets quota.
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshAssigns();
  }, ASSIGN_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAssigns();
    if (document.visibilityState === 'hidden' && state.workspace &&
        (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
      persistCurrentReplaceDraft();
    }
  });
  window.addEventListener('pagehide', () => {
    if (state.workspace &&
        (state.workspace.mode === 'replace' || state.workspace.mode === 'primary')) {
      persistCurrentReplaceDraft();
    }
  });
  load();
})();
