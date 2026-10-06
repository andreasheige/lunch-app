// Builds the static site for GitHub Pages: public/ plus a freshly fetched lunch.json in dist/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { addDiets } from '../src/server/diet.ts';
import { getTodaysLunch, parseCaptured } from '../src/server/lunch.ts';

const root = path.join(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await fs.rm(dist, { recursive: true, force: true });
await fs.cp(path.join(root, 'public'), dist, { recursive: true });

// Shipped as an asset so the Worker's live /lunch.json can use it too.
const captured = await fs.readFile(path.join(root, 'captured.json'), 'utf8').catch(() => null);
if (captured !== null) await fs.writeFile(path.join(dist, 'captured.json'), captured);

// Label-based diets only; the Worker adds Workers AI guesses for the rest.
const data = addDiets(await getTodaysLunch(parseCaptured(captured)), {});
await fs.writeFile(path.join(dist, 'lunch.json'), JSON.stringify(data));

for (const r of data.restaurants) {
  process.stdout.write(`${r.name}: ${r.error ?? (r.embed ? 'embed' : `${r.dishes.length} rätter`)}\n`);
}
