# MTS Furniture Sheet Reader

Standalone Apps Script for **Photoshoot LSH FURNITURE** (Sheet1) and the **Presentation finder** category tree.  
Separate from the HH Multi Sheet Reader (`dashboard/apps-script`) and the Presentation Board reader.

Scopes in `appsscript.json` already cover both sheets (`spreadsheets.readonly` + `drive.readonly`). No second web-app Allow for categories.

## Deploy

1. Create a new Apps Script project (or clasp push this folder).
2. Enable advanced services: **Sheets API** and **Drive API**.
3. Paste `Code.gs` + `appsscript.json`.
4. Confirm the script only requests these scopes (already set in `appsscript.json`):
   - `https://www.googleapis.com/auth/spreadsheets.readonly` — furniture + categories sheets
   - `https://www.googleapis.com/auth/drive.readonly` — sheet modified time / PDP lookup
   Do not add `spreadsheets` or `drive`. `DriveApp` needs full Drive access, so the script uses `Drive.Files.get` and `Drive.Files.list` instead.
5. Deploy → New deployment → Web app  
   - Execute as: **User accessing the web app**  
   - Who has access: **Anyone within Livspace**
6. Copy the `/exec` URL into:
   - `tasks.js` as `MTS_FEED_URL`
   - `presentation/config.js` as `CATEGORIES_FEED_URL` (finder uses `?action=nav`)
   After a code change: Manage deployments → Edit → Version: New version → Deploy (same `/exec` URL).

## Actions

| Action | Purpose |
|--------|---------|
| `tasks` | Sheet1 feed (`furniture` payload) |
| `nav` / `categories` | Categories & Subcategories tree for Presentation finder |
| `ping` | Health check (includes furniture + categories sheet ids) |

### Categories sheet (nav)

https://docs.google.com/spreadsheets/d/1IVJYLciWf5om1c0NAGqWdJyPgy_5e2kBn1YAHUPNLnk/edit?gid=676919905#gid=676919905

Tab gid `676919905` — Division → Dept → Category → Sub Category (fill-down).  
USP / Set / Collection / Custom still come from the presentation `generated` tab, not this sheet.

Available Tasks in the playground require **GDRIVE LINK + PDP GUIDELINE LINK**.
