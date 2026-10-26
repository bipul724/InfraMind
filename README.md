# InfraMind - AI-Powered DevOps Automation Platform

InfraMind is a comprehensive AI-powered platform that automates DevOps workflows by analyzing GitHub repositories and generating production-ready CI/CD configurations. The platform uses a multi-agent system to intelligently analyze codebases, detect tech stacks, and create deployment-ready files.

## 🚀 Features

- **Multi-Agent AI System**: Four specialized agents run in sequence, each handling one stage of the analysis
- **GitHub Integration**: Connect your GitHub account and analyze any repository
- **Tech Stack Detection**: Automatically detects programming languages and frameworks
- **CI/CD Generation**: Creates Dockerfiles, GitHub Actions workflows, and environment files
- **Real-time Progress**: Live updates during analysis with WebSocket integration
- **Secure Authentication**: Powered by Supabase Auth with email/password, Google and GitHub sign-in
- **Modern UI**: Beautiful, responsive interface built with React and Tailwind CSS

## 🏗️ Architecture

### Authentication & Database
- **Supabase Auth**: Handles user sign-up and login (email/password, Google OAuth, GitHub OAuth). Sessions are managed in the browser by `@supabase/supabase-js`
- **Supabase PostgreSQL**: The `public.saved_files` table stores generated files that users choose to save. Row Level Security (RLS) policies restrict each user to their own rows
- **Browser-only access**: The React app talks to Supabase directly with the publishable (anon) key. The Express server does not connect to Supabase
- **GitHub OAuth for repositories**: A separate GitHub OAuth App, handled by the Express server, grants repository access. It is not used for signing in

> **Migration note:** InfraMind originally used Appwrite for authentication and storage. It moved to Supabase in October 2026, after the Appwrite project became inaccessible. Old `APPWRITE_*` and `VITE_APPWRITE_*` variables are no longer read anywhere and can be deleted.

### Repository Operations
- **GitHub API**: Used for repository discovery, access, and cloning operations
- **Simple Git**: Handles repository cloning and file operations

### AI & Intelligence
- **Sequential Multi-Agent Pipeline** (`server/agents/index.js`): Four specialized agents run one after another, without LangGraph or any other orchestration library:
  - **Planner Agent**: Analyzes repository structure and creates execution plans
  - **Analyzer Agent**: Detects tech stack and dependencies
  - **Generator Agent**: Creates CI/CD files (Dockerfile, GitHub Actions, .env.example)
  - **Verifier Agent**: Validates and optimizes generated configurations
- **Llama 3 70B**: Powers the AI agents via Novita.ai's OpenAI-compatible API (`LLAMA_API_KEY`)
- **Tavily API**: Provides deployment documentation (legacy generator only; see below)
- **Mem0**: Stores user interaction history (legacy generator only; see below)

Tavily, Mem0 and Keywords AI are used only by the legacy generator in `server/index.js`. It runs only for `POST /api/devpilot` with `useAgents: false`, which the web client never sends.

### Real-time Communication
- **Socket.IO**: Enables real-time progress updates and agent communication
- **WebSocket**: Live streaming of analysis progress to the frontend

## 🛠️ Technology Stack

### Frontend
- React 18 + TypeScript
- Tailwind CSS + shadcn/ui components
- React Router for navigation
- Socket.IO client for real-time updates
- Supabase JS client (`@supabase/supabase-js`) for authentication and saved files

### Backend
- Node.js + Express
- Socket.IO for real-time communication
- GitHub API for repository operations
- Plain async/await pipeline for multi-agent orchestration

### AI & External Services
- **Llama 3 70B** (via Novita.ai) - Core AI model
- **Tavily API** - Real-time search and documentation (legacy generator only)
- **Mem0** - User memory and preferences (legacy generator only)
- **Supabase** - Authentication and PostgreSQL database (accessed from the browser)
- **GitHub API** - Repository operations

## 🔧 Environment Variables

### Frontend (.env)
```bash
# API Configuration: the Express server's URL
# (local: http://localhost:3001; if unset, most callers fall back to http://localhost:10000)
VITE_API_URL=https://your-backend-url.com

# Supabase Configuration (Project Settings → API Keys)
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key
```

Only the publishable (anon) key belongs here, because Vite bundles every `VITE_` variable into the browser code. Never use the secret (`service_role`) key in the frontend; InfraMind doesn't need it anywhere.

`VITE_SERVER_URL` is read only by `client/src/lib/agentApi.ts`, which no page currently imports, so it has no effect today. See [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) ("API URL Variables").

### Backend (.env)
```bash
# Server Configuration
PORT=3001
NODE_ENV=production
CLIENT_URL=https://your-frontend-url.com

# No Supabase variables: the server does not access Supabase

# GitHub Configuration (for repository operations)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=https://your-backend-url.com/auth/github/callback
JWT_SECRET=your-jwt-secret-for-github-sessions

# AI & External Services
LLAMA_API_KEY=your-novita-ai-api-key            # required
TAVILY_API_KEY=your-tavily-api-key              # optional: legacy generator only
MEM0_API_KEY=your-mem0-api-key                  # optional: legacy generator only
KEYWORDS_AI_API_KEY=your-keywords-ai-api-key    # optional: legacy generator only
```

## 🔐 Authentication Flow

1. **User Authentication**: Handled entirely by Supabase Auth, in the browser
   - Email/password sign-up and login. If **Confirm email** is enabled, new users must confirm by email before signing in
   - Google and GitHub OAuth: the app redirects to the provider, the provider returns to Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`), and Supabase sends the user back to `<app origin>/dashboard`
   - Sessions are stored and refreshed by the Supabase JS client. The name, avatar and GitHub username are read from the Supabase user profile

2. **GitHub Repository Access**: Separate from authentication
   - Uses GitHub API with personal access tokens
   - Required for repository discovery and cloning
   - Enables access to private repositories

## 📋 Setup Instructions

### 1. Supabase Setup
1. Create a project at [supabase.com](https://supabase.com/dashboard)
2. From **Project Settings → API Keys**, copy the Project URL and the publishable (anon) key into `client/.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. In the **SQL Editor**, create the `saved_files` table and its RLS policies using the SQL in [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) (section "Supabase Configuration → Database Setup")
4. Under **Authentication → URL Configuration**, set the Site URL to `http://localhost:5173` and add `http://localhost:5173/**` to Redirect URLs. Add your production URL when you deploy
5. Under **Authentication → Sign In / Providers**, enable Google and GitHub. Both providers use the callback URL `https://<project-ref>.supabase.co/auth/v1/callback`. Step-by-step instructions are in [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md)

### 2. GitHub OAuth App (for repository access)
This is separate from the GitHub sign-in provider configured in Supabase, and needs its own OAuth App.
1. Go to GitHub Developer Settings
2. Create a new OAuth App with:
   - Homepage URL: `https://your-frontend-url.com`
   - Authorization callback URL: `https://your-backend-url.com/auth/github/callback`
3. Get Client ID and Client Secret

### 3. External API Keys
- **Novita.ai**: For Llama 3 70B model access
- **Tavily**: For real-time search and documentation
- **Mem0**: For user memory and preferences
- **Keywords AI**: For observability (optional)

### 4. Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/inframind.git
cd inframind

# Install backend dependencies
cd server
npm install

# Install frontend dependencies
cd ../client
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Start the development servers
# Backend
cd server
npm run dev

# Frontend (in another terminal)
cd client
npm run dev
```

## 🚀 Deployment

### Frontend (Vercel)
```bash
# Deploy to Vercel
npm run build
vercel --prod
```

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_URL` in the hosting dashboard before building. Vite inlines them at build time, so redeploy after changing any of them. Add the production URL to Supabase's Redirect URLs and set it as the Site URL.

### Backend (Render)
```bash
# Deploy to Render
# Connect your GitHub repository to Render
# Set environment variables in Render dashboard
```

> ⚠️ `render.yaml` currently starts the backend with `cd server && node test-render.js`. That is a smoke-test stub, not the API server. See [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) before relying on a Render deployment.

## 🤖 Multi-Agent System

The platform uses a multi-agent pipeline (`createAgentWorkflow` in `server/agents/index.js`) that awaits each agent in turn:

### Agent Workflow
1. **Planner Agent**: Analyzes repository structure and creates execution plan
2. **Analyzer Agent**: Detects tech stack, dependencies, and patterns
3. **Generator Agent**: Creates optimized CI/CD files
4. **Verifier Agent**: Validates configurations and suggests improvements

### Agent Communication
- Agents share one `AgentState` object, which each agent receives, updates and passes to the next
- Execution is strictly sequential; nothing runs in parallel
- Progress is sent over Socket.IO at milestones: cloning (10%, 25%), analysis start (30%), the pipeline result with all agent messages, and completion (100%). Individual agents don't report progress
- LLM calls retry up to 3 times, with a 1-second delay, on retryable errors

## 📊 Key Integrations

### GitHub Integration
- **Purpose**: Repository discovery, access, and cloning
- **Scope**: `repo`, `user:email`
- **Usage**: After signing in with Supabase, users can connect GitHub for repo access

### Supabase Integration
- **Purpose**: User authentication and saved generated files
- **Features**: Email/password auth, Google and GitHub OAuth, browser-managed sessions
- **Database**: The `public.saved_files` table holds each saved file's name, type, repository URL and content. RLS lets users read, insert and delete only their own rows

### AI Services Integration
- **Llama 3 70B**: Core reasoning and code analysis
- **Tavily**: Real-time documentation and best practices
- **Mem0**: Personalized recommendations based on user history

## 🔍 API Endpoints

### Authentication
The server has no user-authentication endpoints. Sign-up, login and logout go from the browser straight to Supabase Auth. Saved files are also read and written in the browser through the Supabase client, not through the server.

### GitHub Operations
- `GET /auth/github` - Initiate GitHub OAuth for repo access
- `GET /auth/github/callback` - GitHub OAuth callback
- `GET /api/github/repositories` - Get user repositories
- `GET /api/github/organizations/:org/repositories` - Get org repositories

### AI Analysis
- `POST /api/clone-repo` - Clone repository for analysis
- `POST /api/analyze` - Run multi-agent analysis
- `GET /api/status/:sessionId` - Get session status (state, timestamps, error). Analysis results come back in the `POST /api/analyze` response
- `GET /api/files/:sessionId/:filename` - Download generated files

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Review environment variable setup

---

Built with ❤️ using Supabase, GitHub API, Llama 3 70B, and modern web technologies. 