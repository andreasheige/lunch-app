import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notifyEmail } from '../src/server/notify.ts';

const row = {
  issue: 26,
  kind: 'feat-req' as const,
  title: 'Kunna filtrera på allergier',
  name: 'Anna',
  email: 'a@b.se',
};

test('notifyEmail: a completed issue says it is live and links to Nyheter', () => {
  const mail = notifyEmail(row, 'completed');
  assert.equal(mail.subject, 'Klart: Kunna filtrera på allergier');
  assert.match(mail.text, /^Hej Anna!/);
  assert.match(mail.text, /ditt önskemål, ”Kunna filtrera på allergier”, är nu klart/);
  assert.match(mail.html, /<a href="https:\/\/lunchit.se\/nyheter">/);
});

test('notifyEmail: not planned gets a friendly no, bugs are called fel, no name is fine', () => {
  const mail = notifyEmail({ ...row, kind: 'bug', name: '' }, 'not_planned');
  assert.equal(mail.subject, 'Om ditt ärende: Kunna filtrera på allergier');
  assert.match(mail.text, /^Hej!/);
  assert.match(mail.text, /felet du rapporterade/);
  assert.match(mail.text, /gör inget åt det just nu/);
});

test('notifyEmail escapes form text in the HTML part', () => {
  const mail = notifyEmail({ ...row, name: '<b>x</b>', title: '"><script>alert(1)</script>' }, 'completed');
  assert.doesNotMatch(mail.html, /<script>|<b>/);
  assert.match(mail.html, /&lt;script&gt;/);
});
