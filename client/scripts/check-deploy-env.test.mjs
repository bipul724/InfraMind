import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const script = fileURLToPath(new URL('./check-deploy-env.mjs', import.meta.url));
const valid = {
  VITE_API_URL: 'https://api.example.com',
  VITE_SUPABASE_URL: 'https://abcd.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'fake-public-anon-key-for-guard-tests',
};

function run(changes = {}) {
  const env = { ...valid, ...changes };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete env[name];
  }
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.ifError(result.error);
  return { ...result, env };
}

function expectFailure(variable, changes) {
  const result = run(changes);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(variable), `The error must name ${variable}`);
  for (const [name, value] of Object.entries(result.env)) {
    if (value.trim()) assert.ok(!result.stderr.includes(value), `${name} leaked into the error output`);
  }
}

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.fake-signature-for-tests`;
}

describe('check-deploy-env', () => {
  it('accepts valid values with NODE_ENV unset and prints exactly three safe lines', () => {
    const result = run();
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(Object.hasOwn(result.env, 'NODE_ENV'), false);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      'VITE_API_URL: api.example.com',
      'VITE_SUPABASE_URL: abcd.supabase.co',
      'VITE_SUPABASE_ANON_KEY: configured',
    ]);
    for (const value of Object.values(valid)) assert.ok(!result.stdout.includes(value));
  });

  it('accepts NODE_ENV=production', () => {
    const result = run({ NODE_ENV: 'production' });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  });

  for (const value of ['development', 'test', '', 'staging-private-marker', 'Production']) {
    it(`rejects NODE_ENV ${JSON.stringify(value)} without printing its value`, () => {
      expectFailure('NODE_ENV', { NODE_ENV: value });
    });
  }

  for (const variable of Object.keys(valid)) {
    for (const [label, value] of [['missing', undefined], ['empty', ''], ['whitespace-only', ' \t ']]) {
      it(`rejects ${label} ${variable} without printing configured values`, () => {
        expectFailure(variable, { [variable]: value });
      });
    }
  }

  for (const variable of ['VITE_API_URL', 'VITE_SUPABASE_URL']) {
    for (const value of ['http://private-http.example.com', 'ws://private-ws.example.com', 'not-a-url-private-marker', 'https:missing-slashes.example.com']) {
      it(`rejects an invalid HTTPS URL in ${variable}: ${value.split(':')[0]}`, () => {
        expectFailure(variable, { [variable]: value });
      });
    }
    for (const host of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'service.local']) {
      it(`rejects local host ${host} in ${variable}`, () => {
        expectFailure(variable, { [variable]: `https://${host}` });
      });
    }
    for (const host of ['LOCALHOST:9443', 'localhost.', '127.1', '[0:0:0:0:0:0:0:1]', 'service.local.']) {
      it(`rejects normalized local host ${host} in ${variable}`, () => {
        expectFailure(variable, { [variable]: `https://${host}` });
      });
    }
  }

  for (const suffix of ['/api', '/', '?private=query-marker', '?', '#private-fragment-marker', '#', '/..', '/./', '\\']) {
    it(`rejects a non-root API URL suffix ${JSON.stringify(suffix)} without printing the URL`, () => {
      expectFailure('VITE_API_URL', { VITE_API_URL: `https://api-private.example.com${suffix}` });
    });
  }

  it('rejects a service-role JWT without printing the key', () => {
    expectFailure('VITE_SUPABASE_ANON_KEY', { VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role', marker: 'private-service-role-marker' }) });
  });

  it('rejects an sb_secret key without printing the key', () => {
    expectFailure('VITE_SUPABASE_ANON_KEY', { VITE_SUPABASE_ANON_KEY: 'sb_' + 'secret_private-secret-marker-for-tests' });
  });

  it('accepts an ordinary anon JWT without printing the key', () => {
    const key = jwt({ role: 'anon', marker: 'ordinary-anon-marker' });
    const result = run({ VITE_SUPABASE_ANON_KEY: key });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes(key));
  });

  it('does not treat a malformed JWT-shaped public key as a service-role key', () => {
    const result = run({ VITE_SUPABASE_ANON_KEY: 'fake.not-json.signature' });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  });
});
