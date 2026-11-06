import crypto from 'node:crypto';
import http from 'node:http';
import { USER_A, USER_B } from '../server/test/fakeSupabase.js';

// Reuse the verifier's token issuer so browser sessions authenticate against the real server.
export async function startBrowserSupabase({ verifier, postgrest, origin, connectGitHub }) {
  const tokenUsers = new Map();
  const refreshUsers = new Map();
  const savedRows = [];
  const sockets = new Set();
  const users = [USER_A, USER_B];
  const userShape = (user) => ({
    ...user, aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: user.id === USER_A.id ? 'Alice Tester' : 'Bob Tester' },
    created_at: '2026-01-01T00:00:00Z'
  });
  const sessionFor = (user) => {
    const token = verifier.issueToken(user);
    const refresh = crypto.randomUUID();
    tokenUsers.set(token, user);
    refreshUsers.set(refresh, user);
    return {
      access_token: token, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refresh, user: userShape(user)
    };
  };
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'content-range');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (postgrest.handle(req, res)) return;
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const user = tokenUsers.get(token);
        if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
          const grant = url.searchParams.get('grant_type');
          if (grant === 'password') {
            const known = users.find((candidate) => candidate.email === body.email);
            const password = known?.id === USER_A.id ? 'pw-a' : 'pw-b';
            return known && body.password === password
              ? send(200, sessionFor(known))
              : send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
          }
          if (grant === 'refresh_token') {
            const refreshed = refreshUsers.get(body.refresh_token);
            return refreshed ? send(200, sessionFor(refreshed)) : send(400, { error: 'invalid_grant' });
          }
        }
        if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
          return user ? send(200, userShape(user)) : send(401, { msg: 'invalid JWT' });
        }
        if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
          tokenUsers.delete(token);
          return send(204);
        }
        // This loopback fixture endpoint invokes the existing OAuth helper without visiting provider pages.
        if (url.pathname === '/__e2e/connect-github' && req.method === 'POST') {
          await connectGitHub();
          return send(200, { connected: true });
        }
        if (url.pathname === '/rest/v1/saved_files') {
          if (!user || req.headers.apikey !== verifier.anonKey) return send(401, { message: 'JWT invalid' });
          if (req.method === 'POST') {
            const rows = (Array.isArray(body) ? body : [body]).map((row) => ({ ...row, user_id: row.user_id === undefined ? user.id : row.user_id }));
            if (rows.some((row) => row.user_id !== user.id)) return send(403, { message: 'row-level security' });
            const conflictColumns = 'user_id,name,repo_url,content_sha256';
            const ignoreDuplicates = url.searchParams.get('on_conflict') === conflictColumns
              && (req.headers.prefer || '').split(',').some((value) => value.trim() === 'resolution=ignore-duplicates');
            const inserted = [];
            for (const row of rows) {
              const owned = [...savedRows, ...inserted].filter((candidate) => candidate.user_id === user.id);
              if (owned.length >= 500) return send(400, { code: '23514', message: 'saved_files limit reached (500 per user)' });
              if (typeof row.name !== 'string' || [...row.name].length < 1 || [...row.name].length > 255
                || !['dockerfile', 'github-actions', 'env'].includes(row.type)
                || (row.repo_url != null && (typeof row.repo_url !== 'string' || [...row.repo_url].length > 2048))) {
                return send(400, { code: '23514', message: 'saved_files shape check failed' });
              }
              if (typeof row.content !== 'string' || Buffer.byteLength(row.content, 'utf8') > 100000) {
                return send(400, { code: '23514', message: 'saved_files_content_size_check' });
              }
              const content_sha256 = crypto.createHash('sha256').update(row.content, 'utf8').digest('hex');
              const duplicate = owned.some((candidate) => candidate.name === row.name
                && (candidate.repo_url ?? null) === (row.repo_url ?? null) && candidate.content_sha256 === content_sha256);
              if (duplicate) {
                if (ignoreDuplicates) continue;
                return send(409, { code: '23505', message: 'saved_files_unique_file' });
              }
              inserted.push({ ...row, repo_url: row.repo_url ?? null, content_sha256, id: crypto.randomUUID(), created_at: new Date().toISOString() });
            }
            savedRows.push(...inserted);
            return send(201, inserted);
          }
          if (req.method === 'GET') {
            const limit = Number(url.searchParams.get('limit') || 50);
            const offset = Number(url.searchParams.get('offset') || 0);
            const rows = savedRows.filter((row) => row.user_id === user.id).sort((left, right) =>
              right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
            return send(200, rows.slice(offset, offset + limit));
          }
          if (req.method === 'DELETE') {
            const id = url.searchParams.get('id')?.replace(/^eq\./, '');
            const index = savedRows.findIndex((row) => row.user_id === user.id && row.id === id);
            return send(200, index < 0 ? [] : savedRows.splice(index, 1).map((row) => ({ id: row.id })));
          }
        }
        return send(404, {});
      } catch (error) {
        return send(500, { message: error.message });
      }
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
