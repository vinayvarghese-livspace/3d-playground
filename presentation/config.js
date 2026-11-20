/**
 * Apps Script web app /exec URL (dashboard/apps-script-presentation).
 * UI is hosted with 3D Playground on GitHub Pages:
 *   https://vinayvarghese-livspace.github.io/3d-playground/presentation/
 * Redeploy Code.gs only when the backend changes.
 */
var PRESENTATION_FEED_URL =
  'https://script.google.com/a/macros/livspace.com/s/AKfycbzZHOk0Pn-nfGTS8-UtM06zVO1Hg51PdAJf3Ox8xtEP7WMzW2oGgVjB-SQvaQflBK06yA/exec';

/** How often to re-read the sheet (ms). */
var PRESENTATION_POLL_MS = 8000;

/**
 * Categories & Subcategories Apps Script (dashboard/apps-script-categories).
 * Feeds the finder: Division → Dept → Category → Sub-category.
 */
var CATEGORIES_FEED_URL =
  'https://script.google.com/a/macros/livspace.com/s/AKfycbwoL3q6yJdwU44-2HGu_ltwjaAM8bnRbkwq6ngQf7wAPS8FFKmak39wi-v08vYqroS0_g/exec';
