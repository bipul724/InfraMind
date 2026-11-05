// B2.1: the in-process analysis job runner (utils/jobs.js)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobRunner } from '../utils/jobs.js';

const silentLogger = () => {
  const lines = { log: [], error: [] };
  return { lines, logger: { log: (line) => lines.log.push(line), error: (line) => lines.error.push(line) } };
};

// A job that finishes when release() is called
function controllable() {
  let release;
  let reject;
  const done = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  const calls = [];
  return { fn: () => { calls.push(Date.now()); return done; }, release, reject, calls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('createJobRunner', () => {
  test('runs at most `concurrency` jobs; queues at most `queueMax`; FIFO', async () => {
    const { logger } = silentLogger();
    const runner = createJobRunner({ concurrency: 1, queueMax: 1, logger });
    const order = [];
    const a = controllable();
    const b = controllable();
    assert.deepEqual(runner.enqueue('a', () => { order.push('a'); return a.fn(); }), { queued: false });
    assert.deepEqual(runner.enqueue('b', () => { order.push('b'); return b.fn(); }), { queued: true });
    assert.equal(runner.canAccept(), false);
    assert.equal(runner.enqueue('c', () => {}), null, 'full: refused');
    await tick();
    assert.deepEqual(runner.stats(), { running: 1, queued: 1, reserved: 0 });
    assert.deepEqual(order, ['a']);

    a.release();
    await tick();
    await tick();
    assert.deepEqual(order, ['a', 'b'], 'the queued job starts when a slot frees');
    assert.deepEqual(runner.stats(), { running: 1, queued: 0, reserved: 0 });
    assert.equal(runner.canAccept(), true);
    b.release();
    await tick();
    await tick();
    assert.deepEqual(runner.stats(), { running: 0, queued: 0, reserved: 0 });
  });

  test('a reserved slot counts against capacity until it is used or released', async () => {
    const { logger } = silentLogger();
    const runner = createJobRunner({ concurrency: 1, queueMax: 0, logger });
    const slot = runner.reserve();
    assert.ok(slot);
    assert.deepEqual(runner.stats(), { running: 0, queued: 0, reserved: 1 }, 'stats() reports the reservation');
    assert.equal(runner.canAccept(), false, 'the reservation holds the only slot');
    assert.equal(runner.reserve(), null);
    slot.release();
    assert.deepEqual(runner.stats(), { running: 0, queued: 0, reserved: 0 });
    assert.equal(runner.canAccept(), true);
    const again = runner.reserve();
    const job = controllable();
    assert.deepEqual(again.enqueue('x', job.fn), { queued: false });
    assert.throws(() => again.release(), /slot already used/);
    job.release();
  });

  test('a rejected or throwing job is caught and logged redacted, never an unhandled rejection', async () => {
    const { lines, logger } = silentLogger();
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const runner = createJobRunner({ concurrency: 2, queueMax: 0, logger });
      const secret = `ghp_${'S'.repeat(36)}`;
      runner.enqueue('rejects', async () => { throw new Error(`boom ${secret}`); });
      runner.enqueue('throws', () => { throw new TypeError('sync boom'); });
      for (let i = 0; i < 5; i++) await tick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(unhandled.length, 0);
      assert.equal(lines.error.length, 2);
      assert.match(lines.error.join('\n'), /analysis job finished: session=rejects outcome=failed/);
      assert.match(lines.error.join('\n'), /analysis job finished: session=throws outcome=failed/);
      assert.ok(!lines.error.join('\n').includes(secret), 'redacted');
      assert.deepEqual(runner.stats(), { running: 0, queued: 0, reserved: 0 }, 'a failed job frees its slot');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('drain stops accepting, drops queued jobs and waits at most timeoutMs for running ones', async () => {
    const { logger } = silentLogger();
    const runner = createJobRunner({ concurrency: 1, queueMax: 5, logger });
    const running = controllable();
    let queuedRan = false;
    runner.enqueue('running', running.fn);
    runner.enqueue('queued', () => { queuedRan = true; });
    const started = Date.now();
    const result = await runner.drain(200);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 190 && elapsed < 1000, `waited ${elapsed} ms`);
    assert.deepEqual(result, { dropped: 1, stillRunning: 1 });
    assert.equal(runner.canAccept(), false);
    assert.equal(runner.enqueue('late', () => {}), null);
    running.release();
    await tick();
    await tick();
    assert.equal(queuedRan, false, 'a dropped job never starts');
  });

  test('drain returns as soon as the running jobs finish', async () => {
    const { logger } = silentLogger();
    const runner = createJobRunner({ concurrency: 1, queueMax: 0, logger });
    runner.enqueue('quick', () => new Promise((resolve) => setTimeout(resolve, 30)));
    const started = Date.now();
    assert.deepEqual(await runner.drain(2000), { dropped: 0, stillRunning: 0 });
    assert.ok(Date.now() - started < 1000);
  });

  test('a slot reserved before drain and used after it is dropped', () => {
    const { logger } = silentLogger();
    const runner = createJobRunner({ concurrency: 1, queueMax: 0, logger });
    const slot = runner.reserve();
    void runner.drain(10);
    let ran = false;
    assert.deepEqual(slot.enqueue('late', () => { ran = true; }), { queued: false, dropped: true });
    assert.equal(ran, false);
  });

  test('rejects invalid limits', () => {
    assert.throws(() => createJobRunner({ concurrency: 0, queueMax: 0 }), TypeError);
    assert.throws(() => createJobRunner({ concurrency: 1, queueMax: -1 }), TypeError);
  });
});
