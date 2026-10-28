# 3D Playground: Overview

**Live link (production, V1.1 Renamer):** https://vinayvarghese-livspace.github.io/3d-playground/
**Preview link (V1.3 Tasks):** https://vinayvarghese-livspace.github.io/3d-playground/preview.html
**Source code:** https://github.com/vinayvarghese-livspace/3d-playground
**Current version:** Preview V1.3 (Tasks refinements on `preview.html`). Production root stays V1.1 Renamer until cutover.

---

## Part 1: What it is and why we built it (non-technical)

### In one line

3D Playground turns a folder of product photos or renders into a ready-to-upload set of marketplace images: correctly named, correctly sized, in the correct order, in one click. Preview V1.3 also shows which products are ready to work, who should take them, and what each person already has on their plate.

### The problem before

Every product we list on a marketplace needs a set of images, and every set has to follow strict rules:

- **Exact file names.** Each image must be named `EAN_Sequence_ShotCode.png`, for example `8909327036353_02_H-FR.png`. The main image is `8909327036353_MAIN.png`.
- **A different shot list for every product type.** A vase needs different shots from a bedsheet or a pressure cooker. The naming sheet lists 216 product types across Decor, Soft Furnishing, Bath, Laundry, Kitchen, Bakeware and Tableware, and 24 of them have variants with their own shot lists.
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

### What 3D Playground does

#### Renamer (live for everyone since V1.0 / V1.1)

The user does three things:

1. **Types the EAN** (the tool checks it is exactly 13 digits).
2. **Picks the product type** from a searchable list (and a variant, if the product has one). The tool instantly shows the exact shot list for that product: sequence, shot name, shot code and the final file name for each row.
3. **Drops in the images.** Drag a whole batch onto the table and they fill the rows in order, or drop a single image on a specific row.

Then they click **Generate**, and the tool:

- Checks every image (JPG or PNG, big enough, square) and clearly flags any that are wrong, with the reason, before anything is produced.
- Upscales small images automatically with Adobe Firefly AI (V1.1, optional).
- Converts every image to a 3000 × 3000 PNG.
- Names every file correctly.
- Stamps each file with the author's name, the software and the creation time, so anyone can see who made it (visible in Windows file Properties).
- Downloads everything as one zip named after the EAN, with a folder inside it named after the EAN.

#### Tasks (Preview V1.3)

On the preview page, three tabs sit in one shell: **Renamer**, **Available Tasks** and **My Tasks**.

1. **Available Tasks** shows products from the Shoot Tracker that already have a Drive folder and a template mapping, and are not yet assigned on the Render Tracker. The user can search, filter by category / template / Set or PCs / artist history, group the list, and sort it.
2. **Assign** (Vinay, Aman or Ananyo) puts a product onto the live Render Tracker in one click: Artist, PDP Images set to Blocked, and today's Start Date. Anyone else can browse Available Tasks but cannot assign.
3. **My Tasks** shows the products assigned to the signed-in author, split into **Active** and **Completed**, with status from the Render Tracker's PDP Images column. Opening a task shows a preview drawer (shots, Drive folder, PDP guideline, props, warnings). **Start** opens a workflow chooser for Primary vs Product Replacement (UI mock in this preview; see version history).

### How it helps

- **4x manual worktime saving per product.** Looking things up, renaming, resizing and upscaling are all automatic.
- **No naming mistakes.** File names are generated from the official naming sheet, never typed.
- **Problems are caught before upload, not after.** Wrong size, wrong shape or wrong file type are shown on the row, with a plain explanation.
- **Smaller images are no longer a dead end.** With AI upscale on, images from 2000 px up are enlarged by Firefly and used directly.
- **Everyone produces the same output.** Same rules, same names, same specs, whoever runs it.
- **Accountability.** Every file carries its author and creation time. Assign also writes the Artist and Start Date onto the live Render Tracker.
- **One place to see ready work.** Available Tasks pulls Shoot Tracker + Drive + Render Tracker together, so people stop hunting across sheets.
- **No double-assigns.** A product already on the Render Tracker with an Artist drops out of Available Tasks for everyone.
- **Private by default for images.** Without AI upscale, images never leave the computer. Task data is read from the team's Google Sheets; Assign only writes the assignment fields back to the Render Tracker.
- **Nothing to install for basic use.** It is just a web link. AI upscale needs a one-time, roughly 10 minute setup per PC, with no admin rights needed.
- **No extra expense in using.** It uses free Firefly upscaler with no cost which comes from Photoshop subscription.

---

## Part 2: Technical explanation

### Architecture at a glance

There are three parts:

1. **The web page** (hosted on GitHub Pages). Renamer runs entirely in the browser. Preview V1.2 adds the Tasks shell on `preview.html`.
2. **The local upscaler** (V1.1, optional). A small Node.js program on the user's PC that drives Adobe Firefly on the user's behalf.
3. **The Google Apps Script feed** (V1.2). A web app that reads the Shoot Tracker, Naming sheet and Render Tracker, resolves Drive folder previews, and writes Assign rows to the live Render Tracker.

| Where | What runs there | Role |
|---|---|---|
| GitHub | Repository and GitHub Pages | Stores the code and version history; publishes the production Renamer, the preview Tasks page, and the setup zip |
| User's PC: Chrome | Production `index.html` (V1.1 Renamer) or Preview `preview.html` (V1.2 shell) | Renamer checks, resizes, names, adds metadata and zips images. Preview also shows Available / My Tasks |
| User's PC: local service (optional) | Node.js upscaler on 127.0.0.1:5175 | Receives only the images that need upscaling and queues them |
| User's PC: dedicated Chrome window (optional) | Chrome signed in to the user's Adobe account | Controlled by the service to upload images to Firefly and download the upscaled results |
| Adobe | Firefly upscale | Performs the 2x AI upscale |
| Google Apps Script | HH Multi Sheet Reader web app | Serves the task feed (JSONP) and writes Assign rows |
| Google Sheets / Drive | Shoot Tracker - HH, LSH-HH-Naming Convention, LSH-HH-Render Tracker, product Drive folders | Source of truth for ready work, naming rules, assignments and folder previews |

**Flow:** GitHub Pages delivers the page to Chrome. The Renamer does image work itself. If an image is too small and AI upscale is on, the page sends it to the local service, which uses the dedicated Chrome window to run it through Firefly and returns the upscaled image to the page. On Preview V1.2, Tasks loads the Apps Script feed (Shoot + Naming + Render Tracker), shows Available / My Tasks, and Assign appends rows to the live Render Tracker.

### Part A: The web page

**Technology:** plain HTML, CSS and JavaScript. No frameworks, no build step, and no external libraries apart from Google Fonts.

| File | Role |
|---|---|
| `index.html` + `app.js` + `styles.css` + `data.js` | Production V1.1 Renamer (what everyone uses today) |
| `preview.html` + `tasks.js` + `tasks.css` + `renamer.html` (iframe) | Preview V1.3 shell: Renamer tab plus Available / My Tasks |
| `dist/3d-playground.zip` | One-time AI upscale installer, linked from the Renamer Settings guide |

| Concern | How it is done | Why |
|---|---|---|
| Naming rules | The Excel naming sheet is converted to `data.js` by `tools/convert-naming-data.ps1` (it reads the .xlsx directly, no Excel needed). The Renamer shows "Data last updated" from the sheet's timestamp. Preview Tasks can also read naming data from the Apps Script feed. | The sheet stays the single source of truth; updating the rules is "re-run the script, push". |
| Image checks | The browser reads each image's width and height and checks the file type, the minimum size and the 1:1 ratio. | Problems are caught before generation, per row, with a reason. |
| Resize and convert | An HTML canvas draws the image centred on a white 3000 × 3000 square. | Built into every browser, nothing to install. |
| PNG encoding | Custom 24-bit RGB PNG encoder using the browser's built-in `CompressionStream`, with 72 DPI set. | The browser's own export always writes 32-bit RGBA with no DPI (shown as 96 DPI), which doesn't match the spec. |
| Metadata | Writes Author, Title, Description, Software and Creation Time as PNG `tEXt` chunks **and** XMP. | Windows Explorer and most photo tools read XMP, other tools read `tEXt`; writing both covers both. |
| Zip download | A small zip writer built into `app.js` ("stored", no compression, because PNGs are already compressed). | One clean download, no library needed. |
| Memory | The author name, the AI upscale on/off choice, a batch counter and the last generation summary are saved in the browser's `localStorage`. Author is shared with Tasks. | No login or database needed for these per-user preferences. |
| Preview routes | Hash routes `#renamer`, `#available`, `#my` on `preview.html`. Renamer loads in an iframe (`renamer.html`). | One URL for testing V1.2 without changing production. |

**Backend readiness:** Renamer naming data is still loaded through `loadNamingData` from `data.js` (ready to swap for a live query later). Tasks already use a live Apps Script feed for Shoot / Render Tracker / Assign.

### Part B: The AI upscaler (V1.1)

Adobe Firefly has no simple public upscale API we can use with a normal Adobe subscription. So, instead of an API, the upscaler **operates the Firefly website the same way a person would**, using the user's own Adobe login.

**Components (folder `firefly-upscaler`):**

- **A dedicated Chrome window** (`start-chrome.bat`). It uses its own Chrome profile, so the Adobe sign-in is kept separate from the user's everyday browser and survives restarts. It is opened with a local-only remote-control port (`127.0.0.1:9222`).
- **Firefly automation** (`firefly.js`). Uses `playwright-core` (the only dependency) to connect to that Chrome window, open the Firefly upscale page, upload the image, choose 2x, wait for the result and download it. It detects Firefly's "too many requests" pop-ups and HTTP 429 responses, waits 15 seconds and retries the same image (up to 3 times). If the Firefly window was closed or lost, it reconnects once automatically.
- **Local service** (`server.js`). A small web server that only listens on the PC itself (`127.0.0.1:5175`). The page talks to it with four calls:
  - `GET /health`: is the service running and is the Firefly Chrome window open?
  - `POST /jobs`: send an image, get back a job ID.
  - `GET /jobs/:id`: job progress from 0 to 100, its stage and its place in the queue.
  - `GET /jobs/:id/result`: the upscaled image.

**How a generate run works with AI upscale on:**

1. Any image smaller than 3000 px (2000 px minimum) is marked for upscaling.
2. All those images are sent to the local service at once; the service processes them one at a time with a 5 second gap, to stay friendly with Firefly's limits.
3. While Firefly works on the next image, the page is already converting finished ones, so the waiting overlaps.
4. Each row has its own progress ring in the Upscale column, and the main progress bar gives AI upscales more weight because they take far longer than conversion.
5. The upscaled 2x result (for example 4000 px) is scaled to exactly 3000 × 3000 and goes through the same PNG, metadata and zip steps as any other image.

**Safety:**

- The service only accepts connections from the PC itself, and only from approved pages (GitHub Pages, localhost or a local file), so other websites can't use it.
- Images under 80 MB only; temporary results are deleted after download or after 15 minutes.
- Images only leave the PC when AI upscale is on, and only the images that need it, going straight to the user's own Adobe Firefly account.
- Network logs remove login tokens before writing.

**Live status on the page:** a status pill shows *Upscaler connected* (green), *starting* or *Firefly Chrome not open* (amber), or *offline* or *blocked by Chrome* (red). When something is wrong, the Generate button explains exactly what to do instead of failing silently. The page also detects Chrome's newer "local network access" permission block and tells the user how to allow it.

### Part C: Tasks and Assign (Preview V1.2)

**What "available" means:** a Shoot Tracker product is shown in Available Tasks only when it has a real Google Drive folder link **and** a template mapping, and it is **not** already on the Render Tracker with an Artist. Photoshoot / Upload Status are not used as gates (Upload can say Done with no folder link).

**Data sources (via Apps Script):**

| Sheet / Drive | Used for |
|---|---|
| Shoot Tracker - HH (Decor and Garden, Table Top & Bath, Kitchen & Laundry) | Product rows, shot lists, GDRIVE links, template mapping, props, PDP guideline |
| LSH-HH-Naming Convention | Shot naming rules (also still embedded in Renamer as `data.js`) |
| LSH-HH-Render Tracker (Tracker tab) | Who is assigned, PDP Images status, Start / End Date, output Drive folder, Marketing QC |
| Product Drive folders | Thumbnail previews for the list and drawer |

**Assign write-back (live):** clicking Assign appends a new row on the Render Tracker for that EAN (if it is not already there): EAN Number, Artist, PDP Images = Blocked, Start Date = today. Photoshoot Status, End Date, Drive / QC columns are left untouched. Only authors Vinay, Aman and Ananyo see the Assign controls (matched on first name or full name). The page re-reads assignments about every 30 seconds while the tab is visible, so other people's picks show up without a full reload.

**My Tasks:** products assigned to the current author. Active = Not started / In progress / Blocked. Completed = Completed on PDP Images. Completed rows can open the Render Tracker output folder. The drawer surfaces warnings (bad EAN, missing template, empty shot list, re-shoot remarks, odd upload status) and prop text or pasted prop images.

**Workflow workspace (UI mock in this preview):** from My Tasks › Active › **Start**, the user chooses **Primary** (start fresh) or **Product Replacement** (reuse a prior Completed match). Replacement is recommended when another Completed EAN shares the same Sub-category + Template; the chooser lists prior matches with a Best match pre-selected. The Replacement / Primary workbench screens are interactive mocks only — no generate, save or upload yet.

**How the page talks to Apps Script:** the hosted page cannot call a Google Apps Script URL with a normal cross-origin `fetch` that carries the user's Google sign-in, so Tasks loads the feed with JSONP (a `<script>` tag + callback). Actions: `tasks` (full feed), `thumbs` (folder image previews), `assign` (write), `assigns` (poll).

### Why the simple hosting and distribution approach

We deliberately avoided servers, app stores and installers.

| Choice | Why it was chosen |
|---|---|
| **GitHub repository** | Free version history. Every change is a commit, so we can see what changed and roll back. |
| **GitHub Pages for the page** | Free, HTTPS by default, no server to run or patch. Pushing to `main` publishes the new version. A single link works for everyone. |
| **Production vs preview URLs** | `index.html` stays the stable V1.1 Renamer. `preview.html` is the V1.3 Tasks shell for testing before cutting everyone over. |
| **GitHub Pages for the setup zip too** | The same push that updates the page updates the download (`dist/3d-playground.zip`). There is no separate file share, email attachment or Drive link to keep in sync. |
| **Processing images in the browser** | No server costs, no upload wait, and images stay private. Scales to any number of users at no cost. |
| **Local upscaler instead of a cloud server** | Each user's own Adobe subscription and login are used. No shared credentials, no hosting costs, and Adobe's limits apply per user rather than to one shared account. |
| **Google Apps Script for Tasks** | Reads and writes the sheets the team already uses. No new database to host. Deploy once; the preview page points at the `/exec` URL. |
| **Plain HTML, CSS and JS** | Nothing to build, nothing to upgrade, and anyone on the team can read and edit it. |
| **Version numbers on file links** | Each file link carries a version number that is increased whenever the file changes, so browsers always fetch the latest copy after a release. |

### How the link and the required pieces reach each user

**Everyone (basic Renamer use):** just the production link, https://vinayvarghese-livspace.github.io/3d-playground/. Nothing else is needed.

**Preview V1.3 testers:** open https://vinayvarghese-livspace.github.io/3d-playground/preview.html (or `#available` / `#my`). Sign in to Google in the same browser so the Apps Script feed can read the sheets. Enter the same author name used in the Renamer.

**AI upscale (one time per PC, about 10 minutes, no admin rights):**

1. In the Renamer, open **Settings › AI upscale setup** (gear icon). The guide is built into the page and shows live status as the user goes.
2. Download `3d-playground.zip` from the button in the guide (hosted on the same GitHub Pages site).
3. Unblock and extract the zip, then double-click **`Setup.bat`**, which:
   - Copies everything to `D:\3d-playground` (or the user's own folder if the PC has no usable D drive), and unblocks the files.
   - Installs Node.js **for this user only** through Windows' built-in `winget` if it's missing, then installs the upscaler.
   - Registers a `playground3d://` link for the current user only, so the page's **Start** button can launch the upscaler.
   - Opens Chrome on Adobe Firefly for a one-time sign-in (including Google 2-Step Verification for company accounts).
   - Starts the upscaler, waits until it is actually connected, then opens 3D Playground with a green *Upscaler connected* status, and closes by itself.
4. **Every day after that:** open the link. If it says *Upscaler offline*, click **Start**.

**Shipping an update:** the developer runs `tools/make-package.ps1` when the upscaler package changed, then pushes. The production Renamer and/or preview Tasks page update for everyone straight away. Apps Script changes need a new web-app deployment (and a matching `FEED_VERSION` bump in `tasks.js`). For upscaler updates on a PC, users repeat the setup with a fresh download; their Adobe sign-in is kept.

---

## Version history

### Beta (V1.0): "Image Renamer", 8 Oct 2026

The first release. It covered the core renaming and conversion job, entirely in the browser.

- EAN entry with 13-digit validation.
- Searchable product type list with variants, generated from the Excel naming sheet (216 product types, 7 categories).
- A live shot list showing the final output file name for every row.
- Drag-and-drop images onto the table (a batch fills the rows in order, or drop one on a specific row).
- Checks for file type (JPG/PNG), minimum 3000 × 3000 px and a square ratio, with per-row status.
- Converts to 3000 × 3000, 24-bit, 72 DPI PNG with a white background.
- Author, Software and Creation Time metadata; the author name is remembered in the browser.
- "Last generation" summary.
- **Files were downloaded one at a time**, one download per image.
- 100% client-side: nothing was uploaded, and there was nothing to install.

**Limits of the beta:** images smaller than 3000 px were simply rejected, and a full product meant many separate downloads that had to be gathered into a folder by hand.

### Beta V1.1: "3D Playground", 12 to 13 Oct 2026

Renamed to **3D Playground**, with AI upscaling and a much smoother output and setup.

**New features:**

- **AI upscale with Adobe Firefly.** An on/off switch (remembered in the browser). When it's on, the minimum accepted size drops from 3000 px to 2000 px, and smaller images are upscaled 2x by Firefly before conversion.
- **Upscale column** with a per-image progress ring, queue position and timing.
- **Live upscaler status** with a one-click **Start** button.
- **One `EAN.zip` download** containing an `EAN` folder with all the images, instead of separate files.
- **Settings menu** (gear icon) with *Change author name* and a step-by-step **AI upscale setup guide** built into the page, with live status, troubleshooting answers and a "copy folder path" button.
- **Hosted setup zip**: the installer is downloaded straight from the page.
- **`Setup.bat`**: a guided 5-step, no-admin installer, plus `Start 3D Playground.bat` and `Sign in to Adobe.bat` shortcuts.

**Reliability fixes after the V1.1 release (12 to 13 Oct):**

- Clear message when Chrome blocks the hosted page from reaching the local upscaler (Chrome's local network access permission).
- Finds Node.js even when Chrome was already open before Node.js was installed.
- `.bat` files are kept in Windows line endings so they always run correctly.
- Installs to `D:\3d-playground` when possible, otherwise the user folder.
- Recovers automatically from a sign-in Chrome window left running in the background.
- No need to click Start after setup: setup starts the upscaler itself, and opens the page only once the upscaler is actually connected.
- The guide explains the second Firefly Chrome window (leave it open, don't use it) and covers Google 2-Step Verification.
- The AI upscale switch setting is remembered between visits.

### Preview V1.2: Tasks + Assign, 27 to 28 Oct 2026

Adds a task board on top of the Renamer, backed by the team's live Google Sheets. Production `index.html` stays on V1.1 Renamer; testers use `preview.html`.

**New features:**

- **Unified preview shell** with tabs Renamer | Available Tasks | My Tasks (`#renamer` / `#available` / `#my`). Renamer loads in an iframe so the existing V1.1 tool stays intact.
- **Available Tasks** built from Shoot Tracker tabs (Decor and Garden, Table Top & Bath, Kitchen & Laundry): only rows with a real GDRIVE folder link + template mapping, excluding EANs already assigned on the Render Tracker.
- **Search, filters and grouping:** search by EAN or product name; filter by category, template, Set / PCs, artist history; group by Sub-category + Template, Product + Template, or Template; sort oldest / newest / most shots. Suggested artists per group based on past Render Tracker work.
- **Assign to live Render Tracker:** one click writes EAN, Artist, PDP Images = Blocked, and Start Date. Assign controls limited to Vinay, Aman and Ananyo. Toast + undo affordance; sheet is the source of truth (no local picks).
- **My Tasks** with Active / Completed buckets, status from PDP Images, output folder link for completed work, and a preview drawer (shots, Drive, PDP guideline, props, data warnings).
- **Drive folder thumbnails** via the Apps Script `thumbs` action.
- **Live refresh:** full Refresh control, plus a quiet poll of assignments about every 30 seconds while the tab is visible.
- **Author name shared** with the Renamer (`localStorage`).

**Workflow workspace (UI mock in this preview):**

- **Start** on an Active My Task opens Choose workflow: **Primary** vs **Product Replacement**.
- Replacement is recommended when a Completed prior EAN shares Sub-category + Template; prior matches are listed with Best match pre-selected.
- Replacement / Primary workbench screens (shot mapping, compare slider, product-type picker, generate UI) are interactive mocks only — no AI generate, save or upload yet.

**Hosting / safety choices for V1.2:**

- Production Renamer URL unchanged so day-to-day work is not interrupted.
- Apps Script feed uses JSONP so the hosted GitHub Pages origin can read sheet data with the user's Google session.
- Assign skips EANs already present on the Render Tracker instead of overwriting them.

### Preview V1.3: My Tasks status + Assign UX, 28 Oct 2026

Refines the V1.2 Tasks preview. Production `index.html` (https://vinayvarghese-livspace.github.io/3d-playground/) stays the V1.1 Renamer — only `preview.html` changes.

**Changes:**

- **Assign to** opens the artist menu only (no self-assign on the main button; no caret). Errors show in a red toast.
- **My Tasks Active** shows Not started, In progress and Blocked; **Completed** shows Completed only (PDP Images column — not Photoshoot Status "Done").
- **Active sort priority:** groups and rows ordered In progress → Not started → Blocked.
- **Templates** such as `T2a`, `T61a`, `T7 set` are recognised (letter suffixes and set variants).
- Artist matching accepts first-name forms (e.g. Naveen ≈ Naveen Kumar). Tracker status refreshes on poll so sheet Completed / In progress updates appear without a full reload.

### Summary of changes

| | Beta (V1.0) | Beta V1.1 | Preview V1.2 | Preview V1.3 |
|---|---|---|---|---|
| Name | Image Renamer | 3D Playground | 3D Playground (Preview Tasks) | Same preview shell |
| Where people open it | GitHub Pages | GitHub Pages | Production = V1.1 Renamer; Preview = `preview.html` | Same (production root unchanged) |
| Minimum image size | 3000 px | 2000 px with AI upscale (3000 px without) | Same as V1.1 | Same as V1.1 |
| Small images | Rejected | Upscaled 2x by Adobe Firefly | Same as V1.1 | Same as V1.1 |
| Output | One download per image | One `EAN.zip` with an `EAN` folder | Same as V1.1 | Same as V1.1 |
| Task board | None | None | Available Tasks + My Tasks | Status buckets + Active priority sort |
| Assignments | Manual sheet edits | Manual sheet edits | One-click Assign to live Render Tracker | Assign-to menu only; red error toasts |
| Install needed | None | None for basic use; one-time `Setup.bat` for AI upscale | Same + Google sign-in for Tasks feed | Same |
| Data leaves the PC | Never | Only images that need upscaling, to the user's own Firefly account | Same for images; task metadata read/written via Apps Script to team sheets | Same |
| Help | None in the page | Settings menu with a full setup guide and troubleshooting | Same + task drawer warnings and empty-state guidance | Same |
| Preferences remembered | Author name | Author name and AI upscale on/off | Same; author shared across Renamer and Tasks | Same |
