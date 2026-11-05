# InfraMind Deployment Guide

How to configure and deploy InfraMind as it is implemented in this repository. For how the parts work together see [ARCHITECTURE.md](ARCHITECTURE.md).

## What you need

- **Node.js** matching `server/package.json` `engines`: `^20.19 || ^22.12 || >=24.0`. The root `npm run dev` launcher, `concurrently` 10, requires Node.js 22 or later (its `engines`); on Node 20 use `npm run dev:client` and `npm run dev:server`
- **`git`** on the server machine: clones run the `git` binary (`server/utils/git.js`)
- **A Supabase project:** Auth, and Postgres for `saved_files` and (optionally) `github_connections`
- **A GitHub OAuth App** for repository access, separate from the GitHub sign-in provider in Supabase
- **At least one AI provider account:** `gemini`, `groq`, `openrouter` or `novita` (`server/ai/providers.js`)
- **Postgres for sessions** if you use `SESSION_STORE=database`. `server/.env.example` describes the Supabase session pooler for this

The server refuses to start without the Supabase, GitHub token store, AI, session store, `CLIENT_URL` and GitHub OAuth App settings, and lists every problem at once; see [Startup checks](#startup-checks).

---

## 1. Supabase

### 1.1 Project and keys

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard)
2. In **Project Settings → API Keys**, copy:

| Supabase value | Client variable | Server variable |
|---|---|---|
| Project URL | `VITE_SUPABASE_URL` | `SUPABASE_URL` |
| Publishable (anon) key | `VITE_SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY` |
| Secret (`service_role`) key | never | `SUPABASE_SERVICE_ROLE_KEY`, only with `GITHUB_TOKEN_STORE=supabase` |

The server uses the URL and anon key to verify user access tokens (`server/utils/auth.js`). It uses the service-role key only for `public.github_connections` (`server/utils/githubConnections.js`). The service-role key bypasses Row Level Security: never put it in a `VITE_` variable, because Vite bundles those into browser code.

### 1.2 Database setup

**`public.saved_files`** (used by the browser for "Save to Account" and the Saved Files tab). Apply `supabase/migrations/20261104000000_saved_files.sql`: paste it into the **SQL Editor** and run it, or apply it with the Supabase CLI against your linked project (`supabase db push` applies the files in `supabase/migrations/`).

The migration is idempotent and non-destructive, so it is safe on a project where the table was already created from the SQL this guide used to contain. It uses `create table if not exists` and `create index if not exists`, enables RLS, drops and recreates its three policies by name, and never drops the table, changes columns or touches rows. Before applying it to an existing project, compare the live table and policies with the file: a policy with a different name is not replaced and stays active alongside the new ones.

What it sets up:
- The table `id`, `user_id` (references `auth.users`, cascades on delete), `name`, `type`, `repo_url`, `content`, `created_at`, and the index on `(user_id, created_at desc)`
- Policies for `authenticated` only: a signed-in user can read, insert and delete only rows whose `user_id` matches their own `auth.uid()`. There is no `update` policy, so saved files can't be edited (the app never edits them)
- Privileges: `authenticated` gets exactly `select`, `insert` and `delete`; everything else Supabase grants by default on new tables, including all of `anon`'s access, is revoked. A request without a session (anon key only) is refused

The client uses the columns `id`, `user_id`, `name`, `type`, `repo_url`, `content` and `created_at` (`SavedFilesAPI` in `client/src/lib/api.ts`).

**`public.github_connections`** (needed only with `GITHUB_TOKEN_STORE=supabase`). Apply `supabase/migrations/20261103000000_github_connections.sql`. It creates the table, enables RLS with no policies and revokes all access from `anon` and `authenticated`, so only the service-role key can use it.

The session tables (`analysis_sessions`, `generated_files`, `ai_calls`) are created by Prisma, not by Supabase SQL; see [section 4](#4-session-database-session_storedatabase).

### 1.3 URL configuration (redirects)

After an OAuth sign-in, the app asks Supabase to send the user back to `<current origin>/dashboard` (see `client/src/lib/supabase.ts`). Supabase only redirects to URLs on its allow list. For any other URL it falls back to the Site URL. A failed or cancelled Google or GitHub sign-in also comes back to `/dashboard`, and the app shows its error on `/auth`; `redirectTo` is still `/dashboard`, so no Supabase setting changes.

In **Authentication → URL Configuration**:

| Setting | Local development | Production |
|---------|-------------------|------------|
| Site URL | `http://localhost:5173` | your frontend URL |
| Redirect URLs | `http://localhost:5173/**` | `<your frontend URL>/**` |

- Site URL holds a single value. Switch it to the production URL when you deploy
- Redirect URLs can hold several. Keep the localhost entry if you also develop against this project, and add any preview-deployment domains you use

### 1.4 Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**, create an **OAuth client ID** of type **Web application** (set up the OAuth consent screen first if prompted)
2. Under **Authorized redirect URIs**, add `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase shows this exact URL on its Google provider page
3. In Supabase → **Authentication → Sign In / Providers → Google**, enable the provider and paste the Client ID and Client Secret

The callback URL points at Supabase, not at your frontend, so it's the same for local development and production.

### 1.5 GitHub sign-in

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: your frontend URL
   - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
2. In Supabase → **Authentication → Sign In / Providers → GitHub**, enable the provider and paste the Client ID and Client Secret

This app is only for signing in to InfraMind. It gives the server no repository access; that is the separate app in [section 2](#2-github-oauth-app-for-repository-access).

### 1.6 Email and password

The Email provider is enabled by default. With **Confirm email** on (the default), new users must click the confirmation link before they can sign in. In that case the app shows "Check your email to confirm your account, then sign in." (`client/src/lib/supabase.ts`). You can turn confirmation off for local testing. Supabase's built-in email sender is rate-limited, so configure custom SMTP under **Authentication → Emails** before production.

---

## 2. GitHub OAuth App for repository access

This app is run by the InfraMind server (`server/github.js`). It requests the scope `repo,user:email`.

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
2. Authorization callback URL: the server's `/auth/github/callback`, for example `http://localhost:10000/auth/github/callback` locally (as in `server/.env.example`) or `https://<your-backend>/auth/github/callback` in production
3. Set on the server:

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URI=<the callback URL from step 2>
CLIENT_URL=<your frontend URL>     # the server redirects to CLIENT_URL/auth/success after the callback
GITHUB_TOKEN_STORE=supabase        # or memory (connections are lost on restart)
GITHUB_TOKEN_ENC_KEY=<openssl rand -base64 32>
```

`GITHUB_REDIRECT_URI` may instead point at the client's `/auth/github/callback` route, which forwards the query string to the server (`client/src/pages/GitHubCallback.tsx`). The step-by-step connect flow is diagram 3 in [ARCHITECTURE.md](ARCHITECTURE.md#3-github-connection).

`GITHUB_TOKEN_ENC_KEY` encrypts every stored token. Changing it makes existing connections unreadable: the server deletes an unreadable connection on its next read, and the user has to connect again (`server/utils/githubConnections.js`).

---

## 3. AI providers

```bash
AI_PROVIDERS=gemini,groq,openrouter      # default chain, in order
# Optional per-task chains:
# AI_ROUTE_GENERATOR=gemini,openrouter
# AI_ROUTE_VERIFIER=groq,gemini
GEMINI_API_KEY=...
GEMINI_MODEL=<model id>
# ...the same pair for every other provider in any chain
```

- Every provider in any chain needs `<NAME>_API_KEY` and `<NAME>_MODEL`. There are no default model IDs (`server/ai/providers.js`, `server/ai/config.js`).
- `AI_ROUTE_PLANNER` is no longer used (the planner agent was removed). If it is still set, for example in an existing Render environment, the server starts and logs one warning naming it; it can be removed.
- Up to 300 of the repository's file paths, the detected tech stack, and the contents of its top-level manifests (such as `requirements.txt`, `pyproject.toml`, `package.json`; up to 8 KB each, 32 KB in total) and of the first two existing Dockerfiles found at any depth and the workflows (up to 4 KB each) are sent to these providers. `.env` files are never read ([README-AI-AGENTS.md](README-AI-AGENTS.md#what-reaches-the-ai-providers)).
- Credentials found in manifests and in the existing Dockerfile and workflow excerpts are redacted on a best-effort basis before they reach a prompt: URL user names and passwords, tokens shaped like known secrets, the values of keys containing TOKEN, SECRET, PASSWORD, PASSWD, API_KEY or PRIVATE_KEY (also in quoted headers and Dockerfile `ENV`/`ARG KEY value`), `Authorization:` and `Proxy-Authorization:` credentials, Slack and Discord webhook paths, `curl -u`/`--oauth2-bearer` values and `docker login -p`/`--password` values (also in a command continued over several lines with `\`) become `REDACTED` (`redactCredentials` in `server/agents/grounding.js`); keep secrets out of manifests.
- Limits: `AI_TIMEOUT_MS` (default 60000), `AI_CALL_BUDGET_MS` (default 180000), `AI_MAX_ATTEMPTS_PER_PROVIDER` (default 2) (`server/ai/config.js`).
- Check the configuration against the real providers with `RUN_LIVE_AI=1 npm run ai:smoke` in `server/` (`server/scripts/ai-smoke.js`).

---

## 4. Session database (`SESSION_STORE=database`)

With `SESSION_STORE=memory` every session and result is lost on restart. For production use `database`, which keeps sessions in Postgres through Prisma (`server/utils/sessionStore.js`).

1. Set `DATABASE_URL`. `server/.env.example` describes the Supabase **Session pooler** string (port 5432)
2. Generate the Prisma client: `npm run db:generate` in `server/` (writes `server/generated/prisma`)
3. Apply the migration **manually**: `npm run db:deploy` in `server/` (`prisma migrate deploy`). `npm run db:status` shows what is applied
4. Start the server with `SESSION_STORE=database`

At startup the server checks that the database answers and that the schema exists. Otherwise it exits with "Database unreachable (DATABASE_URL)" or "Database schema missing: run npm run db:deploy" (`server/server.js`).

Never run `npm run db:migrate:dev` against Supabase. It runs `server/scripts/assert-local-db.js` first, which refuses any `DATABASE_URL` host other than `localhost`, `127.0.0.1` or `::1`.

TLS: for any non-local host the server always uses TLS and verifies the certificate. If verification fails, point `DATABASE_SSL_CA_FILE` at the CA certificate; `DATABASE_SSL_INSECURE_SKIP_VERIFY=true` turns verification off and logs a warning at startup (`server/db/config.js`).

---

## 5. Local development

```bash
npm run install:all                       # root, client and server dependencies
cp server/.env.example server/.env        # then fill it in
cp client/.env.example client/.env.local  # then fill it in
npm run dev                               # client and server together (concurrently)
```

| Setting | Where it comes from |
|---|---|
| Client dev server | `http://localhost:5173` (`client/vite.config.ts`) |
| Server port | `PORT`; without it 10000 (`server/utils/port.js`), the same value as `server/.env.example` and `render.yaml` |
| Client → server URL | `VITE_API_URL`; without it the client uses `http://localhost:10000` (`client/src/lib/api.ts`) |
| CORS and Socket.IO origins | `CLIENT_URL`'s origin, `CORS_ALLOWED_ORIGINS`, and `http://localhost:5173` when `NODE_ENV` is not `production` (`server/utils/config.js`) |

Set `VITE_API_URL` to the server's actual URL whenever the port is not 10000. The client reads `VITE_*` variables at build time (Vite), so restart the dev server or rebuild after changing them.

---

## Deployment on Render

`render.yaml` defines two services. It defines no environment groups; every secret is set per service in the Render dashboard.

```mermaid
flowchart TB
    Repo["Git repository with render.yaml"]
    YamlEnv["Set in render.yaml: NODE_VERSION 24, NODE_ENV production, PORT 10000"]
    BackEnv["Set in the Render dashboard: SUPABASE_*, GITHUB_*, AI settings, SESSION_STORE, DATABASE_URL, CLIENT_URL, optional CORS_ALLOWED_ORIGINS, TRUST_PROXY, METRICS_TOKEN"]
    FrontEnv["Set in the Render dashboard: VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"]
    subgraph Render
        Backend["inframind-backend, web, node. Build: cd server && npm ci --include=dev && npm run db:generate. Start: cd server && npm start. Health check: /health"]
        Frontend["inframind-frontend, static, NODE_VERSION 18.0.0. Build: cd client && npm install && npm run build. Publish: client/dist. Rewrite all paths to /index.html"]
    end
    Operator["Operator, manually before deploying"]
    DB[("Postgres at DATABASE_URL")]
    SB[("Supabase: supabase/migrations SQL for github_connections and saved_files")]

    Repo --> Backend
    Repo --> Frontend
    YamlEnv --> Backend
    BackEnv --> Backend
    FrontEnv -->|"inlined at build time"| Frontend
    Operator -->|"npm run db:deploy"| DB
    Operator -->|"run the SQL"| SB
    Backend -->|"SESSION_STORE=database"| DB
```

Source: `render.yaml`, `server/package.json` (`db:generate`, `db:deploy`, `start`), `server/server.js`, `supabase/migrations/20261103000000_github_connections.sql`, `client/src/lib/api.ts`, `client/src/lib/supabase.ts`.

Notes:

- The backend build installs dev dependencies (`--include=dev`) so the Prisma CLI is available for `npm run db:generate`. The build never runs migrations: `render.yaml` says the owner runs `npm run db:deploy` deliberately before deploying.
- `npm start` runs `node server.js`. Render's health check calls `/health`, a liveness check that returns `{ status: "ok", timestamp, uptime }`; it does not check the database, Supabase or the AI providers (`server/utils/performance.js`).
- `render.yaml` sets no `VITE_*` variables for the frontend. Set them in the dashboard before the build, and rebuild after changing them.
- Set `CLIENT_URL` on the backend to the frontend's origin, `https://<frontend host>` with no path or trailing slash. It is always an allowed CORS and Socket.IO origin and the target of the GitHub OAuth redirect; with `NODE_ENV=production` it must use https (`server/utils/config.js`, `server/server.js`).
- Add any other frontend origin (a custom domain, a preview host) to `CORS_ALLOWED_ORIGINS`, comma-separated, each exactly `https://host[:port]`. `http://localhost:5173` is not allowed in production.
- Set `GITHUB_REDIRECT_URI` to `https://<backend URL>/auth/github/callback` and use the same URL as the OAuth App's callback.
- `TRUST_PROXY` is not set in `render.yaml`. Render's documentation does not state how many proxies sit in front of a web service, so the default 0 stays: until you set it, every visitor shares one IP for the per-IP limits (`preAuth`, `oauth`, `socketHandshake`), which can make busy periods hit 429 for everyone. After deploying, check which address the server sees (see [Checking the client IP](#checking-the-client-ip)) and set `TRUST_PROXY` to the smallest number that gives each visitor their own address. Never set it higher than the real number of proxies: entries further left in `X-Forwarded-For` come from the client and can be forged.

Backend variables to set in the dashboard, at minimum:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...          # with GITHUB_TOKEN_STORE=supabase
GITHUB_TOKEN_STORE=supabase
GITHUB_TOKEN_ENC_KEY=...               # openssl rand -base64 32
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URI=https://<backend URL>/auth/github/callback
CLIENT_URL=https://<frontend URL>
AI_PROVIDERS=...
<NAME>_API_KEY=...                     # for every provider in a chain
<NAME>_MODEL=...
SESSION_STORE=database
DATABASE_URL=...
METRICS_TOKEN=...                      # optional, 32+ characters
ANALYSIS_CONCURRENCY=2                 # optional, analyses at once (1-8)
ANALYSIS_QUEUE_MAX=20                  # optional, analyses waiting (0-100)
CORS_ALLOWED_ORIGINS=...               # optional, more frontend origins
TRUST_PROXY=...                        # optional, after checking the client IP (below)
```

### Checking the client IP

With `TRUST_PROXY` unset, make a request to the backend and read its access-log line in Render's logs: `requestLogger` logs the `ip` of every request (`server/utils/security.js`). If it is a Render-internal address that does not change between your devices, try `TRUST_PROXY=1`, redeploy, and compare again with a second device or network: the logged `ip` should then be each device's public address (for example the one `curl https://ifconfig.me` shows). If it still is not, try 2, then 3. The value is a startup error outside 0-3, and `true` is never accepted.

In production the server warns at startup when `GITHUB_TOKEN_STORE=memory` or `SESSION_STORE=memory`, because both lose their data on every restart (`server/server.js`).

Analyses run in the background inside the server process (`server/utils/jobs.js`): `POST /api/analyze` answers 202 at once, so no request is held open for the minutes an analysis can take, and the browser follows progress through Socket.IO, with status polling as the backstop. Run **one** backend instance: the job queue is in memory and not shared. A deploy or restart ends the analyses that are running or queued; with `SESSION_STORE=database` the next start marks them `failed` ("The server restarted before this analysis finished. Please run it again."), and the user starts them again. Each running analysis holds a clone in `temp/`; it is deleted when the analysis ends, and an unanalyzed clone after 1 hour.

### Other frontend hosts

The client is a static build (`cd client && npm run build`, output `client/dist`). Any static host works if it serves `index.html` for every path, as the Render rewrite does, and has the three `VITE_*` variables at build time. The server allows `CLIENT_URL`'s origin and the origins in `CORS_ALLOWED_ORIGINS` (plus `http://localhost:5173` outside production), for both CORS and Socket.IO.

---

## Startup checks

`startServer()` in `server/server.js` first collects every configuration problem and prints them as one list, `Configuration problems (N):` followed by one `❌` line each, then exits 1. Only when the list is empty does it check the database connection, then the schema. Messages name variables, never values.

| Message (start) | Fix |
|---|---|
| `SUPABASE_URL ...` / `SUPABASE_ANON_KEY is not set` | Set both (https URL; http only for localhost) |
| `GITHUB_TOKEN_STORE is not set` / `must be "memory" or "supabase"` | Set `GITHUB_TOKEN_STORE` |
| `GITHUB_TOKEN_ENC_KEY ...` | `openssl rand -base64 32` |
| `SUPABASE_SERVICE_ROLE_KEY is not set (required when GITHUB_TOKEN_STORE=supabase)` | Set it, or use `memory` |
| `AI_PROVIDERS is not set ...`, `<NAME>_API_KEY is not set ...`, `<NAME>_MODEL is not set ...` | Fix the AI settings |
| `SESSION_STORE is not set (use "memory" or "database")` | Set `SESSION_STORE` |
| `DATABASE_URL ...` | Set a `postgres://` or `postgresql://` URL |
| `PORT must be an integer from 1 to 65535` | Fix or unset `PORT` |
| `CLIENT_URL is not set` / `must use https when NODE_ENV=production` / `must be an origin only` | Set the frontend origin, for example `https://app.example.com` |
| `GITHUB_CLIENT_ID is not set` / `is still the placeholder from .env.example` (same for `GITHUB_CLIENT_SECRET`) | Copy both from the OAuth App |
| `GITHUB_REDIRECT_URI ...` | An absolute URL ending in `/auth/github/callback`, https in production |
| `TRUST_PROXY must be an integer from 0 to 3` | Set the number of proxies, or unset it |
| `CORS_ALLOWED_ORIGINS entry N ...` | Each entry exactly `scheme://host[:port]`, http or https |
| `RATE_LIMIT_<NAME>_MAX must be an integer from 1 to 100000` / `is not a known rate limit` | Fix the value or the variable name |
| `GITHUB_TIMEOUT_MS must be an integer from 1000 to 60000` | Fix or unset it |
| `METRICS_TOKEN must be at least 32 characters` | Use 32+ random characters, or leave it empty |
| `ANALYSIS_CONCURRENCY must be an integer from 1 to 8` / `ANALYSIS_QUEUE_MAX must be an integer from 0 to 100` | Fix or unset it |
| `Prisma client not generated: run npm run db:generate` | Run it in `server/` |
| `Database unreachable (DATABASE_URL)` | Check the URL, network and TLS settings |
| `Database schema missing: run npm run db:deploy` | Apply the migration |

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Every API call returns 401 `AUTH_REQUIRED` | The client is not sending a Supabase session token, or the server's `SUPABASE_URL` / `SUPABASE_ANON_KEY` belong to another project (`server/utils/auth.js`) |
| API calls return 503 `AUTH_UNAVAILABLE` | The server cannot reach Supabase Auth (`server/utils/auth.js`) |
| "Connect GitHub" ends on `/auth/success` with an error | `invalid_state` (cookie missing or expired), `connect_expired` (ticket older than 2 minutes), `access_denied`, or `github_auth_failed`; check `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI` and `CLIENT_URL` (`server/server.js`) |
| 503 `GITHUB_STORE_UNAVAILABLE` | The `github_connections` table or the service-role key is not reachable (`server/utils/githubConnections.js`) |
| 503 `SESSION_STORE_UNAVAILABLE` | The session database is not reachable (`server/server.js`) |
| 429 `RATE_LIMITED` for many users at once | Behind Render without `TRUST_PROXY`, every visitor shares one IP bucket; see [Checking the client IP](#checking-the-client-ip) |
| 503 `GITHUB_RATE_LIMITED` | GitHub rate-limited this user's token; `Retry-After` says when to retry (`server/github.js`) |
| 504 `GITHUB_UNAVAILABLE` | GitHub did not answer within `GITHUB_TIMEOUT_MS` (default 10 s) or could not be reached |
| 503 `ANALYSIS_BUSY` on "Start AI Analysis" | `ANALYSIS_CONCURRENCY` analyses are running and `ANALYSIS_QUEUE_MAX` are waiting; `analysisJobs` in `/api/metrics` shows the counts. The cloned session can be retried (`server/server.js`) |
| An analysis shows `failed` with "The server restarted before this analysis finished" | The backend restarted or redeployed while it ran or waited (`markInFlightFailed`) |
| The browser gets no CORS headers, or the socket does not connect | The page's origin is not `CLIENT_URL`'s origin or in `CORS_ALLOWED_ORIGINS`; the startup line `🌐 Allowed origins:` shows the list |
| Clone fails with 404 "Repository not found or access denied" | The repository is private and was entered as a URL without a token, or the GitHub connection cannot see it (`server/utils/git.js`, `server/server.js`) |
| Saved files list is empty or an insert fails | The `saved_files` table or its policies are missing, or the user has no session |
| `errors` shows "AI providers are unavailable" | See the `ai_call` log lines ([server/OBSERVABILITY.md](server/OBSERVABILITY.md)) |
