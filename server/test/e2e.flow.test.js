// End-to-end: spawned server + fake Supabase + fake LLM + real clone of a public repo.
// Runs only with RUN_NETWORK_TESTS=1 because the clone needs github.com.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connectClient } from 'socket.io-client';
import { authHeaders, closeFakes, getFakes, postJson, startServer } from './helpers.js';

const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === '1';

describe('two users, one analysis', { skip: !RUN_NETWORK && 'set RUN_NETWORK_TESTS=1' }, () => {
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
    fakes.llm.setDelay(300);
    fakes.llm.requestBodies.length = 0;
    server = await startServer();
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

    // 2. A runs the analysis against the fake LLM
    const analyze = await postJson(server.baseUrl, '/api/analyze', { sessionId }, authA);
    assert.equal(analyze.status, 200, analyze.text);

    const deadline = Date.now() + 5000;
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

    // 5. Nothing sensitive reached the LLM
    assert.ok(fakes.llm.requestBodies.length > 0, 'the fake LLM should have been called');
    for (const body of fakes.llm.requestBodies) {
      assert.ok(!body.includes('access_token'));
      assert.ok(!body.includes(fakes.tokens.A));
      assert.ok(!body.includes(fakes.tokens.B));
      assert.ok(!body.includes(server.cwd), 'no absolute server path');
      assert.ok(!body.includes('@github.com'));
    }
    assert.ok(fakes.llm.requestBodies[0].includes('octocat/Hello-World'));
  });
});
