# 3D Playground: Overview

**Live link:** https://vinayvarghese-livspace.github.io/3d-playground/
**Source code:** https://github.com/vinayvarghese-livspace/3d-playground
**Current version:** Beta V1.2 (Tasks + Assign to live Render Tracker)

---

## Part 1: What it is and why we built it (non-technical)

### In one line

3D Playground turns a folder of product photos or renders into a ready-to-upload set of marketplace images: correctly named, correctly sized, in the correct order, in one click.

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

### What 3D Playground does

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

### How it helps

- **4x manual worktime saving per product.** Looking things up, renaming, resizing and upscaling are all automatic.
- **No naming mistakes.** File names are generated from the official naming sheet, never typed.
- **Problems are caught before upload, not after.** Wrong size, wrong shape or wrong file type are shown on the row, with a plain explanation.
- **Smaller images are no longer a dead end.** With AI upscale on, images from 2000 px up are enlarged by Firefly and used directly.
- **Everyone produces the same output.** Same rules, same names, same specs, whoever runs it.
- **Accountability.** Every file carries its author and creation time.
- **Private by default.** Without AI upscale, images never leave the computer. Everything happens inside the browser.
- **Nothing to install for basic use.** It is just a web link. AI upscale needs a one-time, roughly 10 minute setup per PC, with no admin rights needed.
- **No extra expense in using.** It uses free Firefly upscaler with no cost which comes from Photoshop subscription.

---

## Part 2: Technical explanation

### Architecture at a glance

There are two parts:

1. **The web page** (hosted on GitHub Pages). This does all the core work in the browser.
2. **The local upscaler** (V1.1, optional). A small Node.js program on the user's PC that drives Adobe Firefly on the user's behalf.

| Where | What runs there | Role |
|---|---|---|
| GitHub | Repository and GitHub Pages | Stores the code and version history; publishes the web page and the setup zip |
| User's PC: Chrome | The 3D Playground page | Checks, resizes, names, adds metadata and zips the images, all in the browser |
| User's PC: local service (optional) | Node.js upscaler on 127.0.0.1:5175 | Receives only the images that need upscaling and queues them |
| User's PC: dedicated Chrome window (optional) | Chrome signed in to the user's Adobe account | Controlled by the service to upload images to Firefly and download the upscaled results |
| Adobe | Firefly upscale | Performs the 2x AI upscale |

**Flow:** GitHub Pages delivers the page to Chrome. The page does the work itself. If an image is too small and AI upscale is on, the page sends it to the local service, which uses the dedicated Chrome window to run it through Firefly and returns the upscaled image to the page.

### Part A: The web page

**Technology:** plain HTML, CSS and JavaScript (`index.html`, `styles.css`, `app.js`, `data.js`). No frameworks, no build step, and no external libraries apart from Google Fonts.

| Concern | How it is done | Why |
|---|---|---|
| Naming rules | The Excel naming sheet is converted to `data.js` by `tools/convert-naming-data.ps1` (it reads the .xlsx directly, no Excel needed). The page shows "Data last updated" from the sheet's timestamp. | The sheet stays the single source of truth; updating the rules is "re-run the script, push". |
| Image checks | The browser reads each image's width and height and checks the file type, the minimum size and the 1:1 ratio. | Problems are caught before generation, per row, with a reason. |
| Resize and convert | An HTML canvas draws the image centred on a white 3000 × 3000 square. | Built into every browser, nothing to install. |
| PNG encoding | Custom 24-bit RGB PNG encoder using the browser's built-in `CompressionStream`, with 72 DPI set. | The browser's own export always writes 32-bit RGBA with no DPI (shown as 96 DPI), which doesn't match the spec. |
| Metadata | Writes Author, Title, Description, Software and Creation Time as PNG `tEXt` chunks **and** XMP. | Windows Explorer and most photo tools read XMP, other tools read `tEXt`; writing both covers both. |
| Zip download | A small zip writer built into `app.js` ("stored", no compression, because PNGs are already compressed). | One clean download, no library needed. |
| Memory | The author name, the AI upscale on/off choice, a batch counter and the last generation summary are saved in the browser's `localStorage`. | No login or database needed for these per-user preferences. |

**Backend readiness:** naming data is loaded through a single function (`loadNamingData`) that currently reads `data.js`. It is marked to be swapped for a Supabase query once the backend table is ready, so the move to a live database only changes that one function.

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

### Why the simple hosting and distribution approach

We deliberately avoided servers, app stores and installers.

| Choice | Why it was chosen |
|---|---|
| **GitHub repository** | Free version history. Every change is a commit, so we can see what changed and roll back. |
| **GitHub Pages for the page** | Free, HTTPS by default, no server to run or patch. Pushing to `main` publishes the new version. A single link works for everyone. |
| **GitHub Pages for the setup zip too** | The same push that updates the page updates the download (`dist/3d-playground.zip`). There is no separate file share, email attachment or Drive link to keep in sync. |
| **Processing in the browser** | No server costs, no upload wait, and images stay private. Scales to any number of users at no cost. |
| **Local upscaler instead of a cloud server** | Each user's own Adobe subscription and login are used. No shared credentials, no hosting costs, and Adobe's limits apply per user rather than to one shared account. |
| **Plain HTML, CSS and JS** | Nothing to build, nothing to upgrade, and anyone on the team can read and edit it. |
| **Version numbers on file links** | Each file link carries a version number that is increased whenever the file changes, so browsers always fetch the latest copy after a release. |

### How the link and the required pieces reach each user

**Everyone (basic use):** just the link, https://vinayvarghese-livspace.github.io/3d-playground/. Nothing else is needed.

**AI upscale (one time per PC, about 10 minutes, no admin rights):**

1. In the page, open **Settings › AI upscale setup** (gear icon). The guide is built into the page and shows live status as the user goes.
2. Download `3d-playground.zip` from the button in the guide (hosted on the same GitHub Pages site).
3. Unblock and extract the zip, then double-click **`Setup.bat`**, which:
   - Copies everything to `D:\3d-playground` (or the user's own folder if the PC has no usable D drive), and unblocks the files.
   - Installs Node.js **for this user only** through Windows' built-in `winget` if it's missing, then installs the upscaler.
   - Registers a `playground3d://` link for the current user only, so the page's **Start** button can launch the upscaler.
   - Opens Chrome on Adobe Firefly for a one-time sign-in (including Google 2-Step Verification for company accounts).
   - Starts the upscaler, waits until it is actually connected, then opens 3D Playground with a green *Upscaler connected* status, and closes by itself.
4. **Every day after that:** open the link. If it says *Upscaler offline*, click **Start**.

**Shipping an update:** the developer runs `tools/make-package.ps1` (rebuilds the zip with only the files another PC needs, and fixes `.bat` line endings so Windows runs them correctly), then pushes. The page updates for everyone straight away. For upscaler updates, users repeat the setup with a fresh download; their Adobe sign-in is kept.

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

### Summary of changes

| | Beta (V1.0) | Beta V1.1 |
|---|---|---|
| Name | Image Renamer | 3D Playground |
| Minimum image size | 3000 px | 2000 px with AI upscale (3000 px without) |
| Small images | Rejected | Upscaled 2x by Adobe Firefly |
| Output | One download per image | One `EAN.zip` with an `EAN` folder |
| Install needed | None | None for basic use; one-time `Setup.bat` for AI upscale |
| Data leaves the PC | Never | Only images that need upscaling, to the user's own Firefly account |
| Help | None in the page | Settings menu with a full setup guide and troubleshooting |
| Preferences remembered | Author name | Author name and AI upscale on/off |
