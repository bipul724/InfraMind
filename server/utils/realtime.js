/**
 * Authenticated Socket.IO with private per-session rooms.
 *
 * Sockets authenticate at the handshake with a Supabase access token passed in
 * `auth.token`. Progress events go only to `session:<id>` rooms, which a socket
 * can join only for sessions its user owns. Nothing is broadcast to everyone.
 * A socket whose access token has expired receives `auth_expired` and is
 * disconnected, either on its next `subscribe` or by a timer at the expiry time.
 */

import { AuthError } from './auth.js';
import { isUuidV4 } from './repository.js';
import { toProgressPayload } from './sessionView.js';

export const MAX_ROOMS_PER_SOCKET = 20;
export const MAX_EXPIRY_TIMER_MS = 24 * 60 * 60 * 1000;
const roomFor = (sessionId) => `session:${sessionId}`;

export function attachRealtime(io, { verifier, getSession, now = Date.now }) {
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

    socket.on('subscribe', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (isExpired()) {
        reply({ ok: false, error: 'Authentication expired' });
        return expire();
      }
      const sessionId = payload?.sessionId;
      const session = isUuidV4(sessionId) ? getSession(sessionId) : null;

      if (!session || session.userId !== socket.data.userId) {
        return reply({ ok: false, error: 'Session not found' });
      }
      if (!subscriptions.has(sessionId) && subscriptions.size >= MAX_ROOMS_PER_SOCKET) {
        return reply({ ok: false, error: 'Too many subscriptions' });
      }

      subscriptions.add(sessionId);
      socket.join(roomFor(sessionId));
      reply({ ok: true });

      // Late subscribers get the latest state, sent to this socket only
      if (session.lastProgress) {
        socket.emit('progress', session.lastProgress);
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

  function emitProgress(sessionId, data) {
    const payload = toProgressPayload(sessionId, data);
    const session = getSession(sessionId);
    if (session) {
      session.lastProgress = payload;
    }
    io.to(roomFor(sessionId)).emit('progress', payload);
    console.log(`Progress update for ${sessionId}: ${payload.status || ''} ${payload.step || ''}`.trim());
  }

  return { emitProgress };
}
