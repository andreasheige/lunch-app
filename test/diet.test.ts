import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDiets, dietFromCategory, dishKey, parseModelDiets, unlabelledDishes } from '../src/server/diet.ts';
import type { LunchResponse, RestaurantMenu } from '../src/shared/types.ts';

test('dietFromCategory reads the labels the sites use and leaves the rest to the model', () => {
  const cases: [string | null, string | null][] = [
    ['Vegetariska', 'veg'],
    ['Veg', 'veg'],
    ['Street Food Vegetarisk', 'veg'],
    ['Fisk', 'fish'],
    ['Fish Market', 'fish'],
    ['Kött', 'meat'],
    ['Fågel', 'meat'],
    ['Butcher´s', 'meat'],
    ['Street Food', null],
    ['Veckans sallad', null],
    ['East Asia', null],
    ['Green Kitchen', null],
    [null, null],
  ];
  for (const [category, diet] of cases) assert.equal(dietFromCategory(category), diet, String(category));
});

test('addDiets prefers the restaurant label and flags model guesses', () => {
  const r = {
    dishes: [
      { category: 'Fisk', name: 'Lax' },
      { category: null, name: 'Svamp yakiniku', description: 'Ris' },
      { category: null, name: 'Okänd' },
    ],
  } as RestaurantMenu; // only dishes matter here
  const data = { restaurants: [r] } as LunchResponse;
  const classified = { [dishKey({ category: null, name: 'Lax' })]: 'meat', 'Svamp yakiniku\nRis': 'veg' } as const;
  assert.deepEqual(addDiets(data, classified).restaurants[0]?.dishes, [
    { category: 'Fisk', name: 'Lax', diet: 'fish' },
    { category: null, name: 'Svamp yakiniku', description: 'Ris', diet: 'veg', dietByAi: true },
    { category: null, name: 'Okänd' },
  ]);
});

test('unlabelledDishes sends only dishes the label says nothing about, once each', () => {
  const dish = { category: 'East Asia', name: 'Wokad tofu', description: 'Ris' };
  const data = {
    restaurants: [{ dishes: [dish, { category: 'Veg', name: 'Falafel' }] }, { dishes: [dish] }],
  } as LunchResponse; // only dishes matter here
  assert.deepEqual([...unlabelledDishes(data)], [['Wokad tofu\nRis', 'Wokad tofu – Ris']]);
});

test('parseModelDiets maps ids to known diets and drops everything else per dish', () => {
  assert.deepEqual(parseModelDiets('{"1":"veg","2":"unknown","3":"meat"}', 3), ['veg', null, 'meat']);
  assert.deepEqual(parseModelDiets({ 1: 'fish' }, 1), ['fish']);
  assert.deepEqual(parseModelDiets({ 1: 'veg', 3: 'meat' }, 3), ['veg', null, 'meat']);
  assert.deepEqual(parseModelDiets({ 1: '<img src=x>', 2: 'fish', 9: 'veg' }, 2), [null, 'fish']);
  assert.deepEqual(parseModelDiets('not json', 2), [null, null]);
  assert.deepEqual(parseModelDiets(null, 1), [null]);
});
