/**
 * Repository grounding for the generator (B2.5): what the AI is told about the cloned
 * repository besides its file names. No AI here.
 *
 * Only the top-level files in MANIFEST_FILES are ever read as manifests, plus the
 * existing Dockerfile (at most DOCKERFILE_EXCERPT_CAP, at any depth) and workflow
 * excerpts, always through readRepoFile (symlink-safe).
 * Everything returned here is repository content and must be presented to the AI as
 * data, never as instructions.
 */

import fs from 'fs-extra';
import { open } from 'node:fs/promises';
import path from 'path';
import { isPathInside } from '../utils/repository.js';
import { SECRET_PATTERNS, WEBHOOK_URL_PREFIX } from './files.js';

export const MANIFEST_FILES = Object.freeze([
  'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile', 'setup.cfg',
  'package.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'Gemfile', 'composer.json', 'Procfile', 'runtime.txt', '.python-version', '.nvmrc', '.tool-versions'
]);

// Never read, whatever MANIFEST_FILES says: environment files, credential stores, keys
const FORBIDDEN_NAME = /^(\.env.*|\.npmrc|\.pypirc|\.netrc|.*\.pem|.*\.key)$/i;
export const isForbiddenFileName = (name) => FORBIDDEN_NAME.test(path.basename(String(name)));

export const MANIFEST_FILE_CAP = 8 * 1024;
export const MANIFEST_TOTAL_CAP = 32 * 1024;
export const EXISTING_FILE_CAP = 4 * 1024;
export const EXISTING_TOTAL_CAP = 16 * 1024;
export const EXISTING_NAME_CAP = 50;
// Existing Dockerfiles excerpted into the prompt, in findDockerfiles order
export const DOCKERFILE_EXCERPT_CAP = 2;
// Existing Dockerfiles named in the prompt; more are counted on one line
export const DOCKERFILE_NAME_CAP = 10;
export const PATH_LIST_CAP = 300;
export const TRUNCATED_MARKER = '[truncated]';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const ENTRY_POINT_FILES = ['app.py', 'main.py', 'wsgi.py', 'asgi.py', 'manage.py', 'server.py', 'run.py', 'src/main.py', 'src/app.py'];
export const PYTHON_FRAMEWORKS = Object.freeze(['django', 'flask', 'fastapi', 'streamlit', 'gradio', 'gunicorn', 'uvicorn']);
const NPM_TEST_PLACEHOLDER = /no test specified/i;
const VALUE_CAP = 200;

// projectStructure keys use the platform separator; prompts always show "/"
const toPosix = (relativePath) => relativePath.split(path.sep).join('/');
export const fromPosix = (relativePath) => relativePath.split('/').join(path.sep);
const isFileIn = (projectFiles, posixPath) => projectFiles[fromPosix(posixPath)] === 'file';
const isDirectoryIn = (projectFiles, posixPath) => projectFiles[fromPosix(posixPath)] === 'directory';
const oneLine = (value) => String(value).replace(/\s+/g, ' ').trim().slice(0, VALUE_CAP);

// Resolve a repository file for reading: only regular files whose real path stays inside
// the repository, so symlinks cannot point the analyzer elsewhere
async function resolveRepoFile(repoPath, relativePath) {
  const root = path.resolve(repoPath);
  const target = path.resolve(root, relativePath);
  if (!isPathInside(root, target)) {
    throw new Error(`Refusing to read ${relativePath}: outside the repository`);
  }

  const stats = await fs.lstat(target);
  if (!stats.isFile()) {
    throw new Error(`Refusing to read ${relativePath}: not a regular file`);
  }

  // Catches symlinked parent directories as well
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  if (!isPathInside(realRoot, realTarget)) {
    throw new Error(`Refusing to read ${relativePath}: outside the repository`);
  }
  return { target, size: stats.size };
}

// Read a file from the cloned repository. With maxBytes, at most that many bytes are
// read and { text, truncated } is returned; without it, the whole file as a string.
export async function readRepoFile(repoPath, relativePath, { maxBytes } = {}) {
  const { target, size } = await resolveRepoFile(repoPath, relativePath);
  if (maxBytes === undefined) return fs.readFile(target, 'utf8');

  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const handle = await open(target, 'r');
  let bytesRead = 0;
  try {
    while (bytesRead < length) {
      const { bytesRead: n } = await handle.read(buffer, bytesRead, length - bytesRead, bytesRead);
      if (n === 0) break;
      bytesRead += n;
    }
  } finally {
    await handle.close();
  }
  const truncated = size > maxBytes;
  let text = buffer.subarray(0, bytesRead).toString('utf8');
  if (truncated) text = text.replace(/�+$/, ''); // a multi-byte character cut in half
  return { text, truncated };
}

export async function readRepoJson(repoPath, relativePath) {
  return JSON.parse(await readRepoFile(repoPath, relativePath));
}

// ---------------------------------------------------------------------------
// Credential redaction (best effort)

export const REDACTED = 'REDACTED';

// scheme://userinfo@ ; userinfo is user, user:password or a token
const URL_USERINFO = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s/?#@"'<>`]+)@/g;
// An SSH user name alone (git+ssh://git@github.com/...) is not a credential
const SSH_SCHEME = /(^|\+)ssh:\/\/$/i;
const PEM_BLOCK = /-----BEGIN[A-Z0-9 ]*-----[\s\S]*?(?:-----END[A-Z0-9 ]*-----|$)/g;
// The secret shapes from agents/files.js, extended to the whole token
const SECRET_TOKENS = SECRET_PATTERNS.map((pattern) => ({
  regex: new RegExp(`${pattern.source}[A-Za-z0-9_-]*`, `${pattern.flags.replace('g', '')}g`),
  keepsLead: pattern.source.startsWith('(^|') // group 1 is the boundary character before the token
}));
const SENSITIVE_KEY = /TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY/i;
// KEY=value, KEY: value, key = "value", "key": "value". "==" (a version pin) is not an assignment
const ASSIGNMENT = /(^|[^A-Za-z0-9_.$-])(["']?)([A-Za-z_][A-Za-z0-9_.-]*)\2([ \t]*)(=(?!=)|:(?=[ \t]|$))([ \t]*)/gm;
// ${{ ... }}, ${VAR}, $VAR: a reference to a secret, not the secret, so it stays
const REFERENCE = /\$\{\{|\$\{|\$[A-Za-z_]/;
const QUOTES = ['"', "'", '`'];
// Slack and Discord webhook URLs: the prefix stays, the rest of the path is the credential
const WEBHOOK_URL = new RegExp(`(${WEBHOOK_URL_PREFIX.source})([^\\s"'<>\`)\\]}]+)`, 'gi');
// Authorization: and Proxy-Authorization: headers, the name optionally quoted ("Authorization": ...)
const AUTH_HEADER = /(^|[^A-Za-z0-9_-])(["'`]?)((?:proxy-)?authorization)\2([ \t]*:[ \t]*)/gim;
// An authorization value: an optional scheme word (Bearer, token, Basic, Bot, Digest, ...), then the credential
const AUTH_VALUE = /^([A-Za-z][A-Za-z0-9_-]*)([ \t]+)(\S.*)$/;
const AUTH_SCHEME_ALONE = /^(bearer|token|basic|bot|digest)$/i;
// Dockerfile ENV and ARG in the space form, ENV KEY value: the rest of the line is the value
const DOCKER_ENV_SPACE = /^([ \t]*(?:env|arg)[ \t]+)([A-Za-z_][A-Za-z0-9_]*)([ \t]+)(\S[^\n]*?)([ \t\r]*)$/gim;
// One shell command: from its name to the next ;, &&, || or | on its logical line
const COMMAND_END = /&&|\|\||[;|]/;
// A physical line whose last non-whitespace character is "\" continues onto the next one
const CONTINUED_LINE = /\\[ \t\r]*$/;
// A gap between words: blanks, or a "\" line continuation and the next line's indentation
const GAP = String.raw`(?:[ \t]|\\[ \t\r]*\n)`;
// curl -u user:pass, -uuser:pass, --user user:pass, --user=user:pass, --oauth2-bearer token
const CURL_COMMAND = /\bcurl\b/g;
const CURL_USER_OPTION = new RegExp(String.raw`(^|${GAP})(-u${GAP}*|--(?:user|oauth2-bearer)(?:${GAP}+|=))(?=\S)`, 'g');
// docker login -p value, --password value, --password=value (--password-stdin stays)
const DOCKER_LOGIN_COMMAND = new RegExp(String.raw`\bdocker${GAP}+login\b`, 'g');
const DOCKER_PASSWORD_OPTION = new RegExp(String.raw`(^|${GAP})(-p${GAP}*|--password(?:${GAP}+|=))(?=\S)`, 'g');
// Values left alone: references, versions, YAML structure and keywords
const KEEP_VALUE = [
  /^$/,
  REFERENCE,
  /^[{[|>&*!]/, // a mapping, a list, a block scalar, an anchor/alias, a tag; >= and * version specifiers
  /^(null|true|false|~|inherit|latest|next)$/i,
  /^(?:[\^~<>=!]=?\s*)?v?\d+(?:\.[0-9A-Za-z*+-]+)+$/, // 1.2.3, ^9.0.2, ~=3.3
  /^[a-z][a-z0-9+.-]*:/i, // github:org/repo, file:../x, npm:..., workspace:*, URLs (userinfo already redacted)
  new RegExp(`^${REDACTED}$`)
];
const keepValue = (value) => KEEP_VALUE.some((pattern) => pattern.test(value.trim()));

// The value of one assignment, from `start` to at most the end of its line, or to the
// closing `enclosingQuote` when the assignment sits inside a quoted string
// (-H "X-Api-Key: value" https://...): the quote and the rest of the line stay
function redactValue(text, start, { jsonKey, op, spaced, enclosingQuote }) {
  const lineEnd = text.indexOf('\n', start);
  let rest = text.slice(start, lineEnd === -1 ? text.length : lineEnd);
  if (enclosingQuote) {
    const close = rest.indexOf(enclosingQuote);
    if (close !== -1) rest = rest.slice(0, close);
  }
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const close = rest.indexOf(quote, 1);
    const length = close === -1 ? rest.length : close + 1;
    const inner = rest.slice(1, close === -1 ? rest.length : close);
    if (keepValue(inner)) return { end: start + length, replacement: rest.slice(0, length) };
    return { end: start + length, replacement: `${quote}${REDACTED}${close === -1 ? '' : quote}` };
  }
  let length;
  if (jsonKey) {
    length = rest.search(/[,}\]\s]|$/);
  } else if (op === ':' || spaced) {
    // YAML, TOML or ini: to the end of the line, before a " #" comment
    const comment = rest.search(/\s+#/);
    length = comment === -1 ? rest.length : comment;
    while (length > 0 && /\s/.test(rest[length - 1])) length -= 1;
  } else {
    // KEY=value in a shell command, a .env line or a URL query: to the next separator
    length = rest.search(/[\s;&|)"'`]|$/);
  }
  const value = rest.slice(0, length);
  if (keepValue(value)) return { end: start + length, replacement: value };
  return { end: start + length, replacement: jsonKey ? `"${REDACTED}"` : REDACTED };
}

function redactAssignments(text) {
  let output = '';
  let last = 0;
  ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = ASSIGNMENT.exec(text))) {
    const [whole, lead, quote, key, before, op, after] = match;
    if (!SENSITIVE_KEY.test(key)) continue;
    const valueStart = match.index + whole.length;
    const enclosingQuote = quote === '' && QUOTES.includes(lead) ? lead : null;
    const { end, replacement } = redactValue(text, valueStart, { jsonKey: quote !== '', op, spaced: before !== '' || after !== '', enclosingQuote });
    output += text.slice(last, valueStart) + replacement;
    last = end;
    ASSIGNMENT.lastIndex = end;
  }
  return output + text.slice(last);
}

// Scheme word kept, credential replaced; references, empty values and a scheme alone stay
function redactAuthorizationValue(value) {
  const body = value.replace(/\s+$/, '');
  const tail = value.slice(body.length);
  const match = body.match(AUTH_VALUE);
  const [scheme, gap, credential] = match ? [match[1], match[2], match[3]] : ['', '', body];
  if (credential === '' || REFERENCE.test(credential) || (!match && AUTH_SCHEME_ALONE.test(credential))) return value;
  return `${scheme}${gap}${REDACTED}${tail}`;
}

// The value ends at its own closing quote when it is quoted ("Authorization": "Bearer x"),
// at the enclosing string's closing quote when the header sits inside one
// (-H "Authorization: Bearer x" https://...), otherwise at the end of the line
function redactAuthorizationHeaders(text) {
  let output = '';
  let last = 0;
  AUTH_HEADER.lastIndex = 0;
  let match;
  while ((match = AUTH_HEADER.exec(text))) {
    const [whole, lead, keyQuote] = match;
    const valueStart = match.index + whole.length;
    const newline = text.indexOf('\n', valueStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const rest = text.slice(valueStart, lineEnd);
    let start = valueStart;
    let end = lineEnd;
    if (QUOTES.includes(rest[0])) {
      const close = rest.indexOf(rest[0], 1);
      start += 1;
      if (close !== -1) end = valueStart + close;
    } else if (keyQuote === '' && QUOTES.includes(lead)) {
      const close = rest.indexOf(lead);
      if (close !== -1) end = valueStart + close;
    }
    output += text.slice(last, start) + redactAuthorizationValue(text.slice(start, end));
    last = end;
    AUTH_HEADER.lastIndex = Math.max(end, valueStart);
  }
  return output + text.slice(last);
}

// The value after one command-line option: a quoted string (quotes kept) or one word
function redactOptionValues(segment, option) {
  let output = '';
  let last = 0;
  option.lastIndex = 0;
  let match;
  while ((match = option.exec(segment))) {
    const start = match.index + match[0].length;
    const quote = QUOTES.includes(segment[start]) ? segment[start] : null;
    let valueStart = start;
    let valueEnd;
    if (quote) {
      const close = segment.indexOf(quote, start + 1);
      valueStart = start + 1;
      valueEnd = close === -1 ? segment.length : close;
    } else {
      const stop = segment.slice(start).search(/[\s"'`]/);
      valueEnd = stop === -1 ? segment.length : start + stop;
    }
    const value = segment.slice(valueStart, valueEnd);
    if (value !== '' && value !== REDACTED && !REFERENCE.test(value)) {
      output += segment.slice(last, valueStart) + REDACTED;
      last = valueEnd;
    }
    option.lastIndex = Math.max(valueEnd, start);
  }
  return output + segment.slice(last);
}

// Applies `option` only inside each `command` on a line, so docker run -p 8080:80 or
// mkdir -p dir elsewhere on the line is never touched
function redactCommandOptions(line, command, option) {
  let output = '';
  let last = 0;
  command.lastIndex = 0;
  let match;
  while ((match = command.exec(line))) {
    if (match.index < last) continue;
    const stop = line.slice(match.index + match[0].length).search(COMMAND_END);
    const end = stop === -1 ? line.length : match.index + match[0].length + stop;
    output += line.slice(last, match.index) + redactOptionValues(line.slice(match.index, end), option);
    last = end;
    command.lastIndex = end;
  }
  return output + line.slice(last);
}

// Physical lines grouped into logical lines: a line ending in "\" is joined with the
// next one, newline, "\" and indentation kept byte for byte
function logicalLines(text) {
  const groups = [];
  let current = null;
  for (const line of text.split('\n')) {
    current = current === null ? line : `${current}\n${line}`;
    if (!CONTINUED_LINE.test(line)) {
      groups.push(current);
      current = null;
    }
  }
  if (current !== null) groups.push(current);
  return groups;
}

const redactCommandLines = (text) => logicalLines(text).map((line) =>
  redactCommandOptions(redactCommandOptions(line, CURL_COMMAND, CURL_USER_OPTION), DOCKER_LOGIN_COMMAND, DOCKER_PASSWORD_OPTION)
).join('\n');

/**
 * redactCredentials(text) -> text with credentials replaced by REDACTED (best effort):
 * (a) URL userinfo: scheme://user:pass@ and scheme://token@ -> scheme://REDACTED@
 *     (an SSH user name alone stays: git+ssh://git@github.com/...)
 * (b) private key blocks and every token matching SECRET_PATTERNS (agents/files.js)
 * (c) the value of KEY=value, KEY: value and key = "value" when the key contains TOKEN,
 *     SECRET, PASSWORD, PASSWD, API_KEY or PRIVATE_KEY; ${{ ... }}, ${VAR} and $VAR
 *     references, empty values and version specifiers stay. Inside a quoted string
 *     (-H "X-Api-Key: value" https://...) the value ends at the closing quote.
 * (d) Slack (hooks.slack.com/services/, /workflows/) and Discord (discord.com and
 *     discordapp.com /api/webhooks/) webhook URLs: the path after that prefix
 * (e) Authorization: and Proxy-Authorization: headers: the scheme word stays
 *     (Authorization: Bearer REDACTED); the value ends at the closing quote when the
 *     header is quoted, otherwise at the end of the line
 * (f) Dockerfile ENV KEY value and ARG KEY value (space form) with a sensitive key:
 *     the rest of the line
 * (g) curl -u / --user / --oauth2-bearer values, and docker login -p / --password values
 *     (only within a docker login command; --password-stdin stays). A command continued
 *     with "\" at the end of a line is one command; the layout is kept byte for byte.
 * In (d) to (g), ${{ ... }}, ${VAR} and $VAR references stay. Line-based (logical lines
 * for (g)), so a value never runs past its line. Dependency names, versions and hosts are kept.
 */
export function redactCredentials(text) {
  let output = String(text ?? '');
  output = output.replace(URL_USERINFO, (whole, scheme, userinfo) =>
    (SSH_SCHEME.test(scheme) && !userinfo.includes(':') ? whole : `${scheme}${REDACTED}@`));
  output = output.replace(WEBHOOK_URL, (whole, prefix, rest) => (REFERENCE.test(rest) ? whole : `${prefix}${REDACTED}`));
  output = output.replace(PEM_BLOCK, REDACTED);
  for (const { regex, keepsLead } of SECRET_TOKENS) {
    output = output.replace(regex, (whole, lead) => `${keepsLead ? lead : ''}${REDACTED}`);
  }
  output = redactAuthorizationHeaders(output);
  output = redactCommandLines(output);
  output = output.replace(DOCKER_ENV_SPACE, (whole, head, key, gap, value, tail) =>
    (SENSITIVE_KEY.test(key) && !REFERENCE.test(value) ? `${head}${key}${gap}${REDACTED}${tail}` : whole));
  return redactAssignments(output);
}

// Read up to cap characters of a repository file, redacted. The file is read 1 KB past
// the cap and its last, incomplete line dropped, so redaction always sees whole lines:
// a credential is never split by the cut and left half-visible.
const READ_LOOKAHEAD = 1024;
async function readRedacted(repoPath, relativePath, cap) {
  const read = await readRepoFile(repoPath, relativePath, { maxBytes: cap + READ_LOOKAHEAD });
  let text = read.text;
  if (read.truncated) text = text.slice(0, text.lastIndexOf('\n') + 1);
  text = redactCredentials(text);
  const truncated = read.truncated || text.length > cap;
  return { text: text.length > cap ? text.slice(0, cap) : text, truncated };
}

// Reads with per-file and total caps, redacted; returns { included: [{ name, content, truncated }], omitted: [name] }
async function readCapped(repoPath, names, perFileCap, totalCap) {
  const included = [];
  const omitted = [];
  let used = 0;
  for (const name of names) {
    if (isForbiddenFileName(name)) continue;
    const remaining = totalCap - used;
    if (remaining <= 0) {
      omitted.push(name);
      continue;
    }
    let read;
    try {
      read = await readRedacted(repoPath, fromPosix(name), perFileCap);
    } catch {
      continue; // refused (symlink, not a regular file) or unreadable: never sent
    }
    let content = read.text;
    let truncated = read.truncated;
    if (content.length > remaining) {
      content = content.slice(0, remaining);
      truncated = true;
    }
    used += content.length;
    included.push({ name, content, truncated });
  }
  return { included, omitted };
}

// ---------------------------------------------------------------------------
// Dependency names

// PEP 503 normalisation: "Flask_Login" -> "flask-login"
const normalizeName = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
const REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

export function parseRequirementNames(text) {
  const names = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line === '' || line.startsWith('-')) continue; // -r, -e, --index-url and other options
    if (/^[a-z+]+:\/\//i.test(line)) continue; // a bare URL
    const match = line.match(REQUIREMENT_NAME);
    if (match) names.push(normalizeName(match[1]));
  }
  return names;
}

// Without a TOML parser: [project] dependencies / optional-dependencies arrays,
// [dependency-groups] arrays and the keys of Poetry / Pipfile dependency tables
export function parseTomlDependencyNames(text) {
  const names = [];
  let table = '';
  let inArray = false;
  const takeQuoted = (line) => {
    for (const match of line.matchAll(/["']([^"']+)["']/g)) {
      const name = match[1].match(REQUIREMENT_NAME);
      if (name) names.push(normalizeName(name[1]));
    }
  };
  // A "]" inside a quoted string ("uvicorn[standard]") does not close the array
  const closesArray = (fragment) => fragment.replace(/"[^"]*"|'[^']*'/g, '').includes(']');
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s#.*$/, '').trim();
    if (inArray) {
      takeQuoted(line);
      if (closesArray(line)) inArray = false;
      continue;
    }
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (header) {
      table = header[1].toLowerCase();
      continue;
    }
    const arrayTable = table === 'project' || table === 'project.optional-dependencies' || table === 'dependency-groups';
    const keyTable = /^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/.test(table) || table === 'packages' || table === 'dev-packages';
    if (arrayTable) {
      const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*\[(.*)$/);
      if (assignment && (table !== 'project' || assignment[1] === 'dependencies')) {
        takeQuoted(assignment[2]);
        if (!closesArray(assignment[2])) inArray = true;
      }
    } else if (keyTable) {
      const key = line.match(/^["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*=/);
      if (key && key[1].toLowerCase() !== 'python') names.push(normalizeName(key[1]));
    }
  }
  return names;
}

const PYTHON_DEPENDENCY_FILES = [
  ['requirements.txt', parseRequirementNames],
  ['requirements-dev.txt', parseRequirementNames],
  ['pyproject.toml', parseTomlDependencyNames],
  ['Pipfile', parseTomlDependencyNames]
];

// Dependency names from the top-level Python manifests (each read up to MANIFEST_FILE_CAP),
// parsed from the redacted text, the same text the prompts carry
export async function readPythonDependencyNames(repoPath, projectFiles) {
  const names = new Set();
  for (const [file, parse] of PYTHON_DEPENDENCY_FILES) {
    if (!isFileIn(projectFiles, file)) continue;
    try {
      const { text } = await readRedacted(repoPath, file, MANIFEST_FILE_CAP);
      for (const name of parse(text)) names.add(name);
    } catch {
      // refused or unreadable
    }
  }
  return names;
}

export async function detectPythonFrameworks(repoPath, projectFiles) {
  const names = await readPythonDependencyNames(repoPath, projectFiles);
  return PYTHON_FRAMEWORKS.filter((framework) => names.has(framework));
}

// ---------------------------------------------------------------------------
// Dockerfiles

// Dockerfile, Dockerfile.<suffix> or <prefix>.Dockerfile, in any case
const DOCKERFILE_NAME = /^(?:dockerfile(?:\..+)?|.+\.dockerfile)$/i;
// ...but not documentation, text or images about one (Dockerfile.md, docs/Dockerfile.txt)
const DOCUMENT_SUFFIX = /\.(?:md|markdown|txt|rst|adoc|html|htm|pdf|png|jpg|jpeg|gif|svg)$/i;
const byDepthThenName = (a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * findDockerfiles(projectFiles) -> POSIX paths of every scanned Dockerfile at any depth
 * (backend/Dockerfile, docker/Dockerfile.prod, api.Dockerfile), shallowest first, then
 * alphabetical; a name whose last suffix is a documentation, text or image extension
 * (Dockerfile.md) is not one. Names only: nothing is read. The one source for the analyzer's docker
 * tool, its recommendation and the generator's existing configuration.
 */
export function findDockerfiles(projectFiles) {
  return Object.keys(projectFiles)
    .filter((key) => projectFiles[key] === 'file')
    .map(toPosix)
    .filter((name) => DOCKERFILE_NAME.test(path.posix.basename(name)) && !DOCUMENT_SUFFIX.test(name) && !isForbiddenFileName(name))
    .sort(byDepthThenName);
}

// ---------------------------------------------------------------------------
// Evidence

const manifestText = (manifests, name) => manifests.find((manifest) => manifest.name === name)?.content ?? null;

function parsePackageJson(text) {
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null; // truncated or invalid
  }
}

/**
 * collectRepositoryEvidence(repoPath, projectFiles) -> {
 *   manifests, manifestsOmitted, existingConfig: { names, excerpts, omitted },
 *   entryPoints, testEvidence, linterEvidence, pythonDependencies
 * }
 */
export async function collectRepositoryEvidence(repoPath, projectFiles) {
  const present = MANIFEST_FILES.filter((name) => isFileIn(projectFiles, name));
  const { included: manifests, omitted: manifestsOmitted } = await readCapped(repoPath, present, MANIFEST_FILE_CAP, MANIFEST_TOTAL_CAP);

  // Existing container and CI configuration
  const workflowFiles = Object.keys(projectFiles)
    .map(toPosix)
    .filter((name) => /^\.github\/workflows\/[^/]+$/.test(name) && isFileIn(projectFiles, name))
    .sort();
  // Dockerfiles at any depth (the first DOCKERFILE_NAME_CAP named, then a count of the
  // rest, so they cannot crowd out the workflows; the first DOCKERFILE_EXCERPT_CAP
  // excerpted); .dockerignore and Compose files top-level only
  const dockerfiles = findDockerfiles(projectFiles);
  const unlisted = dockerfiles.length - DOCKERFILE_NAME_CAP;
  const existingNames = [
    ...dockerfiles.slice(0, DOCKERFILE_NAME_CAP),
    ...(unlisted > 0 ? [`… and ${unlisted} more ${unlisted === 1 ? 'Dockerfile' : 'Dockerfiles'}`] : []),
    ...['.dockerignore', ...COMPOSE_FILES].filter((name) => isFileIn(projectFiles, name)),
    ...workflowFiles
  ];
  const excerptNames = [
    ...dockerfiles.slice(0, DOCKERFILE_EXCERPT_CAP),
    ...workflowFiles.filter((name) => /\.ya?ml$/i.test(name))
  ];
  const { included: excerpts, omitted: excerptsOmitted } = await readCapped(repoPath, excerptNames, EXISTING_FILE_CAP, EXISTING_TOTAL_CAP);

  const packageJson = parsePackageJson(manifestText(manifests, 'package.json'));
  const pyproject = manifestText(manifests, 'pyproject.toml') ?? '';
  const procfile = manifestText(manifests, 'Procfile') ?? '';

  const entryPoints = ENTRY_POINT_FILES.filter((name) => isFileIn(projectFiles, name));
  if (typeof packageJson?.main === 'string' && packageJson.main.trim()) entryPoints.push(`package.json main: ${oneLine(packageJson.main)}`);
  if (typeof packageJson?.scripts?.start === 'string' && packageJson.scripts.start.trim()) {
    entryPoints.push(`package.json scripts.start: ${oneLine(packageJson.scripts.start)}`);
  }
  const web = procfile.split(/\r?\n/).find((line) => /^web\s*:/.test(line));
  if (web) entryPoints.push(`Procfile web: ${oneLine(web.replace(/^web\s*:/, ''))}`);

  const testEvidence = [];
  if (isDirectoryIn(projectFiles, 'tests')) testEvidence.push('tests/ directory');
  if (isDirectoryIn(projectFiles, 'test')) testEvidence.push('test/ directory');
  if (isFileIn(projectFiles, 'pytest.ini')) testEvidence.push('pytest.ini');
  if (isFileIn(projectFiles, 'tox.ini')) testEvidence.push('tox.ini');
  if (/^\s*\[tool\.pytest/m.test(pyproject)) testEvidence.push('[tool.pytest] in pyproject.toml');
  const testScript = packageJson?.scripts?.test;
  if (typeof testScript === 'string' && testScript.trim() && !NPM_TEST_PLACEHOLDER.test(testScript)) {
    testEvidence.push(`package.json scripts.test: ${oneLine(testScript)}`);
  }

  const linterEvidence = [];
  for (const name of ['ruff.toml', '.ruff.toml', '.flake8']) {
    if (isFileIn(projectFiles, name)) linterEvidence.push(name);
  }
  if (/^\s*\[tool\.ruff/m.test(pyproject)) linterEvidence.push('[tool.ruff] in pyproject.toml');
  const topLevel = Object.keys(projectFiles).filter((key) => !key.includes(path.sep) && projectFiles[key] === 'file').sort();
  for (const name of topLevel) {
    if (/^\.eslintrc(\..+)?$/.test(name) || /^eslint\.config\.[^.]+$/.test(name)) linterEvidence.push(name);
  }

  const pythonDependencies = [...await readPythonDependencyNames(repoPath, projectFiles)].sort();

  return {
    manifests,
    manifestsOmitted,
    existingConfig: { names: existingNames.slice(0, EXISTING_NAME_CAP), excerpts, omitted: excerptsOmitted },
    entryPoints,
    testEvidence,
    linterEvidence,
    pythonDependencies
  };
}

// ---------------------------------------------------------------------------
// File list

/**
 * listForPrompt(projectFiles, maxPaths) -> { summary, paths }
 * Paths shallowest first, then alphabetical; directories end with "/".
 */
export function listForPrompt(projectFiles, maxPaths = PATH_LIST_CAP) {
  const entries = Object.entries(projectFiles).map(([key, kind]) => ({ path: toPosix(key), kind }));
  const files = entries.filter((entry) => entry.kind === 'file');
  const directories = entries.filter((entry) => entry.kind === 'directory');

  const extensions = new Map();
  for (const { path: filePath } of files) {
    const extension = path.posix.extname(filePath).toLowerCase();
    if (extension) extensions.set(extension, (extensions.get(extension) || 0) + 1);
  }
  const top = [...extensions.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([extension, count]) => `${extension} ${count}`);

  const sorted = entries
    .map((entry) => ({ ...entry, depth: entry.path.split('/').length }))
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const shown = sorted.slice(0, Math.max(0, maxPaths)).map((entry) => (entry.kind === 'directory' ? `${entry.path}/` : entry.path));

  const summary =
    `${files.length} files and ${directories.length} directories in total; ` +
    `top extensions: ${top.length > 0 ? top.join(', ') : 'none'}; ` +
    `showing ${shown.length} of ${entries.length} paths, shallowest first`;
  return { summary, paths: shown };
}
