import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { addDiets } from './src/server/diet.ts';
import { getTodaysLunch, parseCaptured } from './src/server/lunch.ts';

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

  const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
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
