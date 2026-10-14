// Release notes as a changelog: feat/fix commits from git log, grouped into one release per pull request (build.ts
// asks GitHub which PR each commit came from), written up as a short post per language by Workers AI in worker.ts
// and kept in D1. Pure helpers here; the I/O lives in build.ts/worker.ts.
import type {
  ChangeKind,
  PullRequest,
  ReleaseChange,
  ReleaseCommit,
  ReleasePost,
  ReleaseSource,
  ReleaseText,
} from '../shared/types.ts';

// `git log --format=…` output: one record per commit, fields split by \x1f.
export const GIT_LOG_FORMAT = '%H%x1f%cI%x1f%aI%x1f%s%x1f%b%x1e';

export function parseCommitLog(log: string): ReleaseCommit[] {
  return log
    .split('\x1e')
    .map((record) => record.trim().split('\x1f'))
    .flatMap(([sha = '', date = '', authored = '', headline = '', body = '']) => {
      const m = headline.match(/^(feat|fix)(?:\([^)]*\))?!?: (.+)$/);
      if (!sha || !m) return [];
      const issue = headline.match(/\(#(\d+)\)|closes #(\d+)/i);
      return [
        {
          sha,
          date,
          authored,
          headline,
          type: m[1] === 'feat' ? 'feat' : 'fix',
          subject: m[2] ?? '',
          body: body
            .split('\n')
            .filter((l) => !/^Co-Authored-By:/i.test(l))
            .join('\n')
            .trim(),
          issue: issue ? Number(issue[1] ?? issue[2]) : null,
        },
      ];
    });
}

// The last 100 merged PRs with their commits, for `gh api graphql`.
export const PR_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, last: 100) {
      nodes { number title body mergeCommit { oid } commits(first: 100) { nodes { commit { messageHeadline authoredDate } } } }
    }
  }
}`;

// The GraphQL answer → PullRequest[]; anything unexpected gives [] (every commit then stands alone).
export function parsePullRequests(answer: unknown): PullRequest[] {
  type Node = {
    number: number;
    title: string;
    body: string | null;
    mergeCommit: { oid: string } | null;
    commits: { nodes: { commit: { messageHeadline: string; authoredDate: string } }[] };
  };
  const nodes = (answer as { data?: { repository?: { pullRequests?: { nodes?: Node[] } } } })?.data?.repository
    ?.pullRequests?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n) => ({
    number: n.number,
    title: n.title,
    body: n.body ?? '',
    mergeCommit: n.mergeCommit?.oid ?? null,
    commits: n.commits.nodes.map(({ commit }) => ({ headline: commit.messageHeadline, authored: commit.authoredDate })),
  }));
}

// A PR description without the test plan and tool footers, which say nothing to lunch guests.
export const cleanBody = (body: string): string =>
  body
    .split(/^##\s*Test plan/im)[0]
    ?.split('\n')
    .filter((l) => !/Generated with|^Co-Authored-By:/i.test(l))
    .join('\n')
    .trim()
    .slice(0, 1500) ?? '';

// "feat: English version (#22)", "Feat/lunchit icon" → "English version", "lunchit icon".
export const cleanTitle = (title: string): string =>
  title
    .replace(/^(feat|fix|chore|refactor|ci)(\([^)]*\))?!?[:/]\s*/i, '')
    .replace(/\s*\((#\d+|closes #\d+)\)\s*$/i, '')
    .trim();

const FOLD: Record<string, string> = { å: 'a', ä: 'a', ö: 'o', é: 'e', ü: 'u' };

// "2026-10-14" + "A new Lunchit: its own look" → "2026-10-14-a-new-lunchit-its-own"; at most six words.
export function slugFor(date: string, title: string): string {
  const words = cleanTitle(title)
    .toLowerCase()
    .replace(/[åäöéü]/g, (c) => FOLD[c] ?? c)
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 6);
  return [date.slice(0, 10), ...words].join('-');
}

// Commits (newest first, as git log gives them) → releases, newest first. A commit belongs to the PR whose merge
// commit it is, or whose commits include its headline and author time (a rebase merge gives it a new sha).
export function groupReleases(commits: ReleaseCommit[], prs: PullRequest[]): ReleaseSource[] {
  const prOf = (c: ReleaseCommit) =>
    prs.find(
      (pr) =>
        pr.mergeCommit === c.sha ||
        pr.commits.some((pc) => pc.headline === c.headline && Date.parse(pc.authored) === Date.parse(c.authored)),
    );
  const releases: ReleaseSource[] = [];
  const byPr = new Map<number, ReleaseSource>();
  const slugs = new Set<string>();
  for (const c of commits) {
    const pr = prOf(c);
    const commit = { type: c.type, subject: c.subject, body: c.body };
    const existing = pr && byPr.get(pr.number);
    if (existing) {
      existing.commits.push(commit);
      continue;
    }
    const title = pr ? cleanTitle(pr.title) : c.subject;
    let slug = slugFor(c.date, title);
    for (let n = 2; slugs.has(slug); n++) slug = `${slugFor(c.date, title)}-${n}`;
    slugs.add(slug);
    const release: ReleaseSource = {
      key: pr ? `pr-${pr.number}` : c.sha,
      slug,
      date: c.date,
      pr: pr?.number ?? null,
      title,
      body: pr ? cleanBody(pr.body) : '',
      commits: [commit],
    };
    if (pr) byPr.set(pr.number, release);
    releases.push(release);
  }
  return releases;
}

// What the model reads about a release.
export function releaseInput(r: ReleaseSource): string {
  const commits = r.commits.map((c) => `- ${c.type}: ${c.subject}${c.body ? `\n  ${c.body.slice(0, 400)}` : ''}`);
  return [`Titel: ${r.title}`, r.body && `Beskrivning:\n${r.body}`, `Commits:\n${commits.join('\n')}`]
    .filter(Boolean)
    .join('\n\n');
}

export const RELEASE_PROMPT = `Du skriver nyhetsinlägg för Lunchit, en sajt som visar dagens lunchmenyer för restauranger
i centrala Göteborg. Läsarna är lunchgäster, inte utvecklare. Användaren skickar en release: en titel, ibland en
beskrivning, och ändringarna i koden. Skriv ett inlägg på svenska. Svara med JSON:
{"title": "rubrik, högst 10 ord", "summary": "en mening till listan med alla nyheter",
"intro": ["1–2 korta stycken om vad som är nytt för den som använder sajten"],
"changes": [{"kind": "new" | "improved" | "fixed", "title": "högst 6 ord", "text": "en mening"}]}
En ändring per sak som användaren märker, högst 8: slå ihop ändringar som hör ihop och hoppa över sådant användaren
inte märker (kod, verktyg, tester). "new" är något som inte fanns förut, "improved" något som fanns men blivit bättre,
"fixed" ett fel som rättats. Skriv bara om det som står i ändringarna, hitta inte på något. Inga tekniska termer,
filnamn eller kodord.`;

export const RELEASE_PROMPT_EN = `You write news posts for Lunchit, a site that shows today's lunch menus for restaurants
in central Gothenburg. The readers are lunch guests, not developers. The user sends a release: a title, sometimes a
description, and the changes in the code. Write a post in English. Reply with JSON:
{"title": "headline, at most 10 words", "summary": "one sentence for the list of all news",
"intro": ["1–2 short paragraphs about what is new for people using the site"],
"changes": [{"kind": "new" | "improved" | "fixed", "title": "at most 6 words", "text": "one sentence"}]}
One change per thing a user notices, at most 8: merge changes that belong together and leave out what users don't
notice (code, tooling, tests). "new" is something that wasn't there before, "improved" something that was and got
better, "fixed" a bug that was fixed. Only write about what the changes say; make nothing up. No technical terms, file
names or code words. The site's own Swedish names are
English here: "Välj åt mig" is "Pick for me", "Nyheter" is "News", "Statistik" is "Stats".`;

export type NoteLang = 'sv' | 'en';

export const RELEASE_PROMPTS: Record<NoteLang, string> = { sv: RELEASE_PROMPT, en: RELEASE_PROMPT_EN };

export const noteLang = (value: string | null): NoteLang => (value === 'en' ? 'en' : 'sv');

const KINDS: ChangeKind[] = ['new', 'improved', 'fixed'];
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// The model's answer (JSON text, or already parsed) → ReleaseText; null unless it has a title, a summary and at
// least one valid change. Lengths are capped and the pages render them as text, so a steered model can't put markup
// on the page.
export function parseReleaseText(answer: unknown): ReleaseText | null {
  try {
    const data: unknown = typeof answer === 'string' ? JSON.parse(answer) : answer;
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;
    const intro = (Array.isArray(d.intro) ? d.intro : [d.intro])
      .map((p) => text(p, 600))
      .filter(Boolean)
      .slice(0, 3);
    const changes: ReleaseChange[] = (Array.isArray(d.changes) ? d.changes : [])
      .map((c: Record<string, unknown>) => ({
        kind: c?.kind as ChangeKind,
        title: text(c?.title, 80),
        text: text(c?.text, 300),
      }))
      .filter((c) => KINDS.includes(c.kind) && c.title)
      .slice(0, 12);
    const title = text(d.title, 120);
    const summary = text(d.summary, 300);
    if (!title || !summary || !changes.length) return null;
    return { title, summary, intro, changes };
  } catch {
    return null;
  }
}

// Until the model has written one: the PR's title and a change per commit.
export function fallbackText(r: ReleaseSource): ReleaseText {
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    title: capital(r.title),
    summary: '',
    intro: [],
    changes: r.commits.map((c) => ({
      kind: c.type === 'fix' ? 'fixed' : 'new',
      title: capital(cleanTitle(c.subject)),
      text: '',
    })),
  };
}

// Releases with their text in one language where one exists; the rest fall back for now.
export function toPosts(releases: ReleaseSource[], texts: Map<string, ReleaseText>): ReleasePost[] {
  return releases.map((r) => {
    const written = texts.get(r.key);
    const t = written ?? fallbackText(r);
    return {
      key: r.key,
      slug: r.slug,
      date: r.date,
      pr: r.pr,
      ...t,
      kinds: KINDS.filter((k) => t.changes.some((c) => c.kind === k)),
      pending: !written,
    };
  });
}
