/**
 * Errors and attempt outcomes for the AI layer.
 *
 * Nothing here ever carries a provider response body, header, key, URL or prompt:
 * AiError's message is a constant and its attempts list holds only metadata.
 */

// Exactly one outcome per attempt
export const OUTCOMES = Object.freeze({
  OK: 'ok',
  RATE_LIMITED: 'rate_limited',
  SERVER_ERROR: 'server_error',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  AUTH: 'auth',
  BAD_REQUEST: 'bad_request',
  INVALID_RESPONSE: 'invalid_response',
  SCHEMA_INVALID: 'schema_invalid'
});

// Why a whole call failed (AiError.outcome)
export const CALL_OUTCOMES = Object.freeze({
  ALL_PROVIDERS_FAILED: 'all_providers_failed',
  BUDGET_EXHAUSTED: 'budget_exhausted'
});

export const AI_UNAVAILABLE_MESSAGE = 'AI providers are unavailable';

// Invalid configuration. Lists every problem; names variables, never values.
export class AiConfigError extends Error {
  constructor(problems) {
    super(`Invalid AI configuration: ${problems.join('; ')}`);
    this.name = 'AiConfigError';
    this.problems = Object.freeze([...problems]);
  }
}

// Every provider in the chain failed, or the call budget ran out
export class AiError extends Error {
  constructor(attempts, outcome = CALL_OUTCOMES.ALL_PROVIDERS_FAILED) {
    super(AI_UNAVAILABLE_MESSAGE);
    this.name = 'AiError';
    this.code = 'AI_ALL_PROVIDERS_FAILED';
    this.outcome = outcome;
    this.attempts = attempts.map(({ provider, model, outcome: attemptOutcome, httpStatus }) =>
      Object.freeze({ provider, model, outcome: attemptOutcome, httpStatus: httpStatus ?? null })
    );
  }
}
