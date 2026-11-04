/**
 * Generated-file extraction and validation (B2.5).
 *
 * Pure functions, no I/O. Every error string is built from fixed text, line numbers and
 * positions only, never from file content: errors go to the server log and into the
 * repair prompt, and AI output is untrusted.
 */

import { parseAllDocuments } from 'yaml';

const MAX_ERRORS = 10;
const FENCE_LINE = /^\s*(```|~~~)/;

const result = (errors) => {
  const unique = [...new Set(errors)];
  const capped = unique.length > MAX_ERRORS
    ? [...unique.slice(0, MAX_ERRORS), `${unique.length - MAX_ERRORS} more problems`]
    : unique;
  return { ok: capped.length === 0, errors: capped };
};

const toLines = (text) => String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');

// ---------------------------------------------------------------------------
// Dockerfile

export const DOCKERFILE_INSTRUCTIONS = Object.freeze([
  'FROM', 'ARG', 'ENV', 'RUN', 'COPY', 'ADD', 'WORKDIR', 'EXPOSE', 'USER', 'CMD',
  'ENTRYPOINT', 'HEALTHCHECK', 'LABEL', 'VOLUME', 'STOPSIGNAL', 'SHELL', 'ONBUILD'
]);
const INSTRUCTION = new RegExp(`^\\s*(${DOCKERFILE_INSTRUCTIONS.join('|')})(\\s|$)`, 'i');
// Heredoc starts on an instruction line: <<EOF, <<-EOF, <<"EOF", <<'EOF'
const HEREDOC = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/g;

export function validateDockerfile(text) {
  const lines = toLines(text);
  const errors = [];
  // A "# escape=`" parser directive on the first line switches the continuation character
  const escapeChar = /^#\s*escape\s*=\s*`\s*$/i.test(lines[0] ?? '') ? '`' : '\\';

  let first = null; // first instruction keyword
  let fromCount = 0;
  let continuing = false;
  let heredocs = []; // delimiters still open, in order

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    if (FENCE_LINE.test(raw)) {
      errors.push(`line ${lineNo}: a Markdown code fence`);
      return;
    }
    if (heredocs.length > 0) {
      if (raw.trim() === heredocs[0]) heredocs.shift();
      return;
    }
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return; // blank or comment, also inside a continuation

    if (!continuing) {
      const match = raw.match(INSTRUCTION);
      if (!match) {
        errors.push(`line ${lineNo}: not a Dockerfile instruction or a continuation of one`);
        return;
      }
      const keyword = match[1].toUpperCase();
      if (first === null) first = keyword;
      if (keyword === 'FROM') fromCount += 1;
    }
    for (const heredoc of raw.matchAll(HEREDOC)) heredocs.push(heredoc[2]);
    continuing = trimmed.endsWith(escapeChar);
  });

  if (first === null) {
    errors.push('no Dockerfile instructions found');
  } else if (first !== 'FROM' && first !== 'ARG') {
    errors.push('the first instruction must be FROM or ARG');
  }
  if (first !== null && fromCount === 0) errors.push('no FROM instruction');
  if (heredocs.length > 0) errors.push('a heredoc is not closed');
  return result(errors);
}

// ---------------------------------------------------------------------------
// GitHub Actions workflow

// GitHub's permission scopes: the only names an error message may repeat
const PERMISSION_SCOPES = new Set([
  'actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions', 'id-token',
  'issues', 'models', 'packages', 'pages', 'pull-requests', 'repository-projects',
  'security-events', 'statuses'
]);
const FORBIDDEN_REFS = new Set(['master', 'main', 'head']);
const DOCKER_PUSH = /\b(docker|podman)\s+(image\s+)?push\b/i;
const PUSH_FLAG = /\b(docker|podman|buildx)\b[^\n]*\s--push\b/i;

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// permissions: "read-all", "write-all", {} or { scope: read|write|none }
function checkPermissions(value, where, errors) {
  if (typeof value === 'string') {
    if (value.trim().toLowerCase() === 'write-all') errors.push(`${where}: grants write-all`);
    else if (value.trim().toLowerCase() !== 'read-all') errors.push(`${where}: not a permissions value`);
    return;
  }
  if (!isMapping(value)) {
    errors.push(`${where}: must be a mapping of scopes`);
    return;
  }
  for (const [scope, level] of Object.entries(value)) {
    if (String(level).trim().toLowerCase() === 'write') {
      const name = PERMISSION_SCOPES.has(scope) ? scope : 'a scope';
      errors.push(`${where}: grants write to ${name} (only read access is allowed)`);
    }
  }
}

// owner/repo[/path]@ref; the ref must not be a moving branch name
function checkUses(value, where, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${where}: uses is empty`);
    return;
  }
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) {
    errors.push(`${where}: uses has no @ref`);
    return;
  }
  if (FORBIDDEN_REFS.has(value.slice(at + 1).trim().toLowerCase())) {
    errors.push(`${where}: uses a branch ref (master, main or HEAD); use a major-version tag`);
  }
  if (/^docker\/login-action@/i.test(value.trim())) {
    errors.push(`${where}: logs in to a registry (docker/login-action)`);
  }
}

function checkStep(step, where, errors) {
  if (!isMapping(step)) {
    errors.push(`${where}: not a mapping`);
    return;
  }
  const hasUses = Object.prototype.hasOwnProperty.call(step, 'uses');
  const hasRun = Object.prototype.hasOwnProperty.call(step, 'run');
  if (!hasUses && !hasRun) errors.push(`${where}: has neither uses nor run`);
  if (hasUses) checkUses(step.uses, where, errors);
  if (hasRun && typeof step.run === 'string') {
    if (DOCKER_PUSH.test(step.run) || PUSH_FLAG.test(step.run)) errors.push(`${where}: pushes an image to a registry`);
  }
  if (isMapping(step.with) && Object.prototype.hasOwnProperty.call(step.with, 'push')) {
    const push = step.with.push;
    if (!(push === false || String(push).trim().toLowerCase() === 'false')) {
      errors.push(`${where}: push is not false`);
    }
  }
  const serialized = JSON.stringify(step);
  if (/\bsecrets\.(?!GITHUB_TOKEN\b)[A-Za-z_]/.test(serialized)) {
    errors.push(`${where}: uses a repository secret (the workflow must not need secrets)`);
  }
}

export function validateWorkflow(text) {
  const errors = [];
  const lines = toLines(text);
  lines.forEach((line, index) => {
    if (FENCE_LINE.test(line)) errors.push(`line ${index + 1}: a Markdown code fence`);
  });
  if (errors.length > 0) return result(errors);

  // YAML 1.2 (the library default): the key "on" stays the string "on"
  let documents;
  try {
    documents = parseAllDocuments(lines.join('\n'), { prettyErrors: false });
  } catch {
    return result(['YAML does not parse']);
  }
  if (!Array.isArray(documents) || documents.length !== 1) {
    return result([documents?.length > 1 ? 'more than one YAML document' : 'no YAML document']);
  }
  const [document] = documents;
  if (document.errors.length > 0) {
    // Codes and positions only: yaml's messages quote the source
    return result(document.errors.map((error) => {
      const line = error.linePos?.[0]?.line;
      return `YAML error ${error.code ?? 'PARSE'}${line ? ` at line ${line}` : ''}`;
    }));
  }

  let workflow;
  try {
    workflow = document.toJS({ maxAliasCount: 50 });
  } catch {
    return result(['YAML does not parse']);
  }
  if (!isMapping(workflow)) return result(['the workflow is not a mapping']);

  const trigger = workflow.on;
  if (trigger === undefined || trigger === null || trigger === '' ||
      (Array.isArray(trigger) && trigger.length === 0) || (isMapping(trigger) && Object.keys(trigger).length === 0)) {
    errors.push('missing on (the workflow triggers)');
  }

  if (!Object.prototype.hasOwnProperty.call(workflow, 'permissions')) {
    errors.push('missing top-level permissions');
  } else {
    checkPermissions(workflow.permissions, 'top-level permissions', errors);
  }

  const jobs = workflow.jobs;
  if (!isMapping(jobs) || Object.keys(jobs).length === 0) {
    errors.push('missing jobs, or jobs is empty');
    return result(errors);
  }

  // Jobs and steps are named by position: their ids and names are file content
  Object.values(jobs).forEach((job, jobIndex) => {
    const where = `job ${jobIndex + 1}`;
    if (!isMapping(job)) {
      errors.push(`${where}: not a mapping`);
      return;
    }
    const runsOn = job['runs-on'];
    if (runsOn === undefined || runsOn === null || runsOn === '' || (Array.isArray(runsOn) && runsOn.length === 0)) {
      errors.push(`${where}: missing runs-on`);
    }
    if (Object.prototype.hasOwnProperty.call(job, 'uses')) checkUses(job.uses, where, errors);
    if (Object.prototype.hasOwnProperty.call(job, 'permissions')) checkPermissions(job.permissions, `${where} permissions`, errors);
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      errors.push(`${where}: missing steps, or steps is empty`);
      return;
    }
    job.steps.forEach((step, stepIndex) => checkStep(step, `${where} step ${stepIndex + 1}`, errors));
  });

  return result(errors);
}

// ---------------------------------------------------------------------------
// .env.example

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;
// Shapes of real credentials; a placeholder must not look like one. Also used to redact
// repository text before it reaches the AI (redactCredentials in agents/grounding.js)
export const SECRET_PATTERNS = Object.freeze([
  /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]/,
  /(^|[^A-Za-z0-9])sk_(live|test)_/,
  /\bgh[pousr]_[A-Za-z0-9]/,
  /\bgithub_pat_/,
  /\bAKIA[0-9A-Z]/,
  /\bASIA[0-9A-Z]{12,}/,
  /-----BEGIN/,
  /\bxox[abprs]-/,
  /\bAIza[0-9A-Za-z_-]{30,}/
]);
export const looksLikeSecret = (value) => SECRET_PATTERNS.some((pattern) => pattern.test(value));

export function validateEnvExample(text) {
  const lines = toLines(text);
  const errors = [];
  let keys = 0;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (FENCE_LINE.test(line)) {
      errors.push(`line ${lineNo}: a Markdown code fence`);
      return;
    }
    const trimmed = line.trim();
    if (trimmed === '') return;
    if (trimmed.startsWith('#')) {
      // A commented-out key can leak a credential too
      if (looksLikeSecret(trimmed)) errors.push(`line ${lineNo}: a comment contains a value that looks like a real secret`);
      return;
    }
    const match = line.match(ENV_LINE);
    if (!match) {
      errors.push(`line ${lineNo}: not a comment or KEY=value line`);
      return;
    }
    if (!ENV_KEY.test(match[1])) {
      errors.push(`line ${lineNo}: the key must be upper case letters, digits and underscores, starting with a letter`);
      return;
    }
    keys += 1;
    if (looksLikeSecret(match[2])) errors.push(`line ${lineNo}: the value looks like a real secret; use a placeholder`);
  });

  if (keys === 0) errors.push('no KEY=value line');
  return result(errors);
}

// ---------------------------------------------------------------------------
// Extraction

export const VALIDATORS = Object.freeze({
  dockerfile: validateDockerfile,
  githubActions: validateWorkflow,
  envExample: validateEnvExample
});

// Info strings (first word after the fence, lower case) that name each kind; '' is a bare fence
const INFO_STRINGS = Object.freeze({
  dockerfile: new Set(['dockerfile', 'docker']),
  githubActions: new Set(['yaml', 'yml']),
  envExample: new Set(['bash', 'sh', 'dotenv', 'env', 'ini', ''])
});

// Fenced blocks (``` or ~~~, 3 or more, up to 3 spaces of indentation) in reply order.
// An unclosed block runs to the end of the reply (a truncated answer).
export function findFencedBlocks(text) {
  const lines = toLines(text);
  const blocks = [];
  let open = null;
  for (const line of lines) {
    if (!open) {
      const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
      if (match && !(match[2][0] === '`' && match[3].includes('`'))) {
        const info = (match[3].trim().split(/\s+/)[0] || '').replace(/^\{?\.?/, '').replace(/\}$/, '').toLowerCase();
        open = { indent: match[1].length, fence: match[2], info, lines: [] };
      }
      continue;
    }
    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
      blocks.push({ info: open.info, content: open.lines.join('\n') });
      open = null;
      continue;
    }
    // CommonMark: remove up to the opening fence's indentation from content lines
    open.lines.push(open.indent > 0 ? line.replace(new RegExp(`^ {0,${open.indent}}`), '') : line);
  }
  if (open) blocks.push({ info: open.info, content: open.lines.join('\n') });
  return blocks;
}

// No BOM, no leading blank lines, no trailing whitespace, exactly one final newline
export function normalizeFileContent(text) {
  const body = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  return body === '' ? '' : `${body}\n`;
}

/**
 * extractFileContent(kind, text) -> { content, ok, errors }
 *
 * With fenced blocks: blocks whose info string names the kind are tried first, then the
 * others, in reply order; the first that passes the kind's validator wins. When none
 * passes, the first block named for the kind (or else the first block) is returned with
 * its errors. Without fences, the whole reply is the candidate. Prose outside a fence is
 * never part of the content when the reply has a fence.
 */
export function extractFileContent(kind, text) {
  const validate = VALIDATORS[kind];
  if (!validate) throw new TypeError('Unknown generated file kind');

  const blocks = findFencedBlocks(text);
  if (blocks.length === 0) {
    const content = normalizeFileContent(text);
    const { ok, errors } = content === '' ? { ok: false, errors: ['the reply is empty'] } : validate(content);
    return { content, ok, errors };
  }

  const named = blocks.filter((block) => INFO_STRINGS[kind].has(block.info));
  const others = blocks.filter((block) => !INFO_STRINGS[kind].has(block.info));
  let best = null;
  for (const block of [...named, ...others]) {
    const content = normalizeFileContent(block.content);
    const check = content === '' ? { ok: false, errors: ['the code block is empty'] } : validate(content);
    if (check.ok) return { content, ok: true, errors: [] };
    if (!best) best = { content, ok: false, errors: check.errors };
  }
  return best;
}
