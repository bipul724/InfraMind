// Integration tests for B1.3 and B1.3b: server-side GitHub connections and the claim step.
// Spawned servers + fake Supabase (with PostgREST) + fake GitHub, fully offline.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import {
  allCapturedLogs,
  authHeaders,
  closeFakes,
  claimCompletion,
  connectGitHubFor,
  cookieHeaderFrom,
  getFakes,
  getFreePort,
  makeTempDir,
  postJson,
  randomAlphanumeric,
  randomSecret,
  runServerExpectingExit,
  startConnectFlow,
  startServer
} from './helpers.js';
import { GITHUB_USER_A, GITHUB_USER_B, GRANTED_SCOPE } from './fakeGitHub.js';
import { FAKE_SERVICE_KEY } from './fakePostgrest.js';
import { buildCloneArgs } from '../utils/git.js';

const CLIENT = 'http://localhost:5173';
const PRODUCTION_URLS = { CLIENT_URL: 'https://app.example.test', GITHUB_REDIRECT_URI: 'https://api.example.test/auth/github/callback' };
// B1.3b: the callback delivers only a one-time completion id, claimed by the client
const COMPLETE_LOCATION = /^http:\/\/localhost:5173\/auth\/success\?complete=[0-9a-f]{64}$/;
const errorLocation = (code) => `${CLIENT}/auth/success?error=${code}`;
const GITHUB_AUTH_REQUIRED_BODY = { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' };
const GITHUB_AUTH_INVALID_BODY = { error: 'GitHub session is invalid or expired. Please reconnect GitHub.', code: 'GITHUB_AUTH_INVALID' };
const STORE_UNAVAILABLE_BODY = { error: 'GitHub connection service unavailable', code: 'GITHUB_STORE_UNAVAILABLE' };

let fakes;
const servers = [];
// Every ticket, OAuth state, code, ciphertext and key used in this file: none may be logged
const secrets = new Set();
const remember = (...values) => { for (const value of values) if (value) secrets.add(value); };

before(async () => { fakes = await getFakes(); });
after(async () => { await closeFakes(); });

// B1.4: this file runs dozens of OAuth flows from one IP against one server, more than
// the default oauth limit (30 per 10 min) allows, so it raises that limit (it cannot be
// switched off). The oauth limiter itself is tested in api.limits.test.js.
async function launch(options = {}) {
  const server = await startServer({ ...options, envOverrides: { RATE_LIMIT_OAUTH_MAX: '1000', ...options.envOverrides } });
  servers.push(server);
  remember(server.env.GITHUB_TOKEN_ENC_KEY, server.env.GITHUB_CLIENT_SECRET, server.env.SUPABASE_SERVICE_ROLE_KEY);
  return server;
}

// A fresh Supabase user known to the fake, so scenarios never share connections
function newUser() {
  const user = { id: crypto.randomUUID(), email: `${randomAlphanumeric(8)}@example.test` };
  const token = fakes.supabase.issueToken(user);
  return { ...user, token, auth: authHeaders(token) };
}

async function request(baseUrl, method, route, { headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    redirect: 'manual',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, text, json, headers: response.headers };
}

const status = (server, user) => request(server.baseUrl, 'GET', '/api/github/status', { headers: user.auth });

// Full flow including the claim by the same user
async function connect(server, user, options) {
  const result = await connectGitHubFor(server, user.token, options);
  remember(result.ticket, result.state, result.code, result.completion);
  return result;
}

// Flow up to the callback only; the completion is left unclaimed
async function startFlowFor(server, ticketOwner, options) {
  const result = await startConnectFlow(server, ticketOwner.token, options);
  remember(result.ticket, result.state, result.code, result.completion);
  return result;
}

// Start a flow up to the GitHub redirect (ticket consumed, state cookie issued)
async function startFlow(server, user) {
  const connectResponse = await request(server.baseUrl, 'POST', '/api/github/connect', { headers: user.auth });
  assert.equal(connectResponse.status, 200);
  const { ticket } = connectResponse.json;
  const start = await fetch(`${server.baseUrl}/auth/github?ticket=${encodeURIComponent(ticket)}`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = cookieHeaderFrom(start);
  remember(ticket, state);
  return { ticket, state, cookie };
}

async function callback(server, query, cookie) {
  const response = await fetch(`${server.baseUrl}/auth/github/callback?${query}`, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {}
  });
  return { status: response.status, location: response.headers.get('location'), setCookie: response.headers.getSetCookie() };
}

const assertNoSecretShapes = (text, label) => {
  assert.ok(!text.includes('gho_'), `${label} contains a GitHub token`);
  assert.ok(!text.includes('eyJ'), `${label} contains a JWT`);
  assert.ok(!/token=/i.test(text), `${label} contains token=`);
  assert.ok(!text.includes('v1:'), `${label} contains a ciphertext`);
};

describe('connect flow, status, listing and binding (memory store)', () => {
  let server;
  let userA;
  let userB;
  let connectedA;

  before(async () => {
    server = await launch();
    userA = newUser();
    userB = newUser();
  });

  test('1. connect: the callback stores nothing and redirects with only a completion id; the claim stores it', async () => {
    const result = await startFlowFor(server, userA);

    assert.equal(result.startStatus, 302);
    assert.equal(`${result.authorizeUrl.origin}${result.authorizeUrl.pathname}`, `${fakes.github.url}/login/oauth/authorize`);
    assert.equal(result.authorizeUrl.searchParams.get('client_id'), server.env.GITHUB_CLIENT_ID);
    assert.equal(result.authorizeUrl.searchParams.get('scope'), 'repo,user:email');
    assert.match(result.state, /^[0-9a-f]{64}$/);
    assert.match(result.cookie, /^oauth_state=[0-9a-f]{64}$/);

    assert.equal(result.callbackStatus, 302);
    assert.match(result.location, COMPLETE_LOCATION);
    assertNoSecretShapes(result.location, 'callback Location');
    assert.ok(result.callbackSetCookie.some((c) => /^oauth_state=;/.test(c)), 'the state cookie is cleared');
    assert.match(result.accessToken, /^gho_/);

    // Nothing is stored before the claim
    assert.deepEqual((await status(server, userA)).json, { connected: false });

    const claim = await claimCompletion(server, userA.token, result.completion);
    assert.equal(claim.status, 200, claim.text);
    assert.deepEqual(claim.json, {
      connected: true,
      user: { login: GITHUB_USER_A.login, name: GITHUB_USER_A.name, avatarUrl: GITHUB_USER_A.avatar_url }
    });
    assert.equal(claim.headers.get('cache-control'), 'no-store');
    assertNoSecretShapes(claim.text, 'claim body');
    assert.ok(!claim.text.includes(result.completion));
    connectedA = result;
  });

  test('1. status: A is connected (from the stored record), B is not, and no GitHub call is made', async () => {
    const githubRequests = fakes.github.requests.length;
    const a = await status(server, userA);
    const b = await status(server, userB);
    assert.equal(fakes.github.requests.length, githubRequests, 'status must not call GitHub');

    assert.equal(a.status, 200);
    assert.deepEqual(Object.keys(a.json).sort(), ['connected', 'connectedAt', 'user']);
    assert.equal(a.json.connected, true);
    assert.deepEqual(a.json.user, { login: GITHUB_USER_A.login, name: GITHUB_USER_A.name, avatarUrl: GITHUB_USER_A.avatar_url });
    assert.ok(!Number.isNaN(Date.parse(a.json.connectedAt)));
    assertNoSecretShapes(a.text, 'status body');
    assert.ok(!a.text.includes(connectedA.accessToken));

    assert.equal(b.status, 200);
    assert.deepEqual(b.json, { connected: false });
  });

  test('2. listing: A gets repositories using the decrypted token; B gets GITHUB_AUTH_REQUIRED', async () => {
    const start = fakes.github.requests.length;
    const a = await request(server.baseUrl, 'GET', '/api/github/repositories?page=1&per_page=20', { headers: userA.auth });
    assert.equal(a.status, 200, a.text);
    assert.deepEqual(a.json.user, { login: GITHUB_USER_A.login, name: GITHUB_USER_A.name, avatarUrl: GITHUB_USER_A.avatar_url });
    assert.equal(a.json.repositories.length, 2);
    assert.equal(a.json.organizations[0].login, 'fake-org');
    assert.ok(!a.text.includes(connectedA.accessToken));

    const calls = fakes.github.requestsSince(start);
    assert.deepEqual(calls.map((c) => c.path), ['/user/repos', '/user/orgs']);
    for (const call of calls) assert.equal(call.headers.authorization, `token ${connectedA.accessToken}`);

    const org = await request(server.baseUrl, 'GET', '/api/github/organizations/fake-org/repositories', { headers: userA.auth });
    assert.equal(org.status, 200);
    assert.equal(org.json.repositories[0].fullName, 'fake-org/org-repo');

    const verify = await request(server.baseUrl, 'POST', '/api/github/verify-repo', { headers: userA.auth, body: { owner: 'octo-a', repo: 'private-one' } });
    assert.equal(verify.status, 200);
    assert.equal(verify.json.hasAccess, true);

    const githubRequests = fakes.github.requests.length;
    for (const [method, route, body] of [
      ['GET', '/api/github/repositories'],
      ['GET', '/api/github/organizations/fake-org/repositories'],
      ['POST', '/api/github/verify-repo', { owner: 'octo-a', repo: 'private-one' }]
    ]) {
      const b = await request(server.baseUrl, method, route, { headers: userB.auth, body });
      assert.equal(b.status, 401, route);
      assert.deepEqual(b.json, GITHUB_AUTH_REQUIRED_BODY);
    }
    assert.equal(fakes.github.requests.length, githubRequests, "B's requests never reach GitHub");
  });

  test('2. B cannot select A\'s connection with a user id in the query or the body', async () => {
    const githubRequests = fakes.github.requests.length;
    for (const [method, route, body] of [
      ['GET', `/api/github/repositories?userId=${userA.id}&user_id=${userA.id}`],
      ['GET', `/api/github/organizations/fake-org/repositories?userId=${userA.id}&user_id=${userA.id}`],
      ['POST', '/api/github/verify-repo', { owner: 'octo-a', repo: 'private-one', userId: userA.id, user_id: userA.id }],
      ['POST', '/api/clone-repo', { repositoryData: { fullName: 'octo-a/private-one' }, userId: userA.id, user_id: userA.id }]
    ]) {
      const response = await request(server.baseUrl, method, route, { headers: userB.auth, body });
      assert.equal(response.status, 401, route);
      assert.deepEqual(response.json, GITHUB_AUTH_REQUIRED_BODY);
    }
    const bStatus = await request(server.baseUrl, 'GET', `/api/github/status?userId=${userA.id}&user_id=${userA.id}`, { headers: userB.auth });
    assert.deepEqual(bStatus.json, { connected: false });
    const bDelete = await request(server.baseUrl, 'DELETE', `/api/github/connection?userId=${userA.id}`, { headers: userB.auth, body: { userId: userA.id } });
    assert.equal(bDelete.status, 204);
    assert.equal(fakes.github.requests.length, githubRequests, "nothing reached GitHub with A's token");
    assert.equal((await status(server, userA)).json.connected, true, "A's connection is untouched");
  });

  test('3. /auth/github without a ticket, with an unknown ticket, or with a reused ticket → connect_expired', async () => {
    const user = newUser();
    const noTicket = await request(server.baseUrl, 'GET', '/auth/github');
    const unknown = await request(server.baseUrl, 'GET', `/auth/github?ticket=${crypto.randomBytes(32).toString('hex')}`);
    const repeated = await request(server.baseUrl, 'GET', '/auth/github?ticket=a&ticket=b');

    const issued = await request(server.baseUrl, 'POST', '/api/github/connect', { headers: user.auth });
    assert.equal(issued.status, 200);
    assert.deepEqual(Object.keys(issued.json), ['ticket']);
    assert.match(issued.json.ticket, /^[0-9a-f]{64}$/);
    assert.equal(issued.headers.get('cache-control'), 'no-store');
    remember(issued.json.ticket);
    const first = await request(server.baseUrl, 'GET', `/auth/github?ticket=${issued.json.ticket}`);
    const reused = await request(server.baseUrl, 'GET', `/auth/github?ticket=${issued.json.ticket}`);

    assert.equal(first.status, 302);
    assert.ok(first.headers.get('location').startsWith(`${fakes.github.url}/login/oauth/authorize?`));
    for (const response of [noTicket, unknown, repeated, reused]) {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), errorLocation('connect_expired'));
      assert.deepEqual(response.headers.getSetCookie(), [], 'no state cookie without a valid ticket');
    }
  });

  test('3. POST /api/github/connect without a Supabase token is 401', async () => {
    const anonymous = await request(server.baseUrl, 'POST', '/api/github/connect');
    assert.equal(anonymous.status, 401);
    assert.deepEqual(anonymous.json, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
    const forgedGitHubJwt = jwt.sign({ id: 1, login: 't' }, randomSecret());
    const withOldJwt = await request(server.baseUrl, 'POST', '/api/github/connect', { headers: authHeaders(forgedGitHubJwt) });
    assert.equal(withOldJwt.status, 401);
  });

  test('4. callback abuse: missing or mismatched cookie, replay, access_denied, bad code', async () => {
    const user = newUser();

    // Correct state, no cookie
    let flow = await startFlow(server, user);
    let code = fakes.github.issueCode(GITHUB_USER_A);
    remember(code);
    let result = await callback(server, `code=${code}&state=${flow.state}`);
    assert.equal(result.location, errorLocation('invalid_state'));
    // The pending state was consumed: retrying with the right cookie fails too
    result = await callback(server, `code=${code}&state=${flow.state}`, flow.cookie);
    assert.equal(result.location, errorLocation('invalid_state'));

    // Correct state, mismatched cookie
    flow = await startFlow(server, user);
    code = fakes.github.issueCode(GITHUB_USER_A);
    remember(code);
    result = await callback(server, `code=${code}&state=${flow.state}`, `oauth_state=${crypto.randomBytes(32).toString('hex')}`);
    assert.equal(result.location, errorLocation('invalid_state'));

    // A cookie and state from another flow that were never bound to this state
    const other = await startFlow(server, user);
    result = await callback(server, `code=${code}&state=${flow.state}`, other.cookie);
    assert.equal(result.location, errorLocation('invalid_state'));

    // GitHub reports access_denied
    flow = await startFlow(server, user);
    result = await callback(server, `error=access_denied&error_description=denied&state=${flow.state}`, flow.cookie);
    assert.equal(result.location, errorLocation('access_denied'));

    // A bad code
    flow = await startFlow(server, user);
    result = await callback(server, `code=not-a-real-code&state=${flow.state}`, flow.cookie);
    assert.equal(result.location, errorLocation('github_auth_failed'));

    assert.deepEqual((await status(server, user)).json, { connected: false }, 'nothing was stored by any failed attempt');

    // Replaying a successful callback
    flow = await startFlow(server, user);
    code = fakes.github.issueCode(GITHUB_USER_A);
    remember(code);
    const success = await callback(server, `code=${code}&state=${flow.state}`, flow.cookie);
    assert.match(success.location, COMPLETE_LOCATION);
    remember(new URL(success.location).searchParams.get('complete'));
    const replay = await callback(server, `code=${code}&state=${flow.state}`, flow.cookie);
    assert.equal(replay.location, errorLocation('invalid_state'));
    assert.deepEqual((await status(server, user)).json, { connected: false }, 'an unclaimed callback stores nothing');
  });

  test('5. linking CSRF: a flow started with X\'s ticket and finished in B\'s browser connects nobody', async () => {
    const userX = newUser();
    const ticketResponse = await request(server.baseUrl, 'POST', '/api/github/connect', { headers: userX.auth });
    const { ticket } = ticketResponse.json;
    remember(ticket);

    // B's browser follows the link and completes the flow with B's GitHub account,
    // sending B's Supabase token everywhere: /auth/github* must ignore it
    const supabaseCalls = fakes.supabase.callCount;
    const start = await fetch(`${server.baseUrl}/auth/github?ticket=${ticket}`, { redirect: 'manual', headers: userB.auth });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    remember(state);
    const code = fakes.github.issueCode(GITHUB_USER_B);
    remember(code);
    const done = await fetch(`${server.baseUrl}/auth/github/callback?code=${code}&state=${state}`, {
      redirect: 'manual',
      headers: { ...userB.auth, Cookie: cookieHeaderFrom(start) }
    });
    assert.equal(fakes.supabase.callCount, supabaseCalls, '/auth/github* never reads a Supabase token');
    assert.match(done.headers.get('location'), COMPLETE_LOCATION);
    const completion = new URL(done.headers.get('location')).searchParams.get('complete');
    remember(completion);

    // B's page claims it as B: refused, and nothing is stored for anyone
    const claim = await claimCompletion(server, userB.token, completion);
    assert.equal(claim.status, 403);
    assert.equal(claim.json.code, 'GITHUB_CONNECT_MISMATCH');
    assert.deepEqual((await status(server, userX)).json, { connected: false });
    assert.deepEqual((await status(server, userB)).json, { connected: false });
  });

  test('6. disconnect revokes the single token, deletes the record and is idempotent', async () => {
    const user = newUser();
    const { accessToken } = await connect(server, user);
    const otherUser = newUser();
    await connect(server, otherUser);

    const start = fakes.github.requests.length;
    const first = await request(server.baseUrl, 'DELETE', '/api/github/connection', { headers: user.auth });
    assert.equal(first.status, 204);
    assert.equal(first.text, '');

    const revocations = fakes.github.requestsSince(start).filter((r) => r.method === 'DELETE');
    assert.equal(revocations.length, 1);
    const [revocation] = revocations;
    assert.equal(revocation.path, `/applications/${server.env.GITHUB_CLIENT_ID}/token`);
    const expectedBasic = Buffer.from(`${server.env.GITHUB_CLIENT_ID}:${server.env.GITHUB_CLIENT_SECRET}`).toString('base64');
    assert.equal(revocation.headers.authorization, `Basic ${expectedBasic}`);
    assert.deepEqual(revocation.body, { access_token: accessToken });
    assert.ok(fakes.github.isRevoked(accessToken));

    assert.deepEqual((await status(server, user)).json, { connected: false });
    assert.equal((await status(server, otherUser)).json.connected, true, "another user's connection is untouched");
    // Both users connected the same GitHub account: the other user's token still works
    const otherListing = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers: otherUser.auth });
    assert.equal(otherListing.status, 200);

    const again = fakes.github.requests.length;
    const second = await request(server.baseUrl, 'DELETE', '/api/github/connection', { headers: user.auth });
    assert.equal(second.status, 204);
    assert.equal(fakes.github.requests.length, again, 'nothing to revoke the second time');
  });

  test('6. a failed revocation still deletes the record and logs only the status', async () => {
    const user = newUser();
    await connect(server, user);
    const logStart = server.logs().length;
    fakes.github.setRevokeStatus(500);
    try {
      const response = await request(server.baseUrl, 'DELETE', '/api/github/connection', { headers: user.auth });
      assert.equal(response.status, 204);
    } finally {
      fakes.github.setRevokeStatus(204);
    }
    assert.deepEqual((await status(server, user)).json, { connected: false });
    const newLogs = server.logs().slice(logStart);
    assert.ok(newLogs.includes('token revocation failed: HTTP 500'), newLogs);
  });

  test('7. a token revoked at GitHub: the next call is GITHUB_AUTH_INVALID and the connection is dropped', async () => {
    const user = newUser();
    const { accessToken } = await connect(server, user);
    fakes.github.revokeToken(accessToken);

    const response = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers: user.auth });
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, GITHUB_AUTH_INVALID_BODY);
    assert.deepEqual((await status(server, user)).json, { connected: false });

    const after = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers: user.auth });
    assert.deepEqual(after.json, GITHUB_AUTH_REQUIRED_BODY);
  });

  for (const [label, method, route, body] of [
    ['org listing', 'GET', '/api/github/organizations/fake-org/repositories'],
    ['verify-repo', 'POST', '/api/github/verify-repo', { owner: 'octo-a', repo: 'private-one' }]
  ]) {
    test(`7. ${label}: a GitHub 401 also drops the connection`, async () => {
      const user = newUser();
      const { accessToken } = await connect(server, user);
      fakes.github.revokeToken(accessToken);
      const response = await request(server.baseUrl, method, route, { headers: user.auth, body });
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, GITHUB_AUTH_INVALID_BODY);
      assert.deepEqual((await status(server, user)).json, { connected: false });
    });
  }

  test('7. other GitHub failures keep the connection', async () => {
    const user = newUser();
    await connect(server, user);
    fakes.github.failApiWith(500);
    try {
      const response = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers: user.auth });
      assert.equal(response.status, 500);
      assert.deepEqual(response.json, { error: 'Failed to fetch repositories' });
      const forbidden = await request(server.baseUrl, 'POST', '/api/github/verify-repo', { headers: user.auth, body: { owner: 'o', repo: 'r' } });
      assert.equal(forbidden.status, 500);
    } finally {
      fakes.github.failApiWith(null);
    }
    assert.equal((await status(server, user)).json.connected, true);
  });

  test('9. X-GitHub-Token is dead: an old-style GitHub JWT without a connection is GITHUB_AUTH_REQUIRED', async () => {
    const user = newUser();
    const oldJwt = jwt.sign({ id: 1, login: 't', accessToken: `gho_${randomAlphanumeric(36)}` }, randomSecret(), { expiresIn: '1h' });
    remember(oldJwt);
    const headers = { ...user.auth, 'X-GitHub-Token': oldJwt };
    const listing = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers });
    assert.equal(listing.status, 401);
    assert.deepEqual(listing.json, GITHUB_AUTH_REQUIRED_BODY);
    const clone = await request(server.baseUrl, 'POST', '/api/clone-repo', { headers, body: { repositoryData: { fullName: 'octo-a/private-one' } } });
    assert.equal(clone.status, 401);
    assert.deepEqual(clone.json, GITHUB_AUTH_REQUIRED_BODY);
  });

  test('9. the CORS preflight no longer lists x-github-token', async () => {
    const response = await fetch(`${server.baseUrl}/api/github/repositories`, {
      method: 'OPTIONS',
      headers: { Origin: CLIENT, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-github-token' }
    });
    const allowed = (response.headers.get('access-control-allow-headers') || '').toLowerCase().split(',').map((h) => h.trim());
    assert.ok(!allowed.includes('x-github-token'), allowed.join(','));
    assert.ok(allowed.includes('authorization'));
  });

  test('request logs redact ticket, code and state', () => {
    const logs = server.logs();
    assert.ok(logs.includes('/auth/github?ticket=REDACTED'), 'ticket is redacted');
    assert.ok(/\/auth\/github\/callback\?code=REDACTED&state=REDACTED/.test(logs), 'code and state are redacted');
  });
});

async function waitFor(predicate, timeoutMs = 3000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const MISMATCH_BODY = {
  error: 'This GitHub connection was started from a different InfraMind account. Nothing was connected. Please connect GitHub again.',
  code: 'GITHUB_CONNECT_MISMATCH'
};
const EXPIRED_BODY = { error: 'The connection link expired. Please connect GitHub again.', code: 'GITHUB_CONNECT_EXPIRED' };
const discard = (server, body) => request(server.baseUrl, 'POST', '/auth/github/discard', { body });

describe('B1.3b claim step (memory store)', () => {
  let server;
  before(async () => { server = await launch(); });

  test('2. linking CSRF regression: the victim\'s token is never stored for the attacker, and is revoked', async () => {
    const attacker = newUser();
    const victim = newUser();
    const stderrStart = server.output.stderr.length;
    const stdoutStart = server.output.stdout.length;

    // The attacker obtains a ticket; the victim's browser finishes the flow with the victim's GitHub account
    const flow = await startFlowFor(server, attacker, { githubUser: GITHUB_USER_B, callbackHeaders: victim.auth });
    assert.match(flow.location, COMPLETE_LOCATION);
    assert.match(flow.accessToken, /^gho_/);

    const claim = await claimCompletion(server, victim.token, flow.completion);
    assert.equal(claim.status, 403);
    assert.deepEqual(claim.json, MISMATCH_BODY);
    for (const leak of [attacker.id, attacker.email, attacker.token, GITHUB_USER_B.login, flow.accessToken, flow.completion]) {
      assert.ok(!claim.text.includes(leak), 'the mismatch response reveals nothing about either account');
    }

    assert.ok(fakes.github.revokedViaTokenEndpoint().includes(flow.accessToken), "the victim's token was revoked via /token");
    assert.deepEqual((await status(server, attacker)).json, { connected: false });
    assert.deepEqual((await status(server, victim)).json, { connected: false });
    const attackerListing = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers: attacker.auth });
    assert.equal(attackerListing.status, 401);
    assert.deepEqual(attackerListing.json, GITHUB_AUTH_REQUIRED_BODY);

    const newLogs = `${server.output.stdout.slice(stdoutStart)}\n${server.output.stderr.slice(stderrStart)}`;
    assert.ok(newLogs.includes('github connect completion refused: account mismatch'));
    for (const leak of [attacker.id, attacker.email, victim.id, victim.email, GITHUB_USER_B.login]) {
      assert.ok(!newLogs.includes(leak), 'the mismatch log names nobody');
    }
  });

  test('3. single use: a second claim, or a claim after a mismatch, is GITHUB_CONNECT_EXPIRED', async () => {
    const owner = newUser();
    const flow = await startFlowFor(server, owner);
    assert.equal((await claimCompletion(server, owner.token, flow.completion)).status, 200);
    const second = await claimCompletion(server, owner.token, flow.completion);
    assert.equal(second.status, 400);
    assert.deepEqual(second.json, EXPIRED_BODY);

    // A mismatch burns the completion: the rightful owner cannot claim it afterwards
    const owner2 = newUser();
    const stranger = newUser();
    const flow2 = await startFlowFor(server, owner2);
    assert.equal((await claimCompletion(server, stranger.token, flow2.completion)).status, 403);
    const late = await claimCompletion(server, owner2.token, flow2.completion);
    assert.equal(late.status, 400);
    assert.deepEqual(late.json, EXPIRED_BODY);
    assert.deepEqual((await status(server, owner2)).json, { connected: false });

    const unknown = await claimCompletion(server, owner.token, crypto.randomBytes(32).toString('hex'));
    assert.deepEqual(unknown.json, EXPIRED_BODY);
  });

  test('5. discard: a live completion is burned and revoked; unknown, garbage and bad bodies are 204 with no revocation', async () => {
    const owner = newUser();
    const flow = await startFlowFor(server, owner);
    const live = await discard(server, { completion: flow.completion });
    assert.equal(live.status, 204);
    assert.equal(live.text, '');
    await waitFor(() => fakes.github.revokedViaTokenEndpoint().includes(flow.accessToken), 3000, 'the discard revocation');
    const claim = await claimCompletion(server, owner.token, flow.completion);
    assert.equal(claim.status, 400);
    assert.deepEqual(claim.json, EXPIRED_BODY);

    const revocationsBefore = fakes.github.tokenRevocations.length;
    const responses = [];
    for (const body of [
      { completion: crypto.randomBytes(32).toString('hex') }, // unknown
      { completion: 'garbage' },
      { completion: 42 },
      {},
      [flow.completion]
    ]) {
      responses.push(await discard(server, body));
    }
    for (const response of responses) {
      assert.equal(response.status, 204);
      assert.equal(response.text, '');
    }
    // Unknown and live ids answer byte-for-byte the same
    assert.equal(responses[0].headers.get('content-length'), live.headers.get('content-length'));

    const malformed = await fetch(`${server.baseUrl}/auth/github/discard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(malformed.status, 400, 'malformed JSON is rejected by the global JSON parser, as for every route');

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(fakes.github.tokenRevocations.length, revocationsBefore, 'no revocation for unknown or invalid ids');
  });

  test('8. reconnecting replaces the connection and revokes only the old token', async () => {
    const user = newUser();
    const first = await connect(server, user, { githubUser: GITHUB_USER_A });
    assert.equal(first.claim.status, 200);
    const revocationsBefore = fakes.github.tokenRevocations.length;

    const second = await connect(server, user, { githubUser: GITHUB_USER_B });
    assert.equal(second.claim.status, 200);
    assert.notEqual(first.accessToken, second.accessToken);

    assert.equal((await status(server, user)).json.user.login, GITHUB_USER_B.login);
    const revoked = fakes.github.tokenRevocations.slice(revocationsBefore).map((r) => r.body.access_token);
    assert.deepEqual(revoked, [first.accessToken], 'exactly the old token was revoked');

    const listing = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers: user.auth });
    assert.equal(listing.status, 200, 'the new token works');
  });

  test('9. revocation uses /applications/:client_id/token with Basic auth and the token', async () => {
    const user = newUser();
    const { accessToken } = await connect(server, user);
    const before = fakes.github.tokenRevocations.length;
    assert.equal((await request(server.baseUrl, 'DELETE', '/api/github/connection', { headers: user.auth })).status, 204);
    const [revocation] = fakes.github.tokenRevocations.slice(before);
    assert.equal(revocation.clientId, server.env.GITHUB_CLIENT_ID);
    const expectedBasic = Buffer.from(`${server.env.GITHUB_CLIENT_ID}:${server.env.GITHUB_CLIENT_SECRET}`).toString('base64');
    assert.equal(revocation.authorization, `Basic ${expectedBasic}`);
    assert.deepEqual(revocation.body, { access_token: accessToken });
  });

  test('10. a getUserInfo failure after the code exchange revokes the issued token', async () => {
    const user = newUser();
    fakes.github.failApiWith(500);
    let flow;
    try {
      flow = await startFlowFor(server, user);
    } finally {
      fakes.github.failApiWith(null);
    }
    assert.equal(flow.location, errorLocation('github_auth_failed'));
    assert.match(flow.accessToken, /^gho_/, 'the code exchange did issue a token');
    assert.ok(fakes.github.revokedViaTokenEndpoint().includes(flow.accessToken));
    assert.deepEqual((await status(server, user)).json, { connected: false });
  });

  test('11. a completion id in a server URL is logged as complete=REDACTED', async () => {
    const completion = crypto.randomBytes(32).toString('hex');
    remember(completion);
    await fetch(`${server.baseUrl}/auth/success?complete=${completion}`);
    // The request log line is written when the response finishes
    await waitFor(() => server.logs().includes('/auth/success?complete=REDACTED'), 3000, 'the redacted request log line');
    assert.ok(!server.logs().includes(completion));
  });

  test('12. CORS allows the claim and the discard from the client origin', async () => {
    for (const route of ['/api/github/connect/complete', '/auth/github/discard']) {
      const response = await fetch(`${server.baseUrl}${route}`, {
        method: 'OPTIONS',
        headers: { Origin: CLIENT, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' }
      });
      assert.equal(response.status, 204, route);
      assert.equal(response.headers.get('access-control-allow-origin'), CLIENT);
      const methods = (response.headers.get('access-control-allow-methods') || '').split(',');
      assert.ok(methods.includes('POST'), route);
      const allowed = (response.headers.get('access-control-allow-headers') || '').toLowerCase().split(',').map((h) => h.trim());
      assert.ok(allowed.includes('content-type') && allowed.includes('authorization'), allowed.join(','));
      assert.ok(!allowed.includes('x-github-token'));
    }
  });
});

describe('4. completion expiry (GITHUB_CONNECT_COMPLETION_TTL_MS=1000)', () => {
  let server;
  before(async () => { server = await launch({ envOverrides: { GITHUB_CONNECT_COMPLETION_TTL_MS: '1000' } }); });

  test('an expired completion is revoked by the next sweep and can no longer be claimed', async () => {
    const user = newUser();
    const flow = await startFlowFor(server, user);
    assert.match(flow.location, COMPLETE_LOCATION);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.ok(!fakes.github.revokedViaTokenEndpoint().includes(flow.accessToken), 'not revoked before any sweep');

    // Any access to the completion store sweeps it: here an unrelated discard. The
    // test never sends this completion id anywhere before the revocation is seen.
    assert.ok(!server.output.stdout.includes('github connect completion expired'));
    assert.equal((await discard(server, { completion: crypto.randomBytes(32).toString('hex') })).status, 204);
    await waitFor(() => fakes.github.revokedViaTokenEndpoint().includes(flow.accessToken), 3000, 'the expiry revocation');
    await waitFor(() => server.output.stdout.includes('github connect completion expired'), 3000, 'the expiry log line');

    const claim = await claimCompletion(server, user.token, flow.completion);
    assert.equal(claim.status, 400);
    assert.deepEqual(claim.json, EXPIRED_BODY);
    assert.deepEqual((await status(server, user)).json, { connected: false });
  });

  test('an out-of-range TTL falls back to 5 minutes with a warning', async () => {
    const tuned = await launch({ envOverrides: { GITHUB_CONNECT_COMPLETION_TTL_MS: '999' } });
    assert.ok(tuned.logs().includes('GITHUB_CONNECT_COMPLETION_TTL_MS must be an integer from 1000 to 300000; using the default'));
    const user = newUser();
    const flow = await startFlowFor(tuned, user);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal((await claimCompletion(tuned, user.token, flow.completion)).status, 200, 'still valid after 1.1 s');
  });

  test('an invalid TTL is reported without its value', async () => {
    const value = `ttl-${randomAlphanumeric(12)}`;
    const tuned = await launch({ envOverrides: { GITHUB_CONNECT_COMPLETION_TTL_MS: value } });
    assert.ok(tuned.logs().includes('GITHUB_CONNECT_COMPLETION_TTL_MS must be an integer'));
    assert.ok(!tuned.logs().includes(value));
  });
});

describe('8. clone path with a stored connection (offline: git goes through an unreachable proxy)', () => {
  let server;
  before(async () => {
    const deadPort = await getFreePort();
    const proxy = `http://127.0.0.1:${deadPort}`;
    server = await launch({ envOverrides: { HTTPS_PROXY: proxy, https_proxy: proxy, CLONE_TIMEOUT_MS: '20000' } });
  });

  test('repositoryData clone uses the stored token for the access check; git then fails with the public error', async () => {
    const user = newUser();
    const { accessToken } = await connect(server, user);
    const start = fakes.github.requests.length;
    const logStart = server.logs().length;

    const response = await postJson(server.baseUrl, '/api/clone-repo', { repositoryData: { fullName: 'octo-a/private-one' } }, user.auth);
    assert.equal(response.status, 502, response.text);
    assert.deepEqual(response.json, { error: 'Failed to clone repository', code: 'CLONE_FAILED' });

    const calls = fakes.github.requestsSince(start);
    assert.deepEqual(calls.map((c) => c.path), ['/repos/octo-a/private-one']);
    assert.equal(calls[0].headers.authorization, `token ${accessToken}`);

    const newLogs = server.logs().slice(logStart);
    assert.match(newLogs, /Clone failed \[CLONE_FAILED\] session=[0-9a-f-]{36} repo=octo-a\/private-one/);
    assert.ok(!newLogs.includes(accessToken));
    assert.ok(!response.text.includes(accessToken));
  });

  test('without a connection: 401 GITHUB_AUTH_REQUIRED and no GitHub call', async () => {
    const user = newUser();
    const start = fakes.github.requests.length;
    const response = await postJson(server.baseUrl, '/api/clone-repo', { repositoryData: { fullName: 'octo-a/private-one' } }, user.auth);
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, GITHUB_AUTH_REQUIRED_BODY);
    assert.equal(fakes.github.requests.length, start);
  });

  test('traversal in repositoryData with a connection: 400 before any GitHub call', async () => {
    const user = newUser();
    await connect(server, user);
    const start = fakes.github.requests.length;
    for (const repositoryData of [
      { fullName: '../../../../escaped/x' },
      { name: '../../../../escaped', owner: { login: '..' } },
      { fullName: 'octo-a/private-one/../../x' }
    ]) {
      const response = await postJson(server.baseUrl, '/api/clone-repo', { repositoryData }, user.auth);
      assert.equal(response.status, 400, JSON.stringify(repositoryData));
      assert.deepEqual(response.json, { error: 'Invalid repository data' });
    }
    assert.equal(fakes.github.requests.length, start);
    const entries = await fs.readdir(path.join(server.cwd, 'temp')).catch(() => []);
    assert.ok(!entries.includes('escaped'));
  });

  test('a token revoked at GitHub: the clone is 401 GITHUB_AUTH_INVALID and the connection is dropped', async () => {
    const user = newUser();
    const { accessToken } = await connect(server, user);
    fakes.github.revokeToken(accessToken);
    const response = await postJson(server.baseUrl, '/api/clone-repo', { repositoryData: { fullName: 'octo-a/private-one' } }, user.auth);
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, GITHUB_AUTH_INVALID_BODY);
    assert.deepEqual((await status(server, user)).json, { connected: false });
  });

  test('the GitHub base URL variables never change the git clone URL', () => {
    const saved = { oauth: process.env.GITHUB_OAUTH_BASE_URL, api: process.env.GITHUB_API_BASE_URL };
    process.env.GITHUB_OAUTH_BASE_URL = 'http://127.0.0.1:1';
    process.env.GITHUB_API_BASE_URL = 'http://127.0.0.1:2';
    try {
      const args = buildCloneArgs({ owner: 'octo-a', repo: 'private-one' }, '/tmp/x');
      assert.ok(args.includes('https://github.com/octo-a/private-one.git'));
      assert.ok(!args.some((arg) => arg.includes('127.0.0.1')));
    } finally {
      for (const [key, value] of [['GITHUB_OAUTH_BASE_URL', saved.oauth], ['GITHUB_API_BASE_URL', saved.api]]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('10. supabase store: works end to end, and an outage never fails open', () => {
  let server;
  let otherAfterOutage;
  before(async () => {
    server = await launch({ envOverrides: { GITHUB_TOKEN_STORE: 'supabase', SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY } });
  });
  after(() => { fakes.postgrest.setMode('ok'); });

  test('a connection is stored as ciphertext only, with the service key, and read back', async () => {
    const user = newUser();
    const requestStart = fakes.postgrest.requests.length;
    const { accessToken, location, claim } = await connect(server, user);
    assert.match(location, COMPLETE_LOCATION);
    assert.equal(claim.status, 200, claim.text);

    const row = fakes.postgrest.rows.get(user.id);
    assert.ok(row, 'a row exists for the user');
    remember(row.token_ciphertext);
    assert.match(row.token_ciphertext, /^v1:/);
    assert.equal(row.github_login, GITHUB_USER_A.login);
    assert.equal(row.scopes, GRANTED_SCOPE);
    for (const recorded of fakes.postgrest.requests.slice(requestStart)) {
      assert.ok(!JSON.stringify(recorded).includes(accessToken), 'the plaintext token never reaches PostgREST');
      assert.equal(recorded.headers.apikey, FAKE_SERVICE_KEY);
    }

    const current = await status(server, user);
    assert.equal(current.json.connected, true);
    const listing = await request(server.baseUrl, 'GET', '/api/github/repositories', { headers: user.auth });
    assert.equal(listing.status, 200);

    assert.equal((await request(server.baseUrl, 'DELETE', '/api/github/connection', { headers: user.auth })).status, 204);
    assert.equal(fakes.postgrest.rows.has(user.id), false);
  });

  test('PostgREST 500: status, listing, clone, disconnect and the claim are 503; nothing fails open', async () => {
    const user = newUser();
    const { accessToken } = await connect(server, user);
    for (const recorded of fakes.postgrest.requests) {
      if (recorded.method === 'POST') remember(JSON.parse(recorded.body).token_ciphertext);
    }
    const githubRequests = fakes.github.requests.length;

    fakes.postgrest.setMode('error500');
    try {
      for (const [method, route, body] of [
        ['GET', '/api/github/status'],
        ['GET', '/api/github/repositories'],
        ['GET', '/api/github/organizations/fake-org/repositories'],
        ['POST', '/api/github/verify-repo', { owner: 'octo-a', repo: 'private-one' }],
        ['POST', '/api/clone-repo', { repositoryData: { fullName: 'octo-a/private-one' } }],
        ['DELETE', '/api/github/connection']
      ]) {
        const response = await request(server.baseUrl, method, route, { headers: user.auth, body });
        assert.equal(response.status, 503, `${method} ${route}: ${response.text}`);
        assert.deepEqual(response.json, STORE_UNAVAILABLE_BODY);
      }
      assert.equal(fakes.github.requests.length, githubRequests, 'no GitHub call is made without the store');
      assert.ok(!fakes.github.isRevoked(accessToken), 'disconnect did not pretend to succeed');

      // B1.3b: the callback no longer touches the store; the claim does (F.3.7)
      const other = newUser();
      const flow = await startFlowFor(server, other);
      assert.match(flow.location, COMPLETE_LOCATION);
      const claim = await claimCompletion(server, other.token, flow.completion);
      assert.equal(claim.status, 503);
      assert.deepEqual(claim.json, STORE_UNAVAILABLE_BODY);
      assert.ok(fakes.github.revokedViaTokenEndpoint().includes(flow.accessToken), 'the unstored token was revoked');
      assert.ok(fakes.github.isRevoked(flow.accessToken));
      otherAfterOutage = other;
    } finally {
      fakes.postgrest.setMode('ok');
    }
    assert.equal((await status(server, user)).json.connected, true, 'the outage did not delete the connection');
    assert.deepEqual((await status(server, otherAfterOutage)).json, { connected: false }, 'nothing was stored for the claim that failed');
  });

  test('6. claim validation: anonymous is 401; malformed completions are 400 INVALID_REQUEST with no store or GitHub call', async () => {
    const user = newUser();
    const anonymous = await claimCompletion(server, null, crypto.randomBytes(32).toString('hex'));
    assert.equal(anonymous.status, 401);
    assert.deepEqual(anonymous.json, { error: 'Authentication required', code: 'AUTH_REQUIRED' });

    const storeRequests = fakes.postgrest.requests.length;
    const githubRequests = fakes.github.requests.length;
    const hex = crypto.randomBytes(32).toString('hex');
    for (const body of [
      {},
      { completion: null },
      { completion: 42 },
      { completion: [hex] },
      { completion: hex.slice(0, 63) },
      { completion: `${hex}0` },
      { completion: 'g'.repeat(64) },
      { completion: `${hex.slice(0, 62)} ` }
    ]) {
      const response = await request(server.baseUrl, 'POST', '/api/github/connect/complete', { headers: user.auth, body });
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.deepEqual(response.json, { error: 'Invalid request', code: 'INVALID_REQUEST' });
    }
    assert.equal(fakes.postgrest.requests.length, storeRequests, 'no store call');
    assert.equal(fakes.github.requests.length, githubRequests, 'no GitHub call');
  });
});

describe('12. startup refuses an invalid GitHub token store configuration', () => {
  const invalidStore = `postgres-${randomAlphanumeric(8)}`;
  const shortKey = crypto.randomBytes(31).toString('base64');
  const urlSafeKey = crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') + '-';
  const cases = [
    ['GITHUB_TOKEN_STORE is missing', { GITHUB_TOKEN_STORE: undefined }, 'GITHUB_TOKEN_STORE', null],
    ['GITHUB_TOKEN_STORE is invalid', { GITHUB_TOKEN_STORE: invalidStore }, 'GITHUB_TOKEN_STORE', invalidStore],
    ['GITHUB_TOKEN_ENC_KEY is missing', { GITHUB_TOKEN_ENC_KEY: undefined }, 'GITHUB_TOKEN_ENC_KEY', null],
    ['GITHUB_TOKEN_ENC_KEY is 31 bytes', { GITHUB_TOKEN_ENC_KEY: shortKey }, 'GITHUB_TOKEN_ENC_KEY', shortKey],
    ['GITHUB_TOKEN_ENC_KEY is not standard base64', { GITHUB_TOKEN_ENC_KEY: urlSafeKey }, 'GITHUB_TOKEN_ENC_KEY', urlSafeKey],
    ['GITHUB_TOKEN_STORE=supabase has no service key', { GITHUB_TOKEN_STORE: 'supabase', SUPABASE_SERVICE_ROLE_KEY: undefined }, 'SUPABASE_SERVICE_ROLE_KEY', null]
  ];

  for (const [label, envOverrides, variable, value] of cases) {
    test(`exits non-zero when ${label}`, async () => {
      const result = await runServerExpectingExit({ envOverrides, timeoutMs: 10000 });
      assert.equal(result.timedOut, false, 'server should exit within 10 s');
      assert.notEqual(result.code, 0);
      assert.ok(result.stderr.includes(variable), `stderr should name ${variable}: ${result.stderr}`);
      if (value) {
        assert.ok(!result.stderr.includes(value), 'stderr must not contain the value');
        assert.ok(!result.stdout.includes(value), 'stdout must not contain the value');
      }
    });
  }

  test('JWT_SECRET is no longer required or read', async () => {
    const server = await launch({ envOverrides: { JWT_SECRET: undefined } });
    assert.equal((await fetch(`${server.baseUrl}/health`)).status, 200);
  });

  test('memory in production starts with a warning', async () => {
    // B1.4: production requires https CLIENT_URL and GITHUB_REDIRECT_URI
    const server = await launch({ envOverrides: { NODE_ENV: 'production', ...PRODUCTION_URLS } });
    assert.ok(server.logs().includes('GITHUB_TOKEN_STORE=memory: GitHub connections are lost on every restart'));
  });

  test('an invalid GITHUB_OAUTH_BASE_URL falls back to github.com with a warning that hides the value', async () => {
    const bad = `http://example-${randomAlphanumeric(6)}.test`;
    const server = await launch({ envOverrides: { GITHUB_OAUTH_BASE_URL: bad } });
    const user = newUser();
    const { ticket } = (await request(server.baseUrl, 'POST', '/api/github/connect', { headers: user.auth })).json;
    remember(ticket);
    const start = await request(server.baseUrl, 'GET', `/auth/github?ticket=${ticket}`);
    remember(new URL(start.headers.get('location')).searchParams.get('state'));
    assert.ok(start.headers.get('location').startsWith('https://github.com/login/oauth/authorize?'));
    assert.ok(server.logs().includes('GITHUB_OAUTH_BASE_URL must use https'));
    assert.ok(!server.logs().includes(bad));
  });
});

describe('13. NEW-01: .env is loaded before modules read the GitHub configuration', () => {
  test('the authorize redirect uses GITHUB_CLIENT_ID and GITHUB_OAUTH_BASE_URL from .env', async () => {
    const cwd = await makeTempDir();
    const clientId = `Iv1.${randomAlphanumeric(16)}`;
    await fs.writeFile(path.join(cwd, '.env'), `GITHUB_CLIENT_ID=${clientId}\nGITHUB_OAUTH_BASE_URL=${fakes.github.url}\n`);
    const server = await launch({
      cwd,
      envOverrides: { GITHUB_CLIENT_ID: undefined, GITHUB_OAUTH_BASE_URL: undefined, DOTENV_CONFIG_PATH: undefined }
    });
    assert.equal(server.env.GITHUB_CLIENT_ID, undefined);
    assert.equal(server.env.GITHUB_OAUTH_BASE_URL, undefined);

    const user = newUser();
    const { ticket } = (await request(server.baseUrl, 'POST', '/api/github/connect', { headers: user.auth })).json;
    remember(ticket);
    const start = await request(server.baseUrl, 'GET', `/auth/github?ticket=${ticket}`);
    const location = new URL(start.headers.get('location'));
    remember(location.searchParams.get('state'));
    assert.equal(`${location.origin}${location.pathname}`, `${fakes.github.url}/login/oauth/authorize`);
    assert.equal(location.searchParams.get('client_id'), clientId);
  });
});

// Runs last: covers every server spawned in this file
test('11. no log contains a GitHub token, ciphertext, ticket, state, code, completion id, encryption key or service key; no /grant call', async () => {
  for (const server of servers) await server.stop();
  remember(...fakes.github.issuedTokens, ...fakes.github.issuedCodes, FAKE_SERVICE_KEY);
  assert.ok(fakes.github.issuedTokens.length >= 5);
  assert.ok(secrets.size >= 20, `collected ${secrets.size} secrets`);
  assert.ok(allCapturedLogs.length >= servers.length);

  assert.equal(fakes.github.grantCalls.length, 0, 'nothing ever calls the /grant endpoint');
  assert.ok(!fakes.github.requests.some((r) => r.path.endsWith('/grant')));
  assert.ok(fakes.github.tokenRevocations.length >= 5, 'revocations went through /token');

  for (const { output } of allCapturedLogs) {
    const text = `${output.stdout}\n${output.stderr}`;
    for (const secret of secrets) {
      assert.ok(!text.includes(secret), `a secret of length ${secret.length} appears in a server log`);
    }
    assert.ok(!text.includes('gho_'), 'no GitHub token shape in logs');
    assert.ok(!/v1:[A-Za-z0-9+/=]{8,}:/.test(text), 'no ciphertext shape in logs');
  }
});
