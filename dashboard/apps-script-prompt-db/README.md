# Prompt Database Apps Script (standalone)

Separate from the HH Multi Sheet Reader. **Do not** paste this into the existing `dashboard/apps-script/Code.gs`.

Sheet: [Prompt Database](https://docs.google.com/spreadsheets/d/12NU2Ru7Jnxok4M0Ylva1n8CKBxScnOs3k4gPs35a4Ec/edit)

| Tab | Use |
|-----|-----|
| `Universal` | Read templates |
| `All user` | Append Rate & Approve rows |

---

## Step-by-step (your side)

### 1. Prepare the spreadsheet

1. Open the Prompt Database link above.
2. Confirm tabs named **`Universal`** and **`All user`** (spelling can be `All User` — script soft-matches).
3. On **All user**, row 1 should include at least the Universal columns, plus:
   - `Prompt origin`
   - `Universal row`
   - `Approved At`  
   (If missing, the script adds them on first write / when you run `checkPromptDb`.)
4. You do **not** need “Anyone with the link”. Access is via the Apps Script owner.

### 2. Create a new Apps Script project on this sheet

1. On the Prompt Database spreadsheet: **Extensions → Apps Script**.
2. If it opens an empty project, delete any stub `myFunction` code.
3. Rename the project (top left) to something like **`Prompt Database API`**.
4. Open `Code.gs` in that editor and **replace all contents** with the file in this folder:  
   [`Code.gs`](Code.gs)
5. **Save** (Ctrl+S).

### 3. Authorize + smoke-check tabs

1. In the Apps Script editor, select function **`checkPromptDb`** in the toolbar dropdown.
2. Click **Run**.
3. When Google asks, **Review permissions →** choose your Livspace account → **Allow**.
4. Open **View → Logs** (or Execution log). You should see:
   - Spreadsheet name + id
   - `Universal OK`
   - `All user OK` + header list  
   If a tab name is wrong, the log lists available tab names — rename the sheet tab to match.

### 4. Deploy as a web app

1. **Deploy → New deployment**.
2. Click the gear / type → **Web app**.
3. Settings:
   - **Description:** `Prompt DB v1`
   - **Execute as:** **Me** (your account)
   - **Who has access:** **Anyone within Livspace**  
     (or the same option you use for the HH Multi Sheet Reader)
4. **Deploy**.
5. Copy the **Web app URL** (ends in `/exec`).  
   Deployed URL (v1):  
   `https://script.google.com/a/macros/livspace.com/s/AKfycbwjLPIuL9J_XtHmnEm7jdbnJHlUIEjscACqYiSIB3ISTQNXHDhKHAVyuOc9VuPaobHT/exec`  
   Paste into the playground later as `PROMPT_DB_URL`.

### 5. Test in the browser (optional but recommended)

Replace `YOUR_EXEC_URL` with the URL from step 4.

**Ping**

```text
YOUR_EXEC_URL?action=ping
```

Expect JSON: `"ok": true` and `"version": 1`.

**Read Universal**

```text
YOUR_EXEC_URL?action=universal
```

Expect `"ok": true` and a `values` grid (headers + rows).

**Test append** (writes one row to All user — use a fake EAN)

```text
YOUR_EXEC_URL?action=promptApprove&ean=0000000000000&author=Test&prompt=hello&promptOrigin=Automated&qualityRating=5&universalRow=master
```

Expect `"ok": true` and a `row` number. Check the **All user** tab for the new row. Delete the test row if you want.

If the browser shows a Google login / “authorization needed” page, open the `/exec` URL once while signed into Livspace, approve, then retry.

### 6. After you change Code.gs later

1. Edit → Save.
2. **Deploy → Manage deployments →** pencil on the existing deployment → **New version → Deploy**.  
   Same `/exec` URL; no need to change the playground URL.

---

## What this script does **not** touch

- HH Multi Sheet Reader / `FEED_URL` / Assign / Shoot / Naming  
- The **Universal** tab (read-only; never writes there)

## What the playground will do next (our side)

1. Add `PROMPT_DB_URL` in `tasks.js` (your `/exec` URL).
2. Load Universal from `action=universal` (CSV embed as fallback).
3. On Rate & Approve, call `action=promptApprove` with Automated vs Custom.

Send us the `/exec` URL when step 4–5 succeed and we will wire the client.
