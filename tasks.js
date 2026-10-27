(function () {
  'use strict';

  const AUTHOR_KEY = 'imageRenamer.author';
  // Pick / Assign controls are only for these authors (matched on first name or full name).
  const ASSIGN_AUTHORS = ['vinay', 'aman', 'ananyo'];
  // Old local picks key — cleared on load; assignments now live only in the assign / Render Tracker sheet.
  try { localStorage.removeItem('tasks.picks'); } catch (e) { /* ignore */ }

  // Web app URL (ends in /exec) of the HH Multi Sheet Reader Apps Script deployment, which reads
  // Shoot Tracker - HH, LSH-HH-Render Tracker and LSH-HH-Naming Convention-Test-2.
  const FEED_URL = 'https://script.google.com/a/macros/livspace.com/s/AKfycbxWbesitEd9mhiPkdLzZawNAb_AxwYWulrrBBA8ZqtYx5A9RX0lAGnybIQMle6W_7V8/exec';
  const FEED_TIMEOUT_MS = 90000;
  const FEED_VERSION = 27;
  // How often to re-read the assign sheet while this tab is visible (other users' picks).
  // ~2 reads/min per open browser — well under the Sheets ~60 reads/min/user cap.
  const ASSIGN_POLL_MS = 30000;

  const SHOOT_TABS = [
    { category: 'Decor & Garden', tab: 'Decor and Garden' },
    { category: 'Table Top & Bath', tab: 'Table Top & Bath' },
    { category: 'Kitchen & Laundry', tab: 'Kitchen & Laundry' }
  ];

  // Template reference images, keyed by template ID, e.g. T5: 'https://...'.
  const TEMPLATE_IMAGES = {};
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
  const LINK_COLUMNS = ['driveLink', 'pdpLink', 'outputLink'];
  const RENDER_COLUMNS = {
    ean: ['ean number', 'ean code', 'ean'],
    artist: ['artist'],
    // PDP Images dropdown on the Tracker / assign sheet (Not started, In progress, Blocked, Completed).
    pdpImages: ['pdp images', 'pdp image', 'images status', 'pdp status'],
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
    loadedAt: null,
    view: 'renamer',
    myBucket: 'active',
    // UI mock only: null | { mode: 'choose'|'primary'|'replace', ean }
    workspace: null,
    workspaceShot: 0,
    author: localStorage.getItem(AUTHOR_KEY) || '',
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
    pendingAction: null
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    list: $('task-list'),
    count: $('task-count'),
    tabAvailable: $('tab-count-available'),
    tabMy: $('tab-count-my'),
    updated: $('updated-text'),
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
  function canAssignTasks() {
    const n = String(state.author || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!n) return false;
    if (ASSIGN_AUTHORS.indexOf(n) >= 0) return true;
    const first = n.split(' ')[0];
    return ASSIGN_AUTHORS.indexOf(first) >= 0;
  }

  // Hash routes: #renamer | #available | #my
  function hashView() {
    const raw = String(location.hash || '').replace(/^#\/?/, '').split(/[/?&]/)[0].toLowerCase();
    if (raw === 'renamer' || raw === 'available' || raw === 'my') return raw;
    return '';
  }

  function syncHash(view, replace) {
    const next = '#' + view;
    if (location.hash === next) return;
    if (replace) history.replaceState(null, '', next);
    else location.hash = view;
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
  // the width needed. Without that link it falls back to the sign-in based URL, which some browsers block.
  function thumbUrl(img, width) {
    if (img.thumb) return img.thumb.replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + '=w' + width;
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(img.id) + '&sz=w' + width;
  }

  // Shoot folders: second image is the usual product preview. Output folders: first image.
  function defaultPhoto(list, preferFirst) {
    if (preferFirst) return 0;
    return list.length > 1 ? 1 : 0;
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

  function templateOrder(t) {
    const m = String(t).match(/^T(\d+)$/i);
    return m ? Number(m[1]) : 9999;
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
      // Catch renamed headers such as "SET/PCS" or "Set - Pcs" that still contain both words.
      if (key === 'setPcs') {
        headers.forEach((h, c) => {
          if (h && /set/.test(h) && /pcs/.test(h) && !cols.includes(c)) cols.push(c);
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

  // A tab whose Set / PCs header has another name: the column where most filled cells read PCs, Set or Set of N.
  function setColumnByValues_(rows) {
    const re = /^(pcs?|pieces?|sets?|set\s*of\s*\d+)$/i;
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

  // Prefer "SET OF 2" / "Set" over a stray "PCs" copied into a helper column on the same row.
  function pickSetValue_(vals) {
    if (!vals.length) return '';
    const rank = (v) => (/set\s*of\s*\d+/i.test(v) ? 0 : /^set\b/i.test(v) ? 1 : /pc/i.test(v) ? 3 : 2);
    return vals.slice().sort((a, b) => rank(a) - rank(b) || b.length - a.length)[0];
  }

  function normTab(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  }

  // The sheets are organisation-only, so the feed is loaded with a <script> tag (JSONP):
  // the request carries the user's Google sign-in, which fetch() across origins would not.
  let jsonpSeq = 0;
  function jsonp(query, timeoutMs) {
    return new Promise((resolve, reject) => {
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
      script.src = FEED_URL + (FEED_URL.indexOf('?') >= 0 ? '&' : '?') + query + '&callback=' + cb + '&t=' + Date.now();
      document.head.appendChild(script);
    });
  }

  async function loadTaskData() {
    if (!FEED_URL) throw new Error('NO_FEED_URL');
    const feed = await jsonp('action=tasks', FEED_TIMEOUT_MS);
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
    return { shoot, render, warnings };
  }

  function missingNames(table, columns, required) {
    return table.missing.filter((k) => required.includes(k)).map((k) => columns[k][0].toUpperCase()).join(', ');
  }

  /* ---------- Model ---------- */

  // One entry per line of the Mandatory Shot List cell. The row count and the Required Shots list both use this.
  // A line that only continues the previous one, e.g. "( Base )" on its own line, is joined back to it.
  function parseShots(text) {
    const lines = String(text || '')
      .replace(/\u00a0/g, ' ')
      .split(/\r\n|\r|\n|\u2022/)
      .map((l) => l.replace(/^\s*(\d+[.)]|[-*])\s+/, '').trim())
      .filter((l) => l && !/^[-–.,]+$/.test(l));
    const out = [];
    lines.forEach((l) => {
      if (out.length && /^[(&,]/.test(l)) out[out.length - 1] += ' ' + l;
      else out.push(l);
    });
    return out.map((name) => ({ name }));
  }

  // "T 4", "t4" and "T4 " become "T4". Anything without a T-number (e.g. a pasted link title) counts as no template.
  function tidyTemplate(s) {
    const m = String(s || '').toUpperCase().match(/\bT\s*-?\s*(\d+)\b/);
    return m ? 'T' + Number(m[1]) : '';
  }

  function tidySet(s) {
    const v = String(s || '').trim();
    if (!v) return { label: '', kind: '' };
    const of = v.match(/set\s*of\s*(\d+)/i);
    if (of) return { label: 'Set of ' + of[1], kind: 'set' };
    if (/^sets?\b/i.test(v) || /\bset\b/i.test(v)) return { label: titleCase(v).replace(/\bOf\b/, 'of'), kind: 'set' };
    if (/pc/i.test(v)) return { label: 'PCs', kind: 'pcs' };
    return { label: v, kind: 'other' };
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
    if (!isUrl(r.driveLink) && r.rowFolder) r.driveLink = r.rowFolder;
    const driveRaw = r.driveLink;
    let driveResolved = pickUrl(driveRaw, r.driveLinkUrl) || (isUrl(driveRaw) ? String(driveRaw).trim() : '');
    if (!driveResolved) {
      const embedded = String(driveRaw || '').match(/drive\.google\.com\/(?:.*\/folders\/|[^\s]*[?&]id=)([\w-]{10,})/i);
      if (embedded) driveResolved = 'https://drive.google.com/drive/folders/' + embedded[1];
    }
    const productName = tidyName(r.productName);
    const subCategory = tidyName(r.subCategory);
    const functionalProp = String(r.functionalProp || '').trim();
    const prop = classifyProp(functionalProp, r.functionalPropUrl);
    const needsProp = !!functionalProp || !!r.functionalPropUrl || propsNeeded(r.propsNeeded);
    return {
      ean: r.ean.replace(/\s+/g, ''),
      rowNumber: r.rowNumber,
      category,
      department: r.department,
      sheetCategory: tidyName(r.category),
      subCategory,
      subKey: subCategory.toLowerCase(),
      productName,
      productKey: productName.toLowerCase(),
      style: r.style,
      title: productName || tidyName(r.style) || 'Untitled product',
      setLabel: set.label,
      setKind: set.kind,
      size: realValue(r.size),
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

  function detectIssues(t, eanCount) {
    const issues = [];
    const warn = (key, text) => issues.push({ key, level: 'warn', text });
    if (!/^\d{13}$/.test(t.ean)) warn('ean', 'EAN "' + t.ean + '" is not 13 digits.');
    if (eanCount.get(t.ean) > 1) warn('dup', 'EAN appears ' + eanCount.get(t.ean) + ' times in the Shoot Tracker.');
    if (!t.template) warn('template', t.templateRaw ? 'Template mapping "' + t.templateRaw + '" is not a template number.' : 'Template mapping is missing.');
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
      const row = (renderByEan.get(p.ean) || [])[0];
      if (!row) return;
      if (row.pdpImages) p.pdpImages = row.pdpImages;
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
          ? (p.templateRaw ? 'template mapping "' + p.templateRaw + '" has no T-number' : 'no template mapping yet')
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
      fileSavedAt: data.shoot.map((s) => s.modified).filter(Boolean).sort().pop() || ''
    };
  }

  // Every artist who has done the same sub-category + template, the same template, or the same sub-category,
  // closest match first and most work first within each level.
  function suggestionsFor(template, subKey) {
    const h = state.model.history;
    const levels = [
      [template && subKey ? h.byKey.get(template + '|' + subKey) : null, 'same sub-category and template'],
      [template ? h.byTemplate.get(template) : null, 'template ' + template],
      [subKey ? h.bySub.get(subKey) : null, 'same sub-category']
    ];
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
    const list = state.model && state.model.assignedByEan.get(ean);
    return list && list[0] ? String(list[0].artist || '').trim() : '';
  }

  function isAssignedToMe(ean) {
    if (!state.author) return false;
    const list = state.model && state.model.assignedByEan.get(ean);
    if (!list) return false;
    const n = state.author.toLowerCase();
    return list.some((r) => String(r.artist || '').trim().toLowerCase() === n);
  }

  // Mark EANs as assigned in the live model (after a successful sheet write or a poll).
  function applyAssignments(eans, artist) {
    if (!state.model || !eans.length) return;
    eans.forEach((ean) => {
      if (!state.model.assignedByEan.has(ean)) state.model.assignedByEan.set(ean, []);
      const list = state.model.assignedByEan.get(ean);
      if (!list.some((r) => String(r.artist || '').trim().toLowerCase() === artist.toLowerCase())) {
        list.push({ ean, artist, pdpImages: 'Blocked' });
      } else {
        const row = list.find((r) => String(r.artist || '').trim().toLowerCase() === artist.toLowerCase());
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

  // Merge a fresh assign-sheet read into the model. Returns true when the open list changed.
  function mergeAssignsFromSheet(sheet) {
    if (!state.model || !sheet || !sheet.values) return false;
    const rows = tableFrom(sheet.values, RENDER_COLUMNS);
    let changed = false;
    rows.forEach((r) => {
      const ean = String(r.ean || '').replace(/\s+/g, '');
      const artist = String(r.artist || '').trim();
      if (!ean || !artist) return;
      const list = state.model.assignedByEan.get(ean);
      if (list && list.some((x) => String(x.artist || '').trim().toLowerCase() === artist.toLowerCase())) return;
      const wasOpen = state.model.tasks.some((t) => t.ean === ean);
      if (!list) state.model.assignedByEan.set(ean, []);
      state.model.assignedByEan.get(ean).push(r);
      if (wasOpen) {
        state.model.tasks = state.model.tasks.filter((t) => t.ean !== ean);
        const p = state.model.products.find((x) => x.ean === ean);
        if (p) p.hiddenReason = 'already assigned to ' + artist + ' in the Render Tracker';
      }
      changed = true;
    });
    return changed;
  }

  function assign(eans, artist) {
    if (!eans.length) return;
    // Resolve the artist at write time so a name entered in the modal is used (not a stale empty closure).
    withAuthor(() => {
      const who = String(artist || state.author || '').trim();
      if (!who) {
        showToast('Assign failed — enter your author name first.', false);
        return;
      }
      writeAssignsToSheet(eans, who);
    });
  }

  // Appends to the sheet, then updates this page immediately. Other browsers pick it up via assign polling.
  async function writeAssignsToSheet(eans, artist) {
    const who = String(artist || state.author || '').trim();
    if (!who) {
      showToast('Assign failed — artist name is required.', false);
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
      showToast('Assign failed — nothing was saved. ' + esc(err.message), false);
      return;
    }

    if (!written && skipped) {
      showToast('Assign failed — ' + skipped + ' EAN' + (skipped === 1 ? ' is' : 's are') +
        ' already in the Render Tracker (left unchanged).', false);
      // Sheet already has them — sync local model so the task leaves Available.
      applyAssignments(eans, who);
      render();
      return;
    }
    if (!written) {
      showToast('Assign failed — the sheet did not accept any rows.', false);
      return;
    }

    const accepted = writtenEans.length ? writtenEans : eans;
    applyAssignments(accepted, who);
    const mine = state.author && who.toLowerCase() === state.author.toLowerCase();
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
    if (!state.model || assignRefreshRunning || !FEED_URL) return;
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

  function pickForMe(eans) {
    assign(eans, null);
  }

  /* ---------- Filtering and grouping ---------- */

  function availableTasks() {
    return state.model ? state.model.tasks.slice() : [];
  }

  function myTasks() {
    if (!state.model || !state.author) return [];
    return state.model.products.filter((p) => p.driveLink && p.template && isAssignedToMe(p.ean));
  }

  function assignmentRow(ean) {
    const list = state.model && state.model.assignedByEan.get(ean);
    return list && list[0] ? list[0] : null;
  }

  // Map Tracker "PDP Images" cell text to the four UI statuses.
  function normalizePdpStatus(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return STATUS.not_started;
    if (/^(completed|complete|done|finished)$/.test(v) || /\bcompleted\b/.test(v)) return STATUS.completed;
    if (/^blocked$/.test(v) || /\bblocked\b/.test(v)) return STATUS.blocked;
    if (/in\s*-?\s*progress|progress|wip|working/.test(v)) return STATUS.in_progress;
    if (/not\s*-?\s*started|not\s*yet|pending|to\s*do|todo|new/.test(v)) return STATUS.not_started;
    return STATUS.not_started;
  }

  function statusOf(t) {
    const row = assignmentRow(t.ean);
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

  function shotListFor(t) {
    if (t.shots && t.shots.length) {
      return t.shots.map((s, i) => ({ seq: s.seq || i + 1, name: s.name || ('Shot ' + (i + 1)) }));
    }
    return [
      { seq: 1, name: 'Hero Shot - Front' },
      { seq: 2, name: 'Hero Shot - Angle' },
      { seq: 3, name: 'Lifestyle Shot' },
      { seq: 4, name: 'Detail Shot' }
    ];
  }

  function isLifestyleShot(name) {
    return /lifestyle/i.test(name || '');
  }

  function searchQuery() {
    const q = state.search.trim().toLowerCase();
    return /^[\d\s]+$/.test(q) ? q.replace(/\s+/g, '') : q;
  }

  function matchesFilters(t) {
    if (state.category && t.category !== state.category) return false;
    if (state.template && t.template !== state.template) return false;
    if (state.view === 'available') {
      if (state.setKind && !(state.setKind === 'set' ? isSet(t) : t.setKind === state.setKind)) return false;
      if (artistFilterName() && !taskFitsArtist(t, artistFilterName())) return false;
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
    return !!(state.category || state.template ||
      (state.view === 'available' && (state.setKind || state.artist)));
  }

  // When a search finds nothing, says why each matching product is not listed.
  function searchMissHtml(q) {
    const m = state.model;
    const hits = m.products.filter((p) => p.search.includes(q)).slice(0, 8);
    if (!hits.length) return '<strong>No product matches "' + esc(state.search.trim()) + '"</strong>It is not in the Shoot Tracker tabs that were read.';
    const lines = hits.map((p) => {
      const artist = assignedArtist(p.ean);
      const why = p.hiddenReason || (artist ? 'assigned to ' + artist + ' in the Render Tracker'
        : !matchesFilters(p) ? 'hidden by the filters above' : 'available');
      return '<span class="tp-state-line"><span class="tp-mono">' + esc(p.ean) + '</span> ' + esc(p.title) + ': ' + esc(why) + '</span>';
    });
    const clear = hits.some((p) => !p.hiddenReason && !assignedArtist(p.ean)) && hasFilters()
      ? '<div class="tp-state-actions"><button type="button" class="tp-btn tp-btn-ghost" data-clear-filters>Clear filters</button></div>' : '';
    return '<strong>Not in the list</strong>' + lines.join('') + clear;
  }

  // Per Shoot Tracker tab: how many products pass each listing rule, so a low count can be traced to one rule.
  function dataCheckHtml() {
    const m = state.model;
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
      if (badTpl) notes.push(cat + ': ' + badTpl + ' template mappings without a T-number');
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
      (!state.template || p.template === state.template) &&
      (!state.setKind || (state.setKind === 'set' ? isSet(p) : p.setKind === state.setKind)));
    if (!fits.length) return '<span class="tp-state-line">No product in the Shoot Tracker fits these filters.</span>';
    const counts = new Map();
    fits.forEach((p) => {
      const why = !p.hiddenReason
        ? 'hidden by the Artist filter'
        : /^already assigned/.test(p.hiddenReason) ? 'already assigned in the Render Tracker'
        : /^GDRIVE cell/.test(p.hiddenReason) || /^no GDRIVE/.test(p.hiddenReason) ? 'no readable GDRIVE folder link'
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

  function compareTasks(a, b) {
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

  // subTemplate: Sub-category + Template, productTemplate: Product name + Template, template: Template only.
  // My Tasks has no group/sort controls, so it always uses Sub-category + Template, oldest first.
  function groupTasks(tasks) {
    const by = state.view === 'my' ? 'subTemplate' : state.groupBy;
    const groups = new Map();
    tasks.forEach((t) => {
      const key = by === 'template' ? t.template
        : by === 'productTemplate' ? t.productKey + '|' + t.template
        : t.subKey + '|' + t.template;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          template: t.template,
          subCategory: by === 'template' || by === 'productTemplate' ? '' : t.subCategory,
          subKey: by === 'template' || by === 'productTemplate' ? '' : t.subKey,
          productName: by === 'productTemplate' ? t.productName : '',
          productKey: by === 'productTemplate' ? t.productKey : '',
          tasks: []
        });
      }
      groups.get(key).tasks.push(t);
    });
    const list = [...groups.values()];
    list.forEach((g) => g.tasks.sort(compareTasks));
    list.sort((a, b) => {
      if (!a.template !== !b.template) return a.template ? -1 : 1;
      return compareTasks(a.tasks[0], b.tasks[0]) || templateOrder(a.template) - templateOrder(b.template);
    });
    return list;
  }

  /* ---------- Rendering ---------- */

  function setView(view, opts) {
    opts = opts || {};
    if (view !== 'renamer' && view !== 'available' && view !== 'my') return;
    if (view === 'my' && !state.author) {
      withAuthor(() => setView('my', opts));
      return;
    }
    closeWorkspace();
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
    const title = view === 'renamer' ? 'Renamer' : view === 'my' ? 'My Tasks' : 'Available Tasks';
    document.title = title + ' · 3D Playground (BETA V1.2)';
    const titleEl = $('view-title');
    if (titleEl) titleEl.textContent = title;
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
    const groupBy = isMy ? 'subTemplate' : state.groupBy;
    const suggestions = isMy ? [] : suggestionsFor(g.template, groupBy === 'template' ? '' : (g.subKey || g.tasks[0].subKey));
    const tpl = g.template || '—';
    const name = groupBy === 'template' ? 'Template ' + g.template
      : groupBy === 'productTemplate' ? (g.productName || 'Unnamed product')
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
    const suggestHtml = isMy ? '' : (suggestions.length
      ? '<span class="tp-suggest" title="' + esc(tip) + '">Suggested: ' +
        shown.map((s) => '<span class="tp-suggest-person"><span class="tp-mini-avatar">' + esc(initials(s.name)) + '</span><b>' + esc(s.name) + '</b></span>').join('') +
        (suggestions.length > shown.length ? '<span class="tp-suggest-more">+' + (suggestions.length - shown.length) + '</span>' : '') +
        '</span>'
      : '<span class="tp-suggest tp-suggest-none" title="Nobody has done this template or sub-category yet, so it is open to everyone">Open to anyone</span>');
    const pickAllHtml = (!isMy && canAssignTasks())
      ? '<div class="tp-split">' +
          '<button type="button" class="tp-split-main" data-action="pick-all">Assign to</button>' +
          '<button type="button" class="tp-split-caret" data-action="assign-all-menu" aria-label="Assign to..." aria-haspopup="menu">' + ICON.caret + '</button>' +
        '</div>'
      : '';
    return '<section class="tp-group ' + colour + (collapsed ? ' is-collapsed' : '') + '" data-key="' + esc(g.key) + '">' +
      '<header class="tp-group-head">' +
        '<button type="button" class="tp-chevron" data-action="toggle-group" aria-expanded="' + !collapsed + '" aria-label="Collapse group">' + ICON.chevron + '</button>' +
        templateThumb(g.template) +
        '<span class="tp-tpl-chip">' + esc(tpl) + '</span>' +
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
    const img = TEMPLATE_IMAGES[template];
    return '<span class="tp-tpl-thumb">' + (img ? '<img src="' + esc(img) + '" alt="">' : esc(template || '—')) + '</span>';
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
        ? '<div class="tp-split">' +
            '<button type="button" class="tp-split-main" data-action="pick">Assign</button>' +
            '<button type="button" class="tp-split-caret" data-action="assign-menu" aria-label="Assign to..." aria-haspopup="menu">' + ICON.caret + '</button>' +
          '</div>'
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
    return '<div class="tp-row ' + t.colour + (isMy ? ' is-mine' : '') + (done ? ' is-completed-row' : '') + '" data-ean="' + esc(t.ean) + '" tabindex="0" role="button" aria-label="' + esc(t.title + ', EAN ' + t.ean) + '">' +
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
      '<span class="tp-pill' + (!t.setLabel ? ' tp-pill-empty' : t.setKind ? ' is-' + t.setKind : '') + '">' + esc(t.setLabel || '—') + '</span>' +
      '<span class="tp-shots" data-tip="' + esc(tip) + '">' + ICON.camera + (t.shots ? t.shots.length : 0) + ' shots</span>' +
      '<span class="tp-tpl-code' + (t.template ? '' : ' is-empty') + '">' + esc(t.template || '—') + '</span>' +
      (isMy ? statusHtml + actions : actions) +
    '</div>';
  }

  function imagesOf(t) {
    const id = previewFolderId(t);
    const list = id ? state.images[id] : null;
    return Array.isArray(list) ? list : null;
  }

  function thumbHtml(t) {
    const list = imagesOf(t);
    const preferFirst = useOutputPreview(t);
    const img = list && list.length
      ? '<img class="tp-img" src="' + esc(thumbUrl(list[defaultPhoto(list, preferFirst)], 160)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '';
    return '<div class="tp-thumb" aria-hidden="true"><span>' + esc(initials(t.productName || t.title)) + '</span>' + img + '</div>';
  }

  function photoHtml(t) {
    const folderId = previewFolderId(t);
    const list = imagesOf(t);
    const status = folderId ? state.images[folderId] : null;
    const preferFirst = useOutputPreview(t);
    if (list && list.length) {
      const i = state.photoIndex < 0 ? defaultPhoto(list, preferFirst) : Math.min(state.photoIndex, list.length - 1);
      const main = list[i];
      const strip = list.length > 1
        ? '<div class="tp-photo-strip">' + list.map((p, n) =>
            '<button type="button" class="tp-photo-pick' + (n === i ? ' is-active' : '') + '" data-photo="' + n + '" title="' + esc(p.name) + '">' +
              '<img class="tp-img" src="' + esc(thumbUrl(p, 120)) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></button>').join('') +
          '</div>'
        : '';
      return '<a class="tp-photo has-img" href="https://drive.google.com/file/d/' + esc(encodeURIComponent(main.id)) + '/view" target="_blank" rel="noopener" title="' + esc(main.name) + ' (opens in Drive)">' +
          '<div class="tp-photo-initials">' + esc(initials(t.productName || t.title)) + '</div>' +
          '<img class="tp-img" src="' + esc(thumbUrl(main, 800)) + '" alt="' + esc(main.name) + '" referrerpolicy="no-referrer">' +
          '<span class="tp-photo-count">' + (i + 1) + ' / ' + list.length + '</span>' +
        '</a>' + strip;
    }
    const note = !folderId
      ? (useOutputPreview(t) ? 'No output Drive folder on the Render Tracker' : 'No Drive folder link for this product')
      : status === 'loading' || status === undefined ? 'Loading photos from Drive…'
      : status === 'error' ? 'Photos could not be loaded from Drive'
      : 'No photos in the Drive folder yet';
    return '<div class="tp-photo"><div class="tp-photo-initials">' + esc(initials(t.productName || t.title)) + '</div>' +
      '<span class="tp-photo-note">' + esc(note) + '</span></div>';
  }

  // Lists the images in each task's Drive folder, the selected task first, in batches.
  let imagesRunning = false;
  async function loadImages() {
    if (imagesRunning || !state.model) return;
    imagesRunning = true;
    try {
      const selected = state.selectedEan ? taskByEan(state.selectedEan) : null;
      const order = (selected ? [selected] : []).concat(visibleTasks());
      const matchIds = (state.workspace && state.workspace.mode === 'choose' && selected)
        ? priorMatches(selected).map((m) => m.folderId)
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
        const ean = btn.dataset.wsMatch;
        const t = taskByEan(ean);
        const folderId = t ? outputFolderIdOf(t) : '';
        if (!folderId || !changed.has(folderId)) return;
        const slot = btn.querySelector('.tw-match-thumb');
        if (!slot) return;
        const list = state.images[folderId];
        if (!Array.isArray(list) || !list.length) return;
        slot.innerHTML = '<img class="tp-img" src="' + esc(thumbUrl(list[0], 160)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
      });
      const wsTask = state.workspace && taskByEan(state.workspace.ean);
      if (wsTask && changed.has(previewFolderId(wsTask))) {
        const topThumb = els.workspace.querySelector('.tw-top-thumb');
        if (topThumb) {
          topThumb.innerHTML = thumbHtml(wsTask).replace('class="tp-thumb"', 'class="tp-thumb tw-top-thumb-inner"');
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
    const crumb = [t.department, t.sheetCategory, t.subCategory].filter(Boolean).join(' > ');
    const kv = [
      ['EAN code', t.ean, true],
      ['Set / PCs', t.setLabel],
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
    const prop = t.propsNeeded && propBody
      ? '<div class="tp-prop"><div class="tp-prop-head">' + ICON.prop + '<span>Functional prop</span></div>' +
        propBody + '</div>'
      : '';

    const tplImg = TEMPLATE_IMAGES[t.template];
    const tplBody = tplImg
      ? '<img src="' + esc(tplImg) + '" alt="Template ' + esc(t.template) + ' reference">'
      : (t.template ? 'No reference image mapped for ' + esc(t.template) + ' yet.' : 'No template mapped for this product.');

    const shotCount = t.shots ? t.shots.length : 0;
    const shots = shotCount
      ? '<ol class="tp-shot-list">' + t.shots.map((s) => '<li>' + esc(s.name) + '</li>').join('') + '</ol>'
      : '<p class="tp-empty-note">No mandatory shot list in the Shoot Tracker.</p>';
    const pdpRef = t.pdpLink ? '<a href="' + esc(t.pdpLink) + '" target="_blank" rel="noopener">PDP</a>' : 'PDP';
    const shotNotes = '<ul class="tp-shot-warn">' +
      '<li>' + ICON.warning + '<span>Always refer to the ' + pdpRef + ' for the final shot list.</span></li>' +
      (isSet(t) ? '<li>' + ICON.warning + '<span>Marked as <b>' + esc(t.setLabel) + '</b> in the Shoot Tracker, so the ' + pdpRef +
        ' should show a set. If it does not, confirm before working: the sheet may have a data error.</span></li>' : '') +
      '</ul>';

    const drive = t.driveLink
      ? linkHtml(t.driveLink, 'tp-link-folder', ICON.folder, 'Shoot folder', '')
      : linkHtml('', 'tp-link-folder', ICON.folder, 'Shoot folder', t.driveText ? 'Link not included in this export' : 'Not available');
    const pdp = linkHtml(t.pdpLink, 'tp-link-slides', ICON.slides, 'PDP guideline', t.pdpLink ? '' : 'Not available');
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
      '<div>' +
        '<div class="tp-section-head"><span class="tp-section-title">Template Reference</span>' +
          (t.template ? '<span class="tp-tpl-badge">' + esc(t.template) + '</span>' : '') + '</div>' +
        '<div class="tp-tpl-ref">' + tplBody + '</div>' +
      '</div>' +
      '<div><div class="tp-section-head"><span class="tp-section-title">Required Shots' + (shotCount ? ' (' + shotCount + ')' : '') + '</span>' +
        '<a class="tp-section-link" href="' + esc(NAMING_SHEET_URL) + '" target="_blank" rel="noopener" title="Open Naming Convention Shot List">Find shot codes' + ICON.external + '</a></div>' +
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
    els.category.innerHTML = '<option value="">All categories</option>' +
      m.categories.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    const open = new Map();
    poolTasks().forEach((t) => open.set(t.template, (open.get(t.template) || 0) + 1));
    const templates = [...open.keys()].sort((a, b) => templateOrder(a) - templateOrder(b));
    const countLabel = state.view === 'my' ? ' mine' : ' open';
    els.template.innerHTML = '<option value="">All Templates</option>' +
      templates.map((t) => '<option value="' + esc(t) + '">' + esc(t) + ' · ' + open.get(t) + countLabel + '</option>').join('');
    els.category.value = m.categories.includes(state.category) ? state.category : '';
    els.template.value = templates.includes(state.template) ? state.template : '';
    state.category = els.category.value;
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

  function renderSource(data) {
    const pill = els.sourcePill;
    const times = data.shoot.map((s) => s.modified).filter(Boolean).map((m) => new Date(m));
    const latest = times.length ? new Date(Math.max.apply(null, times)) : null;
    pill.hidden = false;
    pill.className = 'tp-source ' + (data.warnings.length ? 'is-local' : 'is-live');
    pill.textContent = 'Live sheets';
    pill.title = 'Reads Shoot Tracker and Render Tracker. Assign appends Artist rows on the live Render Tracker; ' +
      'other users see it within about ' + Math.round(ASSIGN_POLL_MS / 1000) + ' seconds.' +
      (latest ? '\nShoot Tracker last saved: ' + latest.toLocaleString() : '') +
      (data.warnings.length ? '\n\nNot loaded: ' + data.warnings.join('; ') : '');
  }

  function renderUser() {
    $('user-name').textContent = state.author || '—';
  }

  /* ---------- My Tasks workspace (UI mock only — no save / upload) ---------- */

  function openWorkspace(mode, ean) {
    state.workspace = { mode: mode || 'choose', ean: ean };
    state.workspaceShot = 0;
    state.selectedEan = ean;
    document.body.classList.add('view-workspace');
    if (els.workspace) els.workspace.hidden = false;
    renderDrawer(null);
    renderWorkspace();
    loadImages();
    window.scrollTo(0, 0);
  }

  function closeWorkspace() {
    state.workspace = null;
    state.workspaceShot = 0;
    document.body.classList.remove('view-workspace');
    if (els.workspace) {
      els.workspace.hidden = true;
      els.workspace.innerHTML = '';
    }
  }

  function renderWorkspace() {
    if (!els.workspace || !state.workspace) return;
    const t = taskByEan(state.workspace.ean);
    if (!t) {
      closeWorkspace();
      render();
      return;
    }
    const mode = state.workspace.mode;
    els.workspace.innerHTML = mode === 'primary' ? workspacePrimaryHtml(t)
      : mode === 'replace' ? workspaceReplaceHtml(t)
      : workspaceChooseHtml(t);
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
    const matches = priorMatches(t);
    const preferReplace = recommendReplace(t);
    const matchHtml = matches.length
      ? '<div class="tw-match-list">' + matches.map((m) =>
          '<button type="button" class="tw-match" data-ws-match="' + esc(m.ean) + '">' +
            '<div class="tw-match-thumb" data-folder="' + esc(m.folderId || '') + '">' + matchThumbHtml(m) + '</div>' +
            '<div class="tw-match-body">' +
              '<div class="tw-match-title">' + esc(m.title) + '</div>' +
              '<div class="tw-match-meta">EAN <span class="tp-mono">' + eanHtml(m.ean) +
                '<span class="tp-copy" data-action="copy-match" data-ean="' + esc(m.ean) + '" title="Copy EAN" aria-label="Copy EAN">' + ICON.copy + '</span></span>' +
                (m.artist ? ' · by ' + esc(m.artist) : '') + '</div>' +
              '<span class="tw-match-level' + (m.best ? ' is-best' : '') + '">' +
                (m.best ? 'Best match · ' : '') + esc(m.label) + '</span>' +
            '</div>' +
            '<div class="tw-match-links">' +
              (m.drive
                ? '<a href="' + esc(m.drive) + '" target="_blank" rel="noopener" data-action="output">Output folder</a>'
                : '<span class="tw-empty-matches">No output link</span>') +
            '</div>' +
          '</button>').join('') + '</div>'
      : '<p class="tw-empty-matches">No Completed work on the Render Tracker matches this Sub-category + Template yet. Primary workflow is recommended.</p>';

    return '<div class="tw-shell">' +
      workspaceTopHtml(t, 'Choose workflow', 'close') +
      '<div class="tw-note-banner">UI mock — nothing is saved. Pick how you want to start this task.</div>' +
      '<div class="tw-card">' +
        '<div class="tw-card-head">' +
          '<div><div class="tw-card-title">How do you want to work this task?</div>' +
          '<div class="tw-card-note">Based on earlier Sub-category + Template / Product + Template / Template work.</div></div>' +
        '</div>' +
        '<div class="tw-card-body">' +
          '<div class="tw-flow-grid">' +
            '<button type="button" class="tw-flow-opt' + (preferReplace ? ' is-recommended' : '') + '" data-ws="start-replace">' +
              (preferReplace ? '<span class="tw-rec-badge">Recommended</span>' : '') +
              '<div class="tw-flow-name">Product Replacement</div>' +
              '<p class="tw-flow-desc">Use when someone already completed a similar Sub-category + Template (or a close Product / Template match). Map each required shot to the new product images one-to-one.</p>' +
              '<ol class="tw-flow-steps">' +
                '<li>Review the best prior outputs</li>' +
                '<li>Map each shot to new product inputs</li>' +
                '<li>Generate / refine per shot</li>' +
              '</ol>' +
            '</button>' +
            '<button type="button" class="tw-flow-opt' + (!preferReplace ? ' is-recommended' : '') + '" data-ws="start-primary">' +
              (!preferReplace ? '<span class="tw-rec-badge">Recommended</span>' : '') +
              '<div class="tw-flow-name">Primary workflow</div>' +
              '<p class="tw-flow-desc">Use for a new Sub-category + Template type. Needs a Template clean plate first, then prompts and input images for every required shot.</p>' +
              '<ol class="tw-flow-steps">' +
                '<li>Find or create the clean plate</li>' +
                '<li>Work each shot with a saved prompt</li>' +
                '<li>Attach input image names used</li>' +
              '</ol>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tw-card">' +
        '<div class="tw-card-head">' +
          '<div><div class="tw-card-title">Possible previous matches</div>' +
          '<div class="tw-card-note">Best match first. Open Drive links to reuse prior outputs.</div></div>' +
        '</div>' +
        '<div class="tw-card-body">' + matchHtml + '</div>' +
      '</div>' +
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

  function workspacePrimaryHtml(t) {
    const shots = shotListFor(t);
    const i = Math.min(state.workspaceShot, Math.max(0, shots.length - 1));
    const shot = shots[i] || shots[0];
    const multi = isLifestyleShot(shot && shot.name);
    const hasPlate = !!(t.template && Number(String(t.ean || '0').slice(-1)) % 2 === 0);

    return '<div class="tw-shell">' +
      workspaceTopHtml(t, 'Primary workflow', 'choose') +
      '<div class="tw-note-banner">UI mock — prompts and drops are not saved.</div>' +
      '<div class="tw-card" style="margin-bottom:16px">' +
        '<div class="tw-card-head"><div class="tw-card-title">1. Template clean plate</div>' +
          '<div class="tw-card-note">Required before shot work when this template type is new.</div></div>' +
        '<div class="tw-card-body">' +
          '<div class="tw-plate">' +
            '<div class="tw-plate-preview' + (hasPlate ? ' has-img' : '') + '">' +
              (hasPlate ? 'Clean plate<br>available' : 'No clean plate yet') +
            '</div>' +
            '<div>' +
              '<div class="tw-plate-title">' +
                (hasPlate
                  ? 'Reuse existing clean plate for ' + esc(t.template || 'this template')
                  : 'Create clean plate from the template image') +
              '</div>' +
              '<p class="tw-plate-desc">' +
                (hasPlate
                  ? 'Another EAN already produced a clean plate for this template. Open it from Drive, or continue with the shots below.'
                  : 'Nobody has created a clean plate for this template yet. Build it from the template reference as the first step.') +
              '</p>' +
              '<div class="tw-plate-actions">' +
                '<button type="button" class="tp-btn tp-btn-ghost" data-ws="noop">Open clean plate folder</button>' +
                '<button type="button" class="tp-btn ' + (hasPlate ? 'tp-btn-ghost' : 'tp-btn-primary') + '" data-ws="noop">' +
                  (hasPlate ? 'Replace clean plate' : 'Create clean plate') + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tw-layout">' +
        workspaceShotNavHtml(t, shots, i) +
        '<div class="tw-card">' +
          '<div class="tw-card-head">' +
            '<div><div class="tw-card-title">2. Shot · ' + esc(shot.name) + '</div>' +
            '<div class="tw-card-note">Save the prompt when the result looks perfect. Attach the input image names used for this shot.</div></div>' +
          '</div>' +
          '<div class="tw-card-body">' +
            '<div class="tw-field">' +
              '<label class="tw-field-label" for="tw-prompt">Prompt used for this shot</label>' +
              '<textarea id="tw-prompt" class="tw-prompt" placeholder="Paste the prompt that produced the final image…"></textarea>' +
            '</div>' +
            '<div class="tw-field">' +
              '<span class="tw-field-label">Input images for this shot</span>' +
              dropzoneHtml({
                id: 'primary-' + i,
                multi: multi,
                title: multi ? 'Drop reference + product images' : 'Drop input image',
                hint: multi
                  ? 'Lifestyle often needs more than one (e.g. reference + product)'
                  : 'Usually one image, e.g. Hero Shot - Front',
                samples: multi ? ['ref_lifestyle_01.jpg', 'product_front.png'] : ['product_front.png']
              }) +
            '</div>' +
            '<div class="tw-foot-actions">' +
              '<button type="button" class="tp-btn tp-btn-ghost" data-ws="noop">Mark shot blocked</button>' +
              '<button type="button" class="tp-btn tp-btn-primary" data-ws="noop">Save shot (UI only)</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function workspaceReplaceHtml(t) {
    const shots = shotListFor(t);
    const matches = priorMatches(t);
    const best = matches.find((m) => m.best) || matches[0];
    const rows = shots.map((s, i) => {
      const multi = isLifestyleShot(s.name);
      return '<div class="tw-map-row">' +
        '<div class="tw-map-side">' +
          '<span class="tw-map-label">Prior output</span>' +
          '<div class="tw-map-shot-name">' + esc(s.name) + '</div>' +
          '<div class="tw-ref-strip">' +
            '<div class="tw-ref"><div class="tw-ref-img">Prior</div><div class="tw-ref-cap">' + esc(s.name) + '</div></div>' +
            (best ? '<div class="tw-ref"><div class="tw-ref-img">Drive</div><div class="tw-ref-cap">' + esc(best.ean) + '</div></div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="tw-map-arrow" aria-hidden="true">→</div>' +
        '<div class="tw-map-side">' +
          '<span class="tw-map-label">New product input</span>' +
          '<div class="tw-map-shot-name">' + esc(s.name) + '</div>' +
          dropzoneHtml({
            id: 'replace-' + i,
            multi: multi,
            title: multi ? 'Drop new product images' : 'Drop new product shot',
            hint: multi ? 'Rarely more than one · e.g. front + prop' : 'One-to-one with the prior shot',
            samples: multi ? ['new_front.png', 'new_prop.png'] : ['new_front.png']
          }) +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="tw-shell">' +
      workspaceTopHtml(t, 'Product Replacement', 'choose') +
      '<div class="tw-note-banner">UI mock — mapping is not saved. Use prior Drive outputs as reference.</div>' +
      (best
        ? '<div class="tw-card" style="margin-bottom:16px">' +
            '<div class="tw-card-head"><div class="tw-card-title">Best prior match</div></div>' +
            '<div class="tw-card-body">' +
              '<button type="button" class="tw-match" data-ws-match="' + esc(best.ean) + '">' +
                '<div class="tw-match-thumb" data-folder="' + esc(best.folderId || '') + '">' + matchThumbHtml(best) + '</div>' +
                '<div class="tw-match-body">' +
                  '<div class="tw-match-title">' + esc(best.title) + '</div>' +
                  '<div class="tw-match-meta">EAN <span class="tp-mono">' + eanHtml(best.ean) +
                    '<span class="tp-copy" data-action="copy-match" data-ean="' + esc(best.ean) + '" title="Copy EAN" aria-label="Copy EAN">' + ICON.copy + '</span></span>' +
                    (best.artist ? ' · by ' + esc(best.artist) : '') + '</div>' +
                  '<span class="tw-match-level is-best">Best match · ' + esc(best.label) + '</span>' +
                '</div>' +
                '<div class="tw-match-links">' +
                  (best.drive
                    ? '<a href="' + esc(best.drive) + '" target="_blank" rel="noopener" data-action="output">Output folder</a>'
                    : '<span class="tw-empty-matches">No output link</span>') +
                '</div>' +
              '</button>' +
            '</div>' +
          '</div>'
        : '') +
      '<div class="tw-card">' +
        '<div class="tw-card-head">' +
          '<div><div class="tw-card-title">One-to-one shot mapping</div>' +
          '<div class="tw-card-note">Map each required shot from the prior work to the new product images.</div></div>' +
        '</div>' +
        '<div class="tw-card-body">' + rows +
          '<div class="tw-foot-actions">' +
            '<button type="button" class="tp-btn tp-btn-ghost" data-ws="noop">Mark blocked</button>' +
            '<button type="button" class="tp-btn tp-btn-primary" data-ws="noop">Save mapping (UI only)</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- Assign menu ---------- */

  function openMenu(anchor, eans, suggestion) {
    const artists = state.model.artists.slice();
    if (suggestion && !artists.includes(suggestion.name)) artists.unshift(suggestion.name);
    const ordered = suggestion ? [suggestion.name].concat(artists.filter((a) => a !== suggestion.name)) : artists;
    els.menu.innerHTML = '<div class="tp-menu-label">Assign to...</div>' + ordered.map((name) => {
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
  function showToast(html, undoable) {
    els.toastText.innerHTML = html;
    els.toastUndo.hidden = !undoable;
    els.toast.hidden = false;
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }

  function hideToast() {
    els.toast.hidden = true;
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
    if (action === 'pick-all') {
      if (!canAssignTasks()) return;
      const info = groupSuggestion(groupOf(actionEl));
      if (info) pickForMe(info.group.tasks.map((t) => t.ean));
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
    if (action === 'pick') {
      if (!canAssignTasks()) return;
      pickForMe([ean]);
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
    const pick = e.target.closest('[data-photo]');
    if (!pick) return;
    state.photoIndex = Number(pick.dataset.photo);
    els.drawerBody.querySelector('.tp-photo-wrap').innerHTML = photoHtml(taskByEan(state.selectedEan));
  });

  // A thumbnail that fails (no access, or a file type Drive can't preview) falls back to the initials behind it.
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('tp-img')) e.target.remove();
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
    if (!els.nameModal.hidden) closeNameModal();
    else if (!els.menu.hidden) closeMenu();
    else if (!els.settingsMenu.hidden) closeSettings();
    else if (state.workspace) {
      if (state.workspace.mode === 'choose') { closeWorkspace(); render(); }
      else { state.workspace.mode = 'choose'; renderWorkspace(); }
    }
  });

  function closeSettings() {
    els.settingsMenu.hidden = true;
    els.settingsBtn.setAttribute('aria-expanded', 'false');
  }

  window.addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('resize', closeMenu);

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
      document.querySelectorAll('.tp-seg [data-group]').forEach((b) => b.classList.toggle('is-active', b === btn));
      render();
    });
  });

  els.toastUndo.addEventListener('click', hideToast);
  $('toast-close').addEventListener('click', hideToast);

  window.addEventListener('hashchange', () => {
    const v = hashView() || 'available';
    if (v !== state.view) setView(v, { syncHash: false });
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

  if (els.workspace) {
    els.workspace.addEventListener('click', (e) => {
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
      const matchBtn = e.target.closest('[data-ws-match]');
      if (matchBtn) {
        const ean = matchBtn.dataset.wsMatch;
        const existing = taskByEan(ean);
        const drive = ((matchBtn.querySelector('.tw-match-links a') || {}).href) || '';
        const stub = existing || {
          ean: ean,
          title: (matchBtn.querySelector('.tw-match-title') || {}).textContent || ean,
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
        return;
      }
      const shotBtn = e.target.closest('[data-ws-shot]');
      if (shotBtn) {
        state.workspaceShot = Number(shotBtn.dataset.wsShot) || 0;
        renderWorkspace();
        return;
      }
      const actionEl = e.target.closest('[data-ws]');
      if (!actionEl) return;
      const action = actionEl.dataset.ws;
      if (action === 'close') { closeWorkspace(); render(); return; }
      if (action === 'choose' && state.workspace) {
        state.workspace.mode = 'choose';
        renderWorkspace();
        window.scrollTo(0, 0);
        return;
      }
      if (action === 'start-primary' && state.workspace) {
        state.workspace.mode = 'primary';
        state.workspaceShot = 0;
        renderWorkspace();
        window.scrollTo(0, 0);
        return;
      }
      if (action === 'start-replace' && state.workspace) {
        state.workspace.mode = 'replace';
        state.workspaceShot = 0;
        renderWorkspace();
        window.scrollTo(0, 0);
        return;
      }
      if (action === 'noop') {
        showToast('UI mock only — this action is not wired yet.', false);
      }
    });
  }

  els.settingsBtn.addEventListener('click', () => {
    const open = els.settingsMenu.hidden;
    els.settingsMenu.hidden = !open;
    els.settingsBtn.setAttribute('aria-expanded', String(open));
  });
  $('menu-author').addEventListener('click', () => { closeSettings(); openNameModal(); });
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
  async function load() {
    if (loading) return;
    loading = true;
    els.updated.textContent = 'Loading…';
    if (!state.model) {
      els.list.innerHTML = '<div class="tp-state"><span class="tp-spinner"></span>Reading the live sheets… the first load can take up to a minute.</div>';
    }
    try {
      const data = await loadTaskData();
      state.model = buildModel(data);
      state.loadedAt = Date.now();
      renderSource(data);
      fillFilters();
      updateTimestamp();
      render();
      if (data.warnings.length) showToast('Some tabs could not be read: ' + esc(data.warnings.join('; ')), false);
      loadImages();
    } catch (err) {
      console.error(err);
      if (state.model) {
        updateTimestamp();
        showToast('Refresh failed: ' + esc(err.message === 'NO_ACCESS' ? 'could not reach the sheet reader.' : err.message) + ' Showing the last loaded data.', false);
      } else {
        els.updated.textContent = 'Not loaded';
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
  {
    // No hash → #renamer so the live index.html URL opens Renamer (same as before V1.2).
    const initial = hashView() || 'renamer';
    setView(initial, { syncHash: !hashView(), replace: true });
  }
  setInterval(updateTimestamp, 30000);
  // Poll only while the tab is visible so background tabs do not burn Sheets quota.
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshAssigns();
  }, ASSIGN_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAssigns();
  });
  load();
})();
