/**
 * Supabase identity verification
 *
 * Access tokens are verified by asking Supabase Auth (GET /auth/v1/user), which
 * works for both legacy HS256 and asymmetric signing keys. Local checks only
 * reject obviously bad tokens early; they never grant access.
 * Raw tokens are never logged or stored: the positive cache is keyed by SHA-256.
 */

import crypto from 'crypto';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 4096;

export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = code === 'AUTH_UNAVAILABLE' ? 503 : 401;
  }
}

const AUTH_RESPONSES = {
  AUTH_REQUIRED: { status: 401, body: { error: 'Authentication required', code: 'AUTH_REQUIRED' } },
  AUTH_UNAVAILABLE: { status: 503, body: { error: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' } }
};

const isLocalHostname = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1';

// Shared rule for service base URLs: https, or http only for localhost/127.0.0.1.
// Returns a reason string, or null when the URL is acceptable. Never includes the value.
export function describeServiceUrlProblem(value, { allowPath = false } = {}) {
  if (typeof value !== 'string' || !value) return 'is not set';
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'is not a valid URL';
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname))) {
    return 'must use https (http is allowed only for localhost or 127.0.0.1)';
  }
  if (url.username || url.password) return 'must not contain credentials';
  if (url.search || url.hash || value.includes('?') || value.includes('#')) {
    return 'must not contain a query string or fragment';
  }
  if (!allowPath && url.pathname !== '/') return 'must not contain a path';
  return null;
}

// Returns a short description of what is wrong with the Supabase configuration, or null
export function describeSupabaseConfigProblem(env = process.env) {
  const urlProblem = describeServiceUrlProblem(env.SUPABASE_URL);
  if (urlProblem) return `SUPABASE_URL ${urlProblem}`;
  if (typeof env.SUPABASE_ANON_KEY !== 'string' || env.SUPABASE_ANON_KEY.trim() === '') {
    return 'SUPABASE_ANON_KEY is not set';
  }
  return null;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function decodePayload(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function createSupabaseVerifier({
  supabaseUrl,
  anonKey,
  fetchImpl = fetch,
  cacheTtlMs = 60000,
  maxCacheEntries = 5000,
  maxConcurrent = 20,
  timeoutMs = 5000,
  now = Date.now
} = {}) {
  const baseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
  const issuerPrefix = `${baseUrl}/auth/v1`;
  const cache = new Map(); // sha256(token) -> { user, expiresAt }
  const inFlight = new Map(); // sha256(token) -> Promise<user>
  let activeLookups = 0;

  // Filters only: anything passing here still needs Supabase's confirmation
  function preCheck(token) {
    if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
      return null;
    }
    if (!TOKEN_SHAPE.test(token)) return null;
    const payload = decodePayload(token);
    if (!payload) return null;
    if (payload.exp !== undefined) {
      if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now()) return null;
    }
    if (payload.iss !== undefined) {
      if (typeof payload.iss !== 'string' || !payload.iss.startsWith(issuerPrefix)) return null;
    }
    return payload;
  }

  async function lookup(token) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      console.warn(`Supabase verification failed: ${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}`);
      throw new AuthError('AUTH_UNAVAILABLE');
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError('AUTH_REQUIRED');
    }
    if (response.status !== 200) {
      console.warn(`Supabase verification failed: HTTP ${response.status}`);
      throw new AuthError('AUTH_UNAVAILABLE');
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new AuthError('AUTH_UNAVAILABLE');
    }
    if (!body || typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) {
      console.warn('Supabase verification failed: malformed user response');
      throw new AuthError('AUTH_UNAVAILABLE');
    }
    return { id: body.id, email: typeof body.email === 'string' ? body.email : null };
  }

  function remember(key, user, payload) {
    const expiryFromToken = typeof payload.exp === 'number' ? payload.exp * 1000 : Infinity;
    const expiresAt = Math.min(now() + cacheTtlMs, expiryFromToken);
    if (expiresAt <= now()) return;
    cache.delete(key);
    cache.set(key, { user, expiresAt });
    while (cache.size > maxCacheEntries) {
      cache.delete(cache.keys().next().value);
    }
  }

  // Resolves with { id, email, expiresAt }, where expiresAt is the token's exp in ms (or null)
  async function verify(token) {
    const payload = preCheck(token);
    if (!payload) throw new AuthError('AUTH_REQUIRED');
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : null;

    const key = hashToken(token);
    const cached = cache.get(key);
    if (cached) {
      if (cached.expiresAt > now()) return { ...cached.user, expiresAt };
      cache.delete(key);
    }

    const pending = inFlight.get(key);
    if (pending) return { ...(await pending), expiresAt };

    if (activeLookups >= maxConcurrent) {
      throw new AuthError('AUTH_UNAVAILABLE');
    }

    activeLookups++;
    const promise = lookup(token);
    inFlight.set(key, promise);
    try {
      const user = await promise;
      remember(key, user, payload);
      return { ...user, expiresAt };
    } finally {
      activeLookups--;
      inFlight.delete(key);
    }
  }

  return {
    verify,
    // Test-only introspection: returns the cache keys (hashes), never tokens
    _cacheKeysForTest: () => [...cache.keys()]
  };
}

// Express middleware: requires a verified Supabase access token
export function requireUser(verifier) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;

    let user;
    try {
      user = await verifier.verify(token);
    } catch (error) {
      const code = error instanceof AuthError && error.code === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED';
      const { status, body } = AUTH_RESPONSES[code];
      return res.status(status).json(body);
    }

    req.user = { id: user.id, email: user.email };
    next();
  };
}
