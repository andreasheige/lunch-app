// Builds the static site for GitHub Pages: public/ plus a freshly fetched lunch.json in dist/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { addDiets } from '../src/server/diet.ts';
import { getTodaysLunch, parseCaptured } from '../src/server/lunch.ts';
import { GIT_LOG_FORMAT, parseCommitLog } from '../src/server/releases.ts';

const root = path.join(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await fs.rm(dist, { recursive: true, force: true });
await fs.cp(path.join(root, 'public'), dist, { recursive: true });

// Shipped as an asset so the Worker's live /lunch.json can use it too.
const captured = await fs.readFile(path.join(root, 'captured.json'), 'utf8').catch(() => null);
if (captured !== null) await fs.writeFile(path.join(dist, 'captured.json'), captured);

// Label-based diets only; the Worker adds Workers AI guesses for the rest.
// Release-note source for the Worker's /releases.json (CI checks out full history for this).
const log = (() => {
  try {
    return execFileSync('git', ['log', '-n', '200', `--format=${GIT_LOG_FORMAT}`], { cwd: root, encoding: 'utf8' });
  } catch {
    return '';
  }
})();
await fs.writeFile(path.join(dist, 'commits.json'), JSON.stringify(parseCommitLog(log)));

const data = addDiets(await getTodaysLunch(parseCaptured(captured)), {});
await fs.writeFile(path.join(dist, 'lunch.json'), JSON.stringify(data));

for (const r of data.restaurants) {
  process.stdout.write(`${r.name}: ${r.error ?? (r.embed ? 'embed' : `${r.dishes.length} rätter`)}\n`);
}
