/**
 * Server settings read from the environment (B1.4): proxy trust, allowed origins,
 * rate limits, the GitHub timeout and the checks of every required setting.
 *
 * Each reader is tolerant (an invalid value falls back to the default) so module-level
 * code can always build the app; describeServerConfigProblems() reports every invalid
 * value, and startServer() refuses to start while any problem remains.
 * Problem strings name variables and reasons, never values.
 */

export const DEV_CLIENT_ORIGIN = 'http://localhost:5173';
export const GITHUB_CALLBACK_PATH = '/auth/github/callback';

// The placeholders shipped in server/.env.example
const GITHUB_PLACEHOLDERS = {
  GITHUB_CLIENT_ID: 'your-github-client-id',
  GITHUB_CLIENT_SECRET: 'your-github-client-secret'
};

const isProductionEnv = (env) => env.NODE_ENV === 'production';
const isSet = (value) => typeof value === 'string' && value.trim() !== '';

// Whole decimal integers only ("10", not "1e1", "0x10", "10.0" or " 10 ")
function parseInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

// ---------------------------------------------------------------------------
// TRUST_PROXY: the number of reverse proxies in front of the server (0-3).
// Never `true`: that would trust any X-Forwarded-For and let a client pick its own IP.

export const TRUST_PROXY_MAX = 3;

export function readTrustProxy(env = process.env) {
  const raw = env.TRUST_PROXY;
  if (raw === undefined || raw === '') return { value: 0, problem: null };
  const value = parseInteger(raw);
  if (value === null || value > TRUST_PROXY_MAX) {
    return { value: 0, problem: `TRUST_PROXY must be an integer from 0 to ${TRUST_PROXY_MAX} (the number of proxies in front of the server)` };
  }
  return { value, problem: null };
}

// ---------------------------------------------------------------------------
// Allowed browser origins, shared by Express CORS and Socket.IO

// "scheme://host[:port]" exactly as a browser sends it in the Origin header
function describeOriginProblem(value) {
  if (value.includes('*')) return 'must not contain a wildcard';
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'is not a valid origin';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must use http or https';
  if (url.origin !== value) {
    return 'must be exactly scheme://host[:port] (lower case, no path, query, trailing slash or default port)';
  }
  return null;
}

// CLIENT_URL's origin (always), CORS_ALLOWED_ORIGINS, and the Vite dev server outside production
export function readAllowedOrigins(env = process.env) {
  const origins = [];
  const problems = [];
  const add = (origin) => {
    if (!origins.includes(origin)) origins.push(origin);
  };

  if (isSet(env.CLIENT_URL)) {
    try {
      const url = new URL(env.CLIENT_URL);
      if (url.protocol === 'http:' || url.protocol === 'https:') add(url.origin);
    } catch {
      // reported by describeClientUrlProblem
    }
  }

  if (isSet(env.CORS_ALLOWED_ORIGINS)) {
    env.CORS_ALLOWED_ORIGINS.split(',').forEach((raw, index) => {
      const entry = raw.trim();
      if (entry === '') {
        problems.push(`CORS_ALLOWED_ORIGINS entry ${index + 1} is empty`);
        return;
      }
      const problem = describeOriginProblem(entry);
      if (problem) problems.push(`CORS_ALLOWED_ORIGINS entry ${index + 1} ${problem}`);
      else add(entry);
    });
  }

  if (!isProductionEnv(env)) add(DEV_CLIENT_ORIGIN);
  return { origins, problems };
}

// ---------------------------------------------------------------------------
// Rate limits. Windows are fixed; each count can be raised or lowered with
// RATE_LIMIT_<NAME>_MAX. Nothing switches limiting off.

export const RATE_LIMIT_MAX_UPPER = 100000;

export const RATE_LIMITS = Object.freeze([
  { name: 'preAuth', key: 'ip', windowMs: 5 * 60 * 1000, max: 300, message: 'Too many requests, please wait before trying again' },
  { name: 'user', key: 'user', windowMs: 60 * 1000, max: 120, message: 'Too many requests, please wait before trying again' },
  { name: 'githubProxy', key: 'user', windowMs: 60 * 1000, max: 60, message: 'Too many GitHub requests, please wait before trying again' },
  { name: 'clone', key: 'user', windowMs: 10 * 60 * 1000, max: 10, message: 'Too many clone requests, please wait before trying again' },
  { name: 'analysis', key: 'user', windowMs: 5 * 60 * 1000, max: 5, message: 'Too many analysis requests, please wait before trying again' },
  { name: 'oauth', key: 'ip', windowMs: 10 * 60 * 1000, max: 30, message: 'Too many requests, please wait before trying again' },
  { name: 'socketHandshake', key: 'ip', windowMs: 60 * 1000, max: 60, message: 'Too many connections, please wait before trying again' }
]);

export const rateLimitEnvName = (name) => `RATE_LIMIT_${name.toUpperCase()}_MAX`;

// { limits: { <name>: { ...definition, max } }, problems }
export function readRateLimits(env = process.env) {
  const limits = {};
  const problems = [];
  const known = new Set();
  for (const definition of RATE_LIMITS) {
    const envName = rateLimitEnvName(definition.name);
    known.add(envName);
    const raw = env[envName];
    let max = definition.max;
    if (raw !== undefined && raw !== '') {
      const value = parseInteger(raw);
      if (value === null || value < 1 || value > RATE_LIMIT_MAX_UPPER) {
        problems.push(`${envName} must be an integer from 1 to ${RATE_LIMIT_MAX_UPPER}`);
      } else {
        max = value;
      }
    }
    limits[definition.name] = { ...definition, max };
  }
  // A misspelt override would silently keep the default
  for (const name of Object.keys(env)) {
    if (/^RATE_LIMIT_.*_MAX$/.test(name) && !known.has(name)) {
      problems.push(`${name} is not a known rate limit (known: ${[...known].join(', ')})`);
    }
  }
  return { limits, problems };
}

const formatWindow = (ms) => (ms % 60000 === 0 ? `${ms / 60000} min` : `${ms / 1000} s`);
export const describeRateLimits = (limits) =>
  Object.values(limits).map((limit) => `${limit.name} ${limit.max} per ${formatWindow(limit.windowMs)}`).join(', ');

// ---------------------------------------------------------------------------
// GITHUB_TIMEOUT_MS: timeout of every GitHub API call except token revocation

export const DEFAULT_GITHUB_TIMEOUT_MS = 10000;
export const GITHUB_TIMEOUT_MIN_MS = 1000;
export const GITHUB_TIMEOUT_MAX_MS = 60000;

export function readGitHubTimeoutMs(env = process.env) {
  const raw = env.GITHUB_TIMEOUT_MS;
  if (raw === undefined || raw === '') return { value: DEFAULT_GITHUB_TIMEOUT_MS, problem: null };
  const value = parseInteger(raw);
  if (value === null || value < GITHUB_TIMEOUT_MIN_MS || value > GITHUB_TIMEOUT_MAX_MS) {
    return {
      value: DEFAULT_GITHUB_TIMEOUT_MS,
      problem: `GITHUB_TIMEOUT_MS must be an integer from ${GITHUB_TIMEOUT_MIN_MS} to ${GITHUB_TIMEOUT_MAX_MS}`
    };
  }
  return { value, problem: null };
}

// ---------------------------------------------------------------------------
// Required settings

// An absolute http(s) URL; https in production
function describeHttpUrlProblem(name, value, env) {
  if (!isSet(value)) return `${name} is not set`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a valid absolute URL`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${name} must use http or https`;
  if (isProductionEnv(env) && url.protocol !== 'https:') return `${name} must use https when NODE_ENV=production`;
  if (url.username || url.password) return `${name} must not contain credentials`;
  return { url };
}

export function describeClientUrlProblem(env = process.env) {
  const checked = describeHttpUrlProblem('CLIENT_URL', env.CLIENT_URL, env);
  if (typeof checked === 'string') return checked;
  // Used as an origin and as the base of /auth/success redirects
  if (checked.url.origin !== env.CLIENT_URL) {
    return 'CLIENT_URL must be an origin only: scheme://host[:port], with no path, query or trailing slash';
  }
  return null;
}

export function describeGitHubRedirectUriProblem(env = process.env) {
  const checked = describeHttpUrlProblem('GITHUB_REDIRECT_URI', env.GITHUB_REDIRECT_URI, env);
  if (typeof checked === 'string') return checked;
  if (checked.url.search || checked.url.hash) return 'GITHUB_REDIRECT_URI must not contain a query string or fragment';
  if (!checked.url.pathname.endsWith(GITHUB_CALLBACK_PATH)) {
    return `GITHUB_REDIRECT_URI must end in ${GITHUB_CALLBACK_PATH} (this server's OAuth callback)`;
  }
  return null;
}

export function describePortProblem(env = process.env) {
  const raw = typeof env.PORT === 'string' ? env.PORT.trim() : '';
  if (raw === '') return null;
  const value = parseInteger(raw);
  if (value === null || value < 1 || value > 65535) return 'PORT must be an integer from 1 to 65535';
  return null;
}

// Found before B1.4: a METRICS_TOKEN shorter than 32 characters silently left the
// endpoints disabled (404). It is now a startup error. An empty value means "not set".
export const METRICS_TOKEN_MIN_LENGTH = 32;
export function describeMetricsTokenProblem(env = process.env) {
  const value = env.METRICS_TOKEN;
  if (value === undefined || value === '') return null;
  if (value.length < METRICS_TOKEN_MIN_LENGTH) {
    return `METRICS_TOKEN must be at least ${METRICS_TOKEN_MIN_LENGTH} characters (or unset, which disables /api/metrics and /api/analytics)`;
  }
  return null;
}

// Test-only fault injection (test/faultInjection.js): accepted only under NODE_ENV=test,
// which only the test harness sets
export const FAULT_INJECTION_MODES = Object.freeze(['unhandled-rejection', 'uncaught-exception']);
export function describeFaultInjectionProblem(env = process.env) {
  const value = env.TEST_FAULT_INJECTION;
  if (value === undefined || value === '') return null;
  if (env.NODE_ENV !== 'test') return 'TEST_FAULT_INJECTION is a test-only setting and is refused unless NODE_ENV=test';
  if (!FAULT_INJECTION_MODES.includes(value)) return `TEST_FAULT_INJECTION must be one of: ${FAULT_INJECTION_MODES.join(', ')}`;
  return null;
}

// Every B1.4 check, in a fixed order. The existing Supabase, GitHub token store, AI,
// session store and database checks are added by startServer, with their own messages.
export function describeServerConfigProblems(env = process.env) {
  const problems = [];
  const push = (problem) => {
    if (problem) problems.push(problem);
  };
  push(describePortProblem(env));
  push(describeClientUrlProblem(env));
  for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
    if (!isSet(env[name])) push(`${name} is not set`);
    else if (env[name].trim() === GITHUB_PLACEHOLDERS[name]) push(`${name} is still the placeholder from .env.example`);
  }
  push(describeGitHubRedirectUriProblem(env));
  push(readTrustProxy(env).problem);
  problems.push(...readAllowedOrigins(env).problems);
  problems.push(...readRateLimits(env).problems);
  push(readGitHubTimeoutMs(env).problem);
  push(describeMetricsTokenProblem(env));
  push(describeFaultInjectionProblem(env));
  return problems;
}
