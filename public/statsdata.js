// The stats page's calculations, kept apart from the drawing (stats.js) so they can be tested
// (test/statsdata.test.js): ingredients and the ingredient network, the league, week-on-week votes, diet counts.

// Ingredient words in the Swedish menu texts (and the odd English one) → [Swedish, English] label and the diet
// group it colours as. A dish can match several.
export const INGREDIENTS = [
  ['Potatis', 'Potato', 'veg', /potatis|potato/],
  ['Tomat', 'Tomato', 'veg', /tomat/],
  ['Kyckling', 'Chicken', 'meat', /kyckling|chicken/],
  ['Koriander', 'Coriander', 'veg', /koriander|coriander/],
  ['Gurka', 'Cucumber', 'veg', /gurka/],
  ['Citron', 'Lemon', 'veg', /citron|lemon/],
  ['Chili', 'Chili', 'veg', /chili/],
  ['Ris', 'Rice', 'veg', /\bris\b|basmatiris|jasminris|\brice/],
  ['Mango', 'Mango', 'veg', /mango/],
  ['Gnocchi', 'Gnocchi', 'veg', /gnocchi/],
  ['Bacon', 'Bacon', 'meat', /bacon/],
  ['Parmesan', 'Parmesan', 'veg', /parmesan|grana padano/],
  ['Surkål', 'Sauerkraut', 'veg', /surkål/],
  ['Bröd', 'Bread', 'veg', /bröd|brioche|bread/],
  ['Halloumi', 'Halloumi', 'veg', /halloumi/],
  ['Ingefära', 'Ginger', 'veg', /ingefär/],
  ['Vitlök', 'Garlic', 'veg', /vitlök/],
  ['Lamm', 'Lamb', 'meat', /lamm/],
  ['Dill', 'Dill', 'veg', /\bdill/],
  ['Fisk', 'Fish', 'fish', /fisk|\blax|torsk|kolja|kummel|\bsej\b|\bfish/],
  ['Grädde', 'Cream', 'veg', /grädd|crème|creme/],
  ['Rödkål', 'Red cabbage', 'veg', /rödkål/],
  ['Quinoa', 'Quinoa', 'veg', /quinoa/],
  ['Morot', 'Carrot', 'veg', /morot|morötter/],
  ['Sesam', 'Sesame', 'veg', /sesam/],
  ['Fläsk', 'Pork', 'meat', /fläsk|gris|karré/],
  ['Nöt', 'Beef', 'meat', /biff|oxbringa|högrev|\bnöt/],
  ['Svamp', 'Mushroom', 'veg', /svamp|champinjon/],
  ['Pasta', 'Pasta', 'veg', /pasta|tagliatelle|spaghetti|penne/],
  ['Korv', 'Sausage', 'meat', /korv|banger/],
  ['Räkor', 'Prawns', 'fish', /räk/],
  ['Bönor', 'Beans', 'veg', /bön/],
  ['Ost', 'Cheese', 'veg', /\bost\b|färskost|fetaost|vitost|mozzarella|cheddar/],
];

export const ingredientsOf = (dish) => {
  const text = `${dish.name} ${dish.description ?? ''}`.toLowerCase();
  return INGREDIENTS.filter(([, , , re]) => re.test(text)).map(([sv]) => sv);
};

// Places with a readable menu today and the ingredients in at least `min` dishes; links carry how many of the
// place's dishes have the ingredient.
export function ingredientGraph(restaurants, min = 2) {
  const places = restaurants.filter((r) => !r.error && !r.embed && r.dishes.length);
  const count = new Map();
  const perPlace = places.map((r) => {
    const lists = r.dishes.map(ingredientsOf);
    for (const list of lists) for (const i of list) count.set(i, (count.get(i) ?? 0) + 1);
    return { r, lists };
  });
  const kept = [...count].filter(([, n]) => n >= min).map(([i]) => i);
  const nodes = [
    ...places.map((r) => ({ id: r.id, label: r.name, kind: 'place', size: r.dishes.length })),
    ...kept.map((i) => ({ id: `i:${i}`, label: i, kind: INGREDIENTS.find(([sv]) => sv === i)[2], size: count.get(i) })),
  ];
  const links = [];
  for (const { r, lists } of perPlace) {
    for (const i of kept) {
      const w = lists.filter((l) => l.includes(i)).length;
      if (w) links.push({ source: r.id, target: `i:${i}`, weight: w });
    }
  }
  return { nodes, links };
}

// A small deterministic force layout (repulsion, springs, a pull to the centre) inside width × height.
export function layoutGraph({ nodes, links }, width, height, steps = 400) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const pos = new Map(
    nodes.map((n) => [
      n.id,
      { x: width / 2 + (random() - 0.5) * width * 0.4, y: height / 2 + (random() - 0.5) * height * 0.5, vx: 0, vy: 0 },
    ]),
  );
  for (let step = 0; step < steps; step++) {
    for (const a of nodes) {
      const pa = pos.get(a.id);
      for (const b of nodes) {
        if (a === b) continue;
        const pb = pos.get(b.id);
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const push = (a.kind === 'place' && b.kind === 'place' ? 40000 : 9000) / d2 / Math.sqrt(d2);
        pa.vx += dx * push;
        pa.vy += dy * push;
      }
    }
    for (const l of links) {
      const a = pos.get(l.source);
      const b = pos.get(l.target);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) + 0.01;
      const pull = (d - 140) * 0.01 * (1 + l.weight * 0.3);
      a.vx += (dx / d) * pull;
      a.vy += (dy / d) * pull;
      b.vx -= (dx / d) * pull;
      b.vy -= (dy / d) * pull;
    }
    for (const n of nodes) {
      const p = pos.get(n.id);
      p.vx += (width / 2 - p.x) * 0.002;
      p.vy += (height / 2 - p.y) * 0.005;
      p.x = Math.max(40, Math.min(width - 40, p.x + p.vx * 0.5));
      // Room below for the label under each node.
      p.y = Math.max(30, Math.min(height - 50, p.y + p.vy * 0.5));
      p.vx *= 0.6;
      p.vy *= 0.6;
    }
  }
  return new Map([...pos].map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]));
}

export const QUALIFY = 3;

// The league: places by average, those with QUALIFY votes first; each with its form (average per voting day).
export function league(stats) {
  return stats.restaurants.map((r) => ({
    ...r,
    qualified: r.votes >= QUALIFY,
    form: stats.placeDays.filter((d) => d.id === r.id).map((d) => ({ date: d.date, avg: d.avg, votes: d.votes })),
  }));
}

const isoDay = (d) => d.toISOString().slice(0, 10);

// Votes per weekday (Mon–Fri) for the week of `today` and the one before; days after today are null.
export function weekVotes(days, today) {
  const byDate = new Map(days.map((d) => [d.date, d.votes]));
  const date = new Date(`${today}T12:00:00Z`);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const week = (offset) =>
    [0, 1, 2, 3, 4].map((i) => {
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + i + offset);
      return isoDay(d) > today ? null : (byDate.get(isoDay(d)) ?? 0);
    });
  return { thisWeek: week(0), lastWeek: week(-7) };
}

export function dietCounts(restaurants) {
  const counts = { veg: 0, fish: 0, meat: 0, none: 0 };
  for (const r of restaurants) for (const d of r.dishes) counts[d.diet ?? 'none']++;
  return counts;
}

// The first "NNN kr" in a place's price text, if any.
export const priceOf = (r) => {
  const match = (r.price ?? '').match(/(\d{2,3})\s*kr/);
  return match ? Number(match[1]) : null;
};
