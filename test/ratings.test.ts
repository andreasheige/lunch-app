import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRating, rangeStart } from '../src/server/ratings.ts';
import type { LunchResponse } from '../src/shared/types.ts';

const lunch = {
  date: '2026-10-07',
  day: 'Onsdag',
  restaurants: [{ id: 'pocket', dishes: [{ category: 'Fisk', name: 'Pankobakad kolja' }] }],
} as LunchResponse; // only date, day and dishes matter here
const voter = '0b7f3c1e-8a2d-4e5f-9c6b-1d2e3f4a5b6c';

test('parseRating accepts a vote for a dish on today’s menu and stamps today’s date', () => {
  assert.deepEqual(parseRating({ restaurant: 'pocket', dish: 'Pankobakad kolja', stars: 4, voter }, lunch), {
    date: '2026-10-07',
    restaurant: 'pocket',
    dish: 'Pankobakad kolja',
    stars: 4,
    voter,
  });
});

test('parseRating rejects made-up dishes, bad stars, odd voter ids and weekends', () => {
  const ok = { restaurant: 'pocket', dish: 'Pankobakad kolja', stars: 4, voter };
  for (const bad of [
    { ...ok, dish: 'Something rude' },
    { ...ok, restaurant: 'nowhere' },
    { ...ok, stars: 6 },
    { ...ok, stars: 2.5 },
    { ...ok, stars: '5' },
    { ...ok, voter: 'me' },
    null,
    'x',
  ]) {
    assert.equal(parseRating(bad, lunch), null, JSON.stringify(bad));
  }
  assert.equal(parseRating(ok, { ...lunch, day: null }), null);
});

test('rangeStart covers the last 14 days including today, or everything', () => {
  assert.equal(rangeStart('2026-10-07', '14'), '2026-09-24');
  assert.equal(rangeStart('2026-10-07', 'all'), '0000-00-00');
});
