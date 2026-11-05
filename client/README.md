# InfraMind Client

React 18 + TypeScript app built with Vite and Tailwind CSS (`package.json`).

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure the environment:
   ```bash
   cp .env.example .env.local
   ```
   The app reads three variables:

   | Variable | Read in | Without it |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `src/lib/supabase.ts` | Sign-in cannot work; an error is logged |
   | `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` | Same |
   | `VITE_API_URL` | `src/lib/api.ts` | `http://localhost:10000` |

   Vite inlines `VITE_*` variables at build time: restart the dev server or rebuild after changing them, and never put a secret key in one.

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173) (`vite.config.ts`). The dev server listens on localhost only; run `npm run dev -- --host` when you deliberately want it reachable from your local network.

## Scripts

- `npm run dev`: start the Vite development server
- `npm run build`: `tsc && vite build`, output in `dist/`
- `npm run lint`: ESLint with `--max-warnings 0`
- `npm run preview`: serve the production build
- `npm test`: `node --test src/lib/*.test.ts` (Node 22.18 or later, which runs TypeScript directly): the GitHub URL parser's parity with the server's (`src/lib/githubUrl.test.ts`) and the API error messages (`src/lib/apiError.test.ts`). These files are excluded from the app type-check (`tsconfig.app.json`) and are not in the bundle

## Routes

From `src/App.tsx`:

| Path | Page | Access |
|---|---|---|
| `/` | `Landing` | public |
| `/demo` | `Demo` (scripted sample, no server calls) | public |
| `/auth`, `/sign-in/*`, `/sign-up/*` | `Auth`; a signed-in visitor goes on to `?returnTo=` or `/dashboard` | public |
| `/auth/success` | `AuthSuccess` (finishes a GitHub connection) | public |
| `/dashboard` | `ModernDashboard`; `?session=<id>` opens one analysis | signed in |
| `/select-repo` | `RepoSelection` | signed in |
| `/auth/github/callback` | `GitHubCallback` (forwards to the server) | public |
| `/login` | redirect to `/auth`, keeping the query string | public |
| `/profile` | redirect to `/dashboard` (an alias for old bookmarks; nothing links to it) | signed in |

Signed-in page components:

- `components/layouts/DashboardLayout.tsx`: the one header of the signed-in pages. Its GitHub status is the repository connection from `contexts/GitHubContext.tsx` (Connect GitHub, or `@login`); the account menu shows how the user signed in, Connect or Disconnect GitHub, and Sign out
- `pages/ModernDashboard.tsx`: the Generate, Projects and Saved Files tabs, and `?session=<id>`
- `components/AgentGenerationForm.tsx`, `components/AgentProgress.tsx`, `components/GeneratedFilesView.tsx`: a run, its progress and its files
- `components/dashboard/SavedFiles.tsx`: files saved to the account
- `pages/RepoSelection.tsx` and `components/RepositorySelector.tsx`: Browse Repositories and Manual URL
- `components/ErrorBoundary.tsx`: the error screen around every page

Files not reachable from these routes: `src/pages/EnhancedDashboard.tsx`, `src/integrations/core.ts`, `src/hooks/use-mobile.tsx`, and the components `ChatPanel`, `OutputDisplay`, `RepositoryInput`, `SystemMonitoringDashboard` and `dashboard/GenerationForm`, `ProjectCard`, `ProjectsGrid`, `StatsOverview`.
