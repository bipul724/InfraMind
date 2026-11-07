import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildCsp } from './csp.mjs';

const production = {
  apiOrigin: 'https://inframind-backend-bsl1.onrender.com',
  supabaseOrigin: 'https://swpjtyojdwstwqznyhuh.supabase.co',
};
const directives = policy => Object.fromEntries(policy.split('; ').map(directive => {
  const [name, ...sources] = directive.split(' ');
  return [name, sources];
}));

test('CSP permits the production app resources and denies script injection, objects and framing', () => {
  const policy = buildCsp(production);
  const rules = directives(policy);
  assert.deepEqual(rules, {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https://avatars.githubusercontent.com', 'https://*.googleusercontent.com'],
    'connect-src': ["'self'", production.apiOrigin, 'wss://inframind-backend-bsl1.onrender.com', production.supabaseOrigin],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  });
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(!rules['script-src'].includes("'unsafe-inline'"));
  assert.ok(!rules['connect-src'].includes('wss://swpjtyojdwstwqznyhuh.supabase.co'));
});

test('CSP derives the local Socket.IO websocket origin with the API port', () => {
  const rules = directives(buildCsp({ apiOrigin: 'http://127.0.0.1:10000', supabaseOrigin: 'http://127.0.0.1:10001' }));
  assert.deepEqual(rules['connect-src'], ["'self'", 'http://127.0.0.1:10000', 'ws://127.0.0.1:10000', 'http://127.0.0.1:10001']);
});

for (const name of Object.keys(production)) {
  for (const invalid of ['not-an-origin', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?query', 'https://example.com#fragment', 'https://example.com\n']) {
    test(`CSP rejects an invalid ${name} without including its value in the error`, () => {
      assert.throws(() => buildCsp({ ...production, [name]: invalid }), error => {
        assert.ok(error.message.includes(name));
        assert.ok(!error.message.includes(invalid));
        return error instanceof TypeError;
      });
    });
  }
}

test('CSP CLI prints the same header as the exported function', () => {
  const script = fileURLToPath(new URL('./csp.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [script, production.apiOrigin, production.supabaseOrigin], { encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout, `${buildCsp(production)}\n`);
});

test('CSP CLI requires exactly two origins', () => {
  const script = fileURLToPath(new URL('./csp.mjs', import.meta.url));
  for (const args of [[], [production.apiOrigin], [...Object.values(production), 'extra']]) {
    const child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.match(child.stderr, /^Usage:/);
  }
});
