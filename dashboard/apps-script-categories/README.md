# Categories & Subcategories reader (standalone)

API-only Apps Script for the presentation finder.  
Separate from the Presentation Board reader, HH reader, and MTS Furniture reader.

## Spreadsheet

https://docs.google.com/spreadsheets/d/1DGJBChDVxkE-fj-vi3bG2lfagjO-jZ0rcFqY2C1Vl-8/edit?gid=1274485640#gid=1274485640

Tab: **Categories & Subcategories &lt;Quick Glance&gt;** (`gid=1274485640`)

| Column | Use |
|--------|-----|
| `Division` | Top level. Fills down. |
| `Dept` | Second level. Fills down until the next Division. |
| `Category` | Third level. Fills down until the next Dept. |
| `Sub Category` | Leaf. Slug is used as `?sub=`. |

This sheet does not supply USP, Set/EACH, Collection, or Custom. Those come from the presentation sheet tab `generated` (`gid=510920739`).

## Permissions

Only **read-only Google Sheets** access is requested (`spreadsheets.readonly`). There is no Drive scope.

`SpreadsheetApp.openById` cannot use that scope. This reader uses the **Google Sheets API** advanced service instead, which can read with the read-only scope.

In the Apps Script editor: **Services → Google Sheets API** (already listed in `appsscript.json`). Then paste the new `Code.gs`, deploy a **new version**, and allow access again.

## Deploy

1. [script.google.com](https://script.google.com) → **New project**. Do not paste this into the presentation board project.
2. Paste **`Code.gs`** and **`appsscript.json`**. Add **Services → Google Sheets API** if it is not already listed.
3. **Deploy → New deployment → Web app**
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone within Livspace**
4. Open `/exec` once and allow access.
5. Check `/exec?action=ping`, then `/exec?action=nav`.

The presentation page still uses the sample category list until that `/exec` URL is connected.

## API

| Action | Purpose |
|--------|---------|
| `?action=nav` | Division → Dept → Category → Sub-category tree |
| `?action=ping` | Health check |
| `&callback=fn` | JSONP |

Each sub-category includes `name` and `slug` only.

## After code changes

Deploy → Manage deployments → Edit → **New version** → Deploy (keep the same `/exec` URL).
