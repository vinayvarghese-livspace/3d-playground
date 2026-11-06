# 3D Playground: Overview

**Live link (Beta V1.7):** https://vinayvarghese-livspace.github.io/3d-playground/ (or `#renamer` / `#available` / `#my`)  
**Preview:** https://vinayvarghese-livspace.github.io/3d-playground/preview.html  
**Source code:** https://github.com/vinayvarghese-livspace/3d-playground  
**Current version:** Beta V1.7 on `index.html` (production root); Preview V1.7 on `preview.html`.

---

## Part 1: What it is and why we built it (non-technical)

### In one line

3D Playground turns product photos or renders into marketplace-ready images: correctly named, correctly sized, in the correct order. It also shows which products are ready to work, who should take them, and (with Product Replacement) generates new shot images from a prior completed product via Answerly — then exports one EAN zip.

### The problem before

Every product we list on a marketplace needs a set of images, and every set has to follow strict rules:

- **Exact file names.** Each image must be named `EAN_Sequence_ShotCode.png`, for example `8909327036353_02_H-FR.png`. The main image is `8909327036353_MAIN.png`.
- **A different shot list for every product type.** A vase needs different shots from a bedsheet or a pressure cooker. The naming sheet lists 227 product types across Decor, Soft Furnishing, Bath, Laundry, Kitchen, Bakeware and Tableware, and 23 of them have variants with their own shot lists.
- **Exact image specifications.** 3000 × 3000 px, square, PNG, white background.
- **Traceability.** Who prepared the image, and when.

Doing this by hand meant:

| Pain point | What it cost us |
|---|---|
| Looking up the right shot list in a large Excel sheet for every product | Time, and wrong shot codes when the wrong row was read |
| Typing long 13-digit EAN file names by copy-paste | Typos that are hard to spot and get images rejected or mismatched |
| Resizing and converting each image in Photoshop or another tool | Repetitive manual work for every single image |
| Images that came in smaller than 3000 px | Someone had to upscale them one by one in Adobe Firefly, then download, rename and resize again |
| No record of who prepared a file without checking the manually maintained sheet. | No traceability when something went wrong from the file. |
| Every person did it slightly differently | Inconsistent workflow across the team |
| Finding the next ready product meant hunting across Shoot Tracker tabs, Drive folders and the Render Tracker | Double-assigns, missed ready work, and no shared view of what was available |
| Assigning work meant typing into the Render Tracker by hand | Slow, easy to skip a row, and hard for the team to see what each person owned |
| Building a new product from a similar completed one meant recreating every shot manually | Slow Product Replacement, inconsistent prompts, and no shared prompt history |

### What 3D Playground does

On one live page there are three tabs: **Renamer**, **Available Tasks** and **My Tasks**.

#### Renamer

1. **Types the EAN** (the tool checks it is exactly 13 digits).
2. **Picks the product type** from a searchable list (and a variant, if the product has one). The tool instantly shows the exact shot list: sequence, shot name, shot code and the final file name for each row.
3. **Drops in the images.** Drag a whole batch onto the table and they fill the rows in order, or drop a single image on a specific row.

Then they click **Generate**, and the tool:

- Checks every image (JPG or PNG, big enough, square) and clearly flags any that are wrong, with the reason, before anything is produced.
- Upscales small images automatically with Adobe Firefly AI (optional).
- Converts every image to a 3000 × 3000 PNG.
- Names every file correctly.
- Stamps each file with the author's name, the software and the creation time (visible in Windows file Properties).
- Downloads everything as one zip named after the EAN, with a folder inside it named after the EAN.

#### Tasks

1. **Available Tasks** shows products from the Shoot Tracker that already have a Drive folder and a template mapping, and are not yet assigned on the Render Tracker. Search, filter (category / template / Set or PCs / artist history), group and sort.
2. **Assign** (Vinay, Aman or Ananyo) puts a product onto the live Render Tracker in one click: Artist, PDP Images = Blocked, Start Date = today. Anyone else can browse but cannot assign.
3. **My Tasks** shows products assigned to the author, split into **Active** (Not started / In progress / Blocked) and **Completed**. The drawer shows shots, Drive folder, PDP guideline, props and data warnings. Header also shows **Data last updated** and **Data last sync**.

#### Product Replacement (My Tasks › Start)

1. Choose **Primary** (start fresh) or **Product Replacement** (reuse a prior Completed match). Replacement is recommended when another Completed EAN shares the same Sub-category + Template; prior matches list with Best match pre-selected.
2. Map each shot: prior plate (A) + product reference images (B, up to 4 extra slots). Prompts come from the **Prompt Database** Universal templates (editable).
3. **Generate** via Answerly through a local bridge on the PC (no Adobe required for this path). Rate and **Approve** successful prompts; they are written to the Prompt DB All user tab (including Generation count).
4. **MAIN** can regenerate after Hero Front / seq 01 D exists (uses that angle as A, with chosen product B).
5. **Export** downloads one EAN zip of approved / rated PNGs. Manual drops on the export table (for example dimension shots) skip the star rating gate. Firefly AI upscale runs on export only when images need it.

### How it helps

- **4x manual worktime saving per product** on rename / resize / upscale.
- **No naming mistakes.** File names come from the official naming sheet.
- **Problems are caught before upload.** Wrong size, shape or file type are flagged on the row.
- **Smaller images are usable** with optional Firefly 2x upscale (from 2000 px).
- **One place to see ready work** and **no double-assigns** via Available Tasks + live Assign.
- **Product Replacement is assisted end-to-end:** prior match → multi-ref Answerly generate → rate / approve → Prompt DB history → EAN zip export.
- **Accountability.** Files carry author metadata; Assign writes Artist and Start Date; Approve writes prompt rows with author and app version.
- **Private by default for Renamer images.** Without AI upscale, images never leave the PC. Product Replacement sends only the images needed for that shot to Answerly through the local bridge. Task / prompt metadata uses the team's Google Sheets via Apps Script.
- **Nothing to install for basic Renamer / Tasks browsing.** Product Replacement needs a one-time **Setup Answerly.bat** (no Adobe). Full **Setup.bat** is only needed if Firefly AI upscale is required.
- **No extra Firefly cost** beyond the Photoshop / Adobe plan when upscale is used.

---

## Part 2: Technical explanation

### Architecture at a glance

There are four parts:

1. **The web page** (GitHub Pages `index.html`). Renamer, Tasks and Product Replacement UI in plain HTML / CSS / JS.
2. **The local bridge** on the PC (`127.0.0.1:5175`):
   - **Answerly-only** (`Setup Answerly.bat` / `answerly-server.js`) for Product Replacement — no Adobe.
   - **Full Firefly upscaler** (`Setup.bat` / `server.js`) optional, for AI upscale on Renamer or export when images are under size.
3. **HH Multi Sheet Reader** (Google Apps Script): Shoot Tracker, Naming, Render Tracker feed + Assign write-back + Drive thumbs.
4. **Prompt Database** (separate Google Apps Script): Universal prompt templates + All user Rate & Approve rows.

| Where | What runs there | Role |
|---|---|---|
| GitHub | Repository and GitHub Pages | Version history; publishes the live page and `dist/3d-playground.zip` |
| User's PC: Chrome | `index.html` (Beta V1.7) | Renamer, Available / My Tasks, Product Replacement workspace |
| User's PC: local bridge | Node on `127.0.0.1:5175` | Answerly jobs and/or Firefly upscale |
| Answerly | Image-to-image generation | Product Replacement shot generation |
| Adobe Firefly | Optional 2x upscale | Only when AI upscale is needed |
| Apps Script (task feed) | HH Multi Sheet Reader | Task feed (JSONP), thumbs, Assign |
| Apps Script (Prompt DB) | Prompt Database API | Universal read + promptApprove / Generation count |
| Google Sheets / Drive | Shoot Tracker, Naming, Render Tracker, Prompt Database, product folders | Source of truth |

**Flow:** The live page loads Tasks from the sheet reader. Assign appends to the Render Tracker. Product Replacement talks to the local Answerly bridge; prompts load from / write to the Prompt DB. Renamer (and optional export upscale) can use the Firefly path on the same port when installed.

### Part A: The web page

**Technology:** plain HTML, CSS and JavaScript. No frameworks, no build step, no external libraries apart from Google Fonts.

| File | Role |
|---|---|
| `index.html` + `tasks.js` + `tasks.css` | Live Beta V1.7 shell (tabs + Tasks + Product Replacement) |
| `renamer.html` (iframe) + `app.js` + `styles.css` + `data.js` | Renamer workbench inside `#renamer` |
| `dist/3d-playground.zip` | Installer for Answerly bridge and/or Firefly upscaler |
| `dashboard/apps-script/` | Task feed + Assign |
| `dashboard/apps-script-prompt-db/` | Prompt Database web app |

| Concern | How it is done | Why |
|---|---|---|
| Naming rules | Excel/CSV → `data.js` via convert scripts; Tasks can also use feed naming. Header shows Data last updated + Data last sync. | Sheet stays source of truth |
| Image checks / PNG / zip / metadata | Same client-side Renamer pipeline as V1.1 (canvas, custom PNG, tEXt + XMP, stored zip) | No server for rename path |
| Routes | Hash routes `#renamer`, `#available`, `#my` | One URL for the whole app |
| Author | `localStorage`, shared across Renamer and Tasks | No login for author name |
| Product Replacement | Workspace in `tasks.js`: Choose → Primary / Replace → generate → rate/approve → export | End-to-end on one page |
| Answerly calls | Page → local bridge → Answerly API with saved token | Token never goes through GitHub Pages |
| Prompt DB | JSONP to separate Apps Script (`PROMPT_DB_URL`) | Same pattern as the task feed |

### Part B: Local bridge — Answerly and optional Firefly

**Answerly bridge (Product Replacement, preferred install):**

- `Setup Answerly.bat` copies files, installs Node for this user if needed, starts `answerly-server.js` on port 5175.
- No Adobe sign-in. Settings → **Answerly token**: Connect bridge, paste session JSON, Save token.
- Page uses `/answerly/health`, `/answerly/token`, `/answerly/models`, `/answerly/jobs`.
- Multi-ref jobs send prior as INPUT IMAGE 1 (A) and each product B as its own Answerly reference slot (up to 4 extra B tiles, slots 2–5). No packing / duplicate alias fields.
- Chrome must **Allow** local / loopback network access for the GitHub Pages origin once.

**Firefly upscaler (optional AI upscale):**

- Full `Setup.bat` when Firefly 2x upscale is needed (Adobe account + dedicated Chrome profile).
- Same port 5175; starting Firefly can replace an Answerly-only process — use Answerly-only when PR does not need upscale.
- Renamer upscale and PR export upscale only when images are under the output size.

### Part C: Tasks and Assign

**Available** = Shoot Tracker row with real GDRIVE folder link + template mapping, and not already on the Render Tracker with an Artist.

**Assign (live):** appends EAN, Artist, PDP Images = Blocked, Start Date. Skips EANs already present. Poll ~30s while the tab is visible.

**My Tasks:** Active vs Completed from PDP Images. Templates such as `T2a` / `T7 set` recognised. Artist matching accepts first-name forms.

**Data sources:** Shoot Tracker tabs (Decor and Garden, Table Top & Bath, Kitchen & Laundry), Naming sheet, Render Tracker, Drive thumbs via Apps Script JSONP.

### Part D: Product Replacement and Prompt Database

**Workflow:** Start → choose Primary or Product Replacement → map shots → Generate (Answerly) → Rate 4–5★ → Approve → Export zip.

**Prompt Database (separate Apps Script, v11+):**

| Action | Purpose |
|---|---|
| `universal` | Read Universal prompt templates |
| `promptApprove` | Append Rate & Approve row to All user (includes Generation count, prior/product refs, app version) |
| `approvedCustoms` | Reuse latest Custom prompts for Sub-category + Template |
| `promptChunk` | Stash long Custom prompt slices before approve |

Retired "Image input" columns are removed on deploy. MAIN prompts always prefer the Universal MAIN row; MAIN regen uses Hero Front / seq 01 D as A after that shot exists.

**Export:** one `EAN.zip`. Generated/approved rows need a rating; **manual drops** on the export table skip rating (follow-up in V1.6). Firefly upscale only if needed.

### Why the simple hosting and distribution approach

| Choice | Why it was chosen |
|---|---|
| **GitHub Pages** | Free HTTPS host; push to `main` publishes. One live link for everyone. |
| **Production on `index.html`** | Beta V1.7 on the root URL; Preview V1.7 on `preview.html`. |
| **Setup zip on the same host** | Page and installer stay in sync. |
| **Answerly bridge local, separate from Firefly** | PR does not require Adobe; Connect bridge is enough. |
| **Two Apps Script web apps** | Uses sheets the team already owns; no new database server. |
| **Plain HTML / CSS / JS** | No build step; easy to read and edit. |
| **Version numbers on file links** | Cache bust after each release (`?v=`). |

### How the link and the required pieces reach each user

**Everyone:** https://vinayvarghese-livspace.github.io/3d-playground/ — Renamer and Tasks browsing need only a browser and Google sign-in for the sheet feed. Enter the author name (same as Renamer).

**Product Replacement:** download `3d-playground.zip` from Settings → **Setup**, run **`Setup Answerly.bat`**, then Settings → **Answerly token** → Connect bridge → paste session → Save. Allow Chrome local/loopback access if asked.

**AI upscale (optional):** full **`Setup.bat`** (Adobe / Firefly) only if Renamer or export needs 2x upscale.

**Shipping an update:** push updates the live page. Rebuild the zip with `tools/make-package.ps1` when bridge files change. Apps Script changes need a new web-app deployment (and matching feed / Prompt DB version bumps in `tasks.js`).

---

## Version history

### Beta (V1.0): "Image Renamer", 8 Oct 2026

Core rename / convert in the browser: EAN validation, product types from the naming sheet, drag-and-drop shots, 3000×3000 PNG + metadata, one download per image. Nothing uploaded.

### Beta V1.1: "3D Playground", 12 to 13 Oct 2026

AI upscale via local Firefly service, Upscale column, one `EAN.zip`, Settings setup guide, hosted setup zip, `Setup.bat`. Reliability fixes for Chrome local network, Node PATH, D: install folder, sign-in Chrome recovery, remembered upscale switch.

### Preview V1.2 → production path: Tasks + Assign, 27 to 29 Oct 2026

Available / My Tasks shell, Assign to live Render Tracker, Drive thumbs, filters / grouping, author shared with Renamer. Workflow chooser started as a UI mock. V1.3 refined Assign menu, Active/Completed PDP buckets, Active sort priority, template variants, then shipped the Tasks shell to production `index.html` with Data last sync (29 Oct).

### Preview V1.4: Product Replacement + Answerly, 3 Nov 2026

Live Product Replacement workbench: Answerly bridge in the setup zip, prompt compile from Universal templates, generate / rate / approve, Prompt DB Apps Script, export path.

### Preview V1.5: Answerly bridge split, 4 Nov 2026

Answerly-only bridge (`Setup Answerly.bat` / Connect bridge) with no Adobe. Firefly optional for upscale. Chrome Allow/Block local network documented; Start Node before Chrome; self-healing port 5175 / Repair.

### Beta V1.6: Production cutover + multi-ref PR, 5 Nov 2026

**Production root** runs Tasks + Product Replacement as **BETA V1.6**.

**Included:**

- Multi-ref Answerly: A + up to 4 B as separate reference slots; B tiles show slot badges (2–5); Browse B file picker fix.
- Generation count on Prompt DB Approve; retired Image input columns cleaned on deploy (Prompt DB script v11+).
- MAIN Regenerate after Hero Front / 01 D exists; manual MAIN uses hero D as A with chosen B.
- Manual export drops skip the star rating gate; Settings menu item renamed to **Setup**.
- Drive rail / approved-thumb styling; fewer stale blob URL console warnings.

### Preview / Beta V1.7: Crop, template refs, Answerly IDs, 6 Nov 2026

**Preview V1.7** and **Beta V1.7** ship together on `preview.html` and `index.html`.

**Included:**

- Square crop for B / A / export thumbs before Generate or upscale; movable crop window.
- Drive template reference thumbs + original download on Template Reference.
- Rail thumbnail zoom (40–100%) and resizable Drive rail; favicon / brand logo.
- Mansoor removed from Assign menu (history kept).
- Answerly execution id link + copy; Prompt DB stores execution / job / result / input URL A–B4 (script v14+).
- Detail & Compare uses A override when set.

### Summary of changes

| | Beta (V1.0) | Beta V1.1 | V1.3 Tasks | Beta V1.7 |
|---|---|---|---|---|
| Name | Image Renamer | 3D Playground | Tasks on live root | Tasks + Product Replacement |
| Where people open it | GitHub Pages | GitHub Pages | `index.html` | Live link (Beta V1.7) root |
| Renamer | Yes | + AI upscale + zip | Same | Same |
| Task board | None | None | Available + My Tasks | Same + Product Replacement |
| Assignments | Manual sheet | Manual sheet | One-click Assign | Same |
| Product Replacement | None | None | Chooser mock only | Answerly + crop + Prompt DB IDs/URLs + export |
| Install for PR | — | — | — | `Setup Answerly.bat` (Firefly Setup.bat only if upscale needed) |
| Prompt history | None | None | None | Prompt Database All user (+ gen count, Answerly ids/URLs) |
