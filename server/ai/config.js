/**
 * AI configuration: loadAiConfig(env) -> validated, frozen config, or throws AiConfigError.
 *
 * The only module that reads provider keys. Problems name variables, never values.
 * Invalid values are errors, never silent fallbacks: falling back to a real provider
 * URL from a test would send traffic outside the machine.
 */

import { describeServiceUrlProblem } from '../utils/auth.js';
import { AiConfigError } from './errors.js';
import { DEFAULT_JSON_MODE, JSON_MODES, PROVIDERS, PROVIDER_NAMES } from './providers.js';

export const TASKS = Object.freeze(['generator', 'verifier']);
const ROUTE_VARS = Object.freeze({
  generator: 'AI_ROUTE_GENERATOR',
  verifier: 'AI_ROUTE_VERIFIER'
});
// Route variables of removed tasks (B2.6: the planner). Never read or validated: an
// existing deployment may still set one, so it gets a warning, never a startup failure.
const RETIRED_ROUTE_VARS = Object.freeze(['AI_ROUTE_PLANNER']);

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_CALL_BUDGET_MS = 180000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DATA_COLLECTION_VALUES = Object.freeze(['deny', 'allow']);

const isSet = (value) => typeof value === 'string' && value.trim() !== '';

// Parses a comma-separated provider chain. Returns the list, or null after recording problems.
function parseChain(variable, raw, problems) {
  const entries = raw.split(',').map((entry) => entry.trim().toLowerCase());
  let valid = true;
  if (entries.some((entry) => entry === '')) {
    problems.push(`${variable} contains an empty entry`);
    valid = false;
  }
  if (entries.some((entry) => entry !== '' && !PROVIDER_NAMES.includes(entry))) {
    problems.push(`${variable} names an unknown provider (allowed: ${PROVIDER_NAMES.join(', ')})`);
    valid = false;
  }
  if (new Set(entries).size !== entries.length) {
    problems.push(`${variable} lists a provider more than once`);
    valid = false;
  }
  return valid ? entries : null;
}

function parseInteger(env, variable, defaultValue, min, max, problems) {
  const raw = env[variable];
  if (raw === undefined || raw === '') return defaultValue;
  const trimmed = String(raw).trim();
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    problems.push(`${variable} must be an integer from ${min} to ${max}`);
    return null;
  }
  return value;
}

export function loadAiConfig(env = process.env) {
  const problems = [];

  // Chains
  let defaultChain = null;
  if (!isSet(env.AI_PROVIDERS)) {
    problems.push(`AI_PROVIDERS is not set (a comma-separated list of: ${PROVIDER_NAMES.join(', ')})`);
  } else {
    defaultChain = parseChain('AI_PROVIDERS', env.AI_PROVIDERS, problems);
  }

  const routes = {};
  for (const task of TASKS) {
    const variable = ROUTE_VARS[task];
    routes[task] = isSet(env[variable]) ? parseChain(variable, env[variable], problems) : defaultChain;
  }

  const used = new Set(Object.values(routes).filter(Boolean).flat());

  // Providers: base URL and JSON mode are validated whenever set; key and model only
  // for providers that appear in some chain
  const providers = {};
  for (const name of PROVIDER_NAMES) {
    const spec = PROVIDERS[name];
    const inChain = used.has(name);

    let baseUrl = spec.defaultBaseUrl;
    if (isSet(env[spec.baseUrlVar])) {
      const problem = describeServiceUrlProblem(env[spec.baseUrlVar].trim(), { allowPath: true });
      if (problem) problems.push(`${spec.baseUrlVar} ${problem}`);
      else baseUrl = env[spec.baseUrlVar].trim().replace(/\/+$/, '');
    }

    let jsonMode = DEFAULT_JSON_MODE;
    if (isSet(env[spec.jsonModeVar])) {
      const mode = env[spec.jsonModeVar].trim();
      if (JSON_MODES.includes(mode)) jsonMode = mode;
      else problems.push(`${spec.jsonModeVar} must be one of: ${JSON_MODES.join(', ')}`);
    }

    if (!inChain) continue;
    if (!isSet(env[spec.keyVar])) problems.push(`${spec.keyVar} is not set (required because ${name} is in an AI route)`);
    if (!isSet(env[spec.modelVar])) problems.push(`${spec.modelVar} is not set (required because ${name} is in an AI route)`);

    const provider = {
      name,
      model: isSet(env[spec.modelVar]) ? env[spec.modelVar].trim() : null,
      baseUrl,
      jsonMode,
      headers: Object.freeze({ ...spec.extraHeaders(env) }),
      body: Object.freeze({ ...spec.extraBody(env) })
    };
    // Not enumerable: the key never shows up if a config object is logged or serialised
    Object.defineProperty(provider, 'apiKey', {
      value: isSet(env[spec.keyVar]) ? env[spec.keyVar].trim() : null,
      enumerable: false
    });
    providers[name] = Object.freeze(provider);
  }

  if (isSet(env.OPENROUTER_DATA_COLLECTION) && !DATA_COLLECTION_VALUES.includes(env.OPENROUTER_DATA_COLLECTION.trim())) {
    problems.push(`OPENROUTER_DATA_COLLECTION must be one of: ${DATA_COLLECTION_VALUES.join(', ')}`);
  }

  // Limits
  const timeoutMs = parseInteger(env, 'AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000, 300000, problems);
  const callBudgetMs = parseInteger(env, 'AI_CALL_BUDGET_MS', DEFAULT_CALL_BUDGET_MS, 1000, 3600000, problems);
  const maxAttemptsPerProvider = parseInteger(env, 'AI_MAX_ATTEMPTS_PER_PROVIDER', DEFAULT_MAX_ATTEMPTS, 1, 5, problems);
  if (timeoutMs !== null && callBudgetMs !== null && callBudgetMs < timeoutMs) {
    problems.push('AI_CALL_BUDGET_MS must be greater than or equal to AI_TIMEOUT_MS');
  }

  if (problems.length > 0) throw new AiConfigError(problems);

  return Object.freeze({
    routes: Object.freeze(Object.fromEntries(TASKS.map((task) => [task, Object.freeze([...routes[task]])]))),
    providers: Object.freeze(providers),
    timeoutMs,
    callBudgetMs,
    maxAttemptsPerProvider
  });
}

// One warning per retired route variable that is set; names the variable, never its value
export function describeRetiredAiVariables(env = process.env) {
  return RETIRED_ROUTE_VARS
    .filter((variable) => env[variable] !== undefined)
    .map((variable) => `${variable} is set but no longer used (the planner agent was removed); it can be removed`);
}

// One line per task, names and models only (never keys or URLs)
export function describeAiRoutes(config) {
  return TASKS.map((task) =>
    `AI route ${task}: ${config.routes[task].map((name) => `${name}(${config.providers[name].model})`).join(' → ')}`
  );
}
