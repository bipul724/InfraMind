// B2.5: extraction of one raw file from an AI reply, and the three validators.
// The fixtures in fixtures/b25/ are real replies from a run on a Python repository.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractFileContent,
  findFencedBlocks,
  normalizeFileContent,
  validateDockerfile,
  validateEnvExample,
  validateWorkflow
} from '../agents/files.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'b25');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const firstInstruction = (content) => content.split('\n').find((line) => line.trim() !== '' && !line.trim().startsWith('#'));
const MARKER = 'CONTENT_MARKER_7f3a';

// No validator error may quote the file
const assertNoContentInErrors = (errors) => {
  for (const error of errors) assert.ok(!error.includes(MARKER), `error quotes content: ${error}`);
};

describe('extractFileContent with the real replies (fixtures/b25)', () => {
  test('Dockerfile.reply.txt: the Dockerfile block, without prose', () => {
    const result = extractFileContent('dockerfile', fixture('Dockerfile.reply.txt'));
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.equal(firstInstruction(result.content), 'FROM python:3.11-slim AS builder');
    assert.deepEqual(validateDockerfile(result.content), { ok: true, errors: [] });
    for (const prose of ['Here is', 'Key Optimization', '```', '### ', '**']) {
      assert.ok(!result.content.includes(prose), `prose "${prose}" in the extracted file`);
    }
    assert.ok(result.content.endsWith('CMD ["python", "app.py"]\n'));
  });

  test('ci.reply.txt (three blocks): the YAML block is chosen, then rejected by the workflow policy', () => {
    const text = fixture('ci.reply.txt');
    assert.deepEqual(findFencedBlocks(text).map((block) => block.info), ['dockerfile', 'yaml', 'bash']);

    const result = extractFileContent('githubActions', text);
    assert.ok(result.content.startsWith('name: CI/CD Pipeline\n'), 'the YAML block is the candidate');
    assert.ok(!result.content.includes('FROM python'), 'not the Dockerfile block');
    assert.ok(!result.content.includes('OPENAI_API_KEY=your'), 'not the .env block');
    assert.equal(result.ok, false);

    // Rejected for exactly the bugs the real run had
    const joined = result.errors.join('\n');
    assert.match(joined, /uses a branch ref \(master, main or HEAD\)/, '@master');
    assert.match(joined, /grants write to packages/, 'packages: write');
    assert.match(joined, /grants write to security-events/, 'security-events: write');
    assert.match(joined, /logs in to a registry \(docker\/login-action\)/, 'registry login');
    assert.match(joined, /push is not false/, 'push: true');
    assert.deepEqual(validateWorkflow(result.content), { ok: false, errors: result.errors });
  });

  test('env.reply.txt: only KEY= and comment lines', () => {
    const result = extractFileContent('envExample', fixture('env.reply.txt'));
    assert.equal(result.ok, true, result.errors.join('; '));
    const lines = result.content.split('\n').filter((line) => line.trim() !== '');
    assert.ok(lines.length > 10);
    for (const line of lines) assert.match(line, /^(#|[A-Z][A-Z0-9_]*=)/);
    assert.ok(!result.content.includes('Here is'));
    assert.ok(result.content.startsWith('# ====='));
  });
});

describe('extractFileContent rules', () => {
  test('no fences: the whole reply, trimmed, with one final newline', () => {
    const result = extractFileContent('dockerfile', '\uFEFF\n\nFROM node:20\r\nCMD ["node", "a.js"]   \n\n\n');
    assert.deepEqual(result, { content: 'FROM node:20\nCMD ["node", "a.js"]\n', ok: true, errors: [] });
  });

  test('no fences and prose: returned with errors, so the caller can decide', () => {
    const result = extractFileContent('dockerfile', 'Here is your Dockerfile:\nFROM node:20\n');
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /line 1: not a Dockerfile instruction/);
  });

  test('fences with wrong info strings: the validator picks the block', () => {
    const reply = [
      'Two blocks, both mislabelled:',
      '```text',
      'This is not a Dockerfile.',
      '```',
      '```python',
      'FROM python:3.12-slim',
      'CMD ["python", "main.py"]',
      '```'
    ].join('\n');
    const result = extractFileContent('dockerfile', reply);
    assert.deepEqual(result, { content: 'FROM python:3.12-slim\nCMD ["python", "main.py"]\n', ok: true, errors: [] });
  });

  test('a named block that fails loses to a later block that passes', () => {
    const reply = '```yaml\nnot: [valid\n```\n\n```\nname: ci\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n```\n';
    const result = extractFileContent('githubActions', reply);
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.ok(result.content.startsWith('name: ci\n'));
  });

  test('of two passing named blocks, the first in reply order wins', () => {
    const reply = '```env\nA=1\n```\nand\n```env\nB=2\n```';
    assert.equal(extractFileContent('envExample', reply).content, 'A=1\n');
  });

  test('nothing passes: the first block named for the kind, with its errors; never the prose', () => {
    const reply = 'Intro prose\n```bash\nnot an env line\n```\nOutro prose';
    const result = extractFileContent('envExample', reply);
    assert.equal(result.ok, false);
    assert.equal(result.content, 'not an env line\n');
    assert.ok(result.errors.length > 0);
  });

  test('an unclosed fence (a truncated reply) runs to the end', () => {
    const result = extractFileContent('dockerfile', 'Here:\n```dockerfile\nFROM node:20\nCMD ["node", "x.js"]');
    assert.deepEqual(result, { content: 'FROM node:20\nCMD ["node", "x.js"]\n', ok: true, errors: [] });
  });

  test('tilde fences and indented fences are recognised', () => {
    assert.equal(extractFileContent('dockerfile', '~~~docker\nFROM a\n~~~').content, 'FROM a\n');
    assert.equal(extractFileContent('dockerfile', '  ```dockerfile\n  FROM a\n  ```').content, 'FROM a\n');
  });

  test('an empty reply or block is invalid', () => {
    assert.deepEqual(extractFileContent('dockerfile', '   \n'), { content: '', ok: false, errors: ['the reply is empty'] });
    assert.deepEqual(extractFileContent('dockerfile', '```dockerfile\n```'), { content: '', ok: false, errors: ['the code block is empty'] });
  });

  test('an unknown kind throws', () => {
    assert.throws(() => extractFileContent('readme', 'x'), TypeError);
  });

  test('normalizeFileContent', () => {
    assert.equal(normalizeFileContent('\uFEFFA=1\r\n\r\n'), 'A=1\n');
    assert.equal(normalizeFileContent(''), '');
  });
});

describe('validateDockerfile', () => {
  const passing = {
    'a minimal file': 'FROM alpine:3.20\n',
    'ARG first, comments, continuations, blank lines inside one': [
      '# syntax=docker/dockerfile:1',
      'ARG PYTHON_VERSION=3.12',
      'FROM python:${PYTHON_VERSION}-slim AS base',
      'RUN apt-get update \\',
      '    # a comment inside a continuation',
      '',
      '    && rm -rf /var/lib/apt/lists/*',
      'from base',
      'HEALTHCHECK CMD curl -f http://localhost/health || exit 1',
      'CMD ["python", "app.py"]'
    ].join('\n'),
    'a heredoc': 'FROM alpine\nRUN <<EOF\napk add curl\necho done\nEOF\nCMD ["sh"]\n',
    'the escape directive': '# escape=`\nFROM mcr.microsoft.com/windows/servercore\nRUN dir `\n    c:\\\n'
  };
  for (const [name, text] of Object.entries(passing)) {
    test(`passes: ${name}`, () => assert.deepEqual(validateDockerfile(text), { ok: true, errors: [] }));
  }

  const failing = {
    'a prose first line': [`Here is the optimized Dockerfile ${MARKER}:\nFROM node:20\n`, /line 1: not a Dockerfile instruction/],
    'a code fence': ['```dockerfile\nFROM node:20\n```\n', /line 1: a Markdown code fence/],
    'starts with RUN': ['RUN echo hi\nFROM node:20\n', /the first instruction must be FROM or ARG/],
    'ARG only, no FROM': ['ARG X=1\n', /no FROM instruction/],
    'an unknown instruction': [`FROM node:20\nINSTALL ${MARKER}\n`, /line 2: not a Dockerfile instruction/],
    'trailing notes after the file': [`FROM node:20\nCMD ["node"]\n\nKey Optimization ${MARKER}:\n1. **Multi-stage**\n`, /line 4: not a Dockerfile instruction/],
    'only comments': ['# nothing\n\n', /no Dockerfile instructions found/],
    'an unclosed heredoc': ['FROM alpine\nRUN <<EOF\necho\n', /a heredoc is not closed/]
  };
  for (const [name, [text, expected]] of Object.entries(failing)) {
    test(`fails: ${name}`, () => {
      const result = validateDockerfile(text);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), expected);
      assertNoContentInErrors(result.errors);
    });
  }
});

describe('validateWorkflow', () => {
  const base = (overrides = {}) => {
    const lines = {
      name: 'name: CI',
      on: 'on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]',
      permissions: 'permissions:\n  contents: read',
      jobs: 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: "3.12"\n      - run: pip install -r requirements.txt\n      - run: docker build -t app:ci .',
      ...overrides
    };
    return Object.values(lines).filter((value) => value !== null).join('\n') + '\n';
  };

  const passing = {
    'the policy workflow, with "on" as a key (YAML 1.2 keeps it a string)': base(),
    'read-all permissions and build-push-action with push: false': base({
      permissions: 'permissions: read-all',
      jobs: 'jobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker/build-push-action@v6\n        with:\n          push: false\n          load: true\n          tags: app:ci'
    }),
    'a list trigger, a job with read permissions and a scan of the local tag': base({
      on: 'on: [push, pull_request]',
      jobs: 'jobs:\n  scan:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@v4\n      - run: docker build -t app:ci .\n      - uses: aquasecurity/trivy-action@0.28.0\n        with:\n          image-ref: app:ci'
    }),
    'GITHUB_TOKEN is not a repository secret': base({
      jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh api /rate_limit\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'
    })
  };
  for (const [name, text] of Object.entries(passing)) {
    test(`passes: ${name}`, () => assert.deepEqual(validateWorkflow(text), { ok: true, errors: [] }));
  }

  const failing = {
    '@main': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@main' }), /job 1 step 1: uses a branch ref/],
    '@master': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: aquasecurity/trivy-action@master' }), /uses a branch ref/],
    '@HEAD and no ref': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@HEAD\n      - uses: actions/checkout' }), /step 1: uses a branch ref[\s\S]*step 2: uses has no @ref/],
    'push: true': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker/build-push-action@v6\n        with:\n          push: true' }), /push is not false/],
    'push from an expression': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker/build-push-action@v6\n        with:\n          push: ${{ github.event_name != \'pull_request\' }}' }), /push is not false/],
    'docker/login-action': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker/login-action@v3' }), /logs in to a registry/],
    'docker push in a run step': [base({ jobs: `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: docker push ghcr.io/${MARKER}` }), /pushes an image to a registry/],
    'packages: write': [base({ permissions: 'permissions:\n  contents: read\n  packages: write' }), /top-level permissions: grants write to packages/],
    'contents: write (read-only policy)': [base({ permissions: 'permissions:\n  contents: write' }), /grants write to contents/],
    'job-level write-all': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions: write-all\n    steps:\n      - run: echo' }), /job 1 permissions: grants write-all/],
    'missing permissions': [base({ permissions: null }), /missing top-level permissions/],
    'missing on': [base({ on: null }), /missing on/],
    'empty jobs': [base({ jobs: 'jobs: {}' }), /missing jobs, or jobs is empty/],
    'a job without runs-on or steps': [base({ jobs: `jobs:\n  ${MARKER}:\n    name: x` }), /job 1: missing runs-on[\s\S]*job 1: missing steps/],
    'a repository secret': [base({ jobs: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          KEY: ${{ secrets.OPENAI_API_KEY }}' }), /uses a repository secret/],
    'a code fence': ['```yaml\nname: ci\n```\n', /line 1: a Markdown code fence/],
    'invalid YAML': [`name: ci\non: [push\njobs: ${MARKER}\n`, /^YAML error/],
    'prose instead of YAML': [`Here is the workflow ${MARKER}.\n`, /the workflow is not a mapping/],
    'two documents': ['name: a\n---\nname: b\n', /more than one YAML document/]
  };
  for (const [name, [text, expected]] of Object.entries(failing)) {
    test(`fails: ${name}`, () => {
      const result = validateWorkflow(text);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), expected);
      assertNoContentInErrors(result.errors);
    });
  }

  test('an unknown permission scope is not repeated in the error', () => {
    const result = validateWorkflow(base({ permissions: `permissions:\n  ${MARKER}: write` }));
    assert.deepEqual(result.errors, ['top-level permissions: grants write to a scope (only read access is allowed)']);
  });
});

describe('validateEnvExample', () => {
  const passing = {
    'keys and comments': '# Server\nPORT=3000\nHOST=0.0.0.0\n',
    'empty values, quotes and the guesses block': 'DATABASE_URL=\nGREETING="hello world"\n\n# Possibly needed (not found in the repository):\n# SENTRY_DSN=your-sentry-dsn\nLOG_LEVEL=info\n',
    'placeholder secrets': 'OPENAI_API_KEY=your-openai-api-key\nGITHUB_TOKEN=your-github-token\nAWS_ACCESS_KEY_ID=your-aws-access-key-id\n'
  };
  for (const [name, text] of Object.entries(passing)) {
    test(`passes: ${name}`, () => assert.deepEqual(validateEnvExample(text), { ok: true, errors: [] }));
  }

  const failing = {
    'a prose line': [`Here is your .env.example ${MARKER}\nPORT=1\n`, /line 1: not a comment or KEY=value line/],
    'a code fence': ['```bash\nPORT=1\n```\n', /line 1: a Markdown code fence/],
    'a lower-case key': ['port=1\n', /line 1: the key must be upper case/],
    'export prefix': ['export PORT=1\n', /line 1: not a comment or KEY=value line/],
    'spaces around =': ['PORT = 1\n', /not a comment or KEY=value line/],
    'only comments': ['# nothing here\n', /no KEY=value line/],
    'an OpenAI-looking key': [`OPENAI_API_KEY=sk-proj-${MARKER}\n`, /line 1: the value looks like a real secret/],
    'a GitHub token': ['GITHUB_TOKEN=ghp_abcdefghijklmnop\n', /the value looks like a real secret/],
    'an AWS key id': ['AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n', /the value looks like a real secret/],
    'a private key': ['KEY=-----BEGIN PRIVATE KEY-----\n', /the value looks like a real secret/],
    'a secret in a commented-out key': ['PORT=1\n# OPENAI_API_KEY=sk-live123456\n', /line 2: a comment contains a value that looks like a real secret/]
  };
  for (const [name, [text, expected]] of Object.entries(failing)) {
    test(`fails: ${name}`, () => {
      const result = validateEnvExample(text);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), expected);
      assertNoContentInErrors(result.errors);
    });
  }
});

describe('error lists', () => {
  test('are capped at 10 entries plus a count', () => {
    const result = validateEnvExample(Array.from({ length: 30 }, () => 'bad line').join('\n'));
    assert.equal(result.errors.length, 11);
    assert.equal(result.errors.at(-1), '21 more problems');
  });
});
