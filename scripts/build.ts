// Builds the static site for GitHub Pages: public/ plus a freshly fetched lunch.json in dist/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTodaysLunch } from '../src/server/lunch.ts';

const root = path.join(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await fs.rm(dist, { recursive: true, force: true });
await fs.cp(path.join(root, 'public'), dist, { recursive: true });

const data = await getTodaysLunch();
await fs.writeFile(path.join(dist, 'lunch.json'), JSON.stringify(data));

for (const r of data.restaurants) {
  process.stdout.write(`${r.name}: ${r.error ?? (r.embed ? 'embed' : `${r.dishes.length} rätter`)}\n`);
}
