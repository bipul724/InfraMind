/**
 * Minimal git runner for repository clones
 *
 * Replaces the former third-party git wrapper. Runs `git` directly with a fixed argument list, no shell,
 * no credential prompts, no user/system git config and a hard timeout.
 * Tokens are passed to git only through the child environment as an HTTP
 * header, never in argv or in the URL.
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildCloneUrl, isUuidV4, redactSecrets } from './repository.js';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_SIZE_MB = 200;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_]{1,255}$/;

export const CLONE_ERRORS = {
  REPO_NOT_FOUND: { status: 404, publicMessage: 'Repository not found or access denied' },
  CLONE_TIMEOUT: { status: 504, publicMessage: 'Cloning the repository took too long' },
  REPO_TOO_LARGE: { status: 413, publicMessage: 'Repository is too large to analyze' },
  CLONE_FAILED: { status: 502, publicMessage: 'Failed to clone repository' }
};

// Error with a fixed, user-safe message. Raw (already redacted) details are kept
// in a non-enumerable property for server-side logging only.
export class CloneError extends Error {
  constructor(code, details = '') {
    const known = CLONE_ERRORS[code] ? code : 'CLONE_FAILED';
    const { status, publicMessage } = CLONE_ERRORS[known];
    super(publicMessage);
    this.name = 'CloneError';
    this.code = known;
    this.status = status;
    this.publicMessage = publicMessage;
    Object.defineProperty(this, 'details', { value: details, enumerable: false, writable: true });
  }
}

const parsePositiveInt = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
};

export function getCloneLimits(env = process.env) {
  return {
    timeoutMs: parsePositiveInt(env.CLONE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxSizeBytes: parsePositiveInt(env.MAX_REPO_SIZE_MB, DEFAULT_MAX_SIZE_MB) * 1024 * 1024
  };
}

export function buildCloneArgs({ owner, repo }, destination) {
  return [
    '-c', 'core.symlinks=false',
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    'clone', '--depth', '1', '--single-branch', '--no-tags',
    '--', buildCloneUrl({ owner, repo }), destination
  ];
}

const basicAuthHeader = (token) =>
  `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;

export function buildGitEnv(token, baseEnv = process.env) {
  // Drop inherited git variables (GIT_ASKPASS from editors, GIT_CONFIG_* injections,
  // GIT_TRACE*, GIT_DIR, ...) so nothing outside this module influences the clone
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.startsWith('GIT_') || key === 'SSH_ASKPASS') continue;
    env[key] = value;
  }

  Object.assign(env, {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull
  });

  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = basicAuthHeader(token);
  }

  return env;
}

function defaultRunGit(args, { env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      env,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      shell: false,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// On-disk size of a directory tree. Uses lstat, so symlinks are never followed.
// Stops walking as soon as the limit is exceeded.
export async function getDirectorySize(root, limitBytes = Infinity) {
  let total = 0;
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    const stats = await fs.lstat(current);
    total += stats.size;
    if (total > limitBytes) return total;

    if (stats.isDirectory()) {
      const entries = await fs.readdir(current);
      for (const entry of entries) {
        pending.push(path.join(current, entry));
      }
    }
  }

  return total;
}

const NOT_FOUND_PATTERN = /repository not found|could not read username|authentication failed|terminal prompts disabled|invalid username or (?:password|token)|requested url returned error: 40[134]/i;

function classifyGitFailure(error) {
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'CLONE_FAILED';
  if ((error?.killed && error?.signal === 'SIGKILL') || error?.code === 'ETIMEDOUT') return 'CLONE_TIMEOUT';
  const output = `${error?.stderr || ''}\n${error?.message || ''}`;
  if (NOT_FOUND_PATTERN.test(output)) return 'REPO_NOT_FOUND';
  return 'CLONE_FAILED';
}

// Clone https://github.com/{owner}/{repo} into destination (<temp>/<uuid>/repo).
// On any failure the session directory is removed and a CloneError is thrown.
export async function cloneRepository(
  { owner, repo, token = null, destination, timeoutMs, maxSizeBytes },
  { runGit = defaultRunGit } = {}
) {
  const limits = getCloneLimits();
  const effectiveTimeout = parsePositiveInt(timeoutMs, limits.timeoutMs);
  const effectiveMaxSize = parsePositiveInt(maxSizeBytes, limits.maxSizeBytes);

  // Only accept the layout produced by resolveSessionClonePath, so the cleanup
  // below can never remove anything other than a session directory
  if (
    typeof destination !== 'string' ||
    !path.isAbsolute(destination) ||
    path.basename(destination) !== 'repo' ||
    !isUuidV4(path.basename(path.dirname(destination)))
  ) {
    throw new CloneError('CLONE_FAILED', 'Invalid clone destination');
  }
  if (token !== null && token !== undefined && (typeof token !== 'string' || !TOKEN_PATTERN.test(token))) {
    throw new CloneError('CLONE_FAILED', 'Invalid token format');
  }

  const sessionDir = path.dirname(destination);
  const secrets = token ? [token, basicAuthHeader(token)] : [];
  const redactOptions = { tempDir: path.dirname(sessionDir) };
  const removeSessionDir = () => fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});

  try {
    await fs.mkdir(sessionDir, { recursive: true });
    await runGit(buildCloneArgs({ owner, repo }, destination), {
      env: buildGitEnv(token),
      timeoutMs: effectiveTimeout
    });
  } catch (error) {
    await removeSessionDir();
    throw new CloneError(classifyGitFailure(error), redactSecrets(error, secrets, redactOptions));
  }

  try {
    const size = await getDirectorySize(destination, effectiveMaxSize);
    if (size > effectiveMaxSize) {
      await removeSessionDir();
      throw new CloneError('REPO_TOO_LARGE', `Clone exceeded ${effectiveMaxSize} bytes`);
    }
  } catch (error) {
    if (error instanceof CloneError) throw error;
    await removeSessionDir();
    throw new CloneError('CLONE_FAILED', redactSecrets(error, secrets, redactOptions));
  }
}
