# InfraMind Production Checklist

A checklist for an operator preparing a deployment. Nothing here is pre-ticked: each item is something to do or check on your own deployment. Setup details are in [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md).

## Configuration the server requires

The server exits at startup without these, listing every problem at once (`startServer` in `server/server.js`, `server/utils/config.js`):

- [ ] `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the same Supabase project as the client
- [ ] `GITHUB_TOKEN_STORE=supabase` (with `memory`, every GitHub connection is lost on restart and the server warns in production)
- [ ] `GITHUB_TOKEN_ENC_KEY`, generated with `openssl rand -base64 32` and stored safely: changing it makes existing connections unreadable
- [ ] `SUPABASE_SERVICE_ROLE_KEY` on the server only, never in a `VITE_` variable
- [ ] `AI_PROVIDERS`, and `<NAME>_API_KEY` plus `<NAME>_MODEL` for every provider in any chain
- [ ] `SESSION_STORE=database` (with `memory`, every session and result is lost on restart and the server warns in production)
- [ ] `DATABASE_URL`, and the migration applied with `npm run db:deploy` (`server/package.json`)
- [ ] `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` of the repository-access OAuth App (the `.env.example` placeholders are refused), and `GITHUB_REDIRECT_URI`: `https://<backend URL>/auth/github/callback`
- [ ] `CLIENT_URL` set to the frontend origin, `https://<frontend host>` with no path: an allowed CORS and Socket.IO origin and the GitHub OAuth redirect target

## Optional configuration (checked at startup when set)

- [ ] `CORS_ALLOWED_ORIGINS` lists every other frontend origin that must call the API; `http://localhost:5173` is not allowed in production (`server/utils/config.js`)
- [ ] `TRUST_PROXY` set to the number of proxies in front of the server, after checking the logged client IP ([DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md#checking-the-client-ip)); with the default 0 behind Render, every visitor shares one IP for the per-IP rate limits
- [ ] The default rate limits suit your traffic, or `RATE_LIMIT_<NAME>_MAX` is set ([README.md](README.md#api))
- [ ] `METRICS_TOKEN` (32+ characters) if you want `/api/metrics` and `/api/analytics`; without it both answer 404, and a shorter value stops the server from starting (`server/utils/config.js`)
- [ ] `GITHUB_TIMEOUT_MS` (default 10000) if GitHub calls need a different timeout (`server/github.js`)
- [ ] Optional limits: `CLONE_TIMEOUT_MS` (default 120000), `MAX_REPO_SIZE_MB` (default 200) (`server/utils/git.js`); `AI_TIMEOUT_MS`, `AI_CALL_BUDGET_MS`, `AI_MAX_ATTEMPTS_PER_PROVIDER` (`server/ai/config.js`); `DATABASE_POOL_MAX` (`server/db/config.js`); `ANALYSIS_CONCURRENCY` (default 2) and `ANALYSIS_QUEUE_MAX` (default 20) (`server/utils/config.js`)

## Client build

- [ ] `VITE_API_URL` set to the backend URL (without it the client uses `http://localhost:10000`, `client/src/lib/api.ts`)
- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set before the build (Vite inlines them)
- [ ] The host serves `index.html` for every path (the Render static service rewrites `/*` to `/index.html`, `render.yaml`)

## Supabase

- [ ] Live `public.saved_files` table and policies compared with `supabase/migrations/20261104000000_saved_files.sql`, then the migration applied (SQL Editor or `supabase db push`); a policy with another name is not replaced by it
- [ ] `supabase/migrations/20261103000000_github_connections.sql` applied
- [ ] Site URL and Redirect URLs include the production frontend URL
- [ ] Google and GitHub sign-in providers configured, if you offer them
- [ ] Confirm-email setting decided, custom SMTP configured

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
- [ ] Connect GitHub completes on `/auth/success` and the dashboard shows the GitHub login
- [ ] A repository picked on `/select-repo` (Browse Repositories) clones and analyzes, including a private one
- [ ] A completed run shows one tab per generated file (Dockerfile, `ci.yml`, `.env.example`) with its contents as plain text and its line count; long lines scroll inside the code block, never the page, also at phone width
- [ ] Copy puts the file's exact text on the clipboard; with clipboard access blocked, "Copy failed" asks to select the text and copy it manually
- [ ] Each Download button saves its file with the stored content: in Chrome as `Dockerfile`, `ci.yml` and `env.example` (Chrome drops the leading dot of `.env.example`, and the viewer tells the user to rename it), with no `.txt` appended. Safari and Firefox are owner checks (T-607)
- [ ] "Save to Account" saves the files once (the button then reads "Saved") and they are listed in the Saved Files tab
- [ ] Each downloaded file starts with the file itself (no prose before it), and a completed run shows the verifier's text under "Review"
- [ ] `/dashboard?session=<id>` (where `/select-repo` lands as soon as an analysis has started, and the "View" button in Results from This Visit) shows the run live and then a completed session's files; an unknown id shows "This analysis was not found or has expired"
- [ ] During a run the three step cards move one by one (Running, then Done); with the browser offline for a few seconds mid-run, the run still completes on screen within about 5 s of coming back (status polling)
- [ ] A second account can see neither the first account's sessions (404 on `/api/status/:sessionId`) nor its saved files
- [ ] After a backend restart, a completed session's files are still returned by `GET /api/files/:sessionId` (`SESSION_STORE=database`)
- [ ] `server/logs/` and the `ai_call` lines contain no tokens or prompt text ([server/OBSERVABILITY.md](server/OBSERVABILITY.md))

## Known limitations in the current code

Each item is a fact about the code today, for deciding what to fix before launch:

- The **Projects** tab lists only results from the current page visit; nothing is stored (`client/src/pages/ModernDashboard.tsx`).
- Analyses run in an in-process job runner (`server/utils/jobs.js`): one backend instance only, since the queue is not shared between processes. A restart or deploy ends every running and queued analysis; with `SESSION_STORE=database` the next start marks them `failed` with the restart message, and the user starts again. Running analyses cannot be cancelled.
- The step after an agent's event is that agent's own step name (for example "Analyzing codebase structure" while the generator runs), because the event is sent when the agent finishes (`runAnalysisJob` in `server/server.js`).
- Chrome saves the `.env.example` download as `env.example`: it removes a leading dot from download names, so the user renames the file (`client/src/components/GeneratedFilesView.tsx` shows this under the file).
- "Save to Account" is remembered for the page load only: after a reload, or when the same analysis is opened in a new tab with `/dashboard?session=<id>`, the button is enabled again and a second save inserts a second set of rows (`client/src/components/AgentProgress.tsx`).
- Switching away from the dashboard's Generate tab during a run unmounts the generation form (inactive tab content is not rendered, `client/src/components/ui/tabs.tsx`), so that run's progress view and its entry in Results from This Visit are lost. The server still finishes the run.
- Rate-limit counters are kept in memory by each server process: a second instance counts separately, and a restart resets every count (`server/utils/security.js`).
- `TRUST_PROXY` defaults to 0 and is not set in `render.yaml`: behind Render's proxy, every visitor shares one bucket for the per-IP limits until it is set (`server/utils/config.js`).
- File validation checks format and the workflow policy only. It does not build the image, run the workflow, or check that the `.env.example` variables are complete (`server/agents/files.js`).
- The generated workflow triggers on `main`, with a comment to change it: the analyzer does not know the repository's default branch (`server/agents/prompts.js`).
- Java `spring` detection still uses a file-path substring; Python frameworks come from the dependency names (`server/agents/index.js` `analyzeTechStack`).
- The verifier's review is AI text shown as advice; nothing checks it (`client/src/components/AgentProgress.tsx`).
- A clone stays on the server's disk while its session is `cloned` (at most 1 hour, then the session fails and the clone is removed) or `analyzing`; it is removed when the analysis ends (`server/server.js`).
