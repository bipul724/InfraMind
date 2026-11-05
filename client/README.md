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
- `npm run build`: `tsc -b && vite build`, output in `dist/`. The three TypeScript projects check the app, Vite/Vitest configuration, and both kinds of tests in strict mode; a test type error fails the build
- `npm run lint`: ESLint with `--max-warnings 0`; it must pass with zero problems
- `npm run preview`: serve the production build
- `npm test`: runs the existing `node --test src/lib/*.test.ts` library tests, including parser parity with the server, then the Vitest component suite
- `npm run test:components`: runs only Vitest, using jsdom and Testing Library. Put component specs beside their components as `src/**/*.spec.tsx`; import Vitest helpers explicitly. `src/test/setup.ts` cleans up each rendered tree. `vitest.config.ts` disables environment-file loading and supplies loopback test values

Use Node 22.23.4 or later on the Node 22 line: jsdom requires at least 22.22.2. Both library tests (`src/**/*.test.ts`) and component specs are checked by `tsconfig.test.json`, including the library tests' JavaScript import from the server, and stay out of the production bundle. From the repository root, `npm run e2e` runs the production client against offline services in installed Google Chrome; see the root README.

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

Every file in `src/` is reachable from these routes: the files that were not were removed (listed in [ARCHITECTURE.md](../ARCHITECTURE.md)).
