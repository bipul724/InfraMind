/**
 * The AI layer's public entry point; the only module the agents import.
 *
 * The default client is created lazily, on first use, from process.env, so module
 * evaluation order can never matter (see NEW-01). It looks up globalThis.fetch at
 * call time, not at creation, so a stubbed fetch is always honoured.
 */

import { createAiClient, logCallRecord } from './client.js';
import { loadAiConfig } from './config.js';

export { AiError, AiConfigError, AI_UNAVAILABLE_MESSAGE, OUTCOMES } from './errors.js';
export { loadAiConfig, describeAiRoutes, describeRetiredAiVariables, TASKS } from './config.js';
export { createAiClient, logCallRecord } from './client.js';

let defaultClient = null;
let defaultCallSink = null;

// A failed creation (invalid configuration) is not cached, so a fixed environment
// is picked up by the next call
export function getDefaultAiClient() {
  if (!defaultClient) {
    defaultClient = createAiClient({
      config: loadAiConfig(process.env),
      fetch: (...args) => globalThis.fetch(...args),
      onCall: defaultCallSink || logCallRecord
    });
  }
  return defaultClient;
}

// Sets the call-record sink of the default client. Call it before the first AI call:
// it applies to the client created next (a client that already exists keeps its sink).
export function setDefaultAiCallSink(sink) {
  if (sink !== null && typeof sink !== 'function') throw new TypeError('The AI call sink must be a function');
  defaultCallSink = sink;
}

// Drops the default client (and its circuit state) and the custom sink, so the next
// call re-reads process.env and uses the default stdout sink
export function resetDefaultAiClient() {
  defaultClient = null;
  defaultCallSink = null;
}

export function generateText(options) {
  return getDefaultAiClient().generateText(options);
}

export function generateObject(options) {
  return getDefaultAiClient().generateObject(options);
}
