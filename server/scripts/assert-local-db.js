// Guard for `npm run db:migrate:dev`: refuses unless DATABASE_URL points at this machine.
//
// `prisma migrate dev` must never run against Supabase. Prisma owns only
// analysis_sessions, generated_files and ai_calls; saved_files and github_connections
// come from the Supabase SQL migrations and are not in schema.prisma. Against Supabase,
// migrate dev would report them (and Supabase's own schemas) as drift and offer to RESET
// the database, deleting every user's data. Use `npm run db:deploy` there instead.
//
// Exits 1 without connecting to anything. Never prints the URL.
import 'dotenv/config';
import { isLocalDatabaseHost } from '../db/config.js';

let hostname = '';
try {
  hostname = new URL(String(process.env.DATABASE_URL || '')).hostname;
} catch {
  // not a URL
}

if (!isLocalDatabaseHost(hostname)) {
  console.error('Refusing to run prisma migrate dev: DATABASE_URL must point at localhost, 127.0.0.1 or ::1.');
  console.error('migrate dev is for local development databases only; use npm run db:deploy for Supabase.');
  process.exit(1);
}
console.log('DATABASE_URL points at a local database: continuing with prisma migrate dev.');
