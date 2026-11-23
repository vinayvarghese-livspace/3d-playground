/**
 * Production statistics.
 * Week tiles = last completed Mon–Fri. Week charts = last 5 working days.
 * Bars / Line / Numbers views. Fullscreen on every chart.
 */
(function () {
  var METRICS = [
    { id: 'images', label: 'Images', you: true, better: 'up', kind: 'count', tip: 'Approved images each working day. Automatic and custom are stacked on Bars.' },
    { id: 'automatic', label: 'Automatic', you: true, better: 'up', kind: 'pct', tip: 'That day’s automatic images divided by automatic plus custom.' },
    { id: 'quality', label: 'Quality', you: true, better: 'up', kind: 'score', tip: 'Average star rating of images approved that day (1–5).' },
    { id: 'tries', label: 'Tries', you: true, better: 'down', kind: 'score', tip: 'Average successful Generate clicks before approval that day. Lower is better.' },
    { id: 'first', label: 'First-try', you: true, better: 'up', kind: 'pct', tip: 'Share of that day’s images approved on the first try.' },
    { id: 'perAuthor', label: 'Per author', you: false, better: 'up', kind: 'score', tip: 'That day’s team images divided by the roster count.' },
    { id: 'perDay', label: 'Per day', you: true, better: 'up', kind: 'score', tip: 'Images that day (team or you). Use Line to see pace change over time.' },
    { id: 'perProduct', label: 'Per product', you: true, better: 'up', kind: 'score', tip: 'That day’s images divided by distinct products approved that day.' }
  ];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var VIEWS = ['line', 'bars', 'numbers'];

  var state = {
    author: '',
    range: sessionValue('stats.range', ['week', 'month', 'all'], 'week'),
    teamMetric: sessionValue('stats.teamMetric', metricIds(false), 'images'),
    youMetric: sessionValue('stats.youMetric', metricIds(true), 'images'),
    teamView: sessionValue('stats.teamView', VIEWS, 'line'),
    youView: sessionValue('stats.youView', VIEWS, 'line'),
    rosterOpen: sessionValue('stats.rosterOpen', ['0', '1'], '0') === '1',
    days: [],
    readAt: '',
    cfg: { exclude: ['vinay'], roster: [], holidays: [], milestones: [], dataStart: '' },
    holidayMap: {},
    milestones: [],
    dataStart: '',
    error: '',
    loading: true,
    fs: null
  };

  var tipEl = document.getElementById('tip');
  var fsEl = document.getElementById('fs');

  function metricIds(youOnly) {
    return METRICS.filter(function (m) { return !youOnly || m.you; }).map(function (m) { return m.id; });
  }

  function sessionValue(key, allowed, fallback) {
    try {
      var v = sessionStorage.getItem(key);
      if (allowed.indexOf(v) >= 0) return v;
    } catch (err) { /* ignore */ }
    return fallback;
  }

  function remember(key, value) {
    try { sessionStorage.setItem(key, value); } catch (err) { /* ignore */ }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function firstName(s) {
    return normName(s).split(' ')[0] || '';
  }

  function isExcluded(name) {
    var n = normName(name);
    var f = firstName(name);
    return (state.cfg.exclude || []).some(function (ex) {
      var e = normName(ex);
      return !!e && (n === e || f === e || n.indexOf(e + ' ') === 0);
    });
  }

  function matchesPerson(name, canonical) {
    var n = normName(name);
    var r = normName(canonical);
    if (!n || !r) return false;
    if (n === r) return true;
    if (n.indexOf(r + ' ') === 0 || r.indexOf(n + ' ') === 0) return true;
    var nf = firstName(name);
    var rf = firstName(canonical);
    return nf === r || rf === n || (nf === rf && nf.length > 1);
  }

  function parseISO(s) {
    var p = String(s).split('-').map(Number);
    return new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1));
  }

  function fmt(d) {
    var y = d.getUTCFullYear();
    var m = ('0' + (d.getUTCMonth() + 1)).slice(-2);
    var day = ('0' + d.getUTCDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setUTCDate(x.getUTCDate() + n);
    return x;
  }

  function startOfWeek(d) {
    var day = d.getUTCDay();
    return addDays(d, day === 0 ? -6 : 1 - day);
  }

  function addMonths(key, n) {
    var d = parseISO(key.slice(0, 8) + '01');
    return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
  }

  function kolkataToday() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    var y = '';
    var m = '';
    var d = '';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') d = p.value;
    });
    return y + '-' + m + '-' + d;
  }

  function monthShort(key) { return MONTHS[parseISO(key).getUTCMonth()]; }
  function monthFull(key) { return MONTHS_FULL[parseISO(key).getUTCMonth()]; }
  function dowShort(key) { return DOWS[parseISO(key).getUTCDay()]; }
  function rangeWord() {
    if (state.range === 'week') return 'week';
    if (state.range === 'month') return 'month';
    return 'all time';
  }
  function rangeWordCap() {
    if (state.range === 'week') return 'Week';
    if (state.range === 'month') return 'Month';
    return 'All time';
  }

  function prettyDay(key) {
    return dowShort(key) + ' ' + Number(key.slice(8, 10)) + ' ' + monthShort(key);
  }

  function stamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(d);
  }

  function eachDate(start, end, fn) {
    var d = parseISO(start);
    var last = parseISO(end);
    var guard = 0;
    while (d.getTime() <= last.getTime() && guard < 4000) {
      fn(fmt(d));
      d = addDays(d, 1);
      guard++;
    }
  }

  function isWeekend(key) {
    var day = parseISO(key).getUTCDay();
    return day === 0 || day === 6;
  }

  function holidayName(key) {
    return state.holidayMap[key] || '';
  }

  function isWorking(key, today) {
    if (key > today) return false;
    if (state.dataStart && key < state.dataStart) return false;
    if (isWeekend(key)) return false;
    if (holidayName(key)) return false;
    return true;
  }

  function workingDays(start, end, today) {
    var out = [];
    eachDate(start, end, function (key) {
      if (isWorking(key, today)) out.push(key);
    });
    return out;
  }

  function lastNWorkingDays(today, n) {
    var out = [];
    var d = parseISO(today);
    var guard = 0;
    while (out.length < n && guard < 60) {
      var key = fmt(d);
      if (isWorking(key, today)) out.unshift(key);
      d = addDays(d, -1);
      guard++;
    }
    return out;
  }

  function lastCompletedWeekBounds(today) {
    var thisMon = startOfWeek(parseISO(today));
    var lastMon = addDays(thisMon, -7);
    var lastFri = addDays(lastMon, 4);
    return { start: fmt(lastMon), end: fmt(lastFri), vs: 'prior week' };
  }

  function weekCount(days) {
    var set = {};
    days.forEach(function (key) {
      set[fmt(startOfWeek(parseISO(key)))] = 1;
    });
    return Object.keys(set).length;
  }

  function blankSum() {
    return {
      images: 0, approve: 0, mdim: 0, automated: 0, custom: 0, unknown: 0,
      qualitySum: 0, qualityN: 0, generationSum: 0, generationN: 0,
      firstTry: 0, eans: {}
    };
  }

  function addSum(target, extra) {
    if (!extra) return;
    target.images += extra.images || 0;
    target.approve += extra.approve != null ? (extra.approve || 0) : ((extra.images || 0) - (extra.mdim || 0));
    target.mdim += extra.mdim || 0;
    target.automated += extra.automated || 0;
    target.custom += extra.custom || 0;
    target.unknown += extra.unknown || 0;
    target.qualitySum += extra.qualitySum || 0;
    target.qualityN += extra.qualityN || 0;
    target.generationSum += extra.generationSum || 0;
    target.generationN += extra.generationN || 0;
    target.firstTry += extra.firstTry || 0;
    var eans = extra.eans;
    if (Array.isArray(eans)) eans.forEach(function (e) { if (e) target.eans[e] = 1; });
    else Object.keys(eans || {}).forEach(function (e) { if (e) target.eans[e] = 1; });
  }

  function rosterList() {
    var seen = {};
    var out = [];
    (state.cfg.roster || []).forEach(function (name) {
      var raw = String(name || '').trim();
      if (!raw || isExcluded(raw)) return;
      var key = normName(raw);
      if (seen[key]) return;
      seen[key] = 1;
      out.push(raw);
    });
    return out;
  }

  function onRoster(author) {
    var roster = rosterList();
    if (!roster.length) return !isExcluded(author);
    if (isExcluded(author)) return false;
    return roster.some(function (name) { return matchesPerson(author, name); });
  }

  /** True only for real team people: on roster when set, else names that appear in the data. */
  function isRecognizedAuthor(name) {
    var n = String(name || '').trim();
    if (!n || isExcluded(n)) return false;
    var roster = rosterList();
    if (roster.length) return onRoster(n);
    return state.days.some(function (row) { return matchesPerson(row.author, n); });
  }

  function vsRosterNote(perAuthor) {
    if (perAuthor == null || !isFinite(perAuthor)) return '';
    return 'team ' + fmtSmart(perAuthor, 'score');
  }

  function firstDataDate() {
    var first = '';
    state.days.forEach(function (row) {
      if (!row.date) return;
      if (!first || row.date < first) first = row.date;
    });
    return first || '';
  }

  /** Config floor + first logged image. Charts and averages never start earlier. */
  function resolveDataStart(firstAt) {
    var floor = String(state.cfg.dataStart || '').trim();
    var first = String(firstAt || '').trim() || firstDataDate();
    if (floor && first) return first < floor ? floor : first;
    return first || floor || '';
  }

  function teamRows(today) {
    return state.days.filter(function (row) {
      return isWorking(row.date, today) && onRoster(row.author);
    });
  }

  function youRows(today) {
    return state.days.filter(function (row) {
      return isWorking(row.date, today) && matchesPerson(row.author, state.author);
    });
  }

  function inRange(rows, start, end) {
    return rows.filter(function (row) { return row.date >= start && row.date <= end; });
  }

  function sumRows(rows) {
    var sum = blankSum();
    rows.forEach(function (row) { addSum(sum, row); });
    return sum;
  }

  function metricMeta(id) {
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].id === id) return METRICS[i];
    return METRICS[0];
  }

  function metricValue(sum, metric, rosterCount) {
    if (!sum) return null;
    if (metric === 'images' || metric === 'perDay') return sum.images;
    if (metric === 'automatic') {
      var den = sum.automated + sum.custom;
      return den ? (sum.automated / den) * 100 : null;
    }
    if (metric === 'quality') return sum.qualityN ? sum.qualitySum / sum.qualityN : null;
    if (metric === 'tries') return sum.generationN ? sum.generationSum / sum.generationN : null;
    if (metric === 'first') return sum.generationN ? (sum.firstTry / sum.generationN) * 100 : null;
    if (metric === 'perAuthor') return rosterCount ? sum.images / rosterCount : null;
    if (metric === 'perProduct') {
      var n = Object.keys(sum.eans || {}).length;
      return n ? sum.images / n : null;
    }
    return null;
  }

  function fmtSmart(n, kind) {
    if (n == null || !isFinite(n)) return '—';
    if (kind === 'pct') return String(Math.round(n)) + '%';
    if (kind === 'int') return String(Math.round(n));
    var r = Math.round(n * 10) / 10;
    if (Math.abs(r - Math.round(r)) < 0.05) return String(Math.round(r));
    return r.toFixed(1);
  }

  function qualityPct(score) {
    if (score == null || !isFinite(score)) return null;
    return (score / 5) * 100;
  }

  function metricText(metric, value) {
    var meta = metricMeta(metric);
    if (value == null || !isFinite(value)) return '—';
    if (meta.kind === 'pct') return fmtSmart(value, 'pct');
    if (metric === 'images' || metric === 'perDay') return fmtSmart(value, 'int');
    if (metric === 'quality') {
      return fmtSmart(value, 'score') + ' · ' + fmtSmart(qualityPct(value), 'pct');
    }
    return fmtSmart(value, 'score');
  }

  function toneFor(metric, value) {
    if (value == null || !isFinite(value)) return '';
    // Automatic / first-try (%).
    if (metric === 'automatic' || metric === 'first') {
      if (value >= 50) return 'good';
      if (value >= 35) return 'mid';
      return 'bad';
    }
    // Quality: score 1–5. 75% of 5 (= 3.75) and above is good; 4.5+ stays green.
    if (metric === 'quality') {
      var pct = qualityPct(value);
      if (pct >= 75) return 'good';
      if (pct >= 60) return 'mid';
      return 'bad';
    }
    // Tries: lower is better.
    if (metric === 'tries') {
      if (value <= 2) return 'good';
      if (value <= 2.5) return 'mid';
      return 'bad';
    }
    return '';
  }

  /**
   * Compare to team / prior period.
   * Green: at or better (including equal display, e.g. both 64%).
   * Amber: slightly worse.
   * Red: much worse.
   */
  function toneVs(curr, bench, better, metric) {
    if (curr == null || bench == null || !isFinite(curr) || !isFinite(bench)) return '';
    better = better || 'up';
    var meta = metric ? metricMeta(metric) : null;
    var kind = meta ? meta.kind : 'score';

    // Same rounded % on screen → treat as equal / green.
    if (kind === 'pct' && Math.round(curr) === Math.round(bench)) return 'good';
    if (metric === 'quality' && Math.round(curr * 10) === Math.round(bench * 10)) return 'good';
    if ((metric === 'tries' || kind === 'count' || metric === 'perDay' || metric === 'perAuthor' || metric === 'images') &&
        Math.abs(curr - bench) < 0.05) return 'good';

    var worse = 0;
    if (better === 'down') {
      if (curr <= bench) return 'good';
      worse = curr - bench;
    } else {
      if (curr >= bench) return 'good';
      worse = bench - curr;
    }

    // Soft / hard distance.
    if (kind === 'pct') {
      // Within 10 percentage points → amber; further → red.
      return worse <= 10 ? 'mid' : 'bad';
    }
    if (metric === 'quality') {
      // Within 0.25 stars (~5% of the 1–5 scale) → amber.
      return worse <= 0.25 ? 'mid' : 'bad';
    }
    // Counts / tries / rates: within 15% of the benchmark → amber; beyond → red.
    var rel = Math.abs(bench) > 0.0001 ? (worse / Math.abs(bench)) * 100 : 100;
    if (metric === 'tries' && worse <= 0.3) return 'mid';
    return rel <= 15 ? 'mid' : 'bad';
  }

  /** Prefer comparison-to-benchmark when present; otherwise absolute bands. */
  function tonePrefer(metric, value, bench, better) {
    if (bench != null && isFinite(bench)) {
      return toneVs(value, bench, better || metricMeta(metric).better, metric);
    }
    return toneFor(metric, value);
  }

  function figures(sum, days, rosterCount) {
    var units = days.length;
    var weeks = weekCount(days);
    var products = Object.keys(sum.eans || {}).length;
    var classified = sum.automated + sum.custom;
    return {
      images: sum.images,
      approve: sum.approve || 0,
      mdim: sum.mdim || 0,
      automated: sum.automated,
      custom: sum.custom,
      unknown: sum.unknown,
      automaticPct: classified ? (sum.automated / classified) * 100 : null,
      perAuthor: rosterCount ? sum.images / rosterCount : null,
      perDay: units ? sum.images / units : null,
      perWeek: weeks ? sum.images / weeks : null,
      perAuthorPerDay: (rosterCount && units) ? (sum.images / rosterCount / units) : null,
      quality: sum.qualityN ? sum.qualitySum / sum.qualityN : null,
      tries: sum.generationN ? sum.generationSum / sum.generationN : null,
      firstPct: sum.generationN ? (sum.firstTry / sum.generationN) * 100 : null,
      products: products,
      perProduct: products ? sum.images / products : null
    };
  }

  function bounds(range, today, rows) {
    var startFloor = state.dataStart || firstDataDate() || today;
    if (range === 'week') {
      var week = lastCompletedWeekBounds(today);
      if (week.start < startFloor) week.start = startFloor;
      if (week.end < startFloor) week.end = startFloor;
      return week;
    }
    if (range === 'month') {
      var mStart = today.slice(0, 8) + '01';
      if (mStart < startFloor) mStart = startFloor;
      return { start: mStart, end: today, vs: 'last month' };
    }
    var first = startFloor;
    rows.forEach(function (row) {
      if (row.date >= startFloor && row.date < first) first = row.date;
    });
    return { start: first, end: today, vs: 'prior period' };
  }

  function previousBounds(range, box) {
    if (range === 'week') {
      return {
        start: fmt(addDays(parseISO(box.start), -7)),
        end: fmt(addDays(parseISO(box.end), -7))
      };
    }
    if (range === 'month') {
      var start = parseISO(box.start);
      var prevEndMonth = addDays(start, -1);
      var prevStart = new Date(Date.UTC(prevEndMonth.getUTCFullYear(), prevEndMonth.getUTCMonth(), 1));
      var dayNum = parseISO(box.end).getUTCDate();
      var prevEnd = new Date(Date.UTC(
        prevEndMonth.getUTCFullYear(),
        prevEndMonth.getUTCMonth(),
        Math.min(dayNum, prevEndMonth.getUTCDate())
      ));
      return { start: fmt(prevStart), end: fmt(prevEnd) };
    }
    return null;
  }

  function displayName(canonical, rows) {
    var counts = {};
    rows.forEach(function (row) {
      if (!matchesPerson(row.author, canonical)) return;
      counts[row.author] = (counts[row.author] || 0) + (row.images || 0);
    });
    var best = canonical;
    var n = 0;
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > n) { n = counts[key]; best = key; }
    });
    return best;
  }

  function slot(key, label, sub, slotState, holiday) {
    return { key: key, label: label, sub: sub || '', state: slotState, holiday: holiday || '', sum: blankSum() };
  }

  function last5Slots(today) {
    return lastNWorkingDays(today, 5).map(function (key) {
      return slot(key, dowShort(key), String(Number(key.slice(8, 10))), 'day', '');
    });
  }

  function monthWorkSlots(today) {
    var start = today.slice(0, 8) + '01';
    if (state.dataStart && start < state.dataStart) start = state.dataStart;
    var slots = [];
    eachDate(start, today, function (key) {
      if (isWeekend(key)) return;
      var hol = holidayName(key);
      if (hol) {
        slots.push(slot(key, String(Number(key.slice(8, 10))), 'Holiday', 'holiday', hol));
        return;
      }
      if (key > today) return;
      slots.push(slot(key, String(Number(key.slice(8, 10))), dowShort(key), 'day', ''));
    });
    return slots;
  }

  function dataWeekSlots(rows, today) {
    var first = state.dataStart || today;
    rows.forEach(function (row) { if (row.date < first) first = row.date; });
    if (state.dataStart && first < state.dataStart) first = state.dataStart;
    var key = fmt(startOfWeek(parseISO(first)));
    var end = fmt(startOfWeek(parseISO(today)));
    var slots = [];
    var guard = 0;
    while (key <= end && guard < 80) {
      slots.push(slot(key, Number(key.slice(8, 10)) + ' ' + monthShort(key), '', 'week', ''));
      key = fmt(addDays(parseISO(key), 7));
      guard++;
    }
    if (slots.length > 12) slots = slots.slice(slots.length - 12);
    if (!slots.length) slots.push(slot(end, Number(end.slice(8, 10)) + ' ' + monthShort(end), '', 'week', ''));
    return slots;
  }

  function dataMonthSlots(rows, today) {
    var first = state.dataStart || today;
    rows.forEach(function (row) { if (row.date < first) first = row.date; });
    if (state.dataStart && first < state.dataStart) first = state.dataStart;
    var key = first.slice(0, 8) + '01';
    var end = today.slice(0, 8) + '01';
    var slots = [];
    var guard = 0;
    while (key <= end && guard < 36) {
      slots.push(slot(key, monthShort(key), key.slice(0, 4), 'month', ''));
      key = addMonths(key, 1);
      guard++;
    }
    if (slots.length > 12) slots = slots.slice(slots.length - 12);
    if (!slots.length) slots.push(slot(end, monthShort(end), end.slice(0, 4), 'month', ''));
    return slots;
  }

  function fillSlots(slots, rows, today) {
    slots.forEach(function (item) {
      rows.forEach(function (row) {
        if (row.date > today || !isWorking(row.date, today)) return;
        if (item.state === 'day' && row.date === item.key) addSum(item.sum, row);
        if (item.state === 'week' && fmt(startOfWeek(parseISO(row.date))) === item.key) addSum(item.sum, row);
        if (item.state === 'month' && row.date.slice(0, 7) === item.key.slice(0, 7)) addSum(item.sum, row);
      });
    });
    return slots;
  }

  function realSlots(slots) {
    return slots.filter(function (item) {
      return item.state === 'day' || item.state === 'week' || item.state === 'month';
    });
  }

  function pooled(slots) {
    var sum = blankSum();
    realSlots(slots).forEach(function (item) { addSum(sum, item.sum); });
    return sum;
  }

  function lineValue(metric, slots, rosterCount) {
    var units = realSlots(slots);
    var pool = pooled(slots);
    if (!units.length) return null;
    if (metric === 'images' || metric === 'perDay') return pool.images / units.length;
    if (metric === 'perAuthor') return rosterCount ? pool.images / rosterCount / units.length : null;
    return metricValue(pool, metric, rosterCount);
  }

  function delta(curr, prev, meta, vs) {
    if (!vs || curr == null || prev == null || !isFinite(curr) || !isFinite(prev)) return null;
    var diff = curr - prev;
    var text = '';
    var tone = 'flat';
    if (meta.kind === 'pct') {
      var pts = Math.round(diff);
      if (pts === 0) text = 'Flat vs ' + vs;
      else text = (pts > 0 ? '↑ ' : '↓ ') + Math.abs(pts) + ' pts vs ' + vs;
      tone = pts === 0 ? 'flat' : ((meta.better === 'down' ? pts < 0 : pts > 0) ? 'good' : 'bad');
    } else if (meta.kind === 'count') {
      if (!prev && !curr) return null;
      var pct = prev ? Math.round((diff / prev) * 100) : (curr ? 100 : 0);
      if (pct === 0) text = 'Flat vs ' + vs;
      else text = (pct > 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '% vs ' + vs;
      tone = pct === 0 ? 'flat' : ((meta.better === 'down' ? pct < 0 : pct > 0) ? 'good' : 'bad');
    } else {
      var d = Math.round(diff * 10) / 10;
      if (d === 0) text = 'Flat vs ' + vs;
      else text = (d > 0 ? '↑ ' : '↓ ') + Math.abs(d).toFixed(1) + ' vs ' + vs;
      tone = d === 0 ? 'flat' : ((meta.better === 'down' ? d < 0 : d > 0) ? 'good' : 'bad');
    }
    return { text: text, tone: tone };
  }

  function info(text) {
    return '<button type="button" class="info" data-tip="' + esc(text) + '" aria-label="How this is calculated">i</button>';
  }

  function slotTip(item, metric, average, rosterCount) {
    if (item.state === 'holiday') {
      return prettyDay(item.key) + ' · ' + (item.holiday || 'Public holiday') + '. Not a working day.';
    }
    var value = metricValue(item.sum, metric, rosterCount);
    var when = item.state === 'day' ? prettyDay(item.key) : (item.label + (item.sub ? ' ' + item.sub : ''));
    var body = when + ' · ' + metricText(metric, value);
    if (metric === 'images') {
      body += ' images · ' + item.sum.automated + ' automatic · ' + item.sum.custom + ' custom';
    }
    if (value != null && average != null && isFinite(average)) {
      body += '. ' + (value >= average ? 'Above' : 'Below') + ' the ' + metricText(metric, average) + ' average.';
      if (metric === 'tries') body += ' Fewer tries is better.';
    }
    return body;
  }

  function milestonesIn(slots) {
    var keys = {};
    slots.forEach(function (s) { keys[s.key] = 1; });
    return (state.milestones || []).filter(function (m) {
      if (!m.date) return false;
      if (keys[m.date]) return true;
      return slots.some(function (s) {
        if (s.state === 'week') return fmt(startOfWeek(parseISO(m.date))) === s.key;
        if (s.state === 'month') return m.date.slice(0, 7) === s.key.slice(0, 7);
        return false;
      });
    });
  }

  function chartSvg(slots, metric, average, rosterCount, compare, mode) {
    var live = realSlots(slots);
    var max = 0;
    live.forEach(function (item) {
      var v = metricValue(item.sum, metric, rosterCount);
      if (v != null && v > max) max = v;
    });
    if (average != null && average > max) max = average;
    if (compare != null && compare > max) max = compare;
    var padL = 40;
    var padR = 14;
    var padT = 28;
    var padB = 52;
    var w = mode === 'fs' ? 960 : 640;
    var h = mode === 'fs' ? 420 : 230;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    var n = Math.max(slots.length, 1);
    var gap = n > 18 ? 4 : 10;
    var barW = Math.max(6, (innerW - gap * (n - 1)) / n);
    var useLine = mode === 'line';
    var drawBars = mode === 'bars' || mode === 'fs';

    function yOf(value) {
      var t = 0;
      if (metric === 'quality') t = Math.max(0, Math.min(1, ((value || 1) - 1) / 4));
      else if (metric === 'automatic' || metric === 'first') t = Math.max(0, Math.min(1, (value || 0) / 100));
      else t = max ? Math.max(0, (value || 0) / (max * 1.12 || 1)) : 0;
      return padT + innerH - t * innerH;
    }

    var axisTop = metric === 'quality' ? '5' : (metric === 'automatic' || metric === 'first' ? '100%' : fmtSmart(max || 0, metric === 'images' || metric === 'perDay' ? 'int' : 'score'));
    var axisBot = metric === 'quality' ? '1' : '0';
    var parts = [];
    parts.push('<svg class="plot" viewBox="0 0 ' + w + ' ' + h + '" role="img">');

    // Soft week bands inside a month (or multi-day) chart so Mon–Fri groups are visible.
    if (slots.length > 5 && slots[0] && slots[0].state === 'day') {
      var band = null;
      slots.forEach(function (item, i) {
        if (item.state !== 'day' && item.state !== 'holiday') return;
        var wk = fmt(startOfWeek(parseISO(item.key)));
        if (!band || band.wk !== wk) {
          if (band) {
            var bx = padL + band.start * (barW + gap) - gap / 2;
            var bw = (band.end - band.start + 1) * (barW + gap);
            parts.push('<rect x="' + bx + '" y="' + padT + '" width="' + bw + '" height="' + innerH + '" fill="' + (band.odd ? '#f3f4f6' : '#ffffff') + '" opacity="0.9"/>');
          }
          band = { wk: wk, start: i, end: i, odd: !band || !band.odd };
        } else {
          band.end = i;
        }
      });
      if (band) {
        var bx2 = padL + band.start * (barW + gap) - gap / 2;
        var bw2 = (band.end - band.start + 1) * (barW + gap);
        parts.push('<rect x="' + bx2 + '" y="' + padT + '" width="' + bw2 + '" height="' + innerH + '" fill="' + (band.odd ? '#f3f4f6' : '#ffffff') + '" opacity="0.9"/>');
      }
    }

    parts.push('<text x="' + (padL - 6) + '" y="' + (padT + 4) + '" text-anchor="end" fill="#9ca3af" font-size="10">' + esc(axisTop) + '</text>');
    parts.push('<text x="' + (padL - 6) + '" y="' + (padT + innerH) + '" text-anchor="end" fill="#9ca3af" font-size="10">' + esc(axisBot) + '</text>');
    parts.push('<line x1="' + padL + '" y1="' + (padT + innerH) + '" x2="' + (w - padR) + '" y2="' + (padT + innerH) + '" stroke="#e5e7eb"/>');

    if (average != null && isFinite(average)) {
      var ay = yOf(average);
      parts.push('<line x1="' + padL + '" y1="' + ay + '" x2="' + (w - padR) + '" y2="' + ay + '" stroke="#94a3b8" stroke-dasharray="4 4"/>');
    }
    if (compare != null && isFinite(compare)) {
      var cy = yOf(compare);
      parts.push('<line x1="' + padL + '" y1="' + cy + '" x2="' + (w - padR) + '" y2="' + cy + '" stroke="#111827" stroke-dasharray="2 3"/>');
    }

    var marks = milestonesIn(slots);
    var showMilestoneLabels = mode === 'fs' || mode === 'line' || slots.length <= 16;
    marks.forEach(function (m) {
      var idx = -1;
      slots.forEach(function (s, i) {
        if (s.key === m.date) idx = i;
        else if (s.state === 'week' && fmt(startOfWeek(parseISO(m.date))) === s.key) idx = i;
        else if (s.state === 'month' && m.date.slice(0, 7) === s.key.slice(0, 7)) idx = i;
      });
      if (idx < 0) return;
      var mx = padL + idx * (barW + gap) + barW / 2;
      parts.push('<line x1="' + mx + '" y1="' + padT + '" x2="' + mx + '" y2="' + (padT + innerH) + '" stroke="#0f766e" stroke-dasharray="2 3" opacity="0.4"/>');
      parts.push('<circle cx="' + mx + '" cy="' + (padT + 4) + '" r="3" fill="#0f766e"><title>' + esc((m.label || m.name) + ' · ' + prettyDay(m.date)) + '</title></circle>');
      if (showMilestoneLabels) {
        parts.push('<text x="' + mx + '" y="' + (padT - 8) + '" text-anchor="middle" fill="#0f766e" font-size="9">' + esc(m.name) + '</text>');
      }
    });

    if (useLine) {
      var pts = [];
      slots.forEach(function (item, i) {
        if (item.state !== 'day' && item.state !== 'week' && item.state !== 'month') return;
        var value = metricValue(item.sum, metric, rosterCount);
        if (value == null) return;
        var x = padL + i * (barW + gap) + barW / 2;
        var y = yOf(value);
        pts.push({ x: x, y: y, tip: slotTip(item, metric, average, rosterCount) });
      });
      if (pts.length) {
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x + ' ' + p.y; }).join(' ');
        parts.push('<path d="' + d + '" fill="none" stroke="#0f766e" stroke-width="2.5"/>');
        pts.forEach(function (p) {
          parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="#0f766e"><title>' + esc(p.tip) + '</title></circle>');
        });
      }
    }

    slots.forEach(function (item, i) {
      var x = padL + i * (barW + gap);
      var tip = slotTip(item, metric, average, rosterCount);
      var labelY = padT + innerH + 14;
      var subY = labelY + 12;
      if (item.state === 'holiday') {
        parts.push('<rect x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + innerH + '" rx="6" fill="none" stroke="#d1d5db" stroke-dasharray="4 3"><title>' + esc(tip) + '</title></rect>');
        parts.push('<text x="' + (x + barW / 2) + '" y="' + labelY + '" text-anchor="middle" fill="#9ca3af" font-size="10">' + esc(item.label) + '</text>');
        parts.push('<text x="' + (x + barW / 2) + '" y="' + subY + '" text-anchor="middle" fill="#9ca3af" font-size="9">Holiday</text>');
        return;
      }
      if (drawBars && !useLine) {
        var base = padT + innerH;
        if (metric === 'images') {
          var scale = max ? innerH / (max * 1.12 || 1) : 0;
          var hAuto = (item.sum.automated || 0) * scale;
          var hCustom = (item.sum.custom || 0) * scale;
          var hUnknown = (item.sum.unknown || 0) * scale;
          var y = base - hAuto - hCustom - hUnknown;
          parts.push('<g><title>' + esc(tip) + '</title>');
          if (hUnknown) parts.push('<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + hUnknown + '" fill="#c5cdd6"/>');
          if (hCustom) parts.push('<rect x="' + x + '" y="' + (y + hUnknown) + '" width="' + barW + '" height="' + hCustom + '" fill="#e08a3c"/>');
          if (hAuto) parts.push('<rect x="' + x + '" y="' + (base - hAuto) + '" width="' + barW + '" height="' + hAuto + '" rx="4" fill="#0f766e"/>');
          if (!item.sum.images) parts.push('<rect x="' + x + '" y="' + (base - 2) + '" width="' + barW + '" height="2" fill="#e5e7eb"/>');
          parts.push('</g>');
        } else {
          var barVal = metricValue(item.sum, metric, rosterCount);
          var top = barVal == null ? base : yOf(barVal);
          var bh = Math.max(0, base - top);
          parts.push('<g><title>' + esc(tip) + '</title>');
          if (bh > 0) parts.push('<rect x="' + x + '" y="' + top + '" width="' + barW + '" height="' + bh + '" rx="4" fill="#0f766e"/>');
          else parts.push('<rect x="' + x + '" y="' + (base - 2) + '" width="' + barW + '" height="2" fill="#e5e7eb"/>');
          parts.push('</g>');
        }
      }
      parts.push('<text x="' + (x + barW / 2) + '" y="' + labelY + '" text-anchor="middle" fill="#6b7280" font-size="10">' + esc(item.label) + '</text>');
      if (item.sub && n <= 14) {
        parts.push('<text x="' + (x + barW / 2) + '" y="' + subY + '" text-anchor="middle" fill="#9ca3af" font-size="9">' + esc(item.sub) + '</text>');
      }
    });

    if (state.dataStart) {
      parts.push('<text x="' + padL + '" y="' + (h - 6) + '" fill="#9ca3af" font-size="10">From ' + esc(prettyDay(state.dataStart)) + ' · weekends omitted · dots = beta releases</text>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  function numbersTable(slots, metric, rosterCount, youMode) {
    var cols = [
      { id: 'images', label: 'Images' },
      { id: 'automatic', label: 'Automatic' },
      { id: 'quality', label: 'Quality' },
      { id: 'tries', label: 'Tries' },
      { id: 'first', label: 'First-try' }
    ];
    if (!youMode) cols.push({ id: 'perAuthor', label: 'Per author' });
    cols.push({ id: 'perProduct', label: 'Per product' });
    var head = '<tr><th>Period</th>' + cols.map(function (col) {
      return '<th class="' + (col.id === metric ? 'is-col' : '') + '">' + esc(col.label) + '</th>';
    }).join('') + '</tr>';
    var body = slots.map(function (item) {
      var name = item.sub ? item.label + ' ' + item.sub : item.label;
      if (item.state === 'holiday') {
        return '<tr class="is-off"><td>' + esc(prettyDay(item.key)) + '</td><td colspan="' + cols.length + '">' + esc(item.holiday || 'Public holiday') + ' — left out</td></tr>';
      }
      return '<tr><td>' + esc(item.state === 'day' ? prettyDay(item.key) : name) + '</td>' + cols.map(function (col) {
        var val = metricValue(item.sum, col.id, rosterCount);
        var tone = toneFor(col.id, val);
        return '<td class="' + (col.id === metric ? 'is-col ' : '') + (tone ? 'tone-' + tone : '') + '">' + esc(metricText(col.id, val)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="num-wrap"><table class="nums"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function legend(metric, average, compare) {
    var meta = metricMeta(metric);
    var html = '';
    if (metric === 'images') {
      html += '<span><i class="swatch" style="background:#0f766e"></i>Automatic</span><span><i class="swatch" style="background:#e08a3c"></i>Custom</span>';
    } else {
      html += '<span><i class="swatch" style="background:#0f766e"></i>' + esc(meta.label) + '</span>';
    }
    if (average != null) html += '<span><i class="swatch line"></i>Avg ' + esc(metricText(metric, average)) + '</span>';
    if (compare != null) html += '<span><i class="swatch line team"></i>Team / author ' + esc(fmtSmart(compare, 'score')) + '</span>';
    return html;
  }

  function chartBody(slots, metric, view, rosterCount, compare, youMode) {
    if (view === 'numbers') return numbersTable(slots, metric, rosterCount, youMode);
    var average = lineValue(metric, slots, rosterCount);
    return chartSvg(slots, metric, average, rosterCount, compare, view === 'line' ? 'line' : 'bars');
  }

  function chartCard(id, title, tip, slots, metric, view, rosterCount, badge, compare, youMode) {
    var average = lineValue(metric, slots, rosterCount);
    var empty = !realSlots(slots).length && !slots.some(function (s) { return s.state === 'holiday'; });
    var body = empty
      ? '<div class="empty-plot">No approvals in this range.</div>'
      : chartBody(slots, metric, view, rosterCount, compare, !!youMode);
    var badgeHtml = badge ? '<span class="delta ' + badge.tone + '">' + esc(badge.text) + '</span>' : '';
    return '<article class="panel" data-chart="' + esc(id) + '">' +
      '<div class="panel-head"><h3>' + esc(title) + info(tip) + '</h3>' +
      '<div class="panel-actions">' + badgeHtml +
      '<button type="button" class="expand" data-act="expand" data-chart="' + esc(id) + '" title="Full screen" aria-label="Full screen">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>' +
      '</button></div></div>' +
      '<div class="legend">' + legend(metric, average, compare) + '</div>' +
      '<div class="chart-body" data-chart-body="' + esc(id) + '">' + body + '</div></article>';
  }

  function tile(label, tip, valueHtml, note, tone) {
    return '<article class="tile"><div class="k">' + esc(label) + info(tip) + '</div>' +
      '<div class="num ' + (tone ? 'tone-' + tone : '') + '">' + valueHtml + '</div>' +
      '<p class="sub ' + (tone || '') + '">' + esc(note || '') + '</p></article>';
  }

  function sheetAuthors() {
    var counts = {};
    state.days.forEach(function (row) {
      if (!row.author || isExcluded(row.author)) return;
      if (state.dataStart && row.date < state.dataStart) return;
      counts[row.author] = (counts[row.author] || 0) + row.images;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  }

  /**
   * People who count in "per author" for this range:
   * - never excluded names (Vinay)
   * - never zero-image people
   * - if roster is set, only roster names who have images in these rows
   * - names merged case-insensitively / first-name match
   */
  function authorsWithImages(rows, roster) {
    var groups = [];
    (rows || []).forEach(function (row) {
      if (!row.author || isExcluded(row.author)) return;
      var imgs = row.images || 0;
      if (imgs <= 0) return;
      if (roster && roster.length && !roster.some(function (r) { return matchesPerson(row.author, r); })) return;
      var found = null;
      for (var i = 0; i < groups.length; i++) {
        if (matchesPerson(row.author, groups[i].name)) {
          found = groups[i];
          break;
        }
      }
      if (found) {
        found.images += imgs;
      } else {
        groups.push({ name: row.author, images: imgs });
      }
    });
    return groups.sort(function (a, b) { return b.images - a.images; });
  }

  function sumDelta(currRows, prevRows, metric, rosterCount, vs) {
    return delta(
      metricValue(sumRows(currRows), metric, rosterCount),
      metricValue(sumRows(prevRows), metric, rosterCount),
      metricMeta(metric),
      vs
    );
  }

  function slotDelta(slots, metric, rosterCount, vs) {
    var live = realSlots(slots);
    if (live.length < 2) return null;
    return delta(
      metricValue(live[live.length - 1].sum, metric, rosterCount),
      metricValue(live[live.length - 2].sum, metric, rosterCount),
      metricMeta(metric),
      vs
    );
  }

  function last5Delta(rows, today, metric, rosterCount) {
    var curr = lastNWorkingDays(today, 5);
    if (curr.length < 5) return null;
    var prevEnd = fmt(addDays(parseISO(curr[0]), -1));
    var prev = lastNWorkingDays(prevEnd, 5);
    if (!prev.length) return null;
    return sumDelta(
      inRange(rows, curr[0], curr[curr.length - 1]),
      inRange(rows, prev[0], prev[prev.length - 1]),
      metric,
      rosterCount,
      'prior 5 days'
    );
  }

  function heroStat(label, tip, value, note, tone) {
    return '<div class="hero-stat"><div class="k">' + esc(label) + info(tip) + '</div>' +
      '<div class="num ' + (tone ? 'tone-' + tone : '') + '">' + esc(value) + '</div>' +
      '<p class="sub">' + esc(note) + '</p></div>';
  }

  function toolbar(who, metric, view, youMode) {
    var pills = METRICS.filter(function (m) { return !youMode || m.you; }).map(function (m) {
      return '<button type="button" class="' + (m.id === metric ? 'is-on' : '') + '" data-act="metric" data-who="' + who + '" data-value="' + m.id + '" data-tip="' + esc(m.tip) + '">' + esc(m.label) + '</button>';
    }).join('');
    return '<div class="chart-bar"><div class="view-toggle" role="group" aria-label="How to read the charts">' +
      '<button type="button" data-act="view" data-who="' + who + '" data-value="line" class="' + (view === 'line' ? 'is-on' : '') + '">Line</button>' +
      '<button type="button" data-act="view" data-who="' + who + '" data-value="bars" class="' + (view === 'bars' ? 'is-on' : '') + '">Bars</button>' +
      '<button type="button" data-act="view" data-who="' + who + '" data-value="numbers" class="' + (view === 'numbers' ? 'is-on' : '') + '">Numbers</button>' +
      '</div><div class="pills" role="group" aria-label="Figure to chart">' + pills + '</div></div>';
  }

  function leaderboard(rank) {
    if (!rank.length) return '<p class="sub">No roster approvals in this ' + esc(rangeWord()) + '.</p>';
    var open = state.rosterOpen;
    var visible = open ? rank : rank.slice(0, 3);
    var top = rank[0] ? rank[0].images : 0;
    var rows = visible.map(function (person, i) {
      var place = i + 1;
      var medal = place <= 3 ? ' rank-' + place : '';
      var imgTone = '';
      if (top > 0) {
        if (person.images >= top * 0.7) imgTone = 'tone-good';
        else if (person.images >= top * 0.4) imgTone = 'tone-mid';
        else imgTone = 'tone-bad';
      }
      return '<div class="rank-row' + medal + '"><b><span class="place">' + place + '</span> ' + esc(person.name) + '</b>' +
        '<span><span class="' + imgTone + '">' + person.images + ' images</span> · ' +
        (person.auto == null ? '—' : person.auto + '% auto') + '</span></div>';
    }).join('');
    var more = rank.length > 3
      ? '<button type="button" class="rank-more" data-act="roster">' + (open ? 'Show top 3 ▲' : 'Show all ' + rank.length + ' ▼') + '</button>'
      : '';
    return '<div class="rank">' + rows + more + '</div>';
  }

  function storeChart(id, payload) {
    if (!state._charts) state._charts = {};
    state._charts[id] = payload;
  }

  function openFs(id) {
    var payload = state._charts && state._charts[id];
    if (!payload) return;
    state.fs = id;
    document.getElementById('fs-title').textContent = payload.title;
    var body = payload.view === 'numbers'
      ? numbersTable(payload.slots, payload.metric, payload.rosterCount, id.indexOf('you') === 0)
      : chartSvg(
        payload.slots,
        payload.metric,
        payload.average,
        payload.rosterCount,
        payload.compare,
        payload.view === 'line' ? 'line' : 'fs'
      );
    document.getElementById('fs-body').innerHTML =
      '<div class="legend">' + legend(payload.metric, payload.average, payload.compare) + '</div>' + body;
    fsEl.hidden = false;
  }

  function closeFs() {
    state.fs = null;
    fsEl.hidden = true;
  }

  function render() {
    var today = kolkataToday();
    var roster = rosterList();
    var team = teamRows(today);
    var mine = youRows(today);
    var box = bounds(state.range, today, team);
    var prevBox = previousBounds(state.range, box);
    var days = workingDays(box.start, box.end, today);
    var teamNow = inRange(team, box.start, box.end);
    var teamPrev = prevBox ? inRange(team, prevBox.start, prevBox.end) : [];
    // Per-author divisor: only people with images in THIS range. Never zeros. Never Vinay.
    var activeAuthors = authorsWithImages(teamNow, roster);
    var headCount = activeAuthors.length || 0;
    var fig = figures(sumRows(teamNow), days, headCount);
    var prevDays = prevBox ? workingDays(prevBox.start, prevBox.end, today) : [];
    var prevActive = authorsWithImages(teamPrev, roster);
    var prev = figures(sumRows(teamPrev), prevDays, prevActive.length || 0);
    var youBox = bounds(state.range, today, mine.length ? mine : team);
    var youDays = workingDays(youBox.start, youBox.end, today);
    var youNow = inRange(mine, youBox.start, youBox.end);
    var youFig = figures(sumRows(youNow), youDays, 1);
    var youPrev = prevBox ? figures(sumRows(inRange(mine, prevBox.start, prevBox.end)), prevDays, 1) : figures(blankSum(), [], 1);
    var excluded = isExcluded(state.author);
    var recognized = isRecognizedAuthor(state.author);
    var outside = excluded || (roster.length && !onRoster(state.author));
    var startLabel = state.dataStart || firstDataDate();
    var rw = rangeWord();

    document.getElementById('signed').innerHTML = recognized
      ? ('Signed in as <strong>' + esc(displayName(state.author, state.days) || state.author) + '</strong>')
      : ('Signed in as <strong>' + esc(state.author) + '</strong> · personal stats hidden');
    document.getElementById('updated').innerHTML = 'Updated <strong>' + esc(stamp(state.readAt)) + '</strong>';
    document.getElementById('foot').textContent =
      'Counts and charts start ' + (startLabel ? prettyDay(startLabel) : 'on the first logged image') +
      '. Totals include Rate & Approve and Dimension images. Week tiles = last completed Mon–Fri vs the week before. Week charts = last 5 working days. Weekends omitted; holidays marked.';
    Array.prototype.forEach.call(document.querySelectorAll('[data-act="range"]'), function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-value') === state.range);
    });

    var main = document.getElementById('main');
    if (state.loading) {
      main.innerHTML = '<div class="skel"><i></i><i></i><i></i></div>';
      return;
    }
    if (state.error) {
      main.innerHTML = '<div class="banner">' + esc(state.error) + '</div>';
      return;
    }

    var vs = box.vs || 'last week';
    var autoDelta = delta(fig.automaticPct, prev.automaticPct, metricMeta('automatic'), vs);

    // Busiest / quietest: only working days inside the tile range (same days as the averages).
    var busiest = { images: -1, key: '' };
    var quietest = { images: Infinity, key: '' };
    days.forEach(function (key) {
      var n = 0;
      teamNow.forEach(function (row) { if (row.date === key) n += row.images; });
      if (n > busiest.images) busiest = { images: n, key: key };
      if (n <= quietest.images) quietest = { images: n, key: key };
    });
    if (!days.length) {
      busiest = { images: -1, key: '' };
      quietest = { images: -1, key: '' };
    }

    var rank = activeAuthors.map(function (person) {
      var sum = sumRows(teamNow.filter(function (row) { return matchesPerson(row.author, person.name); }));
      var classified = sum.automated + sum.custom;
      return {
        name: displayName(person.name, state.days),
        images: sum.images,
        auto: classified ? Math.round((sum.automated / classified) * 100) : null
      };
    }).sort(function (a, b) { return b.images - a.images; });

    var otherAuthors = sheetAuthors().filter(function (name) {
      return !roster.some(function (r) { return matchesPerson(name, r); });
    });
    var rosterMiss = roster.length && !fig.images && otherAuthors.length
      ? 'None of the roster names have approvals in this range. Authors on the sheet: ' + otherAuthors.join(', ') + '. Add them to roster in holidays.json.'
      : '';

    var leftSlots = state.range === 'all' ? dataWeekSlots(team, today) : last5Slots(today);
    var rightSlots = state.range === 'all' ? dataMonthSlots(team, today) : monthWorkSlots(today);
    fillSlots(leftSlots, team, today);
    fillSlots(rightSlots, team, today);

    var leftTitle = state.range === 'all' ? 'By week' : 'Last 5 working days';
    var rightTitle = state.range === 'all' ? 'By month' : monthFull(today) + ' working days';
    var leftTip = state.range === 'all'
      ? 'One point per week from the first logged image. Dashed line is the average. Teal dots mark beta releases.'
      : 'Last five Mon–Fri days that are not holidays, ending today. Today is the rightmost day when it is a working day. Compared with the prior five.';
    var rightTip = state.range === 'all'
      ? 'One point per month from the first logged image. Saturdays and Sundays are omitted from daily views.'
      : 'Working days only from the first logged image in this month through today. Saturdays and Sundays are omitted. Alternating bands mark each week. Holidays are marked and left out of averages.';

    var leftBadge = state.range === 'all'
      ? slotDelta(leftSlots, state.teamMetric, headCount, 'prior week')
      : last5Delta(team, today, state.teamMetric, headCount);
    var monthBox = bounds('month', today, team);
    var monthPrev = previousBounds('month', monthBox);
    var rightBadge = state.range === 'all'
      ? slotDelta(rightSlots, state.teamMetric, headCount, 'prior month')
      : sumDelta(inRange(team, monthBox.start, monthBox.end), inRange(team, monthPrev.start, monthPrev.end), state.teamMetric, headCount, 'last month');

    var youLeft = state.range === 'all' ? dataWeekSlots(mine, today) : last5Slots(today);
    var youRight = state.range === 'all' ? dataMonthSlots(mine, today) : monthWorkSlots(today);
    fillSlots(youLeft, mine, today);
    fillSlots(youRight, mine, today);
    var youLeftBadge = state.range === 'all'
      ? slotDelta(youLeft, state.youMetric, 1, 'prior week')
      : last5Delta(mine, today, state.youMetric, 1);
    var youRightBadge = state.range === 'all'
      ? slotDelta(youRight, state.youMetric, 1, 'prior month')
      : sumDelta(inRange(mine, monthBox.start, monthBox.end), inRange(mine, monthPrev.start, monthPrev.end), state.youMetric, 1, 'last month');

    var teamLine = lineValue('perAuthor', leftSlots, headCount);
    var youShare = fig.images ? Math.round((youFig.images / fig.images) * 100) : null;

    var weekBoxNow = lastCompletedWeekBounds(today);
    var weekBoxPrev = previousBounds('week', weekBoxNow);
    var youThisWeek = sumRows(inRange(mine, weekBoxNow.start, weekBoxNow.end)).images;
    var youLastWeek = sumRows(inRange(mine, weekBoxPrev.start, weekBoxPrev.end)).images;
    var ahead = youThisWeek - youLastWeek;

    var best = { images: -1, key: '' };
    youDays.forEach(function (key) {
      var n = 0;
      youNow.forEach(function (row) { if (row.date === key) n += row.images; });
      if (n > best.images) best = { images: n, key: key };
    });

    // YOU section: Your images vs team = your count (big) + team avg (like other comparison tiles).
    var aboveNote = vsRosterNote(fig.perAuthor);
    var vsAvgTone = tonePrefer('images', youFig.images, fig.perAuthor, 'up');
    var perAuthorTip = 'Your images in this ' + rw +
      '. Team line is images ÷ authors who have images in this ' + rw +
      '. Approve and Dimension both count in the team total.';

    var periodNote = state.range === 'week'
      ? ('Last week · ' + prettyDay(box.start) + ' – ' + prettyDay(box.end))
      : (state.range === 'month' ? 'This month through today' : 'Since ' + prettyDay(box.start));

    storeChart('team-left', { title: leftTitle, slots: leftSlots, metric: state.teamMetric, view: state.teamView, rosterCount: headCount, average: lineValue(state.teamMetric, leftSlots, headCount), compare: null });
    storeChart('team-right', { title: rightTitle, slots: rightSlots, metric: state.teamMetric, view: state.teamView, rosterCount: headCount, average: lineValue(state.teamMetric, rightSlots, headCount), compare: null });
    storeChart('you-left', { title: state.range === 'all' ? 'Your weeks' : 'Your last 5 working days', slots: youLeft, metric: state.youMetric, view: state.youView, rosterCount: 1, average: lineValue(state.youMetric, youLeft, 1), compare: state.youMetric === 'images' ? teamLine : null });
    storeChart('you-right', { title: state.range === 'all' ? 'Your months' : 'Your ' + monthFull(today), slots: youRight, metric: state.youMetric, view: state.youView, rosterCount: 1, average: lineValue(state.youMetric, youRight, 1), compare: null });

    var autoTrendLine = 'Automatic image generation is ' + fmtSmart(fig.automaticPct, 'pct') + ' for this ' + rw + '.';
    if (autoDelta && prev.automaticPct != null) {
      autoTrendLine += ' Last ' + (state.range === 'month' ? 'month' : 'week') + ' it was ' +
        fmtSmart(prev.automaticPct, 'pct') + ' (' + autoDelta.text.replace(' vs ' + vs, '') + ').';
    }

    main.innerHTML =
      '<section class="block"><h2>Team</h2>' +
      '<p class="period">' + esc(periodNote) + ' · compared with ' + esc(vs) + '</p>' +
      '<div class="hero">' +
        '<div><div class="hero-label">AUTOMATIC IMAGE GENERATION ' + info('Share of Rate & Approve images that used the automatic prompt. Automatic ÷ (automatic + custom).') + '</div>' +
        '<div class="hero-pct ' + (toneFor('automatic', fig.automaticPct) ? 'tone-' + toneFor('automatic', fig.automaticPct) : '') + '">' + esc(fmtSmart(fig.automaticPct, 'pct')) + '</div>' +
        '<p class="mix"><i class="dot-auto"></i>' + fig.automated + ' automatic · <i class="dot-custom"></i>' + fig.custom + ' custom · <i class="dot-unknown"></i>' + fig.unknown + ' unclassified</p></div>' +
        '<div class="hero-stats">' +
          heroStat('Images generated', 'Total images in this ' + rw + ': Rate & Approve plus Dimension. Only working days from ' + (startLabel ? prettyDay(startLabel) : 'the first logged image') + '.', fmtSmart(fig.images, 'int'), (fig.approve || 0) + ' approve · ' + (fig.mdim || 0) + ' Dimension', tonePrefer('images', fig.images, prev.images, 'up')) +
          heroStat('Per author', 'Team images ÷ authors who have at least one image in this ' + rw + '.', fmtSmart(fig.perAuthor, 'score'), headCount ? (headCount + ' authors with images') : 'No authors', tonePrefer('perAuthor', fig.perAuthor, prev.perAuthor, 'up')) +
          heroStat('Per working day', 'Team images ÷ working days in this ' + rw + ', from the first logged image onward.', fmtSmart(fig.perDay, 'score'), days.length + ' working days', tonePrefer('perDay', fig.perDay, prev.perDay, 'up')) +
        '</div></div>' +
      (rosterMiss ? '<p class="roster-note">' + esc(rosterMiss) + '</p>' : '') +
      '<div class="tiles">' +
        tile('Per working week', 'Team images ÷ weeks with at least one working day. Compared with the previous ' + (state.range === 'month' ? 'month' : 'week') + '.', esc(fmtSmart(fig.perWeek, 'score')), 'vs ' + vs, tonePrefer('images', fig.perWeek, prev.perWeek, 'up')) +
        tile('Author / work day', 'Images per author ÷ working days.', esc(fmtSmart(fig.perAuthorPerDay, 'score')), 'Roster average', tonePrefer('perAuthor', fig.perAuthorPerDay, prev.perAuthorPerDay, 'up')) +
        tile('Average quality', 'Mean star rating. Also shown as percent of 5.', esc(metricText('quality', fig.quality)), 'out of 5', toneFor('quality', fig.quality)) +
        tile('Average tries', 'Mean Generate clicks before approve. Lower is better.', esc(fmtSmart(fig.tries, 'score')), 'per approved image', toneFor('tries', fig.tries)) +
        tile('First-try rate', 'Share approved on generation count 1.', esc(fmtSmart(fig.firstPct, 'pct')), 'approved on try 1', toneFor('first', fig.firstPct)) +
        tile('Images / product', 'Team images ÷ distinct EANs.', esc(fmtSmart(fig.perProduct, 'score')), fig.products + ' products', '') +
      '</div>' +
      toolbar('team', state.teamMetric, state.teamView, false) +
      '<div class="charts">' +
        chartCard('team-left', leftTitle, leftTip, leftSlots, state.teamMetric, state.teamView, headCount, leftBadge, null, false) +
        chartCard('team-right', rightTitle, rightTip, rightSlots, state.teamMetric, state.teamView, headCount, rightBadge, null, false) +
      '</div>' +
      '<div class="insights">' +
        '<article class="insight"><div class="k">Leaderboard ' + info('People ranked by image count for this ' + rw + '. Top 3 highlighted. Color on the count follows share of the leader’s volume.') + '</div>' + leaderboard(rank) + '</article>' +
        '<article class="insight"><div class="k">Vs last ' + (state.range === 'month' ? 'month' : 'week') + ' ' + info('How automatic image generation this ' + rw + ' compares with the previous period of the same length.') + '</div><p class="' + (autoDelta ? autoDelta.tone : '') + '">' + esc(autoTrendLine) + '</p></article>' +
        '<article class="insight"><div class="k">Pace extremes ' + info('Working days inside this ' + rw + ' only (same window as the headline averages).') + '</div><p>Busiest: ' + (busiest.key ? esc(prettyDay(busiest.key) + ', ' + busiest.images + ' images') : '—') + '</p><p class="sub">Quietest: ' + (quietest.key && quietest.images >= 0 ? esc(prettyDay(quietest.key) + ', ' + quietest.images + ' images') : '—') + '</p></article>' +
      '</div></section>' +

      (recognized
        ? ('<section class="block"><h2>' + esc(displayName(state.author, state.days) || state.author) + '</h2>' +
          (outside
            ? '<p class="exclude-note">You are not counted in the team totals above. This section is only your own images. You do not appear on the leaderboard.</p>'
            : '') +
          '<div class="tiles you">' +
            tile('Images generated', 'Your images in this ' + rw + '. Approve and Dimension both count.', esc(fmtSmart(youFig.images, 'int')), (youFig.approve || 0) + ' approve · ' + (youFig.mdim || 0) + ' Dimension', tonePrefer('images', youFig.images, youPrev.images, 'up')) +
            tile('Your images vs team', perAuthorTip, esc(fmtSmart(youFig.images, 'int')), aboveNote, vsAvgTone) +
            tile('Automatic share', 'Your automatic ÷ (automatic + custom). Compared with the team when shown.', esc(fmtSmart(youFig.automaticPct, 'pct')), 'team ' + fmtSmart(fig.automaticPct, 'pct'), tonePrefer('automatic', youFig.automaticPct, fig.automaticPct, 'up')) +
            tile('Per working day', 'Your images ÷ working days. Compared with the team per-author day rate.', esc(fmtSmart(youFig.perDay, 'score')), 'team per author ' + fmtSmart(fig.perAuthorPerDay, 'score'), tonePrefer('perDay', youFig.perDay, fig.perAuthorPerDay, 'up')) +
            tile('Per working week', 'Your images ÷ weeks with a working day. Compared with your previous period.', esc(fmtSmart(youFig.perWeek, 'score')), 'vs ' + vs, tonePrefer('images', youFig.perWeek, youPrev.perWeek, 'up')) +
            tile('Average quality', 'Your mean star rating, also as % of 5. Compared with the team.', esc(metricText('quality', youFig.quality)), 'team ' + metricText('quality', fig.quality), tonePrefer('quality', youFig.quality, fig.quality, 'up')) +
            tile('Average tries', 'Your mean tries. Lower is better. Compared with the team.', esc(fmtSmart(youFig.tries, 'score')), 'team ' + fmtSmart(fig.tries, 'score'), tonePrefer('tries', youFig.tries, fig.tries, 'down')) +
            tile('First-try rate', 'Your share approved on try 1. Compared with the team.', esc(fmtSmart(youFig.firstPct, 'pct')), 'team ' + fmtSmart(fig.firstPct, 'pct'), tonePrefer('first', youFig.firstPct, fig.firstPct, 'up')) +
          '</div>' +
          toolbar('you', state.youMetric, state.youView, true) +
          '<div class="charts">' +
            chartCard('you-left', state.range === 'all' ? 'Your weeks' : 'Your last 5 working days', 'Same window as the team progress chart, scoped to you. Line shows how Automatic, quality, and pace change.', youLeft, state.youMetric, state.youView, 1, youLeftBadge, state.youMetric === 'images' || state.youMetric === 'perDay' ? teamLine : null, true) +
            chartCard('you-right', state.range === 'all' ? 'Your months' : 'Your ' + monthFull(today), 'Your working days this month from the first logged image (weekends omitted). Week bands mark Mon–Fri groups.', youRight, state.youMetric, state.youView, 1, youRightBadge, null, true) +
          '</div>' +
          '<div class="insights">' +
            '<article class="insight"><div class="k">Team share</div><p>' + (outside ? 'Your images sit outside the team total.' : (youShare == null ? 'No team images in this ' + esc(rw) + '.' : 'You contributed ' + youShare + '% of team images')) + '</p><p class="sub">' + youFig.images + ' of ' + fig.images + ' in this ' + esc(rw) + '</p></article>' +
            '<article class="insight"><div class="k">Best day</div><p>' + (best.key ? esc(prettyDay(best.key) + ', ' + best.images + ' images') : '—') + '</p></article>' +
            '<article class="insight"><div class="k">Pace vs last week ' + info('Your images in the last completed Mon–Fri week minus the week before that.') + '</div><p class="' + (ahead > 0 ? 'good' : (ahead < 0 ? 'bad' : '')) + '">' + (ahead === 0 ? 'Level with the prior week' : Math.abs(ahead) + ' images ' + (ahead > 0 ? 'ahead of' : 'behind') + ' the prior week') + '</p><p class="sub">' + esc(prettyDay(weekBoxNow.start) + ' – ' + prettyDay(weekBoxNow.end)) + '</p></article>' +
          '</div></section>')
        : ('<section class="block"><h2>Personal stats</h2>' +
          '<p class="exclude-note">No personal section for <strong>' + esc(state.author) + '</strong>. That name is not on the roster and has no images in the prompt database. Team figures above are still visible. Change the author name in the playground to a team member to see personal stats.</p></section>'));
  }

  function showTip(el) {
    var text = el.getAttribute('data-tip');
    if (!text) { tipEl.hidden = true; return; }
    tipEl.textContent = text;
    tipEl.hidden = false;
    var r = el.getBoundingClientRect();
    var w = tipEl.offsetWidth;
    var h = tipEl.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
    var top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }

  function jsonp(query) {
    return new Promise(function (resolve, reject) {
      var root = typeof STATS_FEED_URL === 'string' ? STATS_FEED_URL.trim() : '';
      if (!root) { reject(new Error('STATS_FEED_URL is not set.')); return; }
      var cb = '__statsFeed' + Date.now();
      var settled = false;
      var script = document.createElement('script');
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('The prompt database took too long to answer.'));
      }, 60000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (err) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (body) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(body);
      };
      script.onerror = function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Could not reach the prompt database. Open this page while signed in to Livspace.'));
      };
      script.src = root + (root.indexOf('?') >= 0 ? '&' : '?') + query + '&callback=' + cb;
      document.head.appendChild(script);
    });
  }

  function load() {
    state.loading = true;
    state.error = '';
    render();
    Promise.all([
      jsonp('action=stats'),
      fetch('holidays.json', { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('holidays');
        return res.json();
      }).catch(function () {
        return { timezone: 'Asia/Kolkata', exclude: ['vinay'], roster: [], holidays: [], milestones: [], dataStart: '2025-11-05' };
      })
    ]).then(function (results) {
      var body = results[0];
      if (!body || body.ok === false) {
        throw new Error((body && body.error) || 'Stats feed failed. Deploy Prompt Database Code.gs so action=stats is live, then reload.');
      }
      var data = body.data || body;
      if (!data || !data.days) {
        throw new Error('This prompt database deployment has no stats action yet. Deploy Code.gs version 16+, then reload.');
      }
      state.cfg = results[1] || state.cfg;
      if (!state.cfg.exclude || !state.cfg.exclude.length) state.cfg.exclude = ['vinay'];
      state.holidayMap = {};
      (state.cfg.holidays || []).forEach(function (item) {
        if (item && item.date) state.holidayMap[item.date] = item.name || 'Holiday';
      });
      state.milestones = (state.cfg.milestones || []).slice().sort(function (a, b) {
        return String(a.date).localeCompare(String(b.date));
      });
      // Resolve start from first logged image (and optional holidays.json floor), then drop earlier rows.
      state.days = data.days || [];
      state.dataStart = resolveDataStart(data.firstAt || '');
      if (state.dataStart) {
        state.days = state.days.filter(function (row) { return row.date >= state.dataStart; });
      }
      state.readAt = data.readAt || '';
      state.loading = false;
      render();
    }).catch(function (err) {
      state.loading = false;
      state.error = err && err.message ? err.message : 'Could not load statistics.';
      render();
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var value = btn.getAttribute('data-value');
    var who = btn.getAttribute('data-who');
    if (act === 'range') {
      state.range = value;
      remember('stats.range', value);
    } else if (act === 'metric') {
      if (who === 'you') { state.youMetric = value; remember('stats.youMetric', value); }
      else { state.teamMetric = value; remember('stats.teamMetric', value); }
    } else if (act === 'view') {
      if (who === 'you') { state.youView = value; remember('stats.youView', value); }
      else { state.teamView = value; remember('stats.teamView', value); }
    } else if (act === 'roster') {
      state.rosterOpen = !state.rosterOpen;
      remember('stats.rosterOpen', state.rosterOpen ? '1' : '0');
    } else if (act === 'expand') {
      openFs(btn.getAttribute('data-chart'));
      return;
    } else return;
    render();
  });

  document.getElementById('fs-close').addEventListener('click', closeFs);
  fsEl.addEventListener('click', function (e) {
    if (e.target === fsEl) closeFs();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.fs) closeFs();
  });

  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el) { tipEl.hidden = true; return; }
    showTip(el);
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) tipEl.hidden = true;
  });
  document.addEventListener('focusin', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-tip')) showTip(e.target);
  });
  document.addEventListener('focusout', function () { tipEl.hidden = true; });

  document.getElementById('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('gate-name').value.trim();
    if (!name) return;
    try { localStorage.setItem(AUTHOR_KEY, name); } catch (err) { /* ignore */ }
    state.author = name;
    document.getElementById('gate').hidden = true;
    document.getElementById('page').hidden = false;
    load();
  });

  state.author = '';
  try { state.author = localStorage.getItem(AUTHOR_KEY) || ''; } catch (err) { state.author = ''; }
  state.author = state.author.trim();
  if (!state.author) {
    document.getElementById('gate').hidden = false;
  } else {
    document.getElementById('page').hidden = false;
    load();
  }
})();
