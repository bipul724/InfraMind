// In-process Socket.IO server + socket.io-client, with a real verifier pointed at the fake Supabase
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';
import { createSupabaseVerifier } from '../utils/auth.js';
import { attachRealtime, MAX_LATEST_SESSIONS, MAX_ROOMS_PER_SOCKET, newestSnapshot } from '../utils/realtime.js';
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
// Added to the realtime module's clock (not the verifier's) to simulate token expiry
let clockOffsetMs = 0;
// Fake session store switches
let storeDown = false;
let persistFails = false;
const persistDelays = [];
const lookupDelays = [];

before(async () => {
  fake = await startFakeSupabase();
  sessions.set(S1, { userId: USER_A.id, status: 'cloned' });
  sessions.set(S2, { userId: USER_B.id, status: 'cloned' });
  for (const id of extraSessionsOfA) sessions.set(id, { userId: USER_A.id, status: 'cloned' });

  httpServer = http.createServer();
  ioServer = new Server(httpServer);
  const verifier = createSupabaseVerifier({ supabaseUrl: fake.url, anonKey: fake.anonKey });
  // The session store is async (B2.0b): owned lookups and progress persistence
  realtime = attachRealtime(ioServer, {
    verifier,
    getOwnedSession: async (id, userId) => {
      if (storeDown) throw new Error('store down');
      // A copy, as the real store returns: what was stored when the lookup ran
      const session = sessions.get(id);
      const found = session && session.userId === userId ? structuredClone(session) : null;
      const delay = lookupDelays.shift() ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return found;
    },
    saveProgress: async (id, payload) => {
      const delay = persistDelays.shift() ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (persistFails) throw new Error('write failed');
      const session = sessions.get(id);
      if (session) session.lastProgress = payload;
    },
    now: () => Date.now() + clockOffsetMs
  });
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

describe('T-118: refused subscriptions and token expiry', () => {
  test('a refused subscribe never delivers the snapshot of a session that has one', async () => {
    await realtime.emitProgress(S1, { step: 'snapshot for the owner only', progress: 50, status: 'analyzing' });
    assert.ok(sessions.get(S1).lastProgress, 'S1 has a snapshot');

    const b = await connect({ token: fake.issueToken(USER_B) });
    const bEvents = record(b);
    assert.deepEqual(await subscribe(b, S1), { ok: false, error: 'Session not found' });
    await settle(300);
    assert.equal(bEvents.length, 0, 'B must receive no progress event for S1');

    // Control: the owner does get the snapshot on the same server
    const a = await connect({ token: fake.issueToken(USER_A) });
    const aEvents = record(a);
    assert.deepEqual(await subscribe(a, S1), { ok: true });
    await waitFor(() => aEvents.length >= 1);
    assert.equal(aEvents[0].step, 'snapshot for the owner only');
    a.close();
    b.close();
  });

  test('a socket whose token has expired gets auth_expired and is disconnected on its next subscribe', async () => {
    const a = await connect({ token: fake.issueToken(USER_A) });
    const events = record(a);
    let expiredEvents = 0;
    a.on('auth_expired', () => { expiredEvents++; });
    const disconnected = new Promise((resolve) => a.once('disconnect', resolve));

    assert.deepEqual(await subscribe(a, S1), { ok: true }, 'works while the token is valid');
    await waitFor(() => events.length >= 1);
    events.length = 0;

    clockOffsetMs = 2 * 60 * 60 * 1000; // the 1 h token is now expired
    try {
      assert.deepEqual(await subscribe(a, S1), { ok: false, error: 'Authentication expired' });
      assert.equal(await disconnected, 'io server disconnect');
    } finally {
      clockOffsetMs = 0;
    }
    assert.equal(expiredEvents, 1);
    assert.equal(events.length, 0, 'no snapshot is sent to an expired socket');
  });

  test('a connected socket is disconnected by the timer at its token expiry', { timeout: 10000 }, async () => {
    const a = await connect({ token: fake.issueToken(USER_A, { expiresInSeconds: 2 }) });
    let expiredEvents = 0;
    a.on('auth_expired', () => { expiredEvents++; });
    const started = Date.now();
    const reason = await new Promise((resolve) => a.once('disconnect', resolve));
    const elapsed = Date.now() - started;

    assert.equal(reason, 'io server disconnect');
    assert.equal(expiredEvents, 1);
    assert.ok(elapsed <= 3500, `disconnected after ${elapsed} ms`);
  });

  test('closing a socket before expiry clears its expiry timer', async () => {
    // Watch timers in this process: the expiry timer is the one scheduled for about 600 s
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const expiryTimers = new Set();
    const cleared = new Set();
    globalThis.setTimeout = (fn, delay, ...args) => {
      const handle = realSetTimeout(fn, delay, ...args);
      if (delay > 590000 && delay <= 600000) expiryTimers.add(handle);
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      if (expiryTimers.has(handle)) cleared.add(handle);
      return realClearTimeout(handle);
    };
    try {
      const before = ioServer.of('/').sockets.size;
      const a = await connect({ token: fake.issueToken(USER_A, { expiresInSeconds: 600 }) });
      assert.equal(expiryTimers.size, 1, 'one expiry timer was scheduled');
      a.close();
      await waitFor(() => ioServer.of('/').sockets.size === before);
      assert.equal(cleared.size, 1, 'the expiry timer was cleared on disconnect');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });
});

describe('B2.0b: async session store', () => {
  test('a refused subscriber never joins the room: later progress for that session does not reach it', async () => {
    const b = await connect({ token: fake.issueToken(USER_B) });
    const bEvents = record(b);
    assert.deepEqual(await subscribe(b, S1), { ok: false, error: 'Session not found' });
    await realtime.emitProgress(S1, { step: 'after the refusal', progress: 60, status: 'analyzing' });
    await settle(300);
    assert.equal(bEvents.length, 0);
    b.close();
  });

  test('a store failure during subscribe replies "Session service unavailable" and joins nothing', async () => {
    const a = await connect({ token: fake.issueToken(USER_A) });
    const events = record(a);
    storeDown = true;
    try {
      assert.deepEqual(await subscribe(a, S1), { ok: false, error: 'Session service unavailable' });
    } finally {
      storeDown = false;
    }
    await realtime.emitProgress(S1, { step: 'while not subscribed', status: 'analyzing' });
    await settle(200);
    assert.equal(events.length, 0, 'no snapshot and no room membership');
    a.close();
  });

  test('progress is emitted at once and persisted in order, even when writes finish out of order', async () => {
    const a = await connect({ token: fake.issueToken(USER_A) });
    const events = record(a);
    const target = extraSessionsOfA[0]; // owned by A
    assert.deepEqual(await subscribe(a, target), { ok: true });
    persistDelays.push(150, 0, 0); // the first write is the slowest
    const first = realtime.emitProgress(target, { step: 'one', status: 'analyzing' });
    realtime.emitProgress(target, { step: 'two', status: 'analyzing' });
    const last = realtime.emitProgress(target, { step: 'three', status: 'analyzing' });
    await waitFor(() => events.filter((e) => e.sessionId === target).length >= 3, 1000);
    assert.equal(sessions.get(target).lastProgress?.step === 'three', false, 'emitting does not wait for persistence');
    await Promise.all([first, last]);
    assert.equal(sessions.get(target).lastProgress.step, 'three', 'the last emitted payload is the one stored');
    a.close();
  });

  test('a failed progress write is logged and never thrown', async () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    persistFails = true;
    try {
      await realtime.emitProgress(S1, { step: 'unsaved', status: 'analyzing' });
    } finally {
      persistFails = false;
      console.warn = original;
    }
    assert.deepEqual(warnings, [`progress persist failed session=${S1}`]);
  });
});

describe('B2.1 (T-207): late subscribers get the newest state', () => {
  test('newestSnapshot: the in-memory entry when there is one, else the stored snapshot; never both', () => {
    const stored = { sessionId: S1, step: 'stored' };
    const entry = { seq: 7, payload: { sessionId: S1, step: 'memory' } };
    assert.equal(newestSnapshot(entry, stored), entry.payload);
    assert.equal(newestSnapshot(entry, undefined), entry.payload);
    assert.equal(newestSnapshot(undefined, stored), stored);
    assert.equal(newestSnapshot(undefined, undefined), null);
  });

  test('while the newest write is still pending, a subscriber gets the in-memory payload, not the older stored one', async () => {
    const target = extraSessionsOfA[1];
    // agent 'planner' stands for a session stored before B2.6 removed the planner agent
    await realtime.emitProgress(target, { step: 'agent 1 done', progress: 20, status: 'analyzing', messages: [{ agent: 'planner', message: 'm1' }] });
    assert.equal(sessions.get(target).lastProgress.step, 'agent 1 done', 'stored: the older event');

    persistDelays.push(600); // the newer write lands late
    const pending = realtime.emitProgress(target, {
      step: 'agent 2 done', progress: 50, status: 'analyzing',
      messages: [{ agent: 'planner', message: 'm1' }, { agent: 'analyzer', message: 'm2' }]
    });
    const late = await connect({ token: fake.issueToken(USER_A) });
    const events = record(late);
    assert.deepEqual(await subscribe(late, target), { ok: true });
    await waitFor(() => events.length >= 1);
    await settle(150);
    assert.equal(sessions.get(target).lastProgress.step, 'agent 1 done', 'the newer write had not landed');
    assert.equal(events.length, 1, 'exactly one snapshot');
    assert.equal(events[0].step, 'agent 2 done');
    assert.equal(events[0].messages.length, 2);
    await pending;
    late.close();
  });

  test('an event emitted during the ownership lookup is not lost', async () => {
    const target = extraSessionsOfA[2];
    await realtime.emitProgress(target, { step: 'before the lookup', progress: 30, status: 'analyzing' });
    const late = await connect({ token: fake.issueToken(USER_A) });
    const events = record(late);
    lookupDelays.push(300);
    persistDelays.push(800);
    const ack = subscribe(late, target);
    await settle(100); // the lookup is in flight
    const pending = realtime.emitProgress(target, { step: 'during the lookup', progress: 50, status: 'analyzing' });
    assert.deepEqual(await ack, { ok: true });
    await waitFor(() => events.length >= 1);
    await settle(150);
    assert.deepEqual(events.map((e) => e.step), ['during the lookup']);
    await pending;
    late.close();
  });

  test('a non-owner still gets nothing, even with an in-memory payload present', async () => {
    const target = extraSessionsOfA[3];
    realtime.emitProgress(target, { step: 'private', progress: 50, status: 'analyzing' });
    const b = await connect({ token: fake.issueToken(USER_B) });
    const events = record(b);
    assert.deepEqual(await subscribe(b, target), { ok: false, error: 'Session not found' });
    await settle(200);
    assert.equal(events.length, 0);
    b.close();
  });
});

describe('B2.1: the in-memory payloads are bounded', () => {
  let ownIo;
  let own;
  const store = new Map();
  before(async () => {
    const server = http.createServer();
    ownIo = new Server(server);
    own = attachRealtime(ownIo, {
      verifier: { verify: async () => { throw new Error('unused'); } },
      getOwnedSession: async () => null,
      saveProgress: async (id, payload) => { store.set(id, payload); },
      terminalRetentionMs: 50
    });
  });
  after(async () => { await new Promise((resolve) => ownIo.close(() => resolve())); });

  test('a completed or failed payload is dropped after it is persisted; others stay', async () => {
    const done = crypto.randomUUID();
    const failed = crypto.randomUUID();
    const running = crypto.randomUUID();
    const before = own.latestCount();
    own.emitProgress(done, { step: 'Analysis complete!', progress: 100, status: 'completed' });
    own.emitProgress(failed, { step: 'Analysis failed', progress: 0, status: 'failed' });
    await own.emitProgress(running, { step: 'working', progress: 50, status: 'analyzing' });
    assert.equal(own.latestCount(), before + 3);
    await settle(150);
    assert.equal(own.latestCount(), before + 1, 'only the analyzing one remains');
    assert.equal(store.get(done).status, 'completed', 'and the terminal ones were persisted first');
  });

  test(`at most ${MAX_LATEST_SESSIONS} sessions are kept`, async () => {
    const writes = [];
    for (let i = 0; i < MAX_LATEST_SESSIONS + 50; i++) {
      writes.push(own.emitProgress(crypto.randomUUID(), { step: 'x', progress: 50, status: 'analyzing' }));
    }
    await Promise.all(writes);
    assert.equal(own.latestCount(), MAX_LATEST_SESSIONS);
  });
});
