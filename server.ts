import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { addDiets } from './src/server/diet.ts';
import { getTodaysLunch, parseCaptured } from './src/server/lunch.ts';
import { GIT_LOG_FORMAT, parseCommitLog, toNotes } from './src/server/releases.ts';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
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

  // Commit subjects only: the Swedish texts come from Workers AI + D1, which need the Worker (wrangler dev).
  if (pathname === '/releases.json') {
    const log = execFileSync('git', ['log', '-n', '200', `--format=${GIT_LOG_FORMAT}`], { encoding: 'utf8' });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(toNotes(parseCommitLog(log), new Map())));
  }

  // Extensionless page URLs (/nyheter) map to their .html file, as Cloudflare's asset handling does.
  const page = pathname === '/' ? 'index.html' : path.extname(pathname) ? pathname : `${pathname}.html`;
  const file = path.join(PUBLIC_DIR, page);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
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

server.listen(PORT, () => process.stdout.write(`Lunch app on http://localhost:${PORT}\n`));
