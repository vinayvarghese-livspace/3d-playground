# Presentation Board Sheet Reader (standalone)

API-only Apps Script for the **Presentation Board**.  
UI lives in `presentation/` and is hosted with **3D Playground** on GitHub Pages:

https://vinayvarghese-livspace.github.io/3d-playground/presentation/

**Not** part of HH Multi Sheet Reader or MTS Furniture reader.

## Spreadsheet

https://docs.google.com/spreadsheets/d/1B9qtXKT0CVDt1aXFEhHyAHCWLHBp682pdL3egqNfr4w/edit?gid=0#gid=0

| Column | Use |
|--------|-----|
| `SUB-CATEGORY` | Master title (coral bar). Fills down until the next value. |
| `TITLE` | Brand label above each image. If blank, reuse TITLE learned for the same image-host (CDN), else guess from the URL host. Example: one `assets.wfcdn.com` row titled `wayfair` → all other `assets.wfcdn.com` images show **Wayfair**. |
| `IMAGE URL` | Image to show. Empty → blank square. |
| `SEQUENCE` | Right-side numbered list (unique values, row order). |

## Deploy

1. [script.google.com](https://script.google.com) → **New project** (or update existing).
2. Paste only **`Code.gs`** (+ optional `appsscript.json`).  
   **No HTML files needed.**
3. Enable **Drive API** if prompted (manifest already lists it).
4. **Deploy → New deployment → Web app**
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone within Livspace**
5. Open `/exec` once to authorize.
6. Paste `/exec` into `presentation/config.js` → `PRESENTATION_FEED_URL`.
7. Push to `3d-playground` so GitHub Pages serves `/presentation/`.
   Local check: open `presentation/index.html` via a static server.

## API

| Action | Purpose |
|--------|---------|
| `?action=board` | JSON board payload |
| `?action=ping` | Health check |
| `&callback=fn` | JSONP (for local page) |

## After code changes

Deploy → Manage deployments → Edit → **New version** → Deploy (keep same `/exec` URL).
