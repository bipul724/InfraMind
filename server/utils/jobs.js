/**
 * In-process analysis job runner (B2.1): at most `concurrency` jobs run at once and at
 * most `queueMax` wait, first in, first out. One server process only: the queue and
 * the running jobs live in memory, so they are lost on a restart (the server then
 * marks those sessions failed at startup, sessionStore.markInFlightFailed).
 *
 * A slot is taken in two steps, because the caller does async work (the atomic
 * session claim) between deciding to accept and enqueueing:
 *   const slot = runner.reserve();   // null when full; counts against capacity at once
 *   ... claim ...
 *   slot.enqueue(id, fn);            // or slot.release() if the claim was lost
 * enqueue(id, fn) does both in one call.
 *
 * A job's rejection is caught and logged here (redacted), never left unhandled.
 */

import { redactSecrets } from './repository.js';

export function createJobRunner({ concurrency, queueMax, logger = console, now = Date.now }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be a positive integer');
  if (!Number.isInteger(queueMax) || queueMax < 0) throw new TypeError('queueMax must be a non-negative integer');

  const queue = []; // { id, fn }, oldest first
  const active = new Set(); // promises of running jobs
  let running = 0;
  let reserved = 0;
  let accepting = true;

  const capacity = concurrency + queueMax;
  const canAccept = () => accepting && running + queue.length + reserved < capacity;

  function start({ id, fn }) {
    running++;
    const startedAt = now();
    logger.log(`analysis job started: session=${id}`);
    const job = Promise.resolve()
      .then(fn)
      .then(
        () => logger.log(`analysis job finished: session=${id} outcome=ok ms=${now() - startedAt}`),
        (error) => logger.error(`analysis job finished: session=${id} outcome=failed ms=${now() - startedAt}: ${redactSecrets(error)}`)
      )
      .finally(() => {
        running--;
        active.delete(job);
        next();
      });
    active.add(job);
  }

  function next() {
    while (accepting && running < concurrency && queue.length > 0) start(queue.shift());
  }

  // Returns a slot, or null when the runner is full or stopped
  function reserve() {
    if (!canAccept()) return null;
    reserved++;
    let used = false;
    const settle = () => {
      if (used) throw new Error('slot already used');
      used = true;
      reserved--;
    };
    return {
      // { queued: true } when the job waits for a running one to finish
      enqueue(id, fn) {
        settle();
        if (!accepting) return { queued: false, dropped: true };
        if (running < concurrency) {
          start({ id, fn });
          return { queued: false };
        }
        queue.push({ id, fn });
        logger.log(`analysis job queued: session=${id} position=${queue.length}`);
        return { queued: true };
      },
      release() {
        settle();
      }
    };
  }

  return {
    canAccept,
    reserve,
    enqueue(id, fn) {
      const slot = reserve();
      return slot ? slot.enqueue(id, fn) : null;
    },
    // reserved: slots taken by a request still claiming its session (see reserve)
    stats: () => ({ running, queued: queue.length, reserved }),

    // Stops accepting, drops the queued jobs (they never start) and waits at most
    // timeoutMs for the running ones. Returns what was left.
    async drain(timeoutMs) {
      accepting = false;
      const dropped = queue.splice(0, queue.length).length;
      if (active.size > 0) {
        let timer;
        await Promise.race([
          Promise.allSettled([...active]),
          // Not unref'd: it must keep the process alive for its (short) duration
          new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })
        ]);
        clearTimeout(timer);
      }
      return { dropped, stillRunning: running };
    }
  };
}
