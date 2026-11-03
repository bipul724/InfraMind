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

export function buildEnv(cwd, port, overrides = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    NODE_ENV: 'test',
    PORT: String(port),
    JWT_SECRET: randomSecret(),
    CLIENT_URL: 'http://localhost:5173',
    LLAMA_API_KEY: 'invalid-test-key',
    TAVILY_API_KEY: '',
    MEM0_API_KEY: '',
    KEYWORDS_AI_API_KEY: '',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
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
  const workDir = cwd || await makeTempDir();
  const port = await getFreePort();
  const env = buildEnv(workDir, port, envOverrides);
  const { child, output } = spawnServer(workDir, env);
  const baseUrl = `http://127.0.0.1:${port}`;

  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

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
