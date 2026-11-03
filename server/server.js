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
import { v4 as uuidv4 } from 'uuid';
import { runAgentPipeline } from './agents/index.js';
import GitHubService, { describeJwtSecretProblem } from './github.js';
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-GitHub-Token']
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-GitHub-Token']
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

// Store active sessions
const activeSessions = new Map();

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
  getSession: (sessionId) => activeSessions.get(sessionId)
});

// Returns the session only if it exists and belongs to the authenticated user.
// Unknown and foreign sessions are indistinguishable to the caller.
function getOwnedSession(req, sessionId) {
  if (!isUuidV4(sessionId)) return null;
  const session = activeSessions.get(sessionId);
  if (!session || session.userId !== req.user?.id) return null;
  return session;
}

const sendSessionNotFound = (res) => res.status(404).json({ error: 'Session not found' });

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

// GitHub OAuth Routes

// OAuth state cookie: HttpOnly, single-use, scoped to the /auth/github routes.
// Production frontends and backends sit on different sites, so use SameSite=None; Secure there.
const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
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

// Initiate GitHub OAuth. The browser navigates here (top-level), so the state
// cookie is first-party and survives browsers that block third-party cookies.
app.get('/auth/github', (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString('hex'); // CSRF protection
    const authUrl = GitHubService.getAuthURL(state);
    
    res.cookie(OAUTH_STATE_COOKIE, state, { ...oauthStateCookieOptions, maxAge: OAUTH_STATE_MAX_AGE_MS });
    
    res.redirect(authUrl);
  } catch (error) {
    console.error('GitHub OAuth initiation error:', error.message);
    res.redirect(`${process.env.CLIENT_URL}/auth?error=github_auth_failed`);
  }
});

// GitHub OAuth callback
app.get('/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.cookies?.[OAUTH_STATE_COOKIE];
  
  // The state is single-use: clear it whether or not validation succeeds
  res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions);
  
  // Verify state to prevent CSRF attacks
  if (!isValidOAuthState(state, storedState)) {
    return res.redirect(`${process.env.CLIENT_URL}/auth?error=invalid_state`);
  }
  
  if (typeof code !== 'string' || !code) {
    return res.redirect(`${process.env.CLIENT_URL}/auth?error=github_auth_failed`);
  }
  
  try {
    // Exchange code for access token
    const accessToken = await GitHubService.getAccessToken(code);
    
    // Get user information
    const userInfo = await GitHubService.getUserInfo(accessToken);
    
    // Generate JWT token
    const jwtToken = GitHubService.generateJWT({
      id: userInfo.id,
      login: userInfo.login,
      name: userInfo.name,
      email: userInfo.email,
      avatarUrl: userInfo.avatar_url,
      accessToken: accessToken
    });
    
    // Redirect to frontend with JWT token
    res.redirect(`${process.env.CLIENT_URL}/auth/success?token=${jwtToken}`);
    
  } catch (error) {
    console.error('GitHub OAuth callback error:', error.message);
    res.redirect(`${process.env.CLIENT_URL}/auth?error=github_auth_failed`);
  }
});

// The GitHub session JWT travels in X-GitHub-Token; Authorization carries the Supabase token.
// Transitional until GitHub tokens are kept on the server (B1.3).
const GITHUB_AUTH_REQUIRED_BODY = { error: 'Connect GitHub to use your repositories', code: 'GITHUB_AUTH_REQUIRED' };
const GITHUB_SESSION_INVALID_MESSAGE = 'GitHub session is invalid or expired. Please reconnect GitHub.';

// Returns the verified GitHub session payload, or null after sending a 401.
// Configuration errors (missing JWT_SECRET) are rethrown for the caller's 500 handling.
function readGitHubSession(req, res, invalidMessage = GITHUB_SESSION_INVALID_MESSAGE) {
  const raw = req.get('x-github-token');
  if (typeof raw !== 'string' || raw.trim() === '') {
    res.status(401).json(GITHUB_AUTH_REQUIRED_BODY);
    return null;
  }
  try {
    return GitHubService.verifyJWT(raw.trim());
  } catch (error) {
    if (error.message !== 'Invalid token') throw error;
    res.status(401).json({ error: invalidMessage, code: 'GITHUB_AUTH_INVALID' });
    return null;
  }
}

// Get user repositories
app.get('/api/github/repositories', async (req, res) => {
  try {
    const userData = readGitHubSession(req, res, 'Invalid or expired token');
    if (!userData) return;
    const { page = 1, per_page = 50 } = req.query;
    
    // Get user repositories
    const repositories = await GitHubService.getUserRepositories(
      userData.accessToken, 
      parseInt(page), 
      parseInt(per_page)
    );
    
    // Get organizations
    const organizations = await GitHubService.getUserOrganizations(userData.accessToken);
    
    res.json({
      user: {
        login: userData.login,
        name: userData.name,
        avatarUrl: userData.avatarUrl
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
    console.error('Get repositories error:', error);
    if (error.message === 'Invalid token') {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'GITHUB_AUTH_INVALID' });
    }
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// Get organization repositories
app.get('/api/github/organizations/:org/repositories', async (req, res) => {
  try {
    const userData = readGitHubSession(req, res, 'Invalid or expired token');
    if (!userData) return;
    const { org } = req.params;
    const { page = 1, per_page = 50 } = req.query;
    
    const repositories = await GitHubService.getOrgRepositories(
      userData.accessToken, 
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
    console.error('Get org repositories error:', error);
    if (error.message === 'Invalid token') {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'GITHUB_AUTH_INVALID' });
    }
    res.status(500).json({ error: 'Failed to fetch organization repositories' });
  }
});

// Verify user access to repository
app.post('/api/github/verify-repo', async (req, res) => {
  try {
    const userData = readGitHubSession(req, res, 'Invalid or expired token');
    if (!userData) return;
    const { owner, repo } = req.body;
    
    if (!owner || !repo) {
      return res.status(400).json({ error: 'Owner and repository name are required' });
    }
    
    const accessResult = await GitHubService.checkRepoAccess(userData.accessToken, owner, repo);
    
    res.json(accessResult);
    
  } catch (error) {
    console.error('Verify repo access error:', error);
    if (error.message === 'Invalid token') {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'GITHUB_AUTH_INVALID' });
    }
    res.status(500).json({ error: 'Failed to verify repository access' });
  }
});

// Clone repository endpoint
// GitHub tokens are accepted only for the duration of this request: they are never stored
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
    // User selected from their GitHub repositories (takes precedence over repoUrl)
    let userData;
    try {
      userData = readGitHubSession(req, res);
    } catch (error) {
      console.error(`Clone auth error: ${redactSecrets(error.message)}`);
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (!userData) return;

    const requested = parseRepositoryData(repositoryData);
    if (!requested) {
      return res.status(400).json({ error: 'Invalid repository data' });
    }

    const accessToken = userData?.accessToken;
    if (typeof accessToken !== 'string' || !GITHUB_TOKEN_PATTERN.test(accessToken)) {
      return res.status(401).json({ error: GITHUB_SESSION_INVALID_MESSAGE, code: 'GITHUB_AUTH_INVALID' });
    }

    let access;
    try {
      access = await GitHubService.checkRepoAccess(accessToken, requested.owner, requested.repo);
    } catch (error) {
      if (error.code === 'GITHUB_UNAUTHORIZED') {
        return res.status(401).json({ error: GITHUB_SESSION_INVALID_MESSAGE, code: 'GITHUB_AUTH_INVALID' });
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

  const sessionId = uuidv4();
  const clonePath = resolveSessionClonePath(TEMP_DIR, sessionId);
  const fullName = `${identity.owner}/${identity.repo}`;

  // Create session (no credentials, no client-supplied URLs)
  const session = {
    userId: req.user.id,
    owner: identity.owner,
    repo: identity.repo,
    fullName,
    repoName: identity.repo,
    displayUrl: buildDisplayUrl(identity),
    clonePath,
    status: 'cloning',
    createdAt: new Date()
  };
  activeSessions.set(sessionId, session);

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

    session.status = 'failed';
    session.error = cloneError.publicMessage;
    await fs.remove(path.dirname(clonePath)).catch(() => {});

    emitProgress(sessionId, {
      step: 'Clone failed',
      progress: 0,
      status: 'failed',
      error: cloneError.publicMessage
    });

    console.error(`Clone failed [${cloneError.code}] session=${sessionId} repo=${fullName}: ${redactSecrets(details, [token])}`);
    return sendCloneError(res, cloneError.code);
  }

  session.status = 'cloned';
  session.clonedAt = new Date();

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
  try {
    const { sessionId } = req.body;
    
    // Ownership first, so a non-owner never learns the session's status
    const session = getOwnedSession(req, sessionId);
    if (!session) {
      return sendSessionNotFound(res);
    }
    
    if (session.status !== 'cloned') {
      return res.status(400).json({ error: 'Repository not ready for analysis' });
    }
    
    // Update session status
    session.status = 'analyzing';
    session.analysisStartedAt = new Date();
    
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
      session.clonePath,
      progressCallback
    );
    
    // Store analysis results
    session.analysisResult = result;
    session.status = 'completed';
    session.completedAt = new Date();
    
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
    
    const failedSessionId = req.body?.sessionId;
    const session = getOwnedSession(req, failedSessionId);
    if (session) {
      session.status = 'failed';
      session.error = 'Analysis failed';
      
      emitProgress(failedSessionId, {
        step: 'Analysis failed',
        progress: 0,
        status: 'failed',
        error: 'Analysis failed'
      });
    }
    
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Get generated files endpoint
app.get('/api/files/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = getOwnedSession(req, sessionId);
    if (!session) {
      return sendSessionNotFound(res);
    }
    
    if (session.status !== 'completed' || !session.analysisResult) {
      return res.status(400).json({ error: 'Analysis not completed' });
    }
    
    res.json(toFilesResponse(session));
    
  } catch (error) {
    console.error(`Files retrieval error: ${redactSecrets(error)}`);
    res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

// Download individual file endpoint
app.get('/api/files/:sessionId/:filename', async (req, res) => {
  try {
    const { sessionId, filename } = req.params;
    
    const session = getOwnedSession(req, sessionId);
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
app.get('/api/status/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = getOwnedSession(req, sessionId);
    if (!session) {
      return sendSessionNotFound(res);
    }
    
    res.json(toStatusResponse(sessionId, session));
    
  } catch (error) {
    console.error(`Status retrieval error: ${redactSecrets(error)}`);
    res.status(500).json({ error: 'Failed to retrieve status' });
  }
});

// Cleanup old sessions (runs every hour)
setInterval(async () => {
  const now = new Date();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.createdAt > maxAge) {
      try {
        // Remove cloned files
        const sessionDir = path.join(TEMP_DIR, sessionId);
        if (await fs.pathExists(sessionDir)) {
          await fs.remove(sessionDir);
        }
        
        // Remove from active sessions
        activeSessions.delete(sessionId);
        console.log(`Cleaned up session: ${sessionId}`);
      } catch (error) {
        console.error(`Failed to cleanup session ${sessionId}:`, error);
      }
    }
  }
}, 60 * 60 * 1000); // Run every hour

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
  // Refuse to start with a secret that would let anyone forge GitHub session tokens
  const jwtSecretProblem = describeJwtSecretProblem(process.env.JWT_SECRET);
  if (jwtSecretProblem) {
    console.error(`❌ JWT_SECRET ${jwtSecretProblem}. Set JWT_SECRET to a random value of at least 32 characters.`);
    process.exit(1);
  }

  // Refuse to start without a usable Supabase configuration: every /api route depends on it
  const supabaseProblem = describeSupabaseConfigProblem(process.env);
  if (supabaseProblem) {
    console.error(`❌ ${supabaseProblem}. Set SUPABASE_URL (https://<project>.supabase.co) and SUPABASE_ANON_KEY.`);
    process.exit(1);
  }

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
    
    // Initialize temp directory
    await initializeTempDir();
    
    // Start the server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DevOps AI Agent Server running on port ${PORT}`);
      console.log(`📁 Temp directory: ${TEMP_DIR}`);
      console.log(`🔗 Client URL: ${process.env.CLIENT_URL || "http://localhost:5173"}`);
      console.log('🤖 Multi-agent system: 4 sequential agents + Llama 3 70B (Novita.ai)');
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

// Start the server
startServer();

export default app; 