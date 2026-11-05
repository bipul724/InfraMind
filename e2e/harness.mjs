import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview } from '../client/node_modules/vite/dist/node/index.js';
import { expect, chromium } from '@playwright/test';
import { startBrowserSupabase } from './fakeSupabaseAuth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanup = [];
let cleaning = null;

export function stopHarness() {
  cleaning ??= (async () => {
    const failures = [];
    for (const stop of cleanup.reverse()) {
      try { await stop(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'E2E cleanup failed');
  })();
  return cleaning;
}

export async function startHarness() {
  try {
    // Launch the configured channel before starting fixtures, so missing Chrome fails immediately.
    const chrome = await chromium.launch({ channel: 'chrome', headless: true });
    console.log(`E2E Chrome: ${chrome.version()}`);
    await chrome.close();
    const serverDir = await fs.realpath(process.env.E2E_SERVER_DIR || path.join(root, 'server'));
    const clientDir = await fs.realpath(process.env.E2E_CLIENT_DIR || path.join(root, 'client'));
    const helper = await import(pathToFileURL(path.join(serverDir, 'test/helpers.js')).href);
    const { createFakeGit } = await import(pathToFileURL(path.join(serverDir, 'test/fakeGit.js')).href);
    const { FAKE_FILES, generatorKindOf, chatReply, replyWith } = await import(pathToFileURL(path.join(serverDir, 'test/fakeLlm.js')).href);
    const fakes = await helper.getFakes();
    cleanup.push(() => helper.closeFakes());
    const git = await createFakeGit();
    cleanup.push(() => fs.rm(path.dirname(git.binDir), { recursive: true, force: true }));
    const port = await helper.getFreePort();
    const origin = `http://127.0.0.1:${port}`;
    const serverCwd = await helper.makeTempDir('inframind-e2e-server-');
    cleanup.push(() => fs.rm(serverCwd, { recursive: true, force: true }));
    const server = await helper.startServer({ cwd: serverCwd, envOverrides: {
      SESSION_STORE: 'memory', PATH: git.pathEnv, CLIENT_URL: origin,
      AI_TIMEOUT_MS: '10000', AI_CALL_BUDGET_MS: '30000',
      RATE_LIMIT_ANALYSIS_MAX: '200', RATE_LIMIT_CLONE_MAX: '200',
      RATE_LIMIT_USER_MAX: '3000', RATE_LIMIT_PREAUTH_MAX: '5000', ANALYSIS_CONCURRENCY: '8'
    } });
    cleanup.push(() => server.stop());
    const marker = `e2e-fixture-${crypto.randomUUID()}`;
    fakes.llm.setResponder((body) => generatorKindOf(body) === 'dockerfile'
      ? replyWith(chatReply('dockerfile', FAKE_FILES.dockerfile.replace('CMD', `# ${marker}\nCMD`))) : undefined);
    const browserAuth = await startBrowserSupabase({
      verifier: fakes.supabase, postgrest: fakes.postgrest, origin,
      connectGitHub: async () => {
        const result = await helper.connectGitHubFor(server, fakes.tokens.A);
        if (result.claim?.status !== 200) throw new Error(`GitHub fixture connection failed: ${result.claim?.status}`);
      }
    });
    cleanup.push(() => browserAuth.close());
    const api = async (route, body) => {
      const response = await fetch(`${server.baseUrl}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${fakes.tokens.A}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) throw new Error(`Fixture ${route}: HTTP ${response.status}`);
      return response.json();
    };
    // Each targeted smoke test gets an owned completed result even when the full-run test is filtered out.
    const { sessionId } = await api('/api/clone-repo', { repoUrl: 'https://github.com/fixture/owned-result' });
    await api('/api/analyze', { sessionId });
    await expect.poll(async () => (await api(`/api/status/${sessionId}`)).status, { timeout: 30000 }).toBe('completed');
    const outDir = path.join(root, 'e2e/.build');
    const previousCwd = process.cwd();
    process.chdir(clientDir);
    try {
      await build({
        root: clientDir, configFile: path.join(clientDir, 'vite.config.ts'), envDir: false,
        mode: 'e2e', logLevel: 'warn',
        define: {
          'import.meta.env.VITE_API_URL': JSON.stringify(server.baseUrl),
          'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(browserAuth.url),
          'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(fakes.supabase.anonKey)
        },
        build: { outDir, emptyOutDir: true }
      });
    } finally { process.chdir(previousCwd); }
    const client = await preview({
      root: clientDir, configFile: path.join(clientDir, 'vite.config.ts'), envDir: false,
      mode: 'e2e', logLevel: 'warn', build: { outDir },
      preview: { host: '127.0.0.1', port, strictPort: true }
    });
    cleanup.push(() => new Promise((resolve, reject) => {
      client.httpServer.closeAllConnections();
      client.httpServer.close((error) => error ? reject(error) : resolve());
    }));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-e2e-'));
    cleanup.push(() => fs.rm(stateDir, { recursive: true, force: true }));
    const statePath = path.join(stateDir, 'state.json');
    await fs.writeFile(statePath, JSON.stringify({ origin, serverOrigin: server.baseUrl, authOrigin: browserAuth.url, sessionId, marker }));
    process.env.INFRAMIND_E2E_STATE = statePath;
    console.log(`E2E local client=${origin} server=${server.baseUrl} browser-auth=${browserAuth.url}`);
  } catch (error) {
    await stopHarness();
    throw error;
  }
}
