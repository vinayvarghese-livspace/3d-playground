# Google Stitch — sequential screen instructions

**Product:** 3D Playground · Preview V1.2  
**Journey:** My Tasks → Active → **Start** → Choose workflow → Product Replacement  
**How to use:** Paste **Shared design system** once into Stitch context, then generate **Screen 1 → 2 → 3 → 4** one after another. Attach the matching screenshot for that step. Keep the same product (Oil Pourer) and chrome so screens match.

**Screenshot map (attach with each prompt):**

| Step | Current screenshot | Generate |
|------|--------------------|----------|
| 1 | Choose workflow (Oil Pourer + two cards + Possible previous matches) | Redesigned choose + **select Best match EAN** |
| 2 | Product Replacement (Best prior match + long one-to-one rows) | Redesigned **mapping + generate** workbench |
| 3 | (Build on Screen 2) | **Side panel** detail + compare |
| 4 | Primary workflow shot page (for chrome/rail reference only) | Optional: same header/Back pattern on Primary — **not required** for Replacement pass |

---

## Shared design system (paste once; keep identical across all generations)

```
App: 3D Playground Preview V1.2 — internal desktop tool (≈1440px wide).

Chrome (do not redesign):
- Top nav: logo “3D Playground” + Preview V1.2 pill | tabs Renamer, Available Tasks (128), My Tasks (25) active | “Updated … ago” + author “vinay”
- Thin yellow beta banner under nav
- Light gray page background (#F7F8F8-ish), white cards, 12px radius, light border/shadow
- Teal/green primary buttons (~#0B6B5F), ghost/outline secondary buttons
- Status pills: Blocked (amber), In progress (blue), Not started (gray), Best match (green)
- Monospace for EAN numbers; teal text links for “Output folder” / “PDP guideline”
- Product header pattern: square product thumb (Oil Pourer silver) + kicker + H1 title + “EAN · Sub-category · Template T9” + chip row (Blocked, Template T9, PCs, 5 shots, PDP guideline)

Navigation fix (all workspace screens):
- Replace the tiny orphan “← Back” above the thumb with a clear breadcrumb row:
  [← Back to My Tasks]  My Tasks › Active › {current step}
- Keep product header BELOW the breadcrumb, not beside a lonely Back.

Tone: dense workbench, not marketing. No purple gradients, no glow, no emoji.
Sample task always: Oil Pourer · EAN 8909327028204 · Oil & Vinegar Storage · Template T9 · 5 shots:
  1 Hero front · 2 Lifestyle shot · 3 Hero Shot (Close up) · 4 Lifestyle shot (With the lid open) · 5 Product Dimension
```

---

## SCREEN 1 — Choose workflow + confirm Best match EAN

**Attach:** current Choose workflow screenshot  
**Stitch mode:** Redesign this screen (same content, clearer selection + confirm)

### Paste into Stitch

```
Redesign this exact “Choose workflow” screen from 3D Playground (see attached screenshot). Keep the same header chrome, product (Oil Pourer), and the two workflow cards. Fix navigation and make Best-match EAN selection explicit.

KEEP
- Yellow beta banner + existing top nav
- Product header: thumb, “CHOOSE WORKFLOW”, Oil Pourer, EAN 8909327028204, Oil & Vinegar Storage, Template T9, chips
- Card “How do you want to work this task?” with two options side by side:
  LEFT: Product Replacement (steps: Review best prior outputs → Map each shot → Generate / refine)
  RIGHT: Primary workflow
- Card “Possible previous matches” listing rows like Fruit Basket, Kitchen Roll holder, Mug Tree… with initials thumb, title, EAN, “by …”, match pill (“Best match · Template only” green / “Template only” blue), “Output folder” link

CHANGE
1) Breadcrumb navigation: “← Back to My Tasks” + “My Tasks › Active › Choose workflow” above the product header. Remove the tiny Back sitting alone above the thumb.
2) Possible previous matches become SELECTABLE (radio / selected ring + check). Pre-select the first “Best match” row (Fruit Basket). Clicking a row selects that prior EAN; Output folder link must not steal the whole-row click (link stays separate).
3) Below the match list (or sticky under the Product Replacement card), show a confirmation bar:
   “Using prior EAN 8909… · Best match · Template only · by Maneesh”
   Primary button: “Continue with Product Replacement”
   Secondary text button: “Continue with Primary workflow”
4) If Product Replacement is chosen without a selection, disable Continue and hint “Select a prior match first.”
5) Recommendation badge: keep on the recommended workflow card (as in screenshot). Do not invent new branding.

Do NOT add mapping rows, prompts, or Answerly on this screen. Desktop only. Match visual style of the screenshot.
```

### Done when
- Best match is clearly selected  
- Continue CTA confirms that EAN  
- Back/breadcrumb is obvious  

---

## SCREEN 2 — Product Replacement workbench (mapping + generate)

**Attach:** current Product Replacement one-to-one mapping screenshot  
**Also keep Screen 1 output nearby** so Stitch continues the same prior EAN (Fruit Basket)  
**Stitch mode:** Redesign; this is the main new screen

### Paste into Stitch

```
Redesign the Product Replacement page from the attached screenshot. Same app chrome and Oil Pourer task. Selected prior match from previous screen: Fruit Basket · EAN (prior) · Best match · Template only · by Maneesh · Output folder.

PROBLEM WITH CURRENT UI
- Tiny Back above thumb is unclear
- Long vertical stack of Prior → dropzone rows is hard to scan
- No prompt, no generate, no output, no multi-image clarity, no dimension exception

NEW LAYOUT (desktop workbench)
1) Breadcrumb: “← Back to My Tasks” · My Tasks › Active › Product Replacement
2) Product header (same as screenshot) PLUS a compact “Prior match” chip under chips:
   Fruit Basket · prior EAN · Best match · [Change] [Open output folder]
3) Main body = 3 columns:
   LEFT (~220px): “Required shots” rail (reuse style from Primary workflow shot list): 
     Hero front (In progress), Lifestyle shot, Hero Shot (Close up), Lifestyle shot (With the lid open), Product Dimension — with Seq and status pills
   CENTER (flex): Active shot work card
   RIGHT (~360px): Side panel placeholder labeled “Detail / Compare” (empty state: “Select an image to inspect”) — full compare UI comes in Screen 3; reserve the column now so layout matches

ACTIVE SHOT CARD — “Hero front” (Seq 1) as the example, but design the pattern for all shots

Row concept (horizontal, not a tall Prior|Drop only stack):
A) PRIOR (auto from Drive of selected match)
   - Real-looking prior output thumbnail for this shot (not empty “Prior/Drive” boxes)
   - Caption: shot name + image file name (e.g. 8909…_01_H-FR.png)
   - Auto-populated — author does not upload prior
B) NEW PRODUCT INPUT (author action)
   - Drop zone accepting ONE OR MANY images
   - Empty hint: “Drop new product image(s) · JPG/PNG · source TBD: Drive thumb or offline file”
   - Filled state: removable chips with image names (e.g. new_front.png); lifestyle may show 2+
   - Hero/lifestyle: prior already mapped; only new product images are dropped
C) PROMPT
   - Prefills from prompt database when available (show a sample successful prompt for Hero front)
   - Actions: View prompt (expand) · Edit (textarea enabled)
   - Footnote: “Saved to Prompt database after success (sheet yet to create)”
D) OUTPUT (Answerly)
   - Same row: placeholder → spinner “Running…” → result thumbnail
   - Status pill on the shot in the left rail updates when done

ACTIONS
- In card footer: “Mark shot blocked” (ghost) · “Generate this shot” (primary)
- Sticky bar bottom or header right: “Generate all pending” (outline/primary)
- Annotate: inputs + prompt go to Answerly; output appears in this row

DIMENSION EXCEPTION (show on Product Dimension shot — include a second small state or annotation on Seq 5)
- Optional toggle: “Dimensions differ — create as separate image (skip 1:1 map)”
- When on: prior map muted; author adds a new dimension image; same prompt/generate pattern
- Default off

DATA FOOTNOTES (small, bottom of card — no full admin UI)
- Image names used per shot → new Google Sheet
- Prompt DB columns: EAN Number | Author | Primary/Product replacement | Product Type | Model name | Image Name | Final successful prompt | Prior image (A) | Product image (B)

KEEP visual language of the screenshot (cards, teal buttons, pills). Remove the blue “UI mock” banner or replace with a quieter note. No purple AI chrome.
```

### Done when
- Prior Drive thumbs auto-show with image names  
- Only new product images are dropped (1+)  
- Prompt view/edit + Generate this / all  
- Output slot in the same row  
- Dimension exception visible as optional  
- Breadcrumb Back + Change prior  

---

## SCREEN 3 — Side panel detail + comparison

**Attach:** Screen 2 Stitch result (preferred) or Product Replacement screenshot  
**Stitch mode:** Same screen as 2, with side panel filled / compare mode on

### Paste into Stitch

```
Continue the Product Replacement workbench from the previous design (Oil Pourer, Fruit Basket prior, Hero front active). Do not redesign the whole page — flesh out the RIGHT SIDE PANEL only, and show it in two states if possible (tabs or stacked frames).

PANEL BEHAVIOUR
- Opens when user clicks any Prior / Input / Output thumbnail
- Slightly larger image than the row thumbs
- Header: shot name · role badge (Prior | Input | Output) · image file name · Close
- Tabs: Detail | Compare

DETAIL TAB
- Large preview
- Meta: EAN (task or prior), author, Drive link if Prior/Output, image name(s)
- For multiple inputs: thumbnail strip to switch

COMPARE TAB
- Side-by-side (or before/after slider): LEFT “Prior” (auto Drive output for this shot) · RIGHT “Output” (Answerly result)
- Labels under each
- Optional third strip: “Input product” thumbnails
- Primary use: check replacement quality against prior

Keep left shot rail + center row visible behind/beside the panel (docked ~360–400px, same as reserved column). Esc/Close returns to empty panel state. Match existing teal/light card UI.
```

### Done when
- Larger preview works  
- Prior vs Output compare is clear  
- Panel does not break the workbench layout  

---

## SCREEN 4 — Optional consistency pass (Primary workflow header only)

**Attach:** Primary workflow screenshot (clean plate + Hero front prompt)  
**Only if you want Back/breadcrumb parity** — not required for Replacement

### Paste into Stitch

```
Light redesign of navigation only on this Primary workflow screen. Keep Required shots rail, Template clean plate card, Shot · Hero front prompt + dropzone, and buttons exactly as in the screenshot. Replace the tiny “← Back” with breadcrumb: “← Back to My Tasks” · My Tasks › Active › Primary workflow. Do not change clean plate or shot content.
```

---

## Generation order checklist

1. Paste **Shared design system** into Stitch project notes  
2. Generate **Screen 1** + attach Choose workflow screenshot  
3. Generate **Screen 2** + attach Product Replacement screenshot (and Screen 1 result)  
4. Generate **Screen 3** + attach Screen 2 result  
5. (Optional) **Screen 4** for Primary Back parity  

---

## Short reminder of product rules (for annotations on Screen 2–3)

| Rule | UI implication |
|------|----------------|
| Select & confirm Best match EAN | Screen 1 selection + Continue |
| Auto map hero/lifestyle from Drive | Prior column filled; names shown |
| Author drops only new product image(s) | Multi-file dropzone |
| Dimension differ → optional separate create | Toggle on Product Dimension |
| Store image names used | Footnote → new sheet |
| Prompt from DB; author can view/edit | Prefill + View/Edit |
| Generate one or all → Answerly | Buttons; output in same row |
| Bigger view + compare | Side panel |
| Prompt DB schema | Footnote columns listed |
| Drag source TBD | Hint on dropzone |
