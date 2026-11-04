// Must stay the first import: ES modules are evaluated before this file's body runs,
// so .env has to be loaded before any imported module reads process.env
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { runAgentPipeline } from './agents/index.js';
import { AiConfigError, describeAiRoutes, loadAiConfig, logCallRecord, setDefaultAiCallSink } from './ai/index.js';
import {
  SessionStoreUnavailableError,
  createSessionStore,
  describeSessionStoreConfigProblem
} from './utils/sessionStore.js';
import { DATABASE_TIMEOUT_MS, describeDatabaseConfigProblem, describeDatabaseTlsWarning } from './db/config.js';
import GitHubService from './github.js';
import { logger } from './utils/logger.js';
import { rateLimiters, securityHeaders, requestLogger } from './utils/security.js';
import { performanceMonitor, getHealthStatus } from './utils/performance.js';
import {
  parseGitHubRepoUrl,
  parseRepositoryData,
  parseFullName,
  buildDisplayUrl,
  isUuidV4,
  resolveSessionClonePath,
  redactSecrets
} from './utils/repository.js';
import { cloneRepository, getCloneLimits, CloneError, CLONE_ERRORS } from './utils/git.js';
import { createSupabaseVerifier, describeSupabaseConfigProblem, requireUser } from './utils/auth.js';
import { attachRealtime } from './utils/realtime.js';
import { toStatusResponse, toFilesResponse } from './utils/sessionView.js';
import {
  StoreUnavailableError,
  createConnectionStoreFromEnv,
  createOneTimeTokenStore,
  describeConnectionStoreConfigProblem
} from './utils/githubConnections.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      process.env.CLIENT_URL,           // deployed frontend URL (e.g., https://yourapp.web.app)
      "http://localhost:5173",          // local development
      "https://dev-pilot.vercel.app"    // production frontend URL
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ['Content-Type', 'Authorization']
  }
});


const PORT = process.env.PORT || 3001;
const TEMP_DIR = path.join(process.cwd(), 'temp');

// One Supabase verifier shared by HTTP routes and Socket.IO.
// startServer() refuses to start when this configuration is invalid.
const verifier = createSupabaseVerifier({
  supabaseUrl: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY
});

// Middleware
app.use(cors({
  origin: [
    process.env.CLIENT_URL,           // deployed frontend URL
    "http://localhost:5173",          // local development
    "https://dev-pilot.vercel.app"    // production frontend URL
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Security headers
app.use(securityHeaders);

// Request logging
app.use(requestLogger);

// Performance monitoring
app.use(performanceMonitor.trackRequest.bind(performanceMonitor));

// Body parsing
// The largest legitimate body is repositoryData (about 2 kB)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// Analysis sessions live in the session store (SESSION_STORE=memory | database).
// startServer() validates the configuration and creates it before accepting requests.
let sessionStore = null;
let disconnectDatabase = null;

// Initialize temp directory
async function initializeTempDir() {
  try {
    await fs.ensureDir(TEMP_DIR);
    console.log(`✅ Temp directory initialized: ${TEMP_DIR}`);
  } catch (error) {
    console.error('❌ Failed to initialize temp directory:', error);
    // Continue anyway, create it later if needed
  }
}

// Socket.io: authenticated handshake, private per-session rooms
const { emitProgress } = attachRealtime(io, {
  verifier,
  getOwnedSession: (sessionId, userId) => sessionStore.getOwned(sessionId, userId),
  saveProgress: (sessionId, payload) => sessionStore.setLastProgress(sessionId, payload)
});

// Returns the session only if it exists and belongs to the authenticated user; the owner
// check is part of the store query. Unknown and foreign sessions are indistinguishable.
// Throws SessionStoreUnavailableError when the store cannot answer: never "not found".
async function getOwnedSession(req, sessionId) {
  if (!isUuidV4(sessionId) || !req.user?.id) return null;
  return sessionStore.getOwned(sessionId, req.user.id);
}

const sendSessionNotFound = (res) => res.status(404).json({ error: 'Session not found' });
const SESSION_STORE_UNAVAILABLE_BODY = { error: 'Session service unavailable', code: 'SESSION_STORE_UNAVAILABLE' };
const sendSessionStoreUnavailable = (res) => res.status(503).json(SESSION_STORE_UNAVAILABLE_BODY);
const isSessionStoreDown = (error) => error instanceof SessionStoreUnavailableError;

// API Routes

// Health check
app.get('/health', (req, res) => {
  try {
    const healthStatus = getHealthStatus();
    res.json(healthStatus);
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({ 
      status: 'unhealthy', 
      error: 'Health check failed',
      timestamp: new Date().toISOString() 
    });
  }
});

// Operator-only endpoints: enabled only when METRICS_TOKEN (32+ characters) is set,
// and then only for requests carrying a matching X-Metrics-Token header.
// Every other case is a 404 so the endpoints do not reveal that they exist.
function hasMetricsAccess(req) {
  const expected = process.env.METRICS_TOKEN;
  if (typeof expected !== 'string' || expected.length < 32) return false;
  const provided = req.get('x-metrics-token');
  if (typeof provided !== 'string') return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

const sendNotFound = (res) => res.status(404).json({ error: 'Not found' });

// Performance metrics endpoint
app.get('/api/metrics', (req, res) => {
  if (!hasMetricsAccess(req)) return sendNotFound(res);
  try {
    const metrics = performanceMonitor.getMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Metrics retrieval failed', error);
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

// Session analytics endpoint
app.get('/api/analytics', (req, res) => {
  if (!hasMetricsAccess(req)) return sendNotFound(res);
  try {
    const analytics = performanceMonitor.getSessionAnalytics();
    res.json(analytics);
  } catch (error) {
    logger.error('Analytics retrieval failed', error);
    res.status(500).json({ error: 'Failed to retrieve analytics' });
  }
});

// Every other /api/* route requires a verified Supabase access token
app.use('/api', requireUser(verifier));

// GitHub connections
//
// GitHub tokens never leave the server: they are stored encrypted, keyed by the
// Supabase user id (utils/githubConnections.js). startServer() validates the store
// configuration and creates the store before the server accepts requests.
let connectionStore = null;

const CONNECT_TICKET_TTL_MS = 2 * 60 * 1000; // 2 minutes
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PENDING_CONNECTS = 1000;

// One-time ticket from an authenticated POST /api/github/connect, consumed by /auth/github
const connectTickets = createOneTimeTokenStore({ ttlMs: CONNECT_TICKET_TTL_MS, maxEntries: MAX_PENDING_CONNECTS });
// OAuth state -> the Supabase user who started the flow, consumed by the callback
const pendingStates = createOneTimeTokenStore({ ttlMs: OAUTH_STATE_TTL_MS, maxEntries: MAX_PENDING_CONNECTS });

// Best-effort revocation of a single GitHub token. Logs only the outcome class,
// never the token or the request.
async function revokeQuietly(accessToken) {
  if (typeof accessToken !== 'string' || accessToken === '') return;
  const revocation = await GitHubService.revokeToken(accessToken);
  if (!revocation.ok) {
    const reason = typeof revocation.status === 'number' ? `HTTP ${revocation.status}` : revocation.status;
    console.warn(`token revocation failed: ${reason}`);
  }
}

// Completion lifetime. GITHUB_CONNECT_COMPLETION_TTL_MS exists so tests can use a short
// value; it is validated to 1000-300000 ms, so it can only shorten the 5-minute default.
const DEFAULT_COMPLETION_TTL_MS = 5 * 60 * 1000;
function readCompletionTtlMs() {
  const raw = process.env.GITHUB_CONNECT_COMPLETION_TTL_MS;
  if (raw === undefined || raw === '') return DEFAULT_COMPLETION_TTL_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1000 || value > DEFAULT_COMPLETION_TTL_MS) {
    console.warn(`⚠️ GITHUB_CONNECT_COMPLETION_TTL_MS must be an integer from 1000 to ${DEFAULT_COMPLETION_TTL_MS}; using the default`);
    return DEFAULT_COMPLETION_TTL_MS;
  }
  return value;
}

// Completion id -> { userId of the ticket owner, payload: { record } } from a finished
// OAuth callback. The record holds the plaintext token, in memory only, until the
// ticket owner claims it (POST /api/github/connect/complete). Expired entries are
// revoked at GitHub.
const COMPLETION_SWEEP_INTERVAL_MS = 60 * 1000;
const pendingCompletions = createOneTimeTokenStore({
  ttlMs: readCompletionTtlMs(),
  maxEntries: MAX_PENDING_CONNECTS,
  onExpire: (entry) => {
    console.log('github connect completion expired');
    void revokeQuietly(entry.payload?.record?.accessToken);
  }
});
setInterval(() => pendingCompletions.sweep(), COMPLETION_SWEEP_INTERVAL_MS).unref();

const COMPLETION_PATTERN = /^[0-9a-f]{64}$/i;
const readCompletion = (req) => {
  const completion = req.body?.completion;
  return typeof completion === 'string' && COMPLETION_PATTERN.test(completion) ? completion : null;
};

const GITHUB_AUTH_REQUIRED_BODY = { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' };
const GITHUB_AUTH_INVALID_BODY = { error: 'GitHub session is invalid or expired. Please reconnect GitHub.', code: 'GITHUB_AUTH_INVALID' };
const GITHUB_STORE_UNAVAILABLE_BODY = { error: 'GitHub connection service unavailable', code: 'GITHUB_STORE_UNAVAILABLE' };
const GITHUB_CONNECT_BUSY_BODY = { error: 'Too many pending GitHub connections. Please try again shortly.', code: 'GITHUB_CONNECT_BUSY' };
const INVALID_REQUEST_BODY = { error: 'Invalid request', code: 'INVALID_REQUEST' };
const GITHUB_CONNECT_EXPIRED_BODY = { error: 'The connection link expired. Please connect GitHub again.', code: 'GITHUB_CONNECT_EXPIRED' };
const GITHUB_CONNECT_MISMATCH_BODY = {
  error: 'This GitHub connection was started from a different InfraMind account. Nothing was connected. Please connect GitHub again.',
  code: 'GITHUB_CONNECT_MISMATCH'
};

const sendStoreUnavailable = (res) => res.status(503).json(GITHUB_STORE_UNAVAILABLE_BODY);

// Returns the decrypted connection of the signed-in user, or null after sending
// 401 GITHUB_AUTH_REQUIRED (no connection) or 503 (store unavailable).
// The token is looked up only by req.user.id; nothing from the request selects it.
async function getGitHubConnection(req, res) {
  let connection;
  try {
    connection = await connectionStore.get(req.user.id);
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      sendStoreUnavailable(res);
      return null;
    }
    throw error;
  }
  if (!connection) {
    res.status(401).json(GITHUB_AUTH_REQUIRED_BODY);
    return null;
  }
  return connection;
}

// GitHub rejected the stored token (revoked or expired): forget it, unless the user
// has meanwhile reconnected with a different token
async function dropRejectedConnection(userId, rejectedToken) {
  try {
    const current = await connectionStore.get(userId);
    if (current && current.accessToken === rejectedToken) {
      await connectionStore.delete(userId);
    }
  } catch (error) {
    console.error(`Could not remove a rejected GitHub connection: ${error instanceof StoreUnavailableError ? 'store unavailable' : 'unexpected error'}`);
  }
}

async function sendGitHubAuthInvalid(req, res, rejectedToken) {
  await dropRejectedConnection(req.user.id, rejectedToken);
  return res.status(401).json(GITHUB_AUTH_INVALID_BODY);
}

// GitHub OAuth Routes

// OAuth state cookie: HttpOnly, single-use, scoped to the /auth/github routes.
// Production frontends and backends sit on different sites, so use SameSite=None; Secure there.
const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_MAX_AGE_MS = OAUTH_STATE_TTL_MS;
const isProduction = process.env.NODE_ENV === 'production';
const oauthStateCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/auth/github'
};

const isValidOAuthState = (state, storedState) => {
  if (typeof state !== 'string' || typeof storedState !== 'string' || !state || !storedState) {
    return false;
  }
  const received = Buffer.from(state);
  const expected = Buffer.from(storedState);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
};

// The browser lands on /auth/success with a status or an error code, never a token
const redirectToClient = (res, query) => res.redirect(`${process.env.CLIENT_URL}/auth/success?${query}`);
const redirectWithError = (res, code) => redirectToClient(res, `error=${code}`);

// Step 1 (authenticated): issue a one-time ticket that starts a connect flow for this user
app.post('/api/github/connect', (req, res) => {
  const ticket = connectTickets.issue(req.user.id);
  if (!ticket) {
    return res.status(503).json(GITHUB_CONNECT_BUSY_BODY);
  }
  res.set('Cache-Control', 'no-store');
  res.json({ ticket });
});

// Step 2: initiate GitHub OAuth. The browser navigates here (top-level), so the state
// cookie is first-party and survives browsers that block third-party cookies.
// Only a valid, unexpired ticket can start a flow; it is consumed on every outcome.
app.get('/auth/github', (req, res) => {
  try {
    const userId = connectTickets.consume(req.query.ticket);
    if (!userId) {
      return redirectWithError(res, 'connect_expired');
    }

    // CSRF protection, bound server-side to the user who obtained the ticket
    const state = pendingStates.issue(userId);
    if (!state) {
      return redirectWithError(res, 'github_auth_failed');
    }
    const authUrl = GitHubService.getAuthURL(state);
    
    res.cookie(OAUTH_STATE_COOKIE, state, { ...oauthStateCookieOptions, maxAge: OAUTH_STATE_MAX_AGE_MS });
    
    res.redirect(authUrl);
  } catch (error) {
    console.error('GitHub OAuth initiation error:', error.message);
    redirectWithError(res, 'github_auth_failed');
  }
});

// Step 3: GitHub OAuth callback. Stores nothing: the browser finishing the flow may not
// belong to the user who obtained the ticket (linking CSRF). The result is parked under
// a one-time completion id that only the ticket owner can claim (step 4).
app.get('/auth/github/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const storedState = req.cookies?.[OAUTH_STATE_COOKIE];
  
  // The state is single-use: clear the cookie and consume the pending state
  // whether or not validation succeeds
  res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions);
  const userId = pendingStates.consume(typeof state === 'string' ? state : undefined);
  
  // Verify state to prevent CSRF attacks
  if (!isValidOAuthState(state, storedState) || !userId) {
    return redirectWithError(res, 'invalid_state');
  }

  if (oauthError !== undefined) {
    return redirectWithError(res, oauthError === 'access_denied' ? 'access_denied' : 'github_auth_failed');
  }
  
  if (typeof code !== 'string' || !code) {
    return redirectWithError(res, 'github_auth_failed');
  }
  
  let accessToken = null;
  try {
    // Exchange code for access token
    const exchanged = await GitHubService.getAccessToken(code);
    accessToken = exchanged.accessToken;
    
    // Get user information
    const userInfo = await GitHubService.getUserInfo(accessToken);
    
    const record = {
      githubUserId: userInfo.id,
      login: userInfo.login,
      name: userInfo.name,
      avatarUrl: userInfo.avatar_url,
      scopes: exchanged.scope,
      accessToken,
      connectedAt: new Date()
    };
    const completion = pendingCompletions.issue(userId, { record });
    if (!completion) {
      console.warn('GitHub OAuth callback error: too many pending connect completions');
      await revokeQuietly(accessToken);
      return redirectWithError(res, 'github_auth_failed');
    }
    
    // Only the completion id travels to the browser; no token or JWT
    redirectToClient(res, `complete=${completion}`);
    
  } catch (error) {
    console.error(`GitHub OAuth callback error: ${error.message}`);
    // A token issued before the failure is never used: revoke it
    await revokeQuietly(accessToken);
    redirectWithError(res, 'github_auth_failed');
  }
});

// Step 4 (authenticated): claim a completion. The only place a connection is stored,
// and only for the user who obtained the ticket. Every other outcome discards the
// result, and a token that will not be stored is revoked.
app.post('/api/github/connect/complete', async (req, res) => {
  const completion = readCompletion(req);
  if (!completion) {
    return res.status(400).json(INVALID_REQUEST_BODY);
  }

  // Single use: consumed whatever happens next
  const entry = pendingCompletions.consumeEntry(completion);
  if (!entry) {
    return res.status(400).json(GITHUB_CONNECT_EXPIRED_BODY);
  }
  const { record } = entry.payload;

  if (entry.userId !== req.user.id) {
    await revokeQuietly(record.accessToken);
    console.warn('github connect completion refused: account mismatch');
    return res.status(403).json(GITHUB_CONNECT_MISMATCH_BODY);
  }

  let previous;
  try {
    previous = await connectionStore.get(req.user.id);
    await connectionStore.put(req.user.id, record);
  } catch (error) {
    await revokeQuietly(record.accessToken);
    if (error instanceof StoreUnavailableError) return sendStoreUnavailable(res);
    console.error(`GitHub connect completion error: ${redactSecrets(error, [record.accessToken])}`);
    return res.status(500).json({ error: 'Failed to connect GitHub' });
  }

  // Reconnecting replaced an older token: it is no longer used anywhere
  if (previous && previous.accessToken !== record.accessToken) {
    await revokeQuietly(previous.accessToken);
  }

  res.set('Cache-Control', 'no-store');
  res.json({ connected: true, user: { login: record.login, name: record.name ?? null, avatarUrl: record.avatarUrl ?? null } });
});

// Public: lets the page burn a completion when nobody is signed in. Always 204, and the
// revocation runs in the background, so the response never reveals whether the id existed.
app.post('/auth/github/discard', (req, res) => {
  const completion = readCompletion(req);
  if (completion) {
    const entry = pendingCompletions.consumeEntry(completion);
    if (entry) void revokeQuietly(entry.payload?.record?.accessToken);
  }
  res.status(204).end();
});

// Connection status for the signed-in user. Makes no GitHub API call.
app.get('/api/github/status', async (req, res) => {
  try {
    const connection = await connectionStore.get(req.user.id);
    if (!connection) {
      return res.json({ connected: false });
    }
    res.json({
      connected: true,
      user: { login: connection.login, name: connection.name, avatarUrl: connection.avatarUrl },
      connectedAt: connection.connectedAt
    });
  } catch (error) {
    if (error instanceof StoreUnavailableError) return sendStoreUnavailable(res);
    console.error(`GitHub status error: ${redactSecrets(error)}`);
    res.status(500).json({ error: 'Failed to read GitHub connection' });
  }
});

// Disconnect: revoke the token at GitHub (best effort), then always forget it
app.delete('/api/github/connection', async (req, res) => {
  try {
    const connection = await connectionStore.get(req.user.id);
    if (connection) {
      await revokeQuietly(connection.accessToken);
      await connectionStore.delete(req.user.id);
    }
    res.status(204).end();
  } catch (error) {
    if (error instanceof StoreUnavailableError) return sendStoreUnavailable(res);
    console.error(`GitHub disconnect error: ${redactSecrets(error)}`);
    res.status(500).json({ error: 'Failed to disconnect GitHub' });
  }
});

// Get user repositories
app.get('/api/github/repositories', async (req, res) => {
  let connection;
  try {
    connection = await getGitHubConnection(req, res);
    if (!connection) return;
    const { page = 1, per_page = 50 } = req.query;
    
    // Get user repositories
    const repositories = await GitHubService.getUserRepositories(
      connection.accessToken, 
      parseInt(page), 
      parseInt(per_page)
    );
    
    // Get organizations
    const organizations = await GitHubService.getUserOrganizations(connection.accessToken);
    
    res.json({
      user: {
        login: connection.login,
        name: connection.name,
        avatarUrl: connection.avatarUrl
      },
      repositories,
      organizations,
      pagination: {
        page: parseInt(page),
        per_page: parseInt(per_page),
        has_more: repositories.length === parseInt(per_page)
      }
    });
    
  } catch (error) {
    if (error.code === 'GITHUB_UNAUTHORIZED') {
      return sendGitHubAuthInvalid(req, res, connection?.accessToken);
    }
    console.error(`Get repositories error: ${redactSecrets(error, [connection?.accessToken])}`);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// Get organization repositories
app.get('/api/github/organizations/:org/repositories', async (req, res) => {
  let connection;
  try {
    connection = await getGitHubConnection(req, res);
    if (!connection) return;
    const { org } = req.params;
    const { page = 1, per_page = 50 } = req.query;
    
    const repositories = await GitHubService.getOrgRepositories(
      connection.accessToken, 
      org, 
      parseInt(page), 
      parseInt(per_page)
    );
    
    res.json({
      organization: org,
      repositories,
      pagination: {
        page: parseInt(page),
        per_page: parseInt(per_page),
        has_more: repositories.length === parseInt(per_page)
      }
    });
    
  } catch (error) {
    if (error.code === 'GITHUB_UNAUTHORIZED') {
      return sendGitHubAuthInvalid(req, res, connection?.accessToken);
    }
    console.error(`Get org repositories error: ${redactSecrets(error, [connection?.accessToken])}`);
    res.status(500).json({ error: 'Failed to fetch organization repositories' });
  }
});

// Verify user access to repository
app.post('/api/github/verify-repo', async (req, res) => {
  let connection;
  try {
    connection = await getGitHubConnection(req, res);
    if (!connection) return;
    const { owner, repo } = req.body;
    
    if (!owner || !repo) {
      return res.status(400).json({ error: 'Owner and repository name are required' });
    }
    
    const accessResult = await GitHubService.checkRepoAccess(connection.accessToken, owner, repo);
    
    res.json(accessResult);
    
  } catch (error) {
    if (error.code === 'GITHUB_UNAUTHORIZED') {
      return sendGitHubAuthInvalid(req, res, connection?.accessToken);
    }
    console.error(`Verify repo access error: ${redactSecrets(error, [connection?.accessToken])}`);
    res.status(500).json({ error: 'Failed to verify repository access' });
  }
});

// Clone repository endpoint
// GitHub tokens are used only for the duration of this request: they are never stored
// in the session, embedded in a URL, returned, logged or passed to the agents.
const GITHUB_TOKEN_PATTERN = /^[A-Za-z0-9_]{1,255}$/;
const isAbsent = (value) => value === undefined || value === null;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const sendCloneError = (res, code) => {
  const { status, publicMessage } = CLONE_ERRORS[code];
  return res.status(status).json({ error: publicMessage, code });
};

async function handleCloneRequest(req, res) {
  const { repoUrl, repositoryData } = req.body || {};
  // The UI sends an empty string when no token was entered
  const authToken = req.body?.authToken === '' ? undefined : req.body?.authToken;

  // Input shape checks. Never echo submitted values back.
  if (!isAbsent(repoUrl) && typeof repoUrl !== 'string') {
    return res.status(400).json({ error: 'Invalid GitHub repository URL' });
  }
  if (!isAbsent(repositoryData) && !isPlainObject(repositoryData)) {
    return res.status(400).json({ error: 'Invalid repository data' });
  }
  if (!isAbsent(authToken) && (typeof authToken !== 'string' || !GITHUB_TOKEN_PATTERN.test(authToken))) {
    return res.status(400).json({ error: 'Invalid GitHub token format' });
  }

  const { maxSizeBytes } = getCloneLimits();
  let identity;
  let token = null;

  if (!isAbsent(repositoryData)) {
    // User selected from their GitHub repositories (takes precedence over repoUrl).
    // Validate the input before touching the store or GitHub.
    const requested = parseRepositoryData(repositoryData);
    if (!requested) {
      return res.status(400).json({ error: 'Invalid repository data' });
    }

    const connection = await getGitHubConnection(req, res);
    if (!connection) return;

    const accessToken = connection.accessToken;
    if (typeof accessToken !== 'string' || !GITHUB_TOKEN_PATTERN.test(accessToken)) {
      return sendGitHubAuthInvalid(req, res, accessToken);
    }

    let access;
    try {
      access = await GitHubService.checkRepoAccess(accessToken, requested.owner, requested.repo);
    } catch (error) {
      if (error.code === 'GITHUB_UNAUTHORIZED') {
        return sendGitHubAuthInvalid(req, res, accessToken);
      }
      console.error(`Clone access check failed: ${redactSecrets(error.message, [accessToken])}`);
      return sendCloneError(res, 'CLONE_FAILED');
    }

    if (!access.hasAccess) {
      return sendCloneError(res, 'REPO_NOT_FOUND');
    }

    // Use GitHub's canonical name from here on, re-validated
    identity = parseFullName(access.repo?.fullName);
    if (!identity) {
      return sendCloneError(res, 'CLONE_FAILED');
    }
    if (Number.isFinite(access.repo.size) && access.repo.size * 1024 > maxSizeBytes) {
      return sendCloneError(res, 'REPO_TOO_LARGE');
    }

    token = accessToken;
  } else if (!isAbsent(repoUrl)) {
    // Manual URL input
    identity = parseGitHubRepoUrl(repoUrl);
    if (!identity) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }
    token = authToken || null;
  } else {
    return res.status(400).json({ error: 'Repository URL or repository data is required' });
  }

  const fullName = `${identity.owner}/${identity.repo}`;

  // Create the session (no credentials, no client-supplied URLs, no filesystem path)
  let session;
  try {
    session = await sessionStore.create({
      userId: req.user.id,
      owner: identity.owner,
      repo: identity.repo,
      fullName,
      repoName: identity.repo,
      displayUrl: buildDisplayUrl(identity)
    });
  } catch (error) {
    if (isSessionStoreDown(error)) return sendSessionStoreUnavailable(res);
    throw error;
  }
  const sessionId = session.id;
  const clonePath = resolveSessionClonePath(TEMP_DIR, sessionId);

  emitProgress(sessionId, {
    step: 'Cloning repository...',
    progress: 10,
    status: 'cloning'
  });

  try {
    await cloneRepository({
      owner: identity.owner,
      repo: identity.repo,
      token,
      destination: clonePath,
      maxSizeBytes
    });
  } catch (error) {
    const cloneError = error instanceof CloneError ? error : new CloneError('CLONE_FAILED');
    const details = error instanceof CloneError ? error.details : error;

    await fs.remove(path.dirname(clonePath)).catch(() => {});
    try {
      await sessionStore.update(sessionId, { status: 'failed', error: cloneError.publicMessage });
    } catch (storeError) {
      if (!isSessionStoreDown(storeError)) throw storeError;
      console.error(`Clone failed and the session could not be updated: session=${sessionId}`);
    }

    emitProgress(sessionId, {
      step: 'Clone failed',
      progress: 0,
      status: 'failed',
      error: cloneError.publicMessage
    });

    console.error(`Clone failed [${cloneError.code}] session=${sessionId} repo=${fullName}: ${redactSecrets(details, [token])}`);
    return sendCloneError(res, cloneError.code);
  }

  try {
    await sessionStore.update(sessionId, { status: 'cloned', clonedAt: new Date() });
  } catch (error) {
    if (!isSessionStoreDown(error)) throw error;
    await fs.remove(path.dirname(clonePath)).catch(() => {});
    return sendSessionStoreUnavailable(res);
  }

  emitProgress(sessionId, {
    step: 'Repository cloned successfully',
    progress: 25,
    status: 'cloned'
  });

  res.json({
    success: true,
    sessionId,
    message: '✅ Repo Cloned Successfully',
    repoName: identity.repo
  });
}

app.post('/api/clone-repo', rateLimiters.clone, async (req, res) => {
  try {
    await handleCloneRequest(req, res);
  } catch (error) {
    console.error(`Clone request error: ${redactSecrets(error)}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to clone repository' });
    }
  }
});

// Analyze repository endpoint
app.post('/api/analyze', rateLimiters.analysis, async (req, res) => {
  const { sessionId } = req.body || {};
  let session = null;
  try {
    // Ownership first, so a non-owner never learns the session's status
    session = await getOwnedSession(req, sessionId);
  } catch (error) {
    if (isSessionStoreDown(error)) return sendSessionStoreUnavailable(res);
    console.error(`Analysis error: ${redactSecrets(error)}`);
    return res.status(500).json({ error: 'Analysis failed' });
  }
  if (!session) {
    return sendSessionNotFound(res);
  }
  if (session.status !== 'cloned') {
    return res.status(400).json({ error: 'Repository not ready for analysis' });
  }

  const markFailed = async () => {
    try {
      await sessionStore.update(sessionId, { status: 'failed', error: 'Analysis failed' });
    } catch {
      console.error(`Could not mark the session failed: session=${sessionId}`);
    }
    emitProgress(sessionId, {
      step: 'Analysis failed',
      progress: 0,
      status: 'failed',
      error: 'Analysis failed'
    });
  };

  try {
    try {
      await sessionStore.update(sessionId, { status: 'analyzing', analysisStartedAt: new Date() });
    } catch (error) {
      if (isSessionStoreDown(error)) return sendSessionStoreUnavailable(res);
      throw error;
    }
    
    emitProgress(sessionId, {
      step: 'Starting AI agent analysis...',
      progress: 30,
      status: 'analyzing'
    });
    
    // Run the AI agent pipeline
    const progressCallback = (data) => {
      emitProgress(sessionId, {
        step: data.step,
        progress: data.progress,
        messages: data.messages,
        errors: data.errors,
        status: 'analyzing'
      });
    };
    
    const result = await runAgentPipeline(
      session.fullName,
      resolveSessionClonePath(TEMP_DIR, sessionId),
      progressCallback,
      { sessionId, userId: req.user.id }
    );
    
    // Store analysis results: the session and its files, in one transaction
    try {
      await sessionStore.saveResult(sessionId, result);
    } catch (error) {
      if (!isSessionStoreDown(error)) throw error;
      console.error(`Analysis results could not be saved: session=${sessionId}`);
      await markFailed();
      return sendSessionStoreUnavailable(res);
    }
    
    emitProgress(sessionId, {
      step: 'Analysis complete!',
      progress: 100,
      status: 'completed',
      techStack: result.techStack,
      generatedFiles: Object.keys(result.generatedFiles)
    });
    
    res.json({
      success: true,
      sessionId,
      techStack: result.techStack,
      codebaseAnalysis: result.codebaseAnalysis,
      generatedFiles: Object.keys(result.generatedFiles),
      messages: result.messages
    });
    
  } catch (error) {
    console.error(`Analysis error: ${redactSecrets(error)}`);
    await markFailed();
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Get generated files endpoint
app.get('/api/files/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await getOwnedSession(req, sessionId);
    if (!session) {
      return sendSessionNotFound(res);
    }
    
    if (session.status !== 'completed' || !session.analysisResult) {
      return res.status(400).json({ error: 'Analysis not completed' });
    }
    
    res.json(toFilesResponse(session));
    
  } catch (error) {
    if (isSessionStoreDown(error)) return sendSessionStoreUnavailable(res);
    console.error(`Files retrieval error: ${redactSecrets(error)}`);
    res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

// Download individual file endpoint
app.get('/api/files/:sessionId/:filename', async (req, res) => {
  try {
    const { sessionId, filename } = req.params;
    
    const session = await getOwnedSession(req, sessionId);
    if (!session) {
      return sendSessionNotFound(res);
    }
    
    if (session.status !== 'completed' || !session.analysisResult) {
      return res.status(400).json({ error: 'Analysis not completed' });
    }
    
    const { generatedFiles } = session.analysisResult;
    
    if (!generatedFiles[filename]) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const fileContent = generatedFiles[filename];
    const contentType = getContentType(filename);
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
    res.send(fileContent);
    
  } catch (error) {
    if (isSessionStoreDown(error)) return sendSessionStoreUnavailable(res);
    console.error(`File download error: ${redactSecrets(error)}`);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Helper function to determine content type
function getContentType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'yml':
    case 'yaml':
      return 'application/x-yaml';
    case 'json':
      return 'application/json';
    case 'md':
      return 'text/markdown';
    case 'dockerfile':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}

// Get session status endpoint
app.get('/api/status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await getOwnedSession(req, sessionId);
    if (!session) {
      return sendSessionNotFound(res);
    }
    
    res.json(toStatusResponse(sessionId, session));
    
  } catch (error) {
    if (isSessionStoreDown(error)) return sendSessionStoreUnavailable(res);
    console.error(`Status retrieval error: ${redactSecrets(error)}`);
    res.status(500).json({ error: 'Failed to retrieve status' });
  }
});

// Removes temp/<id> directories of deleted sessions and orphans (no session row, e.g.
// left by a crash). Only directories directly under TEMP_DIR whose names are UUID v4
// are considered; symlinks and anything else are never touched. A directory whose
// session cannot be looked up (store unavailable) is kept.
async function removeSessionDirectories(deletedIds = []) {
  let entries;
  try {
    entries = await fs.readdir(TEMP_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }
  const deleted = new Set(deletedIds);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isUuidV4(entry.name)) continue;
    let remove = deleted.has(entry.name);
    if (!remove) {
      try {
        remove = !(await sessionStore.get(entry.name));
      } catch {
        continue;
      }
    }
    if (remove) {
      await fs.remove(path.join(TEMP_DIR, entry.name)).then(() => { removed++; }, () => {});
    }
  }
  return removed;
}

async function cleanupExpiredSessions() {
  const deletedIds = await sessionStore.deleteExpired(new Date());
  const removedDirectories = await removeSessionDirectories(deletedIds);
  return { deletedSessions: deletedIds.length, removedDirectories };
}

// Error handling middleware
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  console.error(`Unhandled error: ${redactSecrets(err)}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Add global error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
async function startServer() {
  // Refuse to start without a usable Supabase configuration: every /api route depends on it
  const supabaseProblem = describeSupabaseConfigProblem(process.env);
  if (supabaseProblem) {
    console.error(`❌ ${supabaseProblem}. Set SUPABASE_URL (https://<project>.supabase.co) and SUPABASE_ANON_KEY.`);
    process.exit(1);
  }

  // Refuse to start without an explicit, valid GitHub token store and encryption key
  const storeProblem = describeConnectionStoreConfigProblem(process.env);
  if (storeProblem) {
    console.error(`❌ ${storeProblem}.`);
    process.exit(1);
  }
  connectionStore = createConnectionStoreFromEnv(process.env);
  if (connectionStore.kind === 'memory' && isProduction) {
    console.warn('⚠️ GITHUB_TOKEN_STORE=memory: GitHub connections are lost on every restart. Use "supabase" in production.');
  }

  // Refuse to start without a valid AI provider configuration. Problems name variables only.
  let aiConfig;
  try {
    aiConfig = loadAiConfig(process.env);
  } catch (error) {
    if (!(error instanceof AiConfigError)) throw error;
    for (const problem of error.problems) console.error(`❌ ${problem}`);
    process.exit(1);
  }
  // Provider names and model IDs only; keys and URLs are never printed
  for (const line of describeAiRoutes(aiConfig)) console.log(`🤖 ${line}`);

  // 1. Session store configuration. Names variables, never values.
  const sessionStoreProblem = describeSessionStoreConfigProblem(process.env);
  if (sessionStoreProblem) {
    console.error(`❌ ${sessionStoreProblem}.`);
    process.exit(1);
  }
  if (process.env.SESSION_STORE.trim() === 'database') {
    const databaseProblem = describeDatabaseConfigProblem(process.env);
    if (databaseProblem) {
      console.error(`❌ ${databaseProblem}.`);
      process.exit(1);
    }
    const tlsWarning = describeDatabaseTlsWarning(process.env);
    if (tlsWarning) console.warn(`⚠️ ${tlsWarning}`);

    let db;
    try {
      db = await import('./db/client.js');
    } catch {
      console.error('❌ Prisma client not generated: run npm run db:generate');
      process.exit(1);
    }
    disconnectDatabase = db.disconnectPrisma;
    const prisma = db.getPrisma();
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DATABASE_TIMEOUT_MS).unref())
    ]);

    // 2. Connectivity, then the schema. Never print the URL, host or password.
    try {
      await withTimeout(prisma.$queryRaw`select 1`);
    } catch {
      console.error('❌ Database unreachable (DATABASE_URL)');
      await disconnectDatabase();
      process.exit(1);
    }
    try {
      await withTimeout(prisma.analysisSession.findFirst({ select: { id: true } }));
    } catch (error) {
      console.error(error?.code === 'P2021'
        ? '❌ Database schema missing: run npm run db:deploy'
        : '❌ Database unreachable (DATABASE_URL)');
      await disconnectDatabase();
      process.exit(1);
    }
    sessionStore = createSessionStore({ kind: 'database', prisma, jsonNull: db.Prisma.JsonNull });
  } else {
    sessionStore = createSessionStore({ kind: 'memory' });
    // 5. A memory store loses every session on restart
    if (isProduction) {
      console.warn('⚠️ SESSION_STORE=memory: analysis sessions and results are lost on every restart. Use "database" in production.');
    }
  }

  // AI call records go to the store as well as stdout; a failing insert never affects a call
  setDefaultAiCallSink((record) => {
    logCallRecord(record);
    return sessionStore.recordAiCall(record);
  });

  try {
    // 3. Sessions that were in flight when the server stopped can never finish
    const failed = await sessionStore.markInFlightFailed('The server restarted before this analysis finished. Please run it again.');
    console.log(`🧹 Interrupted sessions marked failed: ${failed}`);

    // 4. Expired sessions, their temp directories and orphaned temp directories
    await initializeTempDir();
    const cleaned = await cleanupExpiredSessions();
    console.log(`🧹 Expired sessions removed: ${cleaned.deletedSessions}; temp directories removed: ${cleaned.removedDirectories}`);
  } catch (error) {
    if (!isSessionStoreDown(error)) throw error;
    console.error('❌ Database unreachable (DATABASE_URL)');
    await disconnectDatabase?.();
    process.exit(1);
  }

  // Hourly cleanup; never keeps the process alive on its own
  setInterval(() => {
    cleanupExpiredSessions().catch(() => console.warn('session cleanup skipped: session store unavailable'));
  }, 60 * 60 * 1000).unref();

  try {
    console.log('🚀 Starting InfraMind Server...');
    console.log(`📍 Node.js version: ${process.version}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📍 PORT: ${PORT}`);
    
    // Check critical environment variables (non-blocking)
    const envChecks = {
      'CLIENT_URL': process.env.CLIENT_URL || 'Not set (using defaults)',
      'NODE_ENV': process.env.NODE_ENV || 'development',
      'PORT': PORT
    };
    
    console.log('🔧 Environment variables:');
    Object.entries(envChecks).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
    
    // Start the server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DevOps AI Agent Server running on port ${PORT}`);
      console.log(`📁 Temp directory: ${TEMP_DIR}`);
      console.log(`🔗 Client URL: ${process.env.CLIENT_URL || "http://localhost:5173"}`);
      console.log('🤖 Multi-agent system: 4 sequential agents; AI providers per task as listed in the AI route lines');
      console.log('✅ Server startup complete!');
    });
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
      } else {
        console.error('❌ Server error:', error);
      }
      process.exit(1);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Close the database pool before exiting on SIGTERM / SIGINT
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(0), 3000).unref();
    await disconnectDatabase?.().catch(() => {});
    process.exit(0);
  });
}

// Start the server
startServer();

export default app; 