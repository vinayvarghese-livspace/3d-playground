/**
 * Same Prompt Database web app as the playground.
 * After editing dashboard/apps-script-prompt-db/Code.gs, deploy a new version
 * (Deploy → Manage deployments → pencil → New version) so action=stats is live.
 *
 * Team names and public holidays: edit holidays.json.
 * exclude is always left out of team figures (vinay).
 * roster is the allow-list. Leave roster empty to count everyone except exclude.
 */
var STATS_FEED_URL = 'https://script.google.com/a/macros/livspace.com/s/AKfycbwjLPIuL9J_XtHmnEm7jdbnJHlUIEjscACqYiSIB3ISTQNXHDhKHAVyuOc9VuPaobHT/exec';
var AUTHOR_KEY = 'imageRenamer.author';
