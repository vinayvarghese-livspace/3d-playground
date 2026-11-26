/**
 * Finder: Division → Dept → Category → Sub-category.
 * Tree comes from Categories sheet via MTS Furniture web app (CATEGORIES_FEED_URL, action=nav).
 * USP / Set / Collection / Custom come from the presentation board (generated tab).
 * Query: ?sub=crockery-units&usp=1&set=1&collection=1&custom=1
 */
var NAV_TREE = [];
var navReady = false;

var navState = {
  ownsUrl: false,
  division: "",
  dept: "",
  category: "",
  sub: "",
  picked: {}
};

function navSlug(text) {
  if (typeof slugify === "function") return slugify(text);
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function navFind(list, name) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) return list[i];
  }
  return null;
}

function navFill(select, names, selected) {
  select.innerHTML = "";
  var blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Select";
  select.appendChild(blank);
  for (var i = 0; i < names.length; i++) {
    var opt = document.createElement("option");
    opt.value = names[i];
    opt.textContent = names[i];
    if (names[i] === selected) opt.selected = true;
    select.appendChild(opt);
  }
  select.disabled = !names.length;
}

function navDivision() {
  return navFind(NAV_TREE, navState.division);
}

function navDept() {
  var division = navDivision();
  if (!division) return null;
  return navFind(division.depts, navState.dept);
}

function navCategory() {
  var dept = navDept();
  if (!dept) return null;
  return navFind(dept.categories, navState.category);
}

function navRenderSelects() {
  var division = navDivision();
  var dept = navDept();
  var category = navCategory();
  navFill(
    document.getElementById("navDivision"),
    NAV_TREE.map(function (item) { return item.name; }),
    navState.division
  );
  navFill(
    document.getElementById("navDept"),
    division ? division.depts.map(function (item) { return item.name; }) : [],
    navState.dept
  );
  navFill(
    document.getElementById("navCategory"),
    dept ? dept.categories.map(function (item) { return item.name; }) : [],
    navState.category
  );
  navFill(
    document.getElementById("navSub"),
    category ? category.subs.slice() : [],
    navState.sub
  );
}

function navLocate(slug) {
  if (!slug) return null;
  for (var d = 0; d < NAV_TREE.length; d++) {
    var division = NAV_TREE[d];
    for (var p = 0; p < division.depts.length; p++) {
      var dept = division.depts[p];
      for (var c = 0; c < dept.categories.length; c++) {
        var category = dept.categories[c];
        for (var s = 0; s < category.subs.length; s++) {
          if (navSlug(category.subs[s]) === slug) {
            return {
              division: division.name,
              dept: dept.name,
              category: category.name,
              sub: category.subs[s]
            };
          }
        }
      }
    }
  }
  return null;
}

function navBoardsLoaded() {
  return typeof boards !== "undefined" && boards.length > 0;
}

/** Rail cards from the presentation board for this sub-category. */
function navRailItems() {
  if (!navState.sub || typeof boardOptionsForSlug !== "function") return [];
  return boardOptionsForSlug(navSlug(navState.sub)) || [];
}

function navPrunePicked() {
  var live = {};
  navRailItems().forEach(function (item) { live[item.key] = true; });
  Object.keys(navState.picked).forEach(function (key) {
    if (!live[key]) delete navState.picked[key];
  });
}

function navBuildRail() {
  var root = document.getElementById("modeRailInner");
  var items = navRailItems();
  var signature = JSON.stringify([items, navState.picked]);
  if (root.getAttribute("data-signature") === signature) return;
  root.setAttribute("data-signature", signature);
  root.innerHTML = "";
  for (var i = 0; i < items.length; i++) {
    var mode = items[i];
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-slide";
    btn.setAttribute("data-kind", mode.param);
    btn.setAttribute("data-key", mode.key);
    btn.setAttribute("aria-pressed", mode.fixed || navState.picked[mode.key] ? "true" : "false");
    if (mode.fixed) {
      btn.disabled = true;
      btn.title = "Applies to every shot in this sub-category";
    }

    var num = document.createElement("span");
    num.className = "mode-num";
    num.textContent = String(i + 1);

    var thumb = document.createElement("span");
    thumb.className = "mode-thumb";
    var bar = document.createElement("span");
    bar.className = "mode-thumb-bar";
    thumb.appendChild(bar);
    if (mode.param === "usp" || mode.param === "custom") {
      var kind = document.createElement("span");
      kind.className = "mode-kind";
      kind.textContent = mode.param === "usp" ? "USP" : "Custom";
      thumb.appendChild(kind);
    }
    var label = document.createElement("span");
    label.className = "mode-thumb-label";
    label.textContent = mode.label;
    thumb.appendChild(label);
    btn.appendChild(num);
    btn.appendChild(thumb);
    root.appendChild(btn);
  }
  var rail = document.getElementById("modeRail");
  var open = items.length > 0;
  rail.classList.toggle("is-open", open);
  rail.setAttribute("aria-hidden", open ? "false" : "true");
}

function navActiveModes() {
  var list = [];
  navRailItems().forEach(function (item) {
    if (navState.picked[item.key] && !item.fixed) list.push(item);
  });
  return list;
}

function navPaintBoard() {
  var bar = document.getElementById("selectionBar");
  var copy = document.getElementById("copyUrl");
  var active = navActiveModes();

  copy.disabled = !navState.sub;
  bar.innerHTML = "";

  if (!navState.sub) {
    bar.hidden = true;
    return;
  }

  var name = document.createElement("span");
  name.className = "selection-name";
  name.textContent = navState.sub;
  bar.appendChild(name);
  for (var i = 0; i < active.length; i++) {
    var chip = document.createElement("span");
    chip.className = "selection-chip";
    chip.setAttribute("data-kind", active[i].param);
    chip.textContent = active[i].param === "usp" || active[i].param === "custom"
      ? (active[i].param === "usp" ? "USP " : "Custom ") + active[i].label
      : active[i].label;
    bar.appendChild(chip);
  }
  bar.hidden = false;
}

function navWriteUrl() {
  var url = new URL(window.location.href);
  var slug = navState.sub
    ? navSlug(navState.sub)
    : (navState.pendingSlug || "");
  if (slug) url.searchParams.set("sub", slug);
  else url.searchParams.delete("sub");

  var grouped = { usp: [], set: [], collection: [], custom: [] };
  var active = navActiveModes();
  if (active.length) {
    active.forEach(function (item) {
      grouped[item.param].push(item.id);
    });
  } else {
    /* Board/rail not ready yet — keep picks already taken from the link. */
    Object.keys(navState.picked).forEach(function (key) {
      var parts = key.split(":");
      var param = parts[0];
      if (!grouped[param]) return;
      if (param === "set" || param === "collection") grouped[param].push("1");
      else if (parts[1]) grouped[param].push(parts[1]);
    });
  }
  ["usp", "set", "collection", "custom"].forEach(function (param) {
    if (grouped[param].length) url.searchParams.set(param, grouped[param].join(","));
    else url.searchParams.delete(param);
  });
  url.hash = "";
  var next = url.pathname + url.search;
  if (next !== window.location.pathname + window.location.search) {
    history.replaceState(null, "", next);
  }
}

/** Rail, chips and URL; picks from the URL are kept until the board feed can confirm them. */
function navSyncRail() {
  if (navReady && navBoardsLoaded()) navPrunePicked();
  navBuildRail();
  navPaintBoard();
  if (navState.ownsUrl) navWriteUrl();
}

function navApply(fromUser, resetShot) {
  if (fromUser) navState.ownsUrl = true;
  navRenderSelects();
  navSyncRail();
  if (resetShot) selectedImageIndex = 0;
  if (typeof showBoard === "function") showBoard();
}

function navParamIds(params, key) {
  var ids = [];
  params.getAll(key).forEach(function (part) {
    String(part || "").split(",").forEach(function (id) {
      id = id.trim();
      if (id) ids.push(id);
    });
  });
  return ids;
}

function navReadUrl() {
  var params = new URLSearchParams(window.location.search);
  var slug = navSlug(params.get("sub") || "");
  var found = navLocate(slug);
  if (found) {
    navState.division = found.division;
    navState.dept = found.dept;
    navState.category = found.category;
    navState.sub = found.sub;
  } else if (slug) {
    /* Deep link before the categories tree loads — keep slug for the board. */
    navState.pendingSlug = slug;
  }
  navState.picked = {};
  navParamIds(params, "usp").forEach(function (id) { navState.picked["usp:" + id] = true; });
  navParamIds(params, "custom").forEach(function (id) { navState.picked["custom:" + id] = true; });
  if (params.get("set") === "1") navState.picked.set = true;
  if (params.get("collection") === "1") navState.picked.collection = true;
  if (slug || Object.keys(navState.picked).length) navState.ownsUrl = true;
}

/** Clean, view-only link: the current selection plus present=1. The page itself is not changed. */
function navPresentUrl() {
  var url = new URL(window.location.href);
  url.searchParams.set("present", "1");
  url.hash = "";
  return url.toString();
}

function navCopyUrl() {
  var status = document.getElementById("copyUrlStatus");
  var text = navPresentUrl();
  function done() {
    status.textContent = "Copied";
    setTimeout(function () {
      if (status.textContent === "Copied") status.textContent = "";
    }, 1600);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {
      navCopyFallback(text);
      done();
    });
    return;
  }
  navCopyFallback(text);
  done();
}

function navCopyFallback(text) {
  var area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/* —— Live category feed —— */

function navJsonp(query, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var root = String(CATEGORIES_FEED_URL || "").trim();
    var cb = "__navFeed" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    var settled = false;
    var script = null;
    var timer = null;

    function cleanup() {
      clearTimeout(timer);
      try {
        delete window[cb];
      } catch (err) {
        window[cb] = undefined;
      }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Feed timeout"));
    }, timeoutMs || 20000);

    window[cb] = function (body) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };

    script = document.createElement("script");
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

/** Categories sheet → Division / Dept / Category / Sub-category names. */
function navAdapt(tree) {
  return (tree || []).map(function (division) {
    return {
      name: division.name,
      depts: (division.depts || []).map(function (dept) {
        return {
          name: dept.name,
          categories: (dept.categories || []).map(function (cat) {
            return {
              name: cat.name,
              subs: (cat.subs || []).map(function (sub) { return sub.name; })
            };
          })
        };
      })
    };
  });
}

function navSetNote(text, feedUrl) {
  var note = document.querySelector(".finder-note");
  if (!note) return;
  note.textContent = text;
  if (!feedUrl) return;
  var link = document.createElement("a");
  link.href = feedUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = " Open feed to allow access";
  link.className = "finder-link";
  note.appendChild(link);
}

function navLoadTree() {
  var root = String(CATEGORIES_FEED_URL || "").trim();
  if (!root) {
    navSetNote("Categories not connected");
    if (typeof setCategoriesFeedOk === "function") setCategoriesFeedOk(false);
    return;
  }
  navJsonp("action=nav", 20000)
    .then(function (body) {
      if (!body || !body.ok) {
        throw new Error((body && body.error) || "Feed error");
      }
      NAV_TREE = navAdapt(body.data.tree);
      navReady = true;
      navSetNote("Categories & Subcategories");
      navReadUrl();
      if (navState.sub) navState.pendingSlug = "";
      if (typeof setCategoriesFeedOk === "function") setCategoriesFeedOk(true);
      navApply(false, navState.ownsUrl);
    })
    .catch(function (err) {
      navReady = false;
      if (typeof setCategoriesFeedOk === "function") setCategoriesFeedOk(false);
      var msg = String((err && err.message) || err || "");
      var needsAccess = msg === "AUTH_REQUIRED" || /timeout/i.test(msg);
      if (needsAccess) {
        navSetNote("Allow access to load categories…");
        if (typeof requestSheetAccess === "function") {
          requestSheetAccess(
            "categories",
            "Categories needs your permission. Click Allow access."
          );
        } else {
          navSetNote(
            "Allow access once, then reload this page.",
            root + (root.indexOf("?") >= 0 ? "&" : "?") + "action=ping"
          );
        }
      } else {
        navSetNote("Could not load categories: " + msg);
      }
    });
}

function navBind() {
  document.getElementById("navDivision").addEventListener("change", function (e) {
    navState.division = e.target.value;
    navState.dept = "";
    navState.category = "";
    navState.sub = "";
    navApply(true, false);
  });
  document.getElementById("navDept").addEventListener("change", function (e) {
    navState.dept = e.target.value;
    navState.category = "";
    navState.sub = "";
    navApply(true, false);
  });
  document.getElementById("navCategory").addEventListener("change", function (e) {
    navState.category = e.target.value;
    navState.sub = "";
    navApply(true, false);
  });
  document.getElementById("navSub").addEventListener("change", function (e) {
    navState.sub = e.target.value;
    navApply(true, true);
  });
  document.getElementById("modeRailInner").addEventListener("click", function (e) {
    var btn = e.target.closest(".mode-slide");
    if (!btn || !navState.sub) return;
    var key = btn.getAttribute("data-key");
    if (navState.picked[key]) delete navState.picked[key];
    else navState.picked[key] = true;
    navApply(true, true);
  });
  document.getElementById("copyUrl").addEventListener("click", navCopyUrl);
}

navBind();
/* Apply ?usp= / ?sub= from the link immediately — do not wait on categories Allow. */
navReadUrl();
navApply(false, false);
navLoadTree();

window.presentationNav = {
  ownsUrl: function () {
    return navState.ownsUrl;
  },
  subSlug: function () {
    if (navState.sub) return navSlug(navState.sub);
    return navState.pendingSlug || "";
  },
  subName: function () {
    return navState.sub || "";
  },
  picked: function () {
    return navState.picked;
  },
  refresh: navSyncRail,
  reload: navLoadTree
};
