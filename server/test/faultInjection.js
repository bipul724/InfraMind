// Test-only (B1.4): lets a spawned server raise an unhandled rejection or an uncaught
// exception on demand, without any HTTP endpoint. server.js imports this file only when
// TEST_FAULT_INJECTION is set, and startServer refuses that setting unless NODE_ENV=test
// (utils/config.js describeFaultInjectionProblem), which only the test harness sets.
//
// The process faults fire when the process receives SIGUSR2. B2.1 adds
// 'analysis-failure': every analysis job throws after its pipeline has run (the hook
// returned below), as an unexpected server-side error would. Each message carries a
// GitHub-token shaped marker, so tests can prove that what is logged is redacted.

export const FAULT_SECRET_MARKER = `ghp_${'F'.repeat(36)}`;

// Returns hooks server.js calls at fixed points; {} when the mode has none
export function installFaultInjection(mode) {
  console.log(`test fault injection armed: ${mode}`);
  if (mode === 'analysis-failure') {
    return {
      afterPipeline: () => {
        throw new Error(`injected analysis failure ${FAULT_SECRET_MARKER}`);
      }
    };
  }
  process.on('SIGUSR2', () => {
    if (mode === 'unhandled-rejection') {
      void Promise.reject(new TypeError(`injected rejection ${FAULT_SECRET_MARKER}`));
    } else if (mode === 'uncaught-exception') {
      setImmediate(() => {
        throw new RangeError(`injected exception ${FAULT_SECRET_MARKER}`);
      });
    }
  });
  return {};
}
