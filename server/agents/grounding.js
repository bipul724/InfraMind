/**
 * Repository grounding for the generator (B2.5): what the AI is told about the cloned
 * repository besides its file names. No AI here.
 *
 * Only the top-level files in MANIFEST_FILES are ever read as manifests, plus the
 * existing Dockerfile and workflow excerpts, always through readRepoFile (symlink-safe).
 * Everything returned here is repository content and must be presented to the AI as
 * data, never as instructions.
 */

import fs from 'fs-extra';
import { open } from 'node:fs/promises';
import path from 'path';
import { isPathInside } from '../utils/repository.js';
import { SECRET_PATTERNS } from './files.js';

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
export const PATH_LIST_CAP = 300;
export const TRUNCATED_MARKER = '[truncated]';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const ENTRY_POINT_FILES = ['app.py', 'main.py', 'wsgi.py', 'asgi.py', 'manage.py', 'server.py', 'run.py', 'src/main.py', 'src/app.py'];
export const PYTHON_FRAMEWORKS = Object.freeze(['django', 'flask', 'fastapi', 'streamlit', 'gradio', 'gunicorn', 'uvicorn']);
const NPM_TEST_PLACEHOLDER = /no test specified/i;
const VALUE_CAP = 200;

// projectStructure keys use the platform separator; prompts always show "/"
const toPosix = (relativePath) => relativePath.split(path.sep).join('/');
const fromPosix = (relativePath) => relativePath.split('/').join(path.sep);
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
// Values left alone: references, versions, YAML structure and keywords
const KEEP_VALUE = [
  /^$/,
  /\$\{\{|\$\{|\$[A-Za-z_]/, // ${{ ... }}, ${VAR}, $VAR
  /^[{[|>&*!]/, // a mapping, a list, a block scalar, an anchor/alias, a tag; >= and * version specifiers
  /^(null|true|false|~|inherit|latest|next)$/i,
  /^(?:[\^~<>=!]=?\s*)?v?\d+(?:\.[0-9A-Za-z*+-]+)+$/, // 1.2.3, ^9.0.2, ~=3.3
  /^[a-z][a-z0-9+.-]*:/i, // github:org/repo, file:../x, npm:..., workspace:*, URLs (userinfo already redacted)
  new RegExp(`^${REDACTED}$`)
];
const keepValue = (value) => KEEP_VALUE.some((pattern) => pattern.test(value.trim()));

// The value of one assignment, from `start` to at most the end of its line
function redactValue(text, start, { jsonKey, op, spaced }) {
  const lineEnd = text.indexOf('\n', start);
  const rest = text.slice(start, lineEnd === -1 ? text.length : lineEnd);
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
    const [whole, , quote, key, before, op, after] = match;
    if (!SENSITIVE_KEY.test(key)) continue;
    const valueStart = match.index + whole.length;
    const { end, replacement } = redactValue(text, valueStart, { jsonKey: quote !== '', op, spaced: before !== '' || after !== '' });
    output += text.slice(last, valueStart) + replacement;
    last = end;
    ASSIGNMENT.lastIndex = end;
  }
  return output + text.slice(last);
}

/**
 * redactCredentials(text) -> text with credentials replaced by REDACTED (best effort):
 * (a) URL userinfo: scheme://user:pass@ and scheme://token@ -> scheme://REDACTED@
 *     (an SSH user name alone stays: git+ssh://git@github.com/...)
 * (b) private key blocks and every token matching SECRET_PATTERNS (agents/files.js)
 * (c) the value of KEY=value, KEY: value and key = "value" when the key contains TOKEN,
 *     SECRET, PASSWORD, PASSWD, API_KEY or PRIVATE_KEY; ${{ ... }}, ${VAR} and $VAR
 *     references, empty values and version specifiers stay
 * Dependency names, versions and hosts are kept.
 */
export function redactCredentials(text) {
  let output = String(text ?? '');
  output = output.replace(URL_USERINFO, (whole, scheme, userinfo) =>
    (SSH_SCHEME.test(scheme) && !userinfo.includes(':') ? whole : `${scheme}${REDACTED}@`));
  output = output.replace(PEM_BLOCK, REDACTED);
  for (const { regex, keepsLead } of SECRET_TOKENS) {
    output = output.replace(regex, (whole, lead) => `${keepsLead ? lead : ''}${REDACTED}`);
  }
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
  const existingNames = [
    ...['Dockerfile', '.dockerignore', ...COMPOSE_FILES].filter((name) => isFileIn(projectFiles, name)),
    ...workflowFiles
  ];
  const excerptNames = existingNames.filter((name) => name === 'Dockerfile' || (name.startsWith('.github/') && /\.ya?ml$/i.test(name)));
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
