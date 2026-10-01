import { htmlToLines } from './html.js';
import { pdfToLines } from './pdf.js';
import { RESTAURANTS, WEEKDAYS } from './restaurants.js';

const CACHE_MS = 30 * 60 * 1000;
const TZ = 'Europe/Stockholm';

// Calendar date in Stockholm as a UTC-midnight Date, so weekday/week maths ignore the host timezone.
export function stockholmDate(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ISO 8601 timestamp in Stockholm local time with its UTC offset, e.g. 2026-09-30T20:32:41+02:00.
export function stockholmTimestamp(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, hourCycle: 'h23', timeZoneName: 'longOffset',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const offset = parts.timeZoneName.replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export function isoWeek(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'knowit-lunch-app (lunch menu reader)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// Page text lines; for restaurants whose menu is a PDF linked from the page (r.pdf finds the link), the PDF's lines.
async function menuLines(r, html) {
  if (!r.pdf) return htmlToLines(html);
  const href = r.pdf(html);
  if (!href) throw new Error('hittade ingen PDF-meny');
  const pdf = await fetchPage(new URL(href, r.url).href.replace(/^http:/, 'https:'));
  return pdfToLines(new Uint8Array(await pdf.arrayBuffer()));
}

async function loadRestaurant(r, day, week) {
  const { parse, pdf, ...info } = r;
  try {
    const html = await (await fetchPage(r.url)).text();
    const { week: menuWeek, dishes, embed = null } = parse(await menuLines(r, html), day, html);
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
  const data = { date: key, day, week, fetchedAt: stockholmTimestamp(now), restaurants };
  cache = { key, at: now.getTime(), data };
  return data;
}
