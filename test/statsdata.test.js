import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dietCounts,
  ingredientGraph,
  ingredientsOf,
  layoutGraph,
  league,
  priceOf,
  weekVotes,
} from '../public/statsdata.js';

test('ingredientsOf finds ingredients in Swedish menu text without false matches', () => {
  assert.deepEqual(ingredientsOf({ name: 'Kycklingfilé med ris', description: 'Potatispuré, rostad tomat' }), [
    'Potatis',
    'Tomat',
    'Kyckling',
    'Ris',
  ]);
  // "rostad" contains "ost" and "kris" contains "ris", but neither is cheese or rice.
  assert.deepEqual(ingredientsOf({ name: 'Rostad kris', description: '' }), []);
});

test('ingredientGraph links places to ingredients in at least two dishes, weighted by dishes', () => {
  const restaurants = [
    { id: 'a', name: 'A', dishes: [{ name: 'Kyckling med ris' }, { name: 'Kyckling curry' }] },
    { id: 'b', name: 'B', dishes: [{ name: 'Lax med ris' }] },
    { id: 'c', name: 'C', embed: 'https://x', dishes: [] },
  ];
  const { nodes, links } = ingredientGraph(restaurants);
  assert.deepEqual(
    nodes.map((n) => n.id),
    ['a', 'b', 'i:Kyckling', 'i:Ris'],
  );
  assert.deepEqual(links, [
    { source: 'a', target: 'i:Kyckling', weight: 2 },
    { source: 'a', target: 'i:Ris', weight: 1 },
    { source: 'b', target: 'i:Ris', weight: 1 },
  ]);
});

test('layoutGraph is deterministic and stays inside the box', () => {
  const graph = ingredientGraph([
    { id: 'a', name: 'A', dishes: [{ name: 'Kyckling med ris' }, { name: 'Kyckling' }] },
    { id: 'b', name: 'B', dishes: [{ name: 'Ris' }] },
  ]);
  const one = layoutGraph(graph, 400, 300, 100);
  assert.deepEqual(one, layoutGraph(graph, 400, 300, 100));
  for (const { x, y } of one.values()) assert.ok(x >= 40 && x <= 360 && y >= 30 && y <= 270);
});

test('league adds qualification and the form per voting day', () => {
  const rows = league({
    restaurants: [{ id: 'p', name: 'P', avg: 2, votes: 3 }],
    placeDays: [
      { id: 'p', date: '2026-10-07', avg: 1, votes: 1 },
      { id: 'q', date: '2026-10-07', avg: 5, votes: 1 },
      { id: 'p', date: '2026-10-08', avg: 2.5, votes: 2 },
    ],
  });
  assert.equal(rows[0].qualified, true);
  assert.deepEqual(
    rows[0].form.map((f) => f.avg),
    [1, 2.5],
  );
});

test('weekVotes splits this and last week, with future days empty', () => {
  const days = [
    { date: '2026-10-08', votes: 4 },
    { date: '2026-10-13', votes: 4 },
  ];
  assert.deepEqual(weekVotes(days, '2026-10-14'), { thisWeek: [0, 4, 0, null, null], lastWeek: [0, 0, 0, 4, 0] });
});

test('dietCounts and priceOf', () => {
  assert.deepEqual(dietCounts([{ dishes: [{ diet: 'veg' }, { diet: 'meat' }, {}] }]), {
    veg: 1,
    fish: 0,
    meat: 1,
    none: 1,
  });
  assert.equal(priceOf({ price: '145 kr inkl. bröd' }), 145);
  assert.equal(priceOf({ price: 'Korv 85–130 kr' }), 130);
  assert.equal(priceOf({ price: null }), null);
});
