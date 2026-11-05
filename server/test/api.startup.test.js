// B1.4: startup lists every configuration problem at once, names variables and never
// prints values, and refuses to start until the list is empty. Spawned servers.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeFakes, runServerExpectingExit, startServer } from './helpers.js';

after(async () => { await closeFakes(); });

describe('all problems at once', () => {
  test('a server with many problems lists them all in one output, without any value, and exits 1 within 10 s', async () => {
    const marker = (n) => `CFGMARKER${n}x`;
    const envOverrides = {
      // existing checks
      SUPABASE_URL: `http://${marker(1)}.example`,
      GITHUB_TOKEN_STORE: `${marker(2)}`,
      AI_TIMEOUT_MS: `${marker(3)}`,
      SESSION_STORE: `${marker(4)}`,
      // B1.4 checks
      PORT: `80${marker(5)}`,
      CLIENT_URL: `ftp://${marker(6)}.example`,
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: 'your-github-client-secret',
      GITHUB_REDIRECT_URI: `https://${marker(7)}.example/wrong`,
      TRUST_PROXY: `true${marker(8)}`,
      CORS_ALLOWED_ORIGINS: `https://${marker(9)}.example/path,*`,
      RATE_LIMIT_USER_MAX: `0${marker(10)}`,
      GITHUB_TIMEOUT_MS: `5${marker(11)}`,
      METRICS_TOKEN: `short${marker(12)}`,
      // B2.1 checks
      ANALYSIS_CONCURRENCY: `0${marker(13)}`,
      ANALYSIS_QUEUE_MAX: `${marker(14)}`
    };
    const started = Date.now();
    const result = await runServerExpectingExit({ envOverrides, timeoutMs: 10000 });
    assert.equal(result.timedOut, false);
    assert.ok(Date.now() - started < 10000);
    assert.equal(result.code, 1);

    const expected = [
      'SUPABASE_URL', 'GITHUB_TOKEN_STORE', 'AI_TIMEOUT_MS', 'SESSION_STORE',
      'PORT must be an integer', 'CLIENT_URL must use http or https', 'GITHUB_CLIENT_ID is not set',
      'GITHUB_CLIENT_SECRET is still the placeholder', 'GITHUB_REDIRECT_URI must end in /auth/github/callback',
      'TRUST_PROXY must be an integer', 'CORS_ALLOWED_ORIGINS entry 1', 'CORS_ALLOWED_ORIGINS entry 2 must not contain a wildcard',
      'RATE_LIMIT_USER_MAX must be an integer', 'GITHUB_TIMEOUT_MS must be an integer', 'METRICS_TOKEN must be at least 32 characters',
      'ANALYSIS_CONCURRENCY must be an integer from 1 to 8', 'ANALYSIS_QUEUE_MAX must be an integer from 0 to 100'
    ];
    for (const text of expected) assert.ok(result.stderr.includes(text), `stderr should include "${text}":\n${result.stderr}`);
    const header = result.stderr.match(/Configuration problems \((\d+)\):/);
    assert.ok(header, result.stderr);
    assert.ok(Number(header[1]) >= expected.length);
    const output = `${result.stdout}\n${result.stderr}`;
    for (let n = 1; n <= 14; n++) assert.ok(!output.includes(marker(n)), `${marker(n)} must not be printed`);
    assert.ok(!output.includes('your-github-client-secret'), 'not even the placeholder value');
    assert.ok(!output.includes('Starting InfraMind Server'), 'nothing starts');
  });
});

describe('each new check alone gives one clear message', () => {
  const PRODUCTION = { NODE_ENV: 'production', CLIENT_URL: 'https://app.example.test', GITHUB_REDIRECT_URI: 'https://api.example.test/auth/github/callback' };
  const cases = [
    [{ PORT: '0' }, 'PORT must be an integer from 1 to 65535'],
    [{ CLIENT_URL: undefined }, 'CLIENT_URL is not set'],
    [{ CLIENT_URL: 'https://app.example.test/app' }, 'CLIENT_URL must be an origin only'],
    [{ ...PRODUCTION, CLIENT_URL: 'http://app.example.test' }, 'CLIENT_URL must use https when NODE_ENV=production'],
    [{ GITHUB_CLIENT_ID: undefined }, 'GITHUB_CLIENT_ID is not set'],
    [{ GITHUB_CLIENT_ID: 'your-github-client-id' }, 'GITHUB_CLIENT_ID is still the placeholder from .env.example'],
    [{ GITHUB_CLIENT_SECRET: '' }, 'GITHUB_CLIENT_SECRET is not set'],
    [{ GITHUB_REDIRECT_URI: 'http://localhost:10000/callback' }, 'GITHUB_REDIRECT_URI must end in /auth/github/callback'],
    [{ ...PRODUCTION, GITHUB_REDIRECT_URI: 'http://api.example.test/auth/github/callback' }, 'GITHUB_REDIRECT_URI must use https when NODE_ENV=production'],
    [{ TRUST_PROXY: 'true' }, 'TRUST_PROXY must be an integer from 0 to 3'],
    [{ CORS_ALLOWED_ORIGINS: 'ftp://files.example.test' }, 'CORS_ALLOWED_ORIGINS entry 1 must use http or https'],
    [{ RATE_LIMIT_OAUTH_MAX: '100001' }, 'RATE_LIMIT_OAUTH_MAX must be an integer from 1 to 100000'],
    [{ GITHUB_TIMEOUT_MS: '500' }, 'GITHUB_TIMEOUT_MS must be an integer from 1000 to 60000'],
    [{ METRICS_TOKEN: 'too-short' }, 'METRICS_TOKEN must be at least 32 characters'],
    [{ ...PRODUCTION, TEST_FAULT_INJECTION: 'uncaught-exception' }, 'TEST_FAULT_INJECTION is a test-only setting and is refused unless NODE_ENV=test'],
    [{ ANALYSIS_CONCURRENCY: '9' }, 'ANALYSIS_CONCURRENCY must be an integer from 1 to 8'],
    [{ ANALYSIS_QUEUE_MAX: '101' }, 'ANALYSIS_QUEUE_MAX must be an integer from 0 to 100']
  ];
  for (const [envOverrides, message] of cases) {
    test(message, async () => {
      const result = await runServerExpectingExit({ envOverrides, timeoutMs: 10000 });
      assert.equal(result.code, 1);
      assert.ok(result.stderr.includes('Configuration problems (1):'), result.stderr);
      assert.ok(result.stderr.includes(`❌ ${message}`), result.stderr);
    });
  }
});

describe('a valid configuration still starts', () => {
  test('with every optional B1.4 setting', async () => {
    const server = await startServer({
      envOverrides: {
        TRUST_PROXY: '1',
        CORS_ALLOWED_ORIGINS: 'https://admin.example.test,http://127.0.0.1:4173',
        RATE_LIMIT_PREAUTH_MAX: '1000',
        RATE_LIMIT_SOCKETHANDSHAKE_MAX: '10',
        GITHUB_TIMEOUT_MS: '2000',
        METRICS_TOKEN: 'm'.repeat(32)
      }
    });
    try {
      assert.equal((await fetch(`${server.baseUrl}/health`)).status, 200);
      const logs = server.logs();
      assert.ok(logs.includes('🌐 Allowed origins: http://localhost:5173, https://admin.example.test, http://127.0.0.1:4173'), logs);
      assert.ok(logs.includes('🌐 Trust proxy: 1'));
      assert.ok(logs.includes('🚦 Rate limits: preAuth 1000 per 5 min, user 120 per 1 min, githubProxy 60 per 1 min, clone 10 per 10 min, analysis 5 per 5 min, oauth 30 per 10 min, socketHandshake 10 per 1 min'), logs);
      assert.ok(!logs.includes('dev-pilot'));
    } finally {
      await server.stop();
    }
  });
});
