// One contract suite for the session store, run against the memory adapter always and
// against the database adapter when TEST_DATABASE_URL is set.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AI_CALL_RETENTION_MS,
  SESSION_TTL_MS,
  SessionStoreUnavailableError,
  createSessionStore,
  describeSessionStoreConfigProblem
} from '../utils/sessionStore.js';
import { toFilesResponse, toStatusResponse } from '../utils/sessionView.js';
import { DB_SKIP, createTestDatabase } from './db.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const FIELDS = {
  userId: USER_A,
  owner: 'octocat',
  repo: 'Hello-World',
  fullName: 'octocat/Hello-World',
  repoName: 'Hello-World',
  displayUrl: 'https://github.com/octocat/Hello-World'
};
const RESULT = {
  generatedFiles: { envExample: 'A=1\n', dockerfile: 'FROM node:22\n', githubActions: 'name: ci\n' },
  techStack: { primary: 'node', frameworks: ['express'] },
  codebaseAnalysis: { entryPoints: ['index.js'] },
  verificationResults: 'looks fine',
  messages: [{ agent: 'planner', message: 'ok' }],
  errors: []
};

test('SESSION_STORE is required and must be memory or database', () => {
  assert.match(describeSessionStoreConfigProblem({}), /SESSION_STORE is not set/);
  assert.match(describeSessionStoreConfigProblem({ SESSION_STORE: 'redis' }), /SESSION_STORE must be/);
  assert.ok(!describeSessionStoreConfigProblem({ SESSION_STORE: 'redis' }).includes('redis'));
  assert.equal(describeSessionStoreConfigProblem({ SESSION_STORE: 'memory' }), null);
  assert.equal(describeSessionStoreConfigProblem({ SESSION_STORE: 'database' }), null);
  assert.throws(() => createSessionStore({ kind: 'redis' }), TypeError);
});

function contractSuite(label, setup, { skip = false } = {}) {
  describe(`session store contract: ${label}`, { skip }, () => {
    let ctx;
    const clock = { t: Date.UTC(2026, 10, 4, 12, 0, 0) };
    before(async () => { ctx = await setup(() => clock.t); });
    after(async () => { await ctx?.cleanup(); });

    const store = () => ctx.store;

    test('create -> get round trip has the shape the server built before', async () => {
      const created = await store().create(FIELDS);
      assert.ok(created.id && /^[0-9a-f-]{36}$/.test(created.id));
      const loaded = await store().get(created.id);
      assert.deepEqual(loaded, created);
      assert.deepEqual(
        Object.keys(loaded).sort(),
        ['createdAt', 'displayUrl', 'expiresAt', 'fullName', 'id', 'owner', 'repo', 'repoName', 'status', 'updatedAt', 'userId']
      );
      assert.equal(loaded.status, 'cloning');
      assert.ok(loaded.createdAt instanceof Date);
      assert.equal(loaded.createdAt.getTime(), clock.t);
      assert.equal(loaded.expiresAt.getTime() - loaded.createdAt.getTime(), SESSION_TTL_MS);
      // The status body omits fields that are not set yet, exactly as before
      assert.equal(JSON.stringify(toStatusResponse(created.id, loaded)), JSON.stringify({
        sessionId: created.id,
        status: 'cloning',
        repoUrl: FIELDS.displayUrl,
        repoName: 'Hello-World',
        createdAt: new Date(clock.t).toISOString()
      }));
    });

    test('create accepts only the allow-listed fields', async () => {
      const created = await store().create({ ...FIELDS, status: 'completed', clonePath: '/abs/path', id: crypto.randomUUID() });
      assert.equal(created.status, 'cloning');
      assert.equal('clonePath' in created, false);
      await assert.rejects(store().create({ ...FIELDS, userId: 'not-a-uuid' }), TypeError);
      await assert.rejects(store().create({ ...FIELDS, owner: '' }), TypeError);
    });

    test('getOwned: owner gets it, another user and an unknown id get null', async () => {
      const { id } = await store().create(FIELDS);
      assert.equal((await store().getOwned(id, USER_A)).id, id);
      assert.equal(await store().getOwned(id, USER_B), null);
      assert.equal(await store().getOwned(crypto.randomUUID(), USER_A), null);
    });

    test('invalid ids are "not found" and issue no query', async () => {
      const { id } = await store().create(FIELDS);
      const before = ctx.queryCount();
      for (const bad of ['x', '../x', id.toUpperCase(), '11111111-1111-1111-8111-111111111111', '', null, undefined, 42]) {
        assert.equal(await store().get(bad), null);
        assert.equal(await store().getOwned(bad, USER_A), null);
        assert.equal(await store().update(bad, { status: 'failed' }), false);
        assert.equal(await store().setLastProgress(bad, { step: 'x' }), false);
        assert.equal(await store().saveResult(bad, RESULT), false);
      }
      assert.equal(await store().getOwned(id, 'NOT-A-UUID'), null);
      assert.equal(ctx.queryCount(), before, 'no database query for an invalid id');
    });

    test('update accepts only allow-listed fields; userId and id throw', async () => {
      const { id } = await store().create(FIELDS);
      await assert.rejects(store().update(id, { userId: USER_B }), TypeError);
      await assert.rejects(store().update(id, { id: crypto.randomUUID() }), TypeError);
      await assert.rejects(store().update(id, { displayUrl: 'https://evil.example' }), TypeError);
      await assert.rejects(store().update(id, { status: 'hacked' }), TypeError);
      assert.equal((await store().get(id)).userId, USER_A);
      assert.equal(await store().update(crypto.randomUUID(), { status: 'failed' }), false, 'unknown id');
    });

    test('lifecycle: cloned -> analyzing -> saveResult; files in a stable order; same files body', async () => {
      const { id } = await store().create(FIELDS);
      const clonedAt = new Date(clock.t + 1000);
      const startedAt = new Date(clock.t + 2000);
      assert.equal(await store().update(id, { status: 'cloned', clonedAt }), true);
      assert.equal(await store().update(id, { status: 'analyzing', analysisStartedAt: startedAt }), true);
      assert.equal(await store().setLastProgress(id, { sessionId: id, step: 'half', progress: 50 }), true);
      clock.t += 5000;
      assert.equal(await store().saveResult(id, RESULT), true);

      const session = await store().getOwned(id, USER_A);
      assert.equal(session.status, 'completed');
      assert.equal(session.completedAt.getTime(), clock.t);
      assert.deepEqual(session.lastProgress, { sessionId: id, step: 'half', progress: 50 });
      assert.deepEqual(Object.keys(session.analysisResult.generatedFiles), ['dockerfile', 'githubActions', 'envExample']);
      assert.equal(JSON.stringify(toFilesResponse(session)), JSON.stringify({
        files: { dockerfile: 'FROM node:22\n', githubActions: 'name: ci\n', envExample: 'A=1\n' },
        techStack: RESULT.techStack,
        codebaseAnalysis: RESULT.codebaseAnalysis,
        verificationResults: 'looks fine',
        // SERVER-FIX D.1: stored messages and errors are returned, through the sanitizers
        messages: RESULT.messages,
        errors: [],
        metadata: { repoUrl: FIELDS.displayUrl, repoName: 'Hello-World', completedAt: new Date(clock.t).toISOString() }
      }));
      assert.equal(JSON.stringify(toStatusResponse(id, session)), JSON.stringify({
        sessionId: id,
        status: 'completed',
        repoUrl: FIELDS.displayUrl,
        repoName: 'Hello-World',
        createdAt: new Date(clock.t - 5000).toISOString(),
        clonedAt: clonedAt.toISOString(),
        analysisStartedAt: startedAt.toISOString(),
        completedAt: new Date(clock.t).toISOString()
      }));
    });

    test('a failed analyzer (null tech stack, no verification) round-trips, with its error', async () => {
      const { id } = await store().create(FIELDS);
      await store().saveResult(id, { generatedFiles: {}, techStack: null, codebaseAnalysis: null, messages: [], errors: ['Analyzer Agent Error: Internal error'] });
      const session = await store().get(id);
      assert.equal(JSON.stringify(toFilesResponse(session)), JSON.stringify({
        files: {},
        techStack: null,
        codebaseAnalysis: null,
        messages: [],
        errors: ['Analyzer Agent Error: Internal error'],
        metadata: { repoUrl: FIELDS.displayUrl, repoName: 'Hello-World', completedAt: session.completedAt.toISOString() }
      }));
    });

    test('saveResult is atomic: one oversized file leaves the session uncompleted with no files', async () => {
      const { id } = await store().create(FIELDS);
      await store().update(id, { status: 'analyzing', analysisStartedAt: new Date(clock.t) });
      const oversized = {
        ...RESULT,
        generatedFiles: { dockerfile: 'FROM node:22\n', githubActions: 'x'.repeat(200001), envExample: 'A=1\n' }
      };
      await assert.rejects(store().saveResult(id, oversized), SessionStoreUnavailableError);
      const session = await store().get(id);
      assert.equal(session.status, 'analyzing');
      assert.equal(session.analysisResult, undefined);
      assert.equal(session.completedAt, undefined);
      assert.equal(await ctx.fileCount(id), 0, 'no partial files');
    });

    test('markInFlightFailed fails cloning and analyzing sessions only', async () => {
      const ids = {};
      for (const status of ['cloning', 'cloned', 'analyzing', 'completed', 'failed']) {
        ids[status] = (await store().create(FIELDS)).id;
        if (status === 'completed') await store().saveResult(ids[status], RESULT);
        else if (status !== 'cloning') await store().update(ids[status], { status });
      }
      const before = await ctx.inFlightCount();
      const count = await store().markInFlightFailed('restarted');
      assert.equal(count, before);
      assert.ok(count >= 2);
      for (const [status, id] of Object.entries(ids)) {
        const session = await store().get(id);
        if (status === 'cloning' || status === 'analyzing') {
          assert.equal(session.status, 'failed');
          assert.equal(session.error, 'restarted');
        } else {
          assert.equal(session.status, status);
        }
      }
      assert.equal(await store().markInFlightFailed('again'), 0);
    });

    test('deleteExpired removes expired sessions with their files, and ai_calls older than 30 days', async () => {
      const start = clock.t;
      const old = await store().create(FIELDS);
      await store().saveResult(old.id, RESULT);
      await store().recordAiCall({ task: 'planner', provider: 'gemini', model: 'm', attempt: 1, outcome: 'ok', httpStatus: 200, latencyMs: 5, sessionId: old.id, userId: USER_A });

      clock.t = start + SESSION_TTL_MS - 1;
      const fresh = await store().create(FIELDS);
      const early = await store().deleteExpired(new Date(start + SESSION_TTL_MS - 1));
      assert.ok(!early.includes(old.id) && !early.includes(fresh.id), 'nothing is deleted before its expiry');

      const deleted = await store().deleteExpired(new Date(start + SESSION_TTL_MS));
      assert.ok(deleted.includes(old.id));
      assert.ok(!deleted.includes(fresh.id));
      assert.equal(await store().get(old.id), null);
      assert.ok(await store().get(fresh.id));
      assert.equal(await ctx.fileCount(old.id), 0, 'files cascade');
      const calls = await ctx.aiCalls();
      const call = calls.find((c) => c.task === 'planner' && c.userId === USER_A && c.latencyMs === 5);
      assert.ok(call, 'the call record survives its session');
      assert.equal(call.sessionId, null, 'session_id is set to null');

      clock.t = start + AI_CALL_RETENTION_MS + 1;
      await store().recordAiCall({ task: 'verifier', provider: 'groq', model: 'm', attempt: 1, outcome: 'ok', httpStatus: 200, latencyMs: 9 });
      await store().deleteExpired(new Date(clock.t));
      const remaining = await ctx.aiCalls();
      assert.ok(!remaining.some((c) => c.latencyMs === 5), 'calls older than 30 days are purged');
      assert.ok(remaining.some((c) => c.latencyMs === 9), 'recent calls stay');
    });

    test('recordAiCall stores metadata only', async () => {
      const { id } = await store().create(FIELDS);
      await store().recordAiCall({
        at: new Date().toISOString(), task: 'generator', provider: 'openrouter', model: 'some/model', attempt: 2,
        outcome: 'server_error', httpStatus: 503, latencyMs: 812.7, inputTokens: null, outputTokens: 33,
        sessionId: id, userId: USER_B, prompt: 'PROMPT_MARKER', text: 'RESPONSE_MARKER'
      });
      await store().recordAiCall({ task: 'planner', provider: 'gemini', model: 'm', attempt: 1, outcome: 'ok', httpStatus: null, latencyMs: 1, sessionId: 'not-a-uuid', userId: 'nope' });
      const calls = await ctx.aiCalls();
      const call = calls.find((c) => c.outcome === 'server_error' && c.sessionId === id);
      assert.deepEqual(
        { task: call.task, provider: call.provider, model: call.model, attempt: call.attempt, outcome: call.outcome, httpStatus: call.httpStatus, latencyMs: call.latencyMs, inputTokens: call.inputTokens, outputTokens: call.outputTokens, userId: call.userId },
        { task: 'generator', provider: 'openrouter', model: 'some/model', attempt: 2, outcome: 'server_error', httpStatus: 503, latencyMs: 813, inputTokens: null, outputTokens: 33, userId: USER_B }
      );
      assert.ok(!JSON.stringify(calls).includes('MARKER'));
      const invalidIds = calls.find((c) => c.task === 'planner' && c.latencyMs === 1);
      assert.equal(invalidIds.sessionId, null);
      assert.equal(invalidIds.userId, null);
    });
  });
}

contractSuite('memory', async (now) => {
  const store = createSessionStore({ kind: 'memory', now });
  return {
    store,
    queryCount: () => 0,
    fileCount: async (id) => Object.keys((await store.get(id))?.analysisResult?.generatedFiles ?? {}).length,
    inFlightCount: async () => store._sessionsForTest().filter((s) => ['cloning', 'analyzing'].includes(s.status)).length,
    aiCalls: async () => store._aiCallsForTest(),
    cleanup: async () => {}
  };
});

contractSuite('database', async (now) => {
  const db = await createTestDatabase();
  const { createPrismaClient, Prisma } = await import('../db/client.js');
  const client = createPrismaClient({ DATABASE_URL: db.url });
  let queries = 0;
  // Counts every model query and transaction the store issues
  const counted = client.prisma.$extends({
    query: { $allOperations({ args, query }) { queries++; return query(args); } }
  });
  const store = createSessionStore({ kind: 'database', prisma: counted, jsonNull: Prisma.JsonNull, now });
  return {
    store,
    queryCount: () => queries,
    fileCount: (id) => client.prisma.generatedFile.count({ where: { sessionId: id } }),
    inFlightCount: () => client.prisma.analysisSession.count({ where: { status: { in: ['cloning', 'analyzing'] } } }),
    aiCalls: async () => (await client.prisma.aiCall.findMany()).map((row) => ({ ...row, id: String(row.id) })),
    cleanup: async () => {
      await client.close();
      await db.drop();
    }
  };
}, { skip: DB_SKIP });
