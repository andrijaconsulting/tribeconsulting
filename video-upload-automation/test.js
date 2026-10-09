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

// Captions
assert.strictEqual(h.captionFromFileName('Issue resolved.mp4'), 'Issue resolved');
assert.strictEqual(h.captionFromFileName("He can't read the room.MOV"), "He can't read the room");
assert.strictEqual(h.captionFromFileName('Is it over.mp4'), 'Is it over');

// Posting date = next weekday after the upload day (2026-10-09 is a Friday)
const post = h.postDateForUpload;
assert.strictEqual(post('2026-10-05'), '2026-10-06'); // Mon -> Tue
assert.strictEqual(post('2026-10-08'), '2026-10-09'); // Thu -> Fri
assert.strictEqual(post('2026-10-09'), '2026-10-12'); // Fri -> Mon
assert.strictEqual(post('2026-10-10'), '2026-10-12'); // Sat -> Mon
assert.strictEqual(post('2026-10-11'), '2026-10-12'); // Sun -> Mon
assert.strictEqual(post('2026-10-30'), '2026-11-02'); // Fri, across months
for (let d = 0; d < 60; d++) assert.ok(!h.isWeekend(post(h.addDays('2026-10-01', d))));

// Serial numbers match what the sheet stores (10/1/2026 = 46296, 10/31 = 46326)
assert.strictEqual(h.dayKeyToSerial('2026-10-01'), 46296);
assert.strictEqual(h.dayKeyToSerial('2026-10-31'), 46326);

console.log('All tests passed');
