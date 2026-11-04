// Test-only (B1.4): lets a spawned server raise an unhandled rejection or an uncaught
// exception on demand, without any HTTP endpoint. server.js imports this file only when
// TEST_FAULT_INJECTION is set, and startServer refuses that setting unless NODE_ENV=test
// (utils/config.js describeFaultInjectionProblem), which only the test harness sets.
//
// The fault fires when the process receives SIGUSR2. Its message carries a GitHub-token
// shaped marker, so tests can prove the process handlers redact what they log.

export const FAULT_SECRET_MARKER = `ghp_${'F'.repeat(36)}`;

export function installFaultInjection(mode) {
  process.on('SIGUSR2', () => {
    if (mode === 'unhandled-rejection') {
      void Promise.reject(new TypeError(`injected rejection ${FAULT_SECRET_MARKER}`));
    } else if (mode === 'uncaught-exception') {
      setImmediate(() => {
        throw new RangeError(`injected exception ${FAULT_SECRET_MARKER}`);
      });
    }
  });
  console.log(`test fault injection armed: ${mode}`);
}
