import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateForDay } from '../src/server/lunch.ts';

const iso = (d: Date) => d.toISOString().slice(0, 10);

test('dateForDay: the weekday of this week, next week from the weekend', () => {
  const thursday = new Date('2026-11-12T10:00:00Z');
  assert.equal(iso(dateForDay('Måndag', thursday)), '2026-11-09');
  assert.equal(iso(dateForDay('Fredag', thursday)), '2026-11-13');
  assert.equal(iso(dateForDay('Måndag', new Date('2026-11-14T10:00:00Z'))), '2026-11-16');
  assert.equal(iso(dateForDay('Fredag', new Date('2026-11-15T10:00:00Z'))), '2026-11-20');
});
