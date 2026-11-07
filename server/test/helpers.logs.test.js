import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForLog } from './helpers.js';

test('waitForLog returns existing captured output without scheduling another poll', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  t.after(() => t.mock.timers.reset());
  let reads = 0;
  const snapshot = 'startup\nrequested marker\n';
  const result = await waitForLog({ logs: () => { reads++; return snapshot; } }, 'requested marker');

  assert.equal(result, snapshot);
  assert.equal(reads, 1);
  t.mock.timers.tick(100);
  await Promise.resolve();
  assert.equal(reads, 1, 'a successful wait leaves no scheduled poll');
});

test('waitForLog polls every 25 ms and resolves only after delayed output is captured', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  t.after(() => t.mock.timers.reset());
  let snapshot = 'startup';
  const readTimes = [];
  const pending = waitForLog({ logs: () => { readTimes.push(Date.now()); return snapshot; } }, 'delayed marker', { timeoutMs: 100 });

  t.mock.timers.tick(24);
  await Promise.resolve();
  assert.deepEqual(readTimes, [0]);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.deepEqual(readTimes, [0, 25]);
  snapshot += '\ndelayed marker';
  t.mock.timers.tick(24);
  await Promise.resolve();
  assert.deepEqual(readTimes, [0, 25]);
  t.mock.timers.tick(1);

  assert.equal(await pending, snapshot);
  assert.deepEqual(readTimes, [0, 25, 50]);
  t.mock.timers.tick(100);
  await Promise.resolve();
  assert.deepEqual(readTimes, [0, 25, 50]);
});

test('waitForLog times out without exposing unrelated captured output', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  t.after(() => t.mock.timers.reset());
  const unrelated = 'private_fixture_output_must_not_appear_in_the_error';
  const readTimes = [];
  const failure = assert.rejects(
    waitForLog({ logs: () => { readTimes.push(Date.now()); return unrelated; } }, 'missing marker', { timeoutMs: 50 }),
    (error) => {
      assert.equal(error.message, 'Timed out waiting for log: missing marker');
      assert.ok(!error.message.includes(unrelated));
      return true;
    }
  );

  t.mock.timers.tick(25);
  await Promise.resolve();
  t.mock.timers.tick(25);
  await failure;
  assert.deepEqual(readTimes, [0, 25, 50]);
});
