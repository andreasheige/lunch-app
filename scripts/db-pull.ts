// Copies the live D1 data into the local database `npm run dev` uses (npm run db:pull), so ratings, stats and history
// show real data locally. Needs `wrangler login` with access to the account. report_contacts is left out on purpose:
// it holds reporters' names and email addresses, which stay in production.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const TABLES = ['menu_days', 'ratings', 'release_posts', 'release_notes', 'release_notes_en'];
const exported = path.join(root, '.wrangler', 'db-pull.sql');
const local = path.join(root, '.wrangler', 'db-pull-local.sql');

const wrangler = (args: string[]) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });

wrangler(['d1', 'migrations', 'apply', 'lunch-app', '--local']);
await fs.mkdir(path.dirname(exported), { recursive: true });
wrangler([
  'd1',
  'export',
  'lunch-app',
  '--remote',
  '--no-schema',
  `--output=${exported}`,
  ...TABLES.flatMap((t) => ['--table', t]),
]);
// Replace, not add to, what the local tables hold.
const data = await fs.readFile(exported, 'utf8');
await fs.writeFile(local, `${TABLES.map((t) => `DELETE FROM ${t};`).join('\n')}\n${data}`);
wrangler(['d1', 'execute', 'lunch-app', '--local', '--yes', `--file=${local}`]);
await Promise.all([fs.rm(exported), fs.rm(local)]);
process.stdout.write(`Pulled ${TABLES.join(', ')} into the local D1.\n`);
