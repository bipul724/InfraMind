# InfraMind Server Observability

What the running server (`server.js`) records and exposes, and where. Nothing here sends data to an external monitoring service.

## AI call records

Every attempt the AI layer makes produces one record with: `task`, `provider`, `model`, `attempt`, `outcome`, `httpStatus`, `latencyMs`, `inputTokens`, `outputTokens`, `sessionId`, `userId` and a timestamp. Records never contain prompt, response, header, key or URL text (`server/ai/client.js`).

Each record goes to two places (`setDefaultAiCallSink` in `server/server.js`):

1. **stdout**, as one line (the user id is left out):

   ```
   ai_call task=generator provider=gemini model=<model> attempt=1 outcome=ok http_status=200 latency_ms=<n> input_tokens=<n> output_tokens=<n> session=<session id>
   ```

2. **The session store** (`recordAiCall` in `server/utils/sessionStore.js`):
   - `SESSION_STORE=database`: a row in `ai_calls`. Rows older than 30 days are deleted by the session cleanup
   - `SESSION_STORE=memory`: kept in process memory, at most 1,000 records

A failed write never affects the AI call; it logs `ai_call sink failed` (`server/ai/client.js`).

Outcome values (`server/ai/errors.js`): `ok`, `rate_limited`, `server_error`, `timeout`, `network`, `auth`, `bad_request`, `invalid_response`, `schema_invalid`.

Useful query with `SESSION_STORE=database`:

```sql
select provider, model, outcome, count(*), round(avg(latency_ms)) as avg_ms
from ai_calls
where created_at > now() - interval '1 day'
group by provider, model, outcome
order by provider, outcome;
```

Other AI log lines: the startup route summary (`🤖 AI route planner: ...`, provider names and models only), circuit-breaker warnings (`ai provider <name> circuit open for <n>s (<outcome>)`), and one warning per generated file that fails validation (`Generator validation failed: kind=<kind> attempt=<1|2> errors=<list>`, fixed text and line or job/step numbers only, never file content) (`server/server.js`, `server/ai/client.js`, `server/agents/index.js`).

## Log files

`utils/logger.js` writes JSON lines into `logs/` under the server's working directory, and the same messages to the console:

| File | Written by |
|---|---|
| `logs/app.log` | `logger.info` and `logger.warn`: one line per HTTP request (method, redacted URL, status, duration, IP, user agent), rate-limit hits (`Rate limit <name> exceeded for IP <ip>` or `... for user <user id>`, with the request path only: no query string, token or body; the line shows the full address, although IPv6 clients are counted per /56 prefix), slow requests (over 1 s) |
| `logs/error.log` | `logger.error`, for example a failed `/api/metrics` or `/api/analytics` |
| `logs/performance.log` | One line per HTTP request with its duration |
| `logs/debug.log` | `logger.debug`, only when `NODE_ENV=development` |
| `logs/agents.log` | One line per tracked clone or analysis phase (`trackAgentSession`): session id, phase, duration, `outcome` and, for analyses, the number of generated files. No user id, repository name, URL or error text |
| `logs/websocket.log` | Never written: nothing calls `logger.websocket` |

Every JSON line includes a timestamp, level, the process id and `process.memoryUsage()`. With `NODE_ENV=production`, files older than 30 days are deleted at startup (`cleanupLogs`). The query values `code`, `state`, `token`, `access_token`, `ticket` and `complete` are replaced with `REDACTED` in logged URLs (`redactUrl` in `server/utils/logger.js`).

Most other server messages, including clone failures, session cleanup and progress updates, go to the console only (`console.log` / `console.error` in `server/server.js` and `server/utils/realtime.js`). Error messages pass through `redactSecrets`, which removes known tokens and temp paths (`server/utils/repository.js`).

## Endpoints

| Endpoint | Access | Returns |
|---|---|---|
| `GET /health` | public | Exactly `{ status: "ok", timestamp, uptime }`, always 200 while the process serves requests. A liveness check: it queries no database or service |
| `GET /api/metrics` | `X-Metrics-Token` equal to `METRICS_TOKEN` (32+ characters), otherwise 404 | Uptime, Node `version`, `environment`, request totals, error count, success rate, average response time, memory, CPU usage, `unhandledRejections` (promise rejections nobody handled since the start; the process keeps serving), `trackedSessions` (entries in the analytics map, not active sessions), `analysisJobs` (`running` and `queued` analyses in the job runner right now, `server/utils/jobs.js`) |
| `GET /api/analytics` | same as `/api/metrics` | `total` sessions, `avgDuration`, and per phase (`clone`, `analysis`) `count`, `totalDuration`, `avgDuration` and `outcomes` (`ok` / `failed` counts), plus the last 10 sessions |

Source: `server/server.js`, `server/utils/performance.js`.

Limits of these numbers:

- They are in-process counters, reset on every restart.
- A request counts as an error when its status is 400 or higher, so 401 and 404 answers count too (`trackRequest`).
- Analytics record one `clone` phase per clone request (from session creation to clone success or failure) and one `analysis` phase per analysis job (from the job's start to `completed` or `failed`; time spent queued is not included) (`server/server.js`).
- Analytics keep sessions for one hour and at most 1,000, oldest dropped first. Expired entries are pruned on every insert and read and by the hourly session cleanup (`server/utils/performance.js`).
- `/health` does not check the database, Supabase, GitHub or the AI providers.

```bash
curl -s http://localhost:<port>/health
curl -s -H "X-Metrics-Token: $METRICS_TOKEN" http://localhost:<port>/api/metrics
```

## Sessions

Session state is the main record of what happened to an analysis: `status`, `error`, timestamps and the last progress snapshot (`analysis_sessions` with `SESSION_STORE=database`). The owner can read it from `GET /api/status/:sessionId` (`server/server.js`, `server/utils/sessionView.js`).

Startup prints how many interrupted sessions were marked failed, how many sessions cloned over 1 hour ago without an analysis were marked failed, and how many expired sessions and temp directories were removed (`🧹 ...` lines in `server/server.js`).

## Analysis jobs

Analyses run in the background job runner (`server/utils/jobs.js`). Its console lines carry the session id only, never a repository name or a user:

- `analysis job queued: session=<id> position=<n>` when every slot is busy;
- `analysis job started: session=<id>`;
- `analysis job finished: session=<id> outcome=ok ms=<n>`;
- `analysis job finished: session=<id> outcome=failed ms=<n>: <error>`, with the error passed through `redactSecrets`. A failed job is never an unhandled rejection.

A request refused because the runner is full answers 503 `ANALYSIS_BUSY` and logs nothing extra; `analysisJobs` in `/api/metrics` shows the counts. At startup: `🧵 Analysis jobs: <n> at once, <m> queued at most`.

## Startup, process errors and shutdown

All console lines from `server/server.js`:

- A configuration problem stops the server: `❌ Configuration problems (N):` and one `❌ <problem>` line each, naming variables, never values.
- On a clean start: `🌐 Allowed origins: ...`, `🌐 Trust proxy: <0-3>`, `🚦 Rate limits: preAuth 300 per 5 min, ...` and `🧵 Analysis jobs: 2 at once, 20 queued at most` (names and numbers only).
- `❌ Unhandled rejection: <class>: <message>` and `❌ Uncaught exception: <class>: <message>`, each one line, passed through `redactSecrets`; never the promise object or a stack.
- `🛑 Shutting down: <SIGTERM | SIGINT | uncaught exception>`, then `🛑 Pending GitHub connect tokens: <n> revoked, <m> failed` and `🛑 Analysis jobs: <n> still running, <m> queued dropped` (the runner waits at most 1 s for running jobs and does not finish them). No token is ever logged.
- `GitHub rate limit reached: <route>` and `GitHub did not respond: <route>` when a GitHub-backed route answers 503 `GITHUB_RATE_LIMITED` or 504 `GITHUB_UNAVAILABLE`.

## Legacy: Keywords AI tracking

`server/index.js` (the legacy `devPilotAI` generator) sends events such as `devpilot_request_started`, `dockerfile_generation_completed` and `tavily_query_completed` to Keywords AI when `KEYWORDS_AI_API_KEY` is set (`KEYWORDS_AI_BASE_URL` defaults to `https://api.keywordsai.co`). That file is imported only by `server/test.js` (`npm run test:legacy`); the running server does not load it and sends nothing to Keywords AI.
