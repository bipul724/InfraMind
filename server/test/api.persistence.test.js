// Spawned servers with SESSION_STORE=database against a throwaway local Postgres
// (TEST_DATABASE_URL). Rows are seeded directly through Prisma. Offline otherwise.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { io as connectClient } from 'socket.io-client';
import {
  allCapturedLogs,
  authHeaders,
  closeFakes,
  getFakes,
  makeTempDir,
  pathExists,
  postJson,
  runServerExpectingExit,
  startServer,
  waitForLog
} from './helpers.js';
import { USER_A, USER_B } from './fakeSupabase.js';
import { DB_SKIP, TEST_DATABASE_URL, createTestDatabase, startTcpProxy } from './db.js';

const RESTART_MESSAGE = 'The server restarted before this analysis finished. Please run it again.';
const T0 = new Date('2026-11-04T10:00:00.000Z');
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
const FILES = { dockerfile: 'FROM node:22\n', githubActions: 'name: ci\n', envExample: 'A=1\n' };

// A URL with credentials (scheme://user[:password]@host): what a leaked connection string looks like
const CREDENTIALED_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s/@'"]+@/i;

const databases = [];
const spawned = [];
let fakes;

before(async () => { fakes = await getFakes(); });
after(async () => {
  for (const server of spawned) await server.stop().catch(() => {});
  for (const db of databases) await db.drop().catch(() => {});
  await closeFakes();
});

async function newDatabase(options) {
  const db = await createTestDatabase(options);
  databases.push(db);
  return db;
}

async function launch(db, { url = db.url, cwd } = {}) {
  const server = await startServer({ cwd, envOverrides: { SESSION_STORE: 'database', DATABASE_URL: url } });
  spawned.push(server);
  return server;
}

async function prismaFor(db) {
  const { createPrismaClient } = await import('../db/client.js');
  return createPrismaClient({ DATABASE_URL: db.url });
}

async function seed(prisma, { userId = USER_A.id, status = 'completed', expiresAt = new Date(Date.now() + 3600 * 1000), lastProgress, clonedAt, messages, errors } = {}) {
  const id = crypto.randomUUID();
  const completed = status === 'completed';
  await prisma.analysisSession.create({
    data: {
      id,
      userId,
      owner: 'octocat',
      repo: 'Hello-World',
      fullName: 'octocat/Hello-World',
      repoName: 'Hello-World',
      displayUrl: 'https://github.com/octocat/Hello-World',
      status,
      createdAt: T0,
      updatedAt: T0,
      clonedAt: clonedAt ?? (status === 'cloning' ? null : at(5)),
      analysisStartedAt: ['analyzing', 'completed'].includes(status) ? at(10) : null,
      completedAt: completed ? at(60) : null,
      expiresAt,
      ...(completed ? {
        techStack: { primary: 'node', frameworks: [] },
        codebaseAnalysis: { entryPoints: ['index.js'] },
        verificationResults: 'verified',
        // agent 'planner' stands for a session stored before B2.6 removed the planner agent
        messages: messages ?? [{ agent: 'planner', message: 'ok' }],
        errors: errors ?? []
      } : {}),
      ...(lastProgress ? { lastProgress } : {})
    }
  });
  if (completed) {
    await prisma.generatedFile.createMany({ data: Object.entries(FILES).map(([kind, content]) => ({ sessionId: id, kind, content })) });
  }
  return id;
}

async function get(server, route, token) {
  const response = await fetch(`${server.baseUrl}${route}`, { headers: authHeaders(token) });
  return { status: response.status, text: await response.text(), contentType: response.headers.get('content-type') };
}

const read3 = async (server, id, token) => ({
  status: await get(server, `/api/status/${id}`, token),
  files: await get(server, `/api/files/${id}`, token),
  download: await get(server, `/api/files/${id}/dockerfile`, token)
});

describe('database sessions: restart, ownership, recovery and cleanup', { skip: DB_SKIP }, () => {
  let db;
  let client;
  let server;
  let cwd;
  const ids = {};

  before(async () => {
    db = await newDatabase();
    client = await prismaFor(db);
    ids.completed = await seed(client.prisma, { lastProgress: { sessionId: 'x', step: 'Analysis complete!', progress: 100, status: 'completed' } });
    ids.analyzing = await seed(client.prisma, { status: 'analyzing' });
    ids.cloning = await seed(client.prisma, { status: 'cloning' });
    ids.expired = await seed(client.prisma, { expiresAt: new Date(Date.now() - 1000) });
    // B2.1: a session cloned 5 minutes ago and not analyzed yet still needs its clone
    ids.freshCloned = await seed(client.prisma, { status: 'cloned', clonedAt: new Date(Date.now() - 5 * 60 * 1000) });

    // temp/ layout before startup
    cwd = await makeTempDir();
    ids.orphan = crypto.randomUUID();
    ids.outsideTemp = crypto.randomUUID();
    for (const name of [ids.completed, ids.expired, ids.orphan, ids.freshCloned, 'keep-me-not-a-uuid']) {
      await fs.mkdir(path.join(cwd, 'temp', name, 'repo'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'temp', name, 'repo', 'marker.txt'), 'x');
    }
    await fs.mkdir(path.join(cwd, ids.outsideTemp), { recursive: true });
    // A UUID-named symlink in temp/ pointing outside: the link and its target are left alone
    ids.symlinked = crypto.randomUUID();
    const target = path.join(cwd, 'symlink-target');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'precious.txt'), 'x');
    await fs.symlink(target, path.join(cwd, 'temp', ids.symlinked), 'dir');

    server = await launch(db, { cwd });
  });
  after(async () => { await client?.close(); });

  test('1. a completed session is served by the restarted server with identical bodies', async () => {
    const first = await read3(server, ids.completed, fakes.tokens.A);
    assert.equal(first.status.status, 200);
    assert.equal(first.status.text, JSON.stringify({
      sessionId: ids.completed,
      status: 'completed',
      repoUrl: 'https://github.com/octocat/Hello-World',
      repoName: 'Hello-World',
      createdAt: T0.toISOString(),
      clonedAt: at(5).toISOString(),
      analysisStartedAt: at(10).toISOString(),
      completedAt: at(60).toISOString()
    }));
    assert.equal(first.files.status, 200);
    assert.equal(first.files.text, JSON.stringify({
      files: FILES,
      techStack: { primary: 'node', frameworks: [] },
      codebaseAnalysis: { entryPoints: ['index.js'] },
      verificationResults: 'verified',
      // SERVER-FIX D.1: the stored messages and errors, through the sanitizers
      messages: [{ agent: 'planner', message: 'ok' }],
      errors: [],
      metadata: { repoUrl: 'https://github.com/octocat/Hello-World', repoName: 'Hello-World', completedAt: at(60).toISOString() }
    }));
    assert.equal(first.download.status, 200);
    assert.equal(first.download.text, 'FROM node:22\n');

    const restarted = await launch(db);
    const second = await read3(restarted, ids.completed, fakes.tokens.A);
    assert.deepEqual(second, first, 'byte-identical after a restart');
    await restarted.stop();
  });

  test('1b. B2.6: a session stored with the planner\'s message and a Planner Agent Error still answers 200 with the same shape', async () => {
    const messages = [
      { agent: 'planner', message: 'Created comprehensive analysis plan', timestamp: '2026-11-04T10:00:11.000Z' },
      { agent: 'analyzer', message: 'Detected tech stack: node', timestamp: '2026-11-04T10:00:12.000Z' },
      { agent: 'generator', message: 'Generated 3 of 3 files', timestamp: '2026-11-04T10:00:40.000Z' },
      { agent: 'verifier', message: 'Review complete: see the review text', timestamp: '2026-11-04T10:00:59.000Z' }
    ];
    const errors = ['Planner Agent Error: AI providers are unavailable'];
    const id = await seed(client.prisma, { messages, errors });
    const read = await read3(server, id, fakes.tokens.A);
    assert.equal(read.status.status, 200);
    assert.deepEqual(Object.keys(JSON.parse(read.status.text)), ['sessionId', 'status', 'repoUrl', 'repoName', 'createdAt', 'clonedAt', 'analysisStartedAt', 'completedAt']);
    assert.equal(read.files.status, 200);
    assert.equal(read.files.text, JSON.stringify({
      files: FILES,
      techStack: { primary: 'node', frameworks: [] },
      codebaseAnalysis: { entryPoints: ['index.js'] },
      verificationResults: 'verified',
      messages,
      errors,
      metadata: { repoUrl: 'https://github.com/octocat/Hello-World', repoName: 'Hello-World', completedAt: at(60).toISOString() }
    }));
    assert.equal(read.download.status, 200);
  });

  test('2. another user gets the same 404 as an unknown id, on every route and on the socket', async () => {
    const unknown = crypto.randomUUID();
    const foreign = await read3(server, ids.completed, fakes.tokens.B);
    const missing = await read3(server, unknown, fakes.tokens.B);
    for (const key of ['status', 'files', 'download']) {
      assert.equal(foreign[key].status, 404, key);
      assert.equal(foreign[key].text, missing[key].text, key);
    }
    const analyzeForeign = await postJson(server.baseUrl, '/api/analyze', { sessionId: ids.completed }, authHeaders(fakes.tokens.B));
    const analyzeMissing = await postJson(server.baseUrl, '/api/analyze', { sessionId: unknown }, authHeaders(fakes.tokens.B));
    assert.equal(analyzeForeign.status, 404);
    assert.equal(analyzeForeign.text, analyzeMissing.text);

    const socket = await new Promise((resolve, reject) => {
      const s = connectClient(server.baseUrl, { auth: { token: fakes.tokens.B }, transports: ['websocket'], reconnection: false, forceNew: true });
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
    const events = [];
    socket.on('progress', (payload) => events.push(payload));
    const ack = await socket.timeout(3000).emitWithAck('subscribe', { sessionId: ids.completed });
    await new Promise((resolve) => setTimeout(resolve, 300));
    socket.close();
    assert.deepEqual(ack, { ok: false, error: 'Session not found' });
    assert.equal(events.length, 0, 'no snapshot of the stored lastProgress');
  });

  test('3. sessions in flight at startup are marked failed with the restart message', async () => {
    for (const id of [ids.analyzing, ids.cloning]) {
      const response = await get(server, `/api/status/${id}`, fakes.tokens.A);
      const body = JSON.parse(response.text);
      assert.equal(body.status, 'failed');
      assert.equal(body.error, RESTART_MESSAGE);
    }
    await waitForLog(server, 'Interrupted sessions marked failed: 2');
  });

  test('4. expired, orphaned and (B2.1) finished sessions\' temp directories are removed; nothing else is touched', async () => {
    assert.equal(await client.prisma.analysisSession.count({ where: { id: ids.expired } }), 0, 'expired row deleted');
    assert.equal(await client.prisma.generatedFile.count({ where: { sessionId: ids.expired } }), 0, 'its files cascade');
    assert.equal(await pathExists(path.join(cwd, 'temp', ids.expired)), false, 'expired directory removed');
    assert.equal(await pathExists(path.join(cwd, 'temp', ids.orphan)), false, 'orphan directory removed');
    // B2.1: a completed session's clone is no longer needed (results are in the database)
    assert.equal(await pathExists(path.join(cwd, 'temp', ids.completed)), false, 'a completed session\'s directory is removed');
    assert.equal(await pathExists(path.join(cwd, 'temp', ids.freshCloned, 'repo', 'marker.txt')), true, 'a session waiting for analysis keeps its directory');
    assert.equal(await pathExists(path.join(cwd, 'temp', 'keep-me-not-a-uuid', 'repo', 'marker.txt')), true, 'non-UUID names are never removed');
    assert.equal(await pathExists(path.join(cwd, ids.outsideTemp)), true, 'nothing outside temp/ is touched');
    assert.equal(await pathExists(path.join(cwd, 'temp', ids.symlinked)), true, 'a UUID-named symlink is left alone');
    assert.equal(await pathExists(path.join(cwd, 'symlink-target', 'precious.txt')), true, 'and so is its target');
  });
});

describe('5. database outage (through a TCP proxy)', { skip: DB_SKIP }, () => {
  let db;
  let proxy;
  let server;
  let completed;
  let cloned;

  before(async () => {
    db = await newDatabase();
    const client = await prismaFor(db);
    completed = await seed(client.prisma);
    cloned = await seed(client.prisma, { status: 'cloned' });
    await client.close();
    proxy = await startTcpProxy({ host: db.host, port: db.port });
    server = await launch(db, { url: db.urlVia(proxy.host, proxy.port) });
  });
  after(async () => { await proxy?.close(); });

  test('status, files and analyze answer 503 during the outage and recover without a restart', { timeout: 60000 }, async () => {
    assert.equal((await get(server, `/api/status/${completed}`, fakes.tokens.A)).status, 200);

    proxy.cut();
    const unavailable = JSON.stringify({ error: 'Session service unavailable', code: 'SESSION_STORE_UNAVAILABLE' });
    for (const route of [`/api/status/${completed}`, `/api/files/${completed}`, `/api/files/${completed}/dockerfile`]) {
      const response = await get(server, route, fakes.tokens.A);
      assert.equal(response.status, 503, route);
      assert.equal(response.text, unavailable);
    }
    const analyze = await postJson(server.baseUrl, '/api/analyze', { sessionId: cloned }, authHeaders(fakes.tokens.A));
    assert.equal(analyze.status, 503);
    assert.equal(analyze.text, unavailable);
    // A non-owner is not told "not found" either while the store cannot answer
    assert.equal((await get(server, `/api/status/${completed}`, fakes.tokens.B)).status, 503);

    proxy.restore();
    let recovered = null;
    for (let i = 0; i < 20 && recovered?.status !== 200; i++) {
      recovered = await get(server, `/api/status/${completed}`, fakes.tokens.A);
      if (recovered.status !== 200) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(recovered.status, 200);
    assert.equal(JSON.parse(recovered.text).status, 'completed');
    assert.equal((await get(server, `/api/files/${completed}`, fakes.tokens.A)).status, 200);
  });
});

describe('6. startup refuses an invalid or unusable session store', { skip: DB_SKIP }, () => {
  const marker = `MARKERPW${crypto.randomBytes(6).toString('hex')}`;
  let proxy;
  let unmigrated;

  before(async () => {
    proxy = await startTcpProxy({ host: '127.0.0.1', port: 1 });
    proxy.cut();
    unmigrated = await newDatabase({ migrate: false });
  });
  after(async () => { await proxy?.close(); });

  const expectExit = async (envOverrides, message, secrets = [marker]) => {
    const result = await runServerExpectingExit({ envOverrides, timeoutMs: 10000 });
    assert.equal(result.timedOut, false, 'exits within 10 s');
    assert.notEqual(result.code, 0);
    assert.ok(result.stderr.includes(message), `stderr should include "${message}": ${result.stderr}`);
    for (const secret of secrets) {
      assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), 'no password in the output');
    }
    assert.ok(!CREDENTIALED_URL.test(`${result.stdout}${result.stderr}`), 'no connection string in the output');
  };

  test('SESSION_STORE missing', () => expectExit({ SESSION_STORE: undefined }, 'SESSION_STORE is not set'));
  test('SESSION_STORE invalid', () => expectExit({ SESSION_STORE: `redis${marker}` }, 'SESSION_STORE must be "memory" or "database"'));
  test('database without DATABASE_URL', () => expectExit({ SESSION_STORE: 'database', DATABASE_URL: undefined }, 'DATABASE_URL is not set'));
  test('a mysql:// DATABASE_URL', () => expectExit(
    { SESSION_STORE: 'database', DATABASE_URL: `mysql://user:${marker}@127.0.0.1:3306/app` },
    'DATABASE_URL must start with postgres:// or postgresql://'
  ));
  test('an unreachable database', () => expectExit(
    { SESSION_STORE: 'database', DATABASE_URL: `postgresql://user:${marker}@127.0.0.1:${proxy.port}/app` },
    'Database unreachable (DATABASE_URL)'
  ));
  test('a reachable database without migrations', () => expectExit(
    { SESSION_STORE: 'database', DATABASE_URL: unmigrated.url },
    'Database schema missing: run npm run db:deploy',
    [unmigrated.password, unmigrated.url]
  ));
});

test('SESSION_STORE=memory in production starts with a warning (no database needed)', async () => {
  // B1.4: production requires https CLIENT_URL and GITHUB_REDIRECT_URI
  const server = await startServer({ envOverrides: {
    SESSION_STORE: 'memory',
    NODE_ENV: 'production',
    CLIENT_URL: 'https://app.example.test',
    GITHUB_REDIRECT_URI: 'https://api.example.test/auth/github/callback'
  } });
  spawned.push(server);
  await waitForLog(server, 'SESSION_STORE=memory: analysis sessions and results are lost on every restart');
});

// Runs last: every server spawned in this file
test('7. no log contains a database password, connection string or credentialed database name', { skip: DB_SKIP }, async () => {
  for (const server of spawned) await server.stop();
  assert.ok(allCapturedLogs.length >= 3);
  const admin = new URL(TEST_DATABASE_URL);
  for (const { output } of allCapturedLogs) {
    const text = `${output.stdout}\n${output.stderr}`;
    for (const db of databases) {
      assert.ok(!text.includes(db.password), 'database password');
      assert.ok(!text.includes(db.url), 'connection string');
      assert.ok(!text.includes(`${db.owner}:`), 'credentialed user');
    }
    assert.ok(!text.includes(TEST_DATABASE_URL));
    assert.ok(!text.includes(`${admin.username}:${admin.password}@`));
    assert.ok(!CREDENTIALED_URL.test(text), 'no credentialed URL of any kind');
  }
});
