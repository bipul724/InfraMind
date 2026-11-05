// B2.1: background analysis. POST /api/analyze answers 202 at once; one run per session
// (atomic claim); capacity and ANALYSIS_BUSY; one progress event per agent; late
// subscribers; failures in the background; clone directory lifetime; shutdown.
// Spawned servers, offline: fake Supabase, fake LLM and a fake `git` on the server's
// PATH (test/fakeGit.js). Every suite runs with the memory store and, when
// TEST_DATABASE_URL is set, with the database store.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { io as connectClient } from 'socket.io-client';
import { authHeaders, closeFakes, getFakes, makeTempDir, pathExists, postJson, randomAlphanumeric, startServer } from './helpers.js';
import { USER_A } from './fakeSupabase.js';
import { DB_SKIP, adminQuery, createTestDatabase } from './db.js';
import { FAKE_FILES, FAKE_LLM_CONTENT, generatorKindOf } from './fakeLlm.js';
import { FAULT_SECRET_MARKER } from './faultInjection.js';
import { createFakeGit } from './fakeGit.js';

const RESTART_MESSAGE = 'The server restarted before this analysis finished. Please run it again.';
const STALE_MESSAGE = 'The repository was cloned but analysis was not started within 1 hour. Please start again.';
const BUSY_BODY = { error: 'The analysis service is busy. Please try again shortly.', code: 'ANALYSIS_BUSY' };
const NOT_READY_BODY = { error: 'Repository not ready for analysis' };
// What the pipeline produced before B2.1 for this fixture and the fake LLM, less the
// planner's message (B2.6 removed the planner)
const EXPECTED_MESSAGES = [
  ['analyzer', 'Detected tech stack: node'],
  ['generator', 'Generated 3 of 3 files'],
  ['verifier', 'Review complete: see the review text']
];
// The first AI call of a run (B2.6: the Dockerfile generator call; it was the planner's)
const isFirstCall = (request) => generatorKindOf(request.body) === 'dockerfile';
const isOldPlannerCall = (request) => request.body?.messages?.some((m) => m.role === 'system' && m.content.startsWith('You are a DevOps Planning Agent'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

let fakes;
let fakeGit;
const databases = [];
before(async () => {
  fakes = await getFakes();
  fakeGit = await createFakeGit();
});
after(async () => {
  for (const db of databases) await db.drop().catch(() => {});
  await closeFakes();
});

const STORES = [
  { label: 'memory', skip: false, env: async () => ({ SESSION_STORE: 'memory' }) },
  {
    label: 'database',
    skip: DB_SKIP,
    env: async () => {
      const db = await createTestDatabase();
      databases.push(db);
      return { SESSION_STORE: 'database', DATABASE_URL: db.url, __db: db };
    }
  }
];

// A server for one store; extra env on top. Returns { server, db, metricsToken }
async function launch(store, extra = {}, { cwd } = {}) {
  const { __db: db, ...storeEnv } = await store.env();
  const metricsToken = randomAlphanumeric(48);
  const server = await startServer({
    cwd,
    envOverrides: {
      ...storeEnv,
      PATH: fakeGit.pathEnv,
      METRICS_TOKEN: metricsToken,
      // These tests poll and call far more often than a person would
      RATE_LIMIT_ANALYSIS_MAX: '1000',
      RATE_LIMIT_CLONE_MAX: '1000',
      RATE_LIMIT_USER_MAX: '100000',
      RATE_LIMIT_PREAUTH_MAX: '100000',
      AI_TIMEOUT_MS: '5000',
      AI_CALL_BUDGET_MS: '20000',
      ...extra
    }
  });
  return { server, db, metricsToken };
}

const tokenA = () => fakes.tokens.A;
const tokenB = () => fakes.tokens.B;

async function clone(server, token = tokenA()) {
  const response = await postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }, authHeaders(token));
  assert.equal(response.status, 200, response.text);
  return response.json.sessionId;
}

async function analyze(server, sessionId, token = tokenA()) {
  const started = Date.now();
  const response = await fetch(`${server.baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  return { status: response.status, headers: response.headers, json: await response.json().catch(() => null), elapsed: Date.now() - started };
}

const statusOf = async (server, sessionId, token = tokenA()) =>
  (await fetch(`${server.baseUrl}/api/status/${sessionId}`, { headers: authHeaders(token) })).json();
const waitForStatus = (server, sessionId, status, timeoutMs = 30000) =>
  waitFor(async () => ((await statusOf(server, sessionId)).status === status ? true : null), timeoutMs, `status ${status}`);
const metricsOf = async ({ server, metricsToken }) =>
  (await fetch(`${server.baseUrl}/api/metrics`, { headers: { 'X-Metrics-Token': metricsToken } })).json();
const cloneDir = (server, sessionId) => path.join(server.cwd, 'temp', sessionId);

// Waits until /api/metrics analysisJobs is { running: 0, queued: 0, reserved: 0 }
async function waitForIdle(ctx) {
  await waitFor(async () => {
    const { analysisJobs } = await metricsOf(ctx);
    return analysisJobs.running === 0 && analysisJobs.queued === 0 && analysisJobs.reserved === 0;
  }, 5000, 'no running or queued job');
  assert.deepEqual((await metricsOf(ctx)).analysisJobs, { running: 0, queued: 0, reserved: 0 });
}

// Every slot is usable: `capacity` freshly cloned sessions, analyzed one after another,
// all get 202 (one running, the rest queued). A leaked slot makes the last one 503.
async function assertAllSlotsFree(ctx, capacity) {
  const { server } = ctx;
  const sessionIds = [];
  for (let i = 0; i < capacity; i++) sessionIds.push(await clone(server));
  for (const [i, sessionId] of sessionIds.entries()) {
    const response = await analyze(server, sessionId);
    assert.equal(response.status, 202, `slot ${i + 1} of ${capacity} was leaked: ${JSON.stringify(response.json)}`);
  }
  for (const sessionId of sessionIds) await waitForStatus(server, sessionId, 'completed');
  await waitForIdle(ctx);
}

// A socket subscribed to a session; resolves once the subscription is acknowledged
async function subscribe(server, sessionId, token = tokenA()) {
  const socket = connectClient(server.baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  const events = [];
  socket.on('progress', (payload) => events.push(payload));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const ack = await socket.timeout(3000).emitWithAck('subscribe', { sessionId });
  return { socket, events, ack };
}

for (const store of STORES) {
  describe(`B2.1 background analysis (${store.label} store)`, { skip: store.skip }, () => {
    let ctx;
    before(async () => { ctx = await launch(store); });
    after(async () => { await ctx?.server.stop(); });

    test('202 at once; per-agent events in order; late subscribers get the newest state; same results as before', { timeout: 90000 }, async () => {
      const { server } = ctx;
      fakes.llm.reset();
      fakes.llm.setDelay(2000); // every AI call takes 2 s
      const sessionId = await clone(server);
      assert.equal(await pathExists(path.join(cloneDir(server, sessionId), 'repo', 'package.json')), true, 'the fake clone');
      const early = await subscribe(server, sessionId);
      assert.deepEqual(early.ack, { ok: true });

      // E.1: the request returns before the first AI call could have finished
      const response = await analyze(server, sessionId);
      assert.equal(response.status, 202, JSON.stringify(response.json));
      assert.deepEqual(response.json, { success: true, sessionId, status: 'analyzing' });
      assert.ok(response.elapsed < 500, `answered in ${response.elapsed} ms`);
      assert.equal((await statusOf(server, sessionId)).status, 'analyzing');

      // E.5: subscribe right after the 2nd agent's event: the first event carries 2 agents
      await waitFor(() => early.events.some((e) => e.messages?.length === 2), 20000, 'the 2nd agent');
      const late = await subscribe(server, sessionId);
      await waitFor(() => late.events.length >= 1, 3000, 'the late snapshot');
      assert.equal(late.events[0].status, 'analyzing');
      assert.deepEqual(late.events[0].messages.map((m) => m.agent), ['analyzer', 'generator']);
      late.socket.close();

      await waitForStatus(server, sessionId, 'completed', 30000);
      await waitFor(() => early.events.some((e) => e.status === 'completed'), 3000, 'the completed event');
      early.socket.close();

      // E.4: per-agent events with 1, 2, then 3 agents' messages, then completed
      const withMessages = early.events.filter((e) => Array.isArray(e.messages));
      assert.deepEqual(withMessages.map((e) => [e.status, e.messages.length]), [
        ['analyzing', 1], ['analyzing', 2], ['analyzing', 3], ['completed', 3]
      ]);
      assert.deepEqual(withMessages.slice(0, 3).map((e) => e.progress), [50, 80, 95]);
      const progress = early.events.map((e) => e.progress);
      assert.deepEqual(progress, [...progress].sort((a, b) => a - b), `never backwards: ${progress}`);
      assert.equal(early.events.at(-1).status, 'completed');
      assert.ok(early.events.some((e) => e.step === 'Starting AI agent analysis...'));

      // Same files, messages and review as before this batch
      const files = await (await fetch(`${server.baseUrl}/api/files/${sessionId}`, { headers: authHeaders(tokenA()) })).json();
      assert.deepEqual(files.files, FAKE_FILES);
      assert.deepEqual(files.messages.map((m) => [m.agent, m.message]), EXPECTED_MESSAGES);
      assert.deepEqual(files.errors, []);
      assert.equal(files.verificationResults, FAKE_LLM_CONTENT);
      assert.deepEqual(files.techStack.frameworks, ['express']);
      const completed = early.events.at(-1);
      assert.deepEqual(completed.messages, files.messages);
      assert.deepEqual(completed.generatedFiles, ['dockerfile', 'githubActions', 'envExample']);

      // E.7: the clone directory is gone once the job is done
      assert.equal(await pathExists(cloneDir(server, sessionId)), false);

      // E.5: subscribing after completion gives the completed state
      const after = await subscribe(server, sessionId);
      await waitFor(() => after.events.length >= 1, 3000, 'the completed snapshot');
      assert.equal(after.events[0].status, 'completed');
      assert.equal(after.events.length, 1);
      after.socket.close();

      // A non-owner gets no event and the same 404 as before
      const foreign = await subscribe(server, sessionId, tokenB());
      assert.deepEqual(foreign.ack, { ok: false, error: 'Session not found' });
      await sleep(200);
      assert.equal(foreign.events.length, 0);
      foreign.socket.close();
      assert.equal((await analyze(server, sessionId, tokenB())).status, 404);
    });

    test('E.2: two concurrent requests for one session: one 202, one 400; the pipeline runs once', { timeout: 60000 }, async () => {
      const { server } = ctx;
      fakes.llm.reset();
      fakes.llm.setDelay(100);
      const sessionId = await clone(server);
      const results = await Promise.all([analyze(server, sessionId), analyze(server, sessionId)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [202, 400], JSON.stringify(results.map((r) => r.json)));
      assert.deepEqual(results.find((r) => r.status === 400).json, NOT_READY_BODY);
      await waitForStatus(server, sessionId, 'completed');
      await sleep(300);
      assert.equal(fakes.llm.requests.filter(isFirstCall).length, 1, 'one Dockerfile generator call: one pipeline run');
      assert.equal(fakes.llm.requests.length, 4, '3 generator calls, verifier');
      assert.equal(fakes.llm.requests.filter(isOldPlannerCall).length, 0, 'no planner call (B2.6)');
      // Once claimed, the session can never be claimed again
      assert.equal((await analyze(server, sessionId)).status, 400);
    });

    test('E.2 (many): eight concurrent requests for one session still give exactly one 202', { timeout: 60000 }, async () => {
      const { server } = ctx;
      fakes.llm.reset();
      const sessionId = await clone(server);
      const results = await Promise.all(Array.from({ length: 8 }, () => analyze(server, sessionId)));
      assert.equal(results.filter((r) => r.status === 202).length, 1, JSON.stringify(results.map((r) => r.status)));
      assert.equal(results.filter((r) => r.status === 400).length, 7);
      await waitForStatus(server, sessionId, 'completed');
      await sleep(300);
      assert.equal(fakes.llm.requests.filter(isFirstCall).length, 1);
    });
  });

  describe(`B2.1 capacity: ANALYSIS_CONCURRENCY=1, ANALYSIS_QUEUE_MAX=1 (${store.label} store)`, { skip: store.skip }, () => {
    let ctx;
    before(async () => { ctx = await launch(store, { ANALYSIS_CONCURRENCY: '1', ANALYSIS_QUEUE_MAX: '1' }); });
    after(async () => { await ctx?.server.stop(); });

    test('one running, one queued, the third is 503 ANALYSIS_BUSY and stays cloned; a retry later is accepted', { timeout: 90000 }, async () => {
      const { server } = ctx;
      assert.ok(server.logs().includes('🧵 Analysis jobs: 1 at once, 1 queued at most'));
      fakes.llm.reset();
      fakes.llm.setDelay(400);
      const [s1, s2, s3] = [await clone(server), await clone(server), await clone(server)];
      const watcher = await subscribe(server, s2);

      assert.equal((await analyze(server, s1)).status, 202);
      assert.equal((await analyze(server, s2)).status, 202);
      const busy = await analyze(server, s3);
      assert.equal(busy.status, 503);
      assert.deepEqual(busy.json, BUSY_BODY);
      assert.equal(busy.headers.get('retry-after'), '30');
      assert.equal((await statusOf(server, s3)).status, 'cloned', 'a busy answer leaves the session retryable');
      assert.equal(await pathExists(cloneDir(server, s3)), true, 'and keeps its clone');
      assert.deepEqual((await metricsOf(ctx)).analysisJobs, { running: 1, queued: 1, reserved: 0 });

      await waitFor(() => watcher.events.some((e) => e.step === 'Waiting for an analysis slot'), 3000, 'the waiting event');
      const waiting = watcher.events.find((e) => e.step === 'Waiting for an analysis slot');
      assert.deepEqual({ progress: waiting.progress, status: waiting.status }, { progress: 30, status: 'analyzing' });

      // After the first finishes, the same session (no new clone) is accepted
      await waitForStatus(server, s1, 'completed');
      const clonesBefore = (await fakeGit.clones()).length;
      const retry = await analyze(server, s3);
      assert.equal(retry.status, 202, JSON.stringify(retry.json));
      assert.equal((await fakeGit.clones()).length, clonesBefore, 'the retry did not clone again');
      await waitForStatus(server, s2, 'completed');
      await waitForStatus(server, s3, 'completed');
      assert.ok(watcher.events.findIndex((e) => e.step === 'Waiting for an analysis slot') < watcher.events.findIndex((e) => e.step === 'Starting AI agent analysis...'));
      watcher.socket.close();
      assert.deepEqual((await metricsOf(ctx)).analysisJobs, { running: 0, queued: 0, reserved: 0 });
    });
  });

  // A slot not released after a refused claim is lost until a restart; once all
  // ANALYSIS_CONCURRENCY + ANALYSIS_QUEUE_MAX slots are lost, every analysis is 503
  // ANALYSIS_BUSY. /api/metrics analysisJobs also reports `reserved`, the slots held by
  // requests still claiming their session, so a leaked slot shows there too.
  //
  // The lost claim needs room for two slots: with one slot and no queue the winner holds
  // the only slot, so a concurrent second request is refused by the capacity check (503)
  // before it can reach the claim. The database store's lookup yields to I/O, so both
  // requests pass the status check and the loser reaches the claim. The memory store's
  // lookup does not yield, so its second request is refused by the status check (400);
  // there the test checks the same outcome but cannot reach the lost-claim branch.
  describe(`B2.1 a lost claim frees its slot: ANALYSIS_CONCURRENCY=1, ANALYSIS_QUEUE_MAX=1 (${store.label} store)`, { skip: store.skip }, () => {
    let ctx;
    before(async () => { ctx = await launch(store, { ANALYSIS_CONCURRENCY: '1', ANALYSIS_QUEUE_MAX: '1' }); });
    after(async () => { await ctx?.server.stop(); });

    test('double clicks (two concurrent requests, three times): one 202 and one 400 each; afterwards both slots are free', { timeout: 90000 }, async () => {
      const { server } = ctx;
      assert.ok(server.logs().includes('🧵 Analysis jobs: 1 at once, 1 queued at most'));
      fakes.llm.reset();
      fakes.llm.setDelay(50);
      for (let round = 1; round <= 3; round++) {
        const sessionId = await clone(server);
        const results = await Promise.all([analyze(server, sessionId), analyze(server, sessionId)]);
        assert.deepEqual(results.map((r) => r.status).sort(), [202, 400], `round ${round}: ${JSON.stringify(results.map((r) => r.json))}`);
        assert.deepEqual(results.find((r) => r.status === 400).json, NOT_READY_BODY);
        await waitForStatus(server, sessionId, 'completed');
        await waitForIdle(ctx);
      }
      await assertAllSlotsFree(ctx, 2);
    });
  });

  // The memory store's claim is a synchronous check-and-set that never throws for a valid
  // id, so only the database store has this path. A trigger on the throwaway database
  // makes one session's cloned -> analyzing update fail, as a database outage would.
  describe(`B2.1 a claim that throws frees its slot: ANALYSIS_CONCURRENCY=1, ANALYSIS_QUEUE_MAX=0 (${store.label} store)`, { skip: store.label === 'database' ? store.skip : 'the memory store claim cannot throw' }, () => {
    let ctx;
    before(async () => { ctx = await launch(store, { ANALYSIS_CONCURRENCY: '1', ANALYSIS_QUEUE_MAX: '0' }); });
    after(async () => { await ctx?.server.stop(); });

    test('a claim that throws answers 503 SESSION_STORE_UNAVAILABLE, leaves the session cloned, and the next session gets 202', { timeout: 60000 }, async () => {
      const { server, db } = ctx;
      assert.ok(server.logs().includes('🧵 Analysis jobs: 1 at once, 0 queued at most'));
      fakes.llm.reset();
      fakes.llm.setDelay(50);
      const broken = await clone(server);
      assert.match(broken, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      await adminQuery(`CREATE FUNCTION test_refuse_claim() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected claim failure'; END $$`, [], db.name);
      await adminQuery(`CREATE TRIGGER test_refuse_claim BEFORE UPDATE ON analysis_sessions FOR EACH ROW
        WHEN (OLD.id = '${broken}' AND NEW.status = 'analyzing') EXECUTE FUNCTION test_refuse_claim()`, [], db.name);
      try {
        const refused = await analyze(server, broken);
        assert.equal(refused.status, 503, JSON.stringify(refused.json));
        assert.deepEqual(refused.json, { error: 'Session service unavailable', code: 'SESSION_STORE_UNAVAILABLE' });
        assert.equal((await statusOf(server, broken)).status, 'cloned', 'the failed claim changed nothing');
        await assertAllSlotsFree(ctx, 1);
      } finally {
        await adminQuery('DROP TRIGGER IF EXISTS test_refuse_claim ON analysis_sessions', [], db.name);
        await adminQuery('DROP FUNCTION IF EXISTS test_refuse_claim()', [], db.name);
      }
    });

    test('while a claim is in progress, /api/metrics analysisJobs reports its reserved slot', { timeout: 60000 }, async () => {
      const { server, db } = ctx;
      fakes.llm.reset();
      const slow = await clone(server);
      // Holds this session's cloned -> analyzing update for 2 s, so the request sits
      // between reserve() and enqueue()
      await adminQuery(`CREATE FUNCTION test_slow_claim() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$`, [], db.name);
      await adminQuery(`CREATE TRIGGER test_slow_claim BEFORE UPDATE ON analysis_sessions FOR EACH ROW
        WHEN (OLD.id = '${slow}' AND NEW.status = 'analyzing') EXECUTE FUNCTION test_slow_claim()`, [], db.name);
      try {
        const pending = analyze(server, slow);
        const during = await waitFor(async () => {
          const { analysisJobs } = await metricsOf(ctx);
          return analysisJobs.reserved === 1 ? analysisJobs : null;
        }, 1800, 'a reserved slot');
        assert.deepEqual(during, { running: 0, queued: 0, reserved: 1 });
        assert.equal((await pending).status, 202);
        await waitForStatus(server, slow, 'completed');
        await waitForIdle(ctx);
        assert.deepEqual((await metricsOf(ctx)).analysisJobs, { running: 0, queued: 0, reserved: 0 });
      } finally {
        await adminQuery('DROP TRIGGER IF EXISTS test_slow_claim ON analysis_sessions', [], db.name);
        await adminQuery('DROP FUNCTION IF EXISTS test_slow_claim()', [], db.name);
      }
    });
  });

  describe(`B2.1 a failure in the background (${store.label} store)`, { skip: store.skip }, () => {
    let ctx;
    before(async () => { ctx = await launch(store, { TEST_FAULT_INJECTION: 'analysis-failure' }); });
    after(async () => { await ctx?.server.stop(); });

    test('the session is failed, a failed event is sent, the directory is removed, nothing is unhandled', { timeout: 60000 }, async () => {
      const { server } = ctx;
      fakes.llm.reset();
      const sessionId = await clone(server);
      const watcher = await subscribe(server, sessionId);
      const logStart = server.logs().length;
      assert.equal((await analyze(server, sessionId)).status, 202);

      await waitForStatus(server, sessionId, 'failed');
      const status = await statusOf(server, sessionId);
      assert.equal(status.error, 'Analysis failed');
      await waitFor(() => watcher.events.some((e) => e.status === 'failed'), 3000, 'the failed event');
      const failed = watcher.events.find((e) => e.status === 'failed');
      assert.deepEqual({ step: failed.step, progress: failed.progress, error: failed.error }, { step: 'Analysis failed', progress: 0, error: 'Analysis failed' });
      watcher.socket.close();
      assert.equal(await pathExists(cloneDir(server, sessionId)), false, 'removed on failure too');

      await sleep(200);
      const metrics = await metricsOf(ctx);
      assert.equal(metrics.unhandledRejections, 0, 'the job rejection was caught by the runner');
      assert.deepEqual(metrics.analysisJobs, { running: 0, queued: 0, reserved: 0 });
      const logs = server.logs().slice(logStart);
      assert.match(logs, new RegExp(`analysis job finished: session=${sessionId} outcome=failed`));
      assert.ok(!logs.includes(FAULT_SECRET_MARKER), 'logged redacted');
      assert.ok(!logs.includes('Unhandled rejection'));
      const analytics = await (await fetch(`${server.baseUrl}/api/analytics`, { headers: { 'X-Metrics-Token': ctx.metricsToken } })).json();
      assert.deepEqual(analytics.phases.analysis.outcomes, { failed: 1 });
    });
  });

  // B4.2 (T-403): an AI provider failure never throws out of the pipeline. Each generator
  // records a fixed public error, the verifier is skipped, and the run completes with no
  // files; only a throw (the describe above) fails a session.
  describe(`B4.2 every AI call fails (${store.label} store)`, { skip: store.skip }, () => {
    let ctx;
    before(async () => { ctx = await launch(store); });
    after(async () => {
      fakes.llm.setResponder(null);
      await ctx?.server.stop();
    });

    test('completed with no files and one sanitized error per file; no review call; the directory is removed', { timeout: 60000 }, async () => {
      const { server } = ctx;
      fakes.llm.reset();
      // 400 on every provider (no retry), with a body that must never reach the user
      const providerBody = { error: { message: `provider said no ${FAULT_SECRET_MARKER}` } };
      fakes.llm.setResponder(() => ({ status: 400, body: providerBody }));
      const sessionId = await clone(server);
      assert.equal((await analyze(server, sessionId)).status, 202);

      await waitForStatus(server, sessionId, 'completed');
      assert.equal(await pathExists(cloneDir(server, sessionId)), false, 'the clone directory is removed');
      const response = await fetch(`${server.baseUrl}/api/files/${sessionId}`, { headers: authHeaders(tokenA()) });
      assert.equal(response.status, 200);
      const text = await response.text();
      const listing = JSON.parse(text);
      assert.deepEqual(listing.files, {});
      const generatorErrors = listing.errors.filter((error) => error.startsWith('Generator Agent Error: '));
      assert.equal(generatorErrors.length, 3, JSON.stringify(listing.errors));
      assert.ok(!text.includes(FAULT_SECRET_MARKER) && !text.includes('provider said no'), 'the provider body is not shown');
      const download = await fetch(`${server.baseUrl}/api/files/${sessionId}/dockerfile`, { headers: authHeaders(tokenA()) });
      assert.equal(download.status, 404);
      assert.ok(fakes.llm.requests.length > 0, 'the generators did call the AI');
      assert.ok(fakes.llm.requests.every((request) => generatorKindOf(request.body)), 'no verifier call without files');
    });
  });

  describe(`B2.1 shutdown with a running job (${store.label} store)`, { skip: store.skip }, () => {
    test('SIGTERM exits within the 3 s cap; after a restart the session is failed (database store)', { timeout: 60000 }, async () => {
      fakes.llm.reset();
      fakes.llm.setResponder((body) => (isFirstCall({ body }) ? { hang: true } : undefined));
      const ctx = await launch(store, { AI_TIMEOUT_MS: '30000', AI_CALL_BUDGET_MS: '60000' });
      try {
        const sessionId = await clone(ctx.server);
        assert.equal((await analyze(ctx.server, sessionId)).status, 202);
        await waitFor(() => fakes.llm.requests.some(isFirstCall), 5000, 'the first generator call');
        assert.deepEqual((await metricsOf(ctx)).analysisJobs, { running: 1, queued: 0, reserved: 0 });

        const started = Date.now();
        ctx.server.signal('SIGTERM');
        const exit = await ctx.server.waitForExit(10000);
        const elapsed = Date.now() - started;
        assert.equal(exit.code, 0);
        assert.ok(elapsed < 3500, `exited after ${elapsed} ms`);
        assert.ok(elapsed >= 900, `waited for the running job (${elapsed} ms)`);
        assert.match(ctx.server.logs(), /Analysis jobs: 1 still running, 0 queued dropped/);

        if (ctx.db) {
          fakes.llm.setResponder(null);
          const restarted = await launch({ env: async () => ({ SESSION_STORE: 'database', DATABASE_URL: ctx.db.url }) });
          try {
            const status = await statusOf(restarted.server, sessionId);
            assert.equal(status.status, 'failed');
            assert.equal(status.error, RESTART_MESSAGE);
          } finally {
            await restarted.server.stop();
          }
        }
      } finally {
        fakes.llm.setResponder(null);
        await ctx.server.stop();
      }
    });
  });
}

// E.7 at startup: seeded rows and directories (the database store is the one that
// survives a restart)
describe('B2.1 startup cleanup of clone directories and stale cloned sessions (database store)', { skip: DB_SKIP }, () => {
  test('completed and failed lose their directories; a cloned session older than 1 hour fails; a fresh one is kept', { timeout: 60000 }, async () => {
    const db = await createTestDatabase();
    databases.push(db);
    const { createPrismaClient } = await import('../db/client.js');
    const client = createPrismaClient({ DATABASE_URL: db.url });
    const now = Date.now();
    const seed = async (status, clonedAgoMs) => {
      const id = crypto.randomUUID();
      const created = new Date(now - clonedAgoMs - 1000);
      await client.prisma.analysisSession.create({
        data: {
          id, userId: USER_A.id, owner: 'octocat', repo: 'Hello-World', fullName: 'octocat/Hello-World', repoName: 'Hello-World',
          displayUrl: 'https://github.com/octocat/Hello-World', status, createdAt: created, updatedAt: created,
          clonedAt: new Date(now - clonedAgoMs), expiresAt: new Date(now + 3600 * 1000),
          ...(status === 'failed' ? { error: 'Analysis failed' } : {})
        }
      });
      return id;
    };
    const ids = {
      completed: await seed('completed', 30 * 60 * 1000),
      failed: await seed('failed', 30 * 60 * 1000),
      staleCloned: await seed('cloned', 2 * 60 * 60 * 1000),
      freshCloned: await seed('cloned', 10 * 60 * 1000)
    };
    const cwd = await makeTempDir();
    for (const id of Object.values(ids)) {
      await fs.mkdir(path.join(cwd, 'temp', id, 'repo'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'temp', id, 'repo', 'marker.txt'), 'x');
    }

    const { server } = await launch({ env: async () => ({ SESSION_STORE: 'database', DATABASE_URL: db.url }) }, {}, { cwd });
    try {
      assert.equal(await pathExists(path.join(cwd, 'temp', ids.completed)), false, 'completed: removed');
      assert.equal(await pathExists(path.join(cwd, 'temp', ids.failed)), false, 'failed: removed');
      assert.equal(await pathExists(path.join(cwd, 'temp', ids.staleCloned)), false, 'stale cloned: removed');
      assert.equal(await pathExists(path.join(cwd, 'temp', ids.freshCloned, 'repo', 'marker.txt')), true, 'fresh cloned: kept');

      const stale = await statusOf(server, ids.staleCloned);
      assert.equal(stale.status, 'failed');
      assert.equal(stale.error, STALE_MESSAGE);
      assert.equal((await statusOf(server, ids.freshCloned)).status, 'cloned');
      assert.equal((await statusOf(server, ids.completed)).status, 'completed');
      assert.ok(server.logs().includes('Stale cloned sessions failed: 1;'), server.logs());

      // The stale session's failure is also its snapshot, for a subscriber
      const watcher = await subscribe(server, ids.staleCloned);
      await waitFor(() => watcher.events.length >= 1, 3000, 'the snapshot');
      assert.deepEqual({ status: watcher.events[0].status, error: watcher.events[0].error }, { status: 'failed', error: STALE_MESSAGE });
      watcher.socket.close();
      // A failed session cannot be analyzed
      assert.equal((await analyze(server, ids.staleCloned)).status, 400);
    } finally {
      await server.stop();
      await client.close();
    }
  });
});
