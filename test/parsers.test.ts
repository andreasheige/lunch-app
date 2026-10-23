import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { decodeEntities, htmlToLines } from '../src/server/html.ts';
import {
  isoWeek,
  loadRestaurant,
  type MenuFailure,
  parseCaptured,
  pdfMenuWeek,
  stockholmDate,
} from '../src/server/lunch.ts';
import { readPdf } from '../src/server/pdf.ts';
import { RESTAURANTS, type Restaurant } from '../src/server/restaurants.ts';
import type { Weekday } from '../src/shared/types.ts';

// Fixtures are the restaurants' pages as captured 2026-09-28 (vecka 40), already flattened with htmlToLines.
const fixture = (id: string): string[] =>
  fs
    .readFileSync(new URL(`fixtures/${id}.txt`, import.meta.url), 'utf8')
    .trimEnd()
    .split('\n');
const restaurant = (id: string): Restaurant => {
  const r = RESTAURANTS.find((r) => r.id === id);
  if (!r) throw new Error(`no restaurant ${id}`);
  return r;
};
const parser =
  (id: string) =>
  (lines: string[], day: Weekday, html = '') =>
    restaurant(id).parse(lines, day, html);

test('Pocket: Monday has veg, fish and meat', () => {
  const { week, dishes } = parser('pocket')(fixture('pocket'), 'Måndag');
  assert.equal(week, 40);
  assert.deepEqual(
    dishes.map((d) => d.category),
    ['Vegetariska', 'Fisk', 'Kött'],
  );
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
  assert.match(dishes[0].description ?? '', /^Serveras med tomat/);
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
  assert.deepEqual(
    dishes.map((d) => d.name),
    ['Chicken cashew', 'Halstrad kummel', 'Köttbullar i gräddsås med potatismos', 'Friterad svensk falafel'],
  );
  assert.match(dishes[3].description ?? '', /^Serverad med hummus/);
});

test('Björkmans: Friday (first on the page) does not bleed into Thursday', () => {
  const { dishes } = parser('bjorkmans')(fixture('bjorkmans'), 'Fredag');
  assert.equal(dishes.length, 5);
  assert.equal(dishes[0].name, 'Hoisin portabello burger');
  assert.equal(dishes[4].name, 'Fredagsdessert');
});

// bjorkmans.html is the raw page from 2026-10-17 (vecka 42), scripts and styles removed.
test('Björkmans: a description spread over two <p>s stays with its dish', () => {
  const html = fs.readFileSync(new URL('fixtures/bjorkmans.html', import.meta.url), 'utf8');
  const { week, dishes } = parser('bjorkmans')(htmlToLines(html), 'Fredag', html);
  assert.equal(week, 42);
  assert.deepEqual(
    dishes.map((d) => d.name),
    ['Veggie enchiladas', 'Pulled chicken burger', 'Teri yaki lax', 'Schnitzel ”saltimbocca”', 'Fredagsdessert'],
  );
  assert.match(dishes[0].description ?? '', /chili, & koriander$/);
  assert.match(dishes[1].description ?? '', /^Riven bbqkryddad kyckling/);
});

test('Björkmans: accented capitals are decoded before sentence case', () => {
  const html = fs.readFileSync(new URL('fixtures/bjorkmans.html', import.meta.url), 'utf8');
  const { dishes } = parser('bjorkmans')(htmlToLines(html), 'Onsdag', html);
  assert.equal(dishes[3]?.name, 'Grillad secreto ibericó');
});

test('every parser returns no dishes (not a crash) when the page changes shape', () => {
  for (const r of RESTAURANTS)
    assert.deepEqual(r.parse(['Hej', 'Något helt annat'], 'Måndag', '<p>Hej</p>').dishes, []);
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

// indya.html is the raw page from 2026-10-21 (vecka 43), scripts and styles removed.
const indyaHtml = fs.readFileSync(new URL('fixtures/indya.html', import.meta.url), 'utf8');
const indya = (day: Weekday) => parser('indya')(htmlToLines(indyaHtml), day, indyaHtml);

test('Indya: Monday stops before the fixed "Stående Rätter" dishes', () => {
  const { week, dishes } = indya('Måndag');
  assert.equal(week, 43);
  assert.deepEqual(
    dishes.map((d) => d.name),
    ['Pepper Chicken', 'Lamm Vindaloo', 'Vegetarisk Thali', 'Dagens Thali (139 kr)'],
  );
  assert.match(dishes[1].description ?? '', /^Mört lamm i het och syrlig curry/);
});

test('Indya: days in the two-column grid get their own menu, not the next block', () => {
  // Source order: "ONSDAG", "TORSDAG", Wednesday's menu, "FREDAG", Friday's menu, Thursday's menu.
  assert.equal(indya('Onsdag').dishes[0]?.name, 'Cream Garlic Chicken');
  assert.equal(indya('Torsdag').dishes[0]?.name, 'Chicken Achari');
  assert.equal(indya('Fredag').dishes[0]?.name, 'Bhuna Chicken');
});

test('Indya: Friday keeps its extra dessert', () => {
  const { dishes } = indya('Fredag');
  assert.equal(dishes.length, 5);
  assert.equal(dishes[4].name, 'Fredagsmys');
});

test('Indya: a stray "." line does not shift names and descriptions', () => {
  // Tuesday of v. 42 had an empty "." paragraph between two dishes.
  const text = (lines: string[]) =>
    `<div data-kind="Component" data-specific-kind="TEXT">${lines.map((l) => `<p>${l}</p>`).join('')}</div>`;
  const html =
    text(['TISDAG']) +
    text(['Chilli Chicken', 'Saftig kycklingfilé', '.', 'Baingan Gosht', 'Mört lammkött', 'Stående Rätter 139:-']);
  const { dishes } = parser('indya')(htmlToLines(html), 'Tisdag', html);
  assert.deepEqual(
    dishes.map((d) => [d.name, d.description]),
    [
      ['Chilli Chicken', 'Saftig kycklingfilé'],
      ['Baingan Gosht', 'Mört lammkött'],
    ],
  );
});

test('Monopolet: splits "Dagens X – a / b / c" into category, name and description', () => {
  const { week, dishes } = parser('monopolet')(fixture('monopolet'), 'Måndag');
  assert.equal(week, 40);
  assert.deepEqual(
    dishes.map((d) => d.category),
    ['Kött', 'Fisk', 'Veg'],
  );
  assert.equal(dishes[0].name, 'Bao Buns');
  assert.match(dishes[0].description ?? '', /^Långbakad Fläsksida, Gochujangkräm/);
});

test('Monopolet: Friday stops before the sign-off', () => {
  const { dishes } = parser('monopolet')(fixture('monopolet'), 'Fredag');
  assert.equal(dishes.length, 2);
  assert.match(dishes[1].name, /Pizza & Taco/);
});

test('Poppels: picks the Canva embed URL out of the page, nothing else', () => {
  const html =
    '<iframe class="lazyload" data-src="https://www.canva.com/design/DAFJA8wNZsw/view?embed" src="data:image/gif;base64,R0l"></iframe>';
  assert.equal(parser('poppels')([], 'Måndag', html).embed, 'https://www.canva.com/design/DAFJA8wNZsw/view?embed');
  assert.equal(parser('poppels')([], 'Måndag', '<iframe src="https://evil.example/x"></iframe>').embed, null);
});

// poppels.txt is the Canva menu's text as scripts/capture.ts reads it, captured 2026-10-06 (vecka 41).
test('Poppels: captured Canva text gives the day’s two dishes and the week, no embed', () => {
  const html = '<iframe src="https://www.canva.com/design/DAFJA8wNZsw/view?embed"></iframe>';
  const menu = parser('poppels')(fixture('poppels'), 'Måndag', html);
  assert.equal(menu.week, 41);
  assert.equal(menu.embed, undefined);
  assert.deepEqual(menu.dishes, [
    { category: null, name: 'Friterad kyckling', description: 'Ris, lime- och chilisås, pak choi, rostad lök' },
    { category: null, name: 'Friterad rotselleri', description: 'Ris, lime- och chilisås, pak choi, rostad lök' },
  ]);
});

test('Poppels: Friday stops before the Canva viewer controls', () => {
  const { dishes } = parser('poppels')(fixture('poppels'), 'Fredag');
  assert.deepEqual(
    dishes.map((d) => d.description),
    ['Grillkorv, potatismos, räksallad, stekt brioche', 'Vegkorv, potatismos, rotfruktsallad, stekt brioche'],
  );
});

test('Poppels: without captured text it falls back to the embed and reports no week', () => {
  const html = '<iframe src="https://www.canva.com/design/DAFJA8wNZsw/view?embed"></iframe>';
  const menu = parser('poppels')(['Lunch', '12', 'Måndag–fredag 11.30–14.00'], 'Måndag', html);
  assert.deepEqual(menu, { week: null, dishes: [], embed: 'https://www.canva.com/design/DAFJA8wNZsw/view?embed' });
});

test('Magasin 5: Monday splits dish from sides and skips the price line', () => {
  const { dishes } = parser('magasinfem')(fixture('magasinfem'), 'Måndag');
  assert.deepEqual(
    dishes.map((d) => d.category),
    ['Vegetariska', 'Fisk', 'Grill', 'Sallad'],
  );
  assert.equal(dishes[1].name, 'Havets Wallenbergare');
  assert.match(dishes[1].description ?? '', /^Skaldjurshollandaise, Smörad Sparris/);
});

test('Magasin 5: Friday stops before the drinks list', () => {
  const { dishes } = parser('magasinfem')(fixture('magasinfem'), 'Fredag');
  assert.equal(dishes.length, 4);
  assert.equal(dishes[2].category, 'Schnitzel Fredag!!!!!');
  assert.ok(dishes.every((d) => !/Mineralvatten|Läsk/.test(d.name)));
});

// Delissimo's menu is a Canva PDF (captured 2026-09-28), read with readPdf.
const delissimoPdf = await readPdf(new Uint8Array(fs.readFileSync(new URL('fixtures/delissimo.pdf', import.meta.url))));
const delissimoLines = delissimoPdf.lines;

test('readPdf: Canva PDF yields clean upright text without the rotated background pattern', () => {
  assert.ok(delissimoLines.includes('MÅNDAG'));
  assert.ok(delissimoLines.includes('KÖTT: Grillad ryggbiff med grönpepparsås & friterad klyftpotatis.'));
  assert.ok(!delissimoLines.some((l) => /^[DELISMO ]+$/.test(l) && l !== 'DELISSIMO'), 'no background letter noise');
});

test('Delissimo: Tuesday has its four dishes plus the weekly pizza and salad', () => {
  const { week, dishes } = parser('delissimo')(delissimoLines, 'Tisdag');
  assert.equal(week, null);
  assert.deepEqual(
    dishes.map((d) => d.category),
    ['Kött', 'Fågel', 'Fisk', 'Pasta carbonara', 'Veckans', 'Veckans'],
  );
  assert.equal(dishes[3].name, 'Stekt bacon i parmesansås med vitlök & svartpeppar.');
  assert.equal(dishes[4].name, 'Pizza - parma');
  assert.match(dishes[4].description ?? '', /^Frasig surdegspizza .* parmesan\.$/);
});

test('Delissimo: wrapped lines are joined and an unlabelled dish keeps its own entry', () => {
  const thursday = parser('delissimo')(delissimoLines, 'Torsdag').dishes;
  assert.equal(
    thursday[0].name,
    'Handrullad högrevsköttbullar med gräddsås, potatismos, rårörda lingon & inlagd gurka.',
  );
  const friday = parser('delissimo')(delissimoLines, 'Fredag').dishes;
  assert.equal(friday[0].category, null);
  assert.match(friday[0].name, /^Grillmix .* BBQ-sås\. 159:-$/);
  assert.equal(friday[1].category, 'Pasta pesce');
});

test('Delissimo: finds the PDF linked as PLATINAN on the home page', () => {
  const { pdf } = restaurant('delissimo');
  assert.ok(pdf);
  const links =
    '<a href="http://delissimo.se/wp-content/uploads/2026/10/Gamle.pdf">GAMLESTADEN</a> | ' +
    '<a href="http://delissimo.se/wp-content/uploads/2026/10/Centralen.pdf">PLATINAN</a></p>';
  assert.equal(pdf(links), 'http://delissimo.se/wp-content/uploads/2026/10/Centralen.pdf');
  // Link text changed: fall back to the file names.
  assert.equal(pdf('<a href="/2026/11/Centralen.pdf">CENTRALEN</a>'), '/2026/11/Centralen.pdf');
  assert.equal(pdf('<a href="/2026/09/Platinan.pdf">MENY</a>'), '/2026/09/Platinan.pdf');
  assert.equal(pdf('<a href="/Veckans-lunch.pdf">ÖJERSJÖ</a>'), null);
});

test('readPdf: creation date from the Info dictionary', () => {
  assert.equal(delissimoPdf.created?.toISOString(), '2026-09-27T13:16:04.000Z');
});

test('pdfMenuWeek: Friday–Sunday uploads count as next week, Monday–Thursday as this week', () => {
  assert.ok(delissimoPdf.created);
  assert.equal(pdfMenuWeek(delissimoPdf.created), 40); // Sunday of week 39
  assert.equal(pdfMenuWeek(new Date('2026-09-25T10:00:00Z')), 40); // Friday, week 39
  assert.equal(pdfMenuWeek(new Date('2026-09-28T07:00:00Z')), 40); // Monday, week 40
  assert.equal(pdfMenuWeek(new Date('2026-10-01T20:00:00Z')), 40); // Thursday evening, week 40
  assert.equal(pdfMenuWeek(new Date('2026-10-01T22:30:00Z')), 41); // 00:30 Friday in Stockholm
});

test('htmlToLines: markup split around a removed tag does not reassemble', () => {
  assert.deepEqual(htmlToLines('<p>Före</p><scr<script>x</script>ipt>alert(1)</script><p>Efter</p>'), [
    'Före',
    'Efter',
  ]);
});

// carotte.txt was captured 2026-10-06 (vecka 41).
test('Carotte: Tuesday has meat, fish and veg, then the weekly salad and soup', () => {
  const { week, dishes } = parser('carotte')(fixture('carotte'), 'Tisdag');
  assert.equal(week, 41);
  assert.deepEqual(
    dishes.map((d) => d.category),
    ['Kött', 'Fisk', 'Veg', 'Veckans sallad', 'Soppa'],
  );
  assert.match(dishes[0].name, /^Nattbakad fläsksida/);
  assert.equal(dishes[3].description, 'Välj mellan kyckling / varmrökt lax / vegetariskt');
  assert.match(dishes[4].name, /^Indisk linssoppa/);
});

test('Carotte: Thursday stops at the dessert heading, Friday before the price list', () => {
  const day = (d: Weekday) =>
    parser('carotte')(fixture('carotte'), d).dishes.filter(
      (x) => x.category !== 'Veckans sallad' && x.category !== 'Soppa',
    );
  assert.equal(day('Torsdag').length, 3);
  assert.match(day('Fredag')[2].name, /^Halloumiburgare/);
});

// carotte-v43.txt was captured 2026-10-19 (vecka 43): no soup set, the salad heading in capitals, and Wednesday's
// meat dish wraps onto a second line.
test('Carotte v43: a blank soup is left out and the capitalised salad heading still counts', () => {
  const { week, dishes } = parser('carotte')(fixture('carotte-v43'), 'Måndag');
  assert.equal(week, 43);
  assert.deepEqual(
    dishes.map((d) => d.category),
    ['Kött', 'Fisk', 'Veg', 'Veckans sallad'],
  );
  assert.match(dishes[3].name, /^Ceasarsallad/);
});

test('Carotte v43: a dish wrapping onto the next line stays one dish', () => {
  const { dishes } = parser('carotte')(fixture('carotte-v43'), 'Onsdag');
  assert.deepEqual(
    dishes.map((d) => d.category),
    ['Kött', 'Fisk', 'Veg', 'Veckans sallad'],
  );
  assert.match(dishes[0].name, /morot och koriander$/);
});

test('parseCaptured keeps string-array entries and treats anything else as nothing captured', () => {
  assert.deepEqual(parseCaptured('{"poppels":["MÅNDAG","X"],"bad":[1],"worse":"x"}'), { poppels: ['MÅNDAG', 'X'] });
  assert.deepEqual(parseCaptured(null), {});
  assert.deepEqual(parseCaptured('not json'), {});
  assert.deepEqual(parseCaptured('[1]'), {});
});

// bbbangers.txt was captured 2026-10-06 (vecka 41).
test('Bang Bang Bangers: the sausage menu with toppings, side and price, the same every day', () => {
  const { week, dishes } = parser('bbbangers')(fixture('bbbangers'), 'Onsdag');
  assert.equal(week, null);
  assert.deepEqual(
    dishes.map((d) => d.name),
    [
      'Veckans banger',
      'Ruben the banger',
      'Das tyska banger',
      'Lagom svensk banger',
      'Classic special banger',
      'Bangers kebab',
      'Banger mash plate',
    ],
  );
  assert.equal(
    dishes[0].description,
    'Bamsekorv, brioche, surkål, söt senap, mangomajonnäs · Side: Potatiamos · 120 kr',
  );
  assert.equal(dishes[3].description, 'Bamsekorv 140 g, briochebröd, gurkmajonnäs, rostad lök · 90/125 kr');
  assert.equal(dishes[5].category, 'Nyhet');
  assert.match(dishes[6].description ?? '', /· från 85 kr$/);
  assert.deepEqual(parser('bbbangers')(fixture('bbbangers'), 'Måndag').dishes, dishes);
});

// A stand-in restaurant: one dish per page line, its PDF link (if any) found by `pdf`.
const fakeRestaurant = (pdf?: Restaurant['pdf']): Restaurant => {
  const { pdf: _, ...info } = restaurant('delissimo');
  return {
    ...info,
    url: 'https://example.test/',
    ...(pdf && { pdf }),
    parse: (lines) => ({ week: null, dishes: lines.map((name) => ({ category: null, name })) }),
  };
};
const withFetch = async <T>(pages: Response[], run: () => Promise<T>): Promise<T> => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => pages.shift() ?? new Response('gone', { status: 500 });
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
};

test('loadRestaurant: a failed read is tried once more, and the second answer counts', async () => {
  const failures: MenuFailure[] = [];
  const menu = await withFetch([new Response('busy', { status: 503 }), new Response('<p>Pasta</p>')], () =>
    loadRestaurant(fakeRestaurant(), 'Måndag', 43, undefined, (f) => failures.push(f), 0),
  );
  assert.equal(menu.error, null);
  assert.deepEqual(
    menu.dishes.map((d) => d.name),
    ['Pasta'],
  );
  assert.deepEqual(failures, []);
});

test('loadRestaurant: a page without the PDF link twice reports its status and text', async () => {
  const failures: MenuFailure[] = [];
  const page = () => new Response('<h1>Just a moment</h1><p>Checking your browser</p>');
  const menu = await withFetch([page(), page()], () =>
    loadRestaurant(
      fakeRestaurant(() => null),
      'Måndag',
      43,
      undefined,
      (f) => failures.push(f),
      0,
    ),
  );
  assert.equal(menu.error, 'Kunde inte hämta menyn (hittade ingen PDF-meny)');
  assert.deepEqual(failures, [
    {
      id: 'delissimo',
      error: menu.error,
      url: 'https://example.test/',
      status: 200,
      excerpt: 'Just a moment Checking your browser',
    },
  ]);
});
