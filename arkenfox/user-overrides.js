

/* Custom user configs */
/* https://raw.githubusercontent.com/arkenfox/user.js/refs/heads/master/user.js */

/*
 * Persist website data over reboot
 * */


/* 2810: enable Firefox to clear items on shutdown
 * [NOTE] In FF129+ clearing "siteSettings" on shutdown (2811+), or manually via site data (2820+) and
 * via history (2830), will no longer remove sanitize on shutdown "cookie and site data" site exceptions (2815)
 * [SETTING] Privacy & Security>History>Custom Settings>Clear history when Firefox closes | Settings ***/
user_pref("privacy.sanitize.sanitizeOnShutdown", false);

/** SANITIZE ON SHUTDOWN: IGNORES "ALLOW" SITE EXCEPTIONS ***/
/* 2811: set/enforce clearOnShutdown items (if 2810 is true) [SETUP-CHROME] [FF128+] ***/
user_pref("privacy.clearOnShutdown_v2.cache", false); // [DEFAULT: true]
user_pref("privacy.clearOnShutdown_v2.historyFormDataAndDownloads", false); // [DEFAULT: true]
// user_pref("privacy.clearOnShutdown_v2.siteSettings", false); // [DEFAULT: false]
/* 2812: set/enforce clearOnShutdown items [FF136+] ***/
user_pref("privacy.clearOnShutdown_v2.browsingHistoryAndDownloads", false); // [DEFAULT: true]
user_pref("privacy.clearOnShutdown_v2.downloads", false); // [HIDDEN]
user_pref("privacy.clearOnShutdown_v2.formdata", true);
/* 2813: set Session Restore to clear on shutdown (if 2810 is true) [FF34+]
 * [NOTE] Not needed if Session Restore is not used (0102) or it is already cleared with history (2811+)
 * [NOTE] If true, this prevents resuming from crashes (also see 5008) ***/
// user_pref("privacy.clearOnShutdown.openWindows", true);

/** SANITIZE ON SHUTDOWN: RESPECTS "ALLOW" SITE EXCEPTIONS ***/
/* 2815: set "Cookies" and "Site Data" to clear on shutdown (if 2810 is true) [SETUP-CHROME] [FF128+]
 * [NOTE] Exceptions: For cross-domain logins, add exceptions for both sites
 * e.g. https://www.youtube.com (site) + https://accounts.google.com (single sign on)
 * [WARNING] Be selective with what sites you "Allow", as they also disable partitioning (1767271)
 * [SETTING] to add site exceptions: Ctrl+I>Permissions>Cookies>Allow (when on the website in question)
 * [SETTING] to manage site exceptions: Options>Privacy & Security>Permissions>Settings ***/
user_pref("privacy.clearOnShutdown_v2.cookiesAndStorage", false);

/** SANITIZE SITE DATA: IGNORES "ALLOW" SITE EXCEPTIONS ***/
/* 2820: set manual "Clear Data" items [SETUP-CHROME] [FF128+]
 * Firefox remembers your last choices. This will reset them when you start Firefox
 * [SETTING] Privacy & Security>Browser Privacy>Cookies and Site Data>Clear Data ***/
user_pref("privacy.clearSiteData.cache", true);
user_pref("privacy.clearSiteData.cookiesAndStorage", false); // keep false until it respects "allow" site exceptions
user_pref("privacy.clearSiteData.historyFormDataAndDownloads", false);
// user_pref("privacy.clearSiteData.siteSettings", false);
/* 2821: set manual "Clear Data" items [FF136+] ***/
user_pref("privacy.clearSiteData.browsingHistoryAndDownloads", false);
user_pref("privacy.clearSiteData.formdata", true);

/** SANITIZE HISTORY: IGNORES "ALLOW" SITE EXCEPTIONS ***/
/* 2830: set manual "Clear History" items, also via Ctrl-Shift-Del [SETUP-CHROME] [FF128+]
 * Firefox remembers your last choices. This will reset them when you start Firefox
 * [SETTING] Privacy & Security>History>Custom Settings>Clear History ***/
user_pref("privacy.clearHistory.cache", false); // [DEFAULT: true]
user_pref("privacy.clearHistory.cookiesAndStorage", false);
user_pref("privacy.clearHistory.historyFormDataAndDownloads", false); // [DEFAULT: true]
// user_pref("privacy.clearHistory.siteSettings", false); // [DEFAULT: false]
/* 2831: set manual "Clear History" items [FF136+] ***/
user_pref("privacy.clearHistory.browsingHistoryAndDownloads", false); // [DEFAULT: true]
user_pref("privacy.clearHistory.formdata", true);

/** SANITIZE MANUAL: TIMERANGE ***/
/* 2840: set "Time range to clear" for "Clear Data" (2820+) and "Clear History" (2830+)
 * Firefox remembers your last choice. This will reset the value when you start Firefox
 * 0=everything, 1=last hour, 2=last two hours, 3=last four hours, 4=today
 * [NOTE] Values 5 (last 5 minutes) and 6 (last 24 hours) are not listed in the dropdown,
 * which will display a blank value, and are not guaranteed to work ***/
user_pref("privacy.sanitize.timeSpan", 0);
