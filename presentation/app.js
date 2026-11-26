/**
 * Presentation Board — sheet feed + Classic / 3D (PDP) views.
 * Deep link: ?sub=<slug>  (also accepts #sub=<slug> / #crockery-units)
 */

var VIEW_KEY = "presentationViewMode";
var boards = [];
var activeIndex = 0;
var selectedImageIndex = 0;
var viewMode = "classic";
var lastModified = "";
var pollTimer = null;
var jsonpSeq = 0;
var requestedSlug = "";
/** hostname → brand from TITLE (once set, reused for all same-host URLs). */
var domainTitles = {};
var authPopup = null;
var authWatch = null;
var authBusy = false;
var authTarget = "board";
/** Both must succeed before any shots render (empty > wrong / partial). */
var boardFeedOk = false;
var categoriesFeedOk = false;
/** True after categories nav succeeds or fails (not while the first request is in flight). */
var categoriesSettled = false;

function cleanMasterTitle(text) {
  return String(text || "")
    .replace(/\s*[-–—]\s*PDP Page\s*\|\s*Shared Images\s*\|\s*Our Recommendation\s*/gi, "")
    .replace(/\s*PDP Page\s*\|\s*Shared Images\s*\|\s*Our Recommendation\s*/gi, "")
    .trim();
}

/** Human-readable → URL slug (spreadsheet-friendly). */
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function hostKey(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (err) {
    return "";
  }
}

/** Capitalize first letter of each word (e.g. wayfair → Wayfair). */
function prettyBrand(title) {
  var t = String(title || "").trim();
  if (!t) return "";
  return t.replace(/\S+/g, function (word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

function titleFromUrl(url) {
  if (!url) return "";
  try {
    var host = hostKey(url);
    if (!host) return "";
    if (host.indexOf("woodenstreet") >= 0) return "Wooden Street";
    if (host.indexOf("homecentre") >= 0 || host.indexOf("home-centre") >= 0) {
      return "Home center";
    }
    if (host.indexOf("landmarkshops") >= 0) return "Landmarkshops";
    var parts = host.split(".");
    var core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch (err) {
    return "";
  }
}

/**
 * Learn host → TITLE from any row that has both.
 * Later blank TITLE cells on the same CDN host reuse that brand.
 */
function rebuildDomainTitles(boardsList) {
  var map = {};
  (boardsList || []).forEach(function (board) {
    (board.images || []).forEach(function (img) {
      if (!img) return;
      var raw = String(img.title || "").trim();
      var url = String(img.url || "").trim();
      if (!raw || !url) return;
      var host = hostKey(url);
      if (!host || map[host]) return;
      map[host] = prettyBrand(raw);
    });
  });
  domainTitles = map;
}

/**
 * Prefer row TITLE → learned TITLE for this host → domain guess.
 */
function resolveBrand(item) {
  if (!item) return "";
  var raw = String(item.title || "").trim();
  if (raw) return prettyBrand(raw);
  var host = hostKey(item.url);
  if (host && domainTitles[host]) return domainTitles[host];
  return titleFromUrl(item.url) || "";
}

function gridClassForCount(n) {
  if (n <= 1) return "grid-1";
  if (n <= 2) return "grid-2";
  if (n <= 4) return "grid-4";
  return "grid-6";
}

function resolveImages(items) {
  return (items || []).map(function (item, i) {
    var url = typeof item === "string" ? item : (item && item.url) || "";
    var rawTitle =
      typeof item === "object" && item && item.title
        ? String(item.title).trim()
        : "";
    var sequence =
      (typeof item === "object" && item && item.sequence) || "";
    var resolved = {
      url: String(url || "").trim(),
      title: rawTitle,
      sequence: sequence,
      index: i
    };
    resolved.brand = resolveBrand(resolved);
    return resolved;
  });
}

function isVideoSequence(label) {
  return /\bvideo\b/i.test(String(label || ""));
}

/** Rank from presentation/shot-order.json. Unknown shots sort after the known ones. */
var shotOrderRank = {};

function shotOrderKey(label) {
  return String(label || "")
    .replace(/¾/g, "3/4")
    .replace(/½/g, "1/2")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shotRank(label) {
  var key = shotOrderKey(label);
  if (key && Object.prototype.hasOwnProperty.call(shotOrderRank, key)) return shotOrderRank[key];
  return 100000;
}

function sortByShotOrder(images) {
  return (images || [])
    .map(function (img, i) {
      return { img: img, i: i };
    })
    .sort(function (a, b) {
      var diff = shotRank(a.img.sequence) - shotRank(b.img.sequence);
      return diff || a.i - b.i;
    })
    .map(function (entry) {
      return entry.img;
    });
}

function loadShotOrder() {
  return fetch("shot-order.json")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      var list = (data && data.order) || [];
      list.forEach(function (item) {
        if (item && item.key) shotOrderRank[item.key] = item.rank;
      });
    })
    .catch(function () {});
}

function isGalleryItem(item) {
  return !!String((item && item.url) || "").trim() && !isVideoSequence(item.sequence);
}

/** Rail keys a sheet row belongs to: usp:<id>, custom:<id>, set, collection. */
function imageKeys(img) {
  var keys = [];
  if (!img) return keys;
  if (img.usp && img.usp.id) keys.push("usp:" + img.usp.id);
  if (img.custom && img.custom.id) keys.push("custom:" + img.custom.id);
  if (img.set) keys.push("set");
  if (img.collection) keys.push("collection");
  return keys;
}

/**
 * Rail options present on a board, in rail order (USP, Set, Collection, Custom).
 * An option carried by every row is "fixed": always applied, nothing to toggle.
 */
function boardOptions(board) {
  var images = (board && board.images) || [];
  var found = {};
  var order = [];
  images.forEach(function (img) {
    imageKeys(img).forEach(function (key) {
      if (!found[key]) {
        var param = key.split(":")[0];
        var tag = param === "usp" ? img.usp : param === "custom" ? img.custom : null;
        found[key] = {
          key: key,
          param: param,
          id: tag ? String(tag.id) : "1",
          label: railLabel(param, tag),
          count: 0
        };
        order.push(key);
      }
      found[key].count += 1;
    });
  });
  var rank = { usp: 0, set: 1, collection: 2, custom: 3 };
  return order
    .map(function (key) {
      var opt = found[key];
      opt.fixed = opt.count === images.length;
      return opt;
    })
    .sort(function (a, b) {
      return rank[a.param] - rank[b.param] || order.indexOf(a.key) - order.indexOf(b.key);
    });
}

/** USP and Custom read "1-Manual". Set and Collection are the word itself. */
function railLabel(param, tag) {
  if (param === "set") return "set";
  if (param === "collection") return "collection";
  var id = String((tag && tag.id) || "").trim();
  var text = String((tag && tag.label) || "").trim();
  if (text && text !== id) return id + "-" + text;
  return id || text;
}

/** null until the board feed has loaded (or when the sub-category has no board). */
function boardOptionsForSlug(slug) {
  var idx = findBoardIndexBySlug(slug);
  return idx < 0 ? null : boardOptions(boards[idx]);
}

function pickedModes() {
  var nav = window.presentationNav;
  return nav && nav.picked ? nav.picked() : {};
}

function feedsReady() {
  return boardFeedOk && categoriesFeedOk;
}

/** Untagged rows always show; a tagged row shows once all its rail options are on. */
function visibleImages(board) {
  if (!feedsReady()) return [];
  var picked = pickedModes();
  var fixed = {};
  boardOptions(board).forEach(function (opt) {
    if (opt.fixed) fixed[opt.key] = true;
  });
  return ((board && board.images) || []).filter(function (img) {
    return imageKeys(img).every(function (key) {
      return fixed[key] || picked[key];
    });
  });
}

function shotNumber(images, index) {
  var n = 0;
  var list = images || [];
  var last = Math.min(index, list.length - 1);
  for (var i = 0; i <= last; i++) {
    if (!isVideoSequence(list[i] && list[i].sequence)) n += 1;
  }
  return n || index + 1;
}

function shotLabelFor(item, index, images) {
  var n = images ? shotNumber(images, index) : index + 1;
  var name = (item && item.sequence) || "";
  if (name) return n + ". " + name;
  return String(n);
}

function brandLabelFor(item) {
  if (!item) return "";
  if (item.brand) return item.brand;
  return resolveBrand(item);
}

function readViewMode() {
  try {
    var v = localStorage.getItem(VIEW_KEY);
    if (v === "classic" || v === "pdp") return v;
  } catch (err) { /* ignore */ }
  return "classic";
}

function writeViewMode(mode) {
  viewMode = mode === "pdp" ? "pdp" : "classic";
  try {
    localStorage.setItem(VIEW_KEY, viewMode);
  } catch (err) { /* ignore */ }
  syncViewToggle();
  applyViewVisibility();
  showBoard();
}

function syncViewToggle() {
  var btns = document.querySelectorAll(".view-btn");
  btns.forEach(function (btn) {
    var on = btn.getAttribute("data-view") === viewMode;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function applyViewVisibility() {
  var boardEl = document.querySelector(".board");
  var grid = document.getElementById("imageGrid");
  var pdp = document.getElementById("pdpLayout");
  if (boardEl) {
    boardEl.classList.toggle("is-pdp", viewMode === "pdp");
    boardEl.classList.toggle("is-classic", viewMode !== "pdp");
  }
  if (!grid || !pdp) return;
  if (viewMode === "pdp") {
    grid.hidden = true;
    grid.setAttribute("aria-hidden", "true");
    pdp.hidden = false;
    pdp.removeAttribute("aria-hidden");
  } else {
    pdp.hidden = true;
    pdp.setAttribute("aria-hidden", "true");
    grid.hidden = false;
    grid.removeAttribute("aria-hidden");
  }
}

function parseRequestedSlug() {
  var params = new URLSearchParams(window.location.search);
  var sub = params.get("sub") || params.get("board") || params.get("c") || "";
  if (!sub && window.location.hash) {
    var h = window.location.hash.replace(/^#/, "");
    if (h.indexOf("=") >= 0) {
      var hp = new URLSearchParams(h);
      sub = hp.get("sub") || hp.get("board") || "";
    } else {
      sub = h;
    }
  }
  return slugify(sub);
}

function findBoardIndexBySlug(slug) {
  if (!slug) return -1;
  for (var i = 0; i < boards.length; i++) {
    var name = cleanMasterTitle(boards[i].subCategory);
    if (slugify(name) === slug || slugify(boards[i].subCategory) === slug) {
      return i;
    }
  }
  return -1;
}

function updateUrlForBoard(board) {
  if (!board) return;
  if (window.presentationNav && window.presentationNav.ownsUrl()) return;
  var slug = slugify(cleanMasterTitle(board.subCategory) || board.subCategory);
  if (!slug) return;
  var url = new URL(window.location.href);
  url.searchParams.set("sub", slug);
  url.hash = "";
  if (url.toString() !== window.location.href) {
    history.replaceState(null, "", url.pathname + url.search);
  }
}

function bindViewToggle() {
  var root = document.getElementById("viewToggle");
  if (!root) return;
  root.addEventListener("click", function (e) {
    var btn = e.target.closest(".view-btn");
    if (!btn) return;
    writeViewMode(btn.getAttribute("data-view"));
  });
}

function buildCard(item, index, images) {
  var card = document.createElement("div");
  card.className = "image-card";

  var shot = document.createElement("div");
  shot.className = "shot-label";
  shot.textContent = shotLabelFor(item, index, images) || "\u00A0";
  card.appendChild(shot);

  var frame = document.createElement("div");
  frame.className = "image-frame";

  var media = document.createElement("div");
  media.className = "image-media";
  var img = document.createElement("img");
  img.src = item.url;
  img.alt = brandLabelFor(item) || shotLabelFor(item, index, images);
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.onerror = function () {
    this.remove();
  };
  media.appendChild(img);
  frame.appendChild(media);

  var brand = brandLabelFor(item);
  if (brand) {
    var label = document.createElement("div");
    label.className = "image-label";
    label.textContent = brand;
    frame.appendChild(label);
  }

  card.appendChild(frame);
  return card;
}

function paintMissing(images) {
  var note = document.getElementById("dataMissing");
  if (!note) return;
  var missing = (images || []).filter(function (item) {
    return !String(item.url || "").trim() && !isVideoSequence(item.sequence);
  });
  if (!missing.length) {
    note.hidden = true;
    note.textContent = "";
    return;
  }
  var names = missing.map(function (item) {
    return item.sequence || "Untitled shot";
  });
  note.hidden = false;
  note.textContent = missing.length === (images || []).filter(function (item) {
    return !isVideoSequence(item.sequence);
  }).length
    ? "Data missing"
    : "Data missing: " + names.join(", ");
}

function renderClassic(images) {
  var grid = document.getElementById("imageGrid");
  var shown = [];
  images.forEach(function (item, i) {
    if (isGalleryItem(item)) shown.push({ item: item, index: i });
  });
  grid.className = "image-grid " + gridClassForCount(shown.length || 1);
  grid.innerHTML = "";
  if (!shown.length) grid.className = "image-grid";
  shown.forEach(function (entry) {
    grid.appendChild(buildCard(entry.item, entry.index, images));
  });
}

function renderPdp(images) {
  var thumbs = document.getElementById("pdpThumbs");
  var hero = document.getElementById("pdpHero");
  thumbs.innerHTML = "";
  hero.innerHTML = "";

  var shown = [];
  images.forEach(function (item, i) {
    if (isGalleryItem(item)) shown.push({ item: item, index: i });
  });
  if (!shown.length) return;

  var currentEntry = shown[0];
  for (var s = 0; s < shown.length; s++) {
    if (shown[s].index === selectedImageIndex) currentEntry = shown[s];
  }
  selectedImageIndex = currentEntry.index;

  shown.forEach(function (entry) {
    var item = entry.item;
    var i = entry.index;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pdp-thumb" + (i === selectedImageIndex ? " is-active" : "");
    btn.title = shotLabelFor(item, i, images);
    btn.setAttribute("aria-label", shotLabelFor(item, i, images));
    var img = document.createElement("img");
    img.src = item.url;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = function () {
      this.remove();
    };
    btn.appendChild(img);
    btn.addEventListener("click", function () {
      selectedImageIndex = i;
      renderBoard();
    });
    thumbs.appendChild(btn);
  });

  var current = currentEntry.item;
  var shot = document.createElement("div");
  shot.className = "pdp-hero-shot";
  shot.textContent = shotLabelFor(current, currentEntry.index, images);
  hero.appendChild(shot);

  var media = document.createElement("div");
  media.className = "pdp-hero-media";
  var himg = document.createElement("img");
  himg.src = current.url;
  himg.alt = brandLabelFor(current) || shotLabelFor(current, currentEntry.index, images);
  himg.referrerPolicy = "no-referrer";
  himg.onerror = function () {
    this.remove();
  };
  media.appendChild(himg);
  hero.appendChild(media);
}

var sequenceCopyText = "";

function setSequenceCopy(lines) {
  sequenceCopyText = (lines || []).join("\n");
  var btn = document.getElementById("sequenceCopy");
  if (!btn) return;
  btn.disabled = !sequenceCopyText;
  btn.classList.remove("is-copied");
  btn.setAttribute("aria-label", "Copy sequence");
  btn.title = "Copy sequence";
}

function copySequenceList() {
  if (!sequenceCopyText) return;
  var btn = document.getElementById("sequenceCopy");
  function done() {
    if (!btn) return;
    btn.classList.add("is-copied");
    btn.setAttribute("aria-label", "Copied");
    btn.title = "Copied";
    setTimeout(function () {
      if (!btn.classList.contains("is-copied")) return;
      btn.classList.remove("is-copied");
      btn.setAttribute("aria-label", "Copy sequence");
      btn.title = "Copy sequence";
    }, 1400);
  }
  function fallback() {
    var area = document.createElement("textarea");
    area.value = sequenceCopyText;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch (err) {}
    document.body.removeChild(area);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(sequenceCopyText).then(done, function () {
      fallback();
      done();
    });
    return;
  }
  fallback();
  done();
}

function bindSequenceCopy() {
  var btn = document.getElementById("sequenceCopy");
  if (!btn) return;
  btn.addEventListener("click", copySequenceList);
}

function renderSequence(board, images) {
  var list = document.getElementById("sequenceList");
  var videos = document.getElementById("sequenceVideos");
  list.innerHTML = "";
  if (videos) videos.innerHTML = "";

  var seqItems = [];
  var seen = {};
  images.forEach(function (img) {
    if (img.sequence && !seen[img.sequence]) {
      seen[img.sequence] = true;
      seqItems.push(img.sequence);
    }
  });

  var number = 0;
  var videoEntries = [];
  var copyLines = [];
  seqItems.forEach(function (label, i) {
    var matchIndex = -1;
    for (var j = 0; j < images.length; j++) {
      if (images[j].sequence === label) {
        matchIndex = j;
        break;
      }
    }
    if (matchIndex < 0) matchIndex = i;
    var image = images[matchIndex] || {};

    if (isVideoSequence(label)) {
      videoEntries.push({ label: label, image: image });
      return;
    }

    number += 1;
    copyLines.push(number + ". " + label);
    var li = document.createElement("li");
    if (viewMode === "pdp" && matchIndex === selectedImageIndex && isGalleryItem(image)) {
      li.className = "is-active";
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = number + ". " + label;
    btn.addEventListener("click", function () {
      if (!isGalleryItem(image)) return;
      selectedImageIndex = matchIndex;
      if (viewMode !== "pdp") writeViewMode("pdp");
      else renderBoard();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });

  videoEntries.forEach(function (entry) {
    if (!videos) return;
    var videoItem = document.createElement("li");
    var link = document.createElement(entry.image.url ? "a" : "span");
    link.className = "sequence-video";
    if (entry.image.url) {
      link.href = entry.image.url;
      link.target = "_blank";
      link.rel = "noopener";
    }
    link.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    var videoName = document.createElement("span");
    videoName.textContent = entry.image.url ? entry.label : entry.label + " — Data missing";
    link.appendChild(videoName);
    videoItem.appendChild(link);
    videos.appendChild(videoItem);
  });

  if (videos) videos.hidden = !videos.children.length;
  setSequenceCopy(copyLines);
}

function renderBoard() {
  var board = boards[activeIndex];
  if (!board) {
    showMissingBoard("No data");
    return;
  }

  document.getElementById("masterTitle").textContent =
    cleanMasterTitle(board.subCategory) || "—";

  var images = sortByShotOrder(resolveImages(visibleImages(board)));
  renderSequence(board, images);
  paintMissing(images);
  if (!images.length && (board.images || []).length) {
    var note = document.getElementById("dataMissing");
    note.hidden = false;
    note.textContent = "Pick an option on the left to see these shots.";
  }

  // Render only the active view — never both.
  if (viewMode === "pdp") {
    document.getElementById("imageGrid").innerHTML = "";
    renderPdp(images);
  } else {
    document.getElementById("pdpThumbs").innerHTML = "";
    document.getElementById("pdpHero").innerHTML = "";
    renderClassic(images);
  }

  applyViewVisibility();
}

function clearBoard() {
  document.getElementById("imageGrid").innerHTML = "";
  document.getElementById("pdpThumbs").innerHTML = "";
  document.getElementById("pdpHero").innerHTML = "";
  document.getElementById("sequenceList").innerHTML = "";
  setSequenceCopy([]);
  var videos = document.getElementById("sequenceVideos");
  if (videos) {
    videos.innerHTML = "";
    videos.hidden = true;
  }
  var note = document.getElementById("dataMissing");
  if (note) {
    note.hidden = true;
    note.textContent = "";
  }
}

function showMissingBoard(title) {
  clearBoard();
  document.getElementById("masterTitle").textContent = title || "Data missing";
  var note = document.getElementById("dataMissing");
  if (note) {
    note.hidden = false;
    note.textContent = "Data missing";
  }
}

/** Sub-category picked in the finder, else the ?sub= deep link until the finder takes over. */
function currentSlug() {
  var nav = window.presentationNav;
  var fromNav = nav && nav.subSlug();
  if (fromNav) return fromNav;
  return requestedSlug;
}

function setBoardEmpty(empty) {
  var boardEl = document.querySelector(".board");
  if (boardEl) boardEl.classList.toggle("is-empty", empty);
}

/** Nothing is shown until both feeds are allowed and a sub-category is chosen. */
function showBoard() {
  if (!feedsReady()) {
    clearBoard();
    setBoardEmpty(true);
    var title = document.getElementById("masterTitle");
    if (title) {
      if (!boardFeedOk || (categoriesSettled && !categoriesFeedOk)) {
        title.textContent = "Access needed";
      } else {
        title.textContent = "Loading…";
      }
    }
    return;
  }
  var slug = currentSlug();
  if (!slug) {
    clearBoard();
    setBoardEmpty(true);
    return;
  }
  if (!boards.length) return;
  setBoardEmpty(false);
  var idx = findBoardIndexBySlug(slug);
  if (idx < 0) {
    var nav = window.presentationNav;
    showMissingBoard((nav && nav.subName()) || slug);
    return;
  }
  if (idx !== activeIndex) {
    activeIndex = idx;
    selectedImageIndex = 0;
  }
  updateUrlForBoard(boards[idx]);
  renderBoard();
}

function applyFeed(data) {
  boards = (data && data.boards) || [];
  rebuildDomainTitles(boards);
  lastModified = (data && data.modified) || "";
  boardFeedOk = true;
  if (window.presentationNav) window.presentationNav.refresh();
  if (feedsReady()) hideAuthDialog();
  else if (categoriesSettled && !categoriesFeedOk) {
    requestSheetAccess(
      "categories",
      "Board is ready. Categories still needs Allow access."
    );
  }
  showBoard();
}

/** Categories / MTS nav feed — must be true with the board before shots render. */
function setCategoriesFeedOk(ok) {
  categoriesSettled = true;
  categoriesFeedOk = !!ok;
  if (feedsReady()) hideAuthDialog();
  else if (boardFeedOk && !categoriesFeedOk) {
    requestSheetAccess(
      "categories",
      "Board is ready. Categories still needs Allow access."
    );
  }
  showBoard();
}

window.setCategoriesFeedOk = setCategoriesFeedOk;

function jsonp(query, timeoutMs) {
  var root =
    typeof PRESENTATION_FEED_URL === "string"
      ? PRESENTATION_FEED_URL.trim()
      : "";
  return new Promise(function (resolve, reject) {
    if (!root) {
      reject(new Error("NO_FEED_URL"));
      return;
    }
    var cb = "__presFeed" + Date.now() + "_" + jsonpSeq++;
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Feed timeout"));
    }, timeoutMs || 60000);

    function cleanup() {
      clearTimeout(timer);
      try {
        delete window[cb];
      } catch (err) {
        window[cb] = undefined;
      }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cb] = function (body) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };

    var script = document.createElement("script");
    script.src =
      root +
      (root.indexOf("?") >= 0 ? "&" : "?") +
      query +
      "&callback=" +
      cb +
      "&t=" +
      Date.now();
    script.onerror = function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("AUTH_REQUIRED"));
    };
    document.head.appendChild(script);
  });
}

function feedRoot() {
  return typeof PRESENTATION_FEED_URL === "string"
    ? PRESENTATION_FEED_URL.trim()
    : "";
}

function authPageUrl() {
  var root = "";
  if (authTarget === "categories") {
    root = typeof CATEGORIES_FEED_URL === "string" ? CATEGORIES_FEED_URL.trim() : "";
  }
  if (!root) root = feedRoot();
  if (!root) return "";
  return root + (root.indexOf("?") >= 0 ? "&" : "?") + "action=ping";
}

function showAuthDialog(status) {
  var dlg = document.getElementById("authDialog");
  if (!dlg) return;
  dlg.hidden = false;
  var note = document.getElementById("authStatus");
  if (note) note.textContent = status || "";
  var title = document.getElementById("masterTitle");
  if (title && !boards.length) title.textContent = "Access needed";
}

/** Show the full auth card (board or categories). Used when present=1 is removed and access is still needed. */
function requestSheetAccess(target, status) {
  authTarget = target === "categories" ? "categories" : "board";
  showAuthDialog(
    status ||
      (authTarget === "categories"
        ? "Categories needs your permission."
        : "")
  );
}

window.requestSheetAccess = requestSheetAccess;

function hideAuthDialog() {
  var dlg = document.getElementById("authDialog");
  if (dlg) dlg.hidden = true;
  var note = document.getElementById("authStatus");
  if (note) note.textContent = "";
}

function needsAuth(err) {
  var msg = String((err && err.message) || err || "");
  return msg === "AUTH_REQUIRED" || /authoriz|permission|timeout/i.test(msg);
}

function retryAfterAuth() {
  showAuthDialog("Checking access…");
  return loadBoard().then(function () {
    if (window.presentationNav && typeof window.presentationNav.reload === "function") {
      return window.presentationNav.reload();
    }
  });
}

function openAuthPopup() {
  var url = authPageUrl();
  if (!url) return;
  var fallback = document.getElementById("authFallback");
  authPopup = window.open(
    url,
    "presBoardAuth",
    "popup=yes,width=560,height=720"
  );
  if (!authPopup) {
    if (fallback) {
      fallback.hidden = false;
      fallback.href = url;
    }
    showAuthDialog("The Google window was blocked. Use the link below.");
    return;
  }
  if (fallback) fallback.hidden = true;
  showAuthDialog("Finish Allow in the Google window, then close it.");
  if (authWatch) clearInterval(authWatch);
  authWatch = setInterval(function () {
    if (authPopup && !authPopup.closed) return;
    clearInterval(authWatch);
    authWatch = null;
    retryAfterAuth();
  }, 600);
}

function bindAuthDialog() {
  var allow = document.getElementById("authAllow");
  var retry = document.getElementById("authRetry");
  if (allow) {
    allow.addEventListener("click", function () {
      openAuthPopup();
    });
  }
  if (retry) {
    retry.addEventListener("click", function () {
      retryAfterAuth();
    });
  }
}

function loadBoard() {
  if (authBusy) return Promise.resolve(false);
  authBusy = true;
  return jsonp("action=board", 20000)
    .then(function (body) {
      if (!body || !body.ok) {
        throw new Error((body && body.error) || "Feed error");
      }
      applyFeed(body.data);
      return true;
    })
    .catch(function (err) {
      boardFeedOk = false;
      boards = [];
      clearBoard();
      setBoardEmpty(true);
      if (err && err.message === "NO_FEED_URL") {
        document.getElementById("masterTitle").textContent = "Not connected";
        return false;
      }
      if (needsAuth(err)) {
        requestSheetAccess(
          "board",
          err && err.message === "AUTH_REQUIRED"
            ? "Board needs your permission. Click Allow access."
            : "Still waiting for board access. Click Allow access."
        );
        return false;
      }
      document.getElementById("masterTitle").textContent =
        "Error: " + (err && err.message ? err.message : err);
      return false;
    })
    .then(function (ok) {
      authBusy = false;
      return ok;
    });
}

/**
 * Present (view-only) mode. Chosen by the link, never switched off in the page:
 * ?present=1 (Copy URL adds it). Finder and rail stay hidden.
 * Classic / 3D stays on the board.
 */
function urlWantsPresent() {
  var params = new URLSearchParams(window.location.search);
  return params.get("present") === "1";
}

function enterPresent() {
  document.body.classList.add("is-present");
}

function bindPresent() {
  if (urlWantsPresent()) enterPresent();
}

function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  var ms =
    typeof PRESENTATION_POLL_MS === "number" && PRESENTATION_POLL_MS > 0
      ? PRESENTATION_POLL_MS
      : 8000;
  pollTimer = setInterval(loadBoard, ms);
}

viewMode = readViewMode();
requestedSlug = parseRequestedSlug();
bindViewToggle();
bindAuthDialog();
bindPresent();
bindSequenceCopy();
syncViewToggle();
applyViewVisibility();
loadShotOrder().then(function () {
  loadBoard();
  startPoll();
});

window.addEventListener("popstate", function () {
  requestedSlug = parseRequestedSlug();
  showBoard();
});
