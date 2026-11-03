/**
 * Repository identity and path helpers
 *
 * Every repository the server clones is identified only by a validated
 * GitHub owner/repo pair. Client-supplied URLs, names and privacy flags are
 * never used to build clone URLs or filesystem paths.
 */

import fs from 'fs';
import path from 'path';

// GitHub login rules: alphanumerics or single hyphens, cannot start with a hyphen
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Characters that are never part of a canonical github.com repository URL.
// Rejecting them before parsing avoids relying on URL normalisation.
const FORBIDDEN_URL_CHARS = /[\s\\%?#\u0000-\u001f\u007f]/;
// "." or ".." path segments, which new URL() would silently resolve
const DOT_SEGMENT = /\/\.{1,2}(?=\/|$)/;

const isValidOwner = (owner) => typeof owner === 'string' && OWNER_PATTERN.test(owner);
const isValidRepo = (repo) =>
  typeof repo === 'string' && REPO_PATTERN.test(repo) && repo !== '.' && repo !== '..';

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

// Parse a user-entered repository URL. Accepts only https://github.com/{owner}/{repo}
// with an optional ".git" suffix and/or one trailing slash. Returns null on any failure.
export function parseGitHubRepoUrl(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  if (FORBIDDEN_URL_CHARS.test(value) || DOT_SEGMENT.test(value)) return null;
  if (!/^https:\/\/github\.com\//i.test(value)) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;

  let pathname = url.pathname;
  if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  const segments = pathname.split('/');
  if (segments.length !== 3 || segments[0] !== '') return null;

  const owner = segments[1];
  let repo = segments[2];
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);

  if (!isValidOwner(owner) || !isValidRepo(repo)) return null;
  return { owner, repo };
}

// Parse an "owner/repo" full name, as returned by the GitHub API
export function parseFullName(fullName) {
  if (typeof fullName !== 'string') return null;
  const segments = fullName.split('/');
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  if (!isValidOwner(owner) || !isValidRepo(repo)) return null;
  return { owner, repo };
}

// Derive a repository identity from the client's repositoryData object.
// cloneUrl, sshUrl, htmlUrl and private are deliberately ignored.
export function parseRepositoryData(repositoryData) {
  if (!isPlainObject(repositoryData)) return null;

  if (repositoryData.fullName !== undefined) {
    return parseFullName(repositoryData.fullName);
  }

  const login = isPlainObject(repositoryData.owner) ? repositoryData.owner.login : undefined;
  if (!isValidOwner(login) || !isValidRepo(repositoryData.name)) return null;
  return { owner: login, repo: repositoryData.name };
}

export const buildCloneUrl = ({ owner, repo }) => `https://github.com/${owner}/${repo}.git`;
export const buildDisplayUrl = ({ owner, repo }) => `https://github.com/${owner}/${repo}`;

export const isUuidV4 = (value) => typeof value === 'string' && UUID_V4_PATTERN.test(value);

// True when target is strictly inside baseDir (not equal to it)
export function isPathInside(baseDir, target) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  return resolved.startsWith(base + path.sep);
}

// Clones always live at <tempDir>/<sessionId>/repo; the repo name is never part of the path
export function resolveSessionClonePath(tempDir, sessionId) {
  if (!isUuidV4(sessionId)) {
    throw new Error('Invalid session ID for clone path');
  }
  const clonePath = path.resolve(tempDir, sessionId, 'repo');
  if (!isPathInside(tempDir, clonePath)) {
    throw new Error('Clone path escapes the temp directory');
  }
  return clonePath;
}

const toText = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const extra = ['stderr', 'stdout']
      .filter((key) => typeof value[key] === 'string' && value[key])
      .map((key) => `${key}: ${value[key]}`);
    return [value.stack || `${value.name}: ${value.message}`, ...extra].join('\n');
  }
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // fall through to String()
  }
  try {
    return String(value);
  } catch {
    return '[unprintable value]';
  }
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Strip credentials and server paths from text before it is logged
export function redactSecrets(text, secrets = [], { tempDir = path.join(process.cwd(), 'temp') } = {}) {
  let output = toText(text);

  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    if (typeof secret === 'string' && secret) {
      output = output.split(secret).join('[REDACTED]');
    }
  }

  // URL userinfo: scheme://user[:password]@host
  output = output.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1[REDACTED]@');
  // Authorization header values, with or without an auth scheme
  output = output.replace(
    /(authorization\s*[:=]\s*)((?:basic|bearer|token)\s+)?[^\s'",;]+/gi,
    '$1$2[REDACTED]'
  );
  // Well-known GitHub token formats
  output = output.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, '[REDACTED]');

  // Absolute temp directory (and its real path, which differs on macOS /var -> /private/var)
  const tempPaths = new Set([path.resolve(tempDir)]);
  try {
    tempPaths.add(fs.realpathSync(tempDir));
  } catch {
    // temp dir may not exist
  }
  for (const tempPath of [...tempPaths].sort((a, b) => b.length - a.length)) {
    output = output.replace(new RegExp(escapeRegExp(tempPath), 'g'), '<temp>');
  }

  return output;
}
