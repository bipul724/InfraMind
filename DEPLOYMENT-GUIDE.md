# 🚀 InfraMind Deployment Guide

Complete deployment guide for the multi-agent AI DevOps automation platform.

## 📋 **Prerequisites**

### Required Services & API Keys

1. **Novita.ai API Key** (Required, set as `LLAMA_API_KEY`)
   - Sign up at [Novita.ai](https://novita.ai)
   - The agents call `meta-llama/llama-3-70b-instruct` through Novita.ai's OpenAI-compatible API (`server/agents/index.js`)

2. **Supabase Project** (Authentication & Database)
   - Create one at [Supabase](https://supabase.com/dashboard)
   - Features used: Supabase Auth (email/password, Google, GitHub) and PostgreSQL (`public.saved_files` with Row Level Security)
   - Accessed from the browser only. The server needs no Supabase credentials

3. **Keywords AI** (Optional - Observability)
   - Sign up at [Keywords AI](https://keywordsai.co)
   - Used for monitoring and analytics

4. **Mem0** (Optional - Memory & Context)
   - Sign up at [Mem0](https://mem0.ai)
   - Stores interaction history

5. **Tavily** (Optional - Enhanced Search)
   - Sign up at [Tavily](https://tavily.com)
   - AI-powered search capabilities

Keywords AI, Mem0 and Tavily are only used by the legacy generator in `server/index.js`. That code runs only for `POST /api/devpilot` with `useAgents: false`, which the web client never sends. The four-agent pipeline doesn't use them.

### System Requirements

- **Node.js 18+**
- **Git**
- **2GB+ RAM** (for agent processing)
- **1GB+ Storage** (for temporary repos)

---

## 🏗️ **Local Development Setup**

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/your-org/inframind.git
cd inframind

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Environment Configuration

Create environment files:

#### **Server Environment** (`server/.env`)
```bash
# Required - AI Core (Novita.ai key for Llama 3 70B)
LLAMA_API_KEY=your-novita-ai-api-key
NODE_ENV=development
PORT=3001

# Required - Frontend URL (used for CORS and GitHub OAuth redirects)
CLIENT_URL=http://localhost:5173

# Required for GitHub repository access (repo listing, private repos)
GITHUB_CLIENT_ID=your-github-oauth-app-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-app-client-secret
GITHUB_REDIRECT_URI=http://localhost:3001/auth/github/callback
JWT_SECRET=your-jwt-secret-for-github-sessions

# Optional - legacy useAgents:false path only
MEM0_API_KEY=your-mem0-api-key
KEYWORDS_AI_API_KEY=your-keywords-ai-api-key
KEYWORDS_AI_BASE_URL=https://api.keywordsai.co
TAVILY_API_KEY=your-tavily-api-key
```

Variables the server does **not** read: `OPENAI_API_KEY`, `NOVITA_API_KEY`, `CORS_ORIGIN`, `GITHUB_TOKEN`, `TEMP_DIR`, `CLEANUP_INTERVAL` and `LOG_LEVEL`.
- Cloned repos always go to `server/temp`, and old sessions are cleaned up every hour.
- Private repos are cloned with the user's GitHub OAuth token, not a server-wide token.

#### **Client Environment** (`client/.env.local`)
```bash
# Express server URL (must match the server's PORT; server.js defaults to 3001)
VITE_API_URL=http://localhost:3001

# Supabase Configuration (Project Settings → API Keys)
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key
```

### 3. Run Development Servers

```bash
# Terminal 1 - Start AI Agent Server
cd server
npm run dev

# Terminal 2 - Start React Client
cd client
npm run dev
```

Access the application at `http://localhost:5173`

### API URL Variables: `VITE_API_URL` vs `VITE_SERVER_URL`

| Variable | Read by | Default | Status |
|----------|---------|---------|--------|
| `VITE_API_URL` | `client/src/lib/api.ts`, `components/AgentGenerationForm.tsx`, `components/AgentProgress.tsx`, `components/RepositorySelector.tsx` | `http://localhost:10000` (`AgentGenerationForm.tsx` has **no** default) | **Used.** Base URL for clone, analyze, file download, repository listing and the Socket.IO progress connection |
| `VITE_SERVER_URL` | `client/src/lib/agentApi.ts` only | `http://localhost:3001` | **Currently unused.** No page or component imports `agentApi.ts` |

- **Always set `VITE_API_URL`** to the Express server's URL. Locally that's `http://localhost:3001`, because `server.js` defaults to port 3001 while the client's fallback is 10000.
- **On Render, the backend runs with `PORT=10000`** (set in `render.yaml`). Set `VITE_API_URL` to the backend's public URL, e.g. `https://your-backend-domain.onrender.com`.
- **`VITE_SERVER_URL` only matters if `agentApi.ts` is wired back in.** If it is, point it at the same server.

---

## 🚀 Quick Production Deployment

### Deployment Issue Resolution

**FIXED**: The deployment issue was caused by a missing Vite plugin dependency.

**Solution Applied**:
- Updated `client/package.json` to use `@vitejs/plugin-react-swc` instead of `@vitejs/plugin-react`
- Updated `render.yaml` to include both frontend and backend services
- Enhanced build process for production deployment

### Platform-Specific Deployment

#### 1. Vercel Deployment (Frontend)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy frontend
cd client
vercel --prod

# Configure environment variables in Vercel dashboard:
# VITE_API_URL=https://your-backend-domain.onrender.com
# VITE_SUPABASE_URL=https://your-project-ref.supabase.co
# VITE_SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key
# (VITE_ variables are inlined at build time: redeploy after changing them)
```

#### 2. Render.com Deployment (Full Stack)

The project includes a `render.yaml` configuration for automatic deployment. Current contents:

```yaml
services:
  # Backend API Service
  - type: web
    name: inframind-backend
    env: node
    buildCommand: cd server && npm install
    startCommand: cd server && node test-render.js
    plan: free
    envVars:
      - key: NODE_VERSION
        value: 18.0.0
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
    healthCheckPath: /health

  # Frontend Static Site
  - type: web
    name: inframind-frontend
    env: static
    buildCommand: cd client && npm install && npm run build
    staticPublishPath: ./client/dist
    plan: free
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    envVars:
      - key: NODE_VERSION
        value: 18.0.0
```

> ⚠️ **The backend start command runs `test-render.js`, not the API server.** `test-render.js` is a deployment smoke test: it answers every request, including `/health`, with `{"message": "Render deployment test successful"}`. None of the API routes, Socket.IO or agents are available. To serve the real API, change `startCommand` to `cd server && npm start` (which runs `node server.js`). That change is left for you to make deliberately.

**Deploy Steps**:
1. Connect your GitHub repository to Render
2. Use the `render.yaml` file for automatic configuration
3. Set the backend's environment variables in the Render dashboard (see Backend Environment Variables below)
4. Set the frontend's `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Render dashboard. `render.yaml` doesn't define them, and Vite needs them at build time

## 🔧 Environment Configuration

### Frontend Environment Variables (.env.local)

```bash
# Client Environment Variables
VITE_API_URL=https://your-backend-domain.onrender.com
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key
```

Use only the publishable (anon) key in the frontend. Never put the secret (`service_role`) key in any `VITE_` variable: it bypasses Row Level Security, and Vite would publish it in the browser bundle.

### Backend Environment Variables (.env)

```bash
# Server Configuration
PORT=10000                 # render.yaml sets 10000 on Render; server.js defaults to 3001
NODE_ENV=production
CLIENT_URL=https://your-frontend-domain.vercel.app   # allowed CORS origin + GitHub OAuth redirect target

# No Supabase variables: the server does not access Supabase

# GitHub OAuth Configuration (repository access)
GITHUB_CLIENT_ID=your-github-oauth-app-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-app-client-secret
GITHUB_REDIRECT_URI=https://your-backend-domain.onrender.com/auth/github/callback
JWT_SECRET=your-jwt-secret-for-github-sessions

# AI Service Configuration
LLAMA_API_KEY=your-novita-ai-api-key          # required: Llama 3 70B via Novita.ai
TAVILY_API_KEY=your-tavily-api-key            # optional: legacy useAgents:false path only
MEM0_API_KEY=your-mem0-api-key                # optional: legacy useAgents:false path only
KEYWORDS_AI_API_KEY=your-keywords-ai-api-key  # optional: legacy useAgents:false path only
```

## 🔒 Supabase Configuration

InfraMind uses Supabase for two things:
- **Supabase Auth**: email/password, Google and GitHub sign-in
- **One PostgreSQL table**: `public.saved_files`, for generated files that users choose to save

The React app talks to Supabase directly using the publishable (anon) key and the signed-in user's session. Row Level Security keeps each user's rows private. The Express server does not connect to Supabase.

> InfraMind used Appwrite for these features until October 2026. The Appwrite collections, API key scopes and callback URLs from older versions of this guide no longer apply.

### 1. Create the Supabase Project

1. Go to the [Supabase dashboard](https://supabase.com/dashboard) and create a new project
2. Open **Project Settings → API Keys** and copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **Publishable (anon) key** → `VITE_SUPABASE_ANON_KEY`
3. Do not copy the secret / `service_role` key into either app. Nothing in InfraMind uses it

### 2. Database Setup

Run this in the **SQL Editor**:

```sql
create table public.saved_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  repo_url text,
  content text not null,
  created_at timestamptz not null default now()
);

create index saved_files_user_created_idx on public.saved_files (user_id, created_at desc);

alter table public.saved_files enable row level security;

create policy "Users read own files"   on public.saved_files for select using (auth.uid() = user_id);
create policy "Users insert own files" on public.saved_files for insert with check (auth.uid() = user_id);
create policy "Users delete own files" on public.saved_files for delete using (auth.uid() = user_id);
```

What these policies do:
- A signed-in user can read, insert and delete only rows whose `user_id` matches their own `auth.uid()`
- There is no `update` policy, so saved files can't be edited (the app never edits them)
- Requests without a session (anon key only) get an empty result

### 3. URL Configuration (Redirects)

After an OAuth sign-in, the app asks Supabase to send the user back to `<current origin>/dashboard` (see `client/src/lib/supabase.ts`). Supabase only redirects to URLs on its allow list. For any other URL it falls back to the Site URL.

In **Authentication → URL Configuration**:

| Setting | Local development | Production |
|---------|-------------------|------------|
| Site URL | `http://localhost:5173` | `https://your-frontend-domain.vercel.app` |
| Redirect URLs | `http://localhost:5173/**` | `https://your-frontend-domain.vercel.app/**` |

- Site URL holds a single value. Switch it to the production URL when you deploy
- Redirect URLs can hold several. Keep the localhost entry if you also develop against this project, and add any preview-deployment domains you use

### 4. Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**, create an **OAuth client ID** of type **Web application** (set up the OAuth consent screen first if prompted)
2. Under **Authorized redirect URIs**, add `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase shows this exact URL on its Google provider page
3. In Supabase → **Authentication → Sign In / Providers → Google**, enable the provider and paste the Client ID and Client Secret

The callback URL points at Supabase, not at your frontend, so it's the same for local development and production.

### 5. GitHub OAuth (User Sign-In)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: your frontend URL
   - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
2. In Supabase → **Authentication → Sign In / Providers → GitHub**, enable the provider and paste the Client ID and Client Secret

This is a different OAuth App from the repository-access app described below, whose callback goes to the Express server.

### 6. Email/Password

The Email provider is enabled by default. With **Confirm email** on (the default), new users must click the confirmation link before they can sign in. In that case the app shows "Check your email to confirm your account, then sign in." You can turn confirmation off for local testing. Supabase's built-in email sender is rate-limited, so configure custom SMTP under **Authentication → Emails** before production.

## 🔑 GitHub OAuth App Setup

### 1. Create GitHub OAuth App

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Click "New OAuth App"

**Application Details**:
- Application name: `InfraMind`
- Homepage URL: `https://your-frontend-domain.vercel.app`
- Authorization callback URL: `https://your-backend-domain.onrender.com/auth/github/callback`

### 2. Configure for Production

**Dual OAuth System**:
1. **Supabase GitHub OAuth**: For user authentication (callback `https://<project-ref>.supabase.co/auth/v1/callback`)
2. **Direct GitHub OAuth**: For repository access (callback `https://your-backend-domain.onrender.com/auth/github/callback`)

Both need separate OAuth apps in GitHub.

## 🤖 AI Services Setup

### 1. Novita.ai (Llama 3 70B)
```bash
# Get API key from https://novita.ai
LLAMA_API_KEY=your-novita-api-key
```

### 2. Tavily (Search & Analysis)
```bash
# Get API key from https://tavily.com
TAVILY_API_KEY=your-tavily-api-key
```

### 3. Mem0 (AI Memory)
```bash
# Get API key from https://mem0.ai
MEM0_API_KEY=your-mem0-api-key
```

### 4. Keywords AI (Observability)
```bash
# Get API key from https://keywordsai.co
KEYWORDS_AI_API_KEY=your-keywords-ai-api-key
```

## 🚀 Production Checklist

### Pre-Deployment

- [ ] **Dependencies Fixed**: Updated to `@vitejs/plugin-react-swc`
- [ ] **Build Process**: Verified `npm run build` works locally
- [ ] **Environment Variables**: All required variables configured
- [ ] **Supabase Project**: Created and configured
- [ ] **GitHub OAuth**: Both apps created and configured
- [ ] **AI Service Keys**: All API keys obtained and tested

### Supabase Configuration

- [ ] **Project Created**: Project URL and publishable (anon) key set in the frontend environment
- [ ] **Database Schema**: `public.saved_files` table, index and RLS policies created
- [ ] **URL Configuration**: Site URL set to the production frontend; production (and any local/preview) URLs in Redirect URLs
- [ ] **OAuth Providers**: Google and GitHub enabled, each with callback `https://<project-ref>.supabase.co/auth/v1/callback`
- [ ] **Email**: Confirm-email setting decided; custom SMTP configured
- [ ] **No secret key exposed**: `service_role` key not present in any frontend variable

### GitHub OAuth Setup

- [ ] **User Auth OAuth**: Supabase GitHub provider configured
- [ ] **Repository Access OAuth**: Direct GitHub OAuth for repo operations
- [ ] **Callback URLs**: Proper callback URLs for both environments
- [ ] **Client Secrets**: Securely stored in environment variables

### AI Services Integration

- [ ] **Novita.ai**: `LLAMA_API_KEY` configured for Llama 3 70B access
- [ ] **Tavily** (optional, legacy path): Search API configured
- [ ] **Mem0** (optional, legacy path): Memory service configured
- [ ] **Keywords AI** (optional, legacy path): Observability configured

### Deployment Testing

- [ ] **Frontend Build**: Vercel deployment successful
- [ ] **Backend API**: Render runs `server.js` (not `test-render.js`) and `/health` returns the real health status
- [ ] **Authentication Flow**: OAuth login/signup working
- [ ] **GitHub Integration**: Repository selection and access working
- [ ] **AI Agent Pipeline**: Multi-agent workflow functional
- [ ] **Real-time Updates**: WebSocket connections working
- [ ] **File Downloads**: Generated files downloadable
- [ ] **Saved Files**: Saving a file and seeing it in Saved Files works. A second user can't see it

## 🔍 Troubleshooting

### Common Issues

1. **Build Failures**
   - Ensure `@vitejs/plugin-react-swc` is installed
   - Check for TypeScript errors
   - Verify all environment variables are set

2. **Authentication Issues**
   - Check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and rebuild the frontend after changing them
   - Verify the provider's callback URL is `https://<project-ref>.supabase.co/auth/v1/callback`
   - OAuth returns to the Site URL instead of `/dashboard`: add the app's origin (`https://your-domain/**`) to Redirect URLs
   - Email sign-in fails right after sign-up: the user hasn't confirmed their email yet

3. **Saved Files Issues**
   - Insert errors mentioning row-level security: the user has no active session, or the inserted `user_id` isn't theirs
   - Empty list: check that the `saved_files` table and its `select` policy exist

4. **GitHub Integration Issues**
   - Verify both GitHub OAuth apps are configured
   - Check redirect URIs match exactly
   - Ensure GitHub permissions are granted

5. **AI Service Issues**
   - Verify all API keys are valid
   - Check rate limits and quotas
   - Monitor error logs for specific failures

### Performance Optimization

1. **Frontend**
   - Enable gzip compression
   - Optimize bundle size with code splitting
   - Use CDN for static assets

2. **Backend**
   - Enable API response caching
   - Implement connection pooling
   - Monitor memory usage

3. **AI Services**
   - Implement request queuing
   - Add retry logic with exponential backoff
   - Cache frequent AI responses

## 📊 Monitoring & Analytics

### Production Monitoring

1. **Keywords AI Dashboard**: Monitor AI service usage and performance
2. **Supabase Dashboard**: Track sign-ups under Authentication → Users, and auth/database requests in Logs
3. **Render Logs**: Monitor backend performance and errors
4. **Vercel Analytics**: Track frontend performance and user engagement

### Key Metrics to Track

- User registration and authentication success rates
- GitHub repository connection success rates
- AI agent pipeline completion rates
- File generation and download success rates
- Response times for critical API endpoints
- Error rates across all services

## 🔒 Security Considerations

### Production Security

1. **Environment Variables**: Never commit sensitive keys to version control
2. **HTTPS Everywhere**: Ensure all services use HTTPS in production
3. **API Rate Limiting**: Implement rate limiting on all public endpoints
4. **Input Validation**: Validate all user inputs and API requests
5. **Secret Rotation**: Regularly rotate API keys and OAuth secrets

### Compliance

- **Data Privacy**: Ensure GDPR compliance for user data
- **API Security**: Follow OAuth 2.0 security best practices  
- **Audit Logging**: Log all security-relevant events
- **Access Control**: Implement proper user authorization

---

## 🎯 Ready for Production!

With these configurations, InfraMind is ready for production deployment with:

✅ **Multi-Agent AI System**: Four specialized agents working in harmony
✅ **Authentication**: Supabase Auth with email/password, Google and GitHub OAuth, plus RLS-protected saved files
✅ **GitHub Integration**: Seamless repository access and operations  
✅ **Real-time Updates**: WebSocket-powered progress tracking
✅ **Scalable Infrastructure**: Cloud-native deployment architecture
✅ **Comprehensive Monitoring**: Full observability across all services

**Next Steps**: Follow the deployment checklist above and deploy to your preferred platform! 