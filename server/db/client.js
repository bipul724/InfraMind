/**
 * Prisma client for the server's own tables (analysis_sessions, generated_files, ai_calls).
 *
 * One PrismaClient, created lazily from DATABASE_URL on first use (never at import, so
 * module evaluation order cannot matter), over the pg driver adapter with an explicit
 * pg Pool: pool size from DATABASE_POOL_MAX, 5 s connect/query timeouts, and the TLS
 * policy from db/config.js. Connection details never appear in logs or errors.
 */

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/index.js';
import { buildPoolConfig } from './config.js';

export { Prisma };

// A client over its own pool. Used by getPrisma() and by tests that seed databases.
export function createPrismaClient(env) {
  const pool = new pg.Pool(buildPoolConfig(env));
  // An idle connection that breaks (database restart, network cut) must not crash the
  // process; the pool drops it and the next query reconnects. Never log the error itself.
  pool.on('error', () => console.warn('database pool: an idle connection failed'));
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    async close() {
      await prisma.$disconnect().catch(() => {});
      await pool.end().catch(() => {});
    }
  };
}

let shared = null;

export function getPrisma() {
  if (!shared) shared = createPrismaClient(process.env);
  return shared.prisma;
}

export async function disconnectPrisma() {
  if (!shared) return;
  const current = shared;
  shared = null;
  await current.close();
}
