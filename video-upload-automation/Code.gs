/**
 * Video upload → content calendar automation (Andrija).
 *
 * Every few minutes this script looks for new videos in the Andrija Drive
 * folder (including its month/category subfolders) and, for each new one,
 * adds a row to the "Andrija" content calendar spreadsheet:
 *
 *   Date      next free weekday slot (never Saturday/Sunday)
 *   Post Type "Remixed Winner"
 *   Editor    "Andrija"
 *   GDrive    link to the video
 *   Caption   video file name without the extension
 *   Hot?      "No"
 *   H Promo?  "No"
 *
 * The row goes beneath the last filled row of the current month's sheet
 * (e.g. "Oct26"). If that sheet doesn't exist yet, the previous month's sheet
 * is used. Once a day has 2+ videos, one of them (chosen at random) gets the
 * "light yellow 3" fill and "imanunseen" in Reviewer Notes.
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

  // How many rows (videos + ads) fill up one day before moving to the next weekday.
  MAX_PER_DAY: 2,

  // "light yellow 3" in the Google Sheets colour palette.
  HIGHLIGHT_COLOR: '#fff2cc',
  // Only highlight a day once it has at least this many videos (ads don't count).
  MIN_VIDEOS_TO_HIGHLIGHT: 2,
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

/** Logs where the next video would go, without changing anything. */
function previewNextRow() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const sheet = getTargetSheet_(ss, new Date());
  const state = readSheetState_(ss, sheet);
  const slot = chooseSlotDate(state.lastDayKey, state.lastDayCount,
    todayKey_(tz), CONFIG.MAX_PER_DAY);
  const msg = 'Next video → sheet "' + sheet.getName() + '", row ' +
    (state.lastFilledRow + 1) + ', date ' + slot;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* not opened from the sheet */ }
}

// ---------------------------------------------------------------------------
// Sheet logic
// ---------------------------------------------------------------------------

function addVideoRow_(ss, file) {
  const tz = ss.getSpreadsheetTimeZone();
  const sheet = getTargetSheet_(ss, new Date());
  const state = readSheetState_(ss, sheet);

  if (state.links.some((link) => link.indexOf(file.getId()) !== -1)) {
    Logger.log('Already in sheet, skipping: ' + file.getName());
    return;
  }

  const dayKey = chooseSlotDate(state.lastDayKey, state.lastDayCount,
    todayKey_(tz), CONFIG.MAX_PER_DAY);

  // Moving on to a new day: the previous day is complete.
  if (state.lastDayKey && dayKey !== state.lastDayKey) {
    highlightOneVideoForDay_(sheet, state.lastDayKey, tz);
  }

  const row = state.lastFilledRow + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);

  sheet.getRange(row, COL.DATE)
    .setNumberFormat('m/d')
    .setValue(dayKeyToSerial(dayKey));
  sheet.getRange(row, COL.POST_TYPE, 1, 3)
    .setValues([[CONFIG.POST_TYPE, CONFIG.EDITOR, driveLink_(file.getId())]]);
  sheet.getRange(row, COL.CAPTION, 1, 3)
    .setValues([[captionFromFileName(file.getName()), CONFIG.HOT, CONFIG.H_PROMO]]);
  Logger.log('Added "' + file.getName() + '" to ' + sheet.getName() + ' row ' + row + ' (' + dayKey + ')');

  const countForDay = (dayKey === state.lastDayKey ? state.lastDayCount : 0) + 1;
  if (countForDay >= CONFIG.MAX_PER_DAY) {
    SpreadsheetApp.flush();
    highlightOneVideoForDay_(sheet, dayKey, tz);
  }
}

/** Current month's sheet ("Oct26"), else the most recent previous month's. */
function getTargetSheet_(ss, now) {
  const tz = ss.getSpreadsheetTimeZone();
  const year = Number(Utilities.formatDate(now, tz, 'yyyy'));
  const month = Number(Utilities.formatDate(now, tz, 'M')) - 1;
  for (let back = 0; back <= CONFIG.MAX_MONTHS_BACK; back++) {
    const name = sheetNameFor(year, month - back);
    const sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }
  throw new Error('No month sheet found for ' + sheetNameFor(year, month) +
    ' or the ' + CONFIG.MAX_MONTHS_BACK + ' months before it.');
}

/**
 * Finds the last filled row and the last scheduled day. If the sheet has no
 * dates yet (new month), the last day is taken from the previous month's sheet.
 */
function readSheetState_(ss, sheet) {
  const tz = ss.getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  const values = lastRow >= FIRST_DATA_ROW
    ? sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, COL.CAPTION).getValues()
    : [];

  let lastFilledRow = FIRST_DATA_ROW - 1;
  const links = [];
  const dayKeys = [];
  values.forEach((r, i) => {
    // Editor is pre-filled on empty rows, so it doesn't count as "filled".
    const filled = [COL.DATE, COL.POST_TYPE, COL.GDRIVE, COL.CAPTION]
      .some((c) => String(r[c - 1]).trim() !== '');
    if (filled) lastFilledRow = FIRST_DATA_ROW + i;
    if (r[COL.GDRIVE - 1]) links.push(String(r[COL.GDRIVE - 1]));
    if (r[COL.DATE - 1] instanceof Date) dayKeys.push(toDayKey_(r[COL.DATE - 1], tz));
  });

  let lastDayKey = dayKeys.length ? dayKeys[dayKeys.length - 1] : null;
  let lastDayCount = dayKeys.filter((k) => k === lastDayKey).length;

  if (!lastDayKey) {
    const prev = previousMonthSheet_(ss, sheet);
    if (prev) {
      const prevState = readSheetState_(ss, prev);
      lastDayKey = prevState.lastDayKey;
      lastDayCount = prevState.lastDayCount;
    }
  }
  return { lastFilledRow, links, lastDayKey, lastDayCount };
}

function previousMonthSheet_(ss, sheet) {
  const parsed = parseSheetName(sheet.getName());
  if (!parsed) return null;
  for (let back = 1; back <= CONFIG.MAX_MONTHS_BACK; back++) {
    const s = ss.getSheetByName(sheetNameFor(parsed.year, parsed.month - back));
    if (s) return s;
  }
  return null;
}

/**
 * If a day has enough videos and none is highlighted yet, gives one random
 * video row the highlight colour. Ads ("marketing" rows) are never picked.
 */
function highlightOneVideoForDay_(sheet, dayKey, tz) {
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return;
  const n = lastRow - FIRST_DATA_ROW + 1;
  const range = sheet.getRange(FIRST_DATA_ROW, 1, n, HIGHLIGHT_WIDTH);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  const highlight = CONFIG.HIGHLIGHT_COLOR.toLowerCase();

  const dayRows = [];
  values.forEach((r, i) => {
    const d = r[COL.DATE - 1];
    if (d instanceof Date && toDayKey_(d, tz) === dayKey) dayRows.push(i);
  });
  const alreadyHighlighted = dayRows.some((i) =>
    backgrounds[i].some((bg) => String(bg).toLowerCase() === highlight));
  if (alreadyHighlighted) return;

  const videoRows = dayRows.filter((i) =>
    /^https?:\/\//.test(String(values[i][COL.GDRIVE - 1])) &&
    String(values[i][COL.POST_TYPE - 1]).trim().toLowerCase() !== 'ad');
  if (videoRows.length < CONFIG.MIN_VIDEOS_TO_HIGHLIGHT) return;

  const pick = videoRows[Math.floor(Math.random() * videoRows.length)];
  const row = FIRST_DATA_ROW + pick;
  sheet.getRange(row, 1, 1, HIGHLIGHT_WIDTH).setBackground(CONFIG.HIGHLIGHT_COLOR);
  if (!values[pick][COL.NOTES - 1]) sheet.getRange(row, COL.NOTES).setValue(CONFIG.YELLOW_NOTE);
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

/** "Oct26" → { year: 2026, month: 9 }, or null. */
function parseSheetName(name) {
  const m = /^([A-Za-z]{3})(\d{2})$/.exec(String(name).trim());
  if (!m) return null;
  const month = MONTH_ABBR.findIndex((a) => a.toLowerCase() === m[1].toLowerCase());
  return month === -1 ? null : { year: 2000 + Number(m[2]), month };
}

/** "Issue resolved.mp4" → "Issue resolved". */
function captionFromFileName(name) {
  return String(name).replace(/\.[A-Za-z0-9]{2,5}$/, '').trim();
}

function dayKeyToUtc_(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToDayKey_(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(key, n) {
  const d = dayKeyToUtc_(key);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToDayKey_(d);
}

function isWeekend(key) {
  const day = dayKeyToUtc_(key).getUTCDay();
  return day === 0 || day === 6;
}

function nextWeekdayOnOrAfter(key) {
  let k = key;
  while (isWeekend(k)) k = addDays(k, 1);
  return k;
}

/**
 * Picks the posting date for the next video.
 * - Keep filling the last scheduled day while it has fewer than `maxPerDay` rows.
 * - Otherwise move to the next weekday after it.
 * - Never a weekend, and never earlier than today (or the next weekday if today is a weekend).
 */
function chooseSlotDate(lastDayKey, lastDayCount, todayKey, maxPerDay) {
  const earliest = nextWeekdayOnOrAfter(todayKey);
  if (!lastDayKey || lastDayKey < earliest) return earliest;
  if (!isWeekend(lastDayKey) && lastDayCount < maxPerDay) return lastDayKey;
  return nextWeekdayOnOrAfter(addDays(lastDayKey, 1));
}

/** "2026-10-13" → 46308 (Google Sheets date serial). */
function dayKeyToSerial(key) {
  return Math.round((dayKeyToUtc_(key) - Date.UTC(1899, 11, 30)) / 86400000);
}

function toDayKey_(date, tz) {
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

function todayKey_(tz) {
  return toDayKey_(new Date(), tz);
}

if (typeof module !== 'undefined') {
  module.exports = {
    sheetNameFor, parseSheetName, captionFromFileName, addDays, isWeekend,
    nextWeekdayOnOrAfter, chooseSlotDate, dayKeyToSerial,
  };
}
