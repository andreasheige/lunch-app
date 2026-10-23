// The site build (npm run build): groups the news by pull request and fetches today's menus, has Astro write the
// pages (with the menus and news in the HTML, see src/site/snapshot.ts and news.ts) and public/ to dist/, then adds
// the data files the Worker serves.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { addDiets } from '../src/server/diet.ts';
import { getTodaysLunch, type MenuFailure, parseCaptured } from '../src/server/lunch.ts';
import {
  GIT_LOG_FORMAT,
  groupReleases,
  PR_QUERY,
  parseCommitLog,
  parsePullRequests,
  parseReleaseText,
  toPosts,
} from '../src/server/releases.ts';
import type { ReleasePost, ReleaseText } from '../src/shared/types.ts';

const root = path.join(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

// Release source for the Worker's /releases.json: feat/fix commits (CI checks out full history for this) grouped
// by the pull request they came from. Without GitHub (no gh, no token, offline) every commit stands alone.
const git = (args: string[]) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  } catch {
    return '';
  }
};
const prs = (() => {
  try {
    const answer = execFileSync(
      'gh',
      ['api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', 'owner=andreasheige', '-f', 'name=lunch-app'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return parsePullRequests(JSON.parse(answer));
  } catch {
    return [];
  }
})();
const releases = groupReleases(parseCommitLog(git(['log', '-n', '300', `--format=${GIT_LOG_FORMAT}`])), prs);

// The Swedish texts the live site has written so far, for the news pages' HTML (news.js fills in newer ones).
const written = new Map<string, ReleaseText>();
try {
  const res = await fetch('https://lunchit.se/releases.json?lang=sv', { signal: AbortSignal.timeout(10_000) });
  for (const post of res.ok ? ((await res.json()) as ReleasePost[]) : []) {
    const text = !post.pending && parseReleaseText(post);
    if (text) written.set(post.key, text);
  }
} catch {}
const newsSnapshot = path.join(root, '.astro', 'news-snapshot.json');
await fs.mkdir(path.dirname(newsSnapshot), { recursive: true });
await fs.writeFile(newsSnapshot, JSON.stringify(toPosts(releases, written)));
process.stdout.write(`News: ${releases.length} releases from ${prs.length} pull requests, ${written.size} written\n`);

// Label-based diets only; the Worker adds Workers AI guesses for the rest.
const captured = await fs.readFile(path.join(root, 'captured.json'), 'utf8').catch(() => null);
const failures: MenuFailure[] = [];
const data = addDiets(await getTodaysLunch(parseCaptured(captured), new Date(), (f) => failures.push(f)), {});
// What each failed read got back, for CI's issue reports; outside dist/ so it is never served.
await fs.writeFile(path.join(root, 'build-failures.json'), JSON.stringify(failures));

// Astro empties dist/ and writes the pages; the snapshot puts today's menus in the home page's HTML.
const snapshot = path.join(root, '.astro', 'lunch-snapshot.json');
await fs.mkdir(path.dirname(snapshot), { recursive: true });
await fs.writeFile(snapshot, JSON.stringify(data));
execFileSync('npx', ['astro', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, LUNCH_SNAPSHOT: snapshot, NEWS_SNAPSHOT: newsSnapshot },
});

// Shipped as an asset so the Worker's live /lunch.json can use it too.
if (captured !== null) await fs.writeFile(path.join(dist, 'captured.json'), captured);

// The releases for the Worker's /releases.json, which writes their texts.
await fs.writeFile(path.join(dist, 'releases-source.json'), JSON.stringify(releases));

await fs.writeFile(path.join(dist, 'lunch.json'), JSON.stringify(data));

for (const r of data.restaurants) {
  process.stdout.write(`${r.name}: ${r.error ?? (r.embed ? 'embed' : `${r.dishes.length} rätter`)}\n`);
}
