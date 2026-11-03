/**
 * Authenticated Socket.IO with private per-session rooms.
 *
 * Sockets authenticate at the handshake with a Supabase access token passed in
 * `auth.token`. Progress events go only to `session:<id>` rooms, which a socket
 * can join only for sessions its user owns. Nothing is broadcast to everyone.
 */

import { AuthError } from './auth.js';
import { isUuidV4 } from './repository.js';
import { toProgressPayload } from './sessionView.js';

export const MAX_ROOMS_PER_SOCKET = 20;
const roomFor = (sessionId) => `session:${sessionId}`;

export function attachRealtime(io, { verifier, getSession }) {
  io.use(async (socket, next) => {
    const token = socket.handshake?.auth?.token;
    try {
      const user = await verifier.verify(token);
      socket.data.userId = user.id;
      next();
    } catch (error) {
      const code = error instanceof AuthError && error.code === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED';
      next(new Error(code));
    }
  });

  io.on('connection', (socket) => {
    const subscriptions = new Set();
    console.log(`Client connected: ${socket.id}`);

    socket.on('subscribe', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
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
