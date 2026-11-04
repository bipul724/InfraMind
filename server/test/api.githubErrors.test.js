// B1.4: GitHub rate limits (503 GITHUB_RATE_LIMITED, never "no access") and GitHub
// timeouts (504 GITHUB_UNAVAILABLE) on every GitHub-backed route, and in the OAuth
// callback, where the token obtained is revoked. Spawned server, fake GitHub.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  authHeaders,
  closeFakes,
  connectGitHubFor,
  getFakes,
  randomAlphanumeric,
  startConnectFlow,
  startServer
} from './helpers.js';

const RATE_LIMITED_BODY = { error: 'GitHub rate limit reached. Please try again later.', code: 'GITHUB_RATE_LIMITED' };
const UNAVAILABLE_BODY = { error: 'GitHub did not respond. Please try again.', code: 'GITHUB_UNAVAILABLE' };
const TIMEOUT_MS = 1000;

let fakes;
let server;
const metricsToken = randomAlphanumeric(48);

before(async () => {
  fakes = await getFakes();
  server = await startServer({ envOverrides: { GITHUB_TIMEOUT_MS: String(TIMEOUT_MS), METRICS_TOKEN: metricsToken, RATE_LIMIT_OAUTH_MAX: '1000' } });
});
afterEach(() => {
  fakes.github.failApiWith(null);
  fakes.github.setApiDelay(0);
});
after(async () => {
  await server?.stop();
  await closeFakes();
});

async function connectedUser() {
  const user = { id: crypto.randomUUID(), email: `${randomAlphanumeric(8)}@example.test` };
  const token = fakes.supabase.issueToken(user);
  const flow = await connectGitHubFor(server, token);
  assert.equal(flow.claim?.status, 200, 'connected');
  return { ...user, auth: authHeaders(token), githubToken: flow.accessToken };
}

const call = async (user, [method, route, body]) => {
  const started = Date.now();
  const response = await fetch(`${server.baseUrl}${route}`, {
    method,
    headers: { ...user.auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, headers: response.headers, json: await response.json().catch(() => null), elapsed: Date.now() - started };
};

const ROUTES = [
  ['GET', '/api/github/repositories'],
  ['GET', '/api/github/organizations/fake-org/repositories'],
  ['POST', '/api/github/verify-repo', { owner: 'octo-a', repo: 'private-one' }],
  ['POST', '/api/clone-repo', { repositoryData: { fullName: 'octo-a/private-one' } }]
];

const clonesTracked = async () => (await (await fetch(`${server.baseUrl}/api/analytics`, { headers: { 'X-Metrics-Token': metricsToken } })).json()).total;

describe('a GitHub rate limit is 503 GITHUB_RATE_LIMITED with Retry-After, never "no access"', () => {
  const scenarios = [
    ['primary limit: 403 with x-ratelimit-remaining: 0', 403,
      () => ({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) }),
      'API rate limit exceeded for user ID 5001.', (value) => value >= 115 && value <= 121],
    ['secondary limit: 403 identified by its message', 403, () => ({}),
      'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.', (value) => value === 60],
    ['429 with retry-after', 429, () => ({ 'retry-after': '30' }), 'Too many requests', (value) => value === 30]
  ];

  for (const [label, status, headers, message, retryAfterOk] of scenarios) {
    test(label, async () => {
      const user = await connectedUser();
      const tracked = await clonesTracked();
      fakes.github.failApiWith(status, { headers: headers(), message });
      for (const route of ROUTES) {
        const response = await call(user, route);
        assert.equal(response.status, 503, `${route[1]}: ${JSON.stringify(response.json)}`);
        assert.deepEqual(response.json, RATE_LIMITED_BODY, route[1]);
        const retryAfter = Number(response.headers.get('retry-after'));
        assert.ok(retryAfterOk(retryAfter), `${route[1]} Retry-After ${response.headers.get('retry-after')}`);
      }
      fakes.github.failApiWith(null);
      // The clone request ended at the access check: no session, no clone attempt
      assert.equal(await clonesTracked(), tracked, 'no clone was attempted');
      // The connection is kept: a rate limit is not a bad token
      assert.equal((await call(user, ['GET', '/api/github/status'])).json.connected, true);
    });
  }

  test('a plain 403 still means no access', async () => {
    const user = await connectedUser();
    fakes.github.failApiWith(403, { message: 'Resource not accessible by integration' });
    const verify = await call(user, ROUTES[2]);
    assert.equal(verify.status, 200);
    assert.deepEqual(verify.json, { hasAccess: false, error: 'Repository not found or no access' });
    const clone = await call(user, ROUTES[3]);
    assert.equal(clone.status, 404);
    assert.equal(clone.json.code, 'REPO_NOT_FOUND');
  });
});

describe('a GitHub timeout is 504 GITHUB_UNAVAILABLE within GITHUB_TIMEOUT_MS + 1 s', () => {
  test('every GitHub-backed route', async () => {
    const user = await connectedUser();
    const tracked = await clonesTracked();
    fakes.github.setApiDelay(5000);
    for (const route of ROUTES) {
      const response = await call(user, route);
      assert.equal(response.status, 504, route[1]);
      assert.deepEqual(response.json, UNAVAILABLE_BODY, route[1]);
      assert.ok(response.elapsed < TIMEOUT_MS + 1000, `${route[1]} took ${response.elapsed} ms`);
      assert.ok(response.elapsed >= TIMEOUT_MS - 50, `${route[1]} waited for the timeout`);
    }
    fakes.github.setApiDelay(0);
    assert.equal(await clonesTracked(), tracked, 'no clone was attempted');
  });
});

describe('OAuth callback: a rate-limited or timed-out user lookup revokes the token obtained', () => {
  const callback = async () => {
    const user = { id: crypto.randomUUID(), email: `${randomAlphanumeric(8)}@example.test` };
    return startConnectFlow(server, fakes.supabase.issueToken(user));
  };
  const revocationsOf = (token) => fakes.github.revokedViaTokenEndpoint().filter((t) => t === token).length;

  test('rate limited', async () => {
    fakes.github.failApiWith(403, { headers: { 'x-ratelimit-remaining': '0' }, message: 'API rate limit exceeded' });
    const flow = await callback();
    assert.ok(flow.location.endsWith('/auth/success?error=github_auth_failed'), flow.location);
    assert.ok(flow.accessToken);
    assert.equal(revocationsOf(flow.accessToken), 1);
  });

  test('timed out', async () => {
    fakes.github.setApiDelay(5000);
    const started = Date.now();
    const flow = await callback();
    assert.ok(Date.now() - started < 5000, 'the callback did not wait for GitHub');
    assert.ok(flow.location.endsWith('/auth/success?error=github_auth_failed'), flow.location);
    assert.equal(revocationsOf(flow.accessToken), 1);
  });
});
