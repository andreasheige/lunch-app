// POST /report: turns the in-page bug/feature form into a GitHub issue, so reporters need no GitHub account.
import type { ReportKind, ReportResponse } from '../shared/types.ts';

const REPO = 'andreasheige/lunch-app';
const KINDS: Record<ReportKind, string> = { bug: 'Fel', 'feat-req': 'Önskemål' };
const MAX_BODY_CHARS = 16 * 1024;
const MAX_TITLE = 120;
const MAX_TEXT = 4000;

// Bindings handleReport needs; typed structurally so tests can run it outside workerd.
export interface ReportEnv {
  REPORT_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  TURNSTILE_SECRET: string;
  GITHUB_TOKEN: string;
}

interface Report {
  kind: ReportKind;
  title: string;
  text: string;
  token: string;
}

const isKind = (kind: unknown): kind is ReportKind => typeof kind === 'string' && Object.hasOwn(KINDS, kind);

const json = (status: number, data: ReportResponse): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

// User text goes in a code fence longer than any backtick run inside it, so @mentions, links and images stay inert.
export function issueBody(text: string, host: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}\n\n_Skickat via formuläret på ${host}._`;
}

// Trimmed string fields from the form; null when a required one is missing or too long.
export function parseReport(input: unknown): Report | null {
  const fields: Record<string, unknown> = typeof input === 'object' && input !== null ? { ...input } : {};
  const { kind } = fields;
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  const text = typeof fields.text === 'string' ? fields.text.trim() : '';
  const token = typeof fields.token === 'string' ? fields.token : '';
  if (!isKind(kind) || !title || title.length > MAX_TITLE || !text || text.length > MAX_TEXT || !token) return null;
  return { kind, title, text, token };
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  });
  const outcome: unknown = await res.json();
  return typeof outcome === 'object' && outcome !== null && 'success' in outcome && outcome.success === true;
}

async function createIssue(githubToken: string, { kind, title, text }: Report, host: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'knowit-lunch-app',
    },
    body: JSON.stringify({ title: `${KINDS[kind]}: ${title}`, body: issueBody(text, host), labels: [kind] }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const issue: unknown = await res.json();
  if (typeof issue !== 'object' || issue === null || !('html_url' in issue) || typeof issue.html_url !== 'string')
    throw new Error('GitHub: no html_url in response');
  return issue.html_url;
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
    return json(400, { error: `Fyll i rubrik (max ${MAX_TITLE} tecken) och beskrivning (max ${MAX_TEXT} tecken).` });
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, report.token, ip))) {
    return json(403, { error: 'Verifieringen misslyckades. Ladda om sidan och försök igen.' });
  }

  try {
    return json(201, { ok: true, url: await createIssue(env.GITHUB_TOKEN, report, new URL(request.url).host) });
  } catch (err) {
    // Surfaces in Workers Logs (observability is enabled in wrangler.jsonc).
    console.error('report: issue creation failed', err instanceof Error ? err.message : err);
    return json(502, { error: 'Kunde inte spara rapporten just nu. Försök igen senare.' });
  }
}
