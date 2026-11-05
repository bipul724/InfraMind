/**
 * Authenticated Socket.IO with private per-session rooms.
 *
 * Sockets authenticate at the handshake with a Supabase access token passed in
 * `auth.token`. Progress events go only to `session:<id>` rooms, which a socket
 * can join only for sessions its user owns. Nothing is broadcast to everyone.
 * A socket whose access token has expired receives `auth_expired` and is
 * disconnected, either on its next `subscribe` or by a timer at the expiry time.
 *
 * Sessions live in the session store (async): `getOwnedSession(id, userId)` returns the
 * session only for its owner, and `saveProgress(id, payload)` persists the latest
 * progress snapshot. Progress is emitted at once and persisted afterwards, in order.
 *
 * B2.1: the latest payload emitted for each session is also kept in memory (`latest`),
 * set before the emit, so a subscriber gets the newest state even while its persistence
 * write is still pending, and so events emitted during the subscriber's ownership lookup
 * are not lost. See newestSnapshot for how "newer" is decided.
 */

import { AuthError } from './auth.js';
import { isUuidV4 } from './repository.js';
import { toProgressPayload } from './sessionView.js';

export const MAX_ROOMS_PER_SOCKET = 20;
export const MAX_EXPIRY_TIMER_MS = 24 * 60 * 60 * 1000;
// In-memory latest payloads: at most this many sessions (oldest update evicted first)
export const MAX_LATEST_SESSIONS = 1000;
// A terminal (completed/failed) payload is dropped from memory this long after it was
// persisted. Longer than the session store's 5 s query timeout, so an ownership lookup
// that read the row before the write committed has resolved before the entry goes.
export const TERMINAL_RETENTION_MS = 10 * 1000;
const TERMINAL_STATUSES = new Set(['completed', 'failed']);
const roomFor = (sessionId) => `session:${sessionId}`;

// Every emit gets the next sequence number, and a session's in-memory entry is replaced
// only by a later emit, so the entry is the newest state emitted in this process.
// Persistence writes are chained in emit order, so the stored lastProgress that a lookup
// returns was written for a sequence number no higher than the entry's (or by an earlier
// process, which is older still). The entry, when present, is therefore never older
// than the stored snapshot; the stored one is used only when there is no entry (nothing
// emitted for the session since this process started, or the entry was retired).
// Exactly one of the two is returned, never both.
export function newestSnapshot(entry, stored) {
  if (entry) return entry.payload;
  return stored ?? null;
}

export function attachRealtime(io, {
  verifier,
  getOwnedSession,
  saveProgress,
  now = Date.now,
  terminalRetentionMs = TERMINAL_RETENTION_MS
}) {
  // sessionId -> tail of that session's persistence chain, so writes land in order
  const persistChains = new Map();
  // sessionId -> { seq, payload }: the latest emitted payload (B2.1)
  const latest = new Map();
  let sequence = 0;
  io.use(async (socket, next) => {
    const token = socket.handshake?.auth?.token;
    try {
      const user = await verifier.verify(token);
      socket.data.userId = user.id;
      socket.data.expiresAt = typeof user.expiresAt === 'number' ? user.expiresAt : null;
      next();
    } catch (error) {
      const code = error instanceof AuthError && error.code === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED';
      next(new Error(code));
    }
  });

  io.on('connection', (socket) => {
    const subscriptions = new Set();
    let expiryTimer = null;
    console.log(`Client connected: ${socket.id}`);

    const isExpired = () => typeof socket.data.expiresAt === 'number' && socket.data.expiresAt <= now();

    const expire = () => {
      socket.emit('auth_expired');
      socket.disconnect(true);
    };

    // Long-lived tokens are re-checked at least every 24 h
    const scheduleExpiry = () => {
      if (typeof socket.data.expiresAt !== 'number') return;
      const delay = Math.min(Math.max(socket.data.expiresAt - now(), 0), MAX_EXPIRY_TIMER_MS);
      expiryTimer = setTimeout(() => {
        expiryTimer = null;
        if (isExpired()) expire();
        else scheduleExpiry();
      }, delay);
    };
    scheduleExpiry();

    socket.on('subscribe', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (isExpired()) {
        reply({ ok: false, error: 'Authentication expired' });
        return expire();
      }
      const sessionId = payload?.sessionId;

      // Ownership first: nothing (room, snapshot) happens before the owned lookup resolves
      let session = null;
      if (isUuidV4(sessionId)) {
        try {
          session = await getOwnedSession(sessionId, socket.data.userId);
        } catch {
          return reply({ ok: false, error: 'Session service unavailable' });
        }
      }
      if (!socket.connected) return;

      if (!session) {
        return reply({ ok: false, error: 'Session not found' });
      }
      if (!subscriptions.has(sessionId) && subscriptions.size >= MAX_ROOMS_PER_SOCKET) {
        return reply({ ok: false, error: 'Too many subscriptions' });
      }

      subscriptions.add(sessionId);
      socket.join(roomFor(sessionId));
      reply({ ok: true });

      // Late subscribers get the newest state, sent to this socket only. Joining the room
      // and reading the in-memory entry happen in the same tick, so no event falls between
      const snapshot = newestSnapshot(latest.get(sessionId), session.lastProgress);
      if (snapshot) {
        socket.emit('progress', snapshot);
      }
    });

    socket.on('unsubscribe', (payload) => {
      const sessionId = payload?.sessionId;
      if (typeof sessionId !== 'string' || !subscriptions.has(sessionId)) return;
      subscriptions.delete(sessionId);
      socket.leave(roomFor(sessionId));
    });

    socket.on('disconnect', () => {
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  // Emits to the session's room at once; persists the snapshot afterwards. Writes for
  // one session are chained so they cannot land out of order; a failed write is logged
  // and never thrown. Returns the persistence promise (tests await it).
  function remember(sessionId, payload) {
    const seq = ++sequence;
    latest.delete(sessionId); // re-inserted last: Map order is the eviction order
    if (latest.size >= MAX_LATEST_SESSIONS) latest.delete(latest.keys().next().value);
    latest.set(sessionId, { seq, payload });
    return seq;
  }

  // After the write for `seq` landed: a terminal entry that is still the latest is
  // retired later (a later emit for the session keeps its own entry)
  function persisted(sessionId, seq, payload) {
    if (latest.get(sessionId)?.seq !== seq) return;
    if (TERMINAL_STATUSES.has(payload.status)) {
      const timer = setTimeout(() => {
        if (latest.get(sessionId)?.seq === seq) latest.delete(sessionId);
      }, terminalRetentionMs);
      timer.unref?.();
    }
  }

  function emitProgress(sessionId, data) {
    const payload = toProgressPayload(sessionId, data);
    // Set before the emit (B2.1)
    const seq = remember(sessionId, payload);
    io.to(roomFor(sessionId)).emit('progress', payload);
    console.log(`Progress update for ${sessionId}: ${payload.status || ''} ${payload.step || ''}`.trim());

    const previous = persistChains.get(sessionId) || Promise.resolve();
    const next = previous
      .then(() => saveProgress(sessionId, payload))
      .then(() => persisted(sessionId, seq, payload))
      .catch(() => console.warn(`progress persist failed session=${sessionId}`));
    persistChains.set(sessionId, next);
    next.finally(() => {
      if (persistChains.get(sessionId) === next) persistChains.delete(sessionId);
    });
    return next;
  }

  return {
    emitProgress,
    // Test and metrics introspection: how many sessions have an in-memory payload
    latestCount: () => latest.size
  };
}
