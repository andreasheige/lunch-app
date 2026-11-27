// Picadeli salads visitors suggest: POST /salad saves one as pending in D1 `salads` and opens a GitHub issue; the
// cron (worker.ts approveSalads) approves it when the issue is closed as completed and deletes it when closed as
// not planned. Approved salads are the dishes of the `userDishes` place in /lunch.json. Nothing about the sender
// is stored.
import type { Dish, ReportResponse } from '../shared/types.ts';
import { githubHeaders, issueBody, REPO, type ReportEnv, verifyTurnstile } from './report.ts';

const MAX_BODY_CHARS = 4 * 1024;
export const MAX_NAME = 60;
export const MAX_INGREDIENTS = 12;
export const MAX_INGREDIENT = 60;
export const MAX_PRICE = 20;
/** Salads shown per day, best rated first. */
export const SHOWN = 8;

export interface Salad {
  name: string;
  ingredients: string[];
  price: string | null;
}

// A row of approved salads with the average of every vote they have had (null when unrated).
export interface SaladRow {
  name: string;
  /** JSON array of strings. */
  ingredients: string;
  price: string | null;
  created_at: string;
  avg: number | null;
}

// Control characters (newlines included) out, runs of whitespace to one space.
const clean = (s: string): string =>
  s
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// The form's fields; null when the name or an ingredient is missing or too long, or the token is missing.
export function parseSalad(input: unknown): (Salad & { token: string }) | null {
  const fields: Record<string, unknown> = typeof input === 'object' && input !== null ? { ...input } : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const name = clean(str(fields.name));
  const ingredients = str(fields.ingredients)
    .split(/\r?\n/)
    .map(clean)
    .map((l) => l.replace(/^[-*•·]\s*/, ''))
    .filter(Boolean);
  const price = clean(str(fields.price));
  const token = str(fields.token);
  if (name.length < 2 || name.length > MAX_NAME || !token) return null;
  if (!ingredients.length || ingredients.length > MAX_INGREDIENTS) return null;
  if (ingredients.some((l) => l.length > MAX_INGREDIENT) || price.length > MAX_PRICE) return null;
  return { name, ingredients, price: price || null, token };
}

export function saladIssue(salad: Salad, host: string): { title: string; body: string; labels: string[] } {
  const text = [
    salad.name,
    '',
    ...salad.ingredients.map((l) => `* ${l}`),
    ...(salad.price ? ['', `Pris: ${salad.price}`] : []),
  ].join('\n');
  const how =
    '\n\nStäng som **completed** för att visa salladen på sajten, eller som **not planned** för att ta bort den.';
  return { title: `Sallad: ${salad.name}`, body: issueBody(text, host) + how, labels: ['salad'] };
}

/** What the cron does with a pending salad, from its issue (null: not found). */
export function saladDecision(
  issue: { state?: string; state_reason?: string | null } | null,
): 'approve' | 'delete' | null {
  if (!issue) return 'delete';
  if (issue.state !== 'closed') return null;
  return issue.state_reason === 'not_planned' ? 'delete' : 'approve';
}

// Approved salads as dishes: best rated first (unrated after rated), then newest, at most SHOWN.
export function saladDishes(rows: SaladRow[]): Dish[] {
  return [...rows]
    .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.created_at.localeCompare(a.created_at))
    .slice(0, SHOWN)
    .map((row) => {
      const parsed: unknown = JSON.parse(row.ingredients);
      const ingredients = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      return {
        category: 'Sallad',
        name: row.name,
        description: [ingredients.join(', '), row.price].filter(Boolean).join(' · '),
      };
    });
}

// The parts of D1 handleSalad uses; typed structurally so tests can run it outside workerd.
interface Statement {
  bind(...values: unknown[]): { run(): Promise<{ meta: { last_row_id: number } }> };
}
export interface SaladEnv extends Omit<ReportEnv, 'DB'> {
  DB: { prepare(sql: string): Statement };
}

const json = (status: number, data: ReportResponse): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function handleSalad(request: Request, env: SaladEnv): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Använd POST.' });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json(403, { error: 'Fel ursprung.' });

  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const { success: withinLimit } = await env.REPORT_LIMITER.limit({ key: ip });
  if (!withinLimit) return json(429, { error: 'För många förslag. Vänta en minut och försök igen.' });

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

  const salad = parseSalad(input);
  if (!salad)
    return json(400, {
      error: `Fyll i namn (2–${MAX_NAME} tecken) och 1–${MAX_INGREDIENTS} ingredienser, en per rad (max ${MAX_INGREDIENT} tecken var).`,
    });
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, salad.token, ip)))
    return json(403, { error: 'Verifieringen misslyckades. Ladda om sidan och försök igen.' });

  let id: number;
  try {
    const { meta } = await env.DB.prepare('INSERT INTO salads (name, ingredients, price) VALUES (?, ?, ?)')
      .bind(salad.name, JSON.stringify(salad.ingredients), salad.price)
      .run();
    id = meta.last_row_id;
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE'))
      return json(409, { error: 'Det finns redan en sallad med det namnet. Välj ett annat.' });
    console.error('salad: insert failed', err instanceof Error ? err.message : err);
    return json(502, { error: 'Kunde inte spara salladen just nu. Försök igen senare.' });
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: githubHeaders(env.GITHUB_TOKEN),
      body: JSON.stringify(saladIssue(salad, new URL(request.url).host)),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const issue: unknown = await res.json();
    if (typeof issue !== 'object' || issue === null || !('number' in issue) || typeof issue.number !== 'number')
      throw new Error('GitHub: no number in response');
    await env.DB.prepare('UPDATE salads SET issue = ? WHERE id = ?').bind(issue.number, id).run();
    return json(201, { ok: true });
  } catch (err) {
    // Without an issue nobody can approve it, so the row goes.
    console.error('salad: issue creation failed', err instanceof Error ? err.message : err);
    await env.DB.prepare('DELETE FROM salads WHERE id = ?').bind(id).run();
    return json(502, { error: 'Kunde inte spara salladen just nu. Försök igen senare.' });
  }
}

// What approveSalads needs of D1; typed structurally so tests can run it outside workerd.
export interface CronEnv {
  GITHUB_TOKEN: string;
  DB: {
    prepare(sql: string): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
      bind(...values: unknown[]): { run(): Promise<unknown> };
    };
  };
}

// Cron: approves pending salads whose issue was closed as completed, deletes those closed as not planned or gone,
// and those that never got an issue (the request failed half-way). Anything else is tried again next run.
export async function approveSalads(env: CronEnv, batch: number): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM salads WHERE status = 'pending' AND issue IS NULL AND created_at < datetime('now', '-1 day')",
  ).run();
  const { results } = await env.DB.prepare(
    `SELECT id, issue FROM salads WHERE status = 'pending' AND issue IS NOT NULL ORDER BY id LIMIT ${batch}`,
  ).all<{ id: number; issue: number }>();
  for (const row of results) {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${row.issue}`, {
        headers: githubHeaders(env.GITHUB_TOKEN),
      });
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        // A bad token or GitHub trouble; surfaces in Workers Logs.
        console.error('salads: GitHub', res.status, 'for issue', row.issue);
        continue;
      }
      const issue: unknown = res.ok ? await res.json() : null;
      // A body that isn't an object is no answer: tried again next run.
      if (res.ok && (typeof issue !== 'object' || issue === null)) continue;
      const decision = saladDecision(issue as { state?: string; state_reason?: string | null } | null);
      if (decision === 'approve')
        await env.DB.prepare("UPDATE salads SET status = 'approved' WHERE id = ?").bind(row.id).run();
      if (decision === 'delete') await env.DB.prepare('DELETE FROM salads WHERE id = ?').bind(row.id).run();
    } catch (err) {
      console.error('salads: check failed for issue', row.issue, err instanceof Error ? err.message : err);
    }
  }
}
