// The default AI client reads process.env on first use, not at import (NEW-01 lesson).
// This file imports the AI layer before any AI variable exists, then sets them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, resetDefaultAiClient } from '../ai/index.js';

const AI_VARS = ['AI_PROVIDERS', 'GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_BASE_URL', 'AI_TIMEOUT_MS', 'AI_CALL_BUDGET_MS'];
const saved = Object.fromEntries(AI_VARS.map((key) => [key, process.env[key]]));
const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetDefaultAiClient();
});

test('the key set after the import is the one sent, through the fetch stubbed at call time', async () => {
  // Whatever the environment held at import time (normally nothing), these values only
  // exist from here on: a client built at import could not know them
  process.env.AI_PROVIDERS = 'groq';
  process.env.GROQ_API_KEY = 'key-set-after-import-LAZY_MARKER';
  process.env.GROQ_MODEL = 'lazy-model';
  process.env.GROQ_BASE_URL = 'http://127.0.0.1:9/groq';

  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'lazy ok' } }] }), { status: 200 });
  };

  const result = await generateText({ task: 'planner', system: 's', prompt: 'p' });
  assert.equal(result.text, 'lazy ok');
  assert.equal(result.provider, 'groq');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:9/groq/chat/completions');
  assert.equal(requests[0].headers.Authorization, 'Bearer key-set-after-import-LAZY_MARKER');
  assert.equal(requests[0].body.model, 'lazy-model');
});
