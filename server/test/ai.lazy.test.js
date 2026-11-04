// The default AI client reads process.env on first use, not at import (NEW-01 lesson).
// This file imports the AI layer before any AI variable exists, then sets them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, resetDefaultAiClient, setDefaultAiCallSink } from '../ai/index.js';

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

test('setDefaultAiCallSink applies to the next default client and is cleared by resetDefaultAiClient', async () => {
  resetDefaultAiClient();
  const records = [];
  setDefaultAiCallSink((record) => records.push(record));
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'sink ok' } }] }), { status: 200 });

  await generateText({ task: 'verifier', system: 's', prompt: 'p', meta: { sessionId: 'S', userId: 'U' } });
  assert.equal(records.length, 1);
  assert.equal(records[0].task, 'verifier');
  assert.equal(records[0].outcome, 'ok');
  assert.equal(records[0].userId, 'U');

  assert.throws(() => setDefaultAiCallSink('not a function'), TypeError);

  // After a reset the default stdout sink is back: the custom one sees nothing more
  resetDefaultAiClient();
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await generateText({ task: 'planner', system: 's', prompt: 'p' });
  } finally {
    console.log = originalLog;
  }
  assert.equal(records.length, 1);
  assert.ok(lines.some((line) => line.startsWith('ai_call task=planner')));
});
