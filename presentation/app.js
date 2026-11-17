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
  if (n <= 8) return "grid-8";
  return "grid-8-plus";
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

function shotLabelFor(item, index) {
  var n = index + 1;
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
  renderBoard();
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

function buildCard(item, index) {
  var card = document.createElement("div");
  card.className = "image-card";

  var shot = document.createElement("div");
  shot.className = "shot-label";
  shot.textContent = shotLabelFor(item, index) || "\u00A0";
  card.appendChild(shot);

  var frame = document.createElement("div");
  frame.className = "image-frame";

  var media = document.createElement("div");
  media.className = "image-media";
  if (item.url) {
    var img = document.createElement("img");
    img.src = item.url;
    img.alt = brandLabelFor(item) || shotLabelFor(item, index);
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = function () {
      this.remove();
    };
    media.appendChild(img);
  }
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

function renderClassic(images) {
  var grid = document.getElementById("imageGrid");
  grid.className = "image-grid " + gridClassForCount(images.length || 1);
  grid.innerHTML = "";
  images.forEach(function (item, i) {
    grid.appendChild(buildCard(item, i));
  });
}

function renderPdp(images) {
  var thumbs = document.getElementById("pdpThumbs");
  var hero = document.getElementById("pdpHero");
  thumbs.innerHTML = "";
  hero.innerHTML = "";

  if (!images.length) return;

  if (selectedImageIndex >= images.length) selectedImageIndex = 0;

  images.forEach(function (item, i) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "pdp-thumb" +
      (i === selectedImageIndex ? " is-active" : "") +
      (!item.url ? " is-empty" : "");
    btn.title = shotLabelFor(item, i);
    btn.setAttribute("aria-label", shotLabelFor(item, i));
    if (item.url) {
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = function () {
        this.remove();
      };
      btn.appendChild(img);
    }
    btn.addEventListener("click", function () {
      selectedImageIndex = i;
      renderBoard();
    });
    thumbs.appendChild(btn);
  });

  var current = images[selectedImageIndex];
  var shot = document.createElement("div");
  shot.className = "pdp-hero-shot";
  shot.textContent = shotLabelFor(current, selectedImageIndex);
  hero.appendChild(shot);

  var media = document.createElement("div");
  media.className = "pdp-hero-media";
  if (current.url) {
    var himg = document.createElement("img");
    himg.src = current.url;
    himg.alt = brandLabelFor(current) || shotLabelFor(current, selectedImageIndex);
    himg.referrerPolicy = "no-referrer";
    himg.onerror = function () {
      this.remove();
    };
    media.appendChild(himg);
  }
  hero.appendChild(media);
}

function renderSequence(board, images) {
  var list = document.getElementById("sequenceList");
  list.innerHTML = "";

  var seqItems = board.sequence || [];
  if (!seqItems.length) {
    // Fallback: unique sequence values from image rows
    var seen = {};
    images.forEach(function (img) {
      if (img.sequence && !seen[img.sequence]) {
        seen[img.sequence] = true;
        seqItems.push(img.sequence);
      }
    });
  }

  seqItems.forEach(function (label, i) {
    var li = document.createElement("li");
    var matchIndex = -1;
    for (var j = 0; j < images.length; j++) {
      if (images[j].sequence === label) {
        matchIndex = j;
        break;
      }
    }
    if (matchIndex < 0) matchIndex = i;

    if (viewMode === "pdp" && matchIndex === selectedImageIndex) {
      li.className = "is-active";
    }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = i + 1 + ". " + label;
    btn.addEventListener("click", function () {
      selectedImageIndex = matchIndex;
      if (viewMode !== "pdp") writeViewMode("pdp");
      else renderBoard();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderBoard() {
  var board = boards[activeIndex];
  if (!board) {
    document.getElementById("masterTitle").textContent = "No data";
    document.getElementById("imageGrid").innerHTML = "";
    document.getElementById("pdpThumbs").innerHTML = "";
    document.getElementById("pdpHero").innerHTML = "";
    document.getElementById("sequenceList").innerHTML = "";
    return;
  }

  document.getElementById("masterTitle").textContent =
    cleanMasterTitle(board.subCategory) || "—";

  var images = resolveImages(board.images);
  renderSequence(board, images);

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

function applyFeed(data) {
  boards = (data && data.boards) || [];
  rebuildDomainTitles(boards);

  var slugIndex = findBoardIndexBySlug(requestedSlug);
  if (slugIndex >= 0) activeIndex = slugIndex;
  else if (activeIndex >= boards.length) activeIndex = 0;

  if (selectedImageIndex < 0) selectedImageIndex = 0;

  lastModified = (data && data.modified) || "";
  updateUrlForBoard(boards[activeIndex]);
  renderBoard();
}

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
      reject(new Error("Failed to load feed (open /exec once to authorize)"));
    };
    document.head.appendChild(script);
  });
}

function loadBoard() {
  return jsonp("action=board", 60000)
    .then(function (body) {
      if (!body || !body.ok) {
        throw new Error((body && body.error) || "Feed error");
      }
      applyFeed(body.data);
    })
    .catch(function (err) {
      if (err && err.message === "NO_FEED_URL") {
        document.getElementById("masterTitle").textContent = "Not connected";
        return;
      }
      document.getElementById("masterTitle").textContent =
        "Error: " + (err && err.message ? err.message : err);
    });
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
syncViewToggle();
applyViewVisibility();
loadBoard();
startPoll();

window.addEventListener("popstate", function () {
  requestedSlug = parseRequestedSlug();
  var idx = findBoardIndexBySlug(requestedSlug);
  if (idx >= 0) {
    activeIndex = idx;
    selectedImageIndex = 0;
    renderBoard();
  }
});
