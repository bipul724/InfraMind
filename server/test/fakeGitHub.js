// Local stand-in for GitHub OAuth (github.com) and the REST API (api.github.com).
// One server answers both, so GITHUB_OAUTH_BASE_URL and GITHUB_API_BASE_URL can share its URL.
// Every request is recorded with its headers and body.

import http from 'node:http';
import crypto from 'node:crypto';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const randomAlphanumeric = (length) => {
  const bytes = crypto.randomBytes(length);
  let output = '';
  for (let i = 0; i < length; i++) output += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
  return output;
};

export const GITHUB_USER_A = { id: 5001, login: 'octo-a', name: 'Octo A', avatar_url: 'https://avatars.example.test/a.png' };
export const GITHUB_USER_B = { id: 5002, login: 'octo-b', name: 'Octo B', avatar_url: 'https://avatars.example.test/b.png' };
export const GRANTED_SCOPE = 'repo,user:email';

const repoFor = (owner, name, extra = {}) => ({
  id: crypto.randomInt(1, 1e9),
  name,
  full_name: `${owner}/${name}`,
  description: 'fake repository',
  private: true,
  html_url: `https://github.com/${owner}/${name}`,
  clone_url: `https://github.com/${owner}/${name}.git`,
  ssh_url: `git@github.com:${owner}/${name}.git`,
  language: 'JavaScript',
  stargazers_count: 1,
  forks_count: 0,
  updated_at: '2026-11-01T00:00:00Z',
  default_branch: 'main',
  size: 10,
  owner: { login: owner, avatar_url: 'https://avatars.example.test/o.png' },
  ...extra
});

export async function startFakeGitHub() {
  const requests = [];
  const codes = new Map(); // code -> GitHub user
  const tokens = new Map(); // token -> GitHub user
  const issuedTokens = [];
  const issuedCodes = [];
  const revoked = new Set();
  const tokenRevocations = []; // { authorization, body } for every DELETE /applications/:id/token
  const grantCalls = []; // any call to the grant endpoint (must stay empty since B1.3b)
  const sockets = new Set();
  let revokeStatus = 204;
  let apiFailureStatus = null;
  let apiFailureHeaders = {};
  let apiFailureMessage = 'fake API failure';
  let apiDelayMs = 0; // B1.4: delay before every API GET is answered (not OAuth, not revocation)

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const userForRequest = (req) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('token ') ? header.slice(6) : '';
    if (!token || revoked.has(token)) return null;
    return tokens.get(token) || null;
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake.github');
      let body = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = Object.fromEntries(new URLSearchParams(raw));
        }
      }
      requests.push({ method: req.method, path: url.pathname, query: url.search, headers: { ...req.headers }, body, raw });

      // OAuth code exchange
      if (req.method === 'POST' && url.pathname === '/login/oauth/access_token') {
        const user = body && codes.get(body.code);
        if (!user) return send(res, 200, { error: 'bad_verification_code' });
        codes.delete(body.code);
        const token = `gho_${randomAlphanumeric(36)}`;
        tokens.set(token, user);
        issuedTokens.push(token);
        return send(res, 200, { access_token: token, token_type: 'bearer', scope: GRANTED_SCOPE });
      }

      // Single-token revocation (Basic client_id:client_secret)
      const tokenRevocation = url.pathname.match(/^\/applications\/([^/]+)\/token$/);
      if (req.method === 'DELETE' && tokenRevocation) {
        tokenRevocations.push({ authorization: req.headers.authorization, body, clientId: decodeURIComponent(tokenRevocation[1]) });
        if (revokeStatus === 204 && body?.access_token) revoked.add(body.access_token);
        return send(res, revokeStatus, revokeStatus === 204 ? undefined : { message: 'fake failure' });
      }

      // Whole-grant revocation: still answered and recorded, so tests can assert it is never used
      const grant = url.pathname.match(/^\/applications\/([^/]+)\/grant$/);
      if (grant) {
        grantCalls.push({ method: req.method, authorization: req.headers.authorization, body });
        if (req.method === 'DELETE' && revokeStatus === 204 && body?.access_token) revoked.add(body.access_token);
        return send(res, revokeStatus, revokeStatus === 204 ? undefined : { message: 'fake failure' });
      }

      if (req.method !== 'GET') return send(res, 404, { message: 'Not Found' });
      if (apiDelayMs > 0) return void setTimeout(() => answerApi(req, res, url), apiDelayMs).unref();
      return answerApi(req, res, url);
    });
  });

  function answerApi(req, res, url) {
    {
      if (res.destroyed) return;
      if (apiFailureStatus) return send(res, apiFailureStatus, { message: apiFailureMessage }, apiFailureHeaders);

      const user = userForRequest(req);
      if (!user) return send(res, 401, { message: 'Bad credentials' });

      if (url.pathname === '/user') {
        return send(res, 200, { id: user.id, login: user.login, name: user.name, avatar_url: user.avatar_url, email: null });
      }
      if (url.pathname === '/user/repos') {
        return send(res, 200, [repoFor(user.login, 'private-one'), repoFor(user.login, 'private-two')]);
      }
      if (url.pathname === '/user/orgs') {
        return send(res, 200, [{ id: 77, login: 'fake-org', description: 'org', avatar_url: 'https://avatars.example.test/org.png', url: 'https://api.github.com/orgs/fake-org' }]);
      }
      const orgRepos = url.pathname.match(/^\/orgs\/([^/]+)\/repos$/);
      if (orgRepos) {
        return send(res, 200, [repoFor(decodeURIComponent(orgRepos[1]), 'org-repo')]);
      }
      const repo = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/);
      if (repo) {
        return send(res, 200, repoFor(decodeURIComponent(repo[1]), decodeURIComponent(repo[2])));
      }
      return send(res, 404, { message: 'Not Found' });
    }
  }
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    issuedTokens,
    issuedCodes,
    tokenRevocations,
    grantCalls,
    // Tokens revoked through DELETE /applications/:id/token, in order
    revokedViaTokenEndpoint() {
      return tokenRevocations.map((r) => r.body?.access_token);
    },
    // A one-time authorization code that the token exchange maps to `user`
    issueCode(user = GITHUB_USER_A) {
      const code = randomAlphanumeric(20);
      codes.set(code, user);
      issuedCodes.push(code);
      return code;
    },
    // The API answers 401 for this token from now on
    revokeToken(token) {
      revoked.add(token);
    },
    isRevoked(token) {
      return revoked.has(token);
    },
    // Status for the revocation endpoints (/token, and /grant if anything calls it)
    setRevokeStatus(status) {
      revokeStatus = status;
    },
    // Every API GET answers this status (null restores normal behaviour), optionally with
    // response headers and a message (B1.4: GitHub's rate-limit responses)
    failApiWith(status, { headers = {}, message = 'fake API failure' } = {}) {
      apiFailureStatus = status;
      apiFailureHeaders = status ? headers : {};
      apiFailureMessage = message;
    },
    // B1.4: every API GET waits this long before answering (0 restores normal behaviour)
    setApiDelay(ms) {
      apiDelayMs = ms;
    },
    requestsSince(index) {
      return requests.slice(index);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
