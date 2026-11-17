# MTS Furniture Sheet Reader

Standalone Apps Script for **Photoshoot LSH FURNITURE** (Sheet1 only).  
Separate from the HH Multi Sheet Reader (`dashboard/apps-script`).

## Deploy

1. Create a new Apps Script project (or clasp push this folder).
2. Enable advanced services: **Sheets API** and **Drive API**.
3. Paste `Code.gs` + `appsscript.json`.
4. Deploy → New deployment → Web app  
   - Execute as: **User accessing the web app**  
   - Who has access: **Anyone within Livspace**
5. Copy the `/exec` URL into `tasks.js` as `MTS_FEED_URL`.

## Actions

| Action | Purpose |
|--------|---------|
| `tasks` | Sheet1 feed (`furniture` payload) |
| `ping` | Health check |

Available Tasks in the playground require **GDRIVE LINK + PDP GUIDELINE LINK**.
