// B1.4: the process error policy and the shutdown sequence, in spawned servers.
// Faults are raised through test/faultInjection.js (TEST_FAULT_INJECTION + SIGUSR2),
// which the server accepts only under NODE_ENV=test: no endpoint can trigger them.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authHeaders, closeFakes, getFakes, randomAlphanumeric, startConnectFlow, startServer } from './helpers.js';
import { FAULT_SECRET_MARKER } from './faultInjection.js';

const servers = [];
after(async () => {
  for (const server of servers) await server.stop();
  await closeFakes();
});

async function launch(envOverrides) {
  const server = await startServer({ envOverrides });
  servers.push(server);
  return server;
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

// One finished OAuth callback whose completion is never claimed: its token sits in pendingCompletions
async function parkOneCompletion(server) {
  const { supabase } = await getFakes();
  const user = { id: crypto.randomUUID(), email: `${randomAlphanumeric(8)}@example.test` };
  const flow = await startConnectFlow(server, supabase.issueToken(user));
  assert.match(flow.completion ?? '', /^[0-9a-f]{64}$/);
  assert.ok(flow.accessToken, 'the callback obtained a token');
  return flow.accessToken;
}

const revocationsOf = async (token) => (await getFakes()).github.revokedViaTokenEndpoint().filter((t) => t === token).length;

describe('unhandledRejection: logged, counted, and the server keeps serving', () => {
  test('after an unhandled rejection /health still answers', async () => {
    const metricsToken = randomAlphanumeric(48);
    const server = await launch({ TEST_FAULT_INJECTION: 'unhandled-rejection', METRICS_TOKEN: metricsToken });
    assert.ok(server.logs().includes('test fault injection armed: unhandled-rejection'));

    server.signal('SIGUSR2');
    assert.ok(await waitFor(() => server.logs().includes('Unhandled rejection: TypeError: injected rejection')), server.logs());
    assert.equal((await fetch(`${server.baseUrl}/health`)).status, 200);
    assert.equal(server.exited, null, 'the process is still running');

    server.signal('SIGUSR2');
    assert.ok(await waitFor(() => server.logs().split('Unhandled rejection:').length - 1 === 2));
    const metrics = await (await fetch(`${server.baseUrl}/api/metrics`, { headers: { 'X-Metrics-Token': metricsToken } })).json();
    assert.equal(metrics.unhandledRejections, 2);

    const lines = server.logs().split('\n').filter((line) => line.includes('Unhandled rejection'));
    assert.equal(lines.length, 2, 'one line each');
    assert.ok(!server.logs().includes(FAULT_SECRET_MARKER), 'the message is redacted');
    assert.ok(!server.logs().includes('Promise {'), 'the promise object is never logged');
  });
});

describe('uncaughtException: logged, then the shutdown sequence, exit 1', () => {
  test('pending completions are revoked before the process exits with 1', async () => {
    const server = await launch({ TEST_FAULT_INJECTION: 'uncaught-exception' });
    const token = await parkOneCompletion(server);
    assert.equal(await revocationsOf(token), 0);

    server.signal('SIGUSR2');
    const exit = await server.waitForExit(5000);
    assert.equal(exit.code, 1);
    assert.equal(await revocationsOf(token), 1, 'exactly one DELETE /applications/{client_id}/token for the parked token');

    const logs = server.logs();
    assert.ok(logs.includes('Uncaught exception: RangeError: injected exception'));
    assert.ok(logs.includes('🛑 Shutting down: uncaught exception'));
    assert.ok(logs.includes('🛑 Pending GitHub connect tokens: 1 revoked, 0 failed'));
    assert.ok(!logs.includes(FAULT_SECRET_MARKER));
    assert.ok(!logs.includes(token), 'never a token');
  });
});

describe('SIGTERM: the shutdown sequence, exit 0', () => {
  test('one pending completion leads to exactly one revocation, even with a second signal', async () => {
    const server = await launch({});
    const token = await parkOneCompletion(server);

    server.signal('SIGTERM');
    server.signal('SIGTERM'); // idempotent: the sequence runs once
    const exit = await server.waitForExit(5000);
    assert.equal(exit.code, 0);
    assert.equal(await revocationsOf(token), 1);

    const logs = server.logs();
    assert.equal(logs.split('🛑 Shutting down').length - 1, 1, 'the sequence ran once');
    assert.ok(logs.includes('🛑 Pending GitHub connect tokens: 1 revoked, 0 failed'));
    assert.ok(!logs.includes(token));
  });

  test('with nothing pending it exits 0 quickly and revokes nothing', async () => {
    const server = await launch({});
    const { github } = await getFakes();
    const before = github.tokenRevocations.length;
    const started = Date.now();
    server.signal('SIGTERM');
    assert.equal((await server.waitForExit(5000)).code, 0);
    assert.ok(Date.now() - started < 3000);
    assert.equal(github.tokenRevocations.length, before);
    assert.ok(server.logs().includes('🛑 Pending GitHub connect tokens: 0 revoked, 0 failed'));
  });

  test('a revocation GitHub does not accept is counted as failed', async () => {
    const server = await launch({});
    const { github } = await getFakes();
    await parkOneCompletion(server);
    github.setRevokeStatus(500);
    try {
      server.signal('SIGTERM');
      assert.equal((await server.waitForExit(5000)).code, 0);
    } finally {
      github.setRevokeStatus(204);
    }
    assert.ok(server.logs().includes('🛑 Pending GitHub connect tokens: 0 revoked, 1 failed'));
  });
});

// The claimed connection is not touched by shutdown: only unclaimed completions are revoked
describe('shutdown leaves stored connections alone', () => {
  test('a claimed connection is not revoked', async () => {
    const server = await launch({});
    const { supabase } = await getFakes();
    const user = { id: crypto.randomUUID(), email: `${randomAlphanumeric(8)}@example.test` };
    const userToken = supabase.issueToken(user);
    const flow = await startConnectFlow(server, userToken);
    const claim = await fetch(`${server.baseUrl}/api/github/connect/complete`, {
      method: 'POST', headers: { ...authHeaders(userToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ completion: flow.completion })
    });
    assert.equal(claim.status, 200);
    server.signal('SIGTERM');
    assert.equal((await server.waitForExit(5000)).code, 0);
    assert.equal(await revocationsOf(flow.accessToken), 0);
  });
});
