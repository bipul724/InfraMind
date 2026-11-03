// Spawned-server tests for the AI configuration (offline; providers are the local fake)
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  closeFakes,
  getFakes,
  makeTempDir,
  randomAlphanumeric,
  runServerExpectingExit,
  startServer
} from './helpers.js';

let fakes;
before(async () => { fakes = await getFakes(); });
after(async () => { await closeFakes(); });

describe('startup refuses an invalid AI configuration', () => {
  const marker = `MARKER${randomAlphanumeric(10)}`;
  const cases = [
    ['AI_PROVIDERS is missing', { AI_PROVIDERS: undefined }, 'AI_PROVIDERS', null],
    ['AI_PROVIDERS names an unknown provider', { AI_PROVIDERS: `gemini,${marker.toLowerCase()}` }, 'AI_PROVIDERS', marker.toLowerCase()],
    ['GROQ_MODEL is missing while groq is in the chain', { GROQ_MODEL: undefined }, 'GROQ_MODEL', null],
    ['GEMINI_BASE_URL is http on a public host', { GEMINI_BASE_URL: `http://${marker.toLowerCase()}.example.com/v1` }, 'GEMINI_BASE_URL', marker.toLowerCase()]
  ];

  for (const [label, envOverrides, variable, value] of cases) {
    test(`exits non-zero when ${label}`, async () => {
      const result = await runServerExpectingExit({ envOverrides, timeoutMs: 10000 });
      assert.equal(result.timedOut, false, 'server should exit within 10 s');
      assert.notEqual(result.code, 0);
      assert.ok(result.stderr.includes(variable), `stderr should name ${variable}: ${result.stderr}`);
      if (value) {
        assert.ok(!result.stderr.includes(value), 'stderr must not contain the value');
        assert.ok(!result.stdout.includes(value), 'stdout must not contain the value');
      }
    });
  }

  test('several problems are all printed', async () => {
    const result = await runServerExpectingExit({ envOverrides: { GROQ_MODEL: undefined, OPENROUTER_API_KEY: '', AI_TIMEOUT_MS: '5' } });
    assert.notEqual(result.code, 0);
    for (const variable of ['GROQ_MODEL', 'OPENROUTER_API_KEY', 'AI_TIMEOUT_MS']) {
      assert.ok(result.stderr.includes(variable), variable);
    }
  });
});

describe('startup log', () => {
  test('shows the three task routes with model names, and no key or base URL', async () => {
    const server = await startServer({ envOverrides: { AI_ROUTE_VERIFIER: 'openrouter' } });
    try {
      const logs = server.logs();
      assert.ok(logs.includes('AI route planner: gemini(test-model-gemini) → groq(test-model-groq) → openrouter(test-model-openrouter)'), logs);
      assert.ok(logs.includes('AI route generator: gemini(test-model-gemini) → groq(test-model-groq) → openrouter(test-model-openrouter)'));
      assert.ok(logs.includes('AI route verifier: openrouter(test-model-openrouter)'));
      for (const variable of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_BASE_URL', 'GROQ_BASE_URL', 'OPENROUTER_BASE_URL']) {
        assert.ok(!logs.includes(server.env[variable]), `${variable} value must not be printed`);
      }
      assert.ok(!logs.includes(fakes.llm.url), 'no base URL at all');
      assert.ok(!logs.includes('Llama 3 70B'), 'the old banner text is gone');
    } finally {
      await server.stop();
    }
  });
});

describe('NEW-01: AI configuration from .env', () => {
  test('a .env-only AI configuration is loaded before any module reads it', async () => {
    const cwd = await makeTempDir();
    const keyMarker = `env-file-key-${randomAlphanumeric(16)}`;
    const modelMarker = `env-file-model-${randomAlphanumeric(8)}`;
    await fs.writeFile(path.join(cwd, '.env'), [
      'AI_PROVIDERS=groq',
      `GROQ_API_KEY=${keyMarker}`,
      `GROQ_MODEL=${modelMarker}`,
      `GROQ_BASE_URL=${fakes.llm.baseUrlFor('groq')}`
    ].join('\n') + '\n');

    const removed = {};
    for (const key of [
      'AI_PROVIDERS', 'AI_TIMEOUT_MS', 'AI_CALL_BUDGET_MS',
      'GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_BASE_URL',
      'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_BASE_URL',
      'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_BASE_URL',
      'DOTENV_CONFIG_PATH'
    ]) removed[key] = undefined;

    const server = await startServer({ cwd, envOverrides: removed });
    try {
      for (const key of Object.keys(removed)) assert.equal(server.env[key], undefined, `${key} is not in the process env`);
      const logs = server.logs();
      for (const task of ['planner', 'generator', 'verifier']) {
        assert.ok(logs.includes(`AI route ${task}: groq(${modelMarker})`), logs);
      }
      assert.ok(!logs.includes(keyMarker), 'the key from .env is never printed');
    } finally {
      await server.stop();
    }
  });
});
