// Per-agent results reach every viewer (SERVER-FIX D.1) and analysis analytics (D.4).
// Spawned server with SESSION_STORE=database against a throwaway local Postgres
// (TEST_DATABASE_URL): a "cloned" session is seeded through Prisma and its clone
// directory is a local fixture, so the pipeline runs offline against the fake LLM.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { io as connectClient } from 'socket.io-client';
import { authHeaders, closeFakes, getFakes, getFreePort, postJson, randomAlphanumeric, startServer } from './helpers.js';
import { USER_A } from './fakeSupabase.js';
import { DB_SKIP, createTestDatabase } from './db.js';
import { FAKE_FILES, FAKE_LLM_CONTENT } from './fakeLlm.js';
import { VALIDATORS } from '../agents/files.js';

const DOCKERFILE_ERROR = 'Generator Agent Error: Dockerfile: AI providers are unavailable';

describe('per-agent results after a run with one failed generator call', { skip: DB_SKIP }, () => {
  let fakes;
  let db;
  let server;
  let sessionId;
  const metricsToken = randomAlphanumeric(48);
  const liveEvents = [];
  let analyze;
  let completedEvent;

  const subscribe = (token, id, onProgress) => new Promise((resolve, reject) => {
    const socket = connectClient(server.baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
    socket.on('progress', onProgress);
    socket.on('connect_error', reject);
    socket.on('connect', () => socket.emit('subscribe', { sessionId: id }, (ack) => (ack?.ok ? resolve(socket) : reject(new Error(ack?.error)))));
  });
  const getJson = async (route, token) => {
    const response = await fetch(`${server.baseUrl}${route}`, { headers: authHeaders(token) });
    return { status: response.status, text: await response.text() };
  };

  before(async () => {
    fakes = await getFakes();
    db = await createTestDatabase();
    const deadProxy = `http://127.0.0.1:${await getFreePort()}`;
    server = await startServer({
      envOverrides: {
        SESSION_STORE: 'database',
        DATABASE_URL: db.url,
        METRICS_TOKEN: metricsToken,
        HTTPS_PROXY: deadProxy,
        https_proxy: deadProxy,
        CLONE_TIMEOUT_MS: '20000'
      }
    });

    const { createPrismaClient } = await import('../db/client.js');
    const client = createPrismaClient({ DATABASE_URL: db.url });
    sessionId = crypto.randomUUID();
    const now = new Date();
    await client.prisma.analysisSession.create({
      data: {
        id: sessionId, userId: USER_A.id, owner: 'octocat', repo: 'Hello-World', fullName: 'octocat/Hello-World',
        repoName: 'Hello-World', displayUrl: 'https://github.com/octocat/Hello-World', status: 'cloned',
        createdAt: now, updatedAt: now, clonedAt: now, expiresAt: new Date(now.getTime() + 3600 * 1000)
      }
    });
    await client.close();
    const repo = path.join(server.cwd, 'temp', sessionId, 'repo');
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { start: 'node index.js' } }));

    // Call order: planner, Dockerfile, workflow, .env.example, verifier. Only the
    // Dockerfile call fails, on every provider in the chain (400: no retry).
    fakes.llm.reset();
    fakes.llm.enqueue('gemini', {}, { status: 400 });
    fakes.llm.enqueue('groq', { status: 400 });
    fakes.llm.enqueue('openrouter', { status: 400 });

    const live = await subscribe(fakes.tokens.A, sessionId, (event) => liveEvents.push(event));
    analyze = await postJson(server.baseUrl, '/api/analyze', { sessionId }, authHeaders(fakes.tokens.A));
    // B2.1: the run finishes in the background; wait for its completed event
    const deadline = Date.now() + 20000;
    while (!liveEvents.some((event) => event.status === 'completed') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    live.close();
    completedEvent = liveEvents.find((event) => event.status === 'completed');
  });

  after(async () => {
    await server?.stop();
    await db?.drop();
    await closeFakes();
  });

  // B2.1: the analyze response only reports the start; the results that it carried
  // before are asserted on the completed event (and the stored session) instead
  test('the analyze response is 202; the completed event carries sanitized messages and errors', () => {
    assert.equal(analyze.status, 202, analyze.text);
    assert.deepEqual(analyze.json, { success: true, sessionId, status: 'analyzing' });
    assert.ok(completedEvent, JSON.stringify(liveEvents.map((e) => e.status)));
    assert.deepEqual(completedEvent.generatedFiles, ['githubActions', 'envExample']);
    assert.deepEqual(completedEvent.errors, [DOCKERFILE_ERROR]);
    assert.deepEqual(completedEvent.messages.map((m) => m.agent), ['planner', 'analyzer', 'generator', 'verifier']);
    assert.equal(completedEvent.messages.find((m) => m.agent === 'generator').message, 'Generated 2 of 3 files');
    for (const message of completedEvent.messages) assert.deepEqual(Object.keys(message).sort(), ['agent', 'message', 'timestamp']);
  });

  test('B2.1: the per-agent event after the generator already reports its error', () => {
    const afterGenerator = liveEvents.find((event) => event.status === 'analyzing' && event.messages?.length === 3);
    assert.ok(afterGenerator);
    assert.deepEqual(afterGenerator.errors, [DOCKERFILE_ERROR]);
    assert.equal(afterGenerator.messages[2].message, 'Generated 2 of 3 files');
  });

  test('GET /api/files returns the messages and errors of the stored session', async () => {
    const files = await getJson(`/api/files/${sessionId}`, fakes.tokens.A);
    assert.equal(files.status, 200);
    const body = JSON.parse(files.text);
    assert.deepEqual(Object.keys(body.files), ['githubActions', 'envExample']);
    assert.deepEqual(body.errors, [DOCKERFILE_ERROR]);
    assert.deepEqual(body.messages, completedEvent.messages);
  });

  test('B2.5: GET /api/files returns the review and only validated, raw files', async () => {
    const body = JSON.parse((await getJson(`/api/files/${sessionId}`, fakes.tokens.A)).text);
    assert.equal(body.verificationResults, FAKE_LLM_CONTENT);
    // The fake answers chat-style (prose around a fence): only the file inside is stored
    assert.deepEqual(body.files, { githubActions: FAKE_FILES.githubActions, envExample: FAKE_FILES.envExample });
    for (const [kind, content] of Object.entries(body.files)) {
      assert.deepEqual(VALIDATORS[kind](content), { ok: true, errors: [] }, kind);
      assert.ok(!content.includes('Here is'));
    }
    const download = await fetch(`${server.baseUrl}/api/files/${sessionId}/githubActions`, { headers: authHeaders(fakes.tokens.A) });
    assert.equal(await download.text(), FAKE_FILES.githubActions);
  });

  test('the final completed event carries messages and errors', () => {
    const completed = liveEvents.filter((event) => event.status === 'completed');
    assert.equal(completed.length, 1, JSON.stringify(liveEvents.map((e) => e.status)));
    assert.deepEqual(completed[0].errors, [DOCKERFILE_ERROR]);
    assert.deepEqual(completed[0].generatedFiles, ['githubActions', 'envExample']);
  });

  test('a socket subscribing after completion receives a snapshot with both', async () => {
    const snapshots = [];
    const late = await subscribe(fakes.tokens.A, sessionId, (event) => snapshots.push(event));
    await new Promise((resolve) => setTimeout(resolve, 300));
    late.close();
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].status, 'completed');
    assert.deepEqual(snapshots[0].errors, [DOCKERFILE_ERROR]);
    assert.deepEqual(snapshots[0].messages, completedEvent.messages);
  });

  test('a non-owner gets the same 404 as an unknown id', async () => {
    const foreign = await getJson(`/api/files/${sessionId}`, fakes.tokens.B);
    const unknown = await getJson(`/api/files/${crypto.randomUUID()}`, fakes.tokens.B);
    assert.equal(foreign.status, 404);
    assert.equal(foreign.text, unknown.text);
    await assert.rejects(subscribe(fakes.tokens.B, sessionId, () => {}), /Session not found/);
  });

  test('analytics after one failed clone and one successful analysis', { timeout: 60000 }, async () => {
    const clone = await postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Spoon-Knife' }, authHeaders(fakes.tokens.A));
    assert.equal(clone.status, 502);

    const response = await fetch(`${server.baseUrl}/api/analytics`, { headers: { 'X-Metrics-Token': metricsToken } });
    const analytics = await response.json();
    assert.equal(analytics.total, 2);
    assert.equal(analytics.phases.clone.count, 1);
    assert.deepEqual(analytics.phases.clone.outcomes, { failed: 1 });
    assert.equal(analytics.phases.analysis.count, 1);
    assert.deepEqual(analytics.phases.analysis.outcomes, { ok: 1 });

    const agentLines = server.logs().split('\n').filter((line) => line.includes('AGENT [performance]'));
    assert.equal(agentLines.length, 2, 'one line per tracked phase');
    assert.match(agentLines.join('\n'), /analysis completed[^\n]*outcome: 'ok', files: 2/);
    for (const forbidden of ['octocat', 'Hello-World', 'Spoon-Knife', 'github.com', USER_A.id, USER_A.email]) {
      assert.ok(!agentLines.join('\n').includes(forbidden), `analytics log must not contain ${forbidden}`);
    }
  });
});
