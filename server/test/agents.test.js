import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentPipeline, scanProjectStructure } from '../agents/index.js';
import { resetDefaultAiClient } from '../ai/index.js';

let fixtureDir;
let outsideDir;
let realFetch;
const capturedBodies = [];
const capturedRequests = [];

// B1.3 used LLAMA_API_*; the AI layer reads these instead. Base URLs are local and
// unreachable: the stubbed fetch answers every request.
const STUB_KEY = 'test-agents-key-AGENTS_KEY_MARKER';
const AI_ENV = {
  AI_PROVIDERS: 'gemini,groq',
  GEMINI_API_KEY: STUB_KEY,
  GEMINI_MODEL: 'test-model-gemini',
  GEMINI_BASE_URL: 'http://127.0.0.1:9/gemini',
  GROQ_API_KEY: STUB_KEY,
  GROQ_MODEL: 'test-model-groq',
  GROQ_BASE_URL: 'http://127.0.0.1:9/groq',
  AI_TIMEOUT_MS: '2000',
  AI_CALL_BUDGET_MS: '10000',
  AI_MAX_ATTEMPTS_PER_PROVIDER: '1'
};
const savedEnv = {};
let stubMode = 'ok';
const ERROR_BODY_MARKER = 'SECRET_BODY_MARKER';

before(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-agents-fixture-'));
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-agents-outside-'));

  const outsideJson = path.join(outsideDir, 'outside.json');
  await fs.writeFile(outsideJson, JSON.stringify({ leak: 'SHOULD_NOT_APPEAR', dependencies: { SHOULD_NOT_APPEAR: '1' } }));
  await fs.mkdir(path.join(outsideDir, 'outside-subdir'));
  await fs.writeFile(path.join(outsideDir, 'outside-subdir', 'SHOULD_NOT_APPEAR.txt'), 'x');

  await fs.writeFile(
    path.join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { start: 'node index.js' } })
  );
  await fs.writeFile(path.join(fixtureDir, 'index.js'), 'console.log("fixture");\n');
  await fs.symlink('/', path.join(fixtureDir, 'rootlink'), 'dir');
  await fs.symlink(outsideJson, path.join(fixtureDir, 'secret.json'));
  await fs.symlink(path.join(outsideDir, 'outside-subdir'), path.join(fixtureDir, 'outsidelink'), 'dir');
  await fs.mkdir(path.join(fixtureDir, 'nested'));
  await fs.symlink(outsideJson, path.join(fixtureDir, 'nested', 'package.json'));

  for (const [key, value] of Object.entries(AI_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  resetDefaultAiClient();

  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    capturedBodies.push(String(options.body ?? ''));
    capturedRequests.push({ url: String(url), headers: { ...options.headers } });
    if (stubMode === 'fail') {
      // A provider error body that echoes the key and a marker: neither may reach the result
      return new Response(JSON.stringify({ error: { message: `${ERROR_BODY_MARKER} invalid key ${STUB_KEY}` } }), { status: 500 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetDefaultAiClient();
  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

describe('scanProjectStructure', () => {
  test('records regular files and directories and skips every symlink', async () => {
    const structure = await scanProjectStructure(fixtureDir);
    assert.deepEqual(
      Object.keys(structure).sort(),
      ['index.js', 'nested', 'package.json'].sort()
    );
    assert.equal(structure.nested, 'directory');
  });
});

describe('runAgentPipeline with untrusted repository content', () => {
  test('never sends paths, symlink targets or symlinked content to the LLM', { timeout: 60000 }, async () => {
    const result = await runAgentPipeline('octocat/Hello-World', fixtureDir);

    assert.ok(capturedBodies.length > 0, 'the stubbed LLM should have been called');

    const forbidden = [
      fixtureDir,
      await fs.realpath(fixtureDir),
      outsideDir,
      os.tmpdir(),
      await fs.realpath(os.tmpdir()),
      'SHOULD_NOT_APPEAR',
      'rootlink',
      'outsidelink',
      'secret.json'
    ];
    for (const body of capturedBodies) {
      for (const value of forbidden) {
        assert.ok(!body.includes(value), `LLM request body must not contain ${value}`);
      }
    }

    assert.ok(capturedBodies[0].includes('octocat/Hello-World'), 'planner prompt should name the repository');

    const structureKeys = Object.keys(result.projectStructure);
    assert.ok(!structureKeys.some((key) => key.startsWith('rootlink')));
    assert.ok(!structureKeys.some((key) => key.startsWith('outsidelink')));
    const analysis = JSON.stringify(result.codebaseAnalysis);
    assert.ok(!analysis.includes('SHOULD_NOT_APPEAR'));
    assert.ok(!analysis.includes('rootlink'));

    // The real (non-symlinked) manifest is still analyzed
    assert.deepEqual(result.codebaseAnalysis.buildCommands, ['npm start']);
    assert.equal(result.techStack.primary, 'node');
  });
});

describe('agent errors reaching state.errors (sent to the browser)', () => {
  test('a provider failure becomes the fixed AI message; no body or key leaks', { timeout: 60000 }, async () => {
    resetDefaultAiClient();
    stubMode = 'fail';
    const requestsBefore = capturedRequests.length;
    let result;
    try {
      result = await runAgentPipeline('octocat/Hello-World', fixtureDir);
    } finally {
      stubMode = 'ok';
      resetDefaultAiClient();
    }

    assert.deepEqual(result.errors, [
      'Planner Agent Error: AI providers are unavailable',
      'Generator Agent Error: AI providers are unavailable',
      'Verifier Agent Error: AI providers are unavailable'
    ]);
    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes(ERROR_BODY_MARKER));
    assert.ok(!serialised.includes(STUB_KEY));

    // The chain was followed: gemini, then groq, for each failed call
    const urls = capturedRequests.slice(requestsBefore).map((r) => r.url);
    assert.ok(urls.some((u) => u.startsWith('http://127.0.0.1:9/gemini/')));
    assert.ok(urls.some((u) => u.startsWith('http://127.0.0.1:9/groq/')));
  });

  test('a non-AI error becomes "Internal error", never its raw message', { timeout: 60000 }, async () => {
    // An invalid AI configuration makes the AI layer throw AiConfigError (not AiError)
    resetDefaultAiClient();
    const saved = process.env.AI_PROVIDERS;
    process.env.AI_PROVIDERS = 'not-a-provider-NONAI_MARKER';
    let result;
    try {
      result = await runAgentPipeline('octocat/Hello-World', fixtureDir);
    } finally {
      process.env.AI_PROVIDERS = saved;
      resetDefaultAiClient();
    }
    assert.deepEqual(result.errors, [
      'Planner Agent Error: Internal error',
      'Generator Agent Error: Internal error',
      'Verifier Agent Error: Internal error'
    ]);
    const serialised = JSON.stringify(result.errors);
    assert.ok(!serialised.includes('AI_PROVIDERS'));
    assert.ok(!serialised.includes('NONAI_MARKER'));
  });

  test('meta reaches no provider request', { timeout: 60000 }, async () => {
    resetDefaultAiClient();
    const before = capturedBodies.length;
    const meta = { sessionId: 'SESSION_ID_MARKER', userId: 'USER_ID_MARKER' };
    const result = await runAgentPipeline('octocat/Hello-World', fixtureDir, null, meta);
    assert.deepEqual(result.errors, []);
    const sent = capturedBodies.slice(before);
    assert.equal(sent.length, 5, 'planner + 3 generator calls + verifier');
    for (const body of sent) {
      assert.ok(!body.includes('SESSION_ID_MARKER'));
      assert.ok(!body.includes('USER_ID_MARKER'));
    }
  });
});
