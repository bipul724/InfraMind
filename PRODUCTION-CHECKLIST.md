# InfraMind Production Checklist

A checklist for an operator preparing a deployment. Nothing here is pre-ticked: each item is something to do or check on your own deployment. Setup details are in [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md).

## CI and branch protection (owner)

- [ ] After the first push, confirm every CI job is green in the repository's [Actions tab](https://github.com/bipul724/InfraMind/actions): `client` and `server` on Node 22 and 24, `server-db`, `e2e` and `audit`.
- [ ] In the repository's GitHub settings, configure branch protection for `main` to require all CI jobs to pass before merging. Only the owner can enable these required checks.

## Render deployment (owner; T-161)

### Before the first Blueprint deploy

- [ ] Apply the Supabase SQL migrations in filename order, including the read-only duplicate count before the saved-file limits migration as described in [Supabase](#supabase). Then run `npm run db:deploy` in `server/` against the production session database. If the existing Supabase tables cause P3005, complete [the baseline procedure](#prisma-p3005-owner-baseline) before retrying. Complete both migration steps before deploying; the Render build does not apply migrations.
- [ ] Use a separate repository-access GitHub OAuth App for production and leave the local app's `http://localhost:10000/auth/github/callback` configuration intact. Keep the Supabase GitHub sign-in provider's OAuth App separate too. This is InfraMind's environment-separation policy; [GitHub currently allows up to 10 OAuth App callback URLs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
- [ ] Set `CLIENT_URL` to the actual frontend origin, currently `https://inframind-frontend.onrender.com`, with no path, query or trailing slash.
- [ ] Set `GITHUB_REDIRECT_URI` to `https://inframind-backend-bsl1.onrender.com/auth/github/callback`. Copy that exact URL into the production repository-access OAuth App's callback setting, and set its homepage to `https://inframind-frontend.onrender.com`.
- [ ] In Supabase Auth URL Configuration, set the Site URL to `https://inframind-frontend.onrender.com` and include `https://inframind-frontend.onrender.com/**` in Redirect URLs. The project URL is `https://swpjtyojdwstwqznyhuh.supabase.co`.
- [ ] Remove `AI_ROUTE_PLANNER` if it is still set; the planner no longer exists and the server only warns about the retired setting.
- [ ] Fill in the backend settings when the first Blueprint deploy prompts for its `sync: false` variables. Keep the server-only keys in the backend service:

| Backend variable | Where its value comes from |
|---|---|
| `CLIENT_URL` | The frontend's public HTTPS origin, with no path or trailing slash |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | The same project's URL and either the legacy `anon` JWT or a new public key with the `sb_publishable_` prefix in Supabase Project Settings → API Keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Either the legacy `service_role` JWT or a new server-only key with the `sb_secret_` prefix; never a publishable key and never copied into the frontend |
| `GITHUB_TOKEN_ENC_KEY` | Generate with `openssl rand -base64 32`; store it safely because replacing it makes existing GitHub connections unreadable |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The repository-access GitHub OAuth App's settings |
| `GITHUB_REDIRECT_URI` | `https://<backend host>/auth/github/callback`, exactly matching that OAuth App's callback |
| `DATABASE_URL` | Supabase Connect → Session pooler string: port `5432`, user `postgres.<project-ref>`, the supplied pooler host, and `?sslmode=require`. Percent-encode reserved password characters or use an alphanumeric password; do not use the IPv6-only direct `db.<project-ref>.supabase.co` endpoint from this Render deployment |
| `AI_PROVIDERS` | The chosen ordered provider chain, such as `gemini,groq,openrouter` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | The Gemini provider dashboard's key and a current model ID |
| `GROQ_API_KEY`, `GROQ_MODEL` | The Groq provider dashboard's key and a current model ID |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | The OpenRouter provider dashboard's key and a current model ID |
| `METRICS_TOKEN` | At least 32 random characters, for example generated with `openssl rand -hex 32`; send it only in `X-Metrics-Token` when using operator endpoints |

- [ ] Fill in the frontend prompts: `VITE_API_URL=https://inframind-backend-bsl1.onrender.com`, `VITE_SUPABASE_URL=https://swpjtyojdwstwqznyhuh.supabase.co`, and `VITE_SUPABASE_ANON_KEY` set to the project's legacy `anon` JWT or new `sb_publishable_` key. Public URLs must contain no username/password; the API URL must have no path, query, fragment or trailing slash. A service-role JWT or an `sb_secret_` key must never enter the browser bundle.
- [ ] Confirm the Blueprint's fixed backend settings: Node 24, `NODE_ENV=production`, `PORT=10000`, `SESSION_STORE=database`, `GITHUB_TOKEN_STORE=supabase`, and `OPENROUTER_DATA_COLLECTION=deny`. The frontend also builds on Node 24.
- [ ] Leave frontend `NODE_ENV` unset or set it to `production`. The frontend build runs `npm ci`, then `npm run check:deploy-env`, then `npm run build`; the guard fails for missing/local/non-HTTPS public settings, URL credentials, an API URL containing a path, query, fragment or trailing slash, a wrong `NODE_ENV`, or a secret key. It names the variable without exposing its value.
- [ ] Keep later changes in each service's dashboard: `sync: false` prompts only at the first Blueprint deploy. Rebuild the frontend whenever a `VITE_*` value changes.

### Confirm the actual URLs after the first deploy

- [ ] Read the real URLs from both Render service dashboards. The Blueprint names stay `inframind-backend` and `inframind-frontend`, but Render added `-bsl1` to this backend's public hostname. Do not infer a public hostname from a service name.
- [ ] If either actual URL differs from what was entered, update backend `CLIENT_URL` and `GITHUB_REDIRECT_URI`, frontend `VITE_API_URL`, the production GitHub OAuth App's homepage/callback, and Supabase Auth's Site URL/Redirect URLs together. For changed `VITE_*` values use **Clear build cache & deploy**.
- [ ] Regenerate the CSP when the backend or Supabase host changes, copy the resulting header into the frontend's `Content-Security-Policy` entry in `render.yaml`, update the expected production origins in `client/scripts/render-blueprint.test.mjs`, run the client tests, and sync the Blueprint. From the repository root, the current command is:

```bash
node client/scripts/csp.mjs https://inframind-backend-bsl1.onrender.com https://swpjtyojdwstwqznyhuh.supabase.co
```

### Prisma P3005 owner baseline

- [ ] If `npm run db:deploy` reports P3005, "The database schema is not empty", check these four Prisma relations in the Supabase SQL Editor. All must be null; if any exists, stop and inspect the schema/history instead of applying the initial-baseline recipe.

```sql
select
  to_regclass('public.analysis_sessions') as analysis_sessions,
  to_regclass('public.generated_files') as generated_files,
  to_regclass('public.ai_calls') as ai_calls,
  to_regclass('public._prisma_migrations') as prisma_migrations;
```

- [ ] As the database owner in the SQL Editor, run `set search_path = public;`, then the entire `server/prisma/migrations/20261103200038_init/migration.sql`. It creates only the Prisma-owned tables; preserve `saved_files` and `github_connections`.
- [ ] From the repository root, run the installed Prisma CLI in **Bash** (`bash` first in a zsh terminal). Paste the complete, percent-encoded Session pooler URL at the silent prompt so its password is not a shell-history entry; the subshell discards it afterwards:

```bash
(
  set +x
  set -e
  cd server
  read -s -r -p 'DATABASE_URL (Session pooler, sslmode=require): ' DATABASE_URL
  printf '\n'
  export DATABASE_URL
  npx prisma migrate resolve --applied 20261103200038_init
)
```

- [ ] Immediately lock `_prisma_migrations` in the SQL Editor: `resolve` created it after the initial migration's own lockdown ran.

```sql
alter table public._prisma_migrations enable row level security;
revoke all on table public._prisma_migrations from public, anon, authenticated;
```

- [ ] Verify four RLS-enabled tables, no grants to browser roles or `PUBLIC`, and a finished baseline record. Expect four `true` rows from the first query, zero rows from the second, and a non-null `finished_at` with null `rolled_back_at` from the third:

```sql
select schemaname, tablename, rowsecurity as rls_enabled
from pg_catalog.pg_tables
where schemaname = 'public'
  and tablename in ('analysis_sessions', 'generated_files', 'ai_calls', '_prisma_migrations')
order by tablename;

select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('analysis_sessions', 'generated_files', 'ai_calls', '_prisma_migrations')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;

select migration_name, finished_at, rolled_back_at
from public._prisma_migrations
where migration_name = '20261103200038_init';
```

- [ ] Run `npm run db:deploy`, then `npm run db:status` using the second silent-prompt Bash block in [the baseline runbook](DEPLOYMENT-GUIDE.md#p3005-baseline-an-existing-supabase-project). Complete the database deployment before deploying Render.

### Database CA and temporary memory mode

- [ ] Download the CA certificate from Supabase **Database → Settings → SSL Configuration**. Add a Render backend **Secret File** named `supabase-ca.crt` containing the certificate. Separately add the **environment variable** `DATABASE_SSL_CA_FILE=/etc/secrets/supabase-ca.crt`. A file's name/contents and an environment variable's name/value are different controls; leave certificate verification enabled.
- [ ] If a temporary fallback is needed, set both `SESSION_STORE=memory` and `GITHUB_TOKEN_STORE=memory`. This avoids the database/service-key startup requirements but loses all backend sessions, generated results, queued work and GitHub connections at every free-plan spin-down, restart or deploy. Supabase Auth users and files already saved in Supabase remain there.
- [ ] Before a later Blueprint sync, prepare the database and service key: the sync resets these dashboard overrides to `SESSION_STORE=database` and `GITHUB_TOKEN_STORE=supabase` from `render.yaml`.

### Optional backend overrides and client-IP check

- [ ] Leave `TRUST_PROXY` at its default 0 until comparing the backend access log's `ip` from two devices or networks. If it shows an internal proxy address, try 1, then 2 or 3 only as needed, redeploying and comparing with the real public client addresses. Choose the smallest correct hop count; never use boolean `true` or trust more proxies than are present. See [Checking the client IP](DEPLOYMENT-GUIDE.md#checking-the-client-ip).
- [ ] Add `CORS_ALLOWED_ORIGINS` only for additional frontend origins, each an exact HTTP(S) origin with no path, wildcard or trailing slash. `CLIENT_URL` is always allowed; localhost:5173 is automatically added only outside production.
- [ ] Review `ANALYSIS_CONCURRENCY=2` (range 1–8) and `ANALYSIS_QUEUE_MAX=20` (range 0–100), per process. Keep one backend instance because its queue is in memory.
- [ ] Review optional rate-limit counts and timeouts only if defaults do not suit the deployment: `RATE_LIMIT_<NAME>_MAX`, `GITHUB_TIMEOUT_MS=10000`, `GITHUB_CONNECT_COMPLETION_TTL_MS=300000`, `CLONE_TIMEOUT_MS=120000`, `MAX_REPO_SIZE_MB=200`, `AI_TIMEOUT_MS=60000`, `AI_CALL_BUDGET_MS=180000`, `AI_MAX_ATTEMPTS_PER_PROVIDER=2`, `DATABASE_POOL_MAX=5`, and the optional database TLS CA/verification settings. They stay out of the Blueprint; validation and defaults are listed in [Optional backend settings](DEPLOYMENT-GUIDE.md#optional-backend-settings).

### After deploying

- [ ] Confirm `GET /health` is HTTP 200 with `{ status: "ok", timestamp, uptime }`. This is liveness only; it checks no database or provider.
- [ ] Open and refresh `/dashboard?session=<id>` for an owned analysis: the static host serves the app, and after sign-in it opens the requested result.
- [ ] Use the real hashed JavaScript asset path from the deployed HTML and confirm `Cache-Control: public, max-age=31536000, immutable`.
- [ ] Confirm both `/index.html` and `/` return `Cache-Control: no-cache`.
- [ ] After merging and syncing the Blueprint, check the static responses with `curl -sI`: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()` are present. Replace the asset placeholder below with an existing hashed asset:

```bash
curl -sI "https://inframind-backend-bsl1.onrender.com/health"
curl -sI "https://inframind-frontend.onrender.com/"
curl -sI "https://inframind-frontend.onrender.com/index.html"
curl -sI "https://inframind-frontend.onrender.com/assets/<hash>.js"
```

- [ ] With the browser console open, sign in, Connect GitHub, run an analysis, and open Saved Files. Confirm there are no CSP errors; a policy header check alone does not exercise these flows.

Render serves existing files before rewrites and uses the first matching redirect/rewrite rule. The SPA fallback also returns `index.html` with HTTP 200 for a missing asset path; it does not provide a separate missing-asset 404. See [Render rule matching and ordering](https://render.com/docs/redirects-rewrites#rule-matching-and-ordering). The CSP is generated from `client/scripts/csp.mjs` for the real API and Supabase hosts; update it through that generator when either changes.

## Supabase

- [ ] Live `public.saved_files` table and policies compared with `supabase/migrations/20261104000000_saved_files.sql`, then the migration applied (SQL Editor or `supabase db push`); a policy with another name is not replaced by it
- [ ] `supabase/migrations/20261103000000_github_connections.sql` applied
- [ ] Before applying the saved-file limits migration, run the read-only query below in the Supabase SQL Editor and record `duplicate_rows_to_remove`. It counts only later copies of the same user's file, matching the migration's delete.
- [ ] Apply `supabase/migrations/20261106000000_saved_files_limits.sql` after `20261104000000_saved_files.sql` (PostgreSQL 15 or later). It removes the counted copies, keeps the earliest `(created_at, id)`, and adds limits and de-duplication with a trigger-computed UTF8 SHA-256 digest; existing rows that violate a new shape check remain stored.
- [ ] On the real Supabase project, save a completed result twice and confirm that only one set remains, verify that user B cannot see or delete user A's saved files, and verify Load more beyond 50 files (T-408).
- [ ] Site URL and Redirect URLs include the production frontend URL
- [ ] Google and GitHub sign-in providers configured, if you offer them
- [ ] Confirm-email setting decided, custom SMTP configured


Run this before the limits migration; it reads rows without changing them:

```sql
select coalesce(sum(copies - 1), 0)::bigint as duplicate_rows_to_remove
from (
  select count(*) as copies
  from public.saved_files
  group by user_id, name, repo_url,
    encode(sha256(convert_to(content, 'UTF8')), 'hex')
  having count(*) > 1
) as duplicate_groups;
```

## GitHub

- [ ] The repository-access OAuth App's callback URL equals `GITHUB_REDIRECT_URI`
- [ ] The GitHub sign-in OAuth App (Supabase provider) is a separate app with the Supabase callback URL

## AI providers

- [ ] `RUN_LIVE_AI=1 npm run ai:smoke` passes for the configured providers (`server/scripts/ai-smoke.js`)
- [ ] You accept that up to 300 repository file paths, the detected tech stack, the contents of the top-level manifests (such as `requirements.txt`, `pyproject.toml`, `package.json`; up to 32 KB) and excerpts of up to two existing Dockerfiles (at any depth) and the workflows are sent to these providers, including for private repositories ([README-AI-AGENTS.md](README-AI-AGENTS.md#what-reaches-the-ai-providers))
- [ ] You know that credentials found in manifests and in the existing Dockerfile and workflow excerpts are redacted on a best-effort basis before they reach a prompt: URL user names and passwords, tokens shaped like known secrets, the values of keys containing TOKEN, SECRET, PASSWORD, PASSWD, API_KEY or PRIVATE_KEY (also in quoted headers and Dockerfile `ENV`/`ARG KEY value`), `Authorization:` and `Proxy-Authorization:` credentials, Slack and Discord webhook paths, `curl -u`/`--oauth2-bearer` values and `docker login -p`/`--password` values (also in a command continued over several lines with `\`) become `REDACTED` (`redactCredentials` in `server/agents/grounding.js`); keep secrets out of manifests.
- [ ] OpenRouter: `OPENROUTER_DATA_COLLECTION` left at `deny` unless you decide otherwise

## Checks after deploying

- [ ] `GET /health` returns 200 with `{ status: "ok", timestamp, uptime }` (liveness only: it checks no database or provider)
- [ ] Sign up and sign in work with each enabled provider
- [ ] Connect GitHub completes on `/auth/success`, and the header then shows `@<your GitHub login>` (the repository connection), not the account you signed in with
- [ ] Disconnect GitHub (account menu) with a real connection: after confirming, the header shows Connect GitHub, Browse Repositories asks to connect again, and the OAuth App's authorization is gone on GitHub (Settings → Applications)
- [ ] A phone-width pass on a real device: the dashboard tabs, a completed result, Repositories and Saved Files fit the screen with no sideways scrolling, and the account menu shows the GitHub status
- [ ] Cancel a Google sign-in on Google's consent screen: the app lands on `/auth` with "Sign-in was cancelled or not allowed by the provider." and no error text from the provider in the address bar or on the page
- [ ] Signed out, open a `/dashboard?session=<id>` link of your own analysis, then sign in with email: the app opens that analysis, not the plain dashboard
- [ ] Signed in, open `/auth` (and `/sign-in`, `/login`): the app goes straight to the dashboard without showing the sign-in form
- [ ] A repository picked on `/select-repo` (Browse Repositories) clones and analyzes, including a private one
- [ ] A completed run shows one tab per generated file (Dockerfile, `ci.yml`, `.env.example`) with its contents as plain text and its line count; long lines scroll inside the code block, never the page, also at phone width
- [ ] Copy puts the file's exact text on the clipboard; with clipboard access blocked, "Copy failed" asks to select the text and copy it manually
- [ ] Each Download button saves its file with the stored content: in Chrome as `Dockerfile`, `ci.yml` and `env.example` (Chrome drops the leading dot of `.env.example`, and the viewer tells the user to rename it), with no `.txt` appended. Safari and Firefox are owner checks (T-607)
- [ ] "Save to Account" saves the files once (the button then reads "Saved") and they are listed in the Saved Files tab
- [ ] Each downloaded file starts with the file itself (no prose before it), and a completed run shows the verifier's text under "Review"
- [ ] `/dashboard?session=<id>` (where `/select-repo` lands as soon as an analysis has started, and the "View" button in Results from This Visit) shows the run live and then a completed session's files; an unknown id shows "This analysis was not found or has expired"
- [ ] During a run the three step cards move one by one (Running, then Done); with the browser offline for a few seconds mid-run, the run still completes on screen within about 5 s of coming back (status polling)
- [ ] A second account can see neither the first account's sessions (404 on `/api/status/:sessionId`) nor its saved files
- [ ] Cross-tab user switch: with an analysis open in tab 1 (`/dashboard?session=<id>`), sign in as a different account in tab 2. Without a reload, tab 1 shows the second account (its name in the header), says the analysis was not found, and none of the first account's files are on screen
- [ ] After a backend restart, a completed session's files are still returned by `GET /api/files/:sessionId` (`SESSION_STORE=database`)
- [ ] `server/logs/` and the `ai_call` lines contain no tokens or prompt text ([server/OBSERVABILITY.md](server/OBSERVABILITY.md))

## Known limitations in the current code

Each item is a fact about the code today, for deciding what to fix before launch:

- The **Projects** list exists only for the current page visit; it is not a persisted project history (`client/src/pages/ModernDashboard.tsx:94`, `client/src/pages/ModernDashboard.tsx:279`). This does not erase session results kept by the database store.
- Analyses use an in-process queue, so run one backend instance. Shutdown drops queued work and waits at most one second for running jobs; database mode marks sessions still unfinished at restart failed on the next start. There is no per-analysis cancellation operation (`server/utils/jobs.js:19`, `server/utils/jobs.js:83`; `server/server.js:1169`, `server/server.js:1327`).
- Progress text describes the agent that just finished, for example "Analyzing codebase structure" while the generator runs: reports are emitted after each agent (`server/agents/index.js:362`; `server/server.js:948`).
- Chrome was observed to save `.env.example` as `env.example`; the viewer shows the rename instruction. Check download behavior on the target browser/version (`client/src/components/GeneratedFilesView.tsx:11`, `client/src/components/GeneratedFilesView.tsx:16`).
- The **Saved** button state is page-local and resets on reload/new tab. Saving again uses conflict-ignore inserts and the database unique key, so exact copies are not inserted again; different content is a distinct saved file (`client/src/lib/resultCache.ts:14`, `client/src/lib/resultCache.ts:26`; `client/src/lib/api.ts:47`; `supabase/migrations/20261106000000_saved_files_limits.sql:74`).
- Rate-limit counters are in memory per process; another instance counts separately and a restart resets the counters (`server/utils/security.js:121`, `server/utils/security.js:148`).
- `TRUST_PROXY` defaults to 0 and is absent from `render.yaml`. Per-IP limits can therefore count proxy addresses until the owner completes [the client-IP check](#optional-backend-overrides-and-client-ip-check); the actual dashboard override must be checked by the owner (`server/utils/config.js:36`; `server/utils/security.js:129`).
- Generated-file validation checks format, secret-shaped values and workflow policy; it does not build the image, execute the workflow or prove the `.env.example` variables are complete (`server/agents/files.js:35`, `server/agents/files.js:161`, `server/agents/files.js:267`).
- Generated workflows use `main` with a change-it comment because the repository's default branch is not known (`server/agents/prompts.js:30`).
- Java `spring` detection still matches a file-path substring; Python frameworks use dependency names, with `manage.py` also indicating Django (`server/agents/index.js:281`, `server/agents/index.js:292`).
- The verifier's AI review is displayed as advice, not an independently executed correctness check (`server/agents/index.js:170`; `client/src/components/AgentProgress.tsx:669`).
- A clone remains on disk while `cloned` or `analyzing`, and is removed when the pipeline ends. A never-analyzed clone becomes eligible for failure after one hour; cleanup runs at startup and hourly, so one hour is not a strict maximum, and store outages can delay cleanup (`server/server.js:961`, `server/server.js:1116`, `server/server.js:1330`, `server/server.js:1342`; `server/utils/tempCleanup.js:26`).
