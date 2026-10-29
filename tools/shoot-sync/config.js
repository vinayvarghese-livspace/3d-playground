'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

module.exports = {
  root: ROOT,
  spreadsheetId: '1mowqAXZMzYmy-EXrl3gAiqX72FjWn0FBlPZD9ZsuBIw',
  xlsxPath: path.join(ROOT, 'Data', 'Shoot Tracker - HH', 'Shoot Tracker - HH .xlsx'),
  versionsDir: path.join(ROOT, 'Data', 'Shoot Tracker - HH', 'versions'),
  // Manual safety copies of the live playground sheet (your downloaded Google Sheet export).
  playgroundSheetDir: path.join(ROOT, 'Data', '3D playground_Shoot Tracker - HH'),
  playgroundSheetXlsx: path.join(ROOT, 'Data', '3D playground_Shoot Tracker - HH', '3D playground_Shoot Tracker - HH .xlsx'),
  playgroundBackupsDir: path.join(ROOT, 'Data', '3D playground_Shoot Tracker - HH', 'backups'),
  // Local mirror of Sync Meta (CLI / UI status). Playground reads the sheet tab "Sync Meta" via Apps Script.
  metaJsonPath: path.join(ROOT, 'Data', 'Shoot Tracker - HH', 'shoot-sync-meta.json'),
  credentialsDir: path.join(__dirname, '.credentials'),
  credentialsPath: path.join(__dirname, '.credentials', 'credentials.json'),
  tokenPath: path.join(__dirname, '.credentials', 'token.json'),
  maxVersions: 15,
  productTabs: [
    'Decor and Garden',
    'Table Top & Bath',
    'Kitchen & Laundry'
  ],
  uploadLogTab: 'Upload Log',
  syncMetaTab: 'Sync Meta',
  changeLogTab: 'Sync Change Log',
  // Headers kept on product tabs (matched case/space-insensitive). Order = destination column order.
  productColumns: [
    'EAN CODE',
    'DEPARTMENT',
    'CATEGORY',
    'SUB-CATEGORY',
    'PRODUCT NAME',
    'STYLE',
    'SET / PCS',
    'Product Size',
    'Product Dimension',
    'Product Capacity',
    'MANDATORY SHOT LIST (SEQUENCE)',
    'PDP GUIDELINE LINK',
    'GDRIVE LINK',
    'TEMPLATE MAPPING',
    'Functional Prop',
    'STYLING/ PROPS NEEDED (Y/N)',
    'PHOTOSHOOT STATUS',
    'PHOTOSHOOT REMARKS',
    'UPLOAD STATUS',
    'UPLOAD DATE',
    'SHOOT DATE'
  ],
  // Upload Log: A = EAN, E = folder link (0-based in source grid; we write a 2-col sheet view).
  uploadLog: {
    eanHeader: 'EAN',
    linkHeader: 'EAN Folder Link',
    sourceEanCol: 0,
    sourceLinkCol: 4
  },
  linkColumns: ['PDP GUIDELINE LINK', 'GDRIVE LINK'],
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ]
};
