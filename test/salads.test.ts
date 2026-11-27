import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  approveSalads,
  handleSalad,
  MAX_INGREDIENTS,
  MAX_NAME,
  parseSalad,
  type SaladEnv,
  type SaladRow,
  SHOWN,
  saladDecision,
  saladDishes,
  saladIssue,
} from '../src/server/salads.ts';

const issue99 = {
  name: '  Tonfiskdrömmen ',
  ingredients: '* lite grönsallad i botten\r\n* pasta med tomatsmak\n\n* rödlök\n- 1 ägg\n• kryddig tonfisk-röra \n',
  price: '65-70 SEK',
  token: 't',
};

test('parseSalad: trims, splits lines, drops list markers and empty lines', () => {
  assert.deepEqual(parseSalad(issue99), {
    name: 'Tonfiskdrömmen',
    ingredients: ['lite grönsallad i botten', 'pasta med tomatsmak', 'rödlök', '1 ägg', 'kryddig tonfisk-röra'],
    price: '65-70 SEK',
    token: 't',
  });
});

test('parseSalad: control characters become spaces, no price is null', () => {
  const s = parseSalad({ name: 'A\u0000\u0007B', ingredients: 'x\ty', token: 't' });
  assert.equal(s?.name, 'A B');
  assert.deepEqual(s?.ingredients, ['x y']);
  assert.equal(s?.price, null);
});

test('parseSalad: rejects missing or oversized fields', () => {
  const ok = { name: 'Bra', ingredients: 'sallad', token: 't' };
  assert.ok(parseSalad(ok));
  assert.equal(parseSalad(null), null);
  assert.equal(parseSalad({ ...ok, token: '' }), null);
  assert.equal(parseSalad({ ...ok, name: 'x' }), null);
  assert.equal(parseSalad({ ...ok, name: 'x'.repeat(MAX_NAME + 1) }), null);
  assert.equal(parseSalad({ ...ok, ingredients: '\n \n' }), null);
  assert.equal(
    parseSalad({
      ...ok,
      ingredients: Array(MAX_INGREDIENTS + 1)
        .fill('a')
        .join('\n'),
    }),
    null,
  );
  assert.equal(parseSalad({ ...ok, ingredients: 'a'.repeat(61) }), null);
  assert.equal(parseSalad({ ...ok, price: '1'.repeat(21) }), null);
  assert.equal(parseSalad({ ...ok, name: 42 }), null);
});

test('saladIssue: the salad in an inert code fence, labelled salad', () => {
  const issue = saladIssue({ name: 'Hej @someone', ingredients: ['a', '```b'], price: '70 kr' }, 'lunchit.se');
  assert.equal(issue.title, 'Sallad: Hej @someone');
  assert.deepEqual(issue.labels, ['salad']);
  assert.ok(issue.body.startsWith('````text\nHej @someone\n\n* a\n* ```b\n\nPris: 70 kr\n````'));
  assert.match(issue.body, /completed/);
});

test('saladDecision: closed completed approves, not planned or gone deletes, open waits', () => {
  assert.equal(saladDecision({ state: 'open', state_reason: null }), null);
  assert.equal(saladDecision({ state: 'closed', state_reason: 'completed' }), 'approve');
  assert.equal(saladDecision({ state: 'closed', state_reason: null }), 'approve');
  assert.equal(saladDecision({ state: 'closed', state_reason: 'not_planned' }), 'delete');
  assert.equal(saladDecision(null), 'delete');
});

const row = (name: string, avg: number | null, created_at = '2026-11-27 10:00:00'): SaladRow => ({
  name,
  ingredients: JSON.stringify(['sallad', 'ägg']),
  price: null,
  created_at,
  avg,
});

test('saladDishes: best rated first, unrated after, newest breaks ties, capped', () => {
  const dishes = saladDishes([
    row('Ny', null, '2026-11-27 12:00:00'),
    row('Gammal', null, '2026-11-01 12:00:00'),
    row('Topp', 4.5),
    row('Mitt', 3),
  ]);
  assert.deepEqual(
    dishes.map((d) => d.name),
    ['Topp', 'Mitt', 'Ny', 'Gammal'],
  );
  assert.deepEqual(dishes[0], { category: 'Sallad', name: 'Topp', description: 'sallad, ägg' });
  assert.equal(saladDishes(Array.from({ length: SHOWN + 3 }, (_, i) => row(`S${i}`, i))).length, SHOWN);
  assert.equal(saladDishes([{ ...row('P', null), price: '70 kr' }])[0]?.description, 'sallad, ägg · 70 kr');
});

// handleSalad with D1, the rate limiter, Turnstile and GitHub stubbed.
function stubEnv(opts: { insertError?: string } = {}) {
  const sql: { query: string; values: unknown[] }[] = [];
  const env: SaladEnv = {
    REPORT_LIMITER: { limit: async () => ({ success: true }) },
    TURNSTILE_SECRET: 's',
    GITHUB_TOKEN: 'g',
    DB: {
      prepare: (query) => ({
        bind: (...values) => ({
          run: async () => {
            if (opts.insertError && query.startsWith('INSERT')) throw new Error(opts.insertError);
            sql.push({ query, values });
            return { meta: { last_row_id: 7 } };
          },
        }),
      }),
    },
  };
  return { env, sql };
}

async function withFetch<T>(github: Response, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes('turnstile') ? new Response(JSON.stringify({ success: true })) : github;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const post = (body: unknown, origin = 'https://lunchit.se') =>
  new Request('https://lunchit.se/salad', { method: 'POST', headers: { origin }, body: JSON.stringify(body) });

test('handleSalad: saves the salad, opens the issue and stores its number', async () => {
  const { env, sql } = stubEnv();
  const res = await withFetch(new Response(JSON.stringify({ number: 120 }), { status: 201 }), () =>
    handleSalad(post(issue99), env),
  );
  assert.equal(res.status, 201);
  assert.match(sql[0]?.query ?? '', /^INSERT INTO salads/);
  assert.equal(sql[0]?.values[0], 'Tonfiskdrömmen');
  assert.deepEqual(sql[1], { query: 'UPDATE salads SET issue = ? WHERE id = ?', values: [120, 7] });
});

test('handleSalad: a GitHub failure removes the row again', async () => {
  const { env, sql } = stubEnv();
  const res = await withFetch(new Response('nope', { status: 500 }), () => handleSalad(post(issue99), env));
  assert.equal(res.status, 502);
  assert.deepEqual(sql[1], { query: 'DELETE FROM salads WHERE id = ?', values: [7] });
});

test('handleSalad: a taken name is a 409, bad input a 400, another origin a 403, the honeypot a silent 200', async () => {
  const taken = stubEnv({ insertError: 'D1_ERROR: UNIQUE constraint failed: salads.name' });
  assert.equal((await withFetch(new Response(), () => handleSalad(post(issue99), taken.env))).status, 409);
  const { env, sql } = stubEnv();
  assert.equal((await handleSalad(post({ ...issue99, ingredients: '' }), env)).status, 400);
  assert.equal((await handleSalad(post(issue99, 'https://evil.test'), env)).status, 403);
  assert.equal((await handleSalad(post({ ...issue99, website: 'x' }), env)).status, 200);
  assert.deepEqual(sql, []);
});

test('approveSalads: closed completed approves, not planned or 404 deletes, open or 401 waits', async () => {
  const sql: { query: string; values: unknown[] }[] = [];
  const pending = [5, 6, 7, 8, 9].map((issue) => ({ id: issue * 10, issue }));
  const env = {
    GITHUB_TOKEN: 'g',
    DB: {
      prepare: (query: string) => ({
        run: async () => sql.push({ query, values: [] }),
        all: async <T>() => ({ results: pending as T[] }),
        bind: (...values: unknown[]) => ({ run: async () => sql.push({ query, values }) }),
      }),
    },
  };
  const issues: Record<string, Response> = {
    '5': new Response(JSON.stringify({ state: 'closed', state_reason: 'completed' })),
    '6': new Response(JSON.stringify({ state: 'closed', state_reason: 'not_planned' })),
    '7': new Response('', { status: 404 }),
    '8': new Response(JSON.stringify({ state: 'open', state_reason: null })),
    '9': new Response('', { status: 401 }),
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => issues[String(url).split('/').pop() ?? ''] ?? new Response('', { status: 500 });
  try {
    await approveSalads(env, 20);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(
    sql.filter((s) => s.values.length),
    [
      { query: "UPDATE salads SET status = 'approved' WHERE id = ?", values: [50] },
      { query: 'DELETE FROM salads WHERE id = ?', values: [60] },
      { query: 'DELETE FROM salads WHERE id = ?', values: [70] },
    ],
  );
});
