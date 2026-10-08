import assert from 'node:assert/strict';
import { test } from 'node:test';
import { menuStrings, parseTranslations } from '../src/server/translate.ts';
import type { LunchResponse, RestaurantMenu } from '../src/shared/types.ts';

const restaurant = (extra: Partial<RestaurantMenu>) =>
  ({ price: null, error: null, dishes: [], ...extra }) as RestaurantMenu; // only the texts matter here

test('menuStrings collects every menu text once and skips empty ones', () => {
  const data = {
    restaurants: [
      restaurant({
        price: '135 kr inkl. sallad',
        dishes: [
          { category: 'Kött', name: 'Pannbiff', description: 'Med lök' },
          { category: null, name: 'Fiskgratäng', description: '' },
        ],
      }),
      restaurant({ error: 'Hittade ingen meny för idag', dishes: [{ category: 'Kött', name: 'Pannbiff' }] }),
    ],
  } as LunchResponse;
  assert.deepEqual(menuStrings(data), [
    '135 kr inkl. sallad',
    'Kött',
    'Pannbiff',
    'Med lök',
    'Fiskgratäng',
    'Hittade ingen meny för idag',
  ]);
});

test('parseTranslations maps ids back to the Swedish texts and drops anything else', () => {
  const texts = ['Pannbiff', 'Fisk', 'Lax'];
  assert.deepEqual(parseTranslations('{"1": " Beef patty ", "2": 7, "4": "Extra"}', texts), { Pannbiff: 'Beef patty' });
  assert.deepEqual(parseTranslations({ 3: 'Salmon' }, texts), { Lax: 'Salmon' });
  assert.deepEqual(parseTranslations('not json', texts), {});
  assert.deepEqual(parseTranslations(null, texts), {});
  assert.deepEqual(parseTranslations({ 1: '  ' }, texts), {});
  assert.equal(parseTranslations({ 1: 'x'.repeat(1000) }, texts).Pannbiff?.length, 'Pannbiff'.length * 2 + 40);
});
