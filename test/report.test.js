import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueBody, parseReport } from '../src/report.js';

test('issueBody fences text longer than any backtick run inside it', () => {
  const body = issueBody('hej @someone ```kod``` ![x](https://evil)');
  assert.ok(body.startsWith('````text\n'));
  assert.ok(body.includes('\n````\n'));
});

test('parseReport trims fields and rejects missing, unknown or oversized input', () => {
  assert.deepEqual(parseReport({ kind: 'bug', title: ' Fel pris ', text: ' Pocket ', token: 't' }),
    { kind: 'bug', title: 'Fel pris', text: 'Pocket', token: 't' });
  assert.equal(parseReport({ kind: 'spam', title: 'a', text: 'b', token: 't' }), null);
  assert.equal(parseReport({ kind: 'bug', title: '   ', text: 'b', token: 't' }), null);
  assert.equal(parseReport({ kind: 'bug', title: 'a'.repeat(121), text: 'b', token: 't' }), null);
  assert.equal(parseReport({ kind: 'feat-req', title: 'a', text: 'b' }), null);
  assert.equal(parseReport(null), null);
});
