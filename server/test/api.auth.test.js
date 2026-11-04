// Integration tests for B1.2: Supabase identity, ownership, GitHub access and metrics.
// B1.3 retired the GitHub session JWT and X-GitHub-Token; the tests that used them
// now check that such tokens grant nothing.
// Spawned servers verify tokens against the local fake Supabase (see helpers.js).

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  allCapturedLogs,
  authHeaders,
  closeFakes,
  getFakes,
  getFreePort,
  postJson,
  randomAlphanumeric,
  randomSecret,
  runServerExpectingExit,
  startServer
} from './helpers.js';
import { USER_A } from './fakeSupabase.js';

let fakes;
let authA;
let authB;
const secretsThatMustNotBeLogged = [];

before(async () => {
  fakes = await getFakes();
  authA = authHeaders(fakes.tokens.A);
  authB = authHeaders(fakes.tokens.B);
  secretsThatMustNotBeLogged.push(fakes.tokens.A, fakes.tokens.B);
});
after(async () => { await closeFakes(); });

// An old-style GitHub session JWT (pre-B1.3 format). The server no longer has any
// secret to verify it with, and must ignore it wherever it appears.
const signGitHubJwt = (secret = randomSecret()) => {
  const token = jwt.sign({ id: 1, login: 't', accessToken: 'test-not-a-real-token' }, secret, { expiresIn: '1h' });
  secretsThatMustNotBeLogged.push(token);
  return token;
};

async function request(baseUrl, method, route, { headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, text, json, headers: response.headers };
}

const SAMPLE_ID = crypto.randomUUID();
const PROTECTED_ROUTES = [
  ['POST', '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }],
  ['POST', '/api/analyze', { sessionId: SAMPLE_ID }],
  ['GET', `/api/files/${SAMPLE_ID}`],
  ['GET', `/api/files/${SAMPLE_ID}/dockerfile`],
  ['GET', `/api/status/${SAMPLE_ID}`],
  ['GET', '/api/github/repositories'],
  ['GET', '/api/github/organizations/x/repositories'],
  ['POST', '/api/github/verify-repo', { owner: 'octocat', repo: 'Hello-World' }],
  ['GET', '/api/github/status'],
  ['POST', '/api/github/connect'],
  ['DELETE', '/api/github/connection']
];

describe('anonymous and invalid-token access', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  for (const [method, route, body] of PROTECTED_ROUTES) {
    test(`${method} ${route.replace(SAMPLE_ID, '<uuid>')} without a token is 401 AUTH_REQUIRED`, async () => {
      const response = await request(server.baseUrl, method, route, { body });
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
    });

    test(`${method} ${route.replace(SAMPLE_ID, '<uuid>')} with a garbage token is 401 without calling Supabase`, async () => {
      const before = fakes.supabase.callCount;
      const response = await request(server.baseUrl, method, route, { body, headers: { Authorization: 'Bearer garbage' } });
      assert.equal(response.status, 401);
      assert.equal(response.json?.code, 'AUTH_REQUIRED');
      assert.equal(fakes.supabase.callCount, before, 'garbage tokens are rejected locally');
    });
  }

  test('a GitHub session JWT alone (no Supabase token) is 401 AUTH_REQUIRED', async () => {
    const response = await request(server.baseUrl, 'POST', '/api/clone-repo', {
      headers: { 'X-GitHub-Token': signGitHubJwt() },
      body: { repositoryData: { fullName: 'octocat/Hello-World' } }
    });
    assert.equal(response.status, 401);
    assert.equal(response.json.code, 'AUTH_REQUIRED');
  });

  test('/health and /auth/github stay public, but /auth/github cannot start a flow without a ticket', async () => {
    assert.equal((await fetch(`${server.baseUrl}/health`)).status, 200);
    const oauth = await fetch(`${server.baseUrl}/auth/github`, { redirect: 'manual' });
    assert.equal(oauth.status, 302);
    assert.equal(oauth.headers.get('location'), 'http://localhost:5173/auth/success?error=connect_expired');
    assert.deepEqual(oauth.headers.getSetCookie(), [], 'no OAuth state cookie is issued');
  });
});

describe('Supabase unavailable (fail closed)', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => {
    fakes.supabase.setMode('ok');
    await server?.stop();
  });

  test('HTTP 500 from Supabase is 503 AUTH_UNAVAILABLE', async () => {
    fakes.supabase.setMode('error500');
    const token = fakes.supabase.issueToken(USER_A); // fresh: not in the server's cache
    const response = await request(server.baseUrl, 'GET', `/api/status/${SAMPLE_ID}`, { headers: authHeaders(token) });
    fakes.supabase.setMode('ok');
    assert.equal(response.status, 503);
    assert.deepEqual(response.json, { error: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' });
  });

  test('a hanging Supabase is 503 within about 6 s', { timeout: 15000 }, async () => {
    fakes.supabase.setMode('hang');
    const token = fakes.supabase.issueToken(USER_A);
    const started = Date.now();
    const response = await request(server.baseUrl, 'GET', `/api/status/${SAMPLE_ID}`, { headers: authHeaders(token) });
    const elapsed = Date.now() - started;
    fakes.supabase.setMode('ok');
    assert.equal(response.status, 503);
    assert.equal(response.json.code, 'AUTH_UNAVAILABLE');
    assert.ok(elapsed < 7000, `took ${elapsed} ms`);
  });
});

describe('CORS preflight', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  test('OPTIONS is answered without auth, allows Authorization and no longer allows X-GitHub-Token', async () => {
    const response = await fetch(`${server.baseUrl}/api/clone-repo`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,x-github-token,content-type'
      }
    });
    assert.equal(response.status, 204);
    const allowed = (response.headers.get('access-control-allow-headers') || '').toLowerCase().split(',').map((h) => h.trim());
    assert.ok(allowed.includes('authorization'), `allowed headers: ${allowed}`);
    assert.ok(allowed.includes('content-type'), `allowed headers: ${allowed}`);
    assert.ok(!allowed.includes('x-github-token'), `allowed headers: ${allowed}`);
  });

  test('DELETE is an allowed method (GitHub disconnect)', async () => {
    const response = await fetch(`${server.baseUrl}/api/github/connection`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'authorization' }
    });
    assert.equal(response.status, 204);
    assert.ok((response.headers.get('access-control-allow-methods') || '').includes('DELETE'));
  });
});

describe('session ownership (offline: clone fails through an unreachable proxy)', () => {
  let server;
  let sessionId;

  before(async () => {
    const deadPort = await getFreePort();
    const proxy = `http://127.0.0.1:${deadPort}`;
    server = await startServer({ envOverrides: { HTTPS_PROXY: proxy, https_proxy: proxy } });

    const logStart = server.logs().length;
    const clone = await postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }, authA);
    assert.equal(clone.status, 502);
    const match = server.logs().slice(logStart).match(/Clone failed \[CLONE_FAILED\] session=([0-9a-f-]{36})/);
    assert.ok(match, 'clone failure is logged with its session id');
    sessionId = match[1];
  });
  after(async () => { await server?.stop(); });

  test('status: owner 200, other user 404, anonymous 401', async () => {
    const owner = await request(server.baseUrl, 'GET', `/api/status/${sessionId}`, { headers: authA });
    assert.equal(owner.status, 200);
    assert.equal(owner.json.status, 'failed');

    const other = await request(server.baseUrl, 'GET', `/api/status/${sessionId}`, { headers: authB });
    assert.equal(other.status, 404);
    assert.deepEqual(other.json, { error: 'Session not found' });

    const anonymous = await request(server.baseUrl, 'GET', `/api/status/${sessionId}`);
    assert.equal(anonymous.status, 401);
  });

  test('analyze: owner 400 (not ready), other user 404 (ownership checked first)', async () => {
    const owner = await request(server.baseUrl, 'POST', '/api/analyze', { headers: authA, body: { sessionId } });
    assert.equal(owner.status, 400);
    assert.deepEqual(owner.json, { error: 'Repository not ready for analysis' });

    const other = await request(server.baseUrl, 'POST', '/api/analyze', { headers: authB, body: { sessionId } });
    assert.equal(other.status, 404);
    assert.deepEqual(other.json, { error: 'Session not found' });
  });

  test('files: owner 400 (not completed), other user 404', async () => {
    const owner = await request(server.baseUrl, 'GET', `/api/files/${sessionId}`, { headers: authA });
    assert.equal(owner.status, 400);
    assert.deepEqual(owner.json, { error: 'Analysis not completed' });

    const other = await request(server.baseUrl, 'GET', `/api/files/${sessionId}`, { headers: authB });
    assert.equal(other.status, 404);
  });

  test('download: other user 404', async () => {
    const other = await request(server.baseUrl, 'GET', `/api/files/${sessionId}/dockerfile`, { headers: authB });
    assert.equal(other.status, 404);
    assert.deepEqual(other.json, { error: 'Session not found' });
  });

  test('an unknown UUID is byte-identical to a foreign session', async () => {
    const foreign = await request(server.baseUrl, 'GET', `/api/status/${sessionId}`, { headers: authB });
    const unknown = await request(server.baseUrl, 'GET', `/api/status/${crypto.randomUUID()}`, { headers: authA });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.text, foreign.text);
    assert.equal(unknown.headers.get('content-type'), foreign.headers.get('content-type'));
    assert.equal(unknown.headers.get('content-length'), foreign.headers.get('content-length'));

    for (const route of [`/api/files/${crypto.randomUUID()}`, `/api/files/${crypto.randomUUID()}/dockerfile`]) {
      const unknownFiles = await request(server.baseUrl, 'GET', route, { headers: authA });
      assert.equal(unknownFiles.status, 404);
      assert.equal(unknownFiles.text, foreign.text);
    }
    const unknownAnalyze = await request(server.baseUrl, 'POST', '/api/analyze', { headers: authA, body: { sessionId: crypto.randomUUID() } });
    assert.equal(unknownAnalyze.status, 404);
    assert.equal(unknownAnalyze.text, foreign.text);
  });

  test('a non-UUID session id is 404', async () => {
    for (const [method, route, body] of [
      ['GET', '/api/status/not-a-uuid'],
      ['GET', '/api/files/not-a-uuid'],
      ['GET', '/api/files/not-a-uuid/dockerfile'],
      ['POST', '/api/analyze', { sessionId: 'not-a-uuid' }],
      ['POST', '/api/analyze', {}]
    ]) {
      const response = await request(server.baseUrl, method, route, { headers: authA, body });
      assert.equal(response.status, 404, `${method} ${route}`);
      assert.deepEqual(response.json, { error: 'Session not found' });
    }
  });
});

describe('GitHub access without a stored connection (X-GitHub-Token is dead)', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  const repositoryData = { fullName: 'octocat/Hello-World', name: 'Hello-World', owner: { login: 'octocat' } };

  test('repositoryData clone without a connection is 401 GITHUB_AUTH_REQUIRED', async () => {
    const response = await postJson(server.baseUrl, '/api/clone-repo', { repositoryData }, authA);
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' });
  });

  test('repositoryData clone with a garbage or old-style X-GitHub-Token is still 401 GITHUB_AUTH_REQUIRED', async () => {
    for (const header of ['garbage', signGitHubJwt()]) {
      const response = await postJson(server.baseUrl, '/api/clone-repo', { repositoryData }, { ...authA, 'X-GitHub-Token': header });
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' });
    }
  });

  test('a GitHub JWT in Authorization is not accepted as a Supabase token', async () => {
    const response = await postJson(server.baseUrl, '/api/clone-repo', { repositoryData }, authHeaders(signGitHubJwt()));
    assert.equal(response.status, 401);
    assert.equal(response.json.code, 'AUTH_REQUIRED');
  });

  for (const [method, route, body] of [
    ['GET', '/api/github/repositories'],
    ['GET', '/api/github/organizations/x/repositories'],
    ['POST', '/api/github/verify-repo', { owner: 'octocat', repo: 'Hello-World' }]
  ]) {
    test(`${method} ${route}: no connection is GITHUB_AUTH_REQUIRED, with or without an X-GitHub-Token`, async () => {
      const missing = await request(server.baseUrl, method, route, { headers: authA, body });
      assert.equal(missing.status, 401);
      assert.deepEqual(missing.json, { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' });

      for (const header of ['garbage', signGitHubJwt()]) {
        const ignored = await request(server.baseUrl, method, route, { headers: { ...authA, 'X-GitHub-Token': header }, body });
        assert.equal(ignored.status, 401);
        assert.deepEqual(ignored.json, { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' });
      }
    });
  }
});

describe('metrics and analytics', () => {
  describe('without METRICS_TOKEN', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(async () => { await server?.stop(); });

    for (const route of ['/api/metrics', '/api/analytics']) {
      test(`${route} is 404, even for a signed-in user`, async () => {
        assert.equal((await request(server.baseUrl, 'GET', route)).status, 404);
        assert.equal((await request(server.baseUrl, 'GET', route, { headers: authA })).status, 404);
        assert.equal((await request(server.baseUrl, 'GET', route, { headers: { 'X-Metrics-Token': 'x'.repeat(48) } })).status, 404);
      });
    }
  });

  // B1.4: a short METRICS_TOKEN used to leave the endpoints silently disabled (404);
  // it is now a startup error that names the variable, never the value
  describe('with a short METRICS_TOKEN', () => {
    test('the server refuses to start', async () => {
      const shortToken = randomAlphanumeric(16);
      const result = await runServerExpectingExit({ envOverrides: { METRICS_TOKEN: shortToken }, timeoutMs: 10000 });
      assert.equal(result.code, 1);
      assert.ok(result.stderr.includes('METRICS_TOKEN must be at least 32 characters'), result.stderr);
      assert.ok(!result.stderr.includes(shortToken) && !result.stdout.includes(shortToken));
    });
  });

  describe('with METRICS_TOKEN', () => {
    let server;
    const metricsToken = randomAlphanumeric(48);
    before(async () => {
      secretsThatMustNotBeLogged.push(metricsToken);
      server = await startServer({ envOverrides: { METRICS_TOKEN: metricsToken } });
    });
    after(async () => { await server?.stop(); });

    for (const route of ['/api/metrics', '/api/analytics']) {
      test(`${route}: 404 without or with a wrong header, 200 with the right one`, async () => {
        assert.equal((await request(server.baseUrl, 'GET', route)).status, 404);
        assert.equal((await request(server.baseUrl, 'GET', route, { headers: { 'X-Metrics-Token': randomAlphanumeric(48) } })).status, 404);
        assert.equal((await request(server.baseUrl, 'GET', route, { headers: { 'X-Metrics-Token': metricsToken.slice(0, 47) } })).status, 404);
        assert.equal((await request(server.baseUrl, 'GET', route, { headers: authA })).status, 404, 'a user token is not a metrics token');
        const ok = await request(server.baseUrl, 'GET', route, { headers: { 'X-Metrics-Token': metricsToken } });
        assert.equal(ok.status, 200);
        assert.equal(typeof ok.json, 'object');
      });
    }
  });
});

describe('Supabase configuration startup checks', () => {
  const cases = [
    ['SUPABASE_URL is missing', { SUPABASE_URL: undefined }, 'SUPABASE_URL', null],
    ['SUPABASE_URL is http on a public host', { SUPABASE_URL: 'http://example.com' }, 'SUPABASE_URL', 'http://example.com'],
    ['SUPABASE_URL has a path', { SUPABASE_URL: 'https://x.supabase.co/rest' }, 'SUPABASE_URL', 'x.supabase.co'],
    ['SUPABASE_ANON_KEY is missing', { SUPABASE_ANON_KEY: undefined }, 'SUPABASE_ANON_KEY', null]
  ];

  for (const [label, envOverrides, variable, value] of cases) {
    test(`exits non-zero when ${label}`, async () => {
      const result = await runServerExpectingExit({ envOverrides, timeoutMs: 10000 });
      assert.equal(result.timedOut, false, 'server should exit within 10 s');
      assert.notEqual(result.code, 0);
      assert.ok(result.stderr.includes(variable), `stderr should name ${variable}`);
      if (value) {
        assert.ok(!result.stderr.includes(value), 'stderr must not contain the value');
        assert.ok(!result.stdout.includes(value), 'stdout must not contain the value');
      }
    });
  }

  test('an http SUPABASE_URL on 127.0.0.1 is accepted (local development and tests)', async () => {
    const server = await startServer();
    assert.ok(server.env.SUPABASE_URL.startsWith('http://127.0.0.1:'));
    await server.stop();
  });
});

// Runs last: covers the output of every server spawned in this file
test('no server log ever contains a user token, a GitHub JWT or the metrics token', () => {
  assert.ok(allCapturedLogs.length > 0);
  assert.ok(secretsThatMustNotBeLogged.length >= 3);
  for (const { output } of allCapturedLogs) {
    for (const secret of secretsThatMustNotBeLogged) {
      assert.ok(!output.stdout.includes(secret));
      assert.ok(!output.stderr.includes(secret));
    }
  }
});
