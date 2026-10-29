# Shoot Tracker Sync (standalone)

Manual tool to update the **native** Google Sheet used by the 3D Playground from a **downloaded** Shoot Tracker `.xlsx`.

- Does **not** change `tasks.js`, `preview.html`, or `dashboard/apps-script/Code.gs`
- Does **not** read the Drive xlsx (save-to-Drive size issues)
- No images; tabs: Decor and Garden, Table Top & Bath, Kitchen & Laundry, Upload Log only

Destination sheet: [3D playground Shoot Tracker](https://docs.google.com/spreadsheets/d/1mowqAXZMzYmy-EXrl3gAiqX72FjWn0FBlPZD9ZsuBIw/edit)

After a successful sync, a **Sync Meta** tab records `xlsxSyncedAt` (and related fields). The 3D Playground preview shows this as **Data last sync** next to **Data last updated** (requires Apps Script `FEED_VERSION` 28+).

## Simple UI (recommended)

1. One-time: put Google OAuth Desktop client JSON at  
   `tools/shoot-sync/.credentials/credentials.json`  
   (see `credentials.example.json`; redirect `http://127.0.0.1:53682/oauth2callback`; enable Sheets API).

2. Double-click **`Start Shoot Sync.bat`**  
   (or `npm start` from this folder).

3. Browser opens `http://127.0.0.1:8787/`  
   - Put today’s download at:  
     `Data/Shoot Tracker - HH/Shoot Tracker - HH .xlsx`  
   - **Preview changes** → **Sync now**  
   - **Roll back** if a test sync looks wrong  

Keep the black console window open while using the page.

## CLI (optional)

```bash
cd tools/shoot-sync
npm install
npm run auth
npm run dry-run
npm run sync
npm run versions
npm run rollback
```

## Backups

Two places (on purpose):

| Path | What |
|------|------|
| `Data/Shoot Tracker - HH/versions/v…/` | Tool backups used by **Roll back** |
| `Data/3D playground_Shoot Tracker - HH/` | Your manual export of the live playground sheet |
| `Data/3D playground_Shoot Tracker - HH/backups/` | Dated copies retained before each sync (xlsx + `pre-sync.json`) |

**Manual tip:** before a risky sync, also File → Download the Google Sheet again into `Data/3D playground_Shoot Tracker - HH/3D playground_Shoot Tracker - HH .xlsx` so you have a full Excel copy.
