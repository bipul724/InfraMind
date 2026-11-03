// Unit tests for loadAiConfig: validation, every problem reported, names but never values
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AiConfigError, describeAiRoutes, loadAiConfig } from '../ai/index.js';
import { PROVIDERS } from '../ai/providers.js';

const MARK = 'VALUE_MARKER_7Q';
const base = () => ({
  AI_PROVIDERS: 'gemini,groq',
  GEMINI_API_KEY: `gem-key-${MARK}`,
  GEMINI_MODEL: 'gem-model',
  GROQ_API_KEY: `groq-key-${MARK}`,
  GROQ_MODEL: 'groq-model'
});

// Returns the AiConfigError thrown for env, failing the test if none is thrown
function problemsFor(env) {
  try {
    loadAiConfig(env);
  } catch (error) {
    assert.ok(error instanceof AiConfigError, `expected AiConfigError, got ${error?.name}`);
    return error;
  }
  assert.fail('expected loadAiConfig to throw');
}

// The error must name `variable` and contain none of the values in env
function assertNamesOnly(error, variables, env) {
  for (const variable of variables) {
    assert.ok(error.problems.some((p) => p.includes(variable)), `a problem should name ${variable}: ${error.problems.join(' | ')}`);
  }
  const text = `${error.message}\n${error.problems.join('\n')}\n${error.stack}`;
  for (const value of Object.values(env)) {
    if (typeof value === 'string' && value.includes(MARK)) {
      assert.ok(!text.includes(value), 'error text must not contain a configured value');
    }
  }
  assert.ok(!text.includes(MARK), 'no marker value in the error');
}

describe('valid configurations', () => {
  test('minimal: one provider; defaults for everything else', () => {
    const config = loadAiConfig({ AI_PROVIDERS: 'groq', GROQ_API_KEY: 'k', GROQ_MODEL: 'm' });
    assert.deepEqual(config.routes, { planner: ['groq'], generator: ['groq'], verifier: ['groq'] });
    assert.equal(config.providers.groq.baseUrl, PROVIDERS.groq.defaultBaseUrl);
    assert.equal(config.providers.groq.jsonMode, 'json_object');
    assert.equal(config.providers.groq.model, 'm');
    assert.equal(config.providers.groq.apiKey, 'k');
    assert.equal(config.timeoutMs, 60000);
    assert.equal(config.callBudgetMs, 180000);
    assert.equal(config.maxAttemptsPerProvider, 2);
    assert.equal(config.providers.gemini, undefined, 'providers outside every chain are not configured');
    assert.ok(Object.isFrozen(config) && Object.isFrozen(config.routes.planner) && Object.isFrozen(config.providers.groq));
  });

  test('full: routes, base URLs, JSON modes, OpenRouter extras and limits', () => {
    const config = loadAiConfig({
      AI_PROVIDERS: ' Gemini , GROQ,openrouter ',
      AI_ROUTE_PLANNER: 'groq',
      AI_ROUTE_GENERATOR: 'openrouter,gemini',
      AI_ROUTE_VERIFIER: 'novita',
      GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gm', GEMINI_BASE_URL: 'http://127.0.0.1:1234/x/', GEMINI_JSON_MODE: 'json_schema',
      GROQ_API_KEY: 'qk', GROQ_MODEL: 'qm', GROQ_JSON_MODE: 'prompt',
      OPENROUTER_API_KEY: 'ok', OPENROUTER_MODEL: 'om', OPENROUTER_DATA_COLLECTION: 'allow',
      NOVITA_API_KEY: 'nk', NOVITA_MODEL: 'nm',
      CLIENT_URL: 'https://app.example.test',
      AI_TIMEOUT_MS: '1000', AI_CALL_BUDGET_MS: '1000', AI_MAX_ATTEMPTS_PER_PROVIDER: '5'
    });
    assert.deepEqual(config.routes, { planner: ['groq'], generator: ['openrouter', 'gemini'], verifier: ['novita'] });
    assert.equal(config.providers.gemini.baseUrl, 'http://127.0.0.1:1234/x', 'http on 127.0.0.1 with a path is fine; trailing slash removed');
    assert.equal(config.providers.gemini.jsonMode, 'json_schema');
    assert.equal(config.providers.groq.jsonMode, 'prompt');
    assert.deepEqual(config.providers.openrouter.body, { provider: { data_collection: 'allow' } });
    assert.deepEqual(config.providers.openrouter.headers, { 'X-Title': 'InfraMind', 'HTTP-Referer': 'https://app.example.test' });
    assert.deepEqual(Object.keys(config.providers).sort(), ['gemini', 'groq', 'novita', 'openrouter']);
    assert.equal(config.timeoutMs, 1000);
    assert.equal(config.callBudgetMs, 1000);
    assert.equal(config.maxAttemptsPerProvider, 5);
  });

  test('OpenRouter defaults to data_collection deny and no HTTP-Referer without CLIENT_URL', () => {
    const config = loadAiConfig({ AI_PROVIDERS: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' });
    assert.deepEqual(config.providers.openrouter.body, { provider: { data_collection: 'deny' } });
    assert.deepEqual(config.providers.openrouter.headers, { 'X-Title': 'InfraMind' });
  });

  test('a key or model missing for a provider outside every chain is fine', () => {
    assert.doesNotThrow(() => loadAiConfig({ ...base(), OPENROUTER_MODEL: '', NOVITA_API_KEY: '' }));
  });

  test('keys never appear when the config is serialised; routes are described by name and model only', () => {
    const env = base();
    const config = loadAiConfig(env);
    assert.ok(!JSON.stringify(config).includes(MARK));
    const lines = describeAiRoutes(config);
    assert.deepEqual(lines, [
      'AI route planner: gemini(gem-model) → groq(groq-model)',
      'AI route generator: gemini(gem-model) → groq(groq-model)',
      'AI route verifier: gemini(gem-model) → groq(groq-model)'
    ]);
  });
});

describe('invalid configurations: every problem, names only', () => {
  const cases = [
    ['AI_PROVIDERS missing', { AI_PROVIDERS: undefined }, ['AI_PROVIDERS']],
    ['AI_PROVIDERS blank', { AI_PROVIDERS: '   ' }, ['AI_PROVIDERS']],
    ['an unknown provider', { AI_PROVIDERS: `gemini,bogus${MARK}` }, ['AI_PROVIDERS']],
    ['an empty entry', { AI_PROVIDERS: 'gemini,,groq' }, ['AI_PROVIDERS']],
    ['a duplicate', { AI_PROVIDERS: 'gemini,groq,GEMINI' }, ['AI_PROVIDERS']],
    ['a route naming an unknown provider', { AI_ROUTE_GENERATOR: `groq,x${MARK}` }, ['AI_ROUTE_GENERATOR']],
    ['a key missing for a chained provider', { GROQ_API_KEY: '' }, ['GROQ_API_KEY']],
    ['a model missing for a chained provider', { GEMINI_MODEL: undefined }, ['GEMINI_MODEL']],
    ['a model missing for a provider only in a route', { AI_ROUTE_VERIFIER: 'novita', NOVITA_API_KEY: 'k' }, ['NOVITA_MODEL']],
    ['an http base URL on a public host', { GEMINI_BASE_URL: `http://example.com/${MARK}` }, ['GEMINI_BASE_URL']],
    ['a base URL with credentials', { GROQ_BASE_URL: `https://user:${MARK}@example.com` }, ['GROQ_BASE_URL']],
    ['a javascript: base URL', { GROQ_BASE_URL: `javascript:alert(${MARK})` }, ['GROQ_BASE_URL']],
    ['a base URL for a provider outside every chain', { NOVITA_BASE_URL: `ftp://${MARK}.test` }, ['NOVITA_BASE_URL']],
    ['an invalid JSON mode', { GEMINI_JSON_MODE: `strict${MARK}` }, ['GEMINI_JSON_MODE']],
    ['an invalid OPENROUTER_DATA_COLLECTION', { OPENROUTER_DATA_COLLECTION: `maybe${MARK}` }, ['OPENROUTER_DATA_COLLECTION']],
    ['a timeout below 1000', { AI_TIMEOUT_MS: '999' }, ['AI_TIMEOUT_MS']],
    ['a timeout above 300000', { AI_TIMEOUT_MS: '300001' }, ['AI_TIMEOUT_MS']],
    ['a non-numeric timeout', { AI_TIMEOUT_MS: `10s${MARK}` }, ['AI_TIMEOUT_MS']],
    ['a fractional timeout', { AI_TIMEOUT_MS: '1500.5' }, ['AI_TIMEOUT_MS']],
    ['a non-numeric budget', { AI_CALL_BUDGET_MS: `x${MARK}` }, ['AI_CALL_BUDGET_MS']],
    ['a budget smaller than the timeout', { AI_TIMEOUT_MS: '5000', AI_CALL_BUDGET_MS: '4999' }, ['AI_CALL_BUDGET_MS']],
    ['attempts 0', { AI_MAX_ATTEMPTS_PER_PROVIDER: '0' }, ['AI_MAX_ATTEMPTS_PER_PROVIDER']],
    ['attempts 6', { AI_MAX_ATTEMPTS_PER_PROVIDER: '6' }, ['AI_MAX_ATTEMPTS_PER_PROVIDER']]
  ];

  for (const [label, overrides, variables] of cases) {
    test(`rejects ${label}`, () => {
      const env = { ...base(), ...overrides };
      for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete env[key];
      assertNamesOnly(problemsFor(env), variables, env);
    });
  }

  test('several problems at once are all reported', () => {
    const env = {
      AI_PROVIDERS: 'gemini,openrouter',
      GEMINI_API_KEY: `k-${MARK}`,
      GEMINI_BASE_URL: `http://evil.example/${MARK}`,
      OPENROUTER_MODEL: 'm',
      OPENROUTER_DATA_COLLECTION: `x${MARK}`,
      GROQ_JSON_MODE: `y${MARK}`,
      AI_TIMEOUT_MS: '10',
      AI_ROUTE_PLANNER: 'groq,groq'
    };
    const error = problemsFor(env);
    const expected = [
      'GEMINI_MODEL', 'GEMINI_BASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_DATA_COLLECTION',
      'GROQ_JSON_MODE', 'AI_TIMEOUT_MS', 'AI_ROUTE_PLANNER'
    ];
    assertNamesOnly(error, expected, env);
    assert.ok(error.problems.length >= expected.length, error.problems.join(' | '));
  });
});
