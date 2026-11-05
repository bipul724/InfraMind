# InfraMind Server

The Express + Socket.IO server in `server.js`. It verifies Supabase access tokens, runs the GitHub connection flow, clones repositories, runs the three-agent pipeline and serves the results. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the flows and [../README-AI-AGENTS.md](../README-AI-AGENTS.md) for the agents and AI providers.

## Requirements

- Node.js `^20.19 || ^22.12 || >=24.0` (`package.json` `engines`)
- `git` on the PATH: `utils/git.js` runs it with `child_process.execFile`
- The configuration in `.env.example`; at startup the server lists every missing or invalid setting and exits (`startServer` in `server.js`, `utils/config.js`)

## Setup

```bash
npm install
cp .env.example .env     # fill in the values; see ../DEPLOYMENT-GUIDE.md
npm run dev              # node --watch server.js
```

With `SESSION_STORE=database`, also run `npm run db:generate` and `npm run db:deploy` once (see below).

## Scripts

From `package.json`:

| Script | Runs | Notes |
|---|---|---|
| `npm start` | `node server.js` | The production entry point (`render.yaml`) |
| `npm run dev` | `node --watch server.js` | |
| `npm run dev:debug` | `NODE_DEBUG=http,net node --watch server.js` | |
| `npm test` | `node --test --test-reporter=spec test/*.test.js` | The test suite, with local fakes for GitHub, Supabase and the AI providers |
| `npm run db:generate` | `prisma generate` | Writes the Prisma client to `generated/prisma` |
| `npm run db:deploy` | `prisma migrate deploy` | Applies `prisma/migrations` to `DATABASE_URL`; run it manually |
| `npm run db:status` | `prisma migrate status` | |
| `npm run db:migrate:dev` | `node scripts/assert-local-db.js && prisma migrate dev` | Local databases only; the guard refuses any other host |
| `npm run ai:smoke` | `node scripts/ai-smoke.js` | Real requests to every configured provider; refuses to run without `RUN_LIVE_AI=1` on the command line |
| `npm run health` | `curl -s http://localhost:10000/health \| jq` | The literal default port 10000 |
| `npm run metrics` | `curl` of `/api/metrics` on port 10000 with `X-Metrics-Token: $METRICS_TOKEN` | 404 unless the server has `METRICS_TOKEN` |
| `npm run logs`, `logs:error`, `logs:agent` | `tail -f` of `logs/app.log`, `logs/error.log`, `logs/agents.log` | `agents.log` holds the clone and analysis analytics lines ([OBSERVABILITY.md](OBSERVABILITY.md)) |

## Layout

```
server.js               Routes, the background analysis job, startup checks, cleanup
agents/index.js         Analyzer, generator, verifier
agents/files.js         Extraction of one raw file from an AI reply, and the file validators
agents/grounding.js     Manifests, existing configuration and evidence flags read from the clone
agents/prompts.js       Generator and verifier prompts, with the 24,000-character cap
ai/                     Provider registry, configuration, client with retries and fallback
db/                     Database configuration and the Prisma client
prisma/                 schema.prisma and the migration for analysis_sessions, generated_files, ai_calls
github.js               GitHub OAuth and REST API calls
utils/auth.js           Supabase token verifier and requireUser middleware
utils/githubConnections.js  Encrypted GitHub connection store and one-time tokens
utils/git.js            git clone runner
utils/repository.js     Repository URL parsing, clone paths, secret redaction
utils/sessionStore.js   Session store: memory or database
utils/sessionView.js    Allow-list serializers for responses and progress events
utils/realtime.js       Authenticated Socket.IO rooms; the newest progress payload per session, in memory
utils/jobs.js           In-process analysis job runner: ANALYSIS_CONCURRENCY at once, ANALYSIS_QUEUE_MAX waiting
utils/config.js         TRUST_PROXY, allowed origins, rate limits, GITHUB_TIMEOUT_MS, the analysis limits and the startup checks of the required settings
utils/security.js       helmet headers, the rate limiters (HTTP and Socket.IO handshakes), request logger
utils/logger.js         Console and logs/ files
utils/performance.js    Request metrics, session analytics, /health data
utils/port.js           Default port (10000) for server.js and healthcheck.js
utils/tempCleanup.js    Which temp/<session id> directories cleanup removes (finished, deleted, orphaned)
healthcheck.js          A probe for a container HEALTHCHECK: exits 0 when GET /health answers 200
scripts/                ai-smoke.js, assert-local-db.js
test/                   node --test suite and fakes (test/fakeGit.js: a stand-in git for offline clones); test/faultInjection.js is loaded only with TEST_FAULT_INJECTION, which the server refuses unless NODE_ENV=test
```

## Tests

`npm test` runs every `test/*.test.js` file with `node --test`, offline: GitHub, Supabase, the AI providers and `git` are local fakes (`test/fakeGitHub.js`, `fakeSupabase.js`, `fakePostgrest.js`, `fakeLlm.js`, `fakeGit.js`), and spawned servers get their environment from `test/helpers.js`, never from `.env`. With `TEST_DATABASE_URL` set to a throwaway local Postgres, the database suites run too (`test/db.js`); with `RUN_NETWORK_TESTS=1`, the few tests that clone from github.com.

| Area | Files |
|---|---|
| Sign-in and ownership | `auth.test.js` (the Supabase verifier), `api.auth.test.js` (401 on every `/api` route without a valid token, Supabase down fails closed, another user's session is 404), `realtime.test.js` (Socket.IO handshakes and private rooms) |
| GitHub connection | `api.github.test.js`, `api.githubErrors.test.js`, `githubConnections.test.js` |
| Clone and analysis | `api.security.test.js`, `api.analysis.test.js` (background runs, capacity, failures, shutdown), `api.results.test.js`, `api.download.test.js`, `git.test.js`, `repository.test.js`, `jobs.test.js`, `e2e.flow.test.js` (two users end to end: offline with the fake `git`, and against github.com with `RUN_NETWORK_TESTS=1`) |
| Agents and AI | `agents.test.js`, `agents.files.test.js`, `agents.generation.test.js`, `agents.redaction.test.js`, `ai.client.test.js`, `ai.config.test.js`, `ai.lazy.test.js`, `api.ai.test.js` |
| Storage | `sessionStore.test.js`, `sessionView.test.js`, `api.persistence.test.js`, `db.config.test.js`, `db.schema.test.js`, `supabase.migrations.test.js`, `tempCleanup.test.js` (which temp directories cleanup removes or keeps) |
| Operations | `api.limits.test.js`, `rateLimitKey.test.js`, `api.observability.test.js`, `api.process.test.js`, `api.startup.test.js`, `config.test.js`, `performance.test.js` |

Tests that run the pipeline or the logger in their own process call `captureConsole()` (`test/consoleCapture.js`): their console output stays out of the test runner's stdout, where Node 22 can misread a line that starts with an emoji and fail the whole file.

The legacy generator, the mock server and the debug and system-test scripts were removed (B4.2); see [../ARCHITECTURE.md, section 9](../ARCHITECTURE.md#9-code-that-is-not-part-of-the-running-system). The real server registers no `/api/devpilot` route.

## License

There is no license file in this repository; `package.json` declares `"license": "MIT"`.
