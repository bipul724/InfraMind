// Unit tests for the performance monitor (SERVER-FIX D.4) and the default port (D.7)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PerformanceMonitor,
  SESSION_ANALYTICS_MAX_AGE_MS,
  SESSION_ANALYTICS_MAX_ENTRIES,
  getHealthStatus
} from '../utils/performance.js';
import { DEFAULT_PORT, resolvePort } from '../utils/port.js';
import { SERVER_DIR } from './helpers.js';
import { captureConsole } from './consoleCapture.js';

// trackAgentSession logs "🤖 AGENT [...]" lines (utils/logger.js); printed to this process's
// stdout they can make node:test fail the whole file (T-410, see consoleCapture.js)
captureConsole();

const monitorAt = (clock) => new PerformanceMonitor({ now: () => clock.t, startMonitoring: false });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('session analytics', () => {
  test('counts phases and outcomes', () => {
    const clock = { t: 1_000_000 };
    const monitor = monitorAt(clock);
    monitor.trackAgentSession(id(1), 'clone', 120, { outcome: 'ok' });
    monitor.trackAgentSession(id(1), 'analysis', 900, { outcome: 'ok', files: 3 });
    monitor.trackAgentSession(id(2), 'clone', 50, { outcome: 'failed' });

    const analytics = monitor.getSessionAnalytics();
    assert.equal(analytics.total, 2);
    assert.equal(analytics.phases.clone.count, 2);
    assert.deepEqual(analytics.phases.clone.outcomes, { ok: 1, failed: 1 });
    assert.equal(analytics.phases.analysis.count, 1);
    assert.deepEqual(analytics.phases.analysis.outcomes, { ok: 1 });
    assert.equal(monitor.getMetrics().trackedSessions, 2);
  });

  test('entries older than one hour are dropped on insert and on read', () => {
    const clock = { t: 5_000_000 };
    const monitor = monitorAt(clock);
    monitor.trackAgentSession(id(1), 'clone', 10, { outcome: 'ok' });
    clock.t += SESSION_ANALYTICS_MAX_AGE_MS - 1;
    monitor.trackAgentSession(id(2), 'clone', 10, { outcome: 'ok' });
    assert.equal(monitor.getMetrics().trackedSessions, 2, 'not yet an hour old');

    clock.t += 2;
    assert.equal(monitor.getSessionAnalytics().total, 1, 'a read prunes the expired entry');
    clock.t += SESSION_ANALYTICS_MAX_AGE_MS;
    monitor.trackAgentSession(id(3), 'clone', 10, { outcome: 'ok' });
    assert.deepEqual([...monitor.metrics.sessions.keys()], [id(3)], 'an insert prunes too');
  });

  test('cleanupSessions (run by the hourly session cleanup) prunes without new data', () => {
    const clock = { t: 0 };
    const monitor = monitorAt(clock);
    monitor.trackAgentSession(id(1), 'clone', 10, { outcome: 'ok' });
    clock.t += SESSION_ANALYTICS_MAX_AGE_MS + 1;
    monitor.cleanupSessions();
    assert.equal(monitor.metrics.sessions.size, 0);
  });

  test(`at most ${SESSION_ANALYTICS_MAX_ENTRIES} sessions are kept, oldest dropped first`, () => {
    const clock = { t: 0 };
    const monitor = monitorAt(clock);
    for (let n = 1; n <= SESSION_ANALYTICS_MAX_ENTRIES + 25; n++) {
      clock.t += 1;
      monitor.trackAgentSession(id(n), 'clone', 1, { outcome: 'ok' });
    }
    const keys = [...monitor.metrics.sessions.keys()];
    assert.equal(keys.length, SESSION_ANALYTICS_MAX_ENTRIES);
    assert.equal(keys[0], id(26), 'the 25 oldest were dropped');
    assert.equal(keys.at(-1), id(SESSION_ANALYTICS_MAX_ENTRIES + 25));
  });
});

describe('getHealthStatus and getMetrics', () => {
  test('/health data is exactly status, timestamp and uptime', () => {
    const health = getHealthStatus();
    assert.deepEqual(Object.keys(health).sort(), ['status', 'timestamp', 'uptime']);
    assert.equal(health.status, 'ok');
    assert.equal(typeof health.uptime, 'number');
    assert.ok(!Number.isNaN(Date.parse(health.timestamp)));
  });

  test('metrics carry version and environment, and trackedSessions replaces activeSessions', () => {
    const metrics = new PerformanceMonitor({ startMonitoring: false }).getMetrics();
    assert.equal(metrics.version, process.version);
    assert.equal(metrics.environment, process.env.NODE_ENV || 'development');
    assert.equal(metrics.trackedSessions, 0);
    assert.ok(!('activeSessions' in metrics));
  });
});

describe('default port', () => {
  test(`resolvePort falls back to ${DEFAULT_PORT}`, () => {
    assert.equal(DEFAULT_PORT, 10000);
    assert.equal(resolvePort({}), 10000);
    assert.equal(resolvePort({ PORT: '' }), 10000);
    assert.equal(resolvePort({ PORT: '  ' }), 10000);
    assert.equal(resolvePort({ PORT: '4321' }), '4321');
  });

  test('server.js and healthcheck.js use resolvePort; the npm scripts use 10000', () => {
    for (const file of ['server.js', 'healthcheck.js']) {
      const source = fs.readFileSync(path.join(SERVER_DIR, file), 'utf8');
      assert.match(source, /resolvePort\(process\.env\)/, file);
      assert.doesNotMatch(source, /3001|localhost:3000|PORT \|\| 3000/, file);
    }
    const { scripts } = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8'));
    assert.match(scripts.health, /localhost:10000\/health/);
    assert.match(scripts.metrics, /localhost:10000\/api\/metrics/);
  });
});
