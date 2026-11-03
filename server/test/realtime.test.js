// In-process Socket.IO server + socket.io-client, with a real verifier pointed at the fake Supabase
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';
import { createSupabaseVerifier } from '../utils/auth.js';
import { attachRealtime, MAX_ROOMS_PER_SOCKET } from '../utils/realtime.js';
import { startFakeSupabase, USER_A, USER_B } from './fakeSupabase.js';

let fake;
let httpServer;
let ioServer;
let url;
let realtime;
const sessions = new Map();
const S1 = crypto.randomUUID();
const S2 = crypto.randomUUID();
const extraSessionsOfA = Array.from({ length: MAX_ROOMS_PER_SOCKET + 1 }, () => crypto.randomUUID());
const openClients = new Set();

before(async () => {
  fake = await startFakeSupabase();
  sessions.set(S1, { userId: USER_A.id, status: 'cloned' });
  sessions.set(S2, { userId: USER_B.id, status: 'cloned' });
  for (const id of extraSessionsOfA) sessions.set(id, { userId: USER_A.id, status: 'cloned' });

  httpServer = http.createServer();
  ioServer = new Server(httpServer);
  const verifier = createSupabaseVerifier({ supabaseUrl: fake.url, anonKey: fake.anonKey });
  realtime = attachRealtime(ioServer, { verifier, getSession: (id) => sessions.get(id) });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  for (const client of openClients) client.close();
  await new Promise((resolve) => ioServer.close(() => resolve()));
  await fake.close();
});

// Resolves with a connected socket, or rejects with the connect_error
function connect(auth) {
  return new Promise((resolve, reject) => {
    const client = connectClient(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    openClients.add(client);
    client.once('connect', () => resolve(client));
    client.once('connect_error', (error) => {
      client.close();
      reject(error);
    });
  });
}

const subscribe = (client, sessionId) => client.timeout(3000).emitWithAck('subscribe', { sessionId });

// Collect progress events on a socket
function record(client) {
  const events = [];
  client.on('progress', (payload) => events.push(payload));
  return events;
}

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await settle(20);
  }
}

describe('handshake authentication', () => {
  test('a client without a token is refused with AUTH_REQUIRED', async () => {
    await assert.rejects(connect(undefined), (error) => error.message === 'AUTH_REQUIRED');
  });

  test('a garbage token is refused with AUTH_REQUIRED', async () => {
    await assert.rejects(connect({ token: 'garbage' }), (error) => error.message === 'AUTH_REQUIRED');
  });

  test('a token Supabase does not know is refused with AUTH_REQUIRED', async () => {
    // Well-formed, unexpired, right issuer, but never issued by the fake
    const issued = fake.issueToken(USER_A);
    const forged = issued.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    await assert.rejects(connect({ token: forged }), (error) => error.message === 'AUTH_REQUIRED');
  });

  test('Supabase errors refuse the connection with AUTH_UNAVAILABLE', async () => {
    fake.setMode('error500');
    try {
      await assert.rejects(connect({ token: fake.issueToken(USER_A) }), (error) => error.message === 'AUTH_UNAVAILABLE');
    } finally {
      fake.setMode('ok');
    }
  });
});

describe('subscriptions and private rooms', () => {
  let tokenA;
  let tokenB;
  before(() => {
    tokenA = fake.issueToken(USER_A);
    tokenB = fake.issueToken(USER_B);
  });

  test('owners can subscribe; other users and invalid ids cannot', async () => {
    const a = await connect({ token: tokenA });
    const b = await connect({ token: tokenB });
    assert.deepEqual(await subscribe(a, S1), { ok: true });
    assert.deepEqual(await subscribe(b, S1), { ok: false, error: 'Session not found' });
    assert.deepEqual(await subscribe(a, 'not-a-uuid'), { ok: false, error: 'Session not found' });
    assert.deepEqual(await subscribe(a, crypto.randomUUID()), { ok: false, error: 'Session not found' });
    a.close();
    b.close();
  });

  test('progress reaches only the owner subscribed to the session', async () => {
    const a = await connect({ token: tokenA });
    const b = await connect({ token: tokenB });
    const aIdle = await connect({ token: tokenA });
    const aEvents = record(a);
    const bEvents = record(b);
    const idleEvents = record(aIdle);

    assert.deepEqual(await subscribe(a, S1), { ok: true });
    assert.deepEqual(await subscribe(b, S2), { ok: true });

    for (let i = 1; i <= 3; i++) {
      realtime.emitProgress(S1, { step: `step ${i}`, progress: i * 10, status: 'analyzing' });
    }

    await waitFor(() => aEvents.length >= 3);
    await settle();
    assert.deepEqual(aEvents.map((e) => e.step), ['step 1', 'step 2', 'step 3']);
    assert.equal(bEvents.length, 0, 'user B (subscribed to S2) must receive nothing for S1');
    assert.equal(idleEvents.length, 0, 'an unsubscribed socket of the same user must receive nothing');
    a.close();
    b.close();
    aIdle.close();
  });

  test('a late subscriber immediately receives the latest snapshot, on its socket only', async () => {
    const other = await connect({ token: tokenA });
    const otherEvents = record(other);
    realtime.emitProgress(S1, { step: 'Analysis complete!', progress: 100, status: 'completed', generatedFiles: ['dockerfile'] });

    const late = await connect({ token: tokenA });
    const lateEvents = record(late);
    assert.deepEqual(await subscribe(late, S1), { ok: true });
    await waitFor(() => lateEvents.length >= 1);
    assert.equal(lateEvents[0].status, 'completed');
    assert.equal(lateEvents[0].progress, 100);
    assert.equal(lateEvents[0].sessionId, S1);

    await settle();
    assert.equal(otherEvents.length, 0, 'the snapshot is sent only to the subscribing socket');
    other.close();
    late.close();
  });

  test('payloads never carry fields outside the allow-list', async () => {
    const a = await connect({ token: tokenA });
    const events = record(a);
    await subscribe(a, S1);

    realtime.emitProgress(S1, { step: 'planted', status: 'analyzing', token: 'PLANTED', clonePath: '/abs' });
    await waitFor(() => events.some((e) => e.step === 'planted'));
    const received = events.find((e) => e.step === 'planted');
    assert.equal('token' in received, false);
    assert.equal('clonePath' in received, false);
    assert.ok(!JSON.stringify(events).includes('PLANTED'));
    a.close();
  });

  test(`subscription number ${MAX_ROOMS_PER_SOCKET + 1} on one socket is refused`, async () => {
    const a = await connect({ token: tokenA });
    for (const id of extraSessionsOfA.slice(0, MAX_ROOMS_PER_SOCKET)) {
      assert.deepEqual(await subscribe(a, id), { ok: true });
    }
    assert.deepEqual(await subscribe(a, extraSessionsOfA[MAX_ROOMS_PER_SOCKET]), { ok: false, error: 'Too many subscriptions' });
    a.close();
  });

  test('after unsubscribe no further events arrive', async () => {
    const a = await connect({ token: tokenA });
    const events = record(a);
    await subscribe(a, S1);
    await settle(50);
    events.length = 0;

    a.emit('unsubscribe', { sessionId: S1 });
    await settle(100);
    realtime.emitProgress(S1, { step: 'after unsubscribe', status: 'analyzing' });
    await settle();
    assert.equal(events.length, 0);
    a.close();
  });
});
