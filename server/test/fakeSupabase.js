// Local stand-in for Supabase Auth's GET /auth/v1/user.
// The fake is the authority: the server never checks token signatures, so test
// tokens are JWT-shaped strings signed with an arbitrary secret.
// An optional `rest` handler (see fakePostgrest.js) serves /rest/v1 on the same origin,
// because the server derives both from SUPABASE_URL.

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export const USER_A = { id: '11111111-1111-4111-8111-111111111111', email: 'user-a@example.test' };
export const USER_B = { id: '22222222-2222-4222-8222-222222222222', email: 'user-b@example.test' };
export const FAKE_ANON_KEY = 'fake-anon-key-for-tests';

export async function startFakeSupabase({ anonKey = FAKE_ANON_KEY, rest = null } = {}) {
  const tokens = new Map(); // token -> user
  const sockets = new Set();
  let mode = 'ok';
  let callCount = 0;

  const server = http.createServer((req, res) => {
    if (rest && rest.handle(req, res)) return;
    if (req.method !== 'GET' || req.url !== '/auth/v1/user') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    callCount++;
    if (mode === 'hang') return; // never answer
    if (mode === 'error500') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ msg: 'internal error' }));
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = req.headers.apikey === anonKey ? tokens.get(token) : undefined;
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ msg: 'invalid JWT' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' }));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    anonKey,
    get callCount() {
      return callCount;
    },
    setMode(next) {
      mode = next;
    },
    // Issue a JWT-shaped token that the fake maps to `user`
    issueToken(user, { expiresInSeconds = 3600, issuer = `${url}/auth/v1` } = {}) {
      const token = jwt.sign(
        { sub: user.id, email: user.email, iss: issuer, nonce: crypto.randomUUID() },
        crypto.randomBytes(32).toString('hex'),
        { expiresIn: expiresInSeconds }
      );
      tokens.set(token, user);
      return token;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
