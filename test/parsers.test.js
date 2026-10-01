import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RESTAURANTS } from '../src/restaurants.js';
import { decodeEntities, htmlToLines } from '../src/html.js';
import { isoWeek, stockholmDate } from '../src/lunch.js';
import { pdfToLines } from '../src/pdf.js';

// Fixtures are the restaurants' pages as captured 2026-09-28 (vecka 40), already flattened with htmlToLines.
const fixture = (id) => fs.readFileSync(new URL(`fixtures/${id}.txt`, import.meta.url), 'utf8').trimEnd().split('\n');
const parser = (id) => RESTAURANTS.find((r) => r.id === id).parse;

test('Pocket: Monday has veg, fish and meat', () => {
  const { week, dishes } = parser('pocket')(fixture('pocket'), 'Måndag');
  assert.equal(week, 40);
  assert.deepEqual(dishes.map((d) => d.category), ['Vegetariska', 'Fisk', 'Kött']);
  assert.match(dishes[2].name, /^Kåldolmar med gräddsås/);
});

test('Pocket: Friday stops before the Klimato footer', () => {
  const { dishes } = parser('pocket')(fixture('pocket'), 'Fredag');
  assert.equal(dishes.length, 3);
  assert.match(dishes[2].name, /^Pasta Alfredo/);
});

test('Pagoden: Monday skips the intro text and groups by kitchen', () => {
  const { week, dishes } = parser('pagoden')(fixture('pagoden'), 'Måndag');
  assert.equal(week, 40);
  assert.equal(dishes[0].category, 'Around the world');
  assert.equal(dishes[0].name, 'Klassisk lasagne på färsk pasta med nötfärs');
  assert.match(dishes[0].description, /^Serveras med tomat/);
  assert.equal(dishes[2].name, 'Vegetarisk Höst Bowl');
  assert.equal(dishes.filter((d) => d.category === 'Green Kitchen').length, 3);
  assert.ok(dishes.every((d) => !/Julbord|OBS!/.test(d.name)));
});

test('Pagoden: Friday ignores the "Inkl." line and the intro headline', () => {
  const { dishes } = parser('pagoden')(fixture('pagoden'), 'Fredag');
  assert.ok(dishes.every((d) => !/^Inkl\.|Oktober Fredag/.test(d.name)));
  assert.match(dishes[0].name, /^Schnitzel/);
});

test('Björkmans: Monday has four dishes incl. the one after the hidden "Stängt" badge', () => {
  const { week, dishes } = parser('bjorkmans')(fixture('bjorkmans'), 'Måndag');
  assert.equal(week, 40);
  assert.deepEqual(dishes.map((d) => d.name), [
    'Chicken cashew',
    'Halstrad kummel',
    'Köttbullar i gräddsås med potatismos',
    'Friterad svensk falafel',
  ]);
  assert.match(dishes[3].description, /^Serverad med hummus/);
});

test('Björkmans: Friday (first on the page) does not bleed into Thursday', () => {
  const { dishes } = parser('bjorkmans')(fixture('bjorkmans'), 'Fredag');
  assert.equal(dishes.length, 5);
  assert.equal(dishes[0].name, 'Hoisin portabello burger');
  assert.equal(dishes[4].name, 'Fredagsdessert');
});

test('every parser returns no dishes (not a crash) when the page changes shape', () => {
  for (const r of RESTAURANTS) assert.deepEqual(r.parse(['Hej', 'Något helt annat'], 'Måndag', '<p>Hej</p>').dishes, []);
});

test('htmlToLines strips scripts, tags and entities', () => {
  const lines = htmlToLines('<script>x()</script><div>K&Ouml;TT&nbsp;&amp;</div><p>R&#228;ka<br>Lax</p>');
  assert.deepEqual(lines, ['KÖTT &', 'Räka', 'Lax']);
  assert.equal(decodeEntities('&#x2013;&unknown;'), '–&unknown;');
});

test('isoWeek and Stockholm date', () => {
  assert.equal(isoWeek(new Date(Date.UTC(2026, 8, 28))), 40);
  assert.equal(isoWeek(new Date(Date.UTC(2027, 0, 1))), 53);
  // 23:30 UTC on Sunday is already Monday in Stockholm.
  assert.equal(stockholmDate(new Date('2026-09-27T23:30:00Z')).getUTCDay(), 1);
});

test('Indya: Monday stops before the fixed "Stående Rätter" dishes', () => {
  const { week, dishes } = parser('indya')(fixture('indya'), 'Måndag');
  assert.equal(week, 40);
  assert.deepEqual(dishes.map((d) => d.name), ['Chicken Do Pyaza', 'Lamm Korma', 'Vegetarisk Thali', 'Dagens Thali (139 kr)']);
  assert.match(dishes[1].description, /^Krämig och mild lammgryta/);
});

test('Indya: Friday keeps its extra dessert and skips the duplicated block', () => {
  const { dishes } = parser('indya')(fixture('indya'), 'Fredag');
  assert.equal(dishes.length, 5);
  assert.equal(dishes[4].name, 'Fredagsmys');
});

test('Monopolet: splits "Dagens X – a / b / c" into category, name and description', () => {
  const { week, dishes } = parser('monopolet')(fixture('monopolet'), 'Måndag');
  assert.equal(week, 40);
  assert.deepEqual(dishes.map((d) => d.category), ['Kött', 'Fisk', 'Veg']);
  assert.equal(dishes[0].name, 'Bao Buns');
  assert.match(dishes[0].description, /^Långbakad Fläsksida, Gochujangkräm/);
});

test('Monopolet: Friday stops before the sign-off', () => {
  const { dishes } = parser('monopolet')(fixture('monopolet'), 'Fredag');
  assert.equal(dishes.length, 2);
  assert.match(dishes[1].name, /Pizza & Taco/);
});

test('Poppels: picks the Canva embed URL out of the page, nothing else', () => {
  const html = '<iframe class="lazyload" data-src="https://www.canva.com/design/DAFJA8wNZsw/view?embed" src="data:image/gif;base64,R0l"></iframe>';
  assert.equal(parser('poppels')([], 'Måndag', html).embed, 'https://www.canva.com/design/DAFJA8wNZsw/view?embed');
  assert.equal(parser('poppels')([], 'Måndag', '<iframe src="https://evil.example/x"></iframe>').embed, null);
});

test('Magasin 5: Monday splits dish from sides and skips the price line', () => {
  const { dishes } = parser('magasinfem')(fixture('magasinfem'), 'Måndag');
  assert.deepEqual(dishes.map((d) => d.category), ['Vegetariska', 'Fisk', 'Grill', 'Sallad']);
  assert.equal(dishes[1].name, 'Havets Wallenbergare');
  assert.match(dishes[1].description, /^Skaldjurshollandaise, Smörad Sparris/);
});

test('Magasin 5: Friday stops before the drinks list', () => {
  const { dishes } = parser('magasinfem')(fixture('magasinfem'), 'Fredag');
  assert.equal(dishes.length, 4);
  assert.equal(dishes[2].category, 'Schnitzel Fredag!!!!!');
  assert.ok(dishes.every((d) => !/Mineralvatten|Läsk/.test(d.name)));
});

// Delissimo's menu is a Canva PDF (captured 2026-09-28), read with pdfToLines.
const delissimoLines = await pdfToLines(new Uint8Array(fs.readFileSync(new URL('fixtures/delissimo.pdf', import.meta.url))));

test('pdfToLines: Canva PDF yields clean upright text without the rotated background pattern', () => {
  assert.ok(delissimoLines.includes('MÅNDAG'));
  assert.ok(delissimoLines.includes('KÖTT: Grillad ryggbiff med grönpepparsås & friterad klyftpotatis.'));
  assert.ok(!delissimoLines.some((l) => /^[DELISMO ]+$/.test(l) && l !== 'DELISSIMO'), 'no background letter noise');
});

test('Delissimo: Tuesday has its four dishes plus the weekly pizza and salad', () => {
  const { week, dishes } = parser('delissimo')(delissimoLines, 'Tisdag');
  assert.equal(week, null);
  assert.deepEqual(dishes.map((d) => d.category), ['Kött', 'Fågel', 'Fisk', 'Pasta carbonara', 'Veckans', 'Veckans']);
  assert.equal(dishes[3].name, 'Stekt bacon i parmesansås med vitlök & svartpeppar.');
  assert.equal(dishes[4].name, 'Pizza - parma');
  assert.match(dishes[4].description, /^Frasig surdegspizza .* parmesan\.$/);
});

test('Delissimo: wrapped lines are joined and an unlabelled dish keeps its own entry', () => {
  const thursday = parser('delissimo')(delissimoLines, 'Torsdag').dishes;
  assert.equal(thursday[0].name, 'Handrullad högrevsköttbullar med gräddsås, potatismos, rårörda lingon & inlagd gurka.');
  const friday = parser('delissimo')(delissimoLines, 'Fredag').dishes;
  assert.equal(friday[0].category, null);
  assert.match(friday[0].name, /^Grillmix .* BBQ-sås\. 159:-$/);
  assert.equal(friday[1].category, 'Pasta pesce');
});

test('Delissimo: finds the Platinan PDF link on the home page', () => {
  const pdf = RESTAURANTS.find((r) => r.id === 'delissimo').pdf;
  assert.equal(pdf('<a href="http://delissimo.se/wp-content/uploads/2026/09/Platinan.pdf">'), 'http://delissimo.se/wp-content/uploads/2026/09/Platinan.pdf');
  assert.equal(pdf('<a href="/Veckans-lunch.pdf">'), null);
});
