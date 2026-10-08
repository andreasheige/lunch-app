// public/picker.js is browser JS (the client isn't converted to TypeScript yet), so its tests are JS too.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawQuestions, QUESTIONS, rank, reasonText } from '../public/picker.js';

const answer = (questionId, label) => QUESTIONS.find((q) => q.id === questionId).answers.find((a) => a.label === label);
const noChance = () => 0;

const restaurant = (id, distance, dishes, extra = {}) => ({
  id,
  name: id,
  distance,
  hours: '11.00–14.00',
  error: null,
  dishes,
  ...extra,
});
const data = {
  date: '2026-10-07',
  restaurants: [
    restaurant('near-meat', 50, [
      { category: 'Kött', name: 'Pannbiff med potatismos och gräddsås', diet: 'meat', kind: 'mince' },
    ]),
    restaurant('mid-veg', 200, [
      { category: 'Veg', name: 'Falafel Bowl', description: 'Bulgur, picklad rödlök', diet: 'veg', kind: 'falafel' },
    ]),
    restaurant('far-curry', 450, [
      { category: null, name: 'Chicken Karahi', description: 'Med jasminris', diet: 'meat', kind: 'curry' },
    ]),
  ],
};

test('drawQuestions gives three different questions, avoiding last time’s when it can', () => {
  const first = drawQuestions([], false, Math.random);
  assert.equal(new Set(first.map((q) => q.id)).size, 3);
  for (let i = 0; i < 20; i++) {
    const next = drawQuestions(
      first.map((q) => q.id),
      false,
      Math.random,
    );
    assert.equal(next.filter((q) => first.includes(q)).length, 0);
  }
});

test('drawQuestions skips the diet question while a diet filter is on', () => {
  for (let i = 0; i < 20; i++) assert.ok(!drawQuestions([], true, Math.random).some((q) => q.id === 'diet'));
});

test('rank follows the answers', () => {
  const top = (answers, opts = {}) => rank(data, answers, { random: noChance, ...opts })[0].restaurant.id;
  assert.equal(top([answer('diet', '🌱 Grönt')]), 'mid-veg');
  assert.equal(top([answer('mood', 'Något kryddigt'), answer('distance', 'Gärna en promenad')]), 'far-curry');
  assert.equal(top([answer('distance', 'Så nära som möjligt'), answer('sauce', 'Sås är livet')]), 'near-meat');
});

test('rank leaves out closed restaurants, menus with errors and dishes the filter hides', () => {
  const withError = {
    ...data,
    restaurants: [...data.restaurants, restaurant('broken', 10, [], { error: 'HTTP 500' })],
  };
  const ids = rank(withError, [], {
    random: noChance,
    isOpen: (r) => r.id !== 'near-meat',
    visible: (d) => d.diet !== 'veg',
  }).map((r) => r.restaurant.id);
  assert.deepEqual(ids, ['far-curry']);
});

test('rank: a visit yesterday counts against a place, "Det vanliga" turns that around', () => {
  const history = [{ id: 'mid-veg', date: '2026-10-06' }];
  const order = (answers) => rank(data, answers, { random: noChance, history }).map((r) => r.restaurant.id);
  assert.equal(order([answer('diet', '🌱 Grönt'), answer('novelty', 'Något nytt')]).at(-1), 'mid-veg');
  assert.equal(order([answer('diet', '🌱 Grönt'), answer('novelty', 'Det vanliga')])[0], 'mid-veg');
});

test('rank explains the pick with the answers that helped', () => {
  const [best] = rank(data, [answer('diet', '🌱 Grönt'), answer('weather', 'Sol!')], { random: noChance });
  assert.equal(best.restaurant.id, 'mid-veg');
  assert.deepEqual(best.why, ['du ville äta grönt']);
});

test('reasonText joins up to three reasons into a sentence', () => {
  assert.equal(reasonText(['du ville äta grönt']), 'Du ville äta grönt.');
  assert.equal(reasonText(['a', 'b', 'c', 'd']), 'A, b och c.');
  assert.match(reasonText([]), /slumpen/);
});

test('every question and answer has English text, and reasons too where there are any', () => {
  for (const q of QUESTIONS) {
    assert.ok(q.textEn, q.id);
    for (const a of q.answers) {
      assert.ok(a.labelEn, `${q.id}: ${a.label}`);
      assert.equal(Boolean(a.whyEn), Boolean(a.why), `${q.id}: ${a.label}`);
    }
  }
});

test('rank and reasonText speak English when asked', () => {
  const [best] = rank(data, [answer('diet', '🌱 Grönt'), answer('distance', 'Så nära som möjligt')], {
    random: noChance,
    lang: 'en',
  });
  assert.equal(best.restaurant.id, 'mid-veg');
  assert.deepEqual(best.why, ['you wanted veggie', "it's close"]);
  assert.equal(reasonText(best.why, 'en'), "You wanted veggie and it's close.");
  assert.equal(reasonText([], 'en'), 'No clear favourite today – so chance decided.');
});
