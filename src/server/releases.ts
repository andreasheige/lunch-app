// Release notes: feat/fix commits from git log (written to dist/commits.json at build), turned into short
// Swedish posts by Workers AI in worker.ts and kept in D1. Pure helpers here; the I/O lives in build.ts/worker.ts.
import type { ReleaseCommit, ReleaseNote } from '../shared/types.ts';

// `git log --format=%H%x1f%cI%x1f%s%x1f%b%x1e` output: one record per commit, fields split by \x1f.
export const GIT_LOG_FORMAT = '%H%x1f%cI%x1f%s%x1f%b%x1e';

export function parseCommitLog(log: string): ReleaseCommit[] {
  return log
    .split('\x1e')
    .map((record) => record.trim().split('\x1f'))
    .flatMap(([sha = '', date = '', subject = '', body = '']) => {
      const m = subject.match(/^(feat|fix)(?:\([^)]*\))?!?: (.+)$/);
      if (!sha || !m) return [];
      const issue = subject.match(/\(#(\d+)\)|closes #(\d+)/i);
      return [
        {
          sha,
          date,
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

export const RELEASE_PROMPT = `Du skriver releasenoteringar för en lunchsajt som visar dagens lunchmenyer nära ett kontor
i Göteborg. Användarna är kollegor, inte utvecklare. Användaren skickar ett commit-meddelande. Skriv en kort, vänlig
nyhet på svenska: en rubrik (högst 8 ord) och en brödtext på 1–3 meningar om vad som är nytt eller fixat för den som
använder sajten. Inga tekniska termer, filnamn eller kodord. Svara med JSON {"title": "...", "body": "..."}.`;

// The model's {"title", "body"} answer (JSON text, or already parsed); null unless both are non-empty strings.
// Lengths are capped and the page renders them as text, so a steered model can't put markup on the page.
export function parseNote(answer: unknown): { title: string; body: string } | null {
  try {
    const data: unknown = typeof answer === 'string' ? JSON.parse(answer) : answer;
    if (typeof data !== 'object' || data === null || !('title' in data) || !('body' in data)) return null;
    const { title, body } = data;
    if (typeof title !== 'string' || typeof body !== 'string' || !title.trim() || !body.trim()) return null;
    return { title: title.trim().slice(0, 120), body: body.trim().slice(0, 600) };
  } catch {
    return null;
  }
}

// Commits with their Swedish text where one exists; the rest fall back to the commit subject for now.
export function toNotes(commits: ReleaseCommit[], texts: Map<string, { title: string; body: string }>): ReleaseNote[] {
  return commits.map((c) => {
    const text = texts.get(c.sha);
    return {
      sha: c.sha,
      date: c.date,
      type: c.type,
      issue: c.issue,
      title: text?.title ?? c.subject,
      body: text?.body ?? '',
      pending: !text,
    };
  });
}
