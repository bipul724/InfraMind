/**
 * Built-in AI provider registry: the only place provider facts live.
 *
 * Every provider speaks the OpenAI chat-completions format at {baseUrl}/chat/completions.
 * Model IDs are never defaulted here: they change too often, and a stale default
 * would fail silently into fallback. Each deployment sets <NAME>_MODEL.
 */

const none = () => ({});

export const PROVIDERS = Object.freeze({
  gemini: Object.freeze({
    name: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyVar: 'GEMINI_API_KEY',
    modelVar: 'GEMINI_MODEL',
    baseUrlVar: 'GEMINI_BASE_URL',
    jsonModeVar: 'GEMINI_JSON_MODE',
    extraHeaders: none,
    extraBody: none
  }),
  groq: Object.freeze({
    name: 'groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyVar: 'GROQ_API_KEY',
    modelVar: 'GROQ_MODEL',
    baseUrlVar: 'GROQ_BASE_URL',
    jsonModeVar: 'GROQ_JSON_MODE',
    extraHeaders: none,
    extraBody: none
  }),
  openrouter: Object.freeze({
    name: 'openrouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyVar: 'OPENROUTER_API_KEY',
    modelVar: 'OPENROUTER_MODEL',
    baseUrlVar: 'OPENROUTER_BASE_URL',
    jsonModeVar: 'OPENROUTER_JSON_MODE',
    // Attribution headers; HTTP-Referer only when the deployment has a client URL
    extraHeaders: (env) => {
      const headers = { 'X-Title': 'InfraMind' };
      if (typeof env.CLIENT_URL === 'string' && env.CLIENT_URL.trim() !== '') {
        headers['HTTP-Referer'] = env.CLIENT_URL.trim();
      }
      return headers;
    },
    // Ask OpenRouter to route only to upstreams that don't store or train on prompts,
    // unless OPENROUTER_DATA_COLLECTION=allow (validated in config.js)
    extraBody: (env) => ({ provider: { data_collection: String(env.OPENROUTER_DATA_COLLECTION || '').trim() || 'deny' } })
  }),
  novita: Object.freeze({
    name: 'novita',
    defaultBaseUrl: 'https://api.novita.ai/v3/openai',
    keyVar: 'NOVITA_API_KEY',
    modelVar: 'NOVITA_MODEL',
    baseUrlVar: 'NOVITA_BASE_URL',
    jsonModeVar: 'NOVITA_JSON_MODE',
    extraHeaders: none,
    extraBody: none
  })
});

export const PROVIDER_NAMES = Object.freeze(Object.keys(PROVIDERS));

// How generateObject asks for JSON. Support differs per model, so it is configurable.
export const JSON_MODES = Object.freeze(['json_object', 'json_schema', 'prompt']);
export const DEFAULT_JSON_MODE = 'json_object';
