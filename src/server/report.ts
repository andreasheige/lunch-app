// POST /report: turns the in-page bug/feature form into a GitHub issue, so reporters need no GitHub account.
import type { ReportKind, ReportResponse } from '../shared/types.ts';

const REPO = 'andreasheige/lunch-app';
const KINDS: Record<ReportKind, string> = { bug: 'Fel', 'feat-req': 'Önskemål' };
const MAX_BODY_CHARS = 16 * 1024;
const MAX_TITLE = 120;
const MAX_TEXT = 4000;
const MAX_NAME = 80;
const MAX_EMAIL = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bindings handleReport needs; typed structurally so tests can run it outside workerd.
export interface ReportEnv {
  REPORT_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  TURNSTILE_SECRET: string;
  GITHUB_TOKEN: string;
  DB: { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } } };
}

/** Someone who ticked "mejla mig när det är klart"; stored in D1, never on GitHub. */
export interface Contact {
  name: string;
  email: string;
}

interface Report {
  kind: ReportKind;
  title: string;
  text: string;
  token: string;
  contact: Contact | null;
}

export const githubHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'knowit-lunch-app',
});

const isKind = (kind: unknown): kind is ReportKind => typeof kind === 'string' && Object.hasOwn(KINDS, kind);

const json = (status: number, data: ReportResponse): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

// User text goes in a code fence longer than any backtick run inside it, so @mentions, links and images stay inert.
export function issueBody(text: string, host: string, notify = false): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const bell = notify ? '\n\n🔔 Den som skickade in ärendet vill ha ett mejl när det stängs.' : '';
  return `${fence}text\n${text}\n${fence}\n\n_Skickat via formuläret på ${host}._${bell}`;
}

// Trimmed string fields from the form; null when a required one is missing or too long, or when the
// reporter asked for an email (the "notify" checkbox) without a valid address.
export function parseReport(input: unknown): Report | null {
  const fields: Record<string, unknown> = typeof input === 'object' && input !== null ? { ...input } : {};
  const { kind } = fields;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const title = str(fields.title);
  const text = str(fields.text);
  const token = typeof fields.token === 'string' ? fields.token : '';
  if (!isKind(kind) || !title || title.length > MAX_TITLE || !text || text.length > MAX_TEXT || !token) return null;
  const notify = fields.notify === 'on' || fields.notify === true;
  const email = str(fields.email);
  const name = str(fields.name).slice(0, MAX_NAME);
  if (notify && (!EMAIL.test(email) || email.length > MAX_EMAIL)) return null;
  return { kind, title, text, token, contact: notify ? { name, email } : null };
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  });
  const outcome: unknown = await res.json();
  return typeof outcome === 'object' && outcome !== null && 'success' in outcome && outcome.success === true;
}

async function createIssue(
  githubToken: string,
  { kind, title, text, contact }: Report,
  host: string,
): Promise<{ url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: githubHeaders(githubToken),
    body: JSON.stringify({
      title: `${KINDS[kind]}: ${title}`,
      body: issueBody(text, host, contact !== null),
      labels: [kind],
    }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const issue: unknown = await res.json();
  if (
    typeof issue !== 'object' ||
    issue === null ||
    !('html_url' in issue) ||
    typeof issue.html_url !== 'string' ||
    !('number' in issue) ||
    typeof issue.number !== 'number'
  )
    throw new Error('GitHub: no html_url/number in response');
  return { url: issue.html_url, number: issue.number };
}

export async function handleReport(request: Request, env: ReportEnv): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Använd POST.' });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json(403, { error: 'Fel ursprung.' });

  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const { success: withinLimit } = await env.REPORT_LIMITER.limit({ key: ip });
  if (!withinLimit) return json(429, { error: 'För många rapporter. Vänta en minut och försök igen.' });

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json(413, { error: 'För lång text.' });
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Ogiltig förfrågan.' });
  }
  // Honeypot: a hidden field only bots fill in. Pretend success so they don't retry.
  if (typeof input === 'object' && input !== null && 'website' in input && input.website)
    return json(200, { ok: true });

  const report = parseReport(input);
  if (!report)
    return json(400, {
      error: `Fyll i rubrik (max ${MAX_TITLE} tecken) och beskrivning (max ${MAX_TEXT} tecken), och en giltig e-postadress om du vill ha besked.`,
    });
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, report.token, ip))) {
    return json(403, { error: 'Verifieringen misslyckades. Ladda om sidan och försök igen.' });
  }

  try {
    const issue = await createIssue(env.GITHUB_TOKEN, report, new URL(request.url).host);
    if (report.contact) {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO report_contacts (issue, kind, title, name, email) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(issue.number, report.kind, report.title, report.contact.name, report.contact.email)
        .run();
    }
    return json(201, { ok: true, url: issue.url });
  } catch (err) {
    // Surfaces in Workers Logs (observability is enabled in wrangler.jsonc).
    console.error('report: issue creation failed', err instanceof Error ? err.message : err);
    return json(502, { error: 'Kunde inte spara rapporten just nu. Försök igen senare.' });
  }
}
