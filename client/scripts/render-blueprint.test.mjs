import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const blueprint = yaml.load(readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8'));
const backendPrompts = [
  'CLIENT_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_TOKEN_ENC_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI',
  'DATABASE_URL', 'AI_PROVIDERS', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GROQ_API_KEY',
  'GROQ_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'METRICS_TOKEN',
];
const frontendPrompts = ['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const backend = blueprint.services.find(service => service.name === 'inframind-backend');
const frontend = blueprint.services.find(service => service.name === 'inframind-frontend');

function envFor(service) {
  const entries = service.envVars.map(variable => [variable.key, variable]);
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, 'environment keys are unique');
  return Object.fromEntries(entries);
}

test('Blueprint keeps both services on Node 24 with the supported runtime fields', () => {
  assert.equal(blueprint.services.length, 2);
  assert.equal(backend.type, 'web');
  assert.equal(backend.runtime, 'node');
  assert.equal(frontend.type, 'web');
  assert.equal(frontend.runtime, 'static');
  assert.equal(Object.hasOwn(frontend, 'plan'), false, 'static sites have no compute plan');
  for (const service of [backend, frontend]) {
    assert.equal(envFor(service).NODE_VERSION.value, '24');
    assert.equal(Object.hasOwn(service, 'env'), false, 'runtime replaces the deprecated env field');
  }
});

test('Blueprint prompts for every deployment-specific setting without a committed value', () => {
  for (const [service, prompts] of [[backend, backendPrompts], [frontend, frontendPrompts]]) {
    const env = envFor(service);
    assert.deepEqual(service.envVars.filter(variable => variable.sync === false).map(variable => variable.key).sort(), [...prompts].sort());
    for (const key of prompts) {
      assert.deepEqual(env[key], { key, sync: false });
    }
  }
});

test('Blueprint fixes the storage modes and production defaults, leaving optional settings to the owner', () => {
  const fixed = {
    NODE_VERSION: '24', NODE_ENV: 'production', PORT: 10000, SESSION_STORE: 'database',
    GITHUB_TOKEN_STORE: 'supabase', OPENROUTER_DATA_COLLECTION: 'deny',
  };
  const env = envFor(backend);
  for (const [key, value] of Object.entries(fixed)) assert.deepEqual(env[key], { key, value });
  assert.deepEqual(Object.keys(env).sort(), [...Object.keys(fixed), ...backendPrompts].sort());
  assert.deepEqual(Object.keys(envFor(frontend)).sort(), ['NODE_VERSION', ...frontendPrompts].sort());
});

test('Blueprint never commits secret values', () => {
  for (const service of blueprint.services) {
    for (const variable of service.envVars) {
      // TOKEN_STORE is a mode selector fixed by the Blueprint, so only its known non-secret value is allowed.
      if (variable.key === 'GITHUB_TOKEN_STORE') {
        assert.deepEqual(variable, { key: 'GITHUB_TOKEN_STORE', value: 'supabase' });
      } else if (/KEY|SECRET|TOKEN|DATABASE_URL/.test(variable.key)) {
        assert.equal(Object.hasOwn(variable, 'value'), false, `${variable.key} must not have a value`);
      }
    }
  }
});

test('Blueprint installs reproducibly and runs the frontend guard before building', () => {
  assert.equal(backend.buildCommand, 'cd server && npm ci --include=dev && npm run db:generate');
  assert.equal(backend.startCommand, 'cd server && npm start');
  assert.equal(backend.healthCheckPath, '/health');
  assert.equal(frontend.buildCommand, 'cd client && npm ci && npm run check:deploy-env && npm run build');
  assert.equal(frontend.staticPublishPath, './client/dist');
});

test('Blueprint serves deep links and sends the static security and cache headers', () => {
  assert.deepEqual(frontend.routes, [{ type: 'rewrite', source: '/*', destination: '/index.html' }]);
  const headers = frontend.headers.map(header => [header.path, header.name.toLowerCase(), header.value]);
  assert.deepEqual(headers, [
    ['/*', 'x-content-type-options', 'nosniff'],
    ['/*', 'x-frame-options', 'DENY'],
    ['/*', 'referrer-policy', 'strict-origin-when-cross-origin'],
    ['/*', 'permissions-policy', 'camera=(), microphone=(), geolocation=()'],
    ['/assets/*', 'cache-control', 'public, max-age=31536000, immutable'],
    ['/index.html', 'cache-control', 'no-cache'],
    ['/', 'cache-control', 'no-cache'],
  ]);
});
