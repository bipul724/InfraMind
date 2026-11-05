// B2.3 (T-223): GET /api/files/:sessionId/:filename serves only the three generated
// kinds, looked up as own properties, under their real names, as text/plain with nosniff.
// Spawned servers, offline: fake Supabase, fake LLM and a fake `git` on the server's PATH.
// Runs with the memory store and, when TEST_DATABASE_URL is set, the database store.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authHeaders, closeFakes, getFakes, postJson, startServer } from './helpers.js';
import { DB_SKIP, createTestDatabase } from './db.js';
import { FAKE_FILES, generatorKindOf } from './fakeLlm.js';
import { createFakeGit } from './fakeGit.js';

const NOT_FOUND_BODY = { error: 'File not found' };
// The download name of each generated kind (the workflow's path is not a valid file name)
const DOWNLOAD_NAMES = { dockerfile: 'Dockerfile', githubActions: 'ci.yml', envExample: '.env.example' };
// Names that are not one of the three kinds. Inherited Object.prototype members resolved
// to functions under the old plain-property lookup.
const REFUSED_NAMES = [
  'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf',
  'Dockerfile', 'DOCKERFILE', 'GithubActions', 'ci.yml', '.env.example',
  '%2E%2E%2Fx', '..%2Fdockerfile', 'unknown'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

let fakes;
let fakeGit;
const databases = [];
before(async () => {
  fakes = await getFakes();
  fakeGit = await createFakeGit();
});
after(async () => {
  for (const db of databases) await db.drop().catch(() => {});
  await closeFakes();
});

const STORES = [
  { label: 'memory', skip: false, env: async () => ({ SESSION_STORE: 'memory' }) },
  {
    label: 'database',
    skip: DB_SKIP,
    env: async () => {
      const db = await createTestDatabase();
      databases.push(db);
      return { SESSION_STORE: 'database', DATABASE_URL: db.url };
    }
  }
];

for (const store of STORES) {
  describe(`B2.3 per-file download (${store.label} store)`, { skip: store.skip }, () => {
    let server;
    const get = async (route, token = fakes.tokens.A) => {
      const response = await fetch(`${server.baseUrl}${route}`, { headers: authHeaders(token) });
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, bytes, text: bytes.toString('utf8') };
    };
    const clone = async () => {
      const response = await postJson(server.baseUrl, '/api/clone-repo', { repoUrl: 'https://github.com/octocat/Hello-World' }, authHeaders(fakes.tokens.A));
      assert.equal(response.status, 200, response.text);
      return response.json.sessionId;
    };
    const status = async (id) => JSON.parse((await get(`/api/status/${id}`)).text).status;
    const analyzeToCompletion = async () => {
      const id = await clone();
      const response = await postJson(server.baseUrl, '/api/analyze', { sessionId: id }, authHeaders(fakes.tokens.A));
      assert.equal(response.status, 202, response.text);
      await waitFor(async () => (await status(id)) === 'completed', 30000, 'completed');
      return id;
    };

    let complete; // all three files
    let partial; // envExample omitted by the generator
    let cloned; // never analyzed
    before(async () => {
      server = await startServer({
        envOverrides: {
          ...(await store.env()),
          PATH: fakeGit.pathEnv,
          RATE_LIMIT_ANALYSIS_MAX: '1000',
          RATE_LIMIT_CLONE_MAX: '1000',
          RATE_LIMIT_USER_MAX: '100000',
          RATE_LIMIT_PREAUTH_MAX: '100000'
        }
      });
      fakes.llm.reset();
      complete = await analyzeToCompletion();
      // Every .env.example call fails on every provider (400: no retry), so the
      // generator omits that file and records an error
      fakes.llm.setResponder((body) => (generatorKindOf(body) === 'envExample' ? { status: 400 } : undefined));
      partial = await analyzeToCompletion();
      fakes.llm.setResponder(null);
      cloned = await clone();
    });
    after(async () => {
      fakes.llm.setResponder(null);
      await server?.stop();
    });

    test('each of the three kinds: 200, the stored bytes, text/plain, its real name, nosniff', async () => {
      const listing = JSON.parse((await get(`/api/files/${complete}`)).text);
      assert.deepEqual(Object.keys(listing.files).sort(), Object.keys(DOWNLOAD_NAMES).sort());
      for (const [kind, name] of Object.entries(DOWNLOAD_NAMES)) {
        const response = await get(`/api/files/${complete}/${kind}`);
        assert.equal(response.status, 200, `${kind}: ${response.text}`);
        assert.ok(response.bytes.equals(Buffer.from(listing.files[kind], 'utf8')), `${kind}: byte for byte as stored`);
        assert.equal(response.text, FAKE_FILES[kind]);
        assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8', kind);
        assert.equal(response.headers.get('content-disposition'), `attachment; filename="${name}"`, kind);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff', kind);
      }
    });

    test('names outside the three kinds, inherited properties included, are 404 File not found', async () => {
      for (const name of REFUSED_NAMES) {
        const response = await get(`/api/files/${complete}/${name}`);
        assert.equal(response.status, 404, `${name}: ${response.status} ${response.headers.get('content-type')} ${JSON.stringify(response.text)}`);
        assert.deepEqual(JSON.parse(response.text), NOT_FOUND_BODY, name);
      }
    });

    test('a kind the generator omitted for this session is 404; the others are still served', async () => {
      const listing = JSON.parse((await get(`/api/files/${partial}`)).text);
      assert.deepEqual(Object.keys(listing.files).sort(), ['dockerfile', 'githubActions']);
      assert.ok(listing.errors.some((error) => error.startsWith('Generator Agent Error: .env.example')), JSON.stringify(listing.errors));
      const missing = await get(`/api/files/${partial}/envExample`);
      assert.equal(missing.status, 404);
      assert.deepEqual(JSON.parse(missing.text), NOT_FOUND_BODY);
      assert.equal((await get(`/api/files/${partial}/dockerfile`)).text, FAKE_FILES.dockerfile);
    });

    test('unchanged: a non-owner gets the unknown-session 404, a cloned session gets 400', async () => {
      const foreign = await get(`/api/files/${complete}/dockerfile`, fakes.tokens.B);
      const unknown = await get(`/api/files/${crypto.randomUUID()}/dockerfile`, fakes.tokens.B);
      assert.equal(foreign.status, 404);
      assert.equal(foreign.text, unknown.text);
      assert.ok(!foreign.text.includes('FROM node'));
      const notReady = await get(`/api/files/${cloned}/dockerfile`);
      assert.equal(notReady.status, 400);
      assert.deepEqual(JSON.parse(notReady.text), { error: 'Analysis not completed' });
    });
  });
}

// The pipeline only ever stores the three kinds, but generated_files.kind is free text.
// A seeded row of another kind is an own property of the result, and must still not be
// served: the allow-list, not the stored keys, decides what can be downloaded.
describe('B2.3 per-file download: stored kinds outside the allow-list (database store)', { skip: DB_SKIP }, () => {
  test('a seeded "notes" or "constructor" row is listed by GET /api/files but is 404 here', { timeout: 60000 }, async () => {
    const db = await createTestDatabase();
    databases.push(db);
    const { createPrismaClient } = await import('../db/client.js');
    const client = createPrismaClient({ DATABASE_URL: db.url });
    const { USER_A } = await import('./fakeSupabase.js');
    const id = crypto.randomUUID();
    const now = new Date();
    await client.prisma.analysisSession.create({
      data: {
        id, userId: USER_A.id, owner: 'octocat', repo: 'Hello-World', fullName: 'octocat/Hello-World', repoName: 'Hello-World',
        displayUrl: 'https://github.com/octocat/Hello-World', status: 'completed', createdAt: now, updatedAt: now,
        clonedAt: now, completedAt: now, expiresAt: new Date(now.getTime() + 3600 * 1000),
        files: { create: [
          { kind: 'dockerfile', content: FAKE_FILES.dockerfile },
          { kind: 'notes', content: 'not a generated file' },
          { kind: 'constructor', content: 'an own property named constructor' }
        ] }
      }
    });
    await client.close();
    const server = await startServer({ envOverrides: { SESSION_STORE: 'database', DATABASE_URL: db.url } });
    try {
      const get = async (route) => {
        const response = await fetch(`${server.baseUrl}${route}`, { headers: authHeaders(fakes.tokens.A) });
        return { status: response.status, text: await response.text() };
      };
      const listing = JSON.parse((await get(`/api/files/${id}`)).text);
      assert.deepEqual(Object.keys(listing.files).sort(), ['constructor', 'dockerfile', 'notes'], 'own properties of the stored result');
      for (const name of ['notes', 'constructor']) {
        const response = await get(`/api/files/${id}/${name}`);
        assert.equal(response.status, 404, `${name}: ${response.text}`);
        assert.deepEqual(JSON.parse(response.text), NOT_FOUND_BODY);
      }
      const dockerfile = await get(`/api/files/${id}/dockerfile`);
      assert.equal(dockerfile.status, 200);
      assert.equal(dockerfile.text, FAKE_FILES.dockerfile);
    } finally {
      await server.stop();
    }
  });
});
