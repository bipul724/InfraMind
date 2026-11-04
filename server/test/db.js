// Database test harness. Used only when TEST_DATABASE_URL points at a throwaway local
// Postgres (see the B2.0b instructions); every database suite is skipped otherwise.
//
// createTestDatabase() builds a fresh database owned by a dedicated login role whose
// password is a distinctive marker (so tests can prove it never reaches a log), gives it
// Supabase-like default privileges for the anon and authenticated roles (so the
// migration's revokes are really exercised), and runs `prisma migrate deploy` on it.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { SERVER_DIR } from './helpers.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
export const DB_SKIP = TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL to a throwaway local Postgres to run the database suites';
const PRISMA_BIN = path.join(SERVER_DIR, 'node_modules', '.bin', 'prisma');

const randomName = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

export async function adminQuery(sql, params = [], database) {
  const url = new URL(TEST_DATABASE_URL);
  if (database) url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

// The roles Supabase's Data API uses; plain Postgres does not have them. Test files run
// in parallel: when two create the same role at once, the loser gets unique_violation
// (pg_authid_rolname_index) rather than duplicate_object, so both mean "already exists".
export async function ensureBrowserRoles() {
  for (const role of ['anon', 'authenticated']) {
    await adminQuery(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
  }
}

// prisma migrate deploy against url, with an explicit environment (no .env, no telemetry)
export function runMigrateDeploy(url) {
  return new Promise((resolve) => {
    const child = spawn(PRISMA_BIN, ['migrate', 'deploy'], {
      cwd: SERVER_DIR,
      env: {
        PATH: process.env.PATH,
        HOME: os.tmpdir(),
        DATABASE_URL: url,
        DOTENV_CONFIG_PATH: path.join(os.tmpdir(), 'does-not-exist.env'),
        CHECKPOINT_DISABLE: '1',
        PRISMA_HIDE_UPDATE_MESSAGE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function createTestDatabase({ migrate = true } = {}) {
  await ensureBrowserRoles();
  const name = randomName('inframind_test');
  const owner = randomName('inframind_owner');
  const password = `pw${crypto.randomBytes(12).toString('hex')}MARKER`;
  await adminQuery(`CREATE ROLE ${owner} LOGIN PASSWORD '${password}'`);
  await adminQuery(`CREATE DATABASE ${name} OWNER ${owner}`);
  // What Supabase does for objects created in public: browser roles get access by default
  await adminQuery(`GRANT USAGE ON SCHEMA public TO anon, authenticated`, [], name);
  await adminQuery(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`, [], name);
  await adminQuery(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated`, [], name);

  const admin = new URL(TEST_DATABASE_URL);
  const url = new URL(TEST_DATABASE_URL);
  url.username = owner;
  url.password = password;
  url.pathname = `/${name}`;

  if (migrate) {
    const result = await runMigrateDeploy(url.toString());
    if (result.code !== 0) throw new Error(`prisma migrate deploy failed (exit ${result.code})`);
  }

  return {
    name,
    owner,
    password,
    url: url.toString(),
    host: admin.hostname,
    port: Number(admin.port || 5432),
    // The same database through another host and port (e.g. a TCP proxy)
    urlVia(host, port) {
      const via = new URL(url.toString());
      via.hostname = host;
      via.port = String(port);
      return via.toString();
    },
    async drop() {
      await adminQuery('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
      await adminQuery(`DROP DATABASE IF EXISTS ${name}`);
      await adminQuery(`DROP ROLE IF EXISTS ${owner}`);
    }
  };
}

// A TCP proxy in front of the database. cut() drops every open connection and refuses
// new ones (they are closed at once); restore() forwards again.
export async function startTcpProxy({ host, port }) {
  let forwarding = true;
  const pairs = new Set();
  const server = net.createServer((client) => {
    if (!forwarding) {
      client.destroy();
      return;
    }
    const upstream = net.connect(port, host);
    const pair = { client, upstream };
    pairs.add(pair);
    const close = () => {
      client.destroy();
      upstream.destroy();
      pairs.delete(pair);
    };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();

  return {
    host: '127.0.0.1',
    port: server.address().port,
    cut() {
      forwarding = false;
      for (const { client, upstream } of pairs) {
        client.destroy();
        upstream.destroy();
      }
      pairs.clear();
    },
    restore() {
      forwarding = true;
    },
    async close() {
      this.cut();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
