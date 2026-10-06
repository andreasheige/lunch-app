import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueBody, parseReport } from '../src/server/report.ts';

test('issueBody fences text longer than any backtick run inside it', () => {
  const body = issueBody('hej @someone ```kod``` ![x](https://evil)', 'lunchit.se');
  assert.ok(body.startsWith('````text\n'));
  assert.ok(body.includes('\n````\n'));
  assert.ok(body.endsWith('formuläret på lunchit.se._'));
});

test('parseReport trims fields and rejects missing, unknown or oversized input', () => {
  assert.deepEqual(parseReport({ kind: 'bug', title: ' Fel pris ', text: ' Pocket ', token: 't' }), {
    kind: 'bug',
    title: 'Fel pris',
    text: 'Pocket',
    token: 't',
    contact: null,
  });
  assert.equal(parseReport({ kind: 'spam', title: 'a', text: 'b', token: 't' }), null);
  assert.equal(parseReport({ kind: 'bug', title: '   ', text: 'b', token: 't' }), null);
  assert.equal(parseReport({ kind: 'bug', title: 'a'.repeat(121), text: 'b', token: 't' }), null);
  assert.equal(parseReport({ kind: 'feat-req', title: 'a', text: 'b' }), null);
  assert.equal(parseReport(null), null);
});

test('parseReport keeps a contact only when the notify box is ticked with a valid address', () => {
  const base = { kind: 'feat-req', title: 'Allergifilter', text: 'Snälla', token: 't' };
  assert.deepEqual(parseReport({ ...base, notify: 'on', name: ' Anna ', email: ' anna@example.com ' })?.contact, {
    name: 'Anna',
    email: 'anna@example.com',
  });
  assert.equal(parseReport({ ...base, email: 'anna@example.com' })?.contact, null);
  assert.equal(parseReport({ ...base, notify: 'on', email: 'not-an-email' }), null);
  assert.equal(parseReport({ ...base, notify: 'on' }), null);
});

test('issueBody says when the reporter wants an email, without the address', () => {
  assert.match(issueBody('x', 'lunchit.se', true), /vill ha ett mejl när det stängs/);
  assert.doesNotMatch(issueBody('x', 'lunchit.se'), /mejl/);
});
