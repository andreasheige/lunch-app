// Cloudflare Worker: live /lunch.json (edge-cached 30 min), /releases.json, ratings (POST /rate, /ratings.json,
// /stats.json), POST /report → GitHub issue; everything else is served from dist/ assets.
import type {
  LunchResponse,
  RatingSummary,
  ReleaseCommit,
  ReleaseNote,
  StatsResponse,
  TodaysRatings,
} from '../shared/types.ts';
import { addDiets, type Classified, DIET_PROMPT, parseModelDiets, unlabelledDishes } from './diet.ts';
import { getTodaysLunch, parseCaptured } from './lunch.ts';
import { parseRating, rangeStart, ratingKey } from './ratings.ts';
import { parseNote, RELEASE_PROMPT, toNotes } from './releases.ts';
import { handleReport, type ReportEnv } from './report.ts';
import { RESTAURANTS } from './restaurants.ts';

interface Env extends ReportEnv {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  CF_VERSION_METADATA: WorkerVersionMetadata;
}

const MAX_AGE = 30 * 60;
const DIET_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DIET_MAX_AGE = 24 * 60 * 60;

// Workers AI guesses for dishes without a telling label; any failure just leaves them without an icon.
// The model's answer is edge-cached a day per exact dish list, so only the first menu fetch of the day
// waits for it; cached answers go through parseModelDiets again like fresh ones.
async function classify(ai: Ai, lunch: LunchResponse, origin: string): Promise<Classified> {
  const dishes = unlabelledDishes(lunch);
  if (!dishes.size) return {};
  try {
    const input = JSON.stringify(Object.fromEntries([...dishes.values()].map((t, i) => [i + 1, t])));
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${DIET_MODEL}\n${input}`));
    const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const key = new Request(`${origin}/diets/${id}`);
    let answer: unknown = await (await caches.default.match(key))?.json();
    if (answer === undefined) {
      const out = await ai.run(DIET_MODEL, {
        messages: [
          { role: 'system', content: DIET_PROMPT },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 1024,
      });
      answer = typeof out === 'object' && out !== null && 'response' in out ? out.response : null;
      const res = new Response(JSON.stringify(answer), {
        headers: { 'cache-control': `public, max-age=${DIET_MAX_AGE}` },
      });
      await caches.default.put(key, res);
    }
    const diets = parseModelDiets(answer, dishes.size);
    const keys = [...dishes.keys()];
    return Object.fromEntries(keys.flatMap((k, i) => (diets[i] ? [[k, diets[i]]] : [])));
  } catch {
    return {};
  }
}

const RELEASE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const RELEASE_BATCH = 8;

// Commits from the build (commits.json) with their Swedish text from D1; up to RELEASE_BATCH commits without
// one are rewritten by Workers AI and stored, so each commit costs one call ever. `complete` is false while
// some still show their commit subject, so the response isn't cached until all are done.
async function releaseNotes(env: Env, origin: string): Promise<{ notes: ReleaseNote[]; complete: boolean }> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/commits.json`));
  const commits: ReleaseCommit[] = res.ok ? await res.json() : [];
  const { results } = await env.DB.prepare('SELECT sha, title, body FROM release_notes').all<{
    sha: string;
    title: string;
    body: string;
  }>();
  const texts = new Map(results.map((r) => [r.sha, { title: r.title, body: r.body }]));
  const missing = commits.filter((c) => !texts.has(c.sha)).slice(0, RELEASE_BATCH);
  await Promise.all(
    missing.map(async (c) => {
      try {
        const out = await env.AI.run(RELEASE_MODEL, {
          messages: [
            { role: 'system', content: RELEASE_PROMPT },
            { role: 'user', content: `${c.type}: ${c.subject}\n\n${c.body}` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 400,
        });
        const note = parseNote(typeof out === 'object' && out !== null && 'response' in out ? out.response : null);
        if (!note) return;
        await env.DB.prepare('INSERT OR IGNORE INTO release_notes (sha, title, body) VALUES (?, ?, ?)')
          .bind(c.sha, note.title, note.body)
          .run();
        texts.set(c.sha, note);
      } catch {
        // Left pending; the next request tries again.
      }
    }),
  );
  const notes = toNotes(commits, texts);
  return { notes, complete: notes.every((n) => !n.pending) };
}

// /lunch.json, edge-cached and keyed by deployed version, so a deploy starts with an empty cache instead of
// serving the old menu list.
async function lunchResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = new URL(request.url).origin;
  const key = new Request(`${origin}/lunch.json?v=${env.CF_VERSION_METADATA.id}`);
  const cached = await caches.default.match(key);
  if (cached) return cached;

  // Menus the build read with a real browser (captured.json, see scripts/capture.ts); 404 when none were.
  const capturedRes = await env.ASSETS.fetch(new Request(`${origin}/captured.json`));
  const lunch = await getTodaysLunch(parseCaptured(capturedRes.ok ? await capturedRes.text() : null));
  const data = addDiets(lunch, await classify(env.AI, lunch, origin));
  const res = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${MAX_AGE}` },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

const json = (data: unknown, status = 200, maxAge = 0): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });

// POST /rate: one vote per dish, voter and day (a new vote replaces the old); only for dishes on today's menu.
async function handleRate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Använd POST.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Fel ursprung.' }, 403);
  const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? '' });
  if (!success) return json({ error: 'För många röster. Vänta en minut.' }, 429);
  const raw = await request.text();
  if (raw.length > 2000) return json({ error: 'Ogiltig förfrågan.' }, 413);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'Ogiltig förfrågan.' }, 400);
  }
  const lunch: LunchResponse = await (await lunchResponse(request, env, ctx)).json();
  const vote = parseRating(input, lunch);
  if (!vote) return json({ error: 'Rätten finns inte på dagens meny.' }, 400);
  await env.DB.prepare(
    `INSERT INTO ratings (date, restaurant, dish, voter, stars) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (date, restaurant, dish, voter) DO UPDATE SET stars = excluded.stars, created_at = datetime('now')`,
  )
    .bind(vote.date, vote.restaurant, vote.dish, vote.voter, vote.stars)
    .run();
  const summary = await env.DB.prepare(
    'SELECT AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE date = ? AND restaurant = ? AND dish = ?',
  )
    .bind(vote.date, vote.restaurant, vote.dish)
    .first<RatingSummary>();
  return json({ ok: true, ...summary });
}

// GET /ratings.json: averages for today's dishes, for the stars on the cards.
async function todaysRatings(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const lunch: LunchResponse = await (await lunchResponse(request, env, ctx)).json();
  const { results } = await env.DB.prepare(
    'SELECT restaurant, dish, AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE date = ? GROUP BY restaurant, dish',
  )
    .bind(lunch.date)
    .all<{ restaurant: string; dish: string } & RatingSummary>();
  const data: TodaysRatings = Object.fromEntries(
    results.map((r) => [ratingKey(r.restaurant, r.dish), { avg: r.avg, count: r.count }]),
  );
  return json(data);
}

const STATS_MAX_AGE = 5 * 60;

// GET /stats.json?range=14|all: everything the /statistik page shows, in one round trip.
async function stats(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') === 'all' ? 'all' : '14';
  const lunch: LunchResponse = await (await lunchResponse(request, env, ctx)).json();
  const from = rangeStart(lunch.date, range);
  const names = new Map(RESTAURANTS.map((r) => [r.id, r.name]));
  const q = (sql: string) => env.DB.prepare(sql).bind(from);
  const [totals, restaurants, dishes, days, divisive] = await env.DB.batch([
    q(`SELECT COUNT(*) AS votes, COUNT(DISTINCT voter) AS voters,
         COUNT(DISTINCT restaurant || char(10) || dish) AS dishes, AVG(stars) AS avg
       FROM ratings WHERE date >= ?`),
    q(`SELECT restaurant AS id, AVG(stars) AS avg, COUNT(*) AS votes FROM ratings WHERE date >= ?
       GROUP BY restaurant ORDER BY (COUNT(*) >= 3) DESC, avg DESC, votes DESC`),
    q(`SELECT restaurant, dish, AVG(stars) AS avg, COUNT(*) AS votes FROM ratings WHERE date >= ?
       GROUP BY restaurant, dish ORDER BY (COUNT(*) >= 2) DESC, avg DESC, votes DESC LIMIT 5`),
    q(`SELECT date, COUNT(*) AS votes, AVG(stars) AS avg FROM ratings WHERE date >= ? GROUP BY date ORDER BY date`),
    q(`SELECT restaurant, dish, AVG(stars) AS avg, COUNT(*) AS votes,
         AVG(stars * stars) - AVG(stars) * AVG(stars) AS spread
       FROM ratings WHERE date >= ? GROUP BY restaurant, dish HAVING COUNT(*) >= 3 ORDER BY spread DESC LIMIT 1`),
  ]);
  const rows = <T>(r: D1Result | undefined) => (r?.results ?? []) as T[]; // D1 rows are untyped; shapes match the SELECTs above
  const name = (id: string) => names.get(id) ?? id;
  const t = rows<StatsResponse['totals']>(totals)[0] ?? { votes: 0, voters: 0, dishes: 0, avg: null };
  const data: StatsResponse = {
    range,
    from: range === 'all' ? (rows<{ date: string }>(days)[0]?.date ?? lunch.date) : from,
    to: lunch.date,
    totals: t,
    restaurants: rows<{ id: string; avg: number; votes: number }>(restaurants).map((r) => ({ ...r, name: name(r.id) })),
    dishes: rows<StatsResponse['dishes'][number]>(dishes).map((d) => ({ ...d, restaurant: name(d.restaurant) })),
    days: rows<StatsResponse['days'][number]>(days),
    divisive:
      rows<NonNullable<StatsResponse['divisive']>>(divisive).map((d) => ({
        ...d,
        restaurant: name(d.restaurant),
      }))[0] ?? null,
  };
  return json(data, 200, STATS_MAX_AGE);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/report') return handleReport(request, env);
    if (pathname === '/releases.json') {
      const key = new Request(`${new URL(request.url).origin}/releases.json?v=${env.CF_VERSION_METADATA.id}`);
      const cached = await caches.default.match(key);
      if (cached) return cached;
      const { notes, complete } = await releaseNotes(env, new URL(request.url).origin);
      const res = new Response(JSON.stringify(notes), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': complete ? `public, max-age=${MAX_AGE}` : 'no-store',
        },
      });
      if (complete) ctx.waitUntil(caches.default.put(key, res.clone()));
      return res;
    }
    if (pathname === '/rate') return handleRate(request, env, ctx);
    if (pathname === '/ratings.json') return todaysRatings(request, env, ctx);
    if (pathname === '/stats.json') return stats(request, env, ctx);
    if (pathname !== '/lunch.json') return env.ASSETS.fetch(request);
    return lunchResponse(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
