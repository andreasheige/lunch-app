// Ratings: 1–5 stars per dish on today's menu, stored in D1 by worker.ts. Pure helpers here.
import type { LunchResponse, RatingInput } from '../shared/types.ts';

const VOTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A vote is only accepted for a dish on today's menu, so the stats page can't be filled with made-up names.
export function parseRating(input: unknown, lunch: LunchResponse): RatingInput | null {
  if (typeof input !== 'object' || input === null) return null;
  const { restaurant, dish, stars, voter } = input as Record<string, unknown>; // shape checked field by field below
  if (typeof restaurant !== 'string' || typeof dish !== 'string' || typeof voter !== 'string') return null;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  if (!VOTER.test(voter) || !lunch.day) return null;
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
