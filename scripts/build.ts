// The site build (npm run build): fetches today's menus, has Astro write the pages (with those menus in the
// HTML, see src/site/snapshot.ts) and public/ to dist/, then adds the data files the Worker serves.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { addDiets } from '../src/server/diet.ts';
import { getTodaysLunch, parseCaptured } from '../src/server/lunch.ts';
import { GIT_LOG_FORMAT, parseCommitLog } from '../src/server/releases.ts';

const root = path.join(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

// Label-based diets only; the Worker adds Workers AI guesses for the rest.
const captured = await fs.readFile(path.join(root, 'captured.json'), 'utf8').catch(() => null);
const data = addDiets(await getTodaysLunch(parseCaptured(captured)), {});

// Astro empties dist/ and writes the pages; the snapshot puts today's menus in the home page's HTML.
const snapshot = path.join(root, '.astro', 'lunch-snapshot.json');
await fs.mkdir(path.dirname(snapshot), { recursive: true });
await fs.writeFile(snapshot, JSON.stringify(data));
execFileSync('npx', ['astro', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, LUNCH_SNAPSHOT: snapshot },
});

// Shipped as an asset so the Worker's live /lunch.json can use it too.
if (captured !== null) await fs.writeFile(path.join(dist, 'captured.json'), captured);

// Release-note source for the Worker's /releases.json (CI checks out full history for this).
const log = (() => {
  try {
    return execFileSync('git', ['log', '-n', '200', `--format=${GIT_LOG_FORMAT}`], { cwd: root, encoding: 'utf8' });
  } catch {
    return '';
  }
})();
await fs.writeFile(path.join(dist, 'commits.json'), JSON.stringify(parseCommitLog(log)));

await fs.writeFile(path.join(dist, 'lunch.json'), JSON.stringify(data));

for (const r of data.restaurants) {
  process.stdout.write(`${r.name}: ${r.error ?? (r.embed ? 'embed' : `${r.dishes.length} rätter`)}\n`);
}
