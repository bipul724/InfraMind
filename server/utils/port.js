// The server's default port, shared by server.js, healthcheck.js and test-system.js.
// 10000 matches render.yaml, server/.env.example and the client's fallback API URL
// (client/src/lib/api.ts). The health/metrics npm scripts use the literal 10000.
export const DEFAULT_PORT = 10000;

export function resolvePort(env = process.env) {
  const value = typeof env.PORT === 'string' ? env.PORT.trim() : '';
  return value === '' ? DEFAULT_PORT : value;
}
