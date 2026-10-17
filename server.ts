import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { addDiets } from './src/server/diet.ts';
import { getTodaysLunch, parseCaptured } from './src/server/lunch.ts';
import { GIT_LOG_FORMAT, groupReleases, parseCommitLog, toPosts } from './src/server/releases.ts';
import type { HistoryResponse, StatsResponse, TodaysRatings, YesterdayResponse } from './src/shared/types.ts';

const PORT = Number(process.env.PORT) || 3000;
// The pages as `astro build` wrote them (npm start builds first); lunch.json and releases.json are live below.
const DIST_DIR = path.join(import.meta.dirname, 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  if (pathname === '/lunch.json') {
    const captured = await fs.readFile(path.join(import.meta.dirname, 'captured.json'), 'utf8').catch(() => null);
    // Label-based diets only; Workers AI guesses need the Worker (wrangler dev).
    const data = addDiets(await getTodaysLunch(parseCaptured(captured)), {});
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(data));
  }

  // Commit subjects only, one release per commit: PR grouping needs GitHub (npm run build) and the texts come from
  // Workers AI + D1, which need the Worker (wrangler dev).
  if (pathname === '/releases.json') {
    const log = execFileSync('git', ['log', '-n', '300', `--format=${GIT_LOG_FORMAT}`], { encoding: 'utf8' });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(toPosts(groupReleases(parseCommitLog(log), []), new Map())));
  }

  // Ratings, stats, history and translations live in D1 / Workers AI, which only the Worker has (wrangler dev).
  // Here they answer empty, so every page loads and shows its empty state instead of failing requests.
  const empty = emptyAnswer(pathname);
  if (empty !== undefined) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(empty));
  }
  if (pathname === '/rate') {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Betyg kräver wrangler dev (D1).' }));
  }

  // Extensionless page URLs (/news) map to their .html file, as Cloudflare's asset handling does.
  const page = pathname === '/' ? 'index.html' : path.extname(pathname) ? pathname : `${pathname}.html`;
  const file = path.join(DIST_DIR, page);
  if (!file.startsWith(DIST_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

function emptyAnswer(pathname: string): unknown {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date());
  switch (pathname) {
    case '/ratings.json':
    case '/translations.json':
      return {} satisfies TodaysRatings;
    case '/yesterday.json':
      return { date: null, places: [], ratings: {}, translations: {} } satisfies YesterdayResponse;
    case '/history.json':
      return { since: null, days: 0, week: null, top: [], recurring: [] } satisfies HistoryResponse;
    case '/stats.json':
      return {
        range: '14',
        from: today,
        to: today,
        totals: { votes: 0, voters: 0, dishes: 0, avg: null },
        restaurants: [],
        dishes: [],
        days: [],
        divisive: null,
        placeDays: [],
        stars: [],
        rated: [],
        menuDays: [],
      } satisfies StatsResponse;
    default:
      return undefined;
  }
}

server.listen(PORT, () => process.stdout.write(`Lunch app on http://localhost:${PORT}\n`));
