import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturedIsStale } from '../src/server/redeploy.ts';

// Week 48 of 2026 starts Monday 23 November.
const captured = (week: number) => ({
  poppels: ['MÅNDAG', 'PASTA DIABLO', 'Tomatsås, parmesan', 'LU', 'NCH', String(week)],
});
const monday0900 = new Date('2026-11-23T08:00:00Z');

test('capturedIsStale: last week’s menu on a weekday morning asks for a deploy', () => {
  assert.equal(capturedIsStale(captured(47), monday0900), true);
});

test('capturedIsStale: this week’s menu, or nothing captured, does not', () => {
  assert.equal(capturedIsStale(captured(48), monday0900), false);
  assert.equal(capturedIsStale({}, monday0900), false);
});

test('capturedIsStale: only on weekdays between 06 and 13 Stockholm time', () => {
  assert.equal(capturedIsStale(captured(47), new Date('2026-11-23T04:59:00Z')), false);
  assert.equal(capturedIsStale(captured(47), new Date('2026-11-23T05:00:00Z')), true);
  assert.equal(capturedIsStale(captured(47), new Date('2026-11-23T12:00:00Z')), false);
  assert.equal(capturedIsStale(captured(46), new Date('2026-11-22T08:00:00Z')), false);
});
