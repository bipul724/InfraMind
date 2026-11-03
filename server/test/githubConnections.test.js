// Unit tests for the encrypted GitHub connection store and the one-time token stores
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  StoreUnavailableError,
  createConnectionStore,
  createOneTimeTokenStore,
  decryptToken,
  describeConnectionStoreConfigProblem,
  describeEncryptionKeyProblem,
  encryptToken,
  parseEncryptionKey
} from '../utils/githubConnections.js';
import { redactUrl } from '../utils/logger.js';
import { startFakePostgrest, FAKE_SERVICE_KEY } from './fakePostgrest.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const KEY_TEXT = crypto.randomBytes(32).toString('base64');
const KEY = parseEncryptionKey(KEY_TEXT);
const TOKEN = `gho_${crypto.randomBytes(18).toString('hex')}`;
const record = (overrides = {}) => ({
  githubUserId: 5001,
  login: 'octo-a',
  name: 'Octo A',
  avatarUrl: 'https://avatars.example.test/a.png',
  scopes: 'repo,user:email',
  accessToken: TOKEN,
  connectedAt: new Date('2026-11-03T10:00:00Z'),
  ...overrides
});

// Capture console.warn output during fn
async function captureWarnings(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => { lines.push(args.join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.warn = original;
  }
}

describe('AES-256-GCM token encryption', () => {
  test('round trip', () => {
    const stored = encryptToken(KEY, USER_A, TOKEN);
    assert.match(stored, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    assert.equal(decryptToken(KEY, USER_A, stored), TOKEN);
  });

  test('the ciphertext contains neither the token nor its base64', () => {
    const stored = encryptToken(KEY, USER_A, TOKEN);
    assert.ok(!stored.includes(TOKEN));
    assert.ok(!stored.includes(Buffer.from(TOKEN).toString('base64')));
    assert.ok(!stored.includes(Buffer.from(TOKEN).toString('base64url')));
    assert.ok(!stored.includes('gho_'));
  });

  test('a 12-byte random IV and a 16-byte tag: two writes of the same token differ', () => {
    const first = encryptToken(KEY, USER_A, TOKEN);
    const second = encryptToken(KEY, USER_A, TOKEN);
    assert.notEqual(first, second);
    const [, iv, tag] = first.split(':');
    assert.equal(Buffer.from(iv, 'base64').length, 12);
    assert.equal(Buffer.from(tag, 'base64').length, 16);
    assert.notEqual(first.split(':')[1], second.split(':')[1]);
  });

  test('a ciphertext moved to another user fails to decrypt (AAD)', () => {
    const stored = encryptToken(KEY, USER_A, TOKEN);
    assert.throws(() => decryptToken(KEY, USER_B, stored));
  });

  test('a different key fails to decrypt', () => {
    const stored = encryptToken(KEY, USER_A, TOKEN);
    assert.throws(() => decryptToken(crypto.randomBytes(32), USER_A, stored));
  });

  const flipFirstByte = (b64) => {
    const bytes = Buffer.from(b64, 'base64');
    bytes[0] ^= 0x01;
    return bytes.toString('base64');
  };
  for (const [label, index] of [['IV', 1], ['tag', 2], ['ciphertext', 3]]) {
    test(`a tampered ${label} fails`, () => {
      const parts = encryptToken(KEY, USER_A, TOKEN).split(':');
      parts[index] = flipFirstByte(parts[index]);
      assert.throws(() => decryptToken(KEY, USER_A, parts.join(':')));
    });
  }

  for (const [label, value] of [
    ['a wrong version', () => encryptToken(KEY, USER_A, TOKEN).replace(/^v1:/, 'v2:')],
    ['a truncated value', () => encryptToken(KEY, USER_A, TOKEN).split(':').slice(0, 3).join(':')],
    ['a short tag', () => { const p = encryptToken(KEY, USER_A, TOKEN).split(':'); p[2] = p[2].slice(0, 8); return p.join(':'); }],
    ['a non-string', () => 42]
  ]) {
    test(`${label} fails`, () => {
      assert.throws(() => decryptToken(KEY, USER_A, value()));
    });
  }
});

describe('GITHUB_TOKEN_ENC_KEY validation', () => {
  const bytes32 = crypto.randomBytes(32);
  const urlSafe = (() => {
    // Find 32 bytes whose base64 contains + or /, then convert to base64url with padding
    for (;;) {
      const candidate = crypto.randomBytes(32).toString('base64');
      if (/[+/]/.test(candidate)) return candidate.replace(/\+/g, '-').replace(/\//g, '_');
    }
  })();
  const rejected = [
    ['missing', undefined],
    ['empty', ''],
    ['31 bytes', crypto.randomBytes(31).toString('base64')],
    ['33 bytes', crypto.randomBytes(33).toString('base64')],
    ['non-base64', '!'.repeat(44)],
    ['URL-safe base64', urlSafe],
    ['base64 without padding', bytes32.toString('base64').replace(/=+$/, '')],
    ['hex of 32 bytes', bytes32.toString('hex')]
  ];
  for (const [label, value] of rejected) {
    test(`rejects ${label}`, () => {
      const problem = describeEncryptionKeyProblem(value);
      assert.equal(typeof problem, 'string');
      if (value) assert.ok(!problem.includes(value), 'the problem never includes the value');
      assert.throws(() => parseEncryptionKey(value), (error) => error.message.startsWith('GITHUB_TOKEN_ENC_KEY') && (!value || !error.message.includes(value)));
      assert.throws(() => createConnectionStore({ kind: 'memory', encryptionKey: value }));
    });
  }

  test('accepts standard base64 of 32 bytes, with surrounding whitespace trimmed', () => {
    assert.equal(describeEncryptionKeyProblem(bytes32.toString('base64')), null);
    assert.equal(describeEncryptionKeyProblem(` ${bytes32.toString('base64')}\n`), null);
    assert.deepEqual(parseEncryptionKey(bytes32.toString('base64')), bytes32);
  });

  test('describeConnectionStoreConfigProblem names variables, never values', () => {
    const serviceKey = 'sk-' + crypto.randomBytes(8).toString('hex');
    const badKey = crypto.randomBytes(31).toString('base64');
    const cases = [
      [{}, 'GITHUB_TOKEN_STORE'],
      [{ GITHUB_TOKEN_STORE: 'postgres', GITHUB_TOKEN_ENC_KEY: KEY_TEXT }, 'GITHUB_TOKEN_STORE'],
      [{ GITHUB_TOKEN_STORE: 'memory' }, 'GITHUB_TOKEN_ENC_KEY'],
      [{ GITHUB_TOKEN_STORE: 'memory', GITHUB_TOKEN_ENC_KEY: badKey }, 'GITHUB_TOKEN_ENC_KEY'],
      [{ GITHUB_TOKEN_STORE: 'supabase', GITHUB_TOKEN_ENC_KEY: KEY_TEXT }, 'SUPABASE_SERVICE_ROLE_KEY'],
      [{ GITHUB_TOKEN_STORE: 'supabase', GITHUB_TOKEN_ENC_KEY: KEY_TEXT, SUPABASE_SERVICE_ROLE_KEY: '  ' }, 'SUPABASE_SERVICE_ROLE_KEY']
    ];
    for (const [env, variable] of cases) {
      const problem = describeConnectionStoreConfigProblem(env);
      assert.ok(problem && problem.includes(variable), `${JSON.stringify(Object.keys(env))} -> ${problem}`);
      assert.ok(!problem.includes(KEY_TEXT) && !problem.includes(badKey) && !problem.includes('postgres'));
    }
    assert.equal(describeConnectionStoreConfigProblem({ GITHUB_TOKEN_STORE: 'memory', GITHUB_TOKEN_ENC_KEY: KEY_TEXT }), null);
    assert.equal(describeConnectionStoreConfigProblem({ GITHUB_TOKEN_STORE: 'supabase', GITHUB_TOKEN_ENC_KEY: KEY_TEXT, SUPABASE_SERVICE_ROLE_KEY: serviceKey }), null);
  });
});

describe('memory adapter', () => {
  test('get / put / delete', async () => {
    const store = createConnectionStore({ kind: 'memory', encryptionKey: KEY_TEXT });
    assert.equal(await store.get(USER_A), null);
    await store.put(USER_A, record());
    const loaded = await store.get(USER_A);
    assert.equal(loaded.accessToken, TOKEN);
    assert.equal(loaded.login, 'octo-a');
    assert.equal(loaded.name, 'Octo A');
    assert.equal(loaded.avatarUrl, 'https://avatars.example.test/a.png');
    assert.equal(loaded.scopes, 'repo,user:email');
    assert.equal(loaded.githubUserId, 5001);
    assert.equal(loaded.connectedAt, '2026-11-03T10:00:00.000Z');
    assert.equal(await store.get(USER_B), null, 'records are per user');

    await store.put(USER_A, record({ login: 'renamed' }));
    assert.equal((await store.get(USER_A)).login, 'renamed', 'put replaces');

    await store.delete(USER_A);
    assert.equal(await store.get(USER_A), null);
    await store.delete(USER_A); // idempotent
  });

  for (const userId of ['not-a-uuid', '', null, undefined, 42, `${USER_A}&user_id=neq.x`, '11111111-1111-1111-8111-111111111111']) {
    test(`a non-UUID user id (${JSON.stringify(userId)}) throws before any work`, async () => {
      const store = createConnectionStore({ kind: 'memory', encryptionKey: KEY_TEXT });
      await assert.rejects(store.get(userId), TypeError);
      await assert.rejects(store.put(userId, record()), TypeError);
      await assert.rejects(store.delete(userId), TypeError);
    });
  }

  test('rejects records without a token, login or numeric GitHub id', async () => {
    const store = createConnectionStore({ kind: 'memory', encryptionKey: KEY_TEXT });
    await assert.rejects(store.put(USER_A, record({ accessToken: '' })), TypeError);
    await assert.rejects(store.put(USER_A, record({ login: undefined })), TypeError);
    await assert.rejects(store.put(USER_A, record({ githubUserId: '5001' })), TypeError);
    assert.equal(await store.get(USER_A), null);
  });

  test('an unknown kind is refused', () => {
    assert.throws(() => createConnectionStore({ kind: 'redis', encryptionKey: KEY_TEXT }));
    assert.throws(() => createConnectionStore({ encryptionKey: KEY_TEXT }));
  });
});

describe('supabase adapter (fake PostgREST)', () => {
  let fake;
  let store;
  before(async () => {
    fake = await startFakePostgrest();
    store = createConnectionStore({ kind: 'supabase', encryptionKey: KEY_TEXT, supabaseUrl: fake.url, serviceRoleKey: FAKE_SERVICE_KEY });
  });
  after(async () => { await fake.close(); });

  test('refuses to start without a service key', () => {
    assert.throws(() => createConnectionStore({ kind: 'supabase', encryptionKey: KEY_TEXT, supabaseUrl: fake.url }));
  });

  test('put: upsert URL, Prefer header, both auth headers, ciphertext only', async () => {
    const start = fake.requests.length;
    await store.put(USER_A, record());
    const [request] = fake.requests.slice(start);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/rest/v1/github_connections?on_conflict=user_id');
    assert.equal(request.headers.prefer, 'resolution=merge-duplicates,return=minimal');
    assert.equal(request.headers.apikey, FAKE_SERVICE_KEY);
    assert.equal(request.headers.authorization, `Bearer ${FAKE_SERVICE_KEY}`);
    assert.equal(request.headers['content-type'], 'application/json');

    const body = JSON.parse(request.body);
    assert.equal(body.user_id, USER_A);
    assert.equal(body.github_user_id, 5001);
    assert.equal(body.github_login, 'octo-a');
    assert.match(body.token_ciphertext, /^v1:/);
    assert.equal('accessToken' in body, false);
    assert.equal('access_token' in body, false);
    for (const text of [request.body, request.url, JSON.stringify(request.headers)]) {
      assert.ok(!text.includes(TOKEN), 'no plaintext token anywhere in the request');
      assert.ok(!text.includes(Buffer.from(TOKEN).toString('base64')));
    }
  });

  test('get: filter and select columns; decrypts', async () => {
    const start = fake.requests.length;
    const loaded = await store.get(USER_A);
    const [request] = fake.requests.slice(start);
    assert.equal(request.method, 'GET');
    assert.equal(
      request.url,
      `/rest/v1/github_connections?user_id=eq.${USER_A}&select=github_user_id,github_login,github_name,github_avatar_url,scopes,token_ciphertext,connected_at`
    );
    assert.equal(request.headers.apikey, FAKE_SERVICE_KEY);
    assert.equal(request.headers.authorization, `Bearer ${FAKE_SERVICE_KEY}`);
    assert.equal(loaded.accessToken, TOKEN);
    assert.equal(loaded.login, 'octo-a');
    assert.equal(await store.get(USER_B), null);
  });

  test('a row copied to another user is unreadable: get returns null, deletes it and logs only the user id', async () => {
    fake.rows.set(USER_B, { ...fake.rows.get(USER_A), user_id: USER_B });
    const start = fake.requests.length;
    const { result, lines } = await captureWarnings(() => store.get(USER_B));
    assert.equal(result, null);
    assert.equal(fake.rows.has(USER_B), false);
    const methods = fake.requests.slice(start).map((r) => r.method);
    assert.deepEqual(methods, ['GET', 'DELETE']);
    assert.deepEqual(lines, [`github connection unreadable for user ${USER_B}`]);
    assert.equal((await store.get(USER_A)).accessToken, TOKEN, "A's own row is untouched");
  });

  test('delete: filter, both auth headers', async () => {
    const start = fake.requests.length;
    await store.delete(USER_A);
    const [request] = fake.requests.slice(start);
    assert.equal(request.method, 'DELETE');
    assert.equal(request.url, `/rest/v1/github_connections?user_id=eq.${USER_A}`);
    assert.equal(request.headers.apikey, FAKE_SERVICE_KEY);
    assert.equal(request.headers.authorization, `Bearer ${FAKE_SERVICE_KEY}`);
    assert.equal(fake.rows.has(USER_A), false);
  });

  test('a non-UUID user id never reaches PostgREST', async () => {
    const start = fake.requests.length;
    for (const userId of ['not-a-uuid', `${USER_A}&user_id=neq.${USER_B}`, `${USER_A},${USER_B}`, '*']) {
      await assert.rejects(store.get(userId), TypeError);
      await assert.rejects(store.put(userId, record()), TypeError);
      await assert.rejects(store.delete(userId), TypeError);
    }
    assert.equal(fake.requests.length, start);
  });

  test('a wrong service key is a store failure, not "no connection"', async () => {
    const wrongKey = createConnectionStore({ kind: 'supabase', encryptionKey: KEY_TEXT, supabaseUrl: fake.url, serviceRoleKey: 'wrong' });
    const { lines } = await captureWarnings(() => assert.rejects(wrongKey.get(USER_A), StoreUnavailableError));
    assert.ok(lines.every((line) => !line.includes('wrong')));
  });

  for (const operation of ['get', 'put', 'delete']) {
    test(`HTTP 500 on ${operation} is StoreUnavailableError`, async () => {
      fake.setMode('error500');
      try {
        const { lines } = await captureWarnings(() =>
          assert.rejects(store[operation](USER_A, record()), (error) => error instanceof StoreUnavailableError && error.code === 'GITHUB_STORE_UNAVAILABLE')
        );
        assert.deepEqual(lines, ['GitHub connection store request failed: HTTP 500']);
      } finally {
        fake.setMode('ok');
      }
    });
  }

  test('a timeout is StoreUnavailableError', async () => {
    const hanging = createConnectionStore({
      kind: 'supabase', encryptionKey: KEY_TEXT, supabaseUrl: fake.url, serviceRoleKey: FAKE_SERVICE_KEY, timeoutMs: 100
    });
    fake.setMode('hang');
    try {
      const started = Date.now();
      const { lines } = await captureWarnings(() => assert.rejects(hanging.get(USER_A), StoreUnavailableError));
      assert.ok(Date.now() - started < 2000);
      assert.deepEqual(lines, ['GitHub connection store request failed: timeout']);
    } finally {
      fake.setMode('ok');
    }
  });

  test('a network error is StoreUnavailableError', async () => {
    const unreachable = createConnectionStore({
      kind: 'supabase', encryptionKey: KEY_TEXT, supabaseUrl: 'http://127.0.0.1:9', serviceRoleKey: FAKE_SERVICE_KEY
    });
    await captureWarnings(() => assert.rejects(unreachable.put(USER_A, record()), StoreUnavailableError));
  });

  test('a malformed body is StoreUnavailableError', async () => {
    const fetchImpl = async () => new Response('not json', { status: 200 });
    const odd = createConnectionStore({ kind: 'supabase', encryptionKey: KEY_TEXT, supabaseUrl: fake.url, serviceRoleKey: FAKE_SERVICE_KEY, fetchImpl });
    await captureWarnings(() => assert.rejects(odd.get(USER_A), StoreUnavailableError));
  });
});

describe('one-time token stores (tickets and OAuth states)', () => {
  const clock = () => {
    let current = 1_000_000;
    return { now: () => current, advance: (ms) => { current += ms; } };
  };

  test('tokens are 32 random bytes in hex and single use', () => {
    const { now } = clock();
    const store = createOneTimeTokenStore({ ttlMs: 1000, now });
    const token = store.issue(USER_A);
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.notEqual(store.issue(USER_A), token);
    assert.equal(store.consume(token), USER_A);
    assert.equal(store.consume(token), null, 'second use fails');
  });

  test('expired tokens are refused and removed', () => {
    const { now, advance } = clock();
    const store = createOneTimeTokenStore({ ttlMs: 1000, now });
    const token = store.issue(USER_B);
    advance(999);
    const fresh = store.issue(USER_B);
    advance(1);
    assert.equal(store.consume(token), null, 'expired at exactly ttl');
    assert.equal(store.consume(fresh), USER_B);
    assert.equal(store.size, 0);
  });

  test('unknown, empty and non-string tokens are refused', () => {
    const store = createOneTimeTokenStore({ ttlMs: 1000 });
    store.issue(USER_A);
    for (const value of [undefined, null, '', 'nope', ['a'], { toString: () => 'x' }, 42]) {
      assert.equal(store.consume(value), null);
    }
  });

  test('a non-UUID user id cannot be bound', () => {
    const store = createOneTimeTokenStore({ ttlMs: 1000 });
    assert.throws(() => store.issue('not-a-uuid'), TypeError);
  });

  test('the bound is enforced; expired entries are swept to make room', () => {
    const { now, advance } = clock();
    const store = createOneTimeTokenStore({ ttlMs: 1000, maxEntries: 1000, now });
    const tokens = Array.from({ length: 1000 }, () => store.issue(USER_A));
    assert.ok(tokens.every(Boolean));
    assert.equal(store.issue(USER_A), null, 'entry 1,001 with nothing expired is refused (busy)');
    assert.equal(store.size, 1000);

    assert.equal(store.consume(tokens[0]), USER_A);
    assert.ok(store.issue(USER_A), 'consuming frees a slot');

    advance(1000);
    assert.ok(store.issue(USER_A), 'expired entries are swept on access');
    assert.equal(store.size, 1);
  });
});

describe('request log redaction', () => {
  test('ticket, code and state are redacted', () => {
    const ticket = crypto.randomBytes(32).toString('hex');
    const redacted = redactUrl(`/auth/github?ticket=${ticket}`);
    assert.equal(redacted, '/auth/github?ticket=REDACTED');
    assert.equal(redactUrl('/auth/github/callback?code=abc&state=def'), '/auth/github/callback?code=REDACTED&state=REDACTED');
  });
});
