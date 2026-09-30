import { htmlToLines } from './html.js';
import { RESTAURANTS, WEEKDAYS } from './restaurants.js';

const CACHE_MS = 30 * 60 * 1000;
const TZ = 'Europe/Stockholm';

// Calendar date in Stockholm as a UTC-midnight Date, so weekday/week maths ignore the host timezone.
export function stockholmDate(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoWeek(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'knowit-lunch-app (lunch menu reader)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function loadRestaurant(r, day, week) {
  const { parse, ...info } = r;
  try {
    const html = await fetchHtml(r.url);
    const { week: menuWeek, dishes, embed = null } = parse(htmlToLines(html), day, html);
    return {
      ...info,
      dishes,
      embed,
      stale: menuWeek !== null && menuWeek !== week,
      menuWeek,
      error: dishes.length || embed ? null : 'Hittade ingen meny för idag',
    };
  } catch (err) {
    return { ...info, dishes: [], embed: null, stale: false, menuWeek: null, error: `Kunde inte hämta menyn (${err.message})` };
  }
}

let cache = { key: null, at: 0, data: null };

export async function getTodaysLunch(now = new Date()) {
  const date = stockholmDate(now);
  const day = WEEKDAYS[date.getUTCDay() - 1] ?? null;
  const week = isoWeek(date);
  const key = date.toISOString().slice(0, 10);

  if (cache.key === key && now - cache.at < CACHE_MS) return cache.data;

  const restaurants = day ? await Promise.all(RESTAURANTS.map((r) => loadRestaurant(r, day, week))) : [];
  const data = { date: key, day, week, fetchedAt: now.toISOString(), restaurants };
  cache = { key, at: now.getTime(), data };
  return data;
}
