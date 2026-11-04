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

Other AI log lines: the startup route summary (`🤖 AI route planner: ...`, provider names and models only) and circuit-breaker warnings (`ai provider <name> circuit open for <n>s (<outcome>)`) (`server/server.js`, `server/ai/client.js`).

## Log files

`utils/logger.js` writes JSON lines into `logs/` under the server's working directory, and the same messages to the console:

| File | Written by |
|---|---|
| `logs/app.log` | `logger.info` and `logger.warn`: one line per HTTP request (method, redacted URL, status, duration, IP, user agent), rate-limit hits, slow requests (over 1 s) |
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
| `GET /api/metrics` | `X-Metrics-Token` equal to `METRICS_TOKEN` (32+ characters), otherwise 404 | Uptime, Node `version`, `environment`, request totals, error count, success rate, average response time, memory, CPU usage, `trackedSessions` (entries in the analytics map, not active sessions) |
| `GET /api/analytics` | same as `/api/metrics` | `total` sessions, `avgDuration`, and per phase (`clone`, `analysis`) `count`, `totalDuration`, `avgDuration` and `outcomes` (`ok` / `failed` counts), plus the last 10 sessions |

Source: `server/server.js`, `server/utils/performance.js`.

Limits of these numbers:

- They are in-process counters, reset on every restart.
- A request counts as an error when its status is 400 or higher, so 401 and 404 answers count too (`trackRequest`).
- Analytics record one `clone` phase per clone request (from session creation to clone success or failure) and one `analysis` phase per analysis (from `analyzing` to `completed` or `failed`) (`server/server.js`).
- Analytics keep sessions for one hour and at most 1,000, oldest dropped first. Expired entries are pruned on every insert and read and by the hourly session cleanup (`server/utils/performance.js`).
- `/health` does not check the database, Supabase, GitHub or the AI providers.

```bash
curl -s http://localhost:<port>/health
curl -s -H "X-Metrics-Token: $METRICS_TOKEN" http://localhost:<port>/api/metrics
```

## Sessions

Session state is the main record of what happened to an analysis: `status`, `error`, timestamps and the last progress snapshot (`analysis_sessions` with `SESSION_STORE=database`). The owner can read it from `GET /api/status/:sessionId` (`server/server.js`, `server/utils/sessionView.js`).

Startup prints how many interrupted sessions were marked failed and how many expired sessions and temp directories were removed (`🧹 ...` lines in `server/server.js`).

## Legacy: Keywords AI tracking

`server/index.js` (the legacy `devPilotAI` generator) sends events such as `devpilot_request_started`, `dockerfile_generation_completed` and `tavily_query_completed` to Keywords AI when `KEYWORDS_AI_API_KEY` is set (`KEYWORDS_AI_BASE_URL` defaults to `https://api.keywordsai.co`). That file is imported only by `server/test.js` (`npm run test:legacy`); the running server does not load it and sends nothing to Keywords AI.
