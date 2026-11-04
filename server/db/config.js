/**
 * Database configuration: validation and pg pool settings. No Prisma import here,
 * so SESSION_STORE=memory never needs the generated client.
 *
 * TLS. The installed pg (8.23) treats sslmode=prefer|require|verify-ca as verify-full,
 * no-verify as "no certificate check", and disable (or no sslmode at all) as plaintext;
 * settings parsed from the connection string also override an explicit `ssl` option.
 * So the server removes every SSL parameter from DATABASE_URL and decides itself:
 *   - non-local hosts: TLS with certificate verification, always. DATABASE_SSL_CA_FILE
 *     adds a CA (Supabase's certificate is signed by Supabase's own CA).
 *     DATABASE_SSL_INSECURE_SKIP_VERIFY=true turns verification off, with a startup warning.
 *   - localhost / 127.0.0.1 / ::1: plaintext unless sslmode asks for TLS (local
 *     Postgres containers have no TLS).
 * Problems name variables, never values.
 */

import fs from 'fs';

export const LOCAL_DATABASE_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1']);
const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'sslaccept', 'sslidentity', 'sslnegotiation', 'uselibpqcompat'];
const TLS_SSLMODES = ['require', 'verify-ca', 'verify-full', 'prefer'];
const DEFAULT_POOL_MAX = 5;
export const DATABASE_TIMEOUT_MS = 5000;

const isSet = (value) => typeof value === 'string' && value.trim() !== '';

export function isLocalDatabaseHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return LOCAL_DATABASE_HOSTS.includes(host);
}

function parseDatabaseUrl(value) {
  if (!isSet(value)) return { problem: 'DATABASE_URL is not set' };
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { problem: 'DATABASE_URL is not a valid URL' };
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return { problem: 'DATABASE_URL must start with postgres:// or postgresql://' };
  }
  if (!url.hostname) return { problem: 'DATABASE_URL has no host' };
  return { url };
}

function parsePoolMax(env) {
  const raw = env.DATABASE_POOL_MAX;
  if (!isSet(raw)) return { value: DEFAULT_POOL_MAX };
  const trimmed = raw.trim();
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    return { problem: 'DATABASE_POOL_MAX must be an integer from 1 to 20' };
  }
  return { value };
}

const insecureSkipVerify = (env) => String(env.DATABASE_SSL_INSECURE_SKIP_VERIFY || '').trim() === 'true';

// Returns a description of the first problem with the database configuration, or null
export function describeDatabaseConfigProblem(env = process.env) {
  const { url, problem } = parseDatabaseUrl(env.DATABASE_URL);
  if (problem) return problem;
  const pool = parsePoolMax(env);
  if (pool.problem) return pool.problem;
  const sslmode = url.searchParams.get('sslmode');
  if (!isLocalDatabaseHost(url.hostname) && (sslmode === 'disable' || url.searchParams.get('ssl') === 'false')) {
    return 'DATABASE_URL must not disable TLS for a non-local database';
  }
  if (isSet(env.DATABASE_SSL_CA_FILE)) {
    try {
      fs.accessSync(env.DATABASE_SSL_CA_FILE.trim(), fs.constants.R_OK);
    } catch {
      return 'DATABASE_SSL_CA_FILE is not a readable file';
    }
  }
  const flag = env.DATABASE_SSL_INSECURE_SKIP_VERIFY;
  if (isSet(flag) && !['true', 'false'].includes(flag.trim())) {
    return 'DATABASE_SSL_INSECURE_SKIP_VERIFY must be true or false';
  }
  return null;
}

// Startup warning when certificate verification is turned off on purpose
export function describeDatabaseTlsWarning(env = process.env) {
  return insecureSkipVerify(env)
    ? 'DATABASE_SSL_INSECURE_SKIP_VERIFY=true: the database certificate is NOT verified. Use DATABASE_SSL_CA_FILE instead.'
    : null;
}

// pg Pool configuration for a validated environment. Throws (without the value) if invalid.
export function buildPoolConfig(env = process.env) {
  const problem = describeDatabaseConfigProblem(env);
  if (problem) throw new Error(problem);
  const { url } = parseDatabaseUrl(env.DATABASE_URL);
  const sslmode = url.searchParams.get('sslmode');
  for (const param of SSL_URL_PARAMS) url.searchParams.delete(param);

  let ssl = false;
  if (!isLocalDatabaseHost(url.hostname) || TLS_SSLMODES.includes(sslmode)) {
    ssl = { rejectUnauthorized: !insecureSkipVerify(env) };
    if (isSet(env.DATABASE_SSL_CA_FILE)) ssl.ca = fs.readFileSync(env.DATABASE_SSL_CA_FILE.trim(), 'utf8');
  }

  return {
    connectionString: url.toString(),
    ssl,
    max: parsePoolMax(env).value,
    connectionTimeoutMillis: DATABASE_TIMEOUT_MS,
    query_timeout: DATABASE_TIMEOUT_MS,
    statement_timeout: DATABASE_TIMEOUT_MS,
    idleTimeoutMillis: 30000
  };
}
