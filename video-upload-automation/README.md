# Video upload → content calendar automation

Whenever a video is uploaded to the **Andrija** Drive folder (or any subfolder,
e.g. `october26/Remixed Winners`), a row is added to the **Andrija** spreadsheet:

| Column    | Value                                                         |
|-----------|---------------------------------------------------------------|
| Date      | Next weekday after the upload day (Mon→Tue, Fri/Sat/Sun→Mon) |
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
- **Date:** the next weekday after the day you uploaded, so it is never a
  weekend. Upload on Friday and it's dated Monday. Upload on Monday and it's
  dated Tuesday. The upload day is worked out in the spreadsheet's time zone.
  Set `TIME_ZONE` in `CONFIG` (e.g. `'Europe/Belgrade'`) to use yours instead.
- **Yellow:** the 2nd video for each date gets *light yellow 3* (`#fff2cc`) and
  `imanunseen` in Reviewer Notes straight away, unless that date already has a
  yellow row. Ads don't count as videos.
- **Ads** stay manual. The script only reacts to uploaded videos.

All of these settings are in the `CONFIG` block at the top of `Code.gs`.

## How it runs

It runs as a Google Apps Script with a timer that checks the folder every 5
minutes. A true Drive webhook (push notification) would need a public server
and channels that expire and must be renewed. Polling every few minutes is
simpler, free, and can't miss an upload. New rows usually show up within about
5 minutes.

## Setup (one time, ~3 minutes)

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Replace the **entire** contents of `Code.gs` (including your existing Auto-Fill code, which is now built in) with [`Code.gs`](./Code.gs) from this folder and save.
3. *(Optional, limits Drive access to read-only)* **Project Settings** → tick
   **Show "appsscript.json"**, then paste [`appsscript.json`](./appsscript.json).
4. In the function dropdown pick **`install`** → **Run** → approve the permissions.
5. Reload the spreadsheet. The **Auto-Fill** menu now has:
   - *Fill Yellow Reviewer Notes*: your existing tool, writes `imanunseen` into Reviewer Notes for every yellow row
   - *Check for new videos now*: run immediately instead of waiting for the timer
   - *Preview next row*: shows which sheet/row/date a video uploaded now would get, without changing anything
   - *Install / restart* and *Stop*

Only videos uploaded **after** `install` runs are picked up, so existing videos
aren't added twice.

## Troubleshooting

- **Executions** (left sidebar in Apps Script) shows each run and its log, e.g.
  `Added "X.mp4" to Oct26 row 19 (2026-10-13)`.
- To change the time zone, post type, etc., edit `CONFIG` and save.
  No reinstall is needed.

## Tests

`node test.js` checks the posting-date, sheet-name and caption logic.
