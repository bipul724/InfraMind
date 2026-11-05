// End-to-end: spawned server + fake Supabase + fake LLM + real clone of a public repo.
// Runs only with RUN_NETWORK_TESTS=1 because the clone needs github.com. The database
// variant (B2.0b) also needs TEST_DATABASE_URL (a throwaway local Postgres).
// B2.1: the same flow also runs offline, with the fake `git` (test/fakeGit.js) in place
// of the github.com clone, against both stores.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connectClient } from 'socket.io-client';
import { authHeaders, closeFakes, getFakes, postJson, startServer } from './helpers.js';
import { USER_A } from './fakeSupabase.js';
import { DB_SKIP, createTestDatabase } from './db.js';
import { createFakeGit } from './fakeGit.js';

const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === '1';

// The same two-user flow against either session store; returns the analysed session id
function twoUserFlow(label, { skip, envOverrides = async () => ({}), afterFlow = async () => {} }) {
describe(label, { skip }, () => {
  let fakes;
  let server;
  const sockets = [];

  const connect = (token) => new Promise((resolve, reject) => {
    const client = connectClient(server.baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(client);
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });

  before(async () => {
    fakes = await getFakes();
    fakes.llm.reset();
    fakes.llm.setDelay(300);
    server = await startServer({ envOverrides: await envOverrides() });
  });

  after(async () => {
    for (const client of sockets) client.close();
    await server?.stop();
    await closeFakes();
  });

  test('only the owner sees progress and results', { timeout: 120000 }, async () => {
    const authA = authHeaders(fakes.tokens.A);
    const authB = authHeaders(fakes.tokens.B);
    const socketA = await connect(fakes.tokens.A);
    const socketB = await connect(fakes.tokens.B);
    const eventsA = [];
    const eventsB = [];
    socketA.on('progress', (payload) => eventsA.push(payload));
    socketB.on('progress', (payload) => eventsB.push(payload));

    // 1. A clones and subscribes
    const clone = await postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }, authA);
    assert.equal(clone.status, 200, clone.text);
    const { sessionId } = clone.json;
    assert.deepEqual(await socketA.timeout(3000).emitWithAck('subscribe', { sessionId }), { ok: true });

    // B tries to subscribe to A's session and is refused
    assert.deepEqual(await socketB.timeout(3000).emitWithAck('subscribe', { sessionId }), { ok: false, error: 'Session not found' });

    // 2. A starts the analysis against the fake LLM; B2.1: it runs in the background
    const analyze = await postJson(server.baseUrl, '/api/analyze', { sessionId }, authA);
    assert.equal(analyze.status, 202, analyze.text);
    assert.deepEqual(analyze.json, { success: true, sessionId, status: 'analyzing' });

    const deadline = Date.now() + 20000;
    while (!eventsA.some((e) => e.status === 'completed') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(eventsA.length >= 2, `A should receive progress, got ${eventsA.length}`);
    assert.equal(eventsA.at(-1).status, 'completed');
    assert.ok(eventsA.every((e) => e.sessionId === sessionId));

    const files = await fetch(`${server.baseUrl}/api/files/${sessionId}`, { headers: authA });
    assert.equal(files.status, 200);
    const filesJson = await files.json();
    assert.ok(filesJson.files && typeof filesJson.files.dockerfile === 'string');

    // 3. B received nothing at all
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(eventsB.length, 0, 'user B must not receive any event for A\'s session');

    // 4. B cannot read A's session
    assert.equal((await fetch(`${server.baseUrl}/api/status/${sessionId}`, { headers: authB })).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/api/files/${sessionId}`, { headers: authB })).status, 404);

    // 5. Nothing sensitive reached the LLM (every provider of the multi-provider fake)
    assert.ok(fakes.llm.requests.length > 0, 'the fake LLM should have been called');
    assert.deepEqual([...new Set(fakes.llm.requests.map((r) => r.provider))], ['gemini'], 'the first provider in the chain served every call');
    for (const body of fakes.llm.requestBodies) {
      assert.ok(!body.includes('access_token'));
      assert.ok(!body.includes(fakes.tokens.A));
      assert.ok(!body.includes(fakes.tokens.B));
      assert.ok(!body.includes(server.cwd), 'no absolute server path');
      assert.ok(!body.includes('@github.com'));
    }
    assert.ok(fakes.llm.requestBodies[0].includes('octocat/Hello-World'));
    // Session and user ids go only to the call records, never to a provider
    for (const body of fakes.llm.requestBodies) {
      assert.ok(!body.includes(sessionId));
      assert.ok(!body.includes(USER_A.id));
    }

    await afterFlow(sessionId);
  });
});
}

twoUserFlow('two users, one analysis', { skip: !RUN_NETWORK && 'set RUN_NETWORK_TESTS=1' });

// B2.0b: the same flow persisted in Postgres
let database;
const checkDatabaseRows = async (sessionId) => {
  const { createPrismaClient } = await import('../db/client.js');
  const client = createPrismaClient({ DATABASE_URL: database.url });
  try {
    const session = await client.prisma.analysisSession.findUnique({ where: { id: sessionId }, include: { files: true } });
    assert.equal(session.status, 'completed');
    assert.equal(session.userId, USER_A.id);
    assert.deepEqual(session.files.map((f) => f.kind).sort(), ['dockerfile', 'envExample', 'githubActions']);

    // Call records are persisted shortly after each attempt
    let calls = [];
    for (let i = 0; i < 40; i++) {
      calls = await client.prisma.aiCall.findMany({ where: { sessionId } });
      if (['planner', 'generator', 'verifier'].every((task) => calls.some((c) => c.task === task && c.outcome === 'ok'))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const task of ['planner', 'generator', 'verifier']) {
      assert.ok(calls.some((c) => c.task === task && c.outcome === 'ok' && c.userId === USER_A.id), `an ok ${task} call record`);
    }
    assert.equal(calls.filter((c) => c.task === 'generator').length, 3);

    // No content leaked into the records: no text value longer than 100 characters
    const all = await client.prisma.aiCall.findMany();
    for (const row of all) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') assert.ok(value.length <= 100, 'a long text value in ai_calls');
      }
    }
  } finally {
    await client.close();
    await database.drop();
  }
};
twoUserFlow('two users, one analysis (SESSION_STORE=database)', {
  skip: (!RUN_NETWORK && 'set RUN_NETWORK_TESTS=1') || DB_SKIP,
  envOverrides: async () => {
    database = await createTestDatabase();
    return { SESSION_STORE: 'database', DATABASE_URL: database.url };
  },
  afterFlow: checkDatabaseRows
});

// B2.1: offline, with the fake git
const offlineGit = async () => ({ PATH: (await createFakeGit()).pathEnv });
twoUserFlow('two users, one analysis (offline: fake git)', { skip: false, envOverrides: offlineGit });
twoUserFlow('two users, one analysis (offline: fake git, SESSION_STORE=database)', {
  skip: DB_SKIP,
  envOverrides: async () => {
    database = await createTestDatabase();
    return { ...(await offlineGit()), SESSION_STORE: 'database', DATABASE_URL: database.url };
  },
  afterFlow: checkDatabaseRows
});
