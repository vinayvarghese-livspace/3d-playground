'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { readSourceTabs } = require('./readXlsx');
const { mergeProductTab, mergeUploadLog } = require('./diff');
const {
  getAuth, sheetsApi, readDestination, toSheetValues,
  writeTabGrid, writeSyncMeta, appendChangeLog
} = require('./sheets');
const {
  createVersionDir, writeJson, readJson, versionPath,
  listVersions, latestVersion, pruneVersions
} = require('./versions');
const { fmtLocal, stampVersionId } = require('./util');

/** Local mirror of Sync Meta for the shoot-sync UI. Playground reads the sheet tab via Apps Script. */
function writeLocalMeta(meta) {
  writeJson(config.metaJsonPath, Object.assign({
    updatedAt: new Date().toISOString()
  }, meta));
  console.log('Wrote', config.metaJsonPath);
}

/** Keep a copy under Data/3D playground_Shoot Tracker - HH/backups for manual recovery. */
function retainPlaygroundBackup(versionId, preSync) {
  fs.mkdirSync(config.playgroundBackupsDir, { recursive: true });
  const folder = path.join(config.playgroundBackupsDir, versionId || stampVersionId());
  fs.mkdirSync(folder, { recursive: true });
  writeJson(path.join(folder, 'pre-sync.json'), preSync);
  writeJson(path.join(folder, 'README.json'), {
    note: 'Snapshot of native Google Sheet tabs before sync. Use shoot-sync Roll back, or keep the .xlsx copy below.',
    spreadsheetId: config.spreadsheetId,
    versionId: versionId || null,
    savedAt: new Date().toISOString()
  });
  // Also archive the manual xlsx export if present (your current download of the live sheet).
  if (fs.existsSync(config.playgroundSheetXlsx)) {
    const destXlsx = path.join(
      config.playgroundBackupsDir,
      '3D playground_Shoot Tracker - HH_' + (versionId || stampVersionId()) + '.xlsx'
    );
    fs.copyFileSync(config.playgroundSheetXlsx, destXlsx);
    console.log('Retained playground sheet copy:', destXlsx);
  }
  console.log('Retained backup folder:', folder);
  return folder;
}

function summarize(plan) {
  const lines = [];
  let newTotal = 0;
  let changeTotal = 0;
  for (const tab of config.productTabs) {
    const m = plan.product[tab];
    if (!m) continue;
    newTotal += m.newEans.length;
    changeTotal += m.changes.length;
    lines.push(
      tab + ': ' + m.rows.length + ' rows after merge | NEW ' + m.newEans.length +
      ' | CHANGED fields ' + m.changes.length
    );
  }
  const u = plan.uploadLog;
  newTotal += u.newEans.length;
  changeTotal += u.changes.length;
  lines.push(
    config.uploadLogTab + ': ' + u.rows.length + ' rows | NEW ' + u.newEans.length +
    ' | CHANGED fields ' + u.changes.length
  );
  return { lines, newTotal, changeTotal };
}

async function buildPlan(opts = {}) {
  console.log('Reading local xlsx…');
  const source = await readSourceTabs(config.xlsxPath);
  if (source.missing.length) {
    console.warn('Missing tabs in xlsx (skipped):', source.missing.join(', '));
  }
  console.log('XLSX modified:', fmtLocal(source.xlsxModified), '(' + Math.round(source.xlsxBytes / 1024 / 1024) + ' MB)');

  let dest = { product: {}, uploadLog: { headers: [], rows: [], byEan: new Map() } };
  if (!opts.skipSheet) {
    console.log('Reading destination Google Sheet…');
    const auth = await getAuth();
    const sheets = sheetsApi(auth);
    dest = await readDestination(sheets);
  }

  const product = {};
  for (const tab of config.productTabs) {
    product[tab] = mergeProductTab(
      dest.product[tab] || { headers: config.productColumns, rows: [], byEan: new Map() },
      source.product[tab] || { headers: config.productColumns, rows: [], byEan: new Map() },
      tab
    );
  }
  const uploadLog = mergeUploadLog(
    dest.uploadLog || { rows: [], byEan: new Map() },
    source.uploadLog || { rows: [], byEan: new Map() }
  );

  return { source, dest, product, uploadLog };
}

async function dryRun() {
  const plan = await buildPlan();
  const sum = summarize(plan);
  console.log('\n--- Dry run ---');
  sum.lines.forEach((l) => console.log(l));
  console.log('Total NEW EANs:', sum.newTotal);
  console.log('Total CHANGED fields (existing EANs only):', sum.changeTotal);
  const sample = [];
  for (const tab of config.productTabs) {
    (plan.product[tab].changes || []).slice(0, 5).forEach((c) => sample.push(c));
  }
  plan.uploadLog.changes.slice(0, 3).forEach((c) => sample.push(c));
  if (sample.length) {
    console.log('\nSample changes:');
    sample.slice(0, 12).forEach((c) => {
      console.log('  [' + c.tab + '] ' + c.ean + ' / ' + c.column);
      console.log('    - ' + String(c.old).slice(0, 80));
      console.log('    + ' + String(c.new).slice(0, 80));
    });
  }
  return plan;
}

function snapshotFromDest(dest) {
  const tabs = {};
  for (const tab of config.productTabs) {
    const p = dest.product[tab];
    tabs[tab] = p && p._raw ? p._raw : toSheetValues(p || { headers: config.productColumns, rows: [] });
  }
  tabs[config.uploadLogTab] = dest.uploadLog && dest.uploadLog._raw
    ? dest.uploadLog._raw
    : toSheetValues(dest.uploadLog || { headers: ['EAN', 'EAN Folder Link'], rows: [] });
  return { tabs, savedAt: new Date().toISOString() };
}

async function runSync() {
  const plan = await buildPlan();
  const sum = summarize(plan);
  console.log('\n--- Sync plan ---');
  sum.lines.forEach((l) => console.log(l));

  const auth = await getAuth();
  const sheets = sheetsApi(auth);

  const { id, dir } = createVersionDir();
  console.log('\nVersion backup:', id);

  const preSync = snapshotFromDest(plan.dest);
  writeJson(path.join(dir, 'pre-sync.json'), preSync);
  retainPlaygroundBackup(id, preSync);

  const allChanges = [];
  for (const tab of config.productTabs) {
    allChanges.push(...plan.product[tab].changes);
  }
  allChanges.push(...plan.uploadLog.changes);

  const diffPayload = {
    newEans: Object.fromEntries(config.productTabs.map((t) => [t, plan.product[t].newEans])),
    uploadNew: plan.uploadLog.newEans,
    changes: allChanges
  };
  writeJson(path.join(dir, 'diff.json'), diffPayload);

  const manifest = {
    id,
    pinned: false,
    status: 'started',
    startedAt: new Date().toISOString(),
    xlsxPath: config.xlsxPath,
    xlsxModified: plan.source.xlsxModified,
    xlsxBytes: plan.source.xlsxBytes,
    newRows: sum.newTotal,
    changedFields: sum.changeTotal
  };
  writeJson(path.join(dir, 'manifest.json'), manifest);

  const syncedAt = new Date().toISOString();
  try {
    for (const tab of config.productTabs) {
      const grid = toSheetValues(plan.product[tab]);
      console.log('Writing', tab, '…', grid.length - 1, 'data rows');
      await writeTabGrid(sheets, tab, grid);
    }
    const uploadGrid = toSheetValues(plan.uploadLog);
    console.log('Writing', config.uploadLogTab, '…', uploadGrid.length - 1, 'data rows');
    await writeTabGrid(sheets, config.uploadLogTab, uploadGrid);

    const meta = {
      xlsxSyncedAt: syncedAt,
      xlsxFileName: path.basename(config.xlsxPath),
      xlsxFileModified: plan.source.xlsxModified,
      syncVersionId: id,
      status: 'ok',
      newRows: sum.newTotal,
      changedFields: sum.changeTotal
    };
    // Optional sheet tab for operators looking at the workbook (independent of Code.gs).
    await writeSyncMeta(sheets, meta);
    await appendChangeLog(sheets, allChanges, syncedAt);
    writeLocalMeta(meta);

    const post = {};
    for (const tab of config.productTabs) post[tab] = toSheetValues(plan.product[tab]);
    post[config.uploadLogTab] = uploadGrid;
    writeJson(path.join(dir, 'post-sync.json'), { tabs: post, savedAt: syncedAt });

    manifest.status = 'ok';
    manifest.finishedAt = syncedAt;
    writeJson(path.join(dir, 'manifest.json'), manifest);
    pruneVersions();

    console.log('\nSync OK. Version', id);
    console.log('Refresh the 3D Playground (preview) to see updated sheet data + Data last sync.');
    return { id, sum };
  } catch (err) {
    manifest.status = 'failed';
    manifest.error = String(err.message || err);
    manifest.finishedAt = new Date().toISOString();
    writeJson(path.join(dir, 'manifest.json'), manifest);
    console.error('\nSync FAILED:', manifest.error);
    console.error('Rollback with: npm run rollback -- --version ' + id);
    throw err;
  }
}

async function runRollback(versionId) {
  const target = versionId
    ? listVersions().find((v) => v.id === versionId)
    : latestVersion();
  if (!target) throw new Error('No version found to roll back.');
  const id = target.id;
  const prePath = path.join(versionPath(id), 'pre-sync.json');
  const pre = readJson(prePath);
  if (!pre.tabs) throw new Error('pre-sync.json missing tabs in ' + id);

  console.log('Rolling back to pre-sync snapshot of', id);
  const auth = await getAuth();
  const sheets = sheetsApi(auth);

  for (const tab of Object.keys(pre.tabs)) {
    console.log('Restoring', tab, '…');
    await writeTabGrid(sheets, tab, pre.tabs[tab] || []);
  }

  const rolledAt = new Date().toISOString();
  const meta = {
    xlsxSyncedAt: rolledAt,
    xlsxFileName: '(rollback)',
    xlsxFileModified: '',
    syncVersionId: id + '-rollback',
    status: 'rolled_back',
    newRows: '',
    changedFields: '',
    rolledBackFrom: id
  };
  await writeSyncMeta(sheets, meta);
  writeLocalMeta(meta);

  const rbDir = createVersionDir();
  writeJson(path.join(rbDir.dir, 'manifest.json'), {
    id: rbDir.id,
    pinned: false,
    status: 'rollback',
    rolledBackFrom: id,
    finishedAt: rolledAt
  });
  writeJson(path.join(rbDir.dir, 'pre-sync.json'), pre);

  console.log('Rollback complete. Refresh the 3D Playground.');
  return { id, rolledAt };
}

function printVersions() {
  const list = listVersions();
  if (!list.length) {
    console.log('No local versions yet. Run npm run sync first.');
    return;
  }
  console.log('Local versions (newest first):');
  list.forEach((m) => {
    console.log(
      '  ' + m.id +
      '  [' + (m.status || '?') + ']' +
      (m.pinned ? ' PINNED' : '') +
      (m.changedFields != null ? '  changed=' + m.changedFields : '') +
      (m.newRows != null ? ' new=' + m.newRows : '')
    );
  });
}

module.exports = { dryRun, runSync, runRollback, printVersions, buildPlan };
