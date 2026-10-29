'use strict';

const { dryRun, runSync, runRollback, printVersions } = require('./lib/sync');
const { authorizeInteractive } = require('./lib/sheets');

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args[0] || 'help';
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--version' || args[i] === '-v') {
      flags.version = args[++i];
    }
  }
  return { cmd, flags };
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv);
  switch (cmd) {
    case 'auth':
      await authorizeInteractive();
      break;
    case 'dry-run':
      await dryRun();
      break;
    case 'sync':
      await runSync();
      break;
    case 'versions':
      printVersions();
      break;
    case 'rollback':
      await runRollback(flags.version);
      break;
    case 'help':
    default:
      console.log(`Shoot Tracker sync (local xlsx → native Google Sheet)

Usage:
  npm run auth                 One-time Google login
  npm run dry-run              Diff only (reads xlsx + sheet)
  npm run sync                 Backup version → apply → Sync Meta
  npm run versions             List local version folders
  npm run rollback             Undo latest sync (restore pre-sync snapshot)
  npm run rollback -- --version vYYYYMMDD-HHMMSS

Put the downloaded file at:
  Data/Shoot Tracker - HH/Shoot Tracker - HH .xlsx

OAuth client JSON:
  tools/shoot-sync/.credentials/credentials.json
`);
      if (cmd !== 'help') process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
