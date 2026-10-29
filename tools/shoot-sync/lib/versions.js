'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { stampVersionId } = require('./util');

function ensureVersionsDir() {
  fs.mkdirSync(config.versionsDir, { recursive: true });
}

function versionPath(id) {
  return path.join(config.versionsDir, id);
}

function listVersions() {
  ensureVersionsDir();
  return fs.readdirSync(config.versionsDir)
    .filter((n) => n.startsWith('v') && fs.statSync(versionPath(n)).isDirectory())
    .sort()
    .reverse()
    .map((id) => {
      const manifestPath = path.join(versionPath(id), 'manifest.json');
      let manifest = { id };
      if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { /* ignore */ }
      }
      if (!manifest.id) manifest.id = id;
      return manifest;
    });
}

function latestVersion() {
  return listVersions()[0] || null;
}

function createVersionDir() {
  ensureVersionsDir();
  const id = stampVersionId();
  const dir = versionPath(id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir };
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pruneVersions() {
  const list = listVersions();
  const keep = new Set();
  let keptUnpinned = 0;
  for (const m of list) {
    if (m.pinned) {
      keep.add(m.id);
      continue;
    }
    if (keptUnpinned < config.maxVersions) {
      keep.add(m.id);
      keptUnpinned++;
    }
  }
  for (const m of list) {
    if (keep.has(m.id)) continue;
    fs.rmSync(versionPath(m.id), { recursive: true, force: true });
  }
}

module.exports = {
  ensureVersionsDir,
  versionPath,
  listVersions,
  latestVersion,
  createVersionDir,
  writeJson,
  readJson,
  pruneVersions
};
