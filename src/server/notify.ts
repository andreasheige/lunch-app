// The "your report is done" email, sent by worker.ts notifyReporters once a reporter's GitHub issue is closed.
// Pure; name and title come from the form, so they're escaped in the HTML part.
import type { ReportKind } from '../shared/types.ts';

export const SITE = 'https://lunchit.se';
export const FROM = 'hej@lunchit.se';

export interface ContactRow {
  issue: number;
  kind: ReportKind;
  title: string;
  name: string;
  email: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

// GitHub's state_reason: "completed" when done (also what "closes #N" sets), "not_planned" when declined.
export function notifyEmail(row: ContactRow, reason: string | null): { subject: string; text: string; html: string } {
  const done = reason !== 'not_planned';
  const hello = `Hej${row.name ? ` ${row.name}` : ''}!`;
  const what = row.kind === 'bug' ? 'felet du rapporterade' : 'ditt önskemål';
  const lines = done
    ? [
        hello,
        `Tack för att du hörde av dig till Dagens lunch – ${what}, ”${row.title}”, är nu klart och ute på lunchit.se.`,
        `Se vad som är nytt: ${SITE}/nyheter`,
      ]
    : [
        hello,
        `Tack för att du hörde av dig till Dagens lunch. Vi har tittat på ${what}, ”${row.title}”, men gör inget åt det just nu.`,
        `Svara gärna på det här mejlet om du vill berätta mer.`,
      ];
  const footer =
    'Du får det här mejlet för att du bad om besked när du skickade in ärendet. Din e-postadress är nu raderad.';
  const text = `${lines.join('\n\n')}\n\nHälsningar,\nDagens lunch\n\n${footer}\n`;
  const html = `${lines.map((l) => `<p>${escapeHtml(l).replace(`${SITE}/nyheter`, `<a href="${SITE}/nyheter">${SITE}/nyheter</a>`)}</p>`).join('')}<p>Hälsningar,<br>Dagens lunch</p><p style="color:#888;font-size:12px">${footer}</p>`;
  return {
    subject: done ? `Klart: ${row.title}` : `Om ditt ärende: ${row.title}`,
    text,
    html,
  };
}
