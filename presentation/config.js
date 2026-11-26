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
 * Finder tree (Division → Sub) via MTS Furniture Apps Script (`action=nav`).
 * Same /exec + Allow as playground MTS. dashboard/apps-script-mts-furniture
 */
var CATEGORIES_FEED_URL =
  'https://script.google.com/a/macros/livspace.com/s/AKfycbyMZSpmOfCpu4Dx45DjLN8et1TLqFcKRMATFgNwnZLZD_JYpn5WA0qMNuAM8tc_t-91mA/exec';
