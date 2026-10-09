# Video upload → content calendar automation

Whenever a video is uploaded to the **Andrija** Drive folder (or any subfolder,
e.g. `october26/Remixed Winners`), a row is added to the **Andrija** spreadsheet:

| Column    | Value                                                         |
|-----------|---------------------------------------------------------------|
| Date      | Next free weekday slot. Never a weekend (see below)           |
| Post Type | `Remixed Winner`                                              |
| Editor    | `Andrija`                                                     |
| GDrive    | Link to the video                                             |
| Caption   | File name without extension (`Issue resolved.mp4` → `Issue resolved`) |
| Hot?      | `No`                                                          |
| H Promo?  | `No`                                                          |

- **Which sheet:** the current month's tab (`Oct26`, `Nov26`, …). If it doesn't
  exist yet, the previous month's tab is used.
- **Which row:** directly beneath the last filled row. The pre-filled `Andrija`
  in the Editor column doesn't count as filled.
- **Date:** fills the last scheduled day up to `MAX_PER_DAY` rows (default 2,
  ads included), then moves to the next weekday. It never picks a date before
  today.
- **Yellow:** once a day has 2+ videos, one of them is picked at random and
  filled with *light yellow 3* (`#fff2cc`), unless that day already has one.
  Ad rows are never picked.
- **Ads** stay manual. The script only reacts to uploaded videos, but rows you
  add by hand (ads included) still count toward a day's slots.

All of these settings are in the `CONFIG` block at the top of `Code.gs`.

## How it runs

It runs as a Google Apps Script with a timer that checks the folder every 5
minutes. A true Drive webhook (push notification) would need a public server
and channels that expire and must be renewed. Polling every few minutes is
simpler, free, and can't miss an upload. New rows usually show up within about
5 minutes.

## Setup (one time, ~3 minutes)

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with [`Code.gs`](./Code.gs) from this folder and save.
3. *(Optional, limits Drive access to read-only)* **Project Settings** → tick
   **Show "appsscript.json"**, then paste [`appsscript.json`](./appsscript.json).
4. In the function dropdown pick **`install`** → **Run** → approve the permissions.
5. Reload the spreadsheet. A **Video automation** menu appears with:
   - *Check for new videos now*: run immediately instead of waiting for the timer
   - *Preview next row*: shows which sheet/row/date the next video would get, without changing anything
   - *Install / restart* and *Stop*

Only videos uploaded **after** `install` runs are picked up, so existing videos
aren't added twice.

## Troubleshooting

- **Executions** (left sidebar in Apps Script) shows each run and its log, e.g.
  `Added "X.mp4" to Oct26 row 19 (2026-10-13)`.
- To change the number of slots per day, the post type, etc., edit `CONFIG` and save.
  No reinstall is needed.

## Tests

`node test.js` checks the date, sheet-name and caption logic.
