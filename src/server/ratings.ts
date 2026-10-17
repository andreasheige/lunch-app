// Ratings: 1–5 stars per dish on today's menu or the previous lunch day's, stored in D1 by worker.ts. Pure helpers here.
import type { LunchResponse, RatingInput } from '../shared/types.ts';

const VOTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The previous lunch day (latest menu_days date before today) and its dishes as ratingKey()s. */
export interface PreviousMenu {
  date: string;
  keys: Set<string>;
}

// A vote is only accepted for a dish on today's menu, or (with `date`) on the previous lunch day's served menu, so
// the stats page can't be filled with made-up names or backfilled days.
export function parseRating(
  input: unknown,
  lunch: LunchResponse,
  previous: PreviousMenu | null = null,
): RatingInput | null {
  if (typeof input !== 'object' || input === null) return null;
  const { restaurant, dish, stars, voter, date } = input as Record<string, unknown>; // shape checked field by field below
  if (typeof restaurant !== 'string' || typeof dish !== 'string' || typeof voter !== 'string') return null;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  if (!VOTER.test(voter)) return null;
  if (date !== undefined && date !== lunch.date) {
    if (!previous || date !== previous.date || !previous.keys.has(ratingKey(restaurant, dish))) return null;
    return { date: previous.date, restaurant, dish, stars, voter };
  }
  if (!lunch.day) return null;
  const r = lunch.restaurants.find((x) => x.id === restaurant);
  if (!r?.dishes.some((d) => d.name === dish)) return null;
  return { date: lunch.date, restaurant, dish, stars, voter };
}

// First date (YYYY-MM-DD) of a stats range: the last 14 days including today, or everything.
export function rangeStart(today: string, range: string): string {
  if (range === 'all') return '0000-00-00';
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 13);
  return d.toISOString().slice(0, 10);
}

export const ratingKey = (restaurant: string, dish: string): string => `${restaurant}\n${dish}`;
