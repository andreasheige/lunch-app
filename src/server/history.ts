// Menu history (D1 menu_days) for /history.json and the "served before" hints on /lunch.json. Pure helpers;
// worker.ts runs the queries.
import type { Diet, HistoryResponse, LunchResponse } from '../shared/types.ts';
import { isDiet } from './diet.ts';
import { RESTAURANTS } from './restaurants.ts';

export interface HistoryDishRow {
  date: string;
  restaurant: string;
  dish: string;
  diet: string | null;
}

export interface ServedRow {
  restaurant: string;
  dish: string;
  times: number;
  last: string;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Monday and Friday of the week `date` (YYYY-MM-DD) falls in. */
export function weekBounds(date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const from = isoDate(d);
  d.setUTCDate(d.getUTCDate() + 4);
  return { from, to: isoDate(d) };
}

const PLACE_ORDER = new Map(RESTAURANTS.map((r, i) => [r.id, i]));

/** One week's rows as days → places (in the restaurant list's order) → dishes. */
export function groupWeek(rows: HistoryDishRow[]): NonNullable<HistoryResponse['week']>['days'] {
  const names = new Map(RESTAURANTS.map((r) => [r.id, r.name]));
  type Dishes = { dish: string; diet: Diet | null }[];
  const byDate = new Map<string, Map<string, Dishes>>();
  for (const r of rows) {
    const places = byDate.get(r.date) ?? new Map<string, Dishes>();
    byDate.set(r.date, places);
    const dishes = places.get(r.restaurant) ?? [];
    places.set(r.restaurant, dishes);
    dishes.push({ dish: r.dish, diet: isDiet(r.diet) ? r.diet : null });
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, places]) => ({
      date,
      places: [...places.entries()]
        .sort(([a], [b]) => (PLACE_ORDER.get(a) ?? 99) - (PLACE_ORDER.get(b) ?? 99))
        .map(([id, dishes]) => ({ id, name: names.get(id) ?? id, dishes })),
    }));
}

/** Today's dishes with how often each place served them before (rows from earlier days only). */
export function addServed(lunch: LunchResponse, rows: ServedRow[]): LunchResponse {
  if (!rows.length) return lunch;
  const served = new Map(rows.map((r) => [`${r.restaurant}\n${r.dish}`, { times: r.times, last: r.last }]));
  return {
    ...lunch,
    restaurants: lunch.restaurants.map((r) => ({
      ...r,
      dishes: r.dishes.map((d) => {
        const s = served.get(`${r.id}\n${d.name}`);
        return s ? { ...d, served: s } : d;
      }),
    })),
  };
}
