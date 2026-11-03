/**
 * AI client: createAiClient(options) -> { generateText, generateObject }.
 *
 * Callers name a task; the config decides which providers serve it, in order.
 * Each attempt gets exactly one outcome (errors.js OUTCOMES) and one metadata-only
 * call record. Transient failures retry with backoff, then fall through to the next
 * provider; a provider that keeps failing is skipped for a while (circuit breaker).
 *
 * Never put a provider response body, header, key, URL, prompt or response text in
 * a thrown error, a log line or a call record.
 */

import { z } from 'zod';
import { TASKS } from './config.js';
import { AiError, CALL_OUTCOMES, OUTCOMES } from './errors.js';

const FAILURES_TO_OPEN = 3;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const AUTH_COOLDOWN_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8000;
const RETRY_AFTER_MAX_MS = 10000;
const JSON_INSTRUCTION = 'Reply with a single JSON object that matches this JSON Schema, and nothing else:';

// Outcomes after which the same provider is not tried again in this call
const NO_RETRY = new Set([OUTCOMES.AUTH, OUTCOMES.BAD_REQUEST]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultTimeoutSignal = (ms) => AbortSignal.timeout(ms);

const show = (value) => (value === null || value === undefined ? '-' : String(value));

// Default sink: one stdout line per attempt; userId is deliberately left out
export function logCallRecord(record) {
  console.log(
    `ai_call task=${show(record.task)} provider=${show(record.provider)} model=${show(record.model)} ` +
    `attempt=${show(record.attempt)} outcome=${show(record.outcome)} http_status=${show(record.httpStatus)} ` +
    `latency_ms=${show(record.latencyMs)} input_tokens=${show(record.inputTokens)} ` +
    `output_tokens=${show(record.outputTokens)} session=${show(record.sessionId)}`
  );
}

function assertTask(task) {
  if (!TASKS.includes(task)) {
    throw new TypeError(`Unknown AI task (expected one of: ${TASKS.join(', ')})`);
  }
}

// Retry-After in whole seconds, for 429 and 503 only, capped at 10 s
function retryAfterMs(response) {
  if (response.status !== 429 && response.status !== 503) return null;
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) return null;
  return Math.min(Number(raw.trim()) * 1000, RETRY_AFTER_MAX_MS);
}

const toTokenCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

// "```json\n{...}\n```" (exactly one fenced block) -> the inside; anything else unchanged
function unwrapFence(content) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i);
  if (match && !match[1].includes('```')) return match[1].trim();
  return trimmed;
}

// Returns { ok: true, value } or { ok: false, issues } where issues hold paths and codes only
function parseObject(content, schema) {
  let parsed;
  try {
    parsed = JSON.parse(unwrapFence(content));
  } catch {
    return { ok: false, issues: ['(root): invalid_json'] };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    return `${where}: ${issue.code}`;
  });
  return { ok: false, issues: [...new Set(issues)] };
}

export function createAiClient({
  config,
  fetch: fetchImpl,
  now = Date.now,
  sleep = defaultSleep,
  random = Math.random,
  onCall = logCallRecord,
  timeoutSignal = defaultTimeoutSignal,
  logger = console
} = {}) {
  if (!config || !config.routes || !config.providers) throw new TypeError('createAiClient needs a config from loadAiConfig');
  if (typeof fetchImpl !== 'function') throw new TypeError('createAiClient needs a fetch implementation');

  // provider name -> { consecutiveFailures, openUntil }
  const circuits = new Map();
  const circuitFor = (name) => {
    if (!circuits.has(name)) circuits.set(name, { consecutiveFailures: 0, openUntil: 0 });
    return circuits.get(name);
  };
  const isOpen = (name) => circuitFor(name).openUntil > now();

  function openCircuit(name, cooldownMs, outcome) {
    const circuit = circuitFor(name);
    circuit.openUntil = now() + cooldownMs;
    logger.warn(`ai provider ${name} circuit open for ${Math.round(cooldownMs / 1000)}s (${outcome})`);
  }

  // One call that ended without success on this provider. After the cooldown the
  // counter is still at the threshold, so one more failure reopens it at once.
  function recordProviderFailure(name, outcome) {
    const circuit = circuitFor(name);
    circuit.consecutiveFailures += 1;
    if (outcome === OUTCOMES.AUTH) {
      openCircuit(name, AUTH_COOLDOWN_MS, outcome);
    } else if (circuit.consecutiveFailures >= FAILURES_TO_OPEN) {
      openCircuit(name, FAILURE_COOLDOWN_MS, outcome);
    }
  }

  function recordProviderSuccess(name) {
    const circuit = circuitFor(name);
    circuit.consecutiveFailures = 0;
    circuit.openUntil = 0;
  }

  // A sink must never affect the call: catch throws and rejections
  function emit(record) {
    try {
      const result = onCall(record);
      if (result && typeof result.then === 'function') {
        result.then(undefined, () => logger.warn('ai_call sink failed'));
      }
    } catch {
      logger.warn('ai_call sink failed');
    }
  }

  function backoffMs(attempt) {
    const base = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
    return Math.round(base * (0.8 + 0.4 * random()));
  }

  // One HTTP attempt. Returns { outcome, httpStatus, content, usage, retryAfterMs }.
  async function attemptOnce(provider, body, timeoutMs) {
    const signal = timeoutSignal(timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          ...provider.headers,
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      });
    } catch {
      return { outcome: signal.aborted ? OUTCOMES.TIMEOUT : OUTCOMES.NETWORK, httpStatus: null };
    }

    const httpStatus = Number.isInteger(response.status) ? response.status : null;
    let text;
    try {
      text = await response.text();
    } catch {
      return { outcome: signal.aborted ? OUTCOMES.TIMEOUT : OUTCOMES.NETWORK, httpStatus };
    }

    if (httpStatus === 429) return { outcome: OUTCOMES.RATE_LIMITED, httpStatus, retryAfterMs: retryAfterMs(response) };
    if (httpStatus >= 500) return { outcome: OUTCOMES.SERVER_ERROR, httpStatus, retryAfterMs: retryAfterMs(response) };
    if (httpStatus === 401 || httpStatus === 403) return { outcome: OUTCOMES.AUTH, httpStatus };
    if (httpStatus >= 400) return { outcome: OUTCOMES.BAD_REQUEST, httpStatus };
    if (httpStatus === null || httpStatus < 200 || httpStatus >= 300) return { outcome: OUTCOMES.INVALID_RESPONSE, httpStatus };

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { outcome: OUTCOMES.INVALID_RESPONSE, httpStatus };
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      return { outcome: OUTCOMES.INVALID_RESPONSE, httpStatus };
    }
    return {
      outcome: OUTCOMES.OK,
      httpStatus,
      content,
      usage: {
        inputTokens: toTokenCount(data?.usage?.prompt_tokens),
        outputTokens: toTokenCount(data?.usage?.completion_tokens)
      }
    };
  }

  // All attempts on one provider for one call
  async function callProvider(provider, request, state) {
    const { task, meta, temperature, maxTokens, kind } = request;
    let messages = request.messagesFor(provider);
    let attempt = 0;
    let repairUsed = false;
    let lastOutcome = null;

    while (attempt < config.maxAttemptsPerProvider) {
      const remaining = state.deadline - now();
      if (remaining <= 0) return { ok: false, lastOutcome, budgetExhausted: true };
      attempt += 1;

      const body = {
        model: provider.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...provider.body,
        ...request.bodyExtrasFor(provider)
      };
      const started = now();
      const result = await attemptOnce(provider, body, Math.min(config.timeoutMs, remaining));

      let outcome = result.outcome;
      let value = null;
      let issues = null;
      if (outcome === OUTCOMES.OK) {
        if (kind === 'object') {
          const parsed = parseObject(result.content, request.schema);
          if (parsed.ok) value = { object: parsed.value };
          else {
            outcome = OUTCOMES.SCHEMA_INVALID;
            issues = parsed.issues;
          }
        } else {
          value = { text: result.content };
        }
      }

      emit({
        at: new Date(started).toISOString(),
        task,
        provider: provider.name,
        model: provider.model,
        attempt,
        outcome,
        httpStatus: result.httpStatus ?? null,
        latencyMs: Math.max(0, now() - started),
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        sessionId: meta?.sessionId ?? null,
        userId: meta?.userId ?? null
      });
      state.attempts.push({ provider: provider.name, model: provider.model, outcome, httpStatus: result.httpStatus ?? null });

      if (outcome === OUTCOMES.OK) {
        return {
          ok: true,
          value: {
            ...value,
            provider: provider.name,
            model: provider.model,
            usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
          }
        };
      }
      lastOutcome = outcome;

      if (NO_RETRY.has(outcome)) break;

      if (outcome === OUTCOMES.SCHEMA_INVALID) {
        if (repairUsed) break;
        repairUsed = true;
        // One repair on the same provider; the problem list holds paths and codes only
        messages = [
          ...messages,
          { role: 'assistant', content: result.content },
          {
            role: 'user',
            content: `Your previous reply was not valid. Problems: ${issues.join(', ')}. Reply again with only the corrected JSON object.`
          }
        ];
        continue;
      }

      if (attempt >= config.maxAttemptsPerProvider) break;
      const delay = result.retryAfterMs ?? backoffMs(attempt);
      if (now() + delay >= state.deadline) return { ok: false, lastOutcome, budgetExhausted: true };
      await sleep(delay);
    }
    return { ok: false, lastOutcome, budgetExhausted: false };
  }

  async function run(request) {
    const chain = config.routes[request.task];
    const state = { deadline: now() + config.callBudgetMs, attempts: [] };

    // Skip providers with an open circuit, unless every one is open
    let candidates = chain.filter((name) => !isOpen(name));
    if (candidates.length === 0) candidates = [...chain];

    let budgetExhausted = false;
    for (const name of candidates) {
      if (now() >= state.deadline) {
        budgetExhausted = true;
        break;
      }
      const provider = config.providers[name];
      const result = await callProvider(provider, request, state);
      if (result.ok) {
        recordProviderSuccess(name);
        return result.value;
      }
      // A provider the budget never reached has not failed
      if (result.lastOutcome !== null) recordProviderFailure(name, result.lastOutcome);
      if (result.budgetExhausted) {
        budgetExhausted = true;
        break;
      }
    }
    throw new AiError(state.attempts, budgetExhausted ? CALL_OUTCOMES.BUDGET_EXHAUSTED : CALL_OUTCOMES.ALL_PROVIDERS_FAILED);
  }

  const baseMessages = (system, prompt) => [
    { role: 'system', content: String(system ?? '') },
    { role: 'user', content: String(prompt ?? '') }
  ];

  function generateText({ task, system, prompt, temperature = 0.1, maxTokens = 4000, meta } = {}) {
    assertTask(task);
    return run({
      kind: 'text',
      task,
      meta,
      temperature,
      maxTokens,
      messagesFor: () => baseMessages(system, prompt),
      bodyExtrasFor: () => ({})
    });
  }

  function generateObject({ task, system, prompt, schema, schemaName = 'result', temperature = 0.1, maxTokens = 4000, meta } = {}) {
    assertTask(task);
    if (!schema || typeof schema.safeParse !== 'function') throw new TypeError('generateObject needs a zod schema');
    const jsonSchema = z.toJSONSchema(schema);
    const withInstruction = `${String(system ?? '')}\n\n${JSON_INSTRUCTION}\n${JSON.stringify(jsonSchema)}`;
    return run({
      kind: 'object',
      task,
      meta,
      temperature,
      maxTokens,
      schema,
      messagesFor: (provider) =>
        provider.jsonMode === 'json_schema' ? baseMessages(system, prompt) : baseMessages(withInstruction, prompt),
      bodyExtrasFor: (provider) => {
        if (provider.jsonMode === 'json_schema') {
          return { response_format: { type: 'json_schema', json_schema: { name: schemaName, schema: jsonSchema, strict: true } } };
        }
        if (provider.jsonMode === 'json_object') return { response_format: { type: 'json_object' } };
        return {};
      }
    }).then(({ object, provider, model, usage }) => ({ object, provider, model, usage }));
  }

  return { generateText, generateObject };
}
