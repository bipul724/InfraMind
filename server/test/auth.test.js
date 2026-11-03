import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  AuthError,
  createSupabaseVerifier,
  describeSupabaseConfigProblem,
  requireUser
} from '../utils/auth.js';

const SUPABASE_URL = 'https://proj.supabase.co';
const ANON_KEY = 'test-anon-key';
const USER = { id: '33333333-3333-4333-8333-333333333333', email: 'user@example.test' };

// JWT-shaped token; the signature is never checked by the verifier
function makeToken({ expSeconds = Math.floor(Date.now() / 1000) + 3600, iss = `${SUPABASE_URL}/auth/v1`, extra = {} } = {}) {
  const payload = { sub: USER.id, nonce: crypto.randomUUID(), ...extra };
  if (expSeconds !== null) payload.exp = expSeconds;
  if (iss !== null) payload.iss = iss;
  return jwt.sign(payload, 'any-secret');
}

const jsonResponse = (status, body) => ({ status, json: async () => body });

function recordingFetch(respond = () => jsonResponse(200, USER)) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  };
  return { calls, fetchImpl };
}

// verify() resolves with the Supabase user plus the token's exp in milliseconds
const expiresAtOf = (token) => jwt.decode(token).exp * 1000;
const userFor = (token) => ({ ...USER, expiresAt: expiresAtOf(token) });

const verifierWith = (fetchImpl, options = {}) =>
  createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, fetchImpl, ...options });

const rejectsWith = (promise, code) =>
  assert.rejects(promise, (error) => error instanceof AuthError && error.code === code);

describe('local pre-checks (filters only, no network)', () => {
  const cases = [
    ['a malformed token', 'not.a-jwt'],
    ['a token with too many segments', 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc.dddd'],
    ['a payload that is not JSON', 'aaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc'],
    ['an expired exp', makeToken({ expSeconds: Math.floor(Date.now() / 1000) - 10 })],
    ['a wrong iss', makeToken({ iss: 'https://evil.supabase.co/auth/v1' })],
    ['an empty token', ''],
    ['a 5,000-character token', `${'a'.repeat(2500)}.${'b'.repeat(2497)}.c`],
    ['a non-string token', 12345],
    ['no token', undefined]
  ];

  for (const [label, token] of cases) {
    test(`${label} is AUTH_REQUIRED with zero fetch calls`, async () => {
      const { calls, fetchImpl } = recordingFetch();
      await rejectsWith(verifierWith(fetchImpl).verify(token), 'AUTH_REQUIRED');
      assert.equal(calls.length, 0);
    });
  }
});

describe('authoritative Supabase check', () => {
  test('calls /auth/v1/user with the anon key and the bearer token', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const token = makeToken();
    const user = await verifierWith(fetchImpl).verify(token);

    assert.deepEqual(user, userFor(token));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${SUPABASE_URL}/auth/v1/user`);
    assert.equal(calls[0].options.headers.apikey, ANON_KEY);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
    assert.ok(calls[0].options.signal, 'request must carry a timeout signal');
  });

  test('expiresAt is the token exp in milliseconds, or null without exp', async () => {
    const { fetchImpl } = recordingFetch();
    const expSeconds = Math.floor(Date.now() / 1000) + 120;
    const withExp = await verifierWith(fetchImpl).verify(makeToken({ expSeconds }));
    assert.equal(withExp.expiresAt, expSeconds * 1000);
    const withoutExp = await verifierWith(fetchImpl).verify(makeToken({ expSeconds: null }));
    assert.equal(withoutExp.expiresAt, null);
  });

  test('a second call within the TTL is served from a hashed cache', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const verifier = verifierWith(fetchImpl);
    const token = makeToken();

    await verifier.verify(token);
    assert.deepEqual(await verifier.verify(token), userFor(token));
    assert.equal(calls.length, 1);

    const keys = verifier._cacheKeysForTest();
    assert.equal(keys.length, 1);
    for (const key of keys) {
      assert.notEqual(key, token);
      assert.ok(!key.includes(token));
      assert.ok(!token.includes(key));
    }
    assert.equal(keys[0], crypto.createHash('sha256').update(token).digest('hex'));
  });

  test('a cached user is never served after the token expires', async () => {
    let clock = 1_700_000_000_000;
    const { calls, fetchImpl } = recordingFetch();
    const verifier = verifierWith(fetchImpl, { now: () => clock });
    const token = makeToken({ expSeconds: Math.floor(clock / 1000) + 2 });

    await verifier.verify(token);
    clock += 1000;
    await verifier.verify(token);
    assert.equal(calls.length, 1, 'still cached one second later');

    clock += 2000;
    await rejectsWith(verifier.verify(token), 'AUTH_REQUIRED');
    assert.equal(calls.length, 1, 'an expired token is rejected locally, never served from cache');
  });

  test('the cache TTL bounds reuse and forces a re-fetch', async () => {
    let clock = 1_700_000_000_000;
    const { calls, fetchImpl } = recordingFetch();
    const verifier = verifierWith(fetchImpl, { now: () => clock, cacheTtlMs: 1000 });
    const token = makeToken({ expSeconds: Math.floor(clock / 1000) + 3600 });

    await verifier.verify(token);
    clock += 1500;
    await verifier.verify(token);
    assert.equal(calls.length, 2);
  });

  test('the cache is bounded and evicts the oldest entry', async () => {
    const { fetchImpl } = recordingFetch();
    const verifier = verifierWith(fetchImpl, { maxCacheEntries: 2 });
    const tokens = [makeToken(), makeToken(), makeToken()];
    for (const token of tokens) await verifier.verify(token);

    const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
    assert.deepEqual(verifier._cacheKeysForTest(), [hash(tokens[1]), hash(tokens[2])]);
  });

  for (const status of [401, 403]) {
    test(`HTTP ${status} is AUTH_REQUIRED`, async () => {
      const { fetchImpl } = recordingFetch(() => jsonResponse(status, { msg: 'nope' }));
      await rejectsWith(verifierWith(fetchImpl).verify(makeToken()), 'AUTH_REQUIRED');
    });
  }

  test('failures are never cached', async () => {
    let status = 401;
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse(status, status === 200 ? USER : {}));
    const verifier = verifierWith(fetchImpl);
    const token = makeToken();

    await rejectsWith(verifier.verify(token), 'AUTH_REQUIRED');
    await rejectsWith(verifier.verify(token), 'AUTH_REQUIRED');
    assert.equal(calls.length, 2, 'a rejected token is re-checked, not cached');
    assert.deepEqual(verifier._cacheKeysForTest(), []);

    status = 500;
    await rejectsWith(verifier.verify(token), 'AUTH_UNAVAILABLE');
    assert.deepEqual(verifier._cacheKeysForTest(), []);
  });

  const unavailable = [
    ['HTTP 500', () => jsonResponse(500, {})],
    ['HTTP 429', () => jsonResponse(429, {})],
    ['a network error', () => { throw new TypeError('fetch failed'); }],
    ['a body without a UUID id', () => jsonResponse(200, { id: 'not-a-uuid', email: 'x' })],
    ['a body that is not JSON', () => ({ status: 200, json: async () => { throw new SyntaxError('bad'); } })],
    ['a null body', () => jsonResponse(200, null)]
  ];

  for (const [label, respond] of unavailable) {
    test(`${label} is AUTH_UNAVAILABLE (fail closed)`, async () => {
      const { fetchImpl } = recordingFetch(respond);
      await rejectsWith(verifierWith(fetchImpl).verify(makeToken()), 'AUTH_UNAVAILABLE');
    });
  }

  test('a hanging Supabase is AUTH_UNAVAILABLE after timeoutMs', async () => {
    const hangingFetch = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
    // AbortSignal.timeout uses an unref'd timer; keep this test process alive as a server would be
    const keepAlive = setTimeout(() => {}, 5000);
    const started = Date.now();
    try {
      await rejectsWith(verifierWith(hangingFetch, { timeoutMs: 50 }).verify(makeToken()), 'AUTH_UNAVAILABLE');
    } finally {
      clearTimeout(keepAlive);
    }
    assert.ok(Date.now() - started < 2000);
  });
});

describe('concurrency', () => {
  test('caps in-flight lookups and fails the overflow with AUTH_UNAVAILABLE', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let fetchCount = 0;
    const slowFetch = async () => {
      fetchCount++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight--;
      return jsonResponse(200, USER);
    };

    const verifier = verifierWith(slowFetch, { maxConcurrent: 20 });
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => verifier.verify(makeToken())));
    const unavailable = results.filter((r) => r.status === 'rejected' && r.reason.code === 'AUTH_UNAVAILABLE');

    assert.ok(unavailable.length >= 5, `expected at least 5 AUTH_UNAVAILABLE, got ${unavailable.length}`);
    assert.ok(maxInFlight <= 20, `at most 20 lookups in flight, saw ${maxInFlight}`);
    assert.ok(fetchCount <= 20);
  });

  test('concurrent verifications of the same token share one fetch', async () => {
    let fetchCount = 0;
    const slowFetch = async () => {
      fetchCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return jsonResponse(200, USER);
    };
    const verifier = verifierWith(slowFetch);
    const token = makeToken();

    const [first, second] = await Promise.all([verifier.verify(token), verifier.verify(token)]);
    assert.deepEqual(first, userFor(token));
    assert.deepEqual(second, userFor(token));
    assert.equal(fetchCount, 1);
  });
});

describe('requireUser middleware', () => {
  const run = async (verifier, headers = {}) => {
    const req = { headers };
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    let nextCalled = false;
    await requireUser(verifier)(req, res, () => { nextCalled = true; });
    return { req, res, nextCalled };
  };

  test('sets req.user and calls next on success', async () => {
    const { req, nextCalled } = await run({ verify: async () => ({ ...USER, expiresAt: Date.now() + 1000, extra: 'x' }) }, { authorization: 'Bearer abc' });
    assert.equal(nextCalled, true);
    assert.deepEqual(req.user, USER);
  });

  test('responds 401 AUTH_REQUIRED without a bearer token', async () => {
    const { res, nextCalled } = await run(verifierWith(recordingFetch().fetchImpl));
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
  });

  test('responds 503 AUTH_UNAVAILABLE and never calls next when Supabase is down', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(500, {}));
    const { res, nextCalled } = await run(verifierWith(fetchImpl), { authorization: `Bearer ${makeToken()}` });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' });
  });

  test('treats unexpected verifier errors as AUTH_REQUIRED, never as success', async () => {
    const { res, nextCalled } = await run({ verify: async () => { throw new Error('boom'); } }, { authorization: 'Bearer abc' });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

describe('describeSupabaseConfigProblem', () => {
  const rejected = [
    ['a missing URL', { SUPABASE_ANON_KEY: 'k' }],
    ['http on a public host', { SUPABASE_URL: 'http://example.com', SUPABASE_ANON_KEY: 'k' }],
    ['a URL with a path', { SUPABASE_URL: 'https://x.supabase.co/rest', SUPABASE_ANON_KEY: 'k' }],
    ['a URL with a query string', { SUPABASE_URL: 'https://x.supabase.co?a=1', SUPABASE_ANON_KEY: 'k' }],
    ['a URL with a fragment', { SUPABASE_URL: 'https://x.supabase.co#x', SUPABASE_ANON_KEY: 'k' }],
    ['a URL with credentials', { SUPABASE_URL: 'https://u:p@x.supabase.co', SUPABASE_ANON_KEY: 'k' }],
    ['a non-URL', { SUPABASE_URL: 'not a url', SUPABASE_ANON_KEY: 'k' }],
    ['an empty anon key', { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: '' }],
    ['a missing anon key', { SUPABASE_URL: 'https://abc.supabase.co' }]
  ];
  for (const [label, env] of rejected) {
    test(`rejects ${label} without echoing values`, () => {
      const problem = describeSupabaseConfigProblem(env);
      assert.equal(typeof problem, 'string');
      if (env.SUPABASE_URL) assert.ok(!problem.includes(env.SUPABASE_URL));
    });
  }

  for (const url of ['https://abc.supabase.co', 'https://abc.supabase.co/', 'http://127.0.0.1:54321', 'http://localhost:54321']) {
    test(`accepts ${url}`, () => {
      assert.equal(describeSupabaseConfigProblem({ SUPABASE_URL: url, SUPABASE_ANON_KEY: 'k' }), null);
    });
  }
});
