import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readVoter, signVoter, VOTER_COOKIE, voterCookie } from '../src/server/voter.ts';

const secret = 'test-only-secret';
const id = '0b7f3c1e-8a2d-4e5f-9c6b-1d2e3f4a5b6c';

test('a signed voter cookie reads back to its id', async () => {
  const value = await signVoter(secret, id);
  assert.equal(await readVoter(secret, `theme=dark; ${VOTER_COOKIE}=${value}`), id);
  assert.match(voterCookie(value), /HttpOnly; Secure; SameSite=Strict$/);
});

test('made-up, tampered or foreign-key cookies are refused', async () => {
  const value = await signVoter(secret, id);
  const [, sig] = value.split('.');
  const other = '11111111-2222-4333-8444-555555555555';
  for (const cookie of [
    null,
    '',
    `${VOTER_COOKIE}=${id}`,
    `${VOTER_COOKIE}=${other}.${sig}`,
    `${VOTER_COOKIE}=${value}x`,
    `${VOTER_COOKIE}=${value}.extra`,
    `${VOTER_COOKIE}=not-a-uuid.${sig}`,
    `${VOTER_COOKIE}=${id}.%%%`,
  ]) {
    assert.equal(await readVoter(secret, cookie), null, String(cookie));
  }
  assert.equal(await readVoter('another-secret', `${VOTER_COOKIE}=${value}`), null);
});
