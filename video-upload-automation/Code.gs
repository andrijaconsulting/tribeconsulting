/**
 * Video upload → content calendar automation (Andrija).
 *
 * Every few minutes this script looks for new videos in the Andrija Drive
 * folder (including its month/category subfolders) and, for each new one,
 * adds a row to the "Andrija" content calendar spreadsheet:
 *
 *   Date      the next weekday after the upload day
 *             (Mon→Tue, …, Thu→Fri, Fri/Sat/Sun→Mon)
 *   Post Type "Remixed Winner"
 *   Editor    "Andrija"
 *   GDrive    link to the video
 *   Caption   video file name without the extension
 *   Hot?      "No"
 *   H Promo?  "No"
 *
 * The row goes beneath the last filled row of the current month's sheet
 * (e.g. "Oct26"). If that sheet doesn't exist yet, the previous month's sheet
 * is used. The second video of each day gets the "light yellow 3" fill and
 * "imanunseen" in Reviewer Notes.
 *
 * Also includes the "Fill Yellow Reviewer Notes" tool: it writes "imanunseen"
 * into Reviewer Notes for every yellow row of the open sheet (for rows you
 * colour by hand).
 *
 * Setup: see README.md in this folder. In short, paste this file into
 * Extensions → Apps Script of the spreadsheet and run `install` once.
 */

const CONFIG = {
  SPREADSHEET_ID: '1ekoPxwWGybJK00_cegswLbiEOtum2rEqXsYPbfCwFtQ',
  DRIVE_FOLDER_ID: '1pl_cH5BVuifiJRRU9GlHiStfJxCJbE0T',

  POST_TYPE: 'Remixed Winner',
  EDITOR: 'Andrija',
  HOT: 'No',
  H_PROMO: 'No',

  // Time zone used to decide which day a video was uploaded on, e.g.
  // 'Europe/Belgrade'. Empty = the spreadsheet's time zone.
  TIME_ZONE: '',

  // "light yellow 3" in the Google Sheets colour palette.
  HIGHLIGHT_COLOR: '#fff2cc',
  // Which video of the day gets highlighted (ads don't count).
  HIGHLIGHT_NTH_VIDEO: 2,
  // Reviewer Notes text for yellow rows.
  YELLOW_NOTE: 'imanunseen',
  // Background colours treated as "yellow" by Fill Yellow Reviewer Notes.
  YELLOW_COLORS: ['#ffff00', '#fff2cc'],

  CHECK_EVERY_MINUTES: 5,
  // Look back this far past the last run, so slow uploads aren't missed.
  LOOKBACK_MINUTES: 60,
  // How many previous months to try when the current month's sheet is missing.
  MAX_MONTHS_BACK: 3,
};

// 1-based column numbers in the month sheets.
const COL = {
  DATE: 1,      // A
  POST_TYPE: 2, // B
  EDITOR: 3,    // C
  GDRIVE: 4,    // D
  APPROVED: 5,  // E
  CAPTION: 6,   // F
  HOT: 7,       // G
  H_PROMO: 8,   // H
  NOTES: 9,     // I
};
const FIRST_DATA_ROW = 2;
const HIGHLIGHT_WIDTH = COL.NOTES; // fill A:I

const PROP_START = 'START_TIME';
const PROP_LAST_RUN = 'LAST_RUN';
const PROP_SEEN = 'SEEN_FILE_IDS';
const MAX_SEEN_IDS = 200;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Run once by hand: starts watching from now on and creates the timer. */
function install() {
  uninstall();
  const props = PropertiesService.getScriptProperties();
  const now = new Date().toISOString();
  props.setProperty(PROP_START, now);
  props.setProperty(PROP_LAST_RUN, now);
  ScriptApp.newTrigger('checkForNewVideos')
    .timeBased()
    .everyMinutes(CONFIG.CHECK_EVERY_MINUTES)
    .create();
  Logger.log('Installed. Watching for videos uploaded after ' + now);
}

/** Stops the automation. */
function uninstall() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkForNewVideos')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Adds the "Auto-Fill" menu to the spreadsheet (bound script only). */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Auto-Fill')
    .addItem('Fill Yellow Reviewer Notes', 'fillYellowNotes')
    .addSeparator()
    .addItem('Check for new videos now', 'checkForNewVideos')
    .addItem('Preview next row (no changes)', 'previewNextRow')
    .addSeparator()
    .addItem('Install / restart', 'install')
    .addItem('Stop', 'uninstall')
    .addToUi();
}

/** Writes YELLOW_NOTE into Reviewer Notes for every yellow row of the open sheet. */
function fillYellowNotes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return;

  const range = sheet.getRange(FIRST_DATA_ROW, COL.NOTES, lastRow - FIRST_DATA_ROW + 1, 1);
  const backgrounds = range.getBackgrounds();
  const values = range.getValues();
  let updated = false;
  for (let i = 0; i < values.length; i++) {
    if (isYellow_(backgrounds[i][0]) && values[i][0] !== CONFIG.YELLOW_NOTE) {
      values[i][0] = CONFIG.YELLOW_NOTE;
      updated = true;
    }
  }
  if (updated) range.setValues(values);
}

function isYellow_(color) {
  return CONFIG.YELLOW_COLORS.indexOf(String(color).toLowerCase()) !== -1;
}

/** Called by the timer. Adds a row for every new video found. */
function checkForNewVideos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const start = props.getProperty(PROP_START);
    if (!start) throw new Error('Run install() first.');

    const runStartedAt = new Date();
    const lastRun = new Date(props.getProperty(PROP_LAST_RUN) || start);
    const since = new Date(Math.max(
      new Date(start).getTime(),
      lastRun.getTime() - CONFIG.LOOKBACK_MINUTES * 60 * 1000
    ));

    const seen = JSON.parse(props.getProperty(PROP_SEEN) || '[]');
    const videos = findVideosCreatedSince_(since)
      .filter((f) => seen.indexOf(f.getId()) === -1)
      .sort((a, b) => a.getDateCreated() - b.getDateCreated());

    if (videos.length) {
      const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      videos.forEach((file) => {
        addVideoRow_(ss, file);
        seen.push(file.getId());
      });
      SpreadsheetApp.flush();
      props.setProperty(PROP_SEEN, JSON.stringify(seen.slice(-MAX_SEEN_IDS)));
    }
    props.setProperty(PROP_LAST_RUN, runStartedAt.toISOString());
  } finally {
    lock.releaseLock();
  }
}

/** Shows where a video uploaded right now would go, without changing anything. */
function previewNextRow() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const tz = timeZone_(ss);
  const now = new Date();
  const sheet = getTargetSheet_(ss, now);
  const state = readSheetState_(sheet);
  const msg = 'A video uploaded now → sheet "' + sheet.getName() + '", row ' +
    (state.lastFilledRow + 1) + ', date ' + postDateForUpload(toDayKey_(now, tz));
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* not opened from the sheet */ }
}

// ---------------------------------------------------------------------------
// Sheet logic
// ---------------------------------------------------------------------------

/** Adds the row for `file`; highlights it if it's the day's HIGHLIGHT_NTH_VIDEO-th video. */
function addVideoRow_(ss, file) {
  const tz = timeZone_(ss);
  const uploaded = file.getDateCreated();
  const sheet = getTargetSheet_(ss, uploaded);
  const state = readSheetState_(sheet);

  if (state.links.some((link) => link.indexOf(file.getId()) !== -1)) {
    Logger.log('Already in sheet, skipping: ' + file.getName());
    return;
  }

  const dayKey = postDateForUpload(toDayKey_(uploaded, tz));
  const sameDay = state.rows.filter((r) => r.dayKey === dayKey);
  const videosBefore = sameDay.filter((r) => r.isVideo).length;
  const highlight = videosBefore + 1 === CONFIG.HIGHLIGHT_NTH_VIDEO &&
    !sameDay.some((r) => r.isHighlighted);

  const row = state.lastFilledRow + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);

  sheet.getRange(row, COL.DATE)
    .setNumberFormat('m/d')
    .setValue(dayKeyToSerial(dayKey));
  sheet.getRange(row, COL.POST_TYPE, 1, 3)
    .setValues([[CONFIG.POST_TYPE, CONFIG.EDITOR, driveLink_(file.getId())]]);
  sheet.getRange(row, COL.CAPTION, 1, 3)
    .setValues([[captionFromFileName(file.getName()), CONFIG.HOT, CONFIG.H_PROMO]]);
  if (highlight) {
    sheet.getRange(row, 1, 1, HIGHLIGHT_WIDTH).setBackground(CONFIG.HIGHLIGHT_COLOR);
    sheet.getRange(row, COL.NOTES).setValue(CONFIG.YELLOW_NOTE);
  }
  Logger.log('Added "' + file.getName() + '" to ' + sheet.getName() + ' row ' + row +
    ' (' + dayKey + ')' + (highlight ? ', highlighted' : ''));
}

/** The month sheet ("Oct26") for `date`, else the most recent previous month's. */
function getTargetSheet_(ss, date) {
  const tz = timeZone_(ss);
  const year = Number(Utilities.formatDate(date, tz, 'yyyy'));
  const month = Number(Utilities.formatDate(date, tz, 'M')) - 1;
  for (let back = 0; back <= CONFIG.MAX_MONTHS_BACK; back++) {
    const sheet = ss.getSheetByName(sheetNameFor(year, month - back));
    if (sheet) return sheet;
  }
  throw new Error('No month sheet found for ' + sheetNameFor(year, month) +
    ' or the ' + CONFIG.MAX_MONTHS_BACK + ' months before it.');
}

/**
 * Finds the last filled row, the Drive links already in the sheet, and for
 * each dated row its day, whether it's a video and whether it's highlighted.
 */
function readSheetState_(sheet) {
  const tz = sheet.getParent().getSpreadsheetTimeZone(); // date cells are in the sheet's zone
  const lastRow = sheet.getLastRow();
  const range = lastRow >= FIRST_DATA_ROW
    ? sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, HIGHLIGHT_WIDTH)
    : null;
  const values = range ? range.getValues() : [];
  const backgrounds = range ? range.getBackgrounds() : [];
  const highlightColor = CONFIG.HIGHLIGHT_COLOR.toLowerCase();

  let lastFilledRow = FIRST_DATA_ROW - 1;
  const links = [];
  const rows = [];
  values.forEach((r, i) => {
    // Editor is pre-filled on empty rows, so it doesn't count as "filled".
    const filled = [COL.DATE, COL.POST_TYPE, COL.GDRIVE, COL.CAPTION]
      .some((c) => String(r[c - 1]).trim() !== '');
    if (filled) lastFilledRow = FIRST_DATA_ROW + i;

    const link = String(r[COL.GDRIVE - 1]);
    if (link) links.push(link);

    const date = r[COL.DATE - 1];
    if (date instanceof Date) {
      rows.push({
        dayKey: toDayKey_(date, tz),
        isVideo: /^https?:\/\//.test(link) &&
          String(r[COL.POST_TYPE - 1]).trim().toLowerCase() !== 'ad',
        isHighlighted: backgrounds[i].some((bg) => String(bg).toLowerCase() === highlightColor),
      });
    }
  });
  return { lastFilledRow, links, rows };
}

function timeZone_(ss) {
  if (CONFIG.TIME_ZONE) return CONFIG.TIME_ZONE;
  return ss.getSpreadsheetTimeZone();
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

/** All non-trashed videos under the watched folder (recursively) created after `since`. */
function findVideosCreatedSince_(since) {
  const results = [];
  const walk = (folder) => {
    const files = folder.searchFiles("mimeType contains 'video/' and trashed = false");
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated() > since) results.push(f);
    }
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) walk(subfolders.next());
  };
  walk(DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID));
  return results;
}

function driveLink_(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/view?usp=drive_link';
}

// ---------------------------------------------------------------------------
// Pure helpers (no Google services; covered by test.js)
// ---------------------------------------------------------------------------

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** sheetNameFor(2026, 9) → "Oct26". Month is 0-based and may be negative. */
function sheetNameFor(year, month) {
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return MONTH_ABBR[m] + String(y).slice(-2);
}

/** "Issue resolved.mp4" → "Issue resolved". */
function captionFromFileName(name) {
  return String(name).replace(/\.[A-Za-z0-9]{2,5}$/, '').trim();
}

function dayKeyToUtc_(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(key, n) {
  const d = dayKeyToUtc_(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isWeekend(key) {
  const day = dayKeyToUtc_(key).getUTCDay();
  return day === 0 || day === 6;
}

/** Posting date for a video uploaded on `uploadDayKey`: the next weekday after it. */
function postDateForUpload(uploadDayKey) {
  let k = addDays(uploadDayKey, 1);
  while (isWeekend(k)) k = addDays(k, 1);
  return k;
}

/** "2026-10-13" → 46308 (Google Sheets date serial). */
function dayKeyToSerial(key) {
  return Math.round((dayKeyToUtc_(key) - Date.UTC(1899, 11, 30)) / 86400000);
}

function toDayKey_(date, tz) {
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

if (typeof module !== 'undefined') {
  module.exports = {
    sheetNameFor, captionFromFileName, addDays, isWeekend,
    postDateForUpload, dayKeyToSerial,
  };
}
