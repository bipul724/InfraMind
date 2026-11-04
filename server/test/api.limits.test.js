// B1.4: rate limits (proxy-aware keys, pre-auth, per user, OAuth, Socket.IO handshakes)
// and the allowed-origin list for CORS and Socket.IO. Spawned servers, local fakes only.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { io as connectClient } from 'socket.io-client';
import { authHeaders, closeFakes, getFakes, postJson, randomAlphanumeric, startServer } from './helpers.js';

let fakes;
const servers = [];
before(async () => { fakes = await getFakes(); });
after(async () => {
  for (const server of servers) await server.stop();
  await closeFakes();
});

async function launch(envOverrides) {
  const server = await startServer({ envOverrides });
  servers.push(server);
  return server;
}

const get = (server, route, headers = {}) => fetch(`${server.baseUrl}${route}`, { headers });

// A JWT-shaped token the fake Supabase does not know: verifying it costs one lookup
const unknownToken = () => jwt.sign(
  { sub: crypto.randomUUID(), email: 'nobody@example.test', iss: `${fakes.supabase.url}/auth/v1`, nonce: crypto.randomUUID() },
  crypto.randomBytes(32).toString('hex'),
  { expiresIn: 3600 }
);
const newUser = () => {
  const user = { id: crypto.randomUUID(), email: `${randomAlphanumeric(8)}@example.test` };
  return { ...user, auth: authHeaders(fakes.supabase.issueToken(user)) };
};

async function assertRateLimited(response) {
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.code, 'RATE_LIMITED');
  assert.equal(typeof body.error, 'string');
  for (const header of ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after']) {
    assert.ok(response.headers.get(header) !== null, `${header} on a 429`);
  }
}

describe('preAuth: keyed by client IP behind TRUST_PROXY hops', () => {
  test('TRUST_PROXY=0: different X-Forwarded-For values share one bucket', async () => {
    const server = await launch({ TRUST_PROXY: '0', RATE_LIMIT_PREAUTH_MAX: '2' });
    assert.equal((await get(server, '/api/metrics', { 'X-Forwarded-For': '203.0.113.1' })).status, 404);
    assert.equal((await get(server, '/api/metrics', { 'X-Forwarded-For': '203.0.113.2' })).status, 404);
    await assertRateLimited(await get(server, '/api/metrics', { 'X-Forwarded-For': '203.0.113.3' }));
  });

  test('TRUST_PROXY=1: different last-hop addresses get separate buckets; a spoofed left-most entry does not change the key', async () => {
    const server = await launch({ TRUST_PROXY: '1', RATE_LIMIT_PREAUTH_MAX: '2' });
    // The proxy appends the address it saw (the last entry); the client controls everything before it
    assert.equal((await get(server, '/api/metrics', { 'X-Forwarded-For': '198.51.100.7, 203.0.113.10' })).status, 404);
    assert.equal((await get(server, '/api/metrics', { 'X-Forwarded-For': '198.51.100.8, 203.0.113.10' })).status, 404);
    await assertRateLimited(await get(server, '/api/metrics', { 'X-Forwarded-For': '198.51.100.9, 203.0.113.10' }));
    // Another client behind the same proxy has its own bucket
    assert.equal((await get(server, '/api/metrics', { 'X-Forwarded-For': '198.51.100.7, 203.0.113.11' })).status, 404);
    assert.ok(server.logs().includes('Rate limit preAuth exceeded for IP 203.0.113.10'));
    assert.ok(!server.logs().includes('Rate limit preAuth exceeded for IP 198.51.100'), 'never the spoofable entry');
  });

  test('IPv6: three addresses in one /64 share a bucket (counted per /56); the third never reaches Supabase', async () => {
    const server = await launch({ TRUST_PROXY: '1', RATE_LIMIT_PREAUTH_MAX: '2' });
    const callsBefore = fakes.supabase.callCount;
    const from = (address) => get(server, '/api/github/status', { ...authHeaders(unknownToken()), 'X-Forwarded-For': address });
    assert.equal((await from('2001:db8:1:2::a')).status, 401);
    assert.equal((await from('2001:db8:1:2::b')).status, 401);
    assert.equal(fakes.supabase.callCount - callsBefore, 2);
    await assertRateLimited(await from('2001:db8:1:2::c'));
    assert.equal(fakes.supabase.callCount - callsBefore, 2, 'the third request never reached Supabase');
    // A client in another /56 has its own bucket
    assert.equal((await from('2001:db8:1:100::a')).status, 401);
    // The 429 line still logs the full address
    assert.ok(server.logs().includes('Rate limit preAuth exceeded for IP 2001:db8:1:2::c'), server.logs());
  });

  test('a flood of fake tokens is throttled before Supabase is called', async () => {
    const server = await launch({ RATE_LIMIT_PREAUTH_MAX: '5' });
    const callsBefore = fakes.supabase.callCount;
    for (let i = 0; i < 5; i++) {
      assert.equal((await get(server, '/api/github/status', authHeaders(unknownToken()))).status, 401);
    }
    assert.equal(fakes.supabase.callCount - callsBefore, 5);
    const sixth = await get(server, '/api/github/status', authHeaders(unknownToken()));
    await assertRateLimited(sixth);
    assert.equal(fakes.supabase.callCount - callsBefore, 5, 'the 6th request never reached Supabase');
  });
});

describe('per-user limits: user A at the limit, user B from the same IP unaffected', () => {
  let server;
  before(async () => {
    server = await launch({ RATE_LIMIT_CLONE_MAX: '2', RATE_LIMIT_ANALYSIS_MAX: '2', RATE_LIMIT_GITHUBPROXY_MAX: '2', RATE_LIMIT_USER_MAX: '12' });
  });

  // Cheap requests that never clone or analyse: the limiter runs before the handler
  const cases = [
    ['clone', () => ['/api/clone-repo', { repoUrl: 'not-a-url' }], 400],
    ['analysis', () => ['/api/analyze', { sessionId: crypto.randomUUID() }], 404],
    ['githubProxy (verify-repo)', () => ['/api/github/verify-repo', { owner: 'o', repo: 'r' }], 401]
  ];
  for (const [name, build, normalStatus] of cases) {
    test(name, async () => {
      const a = newUser();
      const b = newUser();
      for (let i = 0; i < 2; i++) {
        const [route, body] = build();
        assert.equal((await postJson(server.baseUrl, route, body, a.auth)).status, normalStatus);
      }
      const [route, body] = build();
      const limited = await fetch(`${server.baseUrl}${route}`, {
        method: 'POST', headers: { ...a.auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      await assertRateLimited(limited);
      assert.equal((await postJson(server.baseUrl, route, body, b.auth)).status, normalStatus, 'user B is not limited');
      assert.ok(server.logs().includes(`exceeded for user ${a.id}`), 'user-keyed limits log the user id');
    });
  }

  test('githubProxy covers repositories and organization repositories too', async () => {
    const a = newUser();
    assert.equal((await get(server, '/api/github/repositories', a.auth)).status, 401);
    assert.equal((await get(server, '/api/github/organizations/fake-org/repositories', a.auth)).status, 401);
    await assertRateLimited(await get(server, '/api/github/repositories', a.auth));
    assert.equal((await get(server, '/api/github/repositories', newUser().auth)).status, 401);
  });

  test('user: every authenticated /api request', async () => {
    const a = newUser();
    for (let i = 0; i < 12; i++) assert.equal((await get(server, '/api/github/status', a.auth)).status, 200);
    await assertRateLimited(await get(server, '/api/github/status', a.auth));
    assert.equal((await get(server, '/api/github/status', newUser().auth)).status, 200);
  });
});

describe('oauth: /auth/github, its callback and discard share a per-IP limit', () => {
  test('the 31st GET /auth/github from one IP is 429, and the log has no query string', async () => {
    const server = await launch({});
    const ticket = `TICKETMARKER${randomAlphanumeric(12)}`;
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${server.baseUrl}/auth/github?ticket=${ticket}`, { redirect: 'manual' });
      assert.equal(response.status, 302);
    }
    await assertRateLimited(await fetch(`${server.baseUrl}/auth/github?ticket=${ticket}`, { redirect: 'manual' }));
    // The same bucket also covers the callback and discard
    assert.equal((await fetch(`${server.baseUrl}/auth/github/callback?code=x&state=y`, { redirect: 'manual' })).status, 429);
    assert.equal((await fetch(`${server.baseUrl}/auth/github/discard`, { method: 'POST' })).status, 429);
    const logs = server.logs();
    assert.ok(logs.includes('Rate limit oauth exceeded for IP'));
    assert.ok(!logs.includes('TICKETMARKER'), 'no query string in any log line');
  });
});

describe('socketHandshake: counted per IP before the token is verified', () => {
  test('with RATE_LIMIT_SOCKETHANDSHAKE_MAX=3 the 4th connection is refused without a Supabase call', async () => {
    const server = await launch({ RATE_LIMIT_SOCKETHANDSHAKE_MAX: '3' });
    const attempt = () => new Promise((resolve) => {
      const client = connectClient(server.baseUrl, { auth: { token: unknownToken() }, transports: ['websocket'], reconnection: false, forceNew: true });
      client.once('connect', () => { client.close(); resolve('connected'); });
      client.once('connect_error', (error) => { client.close(); resolve(error.message); });
    });
    const callsBefore = fakes.supabase.callCount;
    for (let i = 0; i < 3; i++) assert.equal(await attempt(), 'AUTH_REQUIRED');
    assert.equal(fakes.supabase.callCount - callsBefore, 3);
    assert.equal(await attempt(), 'RATE_LIMITED');
    assert.equal(fakes.supabase.callCount - callsBefore, 3, 'the 4th handshake never reached Supabase');
    assert.ok(server.logs().includes('Rate limit socketHandshake exceeded for IP'));
  });

  test('IPv6: three handshakes from addresses in one /64 share a bucket; the third never reaches Supabase', async () => {
    const server = await launch({ TRUST_PROXY: '1', RATE_LIMIT_SOCKETHANDSHAKE_MAX: '2' });
    const attempt = (address) => new Promise((resolve) => {
      const client = connectClient(server.baseUrl, {
        auth: { token: unknownToken() }, transports: ['websocket'], reconnection: false, forceNew: true,
        extraHeaders: { 'X-Forwarded-For': address }
      });
      client.once('connect', () => { client.close(); resolve('connected'); });
      client.once('connect_error', (error) => { client.close(); resolve(error.message); });
    });
    const callsBefore = fakes.supabase.callCount;
    assert.equal(await attempt('2001:db8:1:2::a'), 'AUTH_REQUIRED');
    assert.equal(await attempt('2001:db8:1:2::b'), 'AUTH_REQUIRED');
    assert.equal(await attempt('2001:db8:1:2::c'), 'RATE_LIMITED');
    assert.equal(fakes.supabase.callCount - callsBefore, 2, 'the third handshake never reached Supabase');
    assert.equal(await attempt('2001:db8:1:100::a'), 'AUTH_REQUIRED', 'another /56 has its own bucket');
    assert.ok(server.logs().includes('Rate limit socketHandshake exceeded for IP 2001:db8:1:2::c'));
  });
});

describe('allowed origins: one list for CORS and Socket.IO', () => {
  const LISTED = 'https://admin.example.test';
  const preflight = (server, origin) => fetch(`${server.baseUrl}/api/github/status`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' }
  });
  const socketFrom = (server, origin, token) => new Promise((resolve) => {
    const client = connectClient(server.baseUrl, {
      auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders: { Origin: origin }
    });
    client.once('connect', () => { client.close(); resolve('connected'); });
    client.once('connect_error', () => { client.close(); resolve('refused'); });
  });

  test('development: CLIENT_URL, CORS_ALLOWED_ORIGINS and localhost:5173 are listed; others get no header and no 500', async () => {
    const server = await launch({ CORS_ALLOWED_ORIGINS: LISTED });
    for (const origin of ['http://localhost:5173', LISTED]) {
      assert.equal((await preflight(server, origin)).headers.get('access-control-allow-origin'), origin);
    }
    for (const origin of ['https://dev-pilot.vercel.app', 'https://evil.example.test']) {
      const response = await preflight(server, origin);
      assert.ok(response.status < 500);
      assert.equal(response.headers.get('access-control-allow-origin'), null, origin);
      const health = await get(server, '/health', { Origin: origin });
      assert.equal(health.status, 200, 'an unlisted origin is otherwise handled normally');
      assert.equal(health.headers.get('access-control-allow-origin'), null);
    }
    assert.ok(server.logs().includes(`🌐 Allowed origins: http://localhost:5173, ${LISTED}`));
  });

  test('Socket.IO refuses an unlisted origin and accepts a listed one', async () => {
    const server = await launch({ CORS_ALLOWED_ORIGINS: LISTED });
    const token = fakes.supabase.issueToken(newUser());
    assert.equal(await socketFrom(server, LISTED, token), 'connected');
    assert.equal(await socketFrom(server, 'https://dev-pilot.vercel.app', token), 'refused');
    assert.equal(await socketFrom(server, 'https://evil.example.test', token), 'refused');
  });

  test('production: localhost:5173 is not listed', async () => {
    const server = await launch({
      NODE_ENV: 'production',
      CLIENT_URL: 'https://app.example.test',
      GITHUB_REDIRECT_URI: 'https://api.example.test/auth/github/callback'
    });
    assert.equal((await preflight(server, 'https://app.example.test')).headers.get('access-control-allow-origin'), 'https://app.example.test');
    assert.equal((await preflight(server, 'http://localhost:5173')).headers.get('access-control-allow-origin'), null);
    const token = fakes.supabase.issueToken(newUser());
    assert.equal(await socketFrom(server, 'http://localhost:5173', token), 'refused');
  });
});
