import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTE_LANGS, noteLang, parseCommitLog, parseNote, toNotes } from '../src/server/releases.ts';

const record = (sha: string, subject: string, body = '') =>
  `${sha}\x1f2026-10-06T13:44:00+02:00\x1f${subject}\x1f${body}\x1e`;

test('parseCommitLog keeps feat/fix commits, reads the issue and drops the co-author trailer', () => {
  const log = [
    record('a1', 'feat: "Välj åt mig" lunch picker (#22)', 'Three questions.\n\nCo-Authored-By: Claude <x@y>\n'),
    record('b2', 'fix(parser): strip HTML to a fixpoint'),
    record('c3', 'chore: bump deps'),
    record('d4', 'feat: add Bang Bang Bangers (closes #18)'),
    record('e5', 'refactor: move files'),
  ].join('\n');
  assert.deepEqual(parseCommitLog(log), [
    {
      sha: 'a1',
      date: '2026-10-06T13:44:00+02:00',
      type: 'feat',
      subject: '"Välj åt mig" lunch picker (#22)',
      body: 'Three questions.',
      issue: 22,
    },
    {
      sha: 'b2',
      date: '2026-10-06T13:44:00+02:00',
      type: 'fix',
      subject: 'strip HTML to a fixpoint',
      body: '',
      issue: null,
    },
    {
      sha: 'd4',
      date: '2026-10-06T13:44:00+02:00',
      type: 'feat',
      subject: 'add Bang Bang Bangers (closes #18)',
      body: '',
      issue: 18,
    },
  ]);
  assert.deepEqual(parseCommitLog(''), []);
});

test('parseNote accepts a title and body, trimmed and capped, and nothing else', () => {
  assert.deepEqual(parseNote('{"title":" Ny knapp ","body":"Nu kan du…"}'), { title: 'Ny knapp', body: 'Nu kan du…' });
  assert.deepEqual(parseNote({ title: 'A', body: 'B' }), { title: 'A', body: 'B' });
  assert.equal(parseNote({ title: 'A', body: '' }), null);
  assert.equal(parseNote({ title: 1, body: 'B' }), null);
  assert.equal(parseNote('nope'), null);
  assert.equal(parseNote({ title: 'x'.repeat(500), body: 'B' })?.title.length, 120);
});

test('toNotes uses the stored Swedish text and falls back to the subject while pending', () => {
  const commits = parseCommitLog([record('a1', 'feat: picker (#22)'), record('b2', 'fix: typo')].join(''));
  const notes = toNotes(commits, new Map([['a1', { title: 'Låt sajten välja', body: 'Svara på tre frågor.' }]]));
  assert.deepEqual(
    notes.map((n) => [n.title, n.pending]),
    [
      ['Låt sajten välja', false],
      ['typo', true],
    ],
  );
});

test('noteLang picks English only when asked, so the table name never comes from the request', () => {
  assert.equal(noteLang('en'), 'en');
  assert.equal(noteLang('sv'), 'sv');
  assert.equal(noteLang('release_notes; DROP TABLE ratings'), 'sv');
  assert.equal(noteLang(null), 'sv');
  assert.deepEqual(
    Object.values(NOTE_LANGS).map((l) => l.table),
    ['release_notes', 'release_notes_en'],
  );
});
