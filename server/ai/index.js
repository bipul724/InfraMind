/**
 * The AI layer's public entry point; the only module the agents import.
 *
 * The default client is created lazily, on first use, from process.env, so module
 * evaluation order can never matter (see NEW-01). It looks up globalThis.fetch at
 * call time, not at creation, so a stubbed fetch is always honoured.
 */

import { createAiClient } from './client.js';
import { loadAiConfig } from './config.js';

export { AiError, AiConfigError, AI_UNAVAILABLE_MESSAGE, OUTCOMES } from './errors.js';
export { loadAiConfig, describeAiRoutes, TASKS } from './config.js';
export { createAiClient } from './client.js';

let defaultClient = null;

// A failed creation (invalid configuration) is not cached, so a fixed environment
// is picked up by the next call
export function getDefaultAiClient() {
  if (!defaultClient) {
    defaultClient = createAiClient({
      config: loadAiConfig(process.env),
      fetch: (...args) => globalThis.fetch(...args)
    });
  }
  return defaultClient;
}

// Drops the default client (and its circuit state) so the next call re-reads process.env
export function resetDefaultAiClient() {
  defaultClient = null;
}

export function generateText(options) {
  return getDefaultAiClient().generateText(options);
}

export function generateObject(options) {
  return getDefaultAiClient().generateObject(options);
}
