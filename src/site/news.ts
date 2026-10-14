// The news posts as scripts/build.ts put them together (releases grouped by pull request, with the Swedish texts
// the live site has written so far), so /news and each /news/<slug> carry their post in the HTML; news.js then
// redraws from the live /releases.json in English, or once a post's text is written. Without a snapshot (plain
// `astro build`, as `npm start` does) each commit in git log is its own post, with its commit subject.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { GIT_LOG_FORMAT, groupReleases, parseCommitLog, toPosts } from '../server/releases.ts';
import type { ReleasePost } from '../shared/types.ts';

let posts: ReleasePost[] | undefined;

export function newsPosts(): ReleasePost[] {
  if (posts) return posts;
  const file = process.env.NEWS_SNAPSHOT;
  if (file) {
    posts = JSON.parse(readFileSync(file, 'utf8')) as ReleasePost[];
  } else {
    let log = '';
    try {
      log = execFileSync('git', ['log', '-n', '300', `--format=${GIT_LOG_FORMAT}`], { encoding: 'utf8' });
    } catch {}
    posts = toPosts(groupReleases(parseCommitLog(log), []), new Map());
  }
  return posts;
}

// Swedish texts for the HTML; news.js redraws in English from i18n.js.
export const KIND_SV = { new: 'Nytt', improved: 'Förbättrat', fixed: 'Fixat' } as const;
const COUNT_SV = { new: 'nya', improved: 'förbättrade', fixed: 'fixade' } as const;
const DATE = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});
const MONTH = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' });

export const dateSv = (iso: string): string => DATE.format(new Date(iso));

// Posts by month, newest first: [["oktober 2026", posts], …].
export function byMonth(list: ReleasePost[]): [string, ReleasePost[]][] {
  const months = new Map<string, ReleasePost[]>();
  for (const post of list) {
    const m = MONTH.format(new Date(post.date));
    months.set(m, [...(months.get(m) ?? []), post]);
  }
  return [...months];
}

// "5 nya · 3 förbättrade"
export const countsSv = (post: ReleasePost): string =>
  post.kinds.map((k) => `${post.changes.filter((c) => c.kind === k).length} ${COUNT_SV[k]}`).join(' · ');

// The line under a title in the list: the summary, or while it's pending, what changed.
export const summaryOf = (post: ReleasePost): string => post.summary || post.changes.map((c) => c.title).join(', ');
