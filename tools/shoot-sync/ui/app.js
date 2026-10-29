'use strict';

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const versionSelect = document.getElementById('version-select');
const buttons = ['btn-dry', 'btn-sync', 'btn-rollback', 'btn-refresh'].map((id) => document.getElementById(id));

function log(msg, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.textContent = '';
}

function setBusy(busy) {
  buttons.forEach((b) => { b.disabled = busy; });
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
  return data;
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

async function refreshStatus() {
  const s = await api('/api/status');
  statusEl.innerHTML =
    '<div><strong>XLSX file</strong><br>' + escapeHtml(s.xlsxPath) + '</div>' +
    '<div>Exists: <strong>' + (s.xlsxExists ? 'yes' : 'no — download and save here first') + '</strong>' +
      (s.xlsxModified ? ' · modified ' + escapeHtml(fmt(s.xlsxModified)) : '') +
      (s.xlsxBytes ? ' · ' + Math.round(s.xlsxBytes / 1024 / 1024) + ' MB' : '') +
    '</div>' +
    '<div>Google Sheet: <strong>' + escapeHtml(s.spreadsheetId) + '</strong></div>' +
    '<div>Last sync: <strong>' + escapeHtml(fmt(s.lastSync && s.lastSync.xlsxSyncedAt)) + '</strong>' +
      (s.lastSync && s.lastSync.status ? ' (' + escapeHtml(s.lastSync.status) + ')' : '') +
    '</div>' +
    '<div>Manual sheet backup folder: <strong>' + escapeHtml(s.playgroundBackupsDir || '') + '</strong>' +
      (s.playgroundBackupCount != null ? ' (' + s.playgroundBackupCount + ' items)' : '') +
    '</div>' +
    '<div>Auth: <strong>' + (s.authed ? 'ready' : 'needed — click Sync once or run npm run auth') + '</strong></div>';

  versionSelect.innerHTML = '';
  (s.versions || []).forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.id + ' [' + (v.status || '?') + ']' +
      (v.changedFields != null ? ' · changed ' + v.changedFields : '');
    versionSelect.appendChild(opt);
  });
  if (!(s.versions || []).length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No backups yet';
    versionSelect.appendChild(opt);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function runAction(name, path) {
  clearLog();
  log(name + '…');
  setBusy(true);
  try {
    const data = await api(path, { method: 'POST' });
    (data.log || []).forEach((line) => log(line));
    if (data.ok) log('Done.', 'ok');
    else log(data.error || 'Failed', 'err');
    await refreshStatus();
  } catch (err) {
    log(String(err.message || err), 'err');
  } finally {
    setBusy(false);
  }
}

document.getElementById('btn-refresh').onclick = async () => {
  try {
    await refreshStatus();
    log('Status refreshed.', 'ok');
  } catch (err) {
    log(String(err.message || err), 'err');
  }
};

document.getElementById('btn-dry').onclick = () => runAction('Preview', '/api/dry-run');
document.getElementById('btn-sync').onclick = () => {
  if (!confirm('Sync will update the live Google Sheet used by the 3D Playground.\nA local backup is saved first.\nContinue?')) return;
  runAction('Sync', '/api/sync');
};
document.getElementById('btn-rollback').onclick = () => {
  const id = versionSelect.value;
  if (!id) {
    log('No version selected.', 'err');
    return;
  }
  if (!confirm('Roll back the Google Sheet to backup ' + id + '?')) return;
  runAction('Rollback ' + id, '/api/rollback?version=' + encodeURIComponent(id));
};

refreshStatus().catch((err) => {
  statusEl.textContent = String(err.message || err);
});
