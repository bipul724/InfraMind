// Spawned servers (memory store, offline): /health, /api/metrics and clone analytics
// (SERVER-FIX D.4). git is pointed at an unreachable proxy, so a clone fails offline.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { authHeaders, closeFakes, getFakes, getFreePort, postJson, randomAlphanumeric, startServer, waitForLog } from './helpers.js';
import { USER_A } from './fakeSupabase.js';

// Capture complete lines from each pipe separately so waits cannot match old output or a partial line.
function logsFromNow(server) {
  const stdout = server.output.stdout.length;
  const stderr = server.output.stderr.length;
  const completeLines = (text) => text.slice(0, text.lastIndexOf('\n') + 1);
  return { logs: () => `${completeLines(server.output.stdout.slice(stdout))}\n${completeLines(server.output.stderr.slice(stderr))}` };
}

let fakes;
let server;
const metricsToken = randomAlphanumeric(48);

const getJson = async (route, headers = {}) => {
  const response = await fetch(`${server.baseUrl}${route}`, { headers });
  return { status: response.status, json: await response.json() };
};

before(async () => {
  fakes = await getFakes();
  const deadProxy = `http://127.0.0.1:${await getFreePort()}`;
  server = await startServer({
    envOverrides: { METRICS_TOKEN: metricsToken, HTTPS_PROXY: deadProxy, https_proxy: deadProxy, CLONE_TIMEOUT_MS: '20000' }
  });
});
after(async () => {
  await server?.stop();
  await closeFakes();
});

describe('GET /health', () => {
  test('returns exactly status, timestamp and uptime, publicly', async () => {
    const { status, json } = await getJson('/health');
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json).sort(), ['status', 'timestamp', 'uptime']);
    assert.equal(json.status, 'ok');
    for (const field of ['version', 'environment', 'memory', 'metrics', 'sessionAnalytics']) {
      assert.ok(!(field in json), `no ${field}`);
    }
  });
});

describe('GET /api/metrics', () => {
  test('carries version and environment; trackedSessions replaces activeSessions', async () => {
    const { status, json } = await getJson('/api/metrics', { 'X-Metrics-Token': metricsToken });
    assert.equal(status, 200);
    assert.equal(typeof json.version, 'string');
    assert.match(json.version, /^v\d+/);
    assert.equal(json.environment, 'test');
    assert.equal(typeof json.trackedSessions, 'number');
    assert.ok(!('activeSessions' in json));
    // B2.1: the analysis job runner's counts
    assert.deepEqual(json.analysisJobs, { running: 0, queued: 0, reserved: 0 });
  });
});

describe('clone analytics', () => {
  test('a failed clone is recorded as a clone phase with outcome failed, and its log line identifies nobody', { timeout: 60000 }, async () => {
    const requestLogs = logsFromNow(server);
    const clone = await postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }, authHeaders(fakes.tokens.A));
    assert.equal(clone.status, 502);

    const { json } = await getJson('/api/analytics', { 'X-Metrics-Token': metricsToken });
    assert.equal(json.total, 1);
    assert.equal(json.phases.clone.count, 1);
    assert.deepEqual(json.phases.clone.outcomes, { failed: 1 });
    assert.equal(json.phases.analysis, undefined);

    const logs = await waitForLog(requestLogs, "outcome: 'failed'");
    const lines = logs.split('\n').filter((line) => line.includes('AGENT [performance]'));
    assert.equal(lines.length, 1, 'one analytics log line');
    const session = lines[0].match(/Session ([0-9a-f-]{36}) - clone completed/);
    assert.ok(session, 'the clone analytics line identifies its session');
    // The file append is asynchronous, so wait for its complete record before checking redaction.
    const agentsLog = await waitForLog({ logs: () => {
      try {
        const text = fs.readFileSync(path.join(server.cwd, 'logs', 'agents.log'), 'utf8');
        return text.slice(0, text.lastIndexOf('\n') + 1);
      } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
      }
    } }, `"message":"[performance] Session ${session[1]} - clone completed"`);
    for (const text of [lines.join('\n'), agentsLog]) {
      for (const forbidden of ['octocat', 'Hello-World', 'github.com', USER_A.id, USER_A.email, 'Failed to clone']) {
        assert.ok(!text.includes(forbidden), `analytics log must not contain ${forbidden}`);
      }
    }
    assert.match(lines[0], /clone completed/);
    assert.match(lines[0], /outcome: 'failed'/);
  });
});
