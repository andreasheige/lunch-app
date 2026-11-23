import { type Captured, isoWeek, stockholmDate } from './lunch.ts';
import { githubHeaders } from './report.ts';
import { RESTAURANTS } from './restaurants.ts';

// Poppels' menu is read only when the site is built (scripts/capture.ts), and GitHub starts the scheduled
// deploy hours late (16–17 UTC in November 2026), so a Monday kept last week's menu over lunch (#90).
// The Worker's cron therefore starts the deploy itself on weekday mornings while the captured menu names
// another week, at most once an hour, so a menu not yet published doesn't deploy every 15 minutes.
const WORKFLOW = 'https://api.github.com/repos/andreasheige/lunch-app/actions/workflows/deploy.yml';
const FIRST_HOUR = 6;
const LAST_HOUR = 13;
const MIN_GAP_MS = 60 * 60 * 1000;

const stockholmHour = (now: Date): number =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', hourCycle: 'h23' }).format(now),
  );

/** True on weekday mornings (Stockholm) when the captured Poppels menu is from another week than today's. */
export function capturedIsStale(captured: Captured, now = new Date()): boolean {
  const today = stockholmDate(now);
  const dow = today.getUTCDay();
  const hour = stockholmHour(now);
  if (dow === 0 || dow === 6 || hour < FIRST_HOUR || hour >= LAST_HOUR) return false;
  const lines = captured.poppels;
  const poppels = RESTAURANTS.find((r) => r.id === 'poppels');
  if (!lines || !poppels) return false;
  const { week } = poppels.parse(lines, 'Måndag', '');
  return week !== null && week !== isoWeek(today);
}

/** Starts the deploy workflow unless one was started within the last hour. */
export async function redeploy(token: string, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - MIN_GAP_MS).toISOString();
  const runs = await fetch(`${WORKFLOW}/runs?per_page=1&created=>=${since}`, { headers: githubHeaders(token) });
  if (!runs.ok) throw new Error(`listing runs: HTTP ${runs.status}`);
  const body: unknown = await runs.json();
  if (typeof body === 'object' && body !== null && 'total_count' in body && body.total_count !== 0) return;
  const res = await fetch(`${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!res.ok) throw new Error(`dispatch: HTTP ${res.status}`);
}
