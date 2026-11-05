// Parity of the client's GitHub URL parser with the server's: for every input, both
// return the same result, and that result is the expected one. Run with `npm test`
// (node --test; Node 22.18 or later strips the types). Not part of the app bundle.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRepoUrl, parseGitHubRepoUrl, repoLabel } from './githubUrl.ts';
import { parseGitHubRepoUrl as serverParse } from '../../../server/utils/repository.js';

const BASE = 'https://github.com/octocat/Hello-World';
const OWNER_39 = 'a'.repeat(39);
const OWNER_40 = 'a'.repeat(40);
const REPO_100 = 'r'.repeat(100);
const REPO_101 = 'r'.repeat(101);
const hello = { owner: 'octocat', repo: 'Hello-World' };

// [input, expected]
const CASES: [string, { owner: string; repo: string } | null][] = [
  // Accepted
  [BASE, hello],
  [`${BASE}/`, hello],
  [`${BASE}.git`, hello],
  [`${BASE}.git/`, hello],
  [`  ${BASE}  `, hello],
  ['https://GitHub.com/octocat/Hello-World', hello],
  ['HTTPS://github.com/octocat/Hello-World', hello],
  [`https://github.com/${OWNER_39}/x`, { owner: OWNER_39, repo: 'x' }],
  ['https://github.com/octocat/a.b_c-d', { owner: 'octocat', repo: 'a.b_c-d' }],
  [`https://github.com/octocat/${REPO_100}`, { owner: 'octocat', repo: REPO_100 }],
  ['https://github.com/octocat/Hello-World.git.git', { owner: 'octocat', repo: 'Hello-World.git' }],
  ['https://github.com/0/x', { owner: '0', repo: 'x' }],
  // Rejected
  ['http://github.com/octocat/Hello-World', null],
  ['https://www.github.com/octocat/Hello-World', null],
  ['https://gitlab.com/octocat/Hello-World', null],
  ['https://github.com/octocat', null],
  ['https://github.com/octocat/', null],
  [`${BASE}/tree/main`, null],
  [`${BASE}?tab=readme`, null],
  [`${BASE}#readme`, null],
  ['https://user:pw@github.com/octocat/Hello-World', null],
  ['https://user@github.com/octocat/Hello-World', null],
  ['https://github.com:443/octocat/Hello-World', null],
  ['https://github.com/-octocat/x', null],
  ['https://github.com/octo/..', null],
  ['https://github.com/octo/.', null],
  ['https://github.com/octo/./x', null],
  ['https://github.com/o%63to/x', null],
  ['https://github.com/octo\\x/y', null],
  [`https://github.com/${OWNER_40}/x`, null],
  [`https://github.com/octocat/${REPO_101}`, null],
  [`${BASE}//`, null],
  [`${BASE}.git//`, null],
  ['https://github.com/octocat/Hello World', null],
  ['', null],
  ['   ', null],
  ['https://github.com/octocat/Hello\tWorld', null],
  ['https://github.com/octocat/Hello-World\n', hello], // surrounding whitespace is trimmed
  ['https://github.com/octocat\n/Hello-World', null],
  ['https://github.com/octocat/Hello\u0000World', null],
  ['git@github.com:octocat/Hello-World.git', null],
  ['github.com/octocat/Hello-World', null],
  ['https://github.com/octocat/.git', null],
  ['https://github.com/octocat/Hello~World', null],
  [`https://github.com/${'x/'.repeat(1100)}`, null]
];

describe('parseGitHubRepoUrl: the client and the server agree', () => {
  test('the table has at least 30 inputs', () => assert.ok(CASES.length >= 30, String(CASES.length)));
  for (const [input, expected] of CASES) {
    test(JSON.stringify(input.length > 60 ? `${input.slice(0, 57)}...` : input), () => {
      const client = parseGitHubRepoUrl(input);
      const server = serverParse(input);
      assert.deepEqual(client, server, 'client and server differ');
      assert.deepEqual(client, expected);
    });
  }
  test('non-strings are rejected by both', () => {
    for (const value of [undefined, null, 42, {}, ['https://github.com/a/b']]) {
      assert.equal(parseGitHubRepoUrl(value), null);
      assert.equal(serverParse(value), null);
    }
  });
});

describe('canonicalRepoUrl and repoLabel', () => {
  test('canonicalRepoUrl drops ".git" and the trailing "/"', () => {
    for (const input of [BASE, `${BASE}/`, `${BASE}.git`, `${BASE}.git/`, `  ${BASE}  `, 'https://GitHub.com/octocat/Hello-World']) {
      assert.equal(canonicalRepoUrl(parseGitHubRepoUrl(input)!), BASE, input);
    }
  });
  test('repoLabel gives owner/repo, or the input when it does not parse', () => {
    assert.equal(repoLabel(`${BASE}.git`), 'octocat/Hello-World');
    assert.equal(repoLabel(`${BASE}/`), 'octocat/Hello-World');
    assert.equal(repoLabel(`${BASE}/tree/main`), `${BASE}/tree/main`);
    assert.equal(repoLabel(''), '');
  });
});
