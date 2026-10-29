'use strict';

const fs = require('fs');
const ExcelJS = require('exceljs');
const { cellText, cellLink } = require('./util');
const { projectProductGrid, projectUploadLog } = require('./columns');
const config = require('../config');

async function readWorkbook(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error('XLSX not found: ' + xlsxPath + '\nDownload Shoot Tracker and save it there first.');
  }
  const stat = fs.statSync(xlsxPath);
  const workbook = new ExcelJS.Workbook();
  // Skip drawings/media so a ~100MB+ file with images stays workable.
  await workbook.xlsx.readFile(xlsxPath, {
    ignoreNodes: [
      'sheetDrawings', 'drawing', 'drawing1', 'drawing2',
      'photo', 'image', 'pic', 'spPr', 'blipFill',
      'vmlDrawing', 'oleObject', 'ctrlProp'
    ]
  });
  return { workbook, stat };
}

function sheetToGrid(worksheet) {
  const values = [];
  const links = {};
  if (!worksheet) return { values, links };

  let maxCol = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    maxCol = Math.max(maxCol, row.cellCount);
  });
  // Cap columns to something sane (product sheets are wide but not endless)
  maxCol = Math.min(Math.max(maxCol, 1), 80);

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const r = rowNumber - 1;
    const line = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      let v = cell.value;
      line.push(cellText(v));
      const url = cellLink(v) || (cell.hyperlink ? String(cell.hyperlink) : '');
      if (url) links[r + ',' + (c - 1)] = url;
    }
    values[r] = line;
  });

  // densify — exceljs may skip empty leading rows
  const dense = [];
  for (let i = 0; i < values.length; i++) dense.push(values[i] || []);
  return { values: dense, links };
}

function findSheet(workbook, name) {
  const want = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
  return workbook.worksheets.find((ws) =>
    String(ws.name || '').toLowerCase().replace(/\s+/g, ' ').trim() === want
  ) || null;
}

async function readSourceTabs(xlsxPath) {
  const { workbook, stat } = await readWorkbook(xlsxPath);
  const product = {};
  const missing = [];

  for (const tab of config.productTabs) {
    const ws = findSheet(workbook, tab);
    if (!ws) {
      missing.push(tab);
      continue;
    }
    const { values, links } = sheetToGrid(ws);
    product[tab] = projectProductGrid(values, links);
  }

  let uploadLog = { headers: [], rows: [], byEan: new Map() };
  const logWs = findSheet(workbook, config.uploadLogTab);
  if (logWs) {
    const { values } = sheetToGrid(logWs);
    uploadLog = projectUploadLog(values);
  } else {
    missing.push(config.uploadLogTab);
  }

  return {
    xlsxPath,
    xlsxModified: stat.mtime.toISOString(),
    xlsxBytes: stat.size,
    product,
    uploadLog,
    missing,
    sheetNames: workbook.worksheets.map((w) => w.name)
  };
}

module.exports = { readSourceTabs, readWorkbook, sheetToGrid, findSheet };
