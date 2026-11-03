// Integration tests against a spawned server (see helpers.js for isolation).
// The clone route is rate limited to 10 requests per process, so groups of tests
// use separate server processes.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  allCapturedLogs,
  authHeaders,
  closeFakes,
  connectGitHubFor,
  createFixtureRepo,
  getFakes,
  getFreePort,
  makeTempDir,
  pathExists,
  postJson,
  randomAlphanumeric,
  startServer
} from './helpers.js';

const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === '1';

// B1.2: every /api/* call now needs a verified Supabase token (user A from the fake)
let fakes;
let authA;
before(async () => {
  fakes = await getFakes();
  authA = authHeaders(fakes.tokens.A);
});
after(async () => { await closeFakes(); });

const listDir = async (dir) => {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
};

describe('removed endpoints, input validation and body handling', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  test('GET /api/sessions is gone', async () => {
    const response = await fetch(`${server.baseUrl}/api/sessions`, { headers: authA });
    assert.equal(response.status, 404);
  });

  test('POST /api/devpilot is gone', async () => {
    const response = await postJson(server.baseUrl, '/api/devpilot', { repoUrl: 'https://github.com/octocat/Hello-World' }, authA);
    assert.equal(response.status, 404);
  });

  const badBodies = [
    { repoUrl: '/tmp/x' },
    { repoUrl: 'file:///etc/passwd' },
    { repoUrl: 'https://gitlab.com/a/b' },
    { repoUrl: 'https://tok@github.com/a/b' },
    { repoUrl: 42 },
    {}
  ];
  for (const body of badBodies) {
    test(`clone-repo rejects ${JSON.stringify(body)} with 400 without echoing it`, async () => {
      const response = await postJson(server.baseUrl, '/api/clone-repo', body, authA);
      assert.equal(response.status, 400);
      assert.equal(typeof response.json?.error, 'string');
      if (body.repoUrl !== undefined) {
        assert.ok(!response.text.includes(String(body.repoUrl)), 'response must not echo the input');
      }
    });
  }

  test('authToken with CR/LF is rejected', async () => {
    const response = await postJson(server.baseUrl, '/api/clone-repo', {
      repoUrl: 'https://github.com/octocat/Hello-World',
      authToken: 'abc\r\nX-Injected: 1'
    }, authA);
    assert.equal(response.status, 400);
    assert.ok(!response.text.includes('X-Injected'));
  });

  test('malformed JSON is a 400 without parser details', async () => {
    const response = await postJson(server.baseUrl, '/api/clone-repo', '{bad', authA);
    assert.equal(response.status, 400);
    assert.deepEqual(response.json, { error: 'Invalid JSON body' });
    assert.ok(!response.text.includes('Expected'));
    assert.ok(!response.text.includes('JSON at position'));
  });

  test('a 200 kB body is a 413', async () => {
    const response = await postJson(server.baseUrl, '/api/clone-repo', {
      repoUrl: 'https://github.com/octocat/Hello-World',
      padding: 'x'.repeat(200 * 1024)
    }, authA);
    assert.equal(response.status, 413);
    assert.deepEqual(response.json, { error: 'Request body too large' });
  });

  test('no clone was attempted for any rejected request', async () => {
    assert.deepEqual(await listDir(path.join(server.cwd, 'temp')), []);
  });
});

describe('authenticated clone path (repositoryData)', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  const repositoryData = { fullName: 'octocat/Hello-World', name: 'Hello-World', owner: { login: 'octocat' } };

  test('without a stored GitHub connection is 401 GITHUB_AUTH_REQUIRED', async () => {
    // B1.3: GitHub access comes only from the server-side connection of the signed-in user
    const response = await postJson(server.baseUrl, '/api/clone-repo', {
      repoUrl: 'https://github.com/octocat/Hello-World.git',
      repositoryData
    }, authA);
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' });
  });

  test('a garbage X-GitHub-Token header is ignored: still 401 GITHUB_AUTH_REQUIRED, not a 500', async () => {
    const response = await postJson(
      server.baseUrl,
      '/api/clone-repo',
      { repoUrl: 'https://github.com/octocat/Hello-World.git', repositoryData },
      { ...authA, 'X-GitHub-Token': 'garbage' }
    );
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' });
  });

  test('path traversal and a local cloneUrl are rejected before anything touches disk or GitHub', async () => {
    // A real stored connection, so only input validation can stop this request
    const connected = await connectGitHubFor(server, fakes.tokens.A);
    assert.equal(connected.claim.status, 200, 'connected through the B1.3b claim step');
    const githubRequestsBefore = fakes.github.requests.length;

    const fixtureParent = await makeTempDir('inframind-fixture-');
    const fixtureRepo = await createFixtureRepo(fixtureParent);
    const tempDir = path.join(server.cwd, 'temp');
    // Where the pre-fix code would have written: path.join(TEMP_DIR, sessionId, name)
    const traversalTarget = path.resolve(tempDir, 'session-id', '../../../../escaped');

    const response = await postJson(
      server.baseUrl,
      '/api/clone-repo',
      {
        repositoryData: {
          fullName: '../../../../escaped/x',
          name: '../../../../escaped',
          private: false,
          cloneUrl: fixtureRepo
        }
      },
      authA
    );

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, { error: 'Invalid repository data' });
    assert.equal(fakes.github.requests.length, githubRequestsBefore, 'no GitHub API call');
    assert.equal(await pathExists(traversalTarget), false);
    assert.deepEqual(await listDir(tempDir), [], 'temp must not contain a clone of the fixture');
    await fs.rm(fixtureParent, { recursive: true, force: true });
  });
});

describe('clone failure handling (offline: git is pointed at an unreachable proxy)', () => {
  let server;
  before(async () => {
    const deadPort = await getFreePort();
    const proxy = `http://127.0.0.1:${deadPort}`;
    server = await startServer({ envOverrides: { HTTPS_PROXY: proxy, https_proxy: proxy, CLONE_TIMEOUT_MS: '20000' } });
  });
  after(async () => { await server?.stop(); });

  test('returns only the public error, marks the session failed and removes its directory', async () => {
    const token = 'ghp_' + randomAlphanumeric(24);
    const logStart = server.logs().length;

    const response = await postJson(server.baseUrl, '/api/clone-repo', {
      repoUrl: 'https://github.com/octocat/Hello-World',
      authToken: token
    }, authA);

    assert.equal(response.status, 502);
    assert.deepEqual(response.json, { error: 'Failed to clone repository', code: 'CLONE_FAILED' });

    const newLogs = server.logs().slice(logStart);
    const match = newLogs.match(/Clone failed \[CLONE_FAILED\] session=([0-9a-f-]{36})/);
    assert.ok(match, 'server should log one redacted clone failure line');
    const sessionId = match[1];

    const status = await fetch(`${server.baseUrl}/api/status/${sessionId}`, { headers: authA });
    const statusText = await status.text();
    const statusJson = JSON.parse(statusText);
    assert.equal(statusJson.status, 'failed');
    assert.equal(statusJson.error, 'Failed to clone repository');
    assert.equal(statusJson.repoUrl, 'https://github.com/octocat/Hello-World');
    assert.ok(!statusText.includes(token));

    assert.equal(await pathExists(path.join(server.cwd, 'temp', sessionId)), false);

    const tempDir = path.join(server.cwd, 'temp');
    for (const text of [newLogs, response.text, statusText]) {
      assert.ok(!text.includes(token), 'token must not appear in logs or responses');
      assert.ok(!text.includes(tempDir), 'absolute temp path must not appear in logs or responses');
    }
  });
});

// The JWT_SECRET startup checks and the JWT-based NEW-01 test were converted to the
// GitHub token store equivalents in api.github.test.js (startup checks and NEW-01).

describe('network: real clones against github.com', { skip: !RUN_NETWORK && 'set RUN_NETWORK_TESTS=1' }, () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  test('clones a public repository into temp/<id>/repo without exposing the path', { timeout: 120000 }, async () => {
    const response = await postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }, authA);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.success, true);
    assert.equal(response.json.repoName, 'Hello-World');
    assert.equal('path' in response.json, false);
    assert.ok(!response.text.includes(server.cwd));

    const { sessionId } = response.json;
    const status = await (await fetch(`${server.baseUrl}/api/status/${sessionId}`, { headers: authA })).json();
    assert.equal(status.repoUrl, 'https://github.com/octocat/Hello-World');
    assert.equal(status.status, 'cloned');
    assert.equal(await pathExists(path.join(server.cwd, 'temp', sessionId, 'repo', 'README')), true);
  });

  test('a missing repository with a fake token is a 404 and leaks nothing', { timeout: 120000 }, async () => {
    const token = 'ghp_' + randomAlphanumeric(24);
    const logStart = server.logs().length;
    const response = await postJson(server.baseUrl, '/api/clone-repo', {
      repoUrl: `https://github.com/octocat/inframind-nonexistent-${randomAlphanumeric(12)}`,
      authToken: token
    }, authA);

    assert.equal(response.status, 404, response.text);
    assert.deepEqual(response.json, { error: 'Repository not found or access denied', code: 'REPO_NOT_FOUND' });

    const newLogs = server.logs().slice(logStart);
    const match = newLogs.match(/Clone failed \[REPO_NOT_FOUND\] session=([0-9a-f-]{36})/);
    assert.ok(match, 'server should log one redacted clone failure line');
    const sessionId = match[1];

    const statusText = await (await fetch(`${server.baseUrl}/api/status/${sessionId}`, { headers: authA })).text();
    assert.equal(JSON.parse(statusText).status, 'failed');
    assert.equal(await pathExists(path.join(server.cwd, 'temp', sessionId)), false);

    const tempDir = path.join(server.cwd, 'temp');
    for (const text of [newLogs, response.text, statusText]) {
      assert.ok(!text.includes(token));
      assert.ok(!text.includes(tempDir));
    }
  });

  test('two concurrent clones get separate session directories', { timeout: 120000 }, async () => {
    const [first, second] = await Promise.all([
      postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }, authA),
      postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World.git' }, authA)
    ]);
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 200, second.text);
    assert.notEqual(first.json.sessionId, second.json.sessionId);
    for (const { json } of [first, second]) {
      assert.equal(await pathExists(path.join(server.cwd, 'temp', json.sessionId, 'repo', 'README')), true);
    }
  });
});

// Runs last: covers the output of every server spawned above
test('no server log ever contains a GitHub access token issued in this file', () => {
  assert.ok(allCapturedLogs.length > 0);
  assert.ok(fakes.github.issuedTokens.length > 0, 'a real connection was made above');
  for (const { output } of allCapturedLogs) {
    for (const token of fakes.github.issuedTokens) {
      assert.ok(!output.stdout.includes(token));
      assert.ok(!output.stderr.includes(token));
    }
  }
});
