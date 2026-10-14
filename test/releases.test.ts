import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanBody,
  cleanTitle,
  groupReleases,
  noteLang,
  parseCommitLog,
  parsePullRequests,
  parseReleaseText,
  slugFor,
  toPosts,
} from '../src/server/releases.ts';
import type { PullRequest } from '../src/shared/types.ts';

const record = (sha: string, subject: string, body = '', authored = '2026-10-06T13:44:00+02:00') =>
  `${sha}\x1f2026-10-06T13:50:00+02:00\x1f${authored}\x1f${subject}\x1f${body}\x1e`;

test('parseCommitLog keeps feat/fix commits, reads the issue and drops the co-author trailer', () => {
  const log = [
    record('a1', 'feat: "Välj åt mig" lunch picker (#22)', 'Three questions.\n\nCo-Authored-By: Claude <x@y>\n'),
    record('b2', 'fix(parser): strip HTML to a fixpoint'),
    record('c3', 'chore: bump deps'),
    record('d4', 'feat: add Bang Bang Bangers (closes #18)'),
  ].join('\n');
  const commits = parseCommitLog(log);
  assert.deepEqual(
    commits.map((c) => [c.sha, c.type, c.subject, c.body, c.issue]),
    [
      ['a1', 'feat', '"Välj åt mig" lunch picker (#22)', 'Three questions.', 22],
      ['b2', 'fix', 'strip HTML to a fixpoint', '', null],
      ['d4', 'feat', 'add Bang Bang Bangers (closes #18)', '', 18],
    ],
  );
  assert.equal(commits[0]?.headline, 'feat: "Välj åt mig" lunch picker (#22)');
  assert.equal(commits[0]?.authored, '2026-10-06T13:44:00+02:00');
  assert.deepEqual(parseCommitLog(''), []);
});

test('parsePullRequests reads the GraphQL answer and gives [] for anything else', () => {
  const answer = {
    data: {
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 45,
              title: 'Feat/lunchit icon',
              body: null,
              mergeCommit: { oid: 'm1' },
              commits: { nodes: [{ commit: { messageHeadline: 'feat: icon', authoredDate: '2026-10-13T08:39:42Z' } }] },
            },
          ],
        },
      },
    },
  };
  assert.deepEqual(parsePullRequests(answer), [
    {
      number: 45,
      title: 'Feat/lunchit icon',
      body: '',
      mergeCommit: 'm1',
      commits: [{ headline: 'feat: icon', authored: '2026-10-13T08:39:42Z' }],
    },
  ]);
  assert.deepEqual(parsePullRequests({ errors: [{ message: 'Bad credentials' }] }), []);
  assert.deepEqual(parsePullRequests(null), []);
});

test('cleanTitle, cleanBody and slugFor', () => {
  assert.equal(cleanTitle('feat: English version of the whole site'), 'English version of the whole site');
  assert.equal(cleanTitle('Feat/lunchit icon'), 'lunchit icon');
  assert.equal(cleanTitle('feat(ui)!: picker (#22)'), 'picker');
  assert.equal(
    cleanBody('What it does.\n\n## Test plan\n- [x] ran it\n\n🤖 Generated with Claude Code'),
    'What it does.',
  );
  assert.equal(
    slugFor('2026-10-14T09:00:00+02:00', 'feat: Välj åt mig – lunch picker för dig idag'),
    '2026-10-14-valj-at-mig-lunch-picker-for',
  );
  assert.equal(slugFor('2026-10-13', "Lunchit's own look"), '2026-10-13-lunchits-own-look');
});

test('groupReleases puts a PR’s rebased commits in one release and leaves direct pushes alone', () => {
  const commits = parseCommitLog(
    [
      record('c3', 'fix: typo on the stats page', '', '2026-10-14T09:00:00+02:00'),
      record('c2', 'feat: name the app Lunchit', '', '2026-10-13T10:40:06+02:00'),
      record('c1', 'feat: Lunchit icon', '', '2026-10-13T10:39:42+02:00'),
      record('c0', 'feat: add to home screen', '', '2026-10-13T10:28:07+02:00'),
    ].join(''),
  );
  const prs: PullRequest[] = [
    {
      number: 45,
      title: 'Feat/lunchit icon',
      body: 'Name and icon.',
      mergeCommit: 'c2',
      // GitHub reports UTC; git log the local offset. Same instant, same commit.
      commits: [
        { headline: 'feat: Lunchit icon', authored: '2026-10-13T08:39:42Z' },
        { headline: 'feat: name the app Lunchit', authored: '2026-10-13T08:40:06Z' },
      ],
    },
    // Squash-merged: found by its merge commit.
    { number: 44, title: 'feat: add to home screen', body: '', mergeCommit: 'c0', commits: [] },
  ];
  const releases = groupReleases(commits, prs);
  assert.deepEqual(
    releases.map((r) => [r.key, r.pr, r.title, r.commits.length, r.slug]),
    [
      ['c3', null, 'typo on the stats page', 1, '2026-10-06-typo-on-the-stats-page'],
      ['pr-45', 45, 'lunchit icon', 2, '2026-10-06-lunchit-icon'],
      ['pr-44', 44, 'add to home screen', 1, '2026-10-06-add-to-home-screen'],
    ],
  );
  assert.equal(releases[1]?.body, 'Name and icon.');
  // Same title on the same day: the second gets a number.
  const twice = groupReleases(parseCommitLog(record('a', 'fix: menu') + record('b', 'fix: menu')), []);
  assert.deepEqual(
    twice.map((r) => r.slug),
    ['2026-10-06-menu', '2026-10-06-menu-2'],
  );
});

test('parseReleaseText keeps a valid post, capped, and nothing else', () => {
  const ok = parseReleaseText(
    JSON.stringify({
      title: ' Ny look ',
      summary: 'Allt är nytt.',
      intro: 'Ett stycke.',
      changes: [
        { kind: 'new', title: 'Mörkt läge', text: 'Följer telefonen.' },
        { kind: 'bogus', title: 'X', text: 'Y' },
        'nope',
      ],
    }),
  );
  assert.deepEqual(ok, {
    title: 'Ny look',
    summary: 'Allt är nytt.',
    intro: ['Ett stycke.'],
    changes: [{ kind: 'new', title: 'Mörkt läge', text: 'Följer telefonen.' }],
  });
  assert.equal(parseReleaseText({ title: 'A', summary: 'B', changes: [] }), null);
  assert.equal(parseReleaseText({ title: 'A', changes: [{ kind: 'new', title: 'C' }] }), null);
  assert.equal(parseReleaseText('nope'), null);
  assert.equal(
    parseReleaseText({ title: 'x'.repeat(500), summary: 'B', changes: [{ kind: 'fixed', title: 'C' }] })?.title.length,
    120,
  );
});

test('toPosts uses the written text and falls back to the PR title and commit subjects while pending', () => {
  const releases = groupReleases(parseCommitLog(record('a1', 'feat: picker (#22)') + record('b2', 'fix: typo')), []);
  const written = {
    title: 'Låt sajten välja',
    summary: 'Tre frågor.',
    intro: [],
    changes: [{ kind: 'new' as const, title: 'Välj åt mig', text: '' }],
  };
  const posts = toPosts(releases, new Map([['a1', written]]));
  assert.deepEqual(
    posts.map((p) => [p.title, p.kinds, p.pending]),
    [
      ['Låt sajten välja', ['new'], false],
      ['Typo', ['fixed'], true],
    ],
  );
  assert.deepEqual(posts[1]?.changes, [{ kind: 'fixed', title: 'Typo', text: '' }]);
});

test('noteLang picks English only when asked', () => {
  assert.equal(noteLang('en'), 'en');
  assert.equal(noteLang('sv'), 'sv');
  assert.equal(noteLang("en'; DROP TABLE ratings"), 'sv');
  assert.equal(noteLang(null), 'sv');
});
