import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Code2, 
  Shield, 
  GitBranch, 
  Container, 
  Github, 
  ArrowRight, 
  Play,
  CheckCircle,
  Menu,
  X,
  Brain,
  Database,
  Search,
  Cloud,
  Bot,
  Monitor,
  Lock,
  Workflow,
  Layers,
  RefreshCw,
  Cpu,
  Network,
  Settings,
  Terminal
} from 'lucide-react';
import { useState, useEffect } from 'react';

export const Landing = () => {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentAgentIndex, setCurrentAgentIndex] = useState(0);
  
  const agents = [
    {
      name: "Analyzer Agent",
      description: "Scans files and manifests, detects the tech stack",
      icon: <Search className="h-5 w-5" />
    },
    { name: "Generator Agent", description: "Writes the three DevOps files and checks each one", icon: <Settings className="h-5 w-5" /> },
    { name: "Verifier Agent", description: "Asks the AI to review the files", icon: <CheckCircle className="h-5 w-5" /> }
  ];

  // Cycle through agents every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentAgentIndex((prev) => (prev + 1) % agents.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [agents.length]);
  
  const features = [
    {
      icon: <Bot className="h-6 w-6" />,
      title: "Three Agents in Sequence",
      description: "Analyzer, generator and verifier run one after another on a shared state. The generator and verifier call the AI layer; the analyzer works on the cloned files.",
      tech: "Sequential pipeline · 3 to 7 AI calls per run",
      highlight: "AGENTS"
    },
    {
      icon: <Search className="h-6 w-6" />,
      title: "Repository Scan",
      description: "The analyzer lists the repository's files and reads its top-level manifests, such as requirements.txt, pyproject.toml and package.json, to find the language, frameworks, entry points, tests and linters. It never reads .env files. This step makes no AI call.",
      tech: "File list + top-level manifests",
      highlight: "ANALYSIS"
    },
    {
      icon: <Brain className="h-6 w-6" />,
      title: "Configurable AI Providers",
      description: "The operator picks the providers for each task. A failed call is retried, then passed to the next provider in that task's chain.",
      tech: "gemini · groq · openrouter · novita",
      highlight: "PROVIDERS"
    },
    {
      icon: <Lock className="h-6 w-6" />,
      title: "GitHub Connection",
      description: "Connect GitHub to list your repositories and analyze private ones you can access. The token stays on the server, encrypted, and disconnecting revokes it.",
      tech: "GitHub OAuth · AES-256-GCM",
      highlight: "PRIVATE REPOS"
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: "Supabase Sign-in",
      description: "Sign in with email, GitHub or Google through Supabase Auth. The server checks your access token on account API routes and live-progress connections.",
      tech: "Supabase Auth",
      highlight: "AUTH"
    },
    {
      icon: <Workflow className="h-6 w-6" />,
      title: "Three Generated Files",
      description: "A Dockerfile, a read-only CI workflow and a .env.example, generated from the repository's manifests, entry points and file list. Each file is format-checked before it is saved; one that fails twice is left out. Download them or save them to your account.",
      tech: "AI-generated, format-checked",
      highlight: "OUTPUT"
    }
  ];

  const techStack = [
    {
      name: "AI provider layer",
      description: "OpenAI-format chat completions, chosen per task by configuration",
      category: "AI",
      features: ["Gemini, Groq, OpenRouter, Novita", "Per-task fallback chains", "Retries and time budget"],
      provider: "InfraMind server"
    },
    {
      name: "Agent Pipeline",
      description: "Three agents run in a fixed order on one shared state",
      category: "Agent System",
      features: ["Analyzer", "Generator", "Verifier"],
      provider: "InfraMind server"
    },
    {
      name: "Express + Socket.IO",
      description: "API server with authenticated live-progress rooms",
      category: "Backend",
      features: ["Supabase token check on API routes", "Rate-limited clone and analyze", "Progress per session"],
      provider: "Node.js"
    },
    {
      name: "GitHub",
      description: "Repository access through a separate OAuth App",
      category: "Repositories",
      features: ["Repository and organization lists", "Shallow git clone", "Token revocation"],
      provider: "GitHub"
    },
    {
      name: "Supabase",
      description: "Authentication and Postgres tables",
      category: "Auth & Data",
      features: ["Email, GitHub and Google sign-in", "Saved files", "Encrypted GitHub connections (optional)"],
      provider: "Supabase"
    },
    {
      name: "Prisma + Postgres",
      description: "Optional storage for analysis sessions and AI call records",
      category: "Sessions",
      features: ["Completed sessions survive restarts", "24-hour expiry", "Metadata-only AI call log"],
      provider: "SESSION_STORE=database"
    }
  ];

  const workflows = [
    {
      step: "1",
      title: "Pick a Repository",
      description: "Choose one of your connected GitHub repositories, or enter a public repository URL",
      icon: <Search className="h-5 w-5" />,
      details: "Selected repositories use your stored GitHub connection"
    },
    {
      step: "2",
      title: "Shallow Clone",
      description: "The server clones the repository with git --depth 1 into a directory for this session",
      icon: <Network className="h-5 w-5" />,
      details: "Size limit 200 MB and timeout 120 s by default"
    },
    {
      step: "3",
      title: "Three Agents",
      description: "Analyzer, generator and verifier run in sequence and produce up to three files and a review",
      icon: <Cpu className="h-5 w-5" />,
      details: "Progress milestones over Socket.IO, for your sessions only"
    },
    {
      step: "4",
      title: "Download or Save",
      description: "Download the Dockerfile, GitHub Actions workflow and .env.example, or save them to your account",
      icon: <RefreshCw className="h-5 w-5" />,
      details: "Sessions expire 24 hours after creation"
    }
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b border-border bg-card">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-soft">
                <Terminal className="h-4 w-4" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-base font-semibold tracking-tight">InfraMind</span>
                <span className="text-[11px] text-muted-foreground">Repository to DevOps files</span>
              </div>
            </div>
            <div className="hidden items-center gap-1 md:flex">
              <a
                href="#features"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                AI Agents
              </a>
              <a
                href="#tech"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Technology
              </a>
              <Button onClick={() => navigate('/auth')} className="ml-3">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="md:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="animate-slideDown space-y-1 border-t border-border pb-4 pt-3 md:hidden">
              <a
                href="#features"
                className="block rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                AI Agents
              </a>
              <a
                href="#tech"
                className="block rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Technology
              </a>
              <Button onClick={() => navigate('/auth')} className="mt-2 w-full">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </nav>

      <main>
        <section className="border-b border-border">
          <div className="container mx-auto grid gap-12 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16 lg:py-24">
            <div className="max-w-xl">
              <Badge variant="outline" className="mb-6 gap-2 border-primary/25 bg-primary/[0.06] py-1.5 text-primary">
                <GitBranch className="h-3.5 w-3.5" />
                Multi-agent DevOps pipeline
              </Badge>
              <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl lg:text-[3.25rem] xl:text-[3.5rem]">
                DevOps config, generated by a{' '}
                <span className="text-primary"><span className="whitespace-nowrap">three-agent</span> pipeline</span>
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">
                Three agents analyze a GitHub repository and write a Dockerfile, a GitHub Actions workflow and a .env.example.
                <span className="font-medium text-foreground"> AI providers are chosen by the operator; sign-in runs on Supabase.</span>
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button onClick={() => navigate('/auth')} size="lg">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => navigate('/demo')} size="lg">
                  <Play className="h-4 w-4" />
                  Try the Scripted Demo
                </Button>
              </div>
              <div className="mt-10 flex items-center gap-2.5 border-t border-border pt-6 font-mono text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-running" />
                <span>Analyzer → Generator → Verifier</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-raised">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs text-muted-foreground">agent-run / pipeline</span>
                </div>
                <Badge variant="outline" className="shrink-0 gap-1.5 font-mono text-[11px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-running" />
                  illustration
                </Badge>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="space-y-2">
                  <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-status-running" />
                    <span>Running {agents[currentAgentIndex].name}</span>
                  </div>
                  {agents.map((agent, index) => (
                    <div
                      key={agent.name}
                      className={`flex items-center gap-3 rounded-md border p-3 transition-colors duration-200 ${
                        index === currentAgentIndex
                          ? 'border-primary/35 bg-primary/[0.05]'
                          : 'border-border bg-card'
                      }`}
                    >
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono
                          text-[11px] transition-colors duration-200 ${
                          index <= currentAgentIndex
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{agent.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{agent.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="code-surface flex min-w-0 flex-col overflow-hidden rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-card/70 px-3 py-2">
                    <span className="font-mono text-[11px] text-muted-foreground">Dockerfile</span>
                    <Container className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <pre className="scrollbar-slim flex-1 overflow-x-auto p-4 font-mono text-xs leading-6">
                    <code>
                      {`FROM node:20-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\nEXPOSE 80`}
                    </code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-16 border-b border-border bg-card">
          <div className="container mx-auto px-4 py-20 sm:px-6 lg:py-24">
            <div className="mb-12 max-w-2xl">
              <p className="eyebrow mb-3">What it does</p>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">What the Pipeline Does</h2>
              <p className="mt-4 text-lg leading-8 text-muted-foreground">
                Three agents run in a fixed order to produce deployment configuration
                for one repository.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="flex flex-col rounded-lg border border-border bg-background p-6 transition-colors duration-150 hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-primary shadow-soft">
                      {React.cloneElement(feature.icon, { className: "h-5 w-5" })}
                    </div>
                    {feature.highlight && (
                      <Badge variant="secondary" className="font-mono text-[10px] tracking-wider">
                        {feature.highlight}
                      </Badge>
                    )}
                  </div>
                  <h3 className="mt-5 text-base font-semibold">{feature.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                    {feature.description}
                  </p>
                  <p className="mt-5 border-t border-border pt-4 font-mono text-[11px] text-muted-foreground">
                    {feature.tech}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="tech" className="scroll-mt-16 border-b border-border">
          <div className="container mx-auto px-4 py-20 sm:px-6 lg:py-24">
            <div className="mb-12 max-w-2xl">
              <p className="eyebrow mb-3">Under the hood</p>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Technology stack</h2>
              <p className="mt-4 text-lg leading-8 text-muted-foreground">The parts the client and server are built from.</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
              <div
                className="hidden grid-cols-[1.1fr_1fr_1.6fr] gap-6 border-b border-border bg-muted/60 px-6 py-3
                  font-mono text-[11px] uppercase tracking-wider text-muted-foreground md:grid"
              >
                <span>Component</span>
                <span>Role</span>
                <span>Capabilities</span>
              </div>
              {techStack.map((tech, index) => (
                <div
                  key={index}
                  className="grid gap-3 border-b border-border px-5 py-5 transition-colors duration-150 last:border-0 hover:bg-muted/30
                    sm:px-6 md:grid-cols-[1.1fr_1fr_1.6fr] md:items-start md:gap-6"
                >
                  <div>
                    <p className="font-semibold">{tech.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{tech.provider}</p>
                  </div>
                  <Badge variant="outline" className="w-fit text-[11px]">
                    {tech.category}
                  </Badge>
                  <div>
                    <p className="text-sm text-foreground/80">{tech.description}</p>
                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                      {tech.features.map((feature, idx) => (
                        <span
                          key={idx}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <CheckCircle className="h-3.5 w-3.5 text-status-success" />
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-16 bg-card">
          <div className="container mx-auto px-4 py-20 sm:px-6 lg:py-24">
            <div className="mb-12 max-w-2xl">
              <p className="eyebrow mb-3">Execution flow</p>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">How the Multi-Agent Pipeline Works</h2>
              <p className="mt-4 text-lg leading-8 text-muted-foreground">
                A fixed sequence from repository to generated files.
              </p>
            </div>
            <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {workflows.map((workflow, index) => (
                <li
                  key={index}
                  className="relative flex flex-col rounded-lg border border-border bg-background p-6"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-mono text-xs font-medium text-primary-foreground">
                      {workflow.step}
                    </span>
                    <span className="text-primary">{workflow.icon}</span>
                  </div>
                  <h3 className="mt-5 text-base font-semibold">{workflow.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                    {workflow.description}
                  </p>
                  <p className="mt-5 border-t border-border pt-4 font-mono text-[11px] leading-5 text-muted-foreground">
                    {workflow.details}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-border bg-card pb-20 sm:pb-24">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="grid gap-8 rounded-xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 md:grid-cols-[1fr_auto] md:items-center lg:px-12 lg:py-12">
              <div className="max-w-2xl">
                <h2 className="text-2xl font-semibold tracking-tight text-primary-foreground sm:text-3xl">
                  Generate DevOps Files for a Repository
                </h2>
                <p className="mt-3 text-primary-foreground/80">
                  Sign in, pick a repository and get a Dockerfile, a GitHub Actions workflow and a .env.example.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={() => navigate('/auth')}
                  size="lg"
                  className="bg-card text-primary hover:bg-card/90 focus-visible:ring-card focus-visible:ring-offset-primary"
                >
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => window.open('https://github.com', '_blank')}
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground shadow-none hover:border-primary-foreground/50 hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:ring-card focus-visible:ring-offset-primary"
                >
                  <Github className="h-4 w-4" />
                  Open GitHub
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background">
        <div className="container mx-auto px-4 py-12 sm:px-6">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="space-y-3 md:col-span-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Terminal className="h-3.5 w-3.5" />
                </div>
                <span className="font-semibold tracking-tight">InfraMind</span>
              </div>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                Three-agent pipeline that generates DevOps files for GitHub repositories.
              </p>
              <div className="font-mono text-[11px] leading-5 text-muted-foreground">
                <div>AI: configurable providers (gemini, groq, openrouter, novita)</div>
                <div>Auth: Supabase • Server: Express + Socket.IO</div>
              </div>
            </div>
            <div>
              <h3 className="eyebrow mb-3 text-muted-foreground">
                AI Agents
              </h3>
              <div className="space-y-2 text-sm text-foreground/80">
                <div>Analyzer Agent</div>
                <div>Generator Agent</div>
                <div>Verifier Agent</div>
              </div>
            </div>
            <div>
              <h3 className="eyebrow mb-3 text-muted-foreground">
                Technology
              </h3>
              <div className="space-y-2 text-sm text-foreground/80">
                <div>Sequential Agent Pipeline</div>
                <div>Configurable AI Providers</div>
                <div>Supabase Auth</div>
                <div>Docker & GitHub Actions</div>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
            <p>&copy; InfraMind</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
