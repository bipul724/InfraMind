import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  parseGitHubRepoUrl,
  parseRepositoryData,
  parseFullName,
  buildCloneUrl,
  buildDisplayUrl,
  isPathInside,
  resolveSessionClonePath,
  redactSecrets
} from '../utils/repository.js';

describe('parseGitHubRepoUrl', () => {
  const accepted = [
    'https://github.com/octocat/Hello-World',
    'https://github.com/octocat/Hello-World.git',
    'https://github.com/octocat/Hello-World/',
    'https://github.com/octocat/Hello-World.git/',
    'https://GitHub.com/octocat/Hello-World'
  ];

  for (const input of accepted) {
    test(`accepts ${input}`, () => {
      assert.deepEqual(parseGitHubRepoUrl(input), { owner: 'octocat', repo: 'Hello-World' });
    });
  }

  const rejected = [
    'http://github.com/a/b',
    'https://gitlab.com/a/b',
    'https://github.com.evil.com/a/b',
    'https://evil.com/github.com/a/b',
    'https://tok@github.com/a/b',
    'https://u:p@github.com/a/b',
    'https://github.com:8443/a/b',
    'https://github.com/a',
    'https://github.com/a/b/c',
    'https://github.com/a/b?x=1',
    'https://github.com/a/b#x',
    'https://github.com/../b',
    'https://github.com/a/..',
    'https://github.com/a/%2e%2e',
    'https://github.com/-a/b',
    'https://github.com/a/--upload-pack=touch',
    'https://github.com/x/../a/b',
    'https://github.com/a/b/.',
    'https://github.com/a/.git',
    'https://github.com/a\\b/c',
    'https://github.com/a/b\nhttps://evil.com',
    'file:///etc/passwd',
    '/tmp/repo',
    '../../x',
    'git@github.com:a/b.git',
    ''
  ];

  for (const input of rejected) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(parseGitHubRepoUrl(input), null);
    });
  }

  for (const input of [null, undefined, 42, {}, [], true]) {
    test(`rejects non-string ${JSON.stringify(input)}`, () => {
      assert.equal(parseGitHubRepoUrl(input), null);
    });
  }
});

describe('parseRepositoryData', () => {
  test('derives identity from fullName and ignores cloneUrl and private', () => {
    assert.deepEqual(
      parseRepositoryData({ fullName: 'octocat/Hello-World', cloneUrl: '/etc', private: true }),
      { owner: 'octocat', repo: 'Hello-World' }
    );
  });

  test('falls back to owner.login + name', () => {
    assert.deepEqual(
      parseRepositoryData({ name: 'Hello-World', owner: { login: 'octocat' }, cloneUrl: 'file:///etc' }),
      { owner: 'octocat', repo: 'Hello-World' }
    );
  });

  test('accepts the shape RepositorySelector sends', () => {
    assert.deepEqual(
      parseRepositoryData({
        id: 1,
        name: 'Hello-World',
        fullName: 'octocat/Hello-World',
        private: false,
        htmlUrl: 'https://github.com/octocat/Hello-World',
        cloneUrl: 'https://github.com/octocat/Hello-World.git',
        sshUrl: 'git@github.com:octocat/Hello-World.git',
        owner: { login: 'octocat', avatarUrl: 'https://example.com/a.png' }
      }),
      { owner: 'octocat', repo: 'Hello-World' }
    );
  });

  const rejected = [
    { fullName: '../../../x/y' },
    { fullName: '../../../../escaped/x', name: '../../../../escaped', cloneUrl: '/tmp/fixture' },
    { name: '../../escaped', owner: { login: 'a' } },
    { fullName: 'a/b/c' },
    { fullName: 42, name: 'b', owner: { login: 'a' } },
    { cloneUrl: 'https://github.com/a/b.git' },
    {},
    null,
    [],
    ['octocat/Hello-World'],
    'octocat/Hello-World'
  ];

  for (const input of rejected) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(parseRepositoryData(input), null);
    });
  }
});

describe('parseFullName', () => {
  test('accepts owner/repo and rejects anything else', () => {
    assert.deepEqual(parseFullName('octocat/Hello-World'), { owner: 'octocat', repo: 'Hello-World' });
    assert.equal(parseFullName('octocat'), null);
    assert.equal(parseFullName('octocat/..'), null);
    assert.equal(parseFullName(undefined), null);
  });
});

describe('URL builders', () => {
  test('build credential-free URLs', () => {
    assert.equal(buildCloneUrl({ owner: 'o', repo: 'r' }), 'https://github.com/o/r.git');
    assert.equal(buildDisplayUrl({ owner: 'o', repo: 'r' }), 'https://github.com/o/r');
  });
});

describe('isPathInside', () => {
  const base = path.join(os.tmpdir(), 'inframind-base');

  test('accepts strict descendants', () => {
    assert.equal(isPathInside(base, path.join(base, 'a', 'repo')), true);
  });

  test('rejects the base itself, siblings with a shared prefix and traversal', () => {
    assert.equal(isPathInside(base, base), false);
    assert.equal(isPathInside(base, `${base}-evil/x`), false);
    assert.equal(isPathInside(base, path.join(base, '..', 'x')), false);
    assert.equal(isPathInside(base, '/etc/passwd'), false);
  });
});

describe('resolveSessionClonePath', () => {
  const tempDir = path.join(os.tmpdir(), 'inframind-temp');

  test('returns <temp>/<uuid>/repo for a valid UUID', () => {
    const id = crypto.randomUUID();
    const result = resolveSessionClonePath(tempDir, id);
    assert.equal(result, path.join(tempDir, id, 'repo'));
    assert.ok(result.startsWith(path.resolve(tempDir) + path.sep));
  });

  for (const bad of ['../x', 'a/b', '', '..', null, 'not-a-uuid']) {
    test(`throws for ${JSON.stringify(bad)}`, () => {
      assert.throws(() => resolveSessionClonePath(tempDir, bad));
    });
  }
});

describe('redactSecrets', () => {
  const tempDir = path.join(os.tmpdir(), 'inframind-redact-temp');

  test('removes tokens, URL userinfo, Authorization values and the temp path', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwx';
    const input = [
      `token=${token}`,
      'fatal: could not read from https://x@github.com/o/r.git',
      "remote: https://user:pass@github.com/o/r",
      'http.extraheader=Authorization: Basic eC1hY2Nlc3MtdG9rZW46c2VjcmV0',
      'AUTHORIZATION: basic c2VjcmV0',
      `Cloning into '${path.join(tempDir, 'abc', 'repo')}'`
    ].join('\n');

    const output = redactSecrets(input, [token], { tempDir });

    assert.ok(!output.includes(token));
    assert.ok(!output.includes('x@github.com'));
    assert.ok(!output.includes('user:pass'));
    assert.ok(!output.includes('eC1hY2Nlc3MtdG9rZW46c2VjcmV0'));
    assert.ok(!output.includes('c2VjcmV0'));
    assert.ok(!output.includes(tempDir));
    assert.ok(output.includes('<temp>'));
    assert.ok(output.includes('https://[REDACTED]@github.com'));
  });

  test('coerces non-strings safely', () => {
    assert.equal(redactSecrets(undefined), '');
    assert.equal(redactSecrets(null), '');
    assert.equal(typeof redactSecrets({ a: 1 }), 'string');
    assert.ok(!redactSecrets(new Error('https://tok@github.com/a/b')).includes('tok@'));
    const circular = {};
    circular.self = circular;
    assert.equal(typeof redactSecrets(circular), 'string');
  });
});
