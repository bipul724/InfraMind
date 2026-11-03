// Integration tests for B1.3: server-side GitHub connections.
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
  connectGitHubFor,
  cookieHeaderFrom,
  getFakes,
  getFreePort,
  makeTempDir,
  postJson,
  randomAlphanumeric,
  randomSecret,
  runServerExpectingExit,
  startServer
} from './helpers.js';
import { GITHUB_USER_A, GITHUB_USER_B, GRANTED_SCOPE } from './fakeGitHub.js';
import { FAKE_SERVICE_KEY } from './fakePostgrest.js';
import { buildCloneArgs } from '../utils/git.js';

const CLIENT = 'http://localhost:5173';
const CONNECTED_LOCATION = `${CLIENT}/auth/success?status=connected`;
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

async function launch(options) {
  const server = await startServer(options);
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

async function connect(server, user, options) {
  const result = await connectGitHubFor(server, user.token, options);
  remember(result.ticket, result.state, result.code);
  return { ...result, accessToken: fakes.github.issuedTokens.at(-1) };
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

  test('1. connect: the callback redirects to /auth/success?status=connected with no token', async () => {
    const result = await connect(server, userA);
    connectedA = result;

    assert.equal(result.startStatus, 302);
    assert.equal(`${result.authorizeUrl.origin}${result.authorizeUrl.pathname}`, `${fakes.github.url}/login/oauth/authorize`);
    assert.equal(result.authorizeUrl.searchParams.get('client_id'), server.env.GITHUB_CLIENT_ID);
    assert.equal(result.authorizeUrl.searchParams.get('scope'), 'repo,user:email');
    assert.match(result.state, /^[0-9a-f]{64}$/);
    assert.match(result.cookie, /^oauth_state=[0-9a-f]{64}$/);

    assert.equal(result.callbackStatus, 302);
    assert.equal(result.location, CONNECTED_LOCATION);
    assertNoSecretShapes(result.location, 'callback Location');
    assert.ok(result.callbackSetCookie.some((c) => /^oauth_state=;/.test(c)), 'the state cookie is cleared');
    assert.match(result.accessToken, /^gho_/);
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
    assert.equal(success.location, CONNECTED_LOCATION);
    const replay = await callback(server, `code=${code}&state=${flow.state}`, flow.cookie);
    assert.equal(replay.location, errorLocation('invalid_state'));
  });

  test('5. cross-user binding: a flow started with X\'s ticket is stored under X even if B finishes it', async () => {
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
    assert.equal(done.headers.get('location'), CONNECTED_LOCATION);

    const x = await status(server, userX);
    assert.equal(x.json.connected, true);
    assert.equal(x.json.user.login, GITHUB_USER_B.login);
    assert.deepEqual((await status(server, userB)).json, { connected: false });
  });

  test('6. disconnect revokes the grant, deletes the record and is idempotent', async () => {
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
    assert.equal(revocation.path, `/applications/${server.env.GITHUB_CLIENT_ID}/grant`);
    const expectedBasic = Buffer.from(`${server.env.GITHUB_CLIENT_ID}:${server.env.GITHUB_CLIENT_SECRET}`).toString('base64');
    assert.equal(revocation.headers.authorization, `Basic ${expectedBasic}`);
    assert.deepEqual(revocation.body, { access_token: accessToken });
    assert.ok(fakes.github.isRevoked(accessToken));

    assert.deepEqual((await status(server, user)).json, { connected: false });
    assert.equal((await status(server, otherUser)).json.connected, true, "another user's connection is untouched");

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
    assert.ok(newLogs.includes('grant revocation failed: HTTP 500'), newLogs);
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
  before(async () => {
    server = await launch({ envOverrides: { GITHUB_TOKEN_STORE: 'supabase', SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY } });
  });
  after(() => { fakes.postgrest.setMode('ok'); });

  test('a connection is stored as ciphertext only, with the service key, and read back', async () => {
    const user = newUser();
    const requestStart = fakes.postgrest.requests.length;
    const { accessToken, location } = await connect(server, user);
    assert.equal(location, CONNECTED_LOCATION);

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

  test('PostgREST 500: status, listing, clone and disconnect are 503; the callback reports github_auth_failed', async () => {
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

      const other = newUser();
      const result = await connect(server, other);
      assert.equal(result.location, errorLocation('github_auth_failed'));
    } finally {
      fakes.postgrest.setMode('ok');
    }
    assert.equal((await status(server, user)).json.connected, true, 'the outage did not delete the connection');
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
    const server = await launch({ envOverrides: { NODE_ENV: 'production' } });
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
test('11. no log contains a GitHub token, ciphertext, ticket, state, code, encryption key or service key', async () => {
  for (const server of servers) await server.stop();
  remember(...fakes.github.issuedTokens, ...fakes.github.issuedCodes, FAKE_SERVICE_KEY);
  assert.ok(fakes.github.issuedTokens.length >= 5);
  assert.ok(secrets.size >= 20, `collected ${secrets.size} secrets`);
  assert.ok(allCapturedLogs.length >= servers.length);

  for (const { output } of allCapturedLogs) {
    const text = `${output.stdout}\n${output.stderr}`;
    for (const secret of secrets) {
      assert.ok(!text.includes(secret), `a secret of length ${secret.length} appears in a server log`);
    }
    assert.ok(!text.includes('gho_'), 'no GitHub token shape in logs');
    assert.ok(!/v1:[A-Za-z0-9+/=]{8,}:/.test(text), 'no ciphertext shape in logs');
  }
});
