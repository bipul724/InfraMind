/**
 * Analysis session store: SESSION_STORE=memory | database (required, no default).
 *
 * One async interface for both adapters. Sessions keep the shape the server used before
 * (camelCase keys, Date objects, fields absent rather than null until they are set, and
 * analysisResult once completed), so the sessionView serializers produce byte-identical
 * responses from either adapter.
 *
 * The database connection uses the table owner role, which RLS does not restrict: every
 * per-user read filters by user_id in the query itself (getOwned).
 * Nothing stored contains a filesystem path or AI prompt/response/error text.
 */

import crypto from 'crypto';
import { isUuidV4 } from './repository.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const AI_CALL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_FILE_CONTENT_LENGTH = 200000;
const QUERY_TIMEOUT_MS = 5000;
const MEMORY_AI_CALL_LIMIT = 1000;
const STORE_KINDS = ['memory', 'database'];
const STATUSES = ['cloning', 'cloned', 'analyzing', 'completed', 'failed'];
const IN_FLIGHT = ['cloning', 'analyzing'];
const CREATE_FIELDS = ['userId', 'owner', 'repo', 'fullName', 'repoName', 'displayUrl'];
const UPDATE_FIELDS = ['status', 'error', 'clonedAt', 'analysisStartedAt', 'completedAt'];
const OPTIONAL_FIELDS = ['error', 'clonedAt', 'analysisStartedAt', 'completedAt', 'lastProgress'];
const FILE_KIND_ORDER = ['dockerfile', 'githubActions', 'envExample'];

// isUuidV4 plus canonical (lowercase) form. Session ids are generated lowercase and
// Supabase user ids are lowercase; Postgres would match an uppercase uuid to the same
// row, while the memory adapter would not, so both treat it as invalid (no query).
const isId = (value) => isUuidV4(value) && value === value.toLowerCase();

export class SessionStoreUnavailableError extends Error {
  constructor() {
    super('Session store unavailable');
    this.name = 'SessionStoreUnavailableError';
    this.code = 'SESSION_STORE_UNAVAILABLE';
  }
}

// Startup validation of SESSION_STORE. Names the variable, never the value.
export function describeSessionStoreConfigProblem(env = process.env) {
  const kind = env.SESSION_STORE;
  if (typeof kind !== 'string' || kind.trim() === '') return 'SESSION_STORE is not set (use "memory" or "database")';
  if (!STORE_KINDS.includes(kind.trim())) return 'SESSION_STORE must be "memory" or "database"';
  return null;
}

// ---------------------------------------------------------------------------
// Shared validation

function pickCreateFields(fields) {
  if (!fields || typeof fields !== 'object') throw new TypeError('Invalid session fields');
  const picked = {};
  for (const key of CREATE_FIELDS) {
    if (typeof fields[key] !== 'string' || fields[key] === '') throw new TypeError(`Invalid session field: ${key}`);
    picked[key] = fields[key];
  }
  if (!isId(picked.userId)) throw new TypeError('Invalid session field: userId');
  return picked;
}

// Programming errors (unknown fields, bad values) throw TypeError
function checkPatch(patch) {
  if (!patch || typeof patch !== 'object') throw new TypeError('Invalid session patch');
  for (const key of Object.keys(patch)) {
    if (!UPDATE_FIELDS.includes(key)) throw new TypeError(`Session field cannot be updated: ${key}`);
  }
  if ('status' in patch && !STATUSES.includes(patch.status)) throw new TypeError('Invalid session status');
  for (const key of ['clonedAt', 'analysisStartedAt', 'completedAt']) {
    if (key in patch && !(patch[key] instanceof Date)) throw new TypeError(`Invalid session field: ${key}`);
  }
  if ('error' in patch && typeof patch.error !== 'string') throw new TypeError('Invalid session field: error');
}

// generatedFiles in a stable order: the three known kinds first, then any others by name
function orderedFiles(entries) {
  const rank = (kind) => {
    const index = FILE_KIND_ORDER.indexOf(kind);
    return index === -1 ? FILE_KIND_ORDER.length : index;
  };
  const sorted = [...entries].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  const files = {};
  for (const [kind, content] of sorted) files[kind] = content;
  return files;
}

// The string-valued entries of a pipeline result's generatedFiles
const fileEntriesOf = (generatedFiles) =>
  Object.entries(generatedFiles && typeof generatedFiles === 'object' ? generatedFiles : {})
    .filter(([, content]) => typeof content === 'string');

const intOrNull = (value) => (Number.isSafeInteger(value) ? value : null);
const shortText = (value, max = 200) => String(value ?? '').slice(0, max);

function toAiCallRow(record) {
  return {
    sessionId: isId(record?.sessionId) ? record.sessionId : null,
    userId: isId(record?.userId) ? record.userId : null,
    task: shortText(record?.task),
    provider: shortText(record?.provider),
    model: shortText(record?.model),
    outcome: shortText(record?.outcome),
    attempt: intOrNull(record?.attempt) ?? 0,
    httpStatus: intOrNull(record?.httpStatus),
    latencyMs: Math.max(0, intOrNull(Math.round(Number(record?.latencyMs))) ?? 0),
    inputTokens: intOrNull(record?.inputTokens),
    outputTokens: intOrNull(record?.outputTokens)
  };
}

// ---------------------------------------------------------------------------
// Memory adapter: the behaviour the server had before, behind the async interface

function createMemoryStore({ now }) {
  const sessions = new Map(); // id -> stored session (never handed out directly)
  const aiCalls = [];

  const copy = (session) => (session ? structuredClone(session) : null);

  return {
    kind: 'memory',

    async create(fields) {
      const picked = pickCreateFields(fields);
      const id = crypto.randomUUID();
      const createdAt = new Date(now());
      const session = {
        id,
        ...picked,
        status: 'cloning',
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS)
      };
      sessions.set(id, session);
      return copy(session);
    },

    async get(id) {
      if (!isId(id)) return null;
      return copy(sessions.get(id));
    },

    async getOwned(id, userId) {
      if (!isId(id) || !isId(userId)) return null;
      const session = sessions.get(id);
      return session && session.userId === userId ? copy(session) : null;
    },

    async update(id, patch) {
      checkPatch(patch);
      if (!isId(id)) return false;
      const session = sessions.get(id);
      if (!session) return false;
      Object.assign(session, structuredClone(patch), { updatedAt: new Date(now()) });
      return true;
    },

    async setLastProgress(id, payload) {
      if (!isId(id)) return false;
      const session = sessions.get(id);
      if (!session) return false;
      session.lastProgress = structuredClone(payload);
      session.updatedAt = new Date(now());
      return true;
    },

    async saveResult(id, result) {
      if (!isId(id)) return false;
      const session = sessions.get(id);
      if (!session) return false;
      const entries = fileEntriesOf(result?.generatedFiles);
      // Same limit as the database check constraint; nothing changes if it is exceeded
      if (entries.some(([, content]) => content.length > MAX_FILE_CONTENT_LENGTH)) {
        throw new SessionStoreUnavailableError();
      }
      const completedAt = new Date(now());
      Object.assign(session, {
        status: 'completed',
        completedAt,
        updatedAt: completedAt,
        messages: structuredClone(result?.messages ?? []),
        errors: structuredClone(result?.errors ?? []),
        analysisResult: {
          generatedFiles: orderedFiles(entries),
          techStack: structuredClone(result?.techStack ?? null),
          codebaseAnalysis: structuredClone(result?.codebaseAnalysis ?? null),
          verificationResults: typeof result?.verificationResults === 'string' ? result.verificationResults : undefined
        }
      });
      return true;
    },

    async markInFlightFailed(message) {
      let count = 0;
      for (const session of sessions.values()) {
        if (IN_FLIGHT.includes(session.status)) {
          session.status = 'failed';
          session.error = String(message);
          session.updatedAt = new Date(now());
          count++;
        }
      }
      return count;
    },

    async deleteExpired(at = new Date(now())) {
      const cutoff = at.getTime();
      const deleted = [];
      for (const [id, session] of sessions) {
        if (session.expiresAt.getTime() <= cutoff) {
          sessions.delete(id);
          deleted.push(id);
        }
      }
      for (const call of aiCalls) {
        if (call.sessionId && deleted.includes(call.sessionId)) call.sessionId = null;
      }
      const keep = aiCalls.filter((call) => call.createdAt.getTime() > cutoff - AI_CALL_RETENTION_MS);
      aiCalls.length = 0;
      aiCalls.push(...keep);
      return deleted;
    },

    async recordAiCall(record) {
      aiCalls.push({ ...toAiCallRow(record), createdAt: new Date(now()) });
      if (aiCalls.length > MEMORY_AI_CALL_LIMIT) aiCalls.splice(0, aiCalls.length - MEMORY_AI_CALL_LIMIT);
      return true;
    },

    // Test-only introspection: copies of the stored sessions and call rows
    _sessionsForTest: () => structuredClone([...sessions.values()]),
    _aiCallsForTest: () => structuredClone(aiCalls)
  };
}

// ---------------------------------------------------------------------------
// Database adapter (Prisma)

function createDatabaseStore({ prisma, jsonNull, now }) {
  if (!prisma) throw new TypeError('The database session store needs a Prisma client');
  if (jsonNull === undefined) throw new TypeError('The database session store needs Prisma.JsonNull');

  // Every database failure (including a timeout) becomes SessionStoreUnavailableError,
  // which carries no message, query or connection detail
  async function guarded(work) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), QUERY_TIMEOUT_MS);
    });
    try {
      return await Promise.race([work(), timeout]);
    } catch {
      throw new SessionStoreUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }

  // JSON columns: a JS null must be stored as JSON null explicitly
  const json = (value) => (value === null || value === undefined ? jsonNull : value);

  function toSession(row) {
    if (!row) return null;
    const session = {
      id: row.id,
      userId: row.userId,
      owner: row.owner,
      repo: row.repo,
      fullName: row.fullName,
      repoName: row.repoName,
      displayUrl: row.displayUrl,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt
    };
    // Absent until set, exactly as the in-memory session had them
    const optional = {
      error: row.error,
      clonedAt: row.clonedAt,
      analysisStartedAt: row.analysisStartedAt,
      completedAt: row.completedAt,
      lastProgress: row.lastProgress
    };
    for (const key of OPTIONAL_FIELDS) {
      if (optional[key] !== null && optional[key] !== undefined) session[key] = optional[key];
    }
    if (row.status === 'completed') {
      session.messages = row.messages ?? [];
      session.errors = row.errors ?? [];
      session.analysisResult = {
        generatedFiles: orderedFiles((row.files || []).map((file) => [file.kind, file.content])),
        techStack: row.techStack ?? null,
        codebaseAnalysis: row.codebaseAnalysis ?? null,
        verificationResults: row.verificationResults ?? undefined
      };
    }
    return session;
  }

  return {
    kind: 'database',

    async create(fields) {
      const picked = pickCreateFields(fields);
      const createdAt = new Date(now());
      const row = await guarded(() => prisma.analysisSession.create({
        data: {
          id: crypto.randomUUID(),
          ...picked,
          status: 'cloning',
          createdAt,
          updatedAt: createdAt,
          expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS)
        },
        include: { files: true }
      }));
      return toSession(row);
    },

    // Not user-scoped: only for server-side housekeeping (temp directory cleanup)
    async get(id) {
      if (!isId(id)) return null;
      return toSession(await guarded(() => prisma.analysisSession.findUnique({ where: { id }, include: { files: true } })));
    },

    // The owner check is part of the query: a foreign session is never loaded
    async getOwned(id, userId) {
      if (!isId(id) || !isId(userId)) return null;
      return toSession(await guarded(() => prisma.analysisSession.findFirst({ where: { id, userId }, include: { files: true } })));
    },

    async update(id, patch) {
      checkPatch(patch);
      if (!isId(id)) return false;
      const { count } = await guarded(() => prisma.analysisSession.updateMany({
        where: { id },
        data: { ...patch, updatedAt: new Date(now()) }
      }));
      return count > 0;
    },

    async setLastProgress(id, payload) {
      if (!isId(id)) return false;
      const { count } = await guarded(() => prisma.analysisSession.updateMany({
        where: { id },
        data: { lastProgress: json(payload), updatedAt: new Date(now()) }
      }));
      return count > 0;
    },

    // One transaction: the session is completed with all of its files, or not at all
    async saveResult(id, result) {
      if (!isId(id)) return false;
      const entries = fileEntriesOf(result?.generatedFiles);
      const completedAt = new Date(now());
      return guarded(() => prisma.$transaction(async (tx) => {
        const { count } = await tx.analysisSession.updateMany({
          where: { id },
          data: {
            status: 'completed',
            completedAt,
            updatedAt: completedAt,
            techStack: json(result?.techStack),
            codebaseAnalysis: json(result?.codebaseAnalysis),
            verificationResults: typeof result?.verificationResults === 'string' ? result.verificationResults : null,
            messages: json(result?.messages ?? []),
            errors: json(result?.errors ?? [])
          }
        });
        if (count === 0) return false;
        for (const [kind, content] of entries) {
          await tx.generatedFile.upsert({
            where: { sessionId_kind: { sessionId: id, kind } },
            create: { sessionId: id, kind, content },
            update: { content }
          });
        }
        return true;
      }, { maxWait: QUERY_TIMEOUT_MS, timeout: QUERY_TIMEOUT_MS }));
    },

    async markInFlightFailed(message) {
      const { count } = await guarded(() => prisma.analysisSession.updateMany({
        where: { status: { in: IN_FLIGHT } },
        data: { status: 'failed', error: String(message), updatedAt: new Date(now()) }
      }));
      return count;
    },

    async deleteExpired(at = new Date(now())) {
      const expired = await guarded(() => prisma.analysisSession.findMany({
        where: { expiresAt: { lte: at } },
        select: { id: true }
      }));
      const ids = expired.map((row) => row.id);
      if (ids.length > 0) {
        await guarded(() => prisma.analysisSession.deleteMany({ where: { id: { in: ids } } }));
      }
      await guarded(() => prisma.aiCall.deleteMany({
        where: { createdAt: { lt: new Date(at.getTime() - AI_CALL_RETENTION_MS) } }
      }));
      return ids;
    },

    async recordAiCall(record) {
      await guarded(() => prisma.aiCall.create({ data: { ...toAiCallRow(record), createdAt: new Date(now()) } }));
      return true;
    }
  };
}

export function createSessionStore({ kind, prisma, jsonNull, now = Date.now } = {}) {
  if (kind === 'memory') return createMemoryStore({ now });
  if (kind === 'database') return createDatabaseStore({ prisma, jsonNull, now });
  throw new TypeError('SESSION_STORE must be "memory" or "database"');
}
