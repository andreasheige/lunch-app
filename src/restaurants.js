// Each parser gets the page as text lines, the Swedish weekday name ('Måndag'..'Fredag')
// and the raw HTML, and returns { week, dishes: [{ category, name, description }], embed? }.

const WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag'];

function menuWeek(lines) {
  for (const l of lines) {
    const m = l.match(/\bv(?:ecka|\.)\s*(\d{1,2})\b/i);
    if (m) return Number(m[1]);
  }
  return null;
}

// "KÖTTBULLAR I GRÄDDSÅS" -> "Köttbullar i gräddsås"; mixed-case text is left alone.
function sentenceCase(s) {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLocaleLowerCase('sv');
  return lower.charAt(0).toLocaleUpperCase('sv') + lower.slice(1);
}

function parsePocket(lines, day) {
  const start = lines.indexOf(day, lines.findIndex((l) => /^Lunch v\./.test(l)));
  if (start < 0) return { week: menuWeek(lines), dishes: [] };
  const dishes = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (WEEKDAYS.includes(l) || l === 'Klimato') break;
    if (/^Dagens /.test(l) && lines[i + 1]) {
      const category = l.replace(/^Dagens /, '');
      dishes.push({ category: category.charAt(0).toLocaleUpperCase('sv') + category.slice(1), name: lines[i + 1] });
      i++;
    }
  }
  return { week: menuWeek(lines), dishes };
}

// "Höst Bowl – Örtmarinerad …" / "Klassisk lasagne … serveras med …" -> short name + description.
function splitPagodenDish(text) {
  const m = text.match(/^(.+?)\s–\s?(.+)$/) ?? text.match(/^(.+?) ((?:serveras|toppas) .+)$/);
  if (!m) return { name: text };
  return { name: m[1], description: m[2].charAt(0).toLocaleUpperCase('sv') + m[2].slice(1) };
}

const PAGODEN_KITCHENS = ['Around the world', 'Green Kitchen', 'Fish Market', 'Butcher´s', 'East Asia'];

function parsePagoden(lines, day) {
  const start = lines.findIndex((l) => new RegExp(`Lunch ${day}$`).test(l));
  if (start < 0) return { week: menuWeek(lines), dishes: [] };
  const dishes = [];
  let category = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^OBS!/.test(l) || /^Lunch /.test(l)) break;
    if (PAGODEN_KITCHENS.includes(l)) category = l;
    else if (category && !/^Inkl\./.test(l)) dishes.push({ category, ...splitPagodenDish(l) });
  }
  return { week: menuWeek(lines), dishes };
}

function parseBjorkmans(lines, day) {
  const start = lines.indexOf(day.toLocaleUpperCase('sv'));
  if (start < 0) return { week: menuWeek(lines), dishes: [] };
  const upperDays = WEEKDAYS.map((d) => d.toLocaleUpperCase('sv'));
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (upperDays.includes(l) || /^VECKA \d+/.test(l) || l === 'GRÖNT') break;
    // Each day block carries a hidden "<Weekday> / Stängt" badge; skip it.
    if (WEEKDAYS.includes(l) || l === 'Stängt') continue;
    body.push(l);
  }
  const dishes = [];
  for (let i = 0; i < body.length; i += 2) {
    dishes.push({ category: null, name: sentenceCase(body[i]), description: body[i + 1] && sentenceCase(body[i + 1]) });
  }
  return { week: menuWeek(lines), dishes };
}

function parseIndya(lines, day) {
  const start = lines.indexOf(day.toLocaleUpperCase('sv'));
  if (start < 0) return { week: menuWeek(lines), dishes: [] };
  const upperDays = WEEKDAYS.map((d) => d.toLocaleUpperCase('sv'));
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    // "Stående Rätter" (the fixed dishes) closes each day's own menu.
    if (upperDays.includes(lines[i]) || /^Stående Rätter/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const dishes = [];
  for (let i = 0; i < body.length; i += 2) {
    const name = body[i].replace(/^DAGENS\b/i, 'Dagens').replace(/\s*(\d+):-$/, ' ($1 kr)');
    dishes.push({ category: null, name, description: body[i + 1] });
  }
  return { week: menuWeek(lines), dishes };
}

// Lines look like "Dagens Kött –Bao Buns / Långbakad Fläsksida / …".
function parseMonopolet(lines, day) {
  const start = lines.indexOf(day);
  if (start < 0) return { week: menuWeek(lines), dishes: [] };
  const dishes = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (WEEKDAYS.includes(l) || /^(Hjärtligt|———)/.test(l)) break;
    const m = l.match(/^(.+?)\s*–\s*(.+)$/);
    const [name, ...rest] = (m ? m[2] : l).split(/\s*\/\s*/);
    dishes.push({ category: m ? m[1].replace(/^Dagens /, '') : null, name, description: rest.join(', ') || undefined });
  }
  return { week: menuWeek(lines), dishes };
}

// Each dish is three lines: "Dagens Fisk", "135:-", "Havets Wallenbergare / Skaldjurshollandaise / …".
function parseMagasinFem(lines, day) {
  const start = lines.indexOf(day);
  if (start < 0) return { week: menuWeek(lines), dishes: [] };
  const dishes = [];
  for (let i = start + 1; i + 2 < lines.length; i += 3) {
    if (WEEKDAYS.includes(lines[i]) || lines[i] === 'Dryck') break;
    const category = lines[i].replace(/^Dagens /, '');
    const [name, ...rest] = lines[i + 2].split(/\s*\/\s*/);
    dishes.push({
      category: category.charAt(0).toLocaleUpperCase('sv') + category.slice(1),
      name,
      description: rest.join(', ') || undefined,
    });
  }
  return { week: menuWeek(lines), dishes };
}

// The lunch menu is a Canva design embedded in the page. Canva blocks server requests
// (Cloudflare challenge), so we only pass the embed URL on for the browser to show.
function parsePoppels(lines, day, html) {
  const embed = html.match(/https:\/\/www\.canva\.com\/design\/[\w-]+\/view\?embed/)?.[0] ?? null;
  return { week: null, dishes: [], embed };
}

// The weekly menu is a Canva PDF linked from the home page (see pdf.js). Day sections hold
// "KÖTT: Grillad ryggbiff …" lines, sometimes wrapped onto the next line; the "VECKANS …"
// dishes at the bottom are served all week. The PDF has no week number; lunch.js derives it from
// the PDF creation date (pdfMenuWeek).
const DELISSIMO_LABEL = /^([A-ZÅÄÖ][A-ZÅÄÖ ]*[A-ZÅÄÖ]):\s*(.+)$/;
const DELISSIMO_DAY = new RegExp(`^(${WEEKDAYS.map((d) => d.toLocaleUpperCase('sv')).join('|')})\\b`);

function parseDelissimo(lines, day) {
  const dishes = [];
  const start = lines.findIndex((l) => l.match(DELISSIMO_DAY)?.[1] === day.toLocaleUpperCase('sv'));
  if (start >= 0) {
    for (const l of lines.slice(start + 1)) {
      if (DELISSIMO_DAY.test(l) || /^VECKANS\b/.test(l) || /^Vid specialkost/.test(l)) break;
      const m = l.match(DELISSIMO_LABEL);
      const last = dishes.at(-1);
      if (m) dishes.push({ category: sentenceCase(m[1]), name: m[2] });
      else if (last && !/[.!]$/.test(last.name)) last.name += ` ${l}`;
      else dishes.push({ category: null, name: l });
    }
  }
  // Weekly dishes follow the last day section ("VECKANS LUNCH" at the top is the page title).
  const lastDay = lines.findLastIndex((l) => DELISSIMO_DAY.test(l));
  let weekly = null;
  for (const l of lines.slice(lastDay + 1)) {
    if (/^Vid specialkost/.test(l)) break;
    const m = l.match(/^VECKANS (.+)$/);
    if (m) dishes.push((weekly = { category: 'Veckans', name: sentenceCase(m[1]), description: '' }));
    else if (weekly) weekly.description = `${weekly.description} ${l}`.trim();
  }
  return { week: null, dishes };
}

export const RESTAURANTS = [
  {
    id: 'poppels',
    name: 'Poppels Citybryggeri',
    url: 'https://www.poppels.se/citybryggeriet/lunch/',
    address: 'Vikingsgatan 1',
    distance: 20,
    hours: '11.30–14.00',
    price: '145 kr inkl. alkoholfri öl, bröd & kaffe · Inhouse lunch 135 kr',
    parse: parsePoppels,
  },
  {
    id: 'indya',
    name: 'Indya Kilsgatan',
    url: 'https://indya.se/indya-kilsgatan/lunch-meny',
    address: 'Kilsgatan 7',
    distance: 90,
    hours: '11.00–13.30',
    price: '129 kr inkl. naan, sallad, kaffe & kaka',
    parse: parseIndya,
  },
  {
    id: 'bjorkmans',
    name: 'Björkmans Skafferi',
    url: 'https://www.bjorkmansskafferi.se/',
    address: 'Kilsgatan 4',
    distance: 150,
    hours: '11.00–13.30',
    price: '135 kr inkl. sallad, bröd & kaffe',
    parse: parseBjorkmans,
  },
  {
    id: 'pocket',
    name: 'Pocket Göteborg',
    url: 'https://www.nordrest.se/restaurang/pocket-goteborg/',
    address: 'Bergslagsgatan 2',
    distance: 160,
    hours: '11.00–14.00',
    price: null,
    parse: parsePocket,
  },
  {
    id: 'pagoden',
    name: 'Kooperativet Pagoden',
    url: 'https://pagoden.se/',
    address: 'Gullbergs Strandgata 15',
    distance: 280,
    hours: '11.00–13.30',
    price: null,
    parse: parsePagoden,
  },
  {
    id: 'monopolet',
    name: 'Monopolet',
    url: 'https://monopolet.nu/',
    address: 'Kämpegatan 4',
    distance: 250,
    hours: '11.00–13.30',
    price: '139 kr',
    parse: parseMonopolet,
  },
  {
    id: 'magasinfem',
    name: 'Magasin 5',
    url: 'https://magasinfem.nu/',
    address: 'Lilla Bommen 5',
    distance: 500,
    hours: '11.00–13.30',
    price: '135 kr',
    parse: parseMagasinFem,
  },
  {
    id: 'delissimo',
    name: 'Delissimo Platinan',
    url: 'https://delissimo.se/',
    address: 'Platinan, Centralen',
    distance: 100,
    hours: '11.00–14.00',
    price: '149 kr inkl. salladsbuffé, bröd & kaffe',
    pdf: (html) => html.match(/href="([^"]*\/Platinan\.pdf)"/i)?.[1] ?? null,
    parse: parseDelissimo,
  },
];

export { WEEKDAYS };
