import assert from 'node:assert/strict';
import { test } from 'node:test';
import { menuDayRows } from '../src/server/menudays.ts';
import type { LunchResponse } from '../src/shared/types.ts';

const place = { dishes: [], stale: false, error: null, embed: null };
const lunch = {
  date: '2026-10-14',
  day: 'Onsdag',
  restaurants: [
    {
      ...place,
      id: 'pocket',
      dishes: [{ category: 'Fisk', name: 'Kummel', diet: 'fish', mentions: ['lactose', 'gluten'] }],
    },
    { ...place, id: 'monopolet', stale: true, dishes: [{ category: null, name: 'Last week’s burger' }] },
    { ...place, id: 'poppels', embed: 'https://www.canva.com/x', dishes: [] },
    { ...place, id: 'indya', error: 'Kunde inte läsa menyn', dishes: [] },
  ],
} as unknown as LunchResponse; // only the fields menuDayRows reads

test('menuDayRows stores today’s served dishes with diet and mentions', () => {
  assert.deepEqual(menuDayRows(lunch), [
    {
      date: '2026-10-14',
      restaurant: 'pocket',
      dish: 'Kummel',
      description: null,
      diet: 'fish',
      mentions: 'lactose,gluten',
    },
  ]);
});

test('menuDayRows skips other weeks’ menus, embeds, errors and weekends', () => {
  assert.equal(menuDayRows({ ...lunch, restaurants: lunch.restaurants.slice(1) }).length, 0);
  assert.equal(menuDayRows({ ...lunch, day: null }).length, 0);
});
