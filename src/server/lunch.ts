import type { LunchResponse, RestaurantMenu, Weekday } from '../shared/types.ts';
import { htmlToLines } from './html.ts';
import { readPdf } from './pdf.ts';
import { RESTAURANTS, type Restaurant, WEEKDAYS } from './restaurants.ts';

const CACHE_MS = 30 * 60 * 1000;
// A failed read is tried once more after this long; sites now and then answer one request with a page
// missing the menu (2026-10-22: delissimo.se without its PDF links, fine the day before and after).
const RETRY_MS = 3_000;
const TZ = 'Europe/Stockholm';

// Calendar date in Stockholm as a UTC-midnight Date, so weekday/week maths ignore the host timezone.
export function stockholmDate(now = new Date()): Date {
  const [y = 0, m = 1, d = 1] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ISO 8601 timestamp in Stockholm local time with its UTC offset, e.g. 2026-09-30T20:32:41+02:00.
export function stockholmTimestamp(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const offset = (parts.timeZoneName ?? '').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export function isoWeek(date: Date): number {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** What a failed read got back, for the build's issue reports (never part of lunch.json). */
export type MenuFailure = { id: string; error: string; url: string; status: number | null; excerpt: string };

// The start of a page's text, enough to tell a bot check or error page from a changed layout.
const excerpt = (lines: string[]) => lines.join(' ').slice(0, 300);

// An error that knows which page it came from and what that page said.
class PageError extends Error {
  readonly url: string;
  readonly status: number | null;
  readonly excerpt: string;
  constructor(message: string, url: string, status: number | null, excerpt: string) {
    super(message);
    this.url = url;
    this.status = status;
    this.excerpt = excerpt;
  }
}

async function fetchPage(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'knowit-lunch-app (lunch menu reader)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new PageError(`HTTP ${res.status}`, url, res.status, excerpt(htmlToLines(body)));
  }
  return res;
}

// Week a PDF menu is for, from when it was made: Friday–Sunday uploads are next week's menu,
// Monday–Thursday ones this week's (shifting by three days maps exactly that onto ISO weeks).
export function pdfMenuWeek(created: Date): number {
  const date = stockholmDate(created);
  date.setUTCDate(date.getUTCDate() + 3);
  return isoWeek(date);
}

// Page text lines; for restaurants whose menu is a PDF linked from the page (r.pdf finds the link),
// the PDF's lines and the week its creation date points to.
async function menuSource(r: Restaurant, html: string): Promise<{ lines: string[]; week: number | null }> {
  if (!r.pdf) return { lines: htmlToLines(html), week: null };
  const href = r.pdf(html);
  if (!href) throw new PageError('hittade ingen PDF-meny', r.url, 200, excerpt(htmlToLines(html)));
  const pdf = await fetchPage(new URL(href, r.url).href.replace(/^http:/, 'https:'));
  const { lines, created } = await readPdf(new Uint8Array(await pdf.arrayBuffer()));
  return { lines, week: created ? pdfMenuWeek(created) : null };
}

/** Menu text lines read with a real browser at build time (scripts/capture.ts), by restaurant id. */
export type Captured = Record<string, string[]>;

// captured.json as written by scripts/capture.ts; anything unreadable counts as nothing captured.
export function parseCaptured(json: string | null): Captured {
  try {
    const data: unknown = JSON.parse(json ?? '{}');
    if (typeof data !== 'object' || data === null) return {};
    return Object.fromEntries(
      Object.entries(data).filter(
        (e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every((l) => typeof l === 'string'),
      ),
    );
  } catch {
    return {};
  }
}

// The page (or its PDF) read and parsed, plus the lines it was parsed from.
async function readMenu(r: Restaurant, day: Weekday, captured: string[] | undefined) {
  const html = await (await fetchPage(r.url)).text();
  const source = captured ? { lines: captured, week: null } : await menuSource(r, html);
  return { parsed: r.parse(source.lines, day, html), source };
}

export async function loadRestaurant(
  r: Restaurant,
  day: Weekday,
  week: number,
  captured: string[] | undefined,
  onFailure?: (failure: MenuFailure) => void,
  retryMs = RETRY_MS,
): Promise<RestaurantMenu> {
  const { parse, pdf, ...info } = r;
  try {
    const { parsed, source } = await readMenu(r, day, captured).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      return readMenu(r, day, captured);
    });
    const { dishes, embed = null } = parsed;
    const menuWeek = parsed.week ?? source.week;
    const error = dishes.length || embed ? null : 'Hittade ingen meny för idag';
    if (error) onFailure?.({ id: r.id, error, url: r.url, status: 200, excerpt: excerpt(source.lines) });
    return {
      ...info,
      dishes,
      embed,
      stale: menuWeek !== null && menuWeek !== week,
      menuWeek,
      error,
    };
  } catch (err) {
    const error = `Kunde inte hämta menyn (${err instanceof Error ? err.message : String(err)})`;
    onFailure?.(
      err instanceof PageError
        ? { id: r.id, error, url: err.url, status: err.status, excerpt: err.excerpt }
        : { id: r.id, error, url: r.url, status: null, excerpt: '' },
    );
    return {
      ...info,
      dishes: [],
      embed: null,
      stale: false,
      menuWeek: null,
      error,
    };
  }
}

let cache: { key: string | null; at: number; data: LunchResponse | null } = { key: null, at: 0, data: null };

export async function getTodaysLunch(
  captured: Captured = {},
  now = new Date(),
  onFailure?: (failure: MenuFailure) => void,
): Promise<LunchResponse> {
  const date = stockholmDate(now);
  const day = WEEKDAYS[date.getUTCDay() - 1] ?? null;
  const week = isoWeek(date);
  const key = date.toISOString().slice(0, 10);

  if (cache.data && cache.key === key && now.getTime() - cache.at < CACHE_MS) return cache.data;

  const restaurants = day
    ? await Promise.all(RESTAURANTS.map((r) => loadRestaurant(r, day, week, captured[r.id], onFailure)))
    : [];
  const data: LunchResponse = { date: key, day, week, fetchedAt: stockholmTimestamp(now), restaurants };
  cache = { key, at: now.getTime(), data };
  return data;
}
