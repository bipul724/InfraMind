// Shared helpers for the integration tests.
// Servers are always spawned from a fresh temp cwd with an explicit environment,
// so neither server/.env nor server/temp is ever used.

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSupabase, USER_A, USER_B } from './fakeSupabase.js';
import { startFakeLlm } from './fakeLlm.js';
import { startFakeGitHub, GITHUB_USER_A } from './fakeGitHub.js';
import { createFakePostgrest } from './fakePostgrest.js';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_ENTRY = path.join(SERVER_DIR, 'server.js');

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomAlphanumeric(length) {
  const bytes = crypto.randomBytes(length);
  let output = '';
  for (let i = 0; i < length; i++) output += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
  return output;
}

export const randomSecret = () => randomAlphanumeric(48);

// A valid GITHUB_TOKEN_ENC_KEY: standard base64 of 32 random bytes
export const randomEncryptionKey = () => crypto.randomBytes(32).toString('base64');

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function makeTempDir(prefix = 'inframind-test-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  // Resolve /var -> /private/var on macOS so paths compare equal to process.cwd() in the child
  return fs.realpath(dir);
}

export async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

// Every log line captured from every spawned server in this test process
export const allCapturedLogs = [];

// One fake Supabase (with PostgREST on the same origin), one fake LLM and one fake
// GitHub per test process, shared by every spawned server
let fakes = null;

export async function getFakes() {
  if (!fakes) {
    const postgrest = createFakePostgrest();
    const supabase = await startFakeSupabase({ rest: postgrest });
    const llm = await startFakeLlm();
    const github = await startFakeGitHub();
    fakes = {
      supabase,
      postgrest,
      llm,
      github,
      tokens: { A: supabase.issueToken(USER_A), B: supabase.issueToken(USER_B) }
    };
  }
  return fakes;
}

export async function closeFakes() {
  if (!fakes) return;
  const current = fakes;
  fakes = null;
  await Promise.all([current.supabase.close(), current.llm.close(), current.github.close()]);
}

export const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

export function buildEnv(cwd, port, overrides = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    NODE_ENV: 'test',
    PORT: String(port),
    CLIENT_URL: 'http://localhost:5173',
    GITHUB_CLIENT_ID: `Iv1.${randomAlphanumeric(16)}`,
    GITHUB_CLIENT_SECRET: randomSecret(),
    GITHUB_REDIRECT_URI: 'http://localhost:5173/auth/github/callback',
    GITHUB_OAUTH_BASE_URL: fakes?.github.url,
    GITHUB_API_BASE_URL: fakes?.github.url,
    GITHUB_TOKEN_STORE: 'memory',
    SESSION_STORE: 'memory',
    GITHUB_TOKEN_ENC_KEY: randomEncryptionKey(),
    SUPABASE_URL: fakes?.supabase.url,
    SUPABASE_ANON_KEY: fakes?.supabase.anonKey,
    // AI providers: all three point at the local multi-provider fake
    AI_PROVIDERS: 'gemini,groq,openrouter',
    GEMINI_API_KEY: `test-gemini-key-${randomAlphanumeric(12)}`,
    GEMINI_MODEL: 'test-model-gemini',
    GEMINI_BASE_URL: fakes?.llm.baseUrlFor('gemini'),
    GROQ_API_KEY: `test-groq-key-${randomAlphanumeric(12)}`,
    GROQ_MODEL: 'test-model-groq',
    GROQ_BASE_URL: fakes?.llm.baseUrlFor('groq'),
    OPENROUTER_API_KEY: `test-openrouter-key-${randomAlphanumeric(12)}`,
    OPENROUTER_MODEL: 'test-model-openrouter',
    OPENROUTER_BASE_URL: fakes?.llm.baseUrlFor('openrouter'),
    AI_TIMEOUT_MS: '2000',
    AI_CALL_BUDGET_MS: '10000',
    DOTENV_CONFIG_PATH: path.join(cwd, 'does-not-exist.env')
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function spawnServer(cwd, env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { stdout: '', stderr: '' };
  const entry = { cwd, output };
  allCapturedLogs.push(entry);
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  return { child, output };
}

// Start a server and wait until /health answers
export async function startServer({ envOverrides = {}, cwd } = {}) {
  await getFakes();
  const workDir = cwd || await makeTempDir();
  const port = await getFreePort();
  const env = buildEnv(workDir, port, envOverrides);
  const { child, output } = spawnServer(workDir, env);
  const baseUrl = `http://127.0.0.1:${port}`;

  let exited = null;
  const exitPromise = new Promise((resolve) => child.on('exit', (code, signal) => { exited = { code, signal }; resolve(exited); }));

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`Server exited early (${JSON.stringify(exited)}):\n${output.stdout}\n${output.stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (Date.now() >= deadline) {
    child.kill('SIGKILL');
    throw new Error(`Server did not become ready:\n${output.stdout}\n${output.stderr}`);
  }

  return {
    baseUrl,
    cwd: workDir,
    env,
    output,
    logs: () => `${output.stdout}\n${output.stderr}`,
    // B1.4: send a signal, and wait for the exit ({ code, signal }) with a timeout
    signal: (name) => child.kill(name),
    waitForExit: (timeoutMs = 10000) => Promise.race([
      exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('server did not exit in time')), timeoutMs).unref())
    ]),
    get exited() {
      return exited;
    },
    async stop() {
      if (exited) return;
      const done = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await done;
      clearTimeout(timer);
    }
  };
}

// Spawn a server that is expected to exit; resolves with its exit code and output
export async function runServerExpectingExit({ envOverrides = {}, cwd, timeoutMs = 10000 } = {}) {
  await getFakes();
  const workDir = cwd || await makeTempDir();
  const port = await getFreePort();
  const env = buildEnv(workDir, port, envOverrides);
  const { child, output } = spawnServer(workDir, env);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true, ...output });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, ...output });
    });
  });
}

export async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, text, json };
}

// git with no user/system config, so the developer's hooks, signing or helpers never apply
export function runFixtureGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull },
    stdio: 'pipe'
  });
}

export async function createFixtureRepo(parentDir) {
  const repoDir = path.join(parentDir, 'fixture-repo');
  await fs.mkdir(repoDir);
  runFixtureGit(['init', '-q'], repoDir);
  await fs.writeFile(path.join(repoDir, 'FIXTURE_MARKER.txt'), 'fixture\n');
  runFixtureGit(['add', '.'], repoDir);
  runFixtureGit(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'fixture'], repoDir);
  return repoDir;
}

// Header value for a Cookie request header built from a response's Set-Cookie headers
export function cookieHeaderFrom(response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

// Run the connect flow up to and including the OAuth callback, for the Supabase user
// holding ticketOwnerToken: POST /api/github/connect -> GET /auth/github?ticket ->
// fake GitHub code -> callback. Stops there and returns the callback's Location and
// the completion id it carries, so a test can claim as anyone (or not at all).
// Options let tests finish the flow from another browser or tamper with any step.
export async function startConnectFlow(server, ticketOwnerToken, {
  githubUser = GITHUB_USER_A,
  completeWithCookie,
  callbackQuery,
  callbackHeaders = {}
} = {}) {
  const { github } = await getFakes();
  const connect = await fetch(`${server.baseUrl}/api/github/connect`, { method: 'POST', headers: authHeaders(ticketOwnerToken) });
  if (connect.status !== 200) throw new Error(`connect failed with HTTP ${connect.status}`);
  const { ticket } = await connect.json();

  const start = await fetch(`${server.baseUrl}/auth/github?ticket=${encodeURIComponent(ticket)}`, { redirect: 'manual', headers: callbackHeaders });
  const authorizeUrl = new URL(start.headers.get('location'));
  const state = authorizeUrl.searchParams.get('state');
  const cookie = cookieHeaderFrom(start);
  const code = github.issueCode(githubUser);
  const tokensBefore = github.issuedTokens.length;

  const query = callbackQuery ?? `code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  const callback = await fetch(`${server.baseUrl}/auth/github/callback?${query}`, {
    redirect: 'manual',
    headers: { ...callbackHeaders, Cookie: completeWithCookie ?? cookie }
  });
  const location = callback.headers.get('location');
  let completion = null;
  try {
    completion = new URL(location).searchParams.get('complete');
  } catch {
    // no Location
  }

  return {
    ticket,
    state,
    code,
    cookie,
    startStatus: start.status,
    authorizeUrl,
    callbackStatus: callback.status,
    location,
    completion,
    // The GitHub token issued by this flow's code exchange, if one was issued
    accessToken: github.issuedTokens.length > tokensBefore ? github.issuedTokens.at(-1) : null,
    callbackSetCookie: callback.headers.getSetCookie()
  };
}

// POST /api/github/connect/complete as the user holding userToken (or anonymously with null)
export async function claimCompletion(server, userToken, completion) {
  const headers = { 'Content-Type': 'application/json', ...(userToken ? authHeaders(userToken) : {}) };
  const response = await fetch(`${server.baseUrl}/api/github/connect/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ completion })
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, text, json, headers: response.headers };
}

// The full connect flow, including the claim by the same user who obtained the ticket
export async function connectGitHubFor(server, userToken, options = {}) {
  const flow = await startConnectFlow(server, userToken, options);
  const claim = flow.completion ? await claimCompletion(server, userToken, flow.completion) : null;
  return { ...flow, claim };
}
