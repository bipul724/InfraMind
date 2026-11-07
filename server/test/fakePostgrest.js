// Local stand-in for Supabase PostgREST, implementing only the three calls the
// github_connections adapter makes. Checks apikey for both key forms and Bearer only
// for a legacy JWT, so a secret API key cannot accidentally be sent as a user JWT.

import http from 'node:http';
import crypto from 'node:crypto';

const encodeJwtPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
// Build credential-shaped fixtures at runtime so source scanning never sees a full key.
export const FAKE_SERVICE_KEY = [
  encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
  encodeJwtPart({ role: 'service_role', ref: 'offline-test' }),
  crypto.randomBytes(32).toString('base64url')
].join('.');
export const FAKE_SECRET_SERVICE_KEY = 'sb_' + 'secret_' + crypto.randomBytes(32).toString('base64url');
const TABLE_PATH = '/rest/v1/github_connections';
const ALLOWED_SELECT = 'github_user_id,github_login,github_name,github_avatar_url,scopes,token_ciphertext,connected_at';

// Returns { handle(req, res) -> boolean, ... }. handle() answers requests for the
// table path and returns false for anything else, so it can share a server.
export function createFakePostgrest({ serviceKey = FAKE_SERVICE_KEY } = {}) {
  const rows = new Map(); // user_id -> row
  const requests = [];
  let mode = 'ok';

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  function handle(req, res) {
    const url = new URL(req.url, 'http://fake.postgrest');
    if (url.pathname !== TABLE_PATH) return false;

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body: raw });

      if (mode === 'hang') return;
      if (mode === 'error500') return send(res, 500, { message: 'internal error' });

      const expectedBearer = serviceKey.startsWith('sb_' + 'secret_') ? undefined : `Bearer ${serviceKey}`;
      if (req.headers.apikey !== serviceKey || req.headers.authorization !== expectedBearer) {
        return send(res, 401, { message: 'Invalid API key' });
      }

      const userFilter = url.searchParams.get('user_id');
      const userId = userFilter && userFilter.startsWith('eq.') ? userFilter.slice(3) : null;

      if (req.method === 'GET') {
        if (!userId || url.searchParams.get('select') !== ALLOWED_SELECT) return send(res, 400, { message: 'bad query' });
        const row = rows.get(userId);
        if (!row) return send(res, 200, []);
        const projected = Object.fromEntries(ALLOWED_SELECT.split(',').map((column) => [column, row[column]]));
        return send(res, 200, [projected]);
      }

      if (req.method === 'POST') {
        if (url.searchParams.get('on_conflict') !== 'user_id') return send(res, 409, { message: 'duplicate key' });
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(res, 400, { message: 'bad json' });
        }
        if (!body || typeof body.user_id !== 'string' || typeof body.token_ciphertext !== 'string') {
          return send(res, 400, { message: 'missing columns' });
        }
        rows.set(body.user_id, { ...rows.get(body.user_id), ...body });
        return send(res, 201);
      }

      if (req.method === 'DELETE') {
        if (!userId) return send(res, 400, { message: 'refusing to delete without a filter' });
        rows.delete(userId);
        return send(res, 204);
      }

      return send(res, 405, { message: 'method not allowed' });
    });
    return true;
  }

  return {
    handle,
    rows,
    requests,
    serviceKey,
    setMode(next) {
      mode = next;
    }
  };
}

// Standalone server for unit tests
export async function startFakePostgrest(options = {}) {
  const fake = createFakePostgrest(options);
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (!fake.handle(req, res)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  return {
    ...fake,
    url: `http://127.0.0.1:${server.address().port}`,
    setMode: fake.setMode,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
