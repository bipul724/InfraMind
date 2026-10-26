# 🤖 AI Agent-Based DevOps Automation System

A true AI agent-based DevOps automation system that uses a sequential multi-agent pipeline (no LangGraph) to analyze codebases and generate production-ready CI/CD configurations.

## 🎯 Features

### ✨ Multi-Agent Architecture
- **🤔 Planner Agent**: Analyzes repository structure and creates comprehensive analysis plan
- **🔍 Analyzer Agent**: Detects tech stack, dependencies, and project patterns
- **⚡ Generator Agent**: Creates optimized Dockerfile, GitHub Actions, and .env files
- **✅ Verifier Agent**: Validates configurations for security and best practices

### 🔄 Real-Time Processing
- **📂 GitHub Repository Cloning**: Supports both public and private repositories
- **📡 WebSocket Communication**: Progress updates at milestones (cloning, analysis start, pipeline result, completion)
- **⏱️ Step-by-Step Progress**: Visual progress tracking, with agent logs delivered when the pipeline finishes
- **🚨 Error Handling**: Comprehensive error reporting and recovery

### 📊 Intelligent Analysis
- **🔬 Tech Stack Detection**: Automatic detection of frameworks, languages, and tools
- **📋 Dependency Analysis**: Analysis of package files and dependencies
- **🏗️ Project Structure**: Deep analysis of codebase organization
- **📈 Best Practices**: Security and performance optimization recommendations

## 🚀 Quick Start

### Prerequisites

1. **Node.js 18+**
2. **Novita.ai API Key** (for Llama 3 70B, set as `LLAMA_API_KEY`)
3. **Git** (for repository cloning)

### 1. Server Setup

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Add your Novita.ai API key to .env
LLAMA_API_KEY=your_novita_ai_api_key_here
PORT=3001
CLIENT_URL=http://localhost:5173

# Start the AI agent server
npm run dev
```

### 2. Client Setup

```bash
# Navigate to client directory
cd client

# Install dependencies
npm install

# Add server URL to environment (also set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY; see README.md)
echo "VITE_API_URL=http://localhost:3001" >> .env.local

# Start the React client
npm run dev
```

### 3. Access the Application

Open your browser and navigate to `http://localhost:5173`

## 🔧 API Endpoints

### Repository Management
- `POST /api/clone-repo` - Clone GitHub repository
- `POST /api/analyze` - Trigger AI agent analysis
- `GET /api/files/:sessionId` - Get generated files
- `GET /api/status/:sessionId` - Get session status
- `GET /api/sessions` - List active sessions

### Enhanced Generation
- `POST /api/devpilot` - Enhanced generation with agents
- `GET /health` - Health check

### WebSocket Events
- `progress` - Real-time progress updates from agents

## 🤖 Agent Workflow

### 1. Repository Cloning (10-30s)
```
📂 Cloning repository from GitHub
├── Validates repository URL
├── Handles authentication (if needed)
└── Downloads to temporary directory
```

### 2. Planning Phase (15-45s)
```
🤔 Planner Agent
├── Analyzes project structure
├── Identifies key files and directories
├── Creates analysis strategy
└── Plans optimization approach
```

### 3. Analysis Phase (30-60s)
```
🔍 Analyzer Agent
├── Detects programming languages
├── Identifies frameworks and libraries
├── Analyzes dependencies
├── Determines deployment patterns
└── Assesses project complexity
```

### 4. Generation Phase (45-90s)
```
⚡ Generator Agent
├── Creates optimized Dockerfile
├── Generates GitHub Actions workflow
├── Produces .env.example template
├── Applies best practices
└── Optimizes for performance
```

### 5. Verification Phase (15-30s)
```
✅ Verifier Agent
├── Validates syntax correctness
├── Checks security practices
├── Reviews performance optimizations
├── Ensures compliance standards
└── Provides improvement recommendations
```

## 📁 Project Structure

```
├── server/
│   ├── agents/
│   │   └── index.js          # Multi-agent system (sequential pipeline)
│   ├── server.js             # Express server with WebSocket
│   ├── index.js              # Legacy function (fallback)
│   ├── package.json          # Server dependencies
│   └── .env.example          # Environment template
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AgentProgress.tsx      # Real-time progress UI
│   │   │   └── AgentGenerationForm.tsx # Enhanced form
│   │   ├── lib/
│   │   │   └── agentApi.ts            # WebSocket API client (not currently imported; reads VITE_SERVER_URL)
│   │   └── pages/
│   │       └── EnhancedDashboard.tsx  # Updated dashboard
│   └── package.json          # Client dependencies
└── README-AI-AGENTS.md       # This documentation
```

## 🔧 Configuration

### Environment Variables

```bash
# Required
LLAMA_API_KEY=your_novita_ai_api_key_here
PORT=3001
CLIENT_URL=http://localhost:5173

# GitHub repository access (repo listing and private repos via GitHub OAuth)
GITHUB_CLIENT_ID=your_github_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_app_client_secret
GITHUB_REDIRECT_URI=http://localhost:3001/auth/github/callback
JWT_SECRET=your_jwt_secret

# Optional (legacy useAgents:false generator only)
MEM0_API_KEY=your_mem0_api_key_here
KEYWORDS_AI_API_KEY=your_keywords_ai_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
```

Private repositories are cloned with the signed-in user's GitHub OAuth token. There is no server-wide `GITHUB_TOKEN` variable.

### Tech Stack Support

The system automatically detects and supports:

- **Frontend**: React, Vue.js, Angular, Next.js, Nuxt.js
- **Backend**: Node.js, Python, Go, Java, .NET, PHP
- **Databases**: PostgreSQL, MySQL, MongoDB, Redis
- **Languages**: JavaScript, TypeScript, Python, Go, Java, C#, PHP, Rust
- **Frameworks**: Express, FastAPI, Django, Spring, Laravel

## 📊 Real-Time Features

### Progress Tracking
Socket.IO `progress` events are sent at these milestones (`server/server.js`):
```
📂 Cloning repository... (10%)
📂 Repository cloned successfully (25%)
🤖 Starting AI agent analysis... (30%)
📋 Pipeline result: all agent messages, tech stack, errors
✅ Analysis complete! (100%)
```
The individual agents do not emit progress; their messages arrive together once the pipeline finishes.

### Agent Logs
- Messages from each agent (delivered with the pipeline result)
- Timestamped activity log
- Error reporting and recovery
- Tech stack detection results

### Generated Outputs
- **Dockerfile**: Multi-stage, optimized, secure
- **GitHub Actions**: Complete CI/CD with testing
- **.env.example**: Environment variable template
- **Verification Report**: Security and best practices

## 🛠️ Advanced Usage

### Custom Agent Configuration

`createAgentWorkflow()` takes no options. To add an agent, write an `async (state) => state` function in `server/agents/index.js` and add it to the sequence in `createAgentWorkflow`'s `invoke`:

```javascript
// server/agents/index.js
state = await plannerAgent(state);
state = await analyzerAgent(state);
state = await generatorAgent(state);
state = await verifierAgent(state);
// state = await yourNewAgent(state);
```

### WebSocket Integration

`AgentAPI` (`client/src/lib/agentApi.ts`) exists but no page imports it today, and it reads `VITE_SERVER_URL` rather than `VITE_API_URL`. The running UI connects through `AgentProgress.tsx` using `VITE_API_URL`.

```javascript
// Frontend WebSocket usage
import { AgentAPI } from '@/lib/agentApi';

const socket = AgentAPI.initializeSocket((progress) => {
  console.log(`Step: ${progress.step}, Progress: ${progress.progress}%`);
});

const result = await AgentAPI.runCompleteWorkflow(repoUrl);
```

## 🔍 Troubleshooting

### Common Issues

1. **LLM API Key Issues**
   ```bash
   Error: Llama API Error: 401 ... (agent calls fail)
   Solution: Add a valid Novita.ai key as LLAMA_API_KEY in server/.env
   ```

2. **Repository Access Issues**
   ```bash
   Error: Repository not accessible
   Solution: For private repos, connect GitHub in the app (GitHub OAuth) and check GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_REDIRECT_URI
   ```

3. **WebSocket Connection Issues**
   ```bash
   Error: Cannot connect to server
   Solution: Ensure the server is running and VITE_API_URL matches its URL and port (3001 locally)
   ```

### Performance Optimization

- **Sequential Processing**: Agents run one at a time, in a fixed order
- **Caching**: Repository analysis results are cached
- **Cleanup**: Automatic cleanup of temporary files
- **Error Recovery**: Graceful handling of agent failures

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-agent`
3. Add your changes
4. Test the agent system: `npm test`
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- **Documentation**: Check this README and inline comments
- **Issues**: Create GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions

---

**Built with ❤️ using Llama 3 70B (Novita.ai), Socket.IO, and modern web technologies** 