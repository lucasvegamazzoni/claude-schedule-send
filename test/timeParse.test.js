const { test } = require('node:test');
const assert = require('node:assert');
const { parseWhen, formatRelative } = require('../out/timeParse');

// Fri 9 Oct 2026, 15:00 local
const now = new Date(2026, 9, 8 + 1, 15, 0, 0);
const fmt = d => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const cases = [
  ['in 2h', '2026-10-09 17:00'],
  ['45m', '2026-10-09 15:45'],
  ['in 1h30m', '2026-10-09 16:30'],
  ['in 90 minutes', '2026-10-09 16:30'],
  ['in 1 day', '2026-10-10 15:00'],
  ['16:30', '2026-10-09 16:30'],
  ['9pm', '2026-10-09 21:00'],
  ['9am', '2026-10-10 09:00'],       // already passed today → tomorrow
  ['12am', '2026-10-10 00:00'],
  ['12pm', '2026-10-10 12:00'],
  ['14:59', '2026-10-10 14:59'],
  ['21', '2026-10-09 21:00'],
  ['tonight', '2026-10-09 21:00'],
  ['tomorrow', '2026-10-10 09:00'],
  ['tomorrow 8am', '2026-10-10 08:00'],
  ['Tomorrow at 14:00', '2026-10-10 14:00'],
  ['sat 10:00', '2026-10-10 10:00'],
  ['fri 9am', '2026-10-16 09:00'],   // today's 9am passed → next week
  ['friday 16:00', '2026-10-09 16:00'],
  ['thu 9am', '2026-10-15 09:00'],
  ['2026-10-12 09:00', '2026-10-12 09:00'],
];
for (const [input, want] of cases) {
  test(`parses "${input}"`, () => assert.strictEqual(fmt(parseWhen(input, now)), want));
}
for (const bad of ['', 'banana', '9', '25:00', '13pm', 'in 2 parsecs', 'fri', 'blah 9am']) {
  test(`rejects "${bad}"`, () => assert.strictEqual(parseWhen(bad, now), undefined));
}
test('formatRelative', () => {
  assert.strictEqual(formatRelative(new Date(now.getTime() + 125 * 60_000), now), 'in 2h 5m');
  assert.strictEqual(formatRelative(new Date(now.getTime() - 3 * 60_000), now), '3m ago');
});
