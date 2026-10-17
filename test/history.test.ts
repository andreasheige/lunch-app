import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addServed, groupWeek, recurringDishes, weekBounds } from '../src/server/history.ts';
import type { LunchResponse } from '../src/shared/types.ts';

test('weekBounds gives Monday and Friday, also from a weekend day', () => {
  assert.deepEqual(weekBounds('2026-10-14'), { from: '2026-10-12', to: '2026-10-16' });
  assert.deepEqual(weekBounds('2026-10-12'), { from: '2026-10-12', to: '2026-10-16' });
  assert.deepEqual(weekBounds('2026-10-18'), { from: '2026-10-12', to: '2026-10-16' });
});

test('groupWeek: days in order, places in the restaurant list order, unknown diets dropped', () => {
  const days = groupWeek([
    { date: '2026-10-15', restaurant: 'pocket', dish: 'Kummel', diet: 'fish' },
    { date: '2026-10-14', restaurant: 'bjorkmans', dish: 'Köttbullar', diet: 'meat' },
    { date: '2026-10-14', restaurant: 'poppels', dish: 'Risotto', diet: null },
    { date: '2026-10-14', restaurant: 'bjorkmans', dish: 'Falafel', diet: 'vegan?' },
  ]);
  assert.deepEqual(
    days.map((d) => [d.date, d.places.map((p) => p.id)]),
    [
      ['2026-10-14', ['poppels', 'bjorkmans']],
      ['2026-10-15', ['pocket']],
    ],
  );
  assert.equal(days[0]?.places[1]?.name, 'Björkmans Skafferi');
  assert.deepEqual(days[0]?.places[1]?.dishes, [
    { dish: 'Köttbullar', diet: 'meat' },
    { dish: 'Falafel', diet: null },
  ]);
});

test('addServed marks only the same dish at the same place', () => {
  const lunch = {
    date: '2026-10-16',
    restaurants: [
      { id: 'bjorkmans', dishes: [{ category: null, name: 'Köttbullar' }] },
      { id: 'pocket', dishes: [{ category: null, name: 'Köttbullar' }] },
    ],
  } as unknown as LunchResponse; // only the fields addServed reads
  const out = addServed(lunch, [{ restaurant: 'bjorkmans', dish: 'Köttbullar', times: 3, last: '2026-10-09' }]);
  assert.deepEqual(out.restaurants[0]?.dishes[0]?.served, { times: 3, last: '2026-10-09' });
  assert.equal(out.restaurants[1]?.dishes[0]?.served, undefined);
  assert.equal(addServed(lunch, []), lunch);
});

test('recurringDishes: back after a break counts, fixed menus and weekly specials do not', () => {
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13'];
  const rows = [
    // A fixed menu: every day.
    ...days.map((date) => ({ date, restaurant: 'bbbangers', dish: 'Bratwurst' })),
    // A weekly special: Monday to Friday, then gone.
    ...days.slice(0, 5).map((date) => ({ date, restaurant: 'delissimo', dish: 'Veckans pasta' })),
    ...days.map((date) => ({ date, restaurant: 'delissimo', dish: `Dagens ${date}` })),
    // Mondays only: two separate runs.
    { date: '2026-10-05', restaurant: 'bjorkmans', dish: 'Köttbullar' },
    { date: '2026-10-12', restaurant: 'bjorkmans', dish: 'Köttbullar' },
    ...days.map((date) => ({ date, restaurant: 'bjorkmans', dish: `Fisk ${date}` })),
    // On all but one day: two runs, but a fixed dish whose menu failed to parse once.
    ...days.filter((d) => d !== '2026-10-07').map((date) => ({ date, restaurant: 'pagoden', dish: 'Pad thai' })),
    ...days.map((date) => ({ date, restaurant: 'pagoden', dish: `Wok ${date}` })),
  ];
  assert.deepEqual(recurringDishes(rows), [
    { restaurant: 'bjorkmans', dish: 'Köttbullar', times: 2, first: '2026-10-05', last: '2026-10-12' },
  ]);
});
