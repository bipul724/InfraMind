# InfraMind Server

The Express + Socket.IO server in `server.js`. It verifies Supabase access tokens, runs the GitHub connection flow, clones repositories, runs the four-agent pipeline and serves the results. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the flows and [../README-AI-AGENTS.md](../README-AI-AGENTS.md) for the agents and AI providers.

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
| `npm run start:debug` | `node start.js` | Prints environment details, test-imports modules, then loads `server.js` |
| `npm run start:minimal`, `npm run debug` | `node minimal.js` | A mock server, not the real API (see below) |
| `npm run test:legacy` | `node test.js` | Runs the legacy generator in `index.js` |
| `npm run test:system` | `node test-system.js` | HTTP checks against `http://localhost:${PORT}`, default 10000 |
| `npm run test:render` | `node test-render.js` | A server that answers every request with a fixed message |

## Layout

```
server.js               Routes, startup checks, cleanup
agents/index.js         Planner, analyzer, generator, verifier
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
utils/realtime.js       Authenticated Socket.IO rooms
utils/config.js         TRUST_PROXY, allowed origins, rate limits, GITHUB_TIMEOUT_MS and the startup checks of the required settings
utils/security.js       helmet headers, the rate limiters (HTTP and Socket.IO handshakes), request logger
utils/logger.js         Console and logs/ files
utils/performance.js    Request metrics, session analytics, /health data
utils/port.js           Default port (10000) for server.js, healthcheck.js and test-system.js
scripts/                ai-smoke.js, assert-local-db.js
test/                   node --test suite and fakes; test/faultInjection.js is loaded only with TEST_FAULT_INJECTION, which the server refuses unless NODE_ENV=test
```

## Legacy and mock entry points

These files are not loaded by `server.js`:

- **`index.js`** exports `devPilotAI`, an older generator that builds files from templates and calls Tavily (deployment links), Mem0 (interaction storage) and Keywords AI (event tracking). Only `test.js` imports it (`npm run test:legacy`). It reads `TAVILY_API_KEY`, `MEM0_API_KEY`, `KEYWORDS_AI_API_KEY` and `KEYWORDS_AI_BASE_URL`; the running server reads none of them.
- **`minimal.js`** is a mock server: `/health`, `/`, a mock `POST /api/devpilot`, a mock `POST /api/analyze-repo`, and GitHub routes without user authentication. It listens on `PORT` or 10000.
- **`test-render.js`** answers every request, including `/health`, with `{"message": "Render deployment test successful", ...}`. It must never be the production start command.
- **`healthcheck.js`** requests `http://localhost:${PORT}/health` (default 10000) and exits 0 on a 200 response.

The real server registers no `/api/devpilot` route.

## License

There is no license file in this repository; `package.json` declares `"license": "MIT"`.
