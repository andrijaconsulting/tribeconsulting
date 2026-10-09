// Run with: node test.js   (tests the pure helpers in Code.gs)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
const h = ctx.module.exports;

// Sheet names
assert.strictEqual(h.sheetNameFor(2026, 9), 'Oct26');
assert.strictEqual(h.sheetNameFor(2026, -1), 'Dec25');
assert.strictEqual(h.sheetNameFor(2026, 12), 'Jan27');
assert.deepStrictEqual({ ...h.parseSheetName('Oct26') }, { year: 2026, month: 9 });
assert.strictEqual(h.parseSheetName('Summary'), null);

// Captions
assert.strictEqual(h.captionFromFileName('Issue resolved.mp4'), 'Issue resolved');
assert.strictEqual(h.captionFromFileName("He can't read the room.MOV"), "He can't read the room");
assert.strictEqual(h.captionFromFileName('Is it over.mp4'), 'Is it over');

// Dates (2026-10-09 is a Friday)
const slot = h.chooseSlotDate;
assert.strictEqual(slot('2026-10-12', 2, '2026-10-09', 2), '2026-10-13'); // current Oct26 state
assert.strictEqual(slot('2026-10-12', 1, '2026-10-09', 2), '2026-10-12'); // fill the day
assert.strictEqual(slot('2026-10-09', 2, '2026-10-09', 2), '2026-10-12'); // Fri full -> Mon
assert.strictEqual(slot('2026-10-05', 1, '2026-10-09', 2), '2026-10-09'); // behind -> today
assert.strictEqual(slot('2026-10-05', 1, '2026-10-10', 2), '2026-10-12'); // today Sat -> Mon
assert.strictEqual(slot(null, 0, '2026-11-01', 2), '2026-11-02');          // empty sheet, Sun
assert.strictEqual(slot('2026-10-01', 3, '2026-10-01', 2), '2026-10-02'); // over-full day
for (let d = 0; d < 40; d++) {
  const today = h.addDays('2026-10-01', d);
  assert.ok(!h.isWeekend(slot(null, 0, today, 2)));
  assert.ok(!h.isWeekend(slot(today, 5, today, 2)));
}

// Serial numbers match what the sheet stores (10/1/2026 = 46296, 10/31 = 46326)
assert.strictEqual(h.dayKeyToSerial('2026-10-01'), 46296);
assert.strictEqual(h.dayKeyToSerial('2026-10-31'), 46326);

console.log('All tests passed');
