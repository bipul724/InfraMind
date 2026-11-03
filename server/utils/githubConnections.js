/**
 * Server-side GitHub connections
 *
 * A user's GitHub OAuth token is stored only here, keyed by their Supabase user id
 * and encrypted with AES-256-GCM. The additional authenticated data binds every
 * ciphertext to its user, so a record copied to another user cannot be decrypted.
 *
 * Adapters (GITHUB_TOKEN_STORE, required):
 * - memory:   encrypted rows in a Map; lost on every restart
 * - supabase: the github_connections table through PostgREST, using the service-role
 *             key. That key bypasses RLS, so it is used only in this module.
 *
 * Also provides the short-lived one-time stores for connect tickets and OAuth states.
 */

import crypto from 'crypto';
import { isUuidV4 } from './repository.js';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = 'v1';
const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const STORE_KINDS = ['memory', 'supabase'];
const TABLE_PATH = '/rest/v1/github_connections';
const SELECT_COLUMNS = 'github_user_id,github_login,github_name,github_avatar_url,scopes,token_ciphertext,connected_at';

export class StoreUnavailableError extends Error {
  constructor() {
    super('GitHub connection store unavailable');
    this.name = 'StoreUnavailableError';
    this.code = 'GITHUB_STORE_UNAVAILABLE';
  }
}

// ---------------------------------------------------------------------------
// Configuration

// Returns a reason string, or null when the value is a usable key. Never includes the value.
export function describeEncryptionKeyProblem(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'is not set';
  const trimmed = value.trim();
  if (trimmed.length % 4 !== 0 || !STANDARD_BASE64.test(trimmed)) return 'must be standard base64';
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.toString('base64') !== trimmed) return 'must be standard base64';
  if (decoded.length !== KEY_BYTES) return `must decode to exactly ${KEY_BYTES} bytes`;
  return null;
}

export function parseEncryptionKey(value) {
  const problem = describeEncryptionKeyProblem(value);
  if (problem) throw new Error(`GITHUB_TOKEN_ENC_KEY ${problem}`);
  return Buffer.from(value.trim(), 'base64');
}

// Startup validation of the store configuration. Names variables, never values.
export function describeConnectionStoreConfigProblem(env = process.env) {
  const kind = env.GITHUB_TOKEN_STORE;
  if (typeof kind !== 'string' || kind === '') return 'GITHUB_TOKEN_STORE is not set (use "memory" or "supabase")';
  if (!STORE_KINDS.includes(kind)) return 'GITHUB_TOKEN_STORE must be "memory" or "supabase"';
  const keyProblem = describeEncryptionKeyProblem(env.GITHUB_TOKEN_ENC_KEY);
  if (keyProblem) return `GITHUB_TOKEN_ENC_KEY ${keyProblem} (generate one with: openssl rand -base64 32)`;
  if (kind === 'supabase') {
    if (typeof env.SUPABASE_SERVICE_ROLE_KEY !== 'string' || env.SUPABASE_SERVICE_ROLE_KEY.trim() === '') {
      return 'SUPABASE_SERVICE_ROLE_KEY is not set (required when GITHUB_TOKEN_STORE=supabase)';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Encryption

const aadFor = (userId) => Buffer.from(`github_connections:${FORMAT_VERSION}:${userId}`, 'utf8');

export function encryptToken(key, userId, plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadFor(userId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

// Throws on any malformed, tampered or foreign ciphertext
export function decryptToken(key, userId, stored) {
  if (typeof stored !== 'string') throw new Error('unreadable ciphertext');
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) throw new Error('unreadable ciphertext');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error('unreadable ciphertext');
  }
  const decipher = crypto.createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aadFor(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Adapters: store rows shaped like the github_connections table

function createMemoryAdapter() {
  const rows = new Map(); // userId -> row (token encrypted)
  return {
    async getRow(userId) {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    async putRow(userId, row) {
      rows.set(userId, { ...row });
    },
    async deleteRow(userId) {
      rows.delete(userId);
    }
  };
}

function createSupabaseAdapter({ supabaseUrl, serviceRoleKey, fetchImpl, timeoutMs }) {
  const endpoint = `${String(supabaseUrl || '').replace(/\/+$/, '')}${TABLE_PATH}`;
  const baseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json'
  };

  async function send(url, { method, headers = {}, body } = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { ...baseHeaders, ...headers },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      console.warn(`GitHub connection store request failed: ${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}`);
      throw new StoreUnavailableError();
    }
    if (response.status < 200 || response.status >= 300) {
      console.warn(`GitHub connection store request failed: HTTP ${response.status}`);
      await response.text().catch(() => {});
      throw new StoreUnavailableError();
    }
    return response;
  }

  const filterFor = (userId) => `user_id=eq.${userId}`;

  return {
    async getRow(userId) {
      const response = await send(`${endpoint}?${filterFor(userId)}&select=${SELECT_COLUMNS}`, { method: 'GET' });
      let rows;
      try {
        rows = await response.json();
      } catch {
        console.warn('GitHub connection store request failed: malformed response');
        throw new StoreUnavailableError();
      }
      if (!Array.isArray(rows)) {
        console.warn('GitHub connection store request failed: malformed response');
        throw new StoreUnavailableError();
      }
      return rows.length > 0 ? rows[0] : null;
    },
    async putRow(userId, row) {
      const response = await send(`${endpoint}?on_conflict=user_id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, ...row, updated_at: new Date().toISOString() })
      });
      await response.text().catch(() => {});
    },
    async deleteRow(userId) {
      const response = await send(`${endpoint}?${filterFor(userId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      await response.text().catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------
// Store

function assertUserId(userId) {
  if (!isUuidV4(userId)) throw new TypeError('Invalid user id');
}

const optionalString = (value) => (typeof value === 'string' && value !== '' ? value : null);

function toRow(key, userId, record) {
  if (!record || typeof record !== 'object') throw new TypeError('Invalid GitHub connection record');
  const { githubUserId, login, accessToken } = record;
  if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0) throw new TypeError('Invalid GitHub user id');
  if (typeof login !== 'string' || login === '') throw new TypeError('Invalid GitHub login');
  if (typeof accessToken !== 'string' || accessToken === '') throw new TypeError('Invalid GitHub access token');

  const connectedAt = record.connectedAt instanceof Date ? record.connectedAt : new Date();
  return {
    github_user_id: githubUserId,
    github_login: login,
    github_name: optionalString(record.name),
    github_avatar_url: optionalString(record.avatarUrl),
    scopes: optionalString(record.scopes),
    token_ciphertext: encryptToken(key, userId, accessToken),
    connected_at: connectedAt.toISOString()
  };
}

function fromRow(row, accessToken) {
  return {
    githubUserId: Number(row.github_user_id),
    login: row.github_login,
    name: row.github_name ?? null,
    avatarUrl: row.github_avatar_url ?? null,
    scopes: row.scopes ?? null,
    accessToken,
    connectedAt: row.connected_at
  };
}

export function createConnectionStore({
  kind,
  encryptionKey,
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
  timeoutMs = 5000
} = {}) {
  const key = parseEncryptionKey(encryptionKey);
  let adapter;
  if (kind === 'memory') {
    adapter = createMemoryAdapter();
  } else if (kind === 'supabase') {
    if (typeof serviceRoleKey !== 'string' || serviceRoleKey.trim() === '') {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    }
    adapter = createSupabaseAdapter({ supabaseUrl, serviceRoleKey: serviceRoleKey.trim(), fetchImpl, timeoutMs });
  } else {
    throw new Error('GITHUB_TOKEN_STORE must be "memory" or "supabase"');
  }

  return {
    kind,

    // Returns the decrypted record, or null when there is none (or it is unreadable).
    // Throws StoreUnavailableError when the backing store cannot be reached.
    async get(userId) {
      assertUserId(userId);
      const row = await adapter.getRow(userId);
      if (!row) return null;
      let accessToken;
      try {
        accessToken = decryptToken(key, userId, row.token_ciphertext);
      } catch {
        console.warn(`github connection unreadable for user ${userId}`);
        await adapter.deleteRow(userId);
        return null;
      }
      return fromRow(row, accessToken);
    },

    async put(userId, record) {
      assertUserId(userId);
      await adapter.putRow(userId, toRow(key, userId, record));
    },

    async delete(userId) {
      assertUserId(userId);
      await adapter.deleteRow(userId);
    }
  };
}

export function createConnectionStoreFromEnv(env = process.env, options = {}) {
  return createConnectionStore({
    kind: env.GITHUB_TOKEN_STORE,
    encryptionKey: env.GITHUB_TOKEN_ENC_KEY,
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    ...options
  });
}

// ---------------------------------------------------------------------------
// One-time tokens (connect tickets, OAuth states, pending connect completions)

// Random 32-byte hex tokens mapped to a user id, optionally with a server-side payload.
// Each token can be consumed once. issue() returns null when the store is full of
// unexpired entries.
// - consume(token) returns only the user id (tickets and OAuth states).
// - consumeEntry(token) returns { userId, payload } (connect completions).
// - onExpire(entry) is called once for every entry removed because it expired, so
//   a payload holding a credential can be cleaned up (revoked). Errors it throws
//   are swallowed so one failure cannot stop the sweep.
export function createOneTimeTokenStore({ ttlMs, maxEntries = 1000, now = Date.now, onExpire = null } = {}) {
  const entries = new Map(); // token -> { userId, payload, expiresAt }

  function sweep() {
    const current = now();
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= current) {
        entries.delete(token);
        if (onExpire) {
          try {
            onExpire({ userId: entry.userId, payload: entry.payload, expiresAt: entry.expiresAt });
          } catch {
            // best effort
          }
        }
      }
    }
  }

  // Deletes the token whatever the outcome; returns its entry only if unexpired
  function take(token) {
    sweep();
    if (typeof token !== 'string' || token === '') return null;
    const entry = entries.get(token);
    if (!entry) return null;
    entries.delete(token);
    return entry.expiresAt > now() ? entry : null;
  }

  return {
    issue(userId, payload = undefined) {
      assertUserId(userId);
      sweep();
      if (entries.size >= maxEntries) return null;
      const token = crypto.randomBytes(32).toString('hex');
      entries.set(token, { userId, payload, expiresAt: now() + ttlMs });
      return token;
    },

    consume(token) {
      const entry = take(token);
      return entry ? entry.userId : null;
    },

    consumeEntry(token) {
      const entry = take(token);
      return entry ? { userId: entry.userId, payload: entry.payload } : null;
    },

    sweep,

    get size() {
      return entries.size;
    }
  };
}
