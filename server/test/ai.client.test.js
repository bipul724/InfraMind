// Unit tests for the AI client: injected fetch, clock, sleep, random and timeout signal.
// No network: every "provider" is a scripted queue inside this file.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AiError, createAiClient, loadAiConfig } from '../ai/index.js';

const KEYS = {
  gemini: 'gem-key-SECRET_KEY_MARKER_G',
  groq: 'groq-key-SECRET_KEY_MARKER_Q',
  openrouter: 'or-key-SECRET_KEY_MARKER_O'
};
const BODY_MARKER = 'SECRET_BODY_MARKER';

const configFor = (overrides = {}) => loadAiConfig({
  AI_PROVIDERS: 'gemini,groq,openrouter',
  GEMINI_API_KEY: KEYS.gemini, GEMINI_MODEL: 'gem-model', GEMINI_BASE_URL: 'https://gemini.test/v1beta/openai',
  GROQ_API_KEY: KEYS.groq, GROQ_MODEL: 'groq-model', GROQ_BASE_URL: 'https://groq.test/openai/v1',
  OPENROUTER_API_KEY: KEYS.openrouter, OPENROUTER_MODEL: 'or-model', OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
  AI_TIMEOUT_MS: '1000',
  AI_CALL_BUDGET_MS: '60000',
  AI_MAX_ATTEMPTS_PER_PROVIDER: '2',
  ...overrides
});

const success = (content = 'hello', usage = { prompt_tokens: 5, completion_tokens: 3 }) => ({
  status: 200,
  body: { choices: [{ message: { role: 'assistant', content } }], usage }
});
const failure = (status, headers) => ({
  status,
  headers,
  body: { error: { message: `${BODY_MARKER} upstream said no; key ${KEYS.gemini}` } }
});

// Builds a client around scripted providers. Script items: { status, body, headers } | 'hang' | 'network'.
function harness({ env = {}, scripts = {}, onCall, logger, useDefaultSink = false } = {}) {
  const state = { t: 1_000_000 };
  const sleeps = [];
  const records = [];
  const requests = [];
  const warnings = [];
  const queues = { gemini: [], groq: [], openrouter: [], novita: [], ...structuredClone(scripts) };
  const signals = new Map();

  const fetch = async (url, init) => {
    const provider = new URL(url).hostname.split('.')[0];
    requests.push({ provider, url, headers: { ...init.headers }, body: JSON.parse(init.body), rawBody: init.body });
    // Default reply: valid for the request type, like the fake provider server
    const body = JSON.parse(init.body);
    const wantsObject = Boolean(body.response_format) || body.messages[0].content.includes('Reply with a single JSON object');
    const item = queues[provider].shift() ?? success(wantsObject ? '{"ok":true}' : 'hello');
    if (item === 'hang') {
      // Never answers: the per-attempt timeout fires (the clock jumps by its length)
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        const entry = signals.get(init.signal);
        state.t += entry.ms;
        entry.controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      });
    }
    if (item === 'network') throw new TypeError(`fetch failed: ${BODY_MARKER}`);
    const text = typeof item.body === 'string' ? item.body : JSON.stringify(item.body);
    return new Response(text, { status: item.status ?? 200, headers: item.headers });
  };

  const client = createAiClient({
    config: configFor(env),
    fetch,
    now: () => state.t,
    sleep: async (ms) => { sleeps.push(ms); state.t += ms; },
    random: () => 0.5, // jitter factor exactly 1.0
    ...(useDefaultSink ? {} : { onCall: onCall ?? ((record) => records.push(record)) }),
    timeoutSignal: (ms) => {
      const controller = new AbortController();
      signals.set(controller.signal, { ms, controller });
      return controller.signal;
    },
    ...(logger === undefined ? { logger: { warn: (m) => warnings.push(m), log: () => {}, error: () => {} } } : logger ? { logger } : {})
  });

  return {
    client,
    state,
    sleeps,
    records,
    requests,
    warnings,
    queues,
    advance: (ms) => { state.t += ms; },
    requestsFor: (provider) => requests.filter((r) => r.provider === provider)
  };
}

const text = (h, extra = {}) => h.client.generateText({ task: 'planner', system: 'sys', prompt: 'hi', ...extra });

async function captureConsole(fn) {
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const method of Object.keys(original)) console[method] = (...args) => lines.push(args.map(String).join(' '));
  try {
    const result = await fn();
    return { result, lines };
  } catch (error) {
    return { error, lines };
  } finally {
    Object.assign(console, original);
  }
}

describe('1-2. requests', () => {
  test('1. the first provider succeeds: one POST with Bearer key, model, temperature, max_tokens, no response_format', async () => {
    const h = harness();
    const result = await h.client.generateText({ task: 'planner', system: 'S', prompt: 'P', temperature: 0.3, maxTokens: 123 });
    assert.deepEqual(result, { text: 'hello', provider: 'gemini', model: 'gem-model', usage: { inputTokens: 5, outputTokens: 3 } });
    assert.equal(h.requests.length, 1);
    const [request] = h.requests;
    assert.equal(request.url, 'https://gemini.test/v1beta/openai/chat/completions');
    assert.equal(request.headers.Authorization, `Bearer ${KEYS.gemini}`);
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.deepEqual(request.body, {
      model: 'gem-model',
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'P' }],
      temperature: 0.3,
      max_tokens: 123
    });
    assert.equal('response_format' in request.body, false);
  });

  test('1. defaults: temperature 0.1, max_tokens 4000; usage absent -> nulls', async () => {
    const h = harness({ scripts: { gemini: [{ status: 200, body: { choices: [{ message: { content: 'x' } }] } }] } });
    const result = await text(h);
    assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null });
    assert.equal(h.requests[0].body.temperature, 0.1);
    assert.equal(h.requests[0].body.max_tokens, 4000);
  });

  test('2. OpenRouter: data_collection deny by default, allow when configured, X-Title and HTTP-Referer', async () => {
    const deny = harness({ env: { AI_PROVIDERS: 'openrouter', CLIENT_URL: 'https://app.example.test' } });
    await text(deny);
    assert.deepEqual(deny.requests[0].body.provider, { data_collection: 'deny' });
    assert.equal(deny.requests[0].headers['X-Title'], 'InfraMind');
    assert.equal(deny.requests[0].headers['HTTP-Referer'], 'https://app.example.test');
    assert.equal(deny.requests[0].headers.Authorization, `Bearer ${KEYS.openrouter}`);

    const allow = harness({ env: { AI_PROVIDERS: 'openrouter', OPENROUTER_DATA_COLLECTION: 'allow' } });
    await text(allow);
    assert.deepEqual(allow.requests[0].body.provider, { data_collection: 'allow' });
    assert.equal('HTTP-Referer' in allow.requests[0].headers, false);

    const gemini = harness();
    await text(gemini);
    assert.equal('provider' in gemini.requests[0].body, false, 'other providers get no OpenRouter extras');
  });

  test('an unknown task throws synchronously, before any request', () => {
    const h = harness();
    assert.throws(() => h.client.generateText({ task: 'analyzer', system: 's', prompt: 'p' }), TypeError);
    assert.throws(() => h.client.generateObject({ task: undefined, schema: z.object({}) }), TypeError);
    assert.equal(h.requests.length, 0);
  });
});

describe('3-7. retry, fallback and outcomes', () => {
  test('3. 429 with Retry-After: 3 sleeps 3000 ms and retries the same provider', async () => {
    const h = harness({ scripts: { gemini: [failure(429, { 'Retry-After': '3' })] } });
    const result = await text(h);
    assert.equal(result.provider, 'gemini');
    assert.deepEqual(h.sleeps, [3000]);
    assert.deepEqual(h.records.map((r) => [r.provider, r.attempt, r.outcome, r.httpStatus]), [
      ['gemini', 1, 'rate_limited', 429],
      ['gemini', 2, 'ok', 200]
    ]);
  });

  test('3. Retry-After: 120 is capped at 10 s; 503 honours Retry-After too; an HTTP date is ignored', async () => {
    const capped = harness({ scripts: { gemini: [failure(429, { 'Retry-After': '120' })] } });
    await text(capped);
    assert.deepEqual(capped.sleeps, [10000]);

    const unavailable = harness({ scripts: { gemini: [failure(503, { 'Retry-After': '2' })] } });
    await text(unavailable);
    assert.deepEqual(unavailable.sleeps, [2000]);

    const dated = harness({ scripts: { gemini: [failure(429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' })] } });
    await text(dated);
    assert.deepEqual(dated.sleeps, [500], 'falls back to exponential backoff');
  });

  test('backoff is 500 * 2^(n-1) ms with +/-20 % jitter', async () => {
    const h = harness({ env: { AI_MAX_ATTEMPTS_PER_PROVIDER: '5', AI_PROVIDERS: 'gemini' }, scripts: { gemini: [failure(500), failure(500), failure(500), failure(500)] } });
    await text(h);
    assert.deepEqual(h.sleeps, [500, 1000, 2000, 4000]);

    // random() = 0 -> factor 0.8; random() = 1 -> factor 1.2
    const sleepsWith = async (randomValue) => {
      const sleeps = [];
      const client = createAiClient({
        config: configFor({ AI_PROVIDERS: 'gemini', AI_MAX_ATTEMPTS_PER_PROVIDER: '5' }),
        fetch: async () => new Response('{}', { status: 500 }),
        now: () => 0,
        sleep: async (ms) => { sleeps.push(ms); },
        random: () => randomValue,
        onCall: () => {},
        logger: { warn: () => {} }
      });
      await assert.rejects(client.generateText({ task: 'planner', system: 's', prompt: 'p' }), AiError);
      return sleeps;
    };
    assert.deepEqual(await sleepsWith(0), [400, 800, 1600, 3200]);
    assert.deepEqual(await sleepsWith(1), [600, 1200, 2400, 4800]);
  });

  test('4. 503 until attempts run out falls to the second provider; the sink records 2 + 1 attempts', async () => {
    const h = harness({ scripts: { gemini: [failure(503), failure(503)] } });
    const result = await text(h);
    assert.equal(result.provider, 'groq');
    assert.deepEqual(h.records.map((r) => [r.provider, r.attempt, r.outcome, r.httpStatus]), [
      ['gemini', 1, 'server_error', 503],
      ['gemini', 2, 'server_error', 503],
      ['groq', 1, 'ok', 200]
    ]);
    assert.deepEqual(h.sleeps, [500], 'one backoff between the two gemini attempts, none before groq');
  });

  test('5. a hung request is outcome timeout; a rejected fetch is outcome network', async () => {
    const h = harness({ scripts: { gemini: ['hang', 'network'] } });
    const result = await text(h);
    assert.equal(result.provider, 'groq');
    assert.deepEqual(h.records.slice(0, 2).map((r) => [r.outcome, r.httpStatus]), [['timeout', null], ['network', null]]);
    assert.equal(h.records[0].latencyMs, 1000, 'the attempt lasted the configured timeout');
  });

  test('6. 401: one request only, then the next provider; the circuit opens for 5 minutes', async () => {
    const h = harness({ scripts: { gemini: [failure(401)] } });
    const first = await text(h);
    assert.equal(first.provider, 'groq');
    assert.equal(h.requestsFor('gemini').length, 1, 'auth failures are not retried');
    assert.deepEqual(h.warnings, ['ai provider gemini circuit open for 300s (auth)']);

    await text(h);
    assert.equal(h.requestsFor('gemini').length, 1, 'the open circuit skips gemini entirely');

    h.advance(5 * 60 * 1000 - 1);
    await text(h);
    assert.equal(h.requestsFor('gemini').length, 1, 'still open just before 5 minutes');

    h.advance(1);
    const later = await text(h);
    assert.equal(later.provider, 'gemini', 'tried again after 5 minutes');
  });

  test('6. 403 is auth as well', async () => {
    const h = harness({ scripts: { gemini: [failure(403)] } });
    await text(h);
    assert.equal(h.records[0].outcome, 'auth');
    assert.equal(h.requestsFor('gemini').length, 1);
  });

  test('7. 400 (and other 4xx): no retry, next provider', async () => {
    const h = harness({ scripts: { gemini: [failure(400)], groq: [failure(404)] } });
    const result = await text(h);
    assert.equal(result.provider, 'openrouter');
    assert.deepEqual(h.records.map((r) => [r.provider, r.outcome, r.httpStatus]), [
      ['gemini', 'bad_request', 400],
      ['groq', 'bad_request', 404],
      ['openrouter', 'ok', 200]
    ]);
    assert.deepEqual(h.sleeps, []);
  });

  test('12. invalid_response (non-JSON body, choices: [], empty content) retries, then falls back', async () => {
    const h = harness({
      scripts: {
        gemini: [{ status: 200, body: `<html>${BODY_MARKER}</html>` }, { status: 200, body: { choices: [] } }],
        groq: [{ status: 200, body: { choices: [{ message: { content: '   ' } }] } }]
      }
    });
    const result = await text(h);
    assert.equal(result.provider, 'groq');
    assert.deepEqual(h.records.map((r) => [r.provider, r.attempt, r.outcome]), [
      ['gemini', 1, 'invalid_response'],
      ['gemini', 2, 'invalid_response'],
      ['groq', 1, 'invalid_response'],
      ['groq', 2, 'ok']
    ]);
  });
});

describe('8. total failure', () => {
  test('AiError has the fixed code and message and lists every attempt; no body, key or marker leaks anywhere', async () => {
    const scripts = {
      gemini: [failure(500), failure(500)],
      groq: [failure(401)],
      openrouter: ['network', failure(429)]
    };
    // Default sink and default logger (console), so everything they print is captured
    const h = harness({ scripts, useDefaultSink: true, logger: null });
    const { error, lines } = await captureConsole(() => text(h, { prompt: 'PROMPT_MARKER' }));
    assert.ok(error instanceof AiError);
    assert.equal(error.code, 'AI_ALL_PROVIDERS_FAILED');
    assert.equal(error.message, 'AI providers are unavailable');
    assert.equal(error.outcome, 'all_providers_failed');
    assert.deepEqual(error.attempts, [
      { provider: 'gemini', model: 'gem-model', outcome: 'server_error', httpStatus: 500 },
      { provider: 'gemini', model: 'gem-model', outcome: 'server_error', httpStatus: 500 },
      { provider: 'groq', model: 'groq-model', outcome: 'auth', httpStatus: 401 },
      { provider: 'openrouter', model: 'or-model', outcome: 'network', httpStatus: null },
      { provider: 'openrouter', model: 'or-model', outcome: 'rate_limited', httpStatus: 429 }
    ]);

    const everything = [
      error.message, error.stack, JSON.stringify(error), JSON.stringify(error.attempts),
      JSON.stringify(Object.getOwnPropertyNames(error).map((k) => error[k])),
      ...lines
    ].join('\n');
    for (const forbidden of [BODY_MARKER, ...Object.values(KEYS), 'PROMPT_MARKER', 'https://', 'gemini.test']) {
      assert.ok(!everything.includes(forbidden), `must not leak ${forbidden}`);
    }
    // The default sink printed one ai_call line per attempt
    assert.equal(lines.filter((l) => l.startsWith('ai_call ')).length, 5);
    assert.ok(lines.includes('ai provider groq circuit open for 300s (auth)'));
    assert.equal(h.requests.length, 5);
  });
});

describe('9. circuit breaker', () => {
  test('3 failed calls open the circuit for 60 s; it is skipped, then retried after the cooldown', async () => {
    const h = harness({ env: { AI_PROVIDERS: 'gemini,groq', AI_MAX_ATTEMPTS_PER_PROVIDER: '1' } });
    for (let i = 0; i < 3; i++) {
      h.queues.gemini.push(failure(500));
      assert.equal((await text(h)).provider, 'groq');
    }
    assert.deepEqual(h.warnings, ['ai provider gemini circuit open for 60s (server_error)']);
    assert.equal(h.requestsFor('gemini').length, 3);

    await text(h);
    assert.equal(h.requestsFor('gemini').length, 3, 'skipped while open');

    h.advance(60 * 1000);
    const retried = await text(h);
    assert.equal(retried.provider, 'gemini', 'tried again after 60 s');
    assert.equal(h.requestsFor('gemini').length, 4);
  });

  test('two failures then a success closes the count; only consecutive failures open it', async () => {
    const h = harness({ env: { AI_PROVIDERS: 'gemini,groq', AI_MAX_ATTEMPTS_PER_PROVIDER: '1' } });
    h.queues.gemini.push(failure(500));
    await text(h);
    h.queues.gemini.push(failure(500));
    await text(h);
    await text(h); // gemini succeeds
    h.queues.gemini.push(failure(500));
    await text(h);
    assert.deepEqual(h.warnings, []);
    assert.equal(h.requestsFor('gemini').length, 4);
  });

  test('with every provider open, the chain is still attempted', async () => {
    const h = harness({ env: { AI_PROVIDERS: 'gemini,groq', AI_MAX_ATTEMPTS_PER_PROVIDER: '1' } });
    h.queues.gemini.push(failure(401));
    h.queues.groq.push(failure(401));
    await assert.rejects(text(h), AiError);
    assert.equal(h.warnings.length, 2);
    const result = await text(h);
    assert.equal(result.provider, 'gemini', 'all open: tried anyway, in chain order');
  });
});

describe('10-11. budget and routes', () => {
  test('10. a budget smaller than two timeouts stops after the first timeout with budget_exhausted; no sleep crosses it', async () => {
    const h = harness({ env: { AI_TIMEOUT_MS: '1000', AI_CALL_BUDGET_MS: '1200' }, scripts: { gemini: ['hang', 'hang'] } });
    const started = h.state.t;
    const error = await text(h).then(() => null, (e) => e);
    assert.ok(error instanceof AiError);
    assert.equal(error.outcome, 'budget_exhausted');
    assert.equal(error.message, 'AI providers are unavailable');
    assert.deepEqual(error.attempts.map((a) => a.outcome), ['timeout']);
    assert.deepEqual(h.sleeps, [], 'the 500 ms backoff would cross the budget, so it never happens');
    assert.equal(h.requestsFor('groq').length, 0);
    assert.ok(h.state.t - started <= 1200);
  });

  test('10. the last attempt gets only the remaining budget as its timeout', async () => {
    const h = harness({ env: { AI_TIMEOUT_MS: '1000', AI_CALL_BUDGET_MS: '1700', AI_PROVIDERS: 'gemini' }, scripts: { gemini: ['hang', 'hang'] } });
    const started = h.state.t;
    const error = await text(h).then(() => null, (e) => e);
    assert.deepEqual(h.sleeps, [500]);
    assert.deepEqual(h.records.map((r) => r.latencyMs), [1000, 200]);
    assert.equal(h.state.t - started, 1700);
    assert.ok(error instanceof AiError);
  });

  test('11. per-task routes: generator routed to groq never touches gemini', async () => {
    const h = harness({ env: { AI_ROUTE_GENERATOR: 'groq' } });
    const generated = await h.client.generateText({ task: 'generator', system: 's', prompt: 'p' });
    assert.equal(generated.provider, 'groq');
    assert.equal(h.requestsFor('gemini').length, 0);
    const planned = await h.client.generateText({ task: 'planner', system: 's', prompt: 'p' });
    assert.equal(planned.provider, 'gemini', 'other tasks keep AI_PROVIDERS');
  });
});

describe('13. generateObject', () => {
  const schema = z.object({ ok: z.boolean(), count: z.number().int() });
  const object = (h, extra = {}) => h.client.generateObject({ task: 'planner', system: 'SYS', prompt: 'P', schema, schemaName: 'check', ...extra });

  test('json_object mode: response_format json_object and the JSON Schema appended to the system message', async () => {
    const h = harness({ scripts: { gemini: [success('{"ok":true,"count":2}')] } });
    const result = await object(h);
    assert.deepEqual(result, { object: { ok: true, count: 2 }, provider: 'gemini', model: 'gem-model', usage: { inputTokens: 5, outputTokens: 3 } });
    const { body } = h.requests[0];
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[0].content.startsWith('SYS\n\nReply with a single JSON object that matches this JSON Schema, and nothing else:\n'));
    assert.ok(body.messages[0].content.endsWith(JSON.stringify(z.toJSONSchema(schema))));
  });

  test('json_schema mode: z.toJSONSchema output with name and strict', async () => {
    const h = harness({ env: { GEMINI_JSON_MODE: 'json_schema' }, scripts: { gemini: [success('{"ok":false,"count":0}')] } });
    await object(h);
    const { body } = h.requests[0];
    assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'check', schema: z.toJSONSchema(schema), strict: true } });
    assert.equal(body.messages[0].content, 'SYS', 'no instruction appended in json_schema mode');
  });

  test('prompt mode: no response_format, instruction appended', async () => {
    const h = harness({ env: { GEMINI_JSON_MODE: 'prompt' }, scripts: { gemini: [success('{"ok":true,"count":1}')] } });
    await object(h);
    const { body } = h.requests[0];
    assert.equal('response_format' in body, false);
    assert.ok(body.messages[0].content.includes('Reply with a single JSON object'));
  });

  test('a fenced reply parses', async () => {
    for (const reply of ['```json\n{"ok":true,"count":3}\n```', '```\n{"ok":true,"count":3}\n```', '  {"ok":true,"count":3}  ']) {
      const h = harness({ scripts: { gemini: [success(reply)] } });
      assert.deepEqual((await object(h)).object, { ok: true, count: 3 }, reply);
    }
  });

  test('an invalid reply gets one repair request with issue paths and codes, never the values', async () => {
    const h = harness({ scripts: { gemini: [success('{"ok":"INVALID_VALUE_MARKER","count":1.5}'), success('{"ok":true,"count":1}')] } });
    const result = await object(h);
    assert.deepEqual(result.object, { ok: true, count: 1 });
    assert.equal(h.requests.length, 2);
    const repair = h.requests[1].body.messages;
    assert.equal(repair.length, 4);
    assert.deepEqual(repair[2], { role: 'assistant', content: '{"ok":"INVALID_VALUE_MARKER","count":1.5}' });
    assert.equal(repair[3].role, 'user');
    assert.match(repair[3].content, /^Your previous reply was not valid\. Problems: .+\. Reply again with only the corrected JSON object\.$/);
    assert.ok(repair[3].content.includes('ok: invalid_type'));
    assert.ok(repair[3].content.includes('count: invalid_type'));
    assert.ok(!repair[3].content.includes('INVALID_VALUE_MARKER'), 'the problem list holds no values');
    assert.ok(!repair[3].content.includes('1.5'));
    assert.deepEqual(h.records.map((r) => r.outcome), ['schema_invalid', 'ok']);
    assert.deepEqual(h.sleeps, [], 'a repair is not a backoff');
  });

  test('non-JSON content is schema_invalid with a root problem', async () => {
    const h = harness({ scripts: { gemini: [success('not json at all'), success('{"ok":true,"count":0}')] } });
    await object(h);
    assert.ok(h.requests[1].body.messages[3].content.includes('(root): invalid_json'));
  });

  test('invalid twice moves to the next provider; the repair counts towards the attempt limit', async () => {
    const h = harness({ scripts: { gemini: [success('{"ok":1}'), success('{"ok":2}')], groq: [success('{"ok":true,"count":9}')] } });
    const result = await object(h);
    assert.equal(result.provider, 'groq');
    assert.deepEqual(h.records.map((r) => [r.provider, r.outcome]), [
      ['gemini', 'schema_invalid'], ['gemini', 'schema_invalid'], ['groq', 'ok']
    ]);

    const single = harness({ env: { AI_MAX_ATTEMPTS_PER_PROVIDER: '1' }, scripts: { gemini: [success('{"ok":1}')], groq: [success('{"ok":true,"count":4}')] } });
    const fallback = await object(single);
    assert.equal(fallback.provider, 'groq', 'with one attempt per provider there is no room for a repair');
    assert.equal(single.requestsFor('gemini').length, 1);
  });

  test('every provider invalid twice -> AiError', async () => {
    const bad = success('{"ok":"no"}');
    const h = harness({ scripts: { gemini: [bad, bad], groq: [bad, bad], openrouter: [bad, bad] } });
    const error = await object(h).then(() => null, (e) => e);
    assert.ok(error instanceof AiError);
    assert.equal(error.attempts.length, 6);
    assert.ok(error.attempts.every((a) => a.outcome === 'schema_invalid'));
  });

  test('a non-zod schema is a programming error', () => {
    const h = harness();
    assert.throws(() => h.client.generateObject({ task: 'planner', system: 's', prompt: 'p', schema: {} }), TypeError);
  });
});

describe('14-16. call records and the sink', () => {
  test('14. one record per attempt with exactly the specified fields; meta reaches the sink only', async () => {
    const h = harness({ scripts: { gemini: [failure(503)] } });
    await h.client.generateText({ task: 'verifier', system: 's', prompt: 'p', meta: { sessionId: 'SESSION_MARKER', userId: 'USER_MARKER' } });
    assert.equal(h.records.length, 2);
    for (const record of h.records) {
      assert.deepEqual(Object.keys(record).sort(), [
        'at', 'attempt', 'httpStatus', 'inputTokens', 'latencyMs', 'model', 'outcome', 'outputTokens', 'provider', 'sessionId', 'task', 'userId'
      ]);
      assert.equal(record.sessionId, 'SESSION_MARKER');
      assert.equal(record.userId, 'USER_MARKER');
      assert.equal(record.task, 'verifier');
    }
    assert.equal(h.records[0].at, new Date(1_000_000).toISOString(), 'at is the attempt start time');
    assert.equal(h.records[1].at, new Date(1_000_000 + 500).toISOString(), 'the second attempt starts after the backoff');
    assert.deepEqual([h.records[0].inputTokens, h.records[0].outputTokens], [null, null]);
    assert.deepEqual([h.records[1].inputTokens, h.records[1].outputTokens], [5, 3]);
    for (const request of h.requests) {
      const all = `${request.rawBody}${JSON.stringify(request.headers)}${request.url}`;
      assert.ok(!all.includes('SESSION_MARKER') && !all.includes('USER_MARKER'), 'no id reaches a provider');
    }
  });

  test('the default sink prints the ai_call line without the user id', async () => {
    const { lines } = await captureConsole(async () => {
      const h = harness({ useDefaultSink: true });
      await h.client.generateText({ task: 'planner', system: 's', prompt: 'p', meta: { sessionId: 'S1', userId: 'USER_MARKER' } });
    });
    assert.deepEqual(lines, [
      'ai_call task=planner provider=gemini model=gem-model attempt=1 outcome=ok http_status=200 latency_ms=0 input_tokens=5 output_tokens=3 session=S1'
    ]);
  });

  test('15. a throwing or rejecting sink never changes the result', async () => {
    const throwing = harness({ onCall: () => { throw new Error(`sink ${BODY_MARKER}`); } });
    assert.equal((await text(throwing)).text, 'hello');
    assert.deepEqual(throwing.warnings, ['ai_call sink failed']);

    const rejecting = harness({ onCall: () => Promise.reject(new Error('nope')) });
    assert.equal((await text(rejecting)).text, 'hello');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rejecting.warnings, ['ai_call sink failed']);

    const failing = harness({ onCall: () => { throw new Error('x'); }, scripts: { gemini: [failure(500), failure(500)] } });
    assert.equal((await text(failing)).provider, 'groq', 'fallback still works with a broken sink');
  });

  test('16. records never contain prompt or response text', async () => {
    const h = harness({ scripts: { gemini: [success('RESPONSE_MARKER text')] } });
    await h.client.generateText({ task: 'planner', system: 'SYSTEM_MARKER', prompt: 'PROMPT_MARKER' });
    await h.client.generateObject({
      task: 'planner', system: 'SYSTEM_MARKER', prompt: 'PROMPT_MARKER', schema: z.object({ ok: z.boolean() })
    });
    const serialised = JSON.stringify(h.records);
    for (const marker of ['RESPONSE_MARKER', 'SYSTEM_MARKER', 'PROMPT_MARKER', '"ok":true']) {
      assert.ok(!serialised.includes(marker), marker);
    }
  });
});
