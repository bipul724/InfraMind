// Unit tests for the database configuration and TLS policy (no database needed)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPoolConfig, describeDatabaseConfigProblem, describeDatabaseTlsWarning, isLocalDatabaseHost } from '../db/config.js';

const PASSWORD = 'PW_MARKER_9x';
const REMOTE = `postgresql://postgres.ref:${PASSWORD}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

describe('database configuration', () => {
  const rejected = [
    ['missing', {}, 'DATABASE_URL is not set'],
    ['not a URL', { DATABASE_URL: `not a url ${PASSWORD}` }, 'DATABASE_URL is not a valid URL'],
    ['mysql', { DATABASE_URL: `mysql://u:${PASSWORD}@db.example.com/app` }, 'DATABASE_URL must start with postgres:// or postgresql://'],
    ['TLS disabled for a remote host', { DATABASE_URL: `${REMOTE}?sslmode=disable` }, 'DATABASE_URL must not disable TLS for a non-local database'],
    ['pool size 0', { DATABASE_URL: REMOTE, DATABASE_POOL_MAX: '0' }, 'DATABASE_POOL_MAX must be an integer from 1 to 20'],
    ['pool size 21', { DATABASE_URL: REMOTE, DATABASE_POOL_MAX: '21' }, 'DATABASE_POOL_MAX must be an integer from 1 to 20'],
    ['an unreadable CA file', { DATABASE_URL: REMOTE, DATABASE_SSL_CA_FILE: `/nonexistent/${PASSWORD}.crt` }, 'DATABASE_SSL_CA_FILE is not a readable file'],
    ['a bad insecure flag', { DATABASE_URL: REMOTE, DATABASE_SSL_INSECURE_SKIP_VERIFY: 'yes' }, 'DATABASE_SSL_INSECURE_SKIP_VERIFY must be true or false']
  ];
  for (const [label, env, message] of rejected) {
    test(`rejects ${label}, without the value`, () => {
      const problem = describeDatabaseConfigProblem(env);
      assert.equal(problem, message);
      assert.ok(!problem.includes(PASSWORD));
      assert.throws(() => buildPoolConfig(env), (error) => error.message === message);
    });
  }

  test('local hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) assert.ok(isLocalDatabaseHost(host), host);
    for (const host of ['db.example.supabase.co', '10.0.0.1', 'localhost.evil.com']) assert.ok(!isLocalDatabaseHost(host), host);
  });
});

describe('TLS policy', () => {
  test('a remote host always gets TLS with certificate verification, whatever sslmode says', () => {
    for (const query of ['', '?sslmode=require', '?sslmode=no-verify', '?sslmode=prefer&sslrootcert=/x', '?ssl=true&uselibpqcompat=true']) {
      const config = buildPoolConfig({ DATABASE_URL: `${REMOTE}${query}` });
      assert.deepEqual(config.ssl, { rejectUnauthorized: true }, query);
      assert.ok(!/ssl|uselibpqcompat/i.test(new URL(config.connectionString).search), 'SSL parameters are removed from the string so pg cannot override the policy');
    }
  });

  test('a local host uses plaintext unless sslmode asks for TLS', () => {
    assert.equal(buildPoolConfig({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db' }).ssl, false);
    assert.equal(buildPoolConfig({ DATABASE_URL: 'postgresql://u:p@localhost/db?sslmode=disable' }).ssl, false);
    assert.deepEqual(buildPoolConfig({ DATABASE_URL: 'postgresql://u:p@localhost/db?sslmode=verify-full' }).ssl, { rejectUnauthorized: true });
  });

  test('DATABASE_SSL_CA_FILE adds the CA; verification stays on', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-ca-'));
    const file = path.join(dir, 'ca.crt');
    await fs.writeFile(file, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
    const config = buildPoolConfig({ DATABASE_URL: REMOTE, DATABASE_SSL_CA_FILE: file });
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.ok(config.ssl.ca.includes('TEST'));
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('only the explicit insecure variable turns verification off, with a warning', () => {
    assert.equal(describeDatabaseTlsWarning({ DATABASE_URL: REMOTE }), null);
    assert.equal(describeDatabaseTlsWarning({ DATABASE_URL: REMOTE, DATABASE_SSL_INSECURE_SKIP_VERIFY: 'false' }), null);
    const env = { DATABASE_URL: REMOTE, DATABASE_SSL_INSECURE_SKIP_VERIFY: 'true' };
    assert.deepEqual(buildPoolConfig(env).ssl, { rejectUnauthorized: false });
    assert.match(describeDatabaseTlsWarning(env), /NOT verified/);
  });

  test('pool size and timeouts', () => {
    const defaults = buildPoolConfig({ DATABASE_URL: REMOTE });
    assert.equal(defaults.max, 5);
    assert.equal(defaults.connectionTimeoutMillis, 5000);
    assert.equal(defaults.query_timeout, 5000);
    assert.equal(defaults.statement_timeout, 5000);
    assert.equal(buildPoolConfig({ DATABASE_URL: REMOTE, DATABASE_POOL_MAX: '20' }).max, 20);
  });
});
