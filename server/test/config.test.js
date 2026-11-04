// B1.4: server settings (utils/config.js), GitHub error classification (github.js) and
// draining the one-time token store (utils/githubConnections.js). Pure functions only.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AxiosError } from 'axios';
import {
  DEV_CLIENT_ORIGIN,
  RATE_LIMITS,
  describeRateLimits,
  describeServerConfigProblems,
  readAllowedOrigins,
  readGitHubTimeoutMs,
  readRateLimits,
  readTrustProxy
} from '../utils/config.js';
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
  isRateLimitResponse,
  retryAfterSeconds,
  toTypedGitHubError
} from '../github.js';
import { createOneTimeTokenStore } from '../utils/githubConnections.js';

const VALID = {
  CLIENT_URL: 'http://localhost:5173',
  GITHUB_CLIENT_ID: 'Iv1.abcdefabcdef',
  GITHUB_CLIENT_SECRET: 'a-real-looking-secret',
  GITHUB_REDIRECT_URI: 'http://localhost:10000/auth/github/callback',
  NODE_ENV: 'test'
};
const problemsFor = (overrides) => describeServerConfigProblems({ ...VALID, ...overrides });
const MARKER = 'VALUE_MARKER_b14';

describe('describeServerConfigProblems', () => {
  test('a valid configuration has no problem', () => {
    assert.deepEqual(problemsFor({}), []);
    assert.deepEqual(problemsFor({ PORT: '10000', TRUST_PROXY: '1', CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example:8443', GITHUB_TIMEOUT_MS: '5000', METRICS_TOKEN: 'x'.repeat(32), RATE_LIMIT_USER_MAX: '500' }), []);
  });

  const cases = [
    ['PORT not an integer', { PORT: `80${MARKER}` }, 'PORT must be an integer from 1 to 65535'],
    ['PORT out of range', { PORT: '70000' }, 'PORT must be an integer from 1 to 65535'],
    ['CLIENT_URL missing', { CLIENT_URL: undefined }, 'CLIENT_URL is not set'],
    ['CLIENT_URL not http(s)', { CLIENT_URL: `ftp://${MARKER}.example` }, 'CLIENT_URL must use http or https'],
    ['CLIENT_URL with a path', { CLIENT_URL: `https://${MARKER}.example/app` }, 'CLIENT_URL must be an origin only'],
    ['CLIENT_URL with a trailing slash', { CLIENT_URL: 'https://app.example/' }, 'CLIENT_URL must be an origin only'],
    ['CLIENT_URL http in production', { CLIENT_URL: 'http://app.example', GITHUB_REDIRECT_URI: 'https://api.example/auth/github/callback', NODE_ENV: 'production' }, 'CLIENT_URL must use https when NODE_ENV=production'],
    ['GITHUB_CLIENT_ID missing', { GITHUB_CLIENT_ID: '' }, 'GITHUB_CLIENT_ID is not set'],
    ['GITHUB_CLIENT_ID placeholder', { GITHUB_CLIENT_ID: 'your-github-client-id' }, 'GITHUB_CLIENT_ID is still the placeholder from .env.example'],
    ['GITHUB_CLIENT_SECRET placeholder', { GITHUB_CLIENT_SECRET: 'your-github-client-secret' }, 'GITHUB_CLIENT_SECRET is still the placeholder from .env.example'],
    ['GITHUB_REDIRECT_URI missing', { GITHUB_REDIRECT_URI: undefined }, 'GITHUB_REDIRECT_URI is not set'],
    ['GITHUB_REDIRECT_URI wrong path', { GITHUB_REDIRECT_URI: `https://${MARKER}.example/callback` }, 'GITHUB_REDIRECT_URI must end in /auth/github/callback'],
    ['GITHUB_REDIRECT_URI http in production', { CLIENT_URL: 'https://app.example', GITHUB_REDIRECT_URI: 'http://api.example/auth/github/callback', NODE_ENV: 'production' }, 'GITHUB_REDIRECT_URI must use https when NODE_ENV=production'],
    ['TRUST_PROXY true', { TRUST_PROXY: 'true' }, 'TRUST_PROXY must be an integer from 0 to 3'],
    ['TRUST_PROXY 4', { TRUST_PROXY: '4' }, 'TRUST_PROXY must be an integer from 0 to 3'],
    ['TRUST_PROXY an IP list', { TRUST_PROXY: `10.0.0.1${MARKER}` }, 'TRUST_PROXY must be an integer from 0 to 3'],
    ['a CORS origin with a path', { CORS_ALLOWED_ORIGINS: `https://${MARKER}.example/path` }, 'CORS_ALLOWED_ORIGINS entry 1 must be exactly scheme://host[:port]'],
    ['a CORS wildcard', { CORS_ALLOWED_ORIGINS: 'https://a.example,*' }, 'CORS_ALLOWED_ORIGINS entry 2 must not contain a wildcard'],
    ['a CORS ftp: origin', { CORS_ALLOWED_ORIGINS: 'ftp://files.example' }, 'CORS_ALLOWED_ORIGINS entry 1 must use http or https'],
    ['a CORS trailing slash', { CORS_ALLOWED_ORIGINS: 'https://a.example/' }, 'CORS_ALLOWED_ORIGINS entry 1 must be exactly scheme://host[:port]'],
    ['an empty CORS entry', { CORS_ALLOWED_ORIGINS: 'https://a.example,,https://b.example' }, 'CORS_ALLOWED_ORIGINS entry 2 is empty'],
    ['RATE_LIMIT_*_MAX zero', { RATE_LIMIT_CLONE_MAX: '0' }, 'RATE_LIMIT_CLONE_MAX must be an integer from 1 to 100000'],
    ['RATE_LIMIT_*_MAX too large', { RATE_LIMIT_PREAUTH_MAX: '100001' }, 'RATE_LIMIT_PREAUTH_MAX must be an integer from 1 to 100000'],
    ['RATE_LIMIT_*_MAX not a number', { RATE_LIMIT_USER_MAX: `1e3${MARKER}` }, 'RATE_LIMIT_USER_MAX must be an integer from 1 to 100000'],
    ['an unknown RATE_LIMIT_*_MAX', { RATE_LIMIT_EVERYTHING_MAX: '5' }, 'RATE_LIMIT_EVERYTHING_MAX is not a known rate limit'],
    ['GITHUB_TIMEOUT_MS too small', { GITHUB_TIMEOUT_MS: '999' }, 'GITHUB_TIMEOUT_MS must be an integer from 1000 to 60000'],
    ['GITHUB_TIMEOUT_MS too large', { GITHUB_TIMEOUT_MS: '60001' }, 'GITHUB_TIMEOUT_MS must be an integer from 1000 to 60000'],
    ['a short METRICS_TOKEN', { METRICS_TOKEN: `short${MARKER}` }, 'METRICS_TOKEN must be at least 32 characters'],
    ['TEST_FAULT_INJECTION in production', { TEST_FAULT_INJECTION: 'uncaught-exception', NODE_ENV: 'production', CLIENT_URL: 'https://a.example', GITHUB_REDIRECT_URI: 'https://a.example/auth/github/callback' }, 'TEST_FAULT_INJECTION is a test-only setting and is refused unless NODE_ENV=test'],
    ['TEST_FAULT_INJECTION in development', { TEST_FAULT_INJECTION: 'uncaught-exception', NODE_ENV: 'development' }, 'TEST_FAULT_INJECTION is a test-only setting'],
    ['an unknown TEST_FAULT_INJECTION mode', { TEST_FAULT_INJECTION: 'explode' }, 'TEST_FAULT_INJECTION must be one of']
  ];
  for (const [name, overrides, expected] of cases) {
    test(`${name}: one clear problem, without the value`, () => {
      const env = { ...VALID, ...overrides };
      for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete env[key];
      const problems = describeServerConfigProblems(env);
      assert.equal(problems.length, 1, JSON.stringify(problems));
      assert.ok(problems[0].startsWith(expected), problems[0]);
      assert.ok(!problems[0].includes(MARKER), 'the value is never repeated');
    });
  }

  test('every problem is reported at once', () => {
    const problems = problemsFor({ PORT: 'x', CLIENT_URL: 'ftp://a', TRUST_PROXY: 'true', GITHUB_TIMEOUT_MS: '1', METRICS_TOKEN: 'short' });
    assert.equal(problems.length, 5);
  });
});

describe('readTrustProxy', () => {
  test('defaults to 0; accepts 0 to 3', () => {
    assert.equal(readTrustProxy({}).value, 0);
    for (const value of ['0', '1', '2', '3']) assert.deepEqual(readTrustProxy({ TRUST_PROXY: value }), { value: Number(value), problem: null });
  });
  test('never true: invalid values fall back to 0 (and are a startup problem)', () => {
    for (const value of ['true', 'false', '-1', '1.5', 'loopback', ' 1']) {
      const read = readTrustProxy({ TRUST_PROXY: value });
      assert.equal(read.value, 0, value);
      assert.ok(read.problem, value);
    }
  });
});

describe('readAllowedOrigins', () => {
  test('CLIENT_URL origin, CORS_ALLOWED_ORIGINS, and the dev origin outside production', () => {
    assert.deepEqual(readAllowedOrigins({ CLIENT_URL: 'https://app.example', CORS_ALLOWED_ORIGINS: 'https://admin.example, http://127.0.0.1:3000', NODE_ENV: 'development' }).origins,
      ['https://app.example', 'https://admin.example', 'http://127.0.0.1:3000', DEV_CLIENT_ORIGIN]);
  });
  test('no dev origin in production, and dev-pilot.vercel.app is never added', () => {
    const { origins } = readAllowedOrigins({ CLIENT_URL: 'https://app.example', NODE_ENV: 'production' });
    assert.deepEqual(origins, ['https://app.example']);
    assert.ok(!origins.includes('https://dev-pilot.vercel.app'));
  });
  test('duplicates collapse', () => {
    assert.deepEqual(readAllowedOrigins({ CLIENT_URL: DEV_CLIENT_ORIGIN, CORS_ALLOWED_ORIGINS: DEV_CLIENT_ORIGIN }).origins, [DEV_CLIENT_ORIGIN]);
  });
  test('invalid entries are left out and reported', () => {
    const read = readAllowedOrigins({ CLIENT_URL: 'https://app.example', CORS_ALLOWED_ORIGINS: 'https://*.example,https://ok.example,HTTPS://Upper.example', NODE_ENV: 'production' });
    assert.deepEqual(read.origins, ['https://app.example', 'https://ok.example']);
    assert.equal(read.problems.length, 2);
  });
});

describe('readRateLimits', () => {
  test('defaults', () => {
    const { limits, problems } = readRateLimits({});
    assert.deepEqual(problems, []);
    assert.deepEqual(Object.fromEntries(Object.values(limits).map((l) => [l.name, [l.max, l.windowMs, l.key]])), {
      preAuth: [300, 300000, 'ip'],
      user: [120, 60000, 'user'],
      githubProxy: [60, 60000, 'user'],
      clone: [10, 600000, 'user'],
      analysis: [5, 300000, 'user'],
      oauth: [30, 600000, 'ip'],
      socketHandshake: [60, 60000, 'ip']
    });
    assert.equal(describeRateLimits(limits), 'preAuth 300 per 5 min, user 120 per 1 min, githubProxy 60 per 1 min, clone 10 per 10 min, analysis 5 per 5 min, oauth 30 per 10 min, socketHandshake 60 per 1 min');
  });
  test('overrides change counts only; windows stay fixed', () => {
    const { limits } = readRateLimits({ RATE_LIMIT_SOCKETHANDSHAKE_MAX: '3', RATE_LIMIT_GITHUBPROXY_MAX: '100000' });
    assert.equal(limits.socketHandshake.max, 3);
    assert.equal(limits.socketHandshake.windowMs, 60000);
    assert.equal(limits.githubProxy.max, 100000);
  });
  test('no setting switches limiting off', () => {
    for (const value of ['0', '-1', 'off', 'false', 'Infinity', '100001']) {
      const { limits, problems } = readRateLimits({ RATE_LIMIT_CLONE_MAX: value });
      assert.equal(limits.clone.max, 10, value);
      assert.equal(problems.length, 1, value);
    }
    assert.equal(RATE_LIMITS.length, 7);
  });
});

describe('readGitHubTimeoutMs', () => {
  test('default 10000, range 1000-60000', () => {
    assert.deepEqual(readGitHubTimeoutMs({}), { value: 10000, problem: null });
    assert.equal(readGitHubTimeoutMs({ GITHUB_TIMEOUT_MS: '1000' }).value, 1000);
    assert.equal(readGitHubTimeoutMs({ GITHUB_TIMEOUT_MS: '60000' }).value, 60000);
    assert.equal(readGitHubTimeoutMs({ GITHUB_TIMEOUT_MS: '0' }).value, 10000);
  });
});

describe('GitHub errors: rate limit vs no access vs outage', () => {
  const httpError = (status, headers = {}, message = 'x') =>
    new AxiosError('Request failed', 'ERR_BAD_REQUEST', {}, {}, { status, headers, data: { message } });
  const now = Date.UTC(2026, 10, 4, 12, 0, 0);

  test('primary limit: 403 with x-ratelimit-remaining: 0 waits until x-ratelimit-reset', () => {
    const error = httpError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 120) }, 'API rate limit exceeded for user ID 1.');
    assert.equal(isRateLimitResponse(error), true);
    assert.equal(retryAfterSeconds(error, now), 120);
  });
  test('secondary limit by message only: at least one minute', () => {
    const error = httpError(403, {}, 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.');
    assert.equal(isRateLimitResponse(error), true);
    assert.equal(retryAfterSeconds(error, now), 60);
  });
  test('retry-after wins and is capped at 3600', () => {
    assert.equal(retryAfterSeconds(httpError(429, { 'retry-after': '30' }), now), 30);
    assert.equal(retryAfterSeconds(httpError(403, { 'retry-after': '99999' }), now), 3600);
    assert.equal(retryAfterSeconds(httpError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 99999) }), now), 3600);
  });
  test('a 429 is always a rate limit; a plain 403 or a 404 is not', () => {
    assert.equal(isRateLimitResponse(httpError(429)), true);
    assert.equal(isRateLimitResponse(httpError(403, { 'x-ratelimit-remaining': '42' }, 'Resource not accessible by integration')), false);
    assert.equal(isRateLimitResponse(httpError(404)), false);
    assert.equal(toTypedGitHubError(httpError(403)), null);
  });
  test('typed errors', () => {
    const limited = toTypedGitHubError(httpError(429, { 'retry-after': '7' }));
    assert.ok(limited instanceof GitHubRateLimitedError);
    assert.equal(limited.code, 'GITHUB_RATE_LIMITED');
    assert.equal(limited.retryAfterSeconds, 7);
    const timeout = toTypedGitHubError(new AxiosError('timeout of 1000ms exceeded', 'ECONNABORTED', {}, {}));
    assert.ok(timeout instanceof GitHubUnavailableError);
    assert.equal(timeout.code, 'GITHUB_UNAVAILABLE');
    assert.ok(toTypedGitHubError(new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED', {}, {})) instanceof GitHubUnavailableError);
    assert.equal(toTypedGitHubError(new Error('not axios')), null);
  });
});

describe('createOneTimeTokenStore drain()', () => {
  test('removes every entry and returns the live ones; expired ones go through onExpire', () => {
    let time = 1000;
    const expired = [];
    const store = createOneTimeTokenStore({ ttlMs: 100, now: () => time, onExpire: (entry) => expired.push(entry.payload) });
    const [old, userA, userB] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    store.issue(old, 'old');
    time += 150;
    const a = store.issue(userA, 'a');
    store.issue(userB, 'b');
    assert.deepEqual(store.drain(), [{ userId: userA, payload: 'a' }, { userId: userB, payload: 'b' }]);
    assert.deepEqual(expired, ['old']);
    assert.equal(store.size, 0);
    assert.equal(store.consume(a), null, 'a drained entry cannot be claimed');
    assert.deepEqual(store.drain(), []);
  });
});
