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
    { name: "Planner Agent", description: "Analyzes codebase structure", icon: <Brain className="h-5 w-5" /> },
    {
      name: "Analyzer Agent",
      description: "Detects tech stack and dependencies",
      icon: <Search className="h-5 w-5" />
    },
    { name: "Generator Agent", description: "Creates CI/CD pipelines", icon: <Settings className="h-5 w-5" /> },
    { name: "Verifier Agent", description: "Validates and optimizes output", icon: <CheckCircle className="h-5 w-5" /> }
  ];

  // Cycle through agents every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentAgentIndex((prev) => (prev + 1) % agents.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);
  
  const features = [
    {
      icon: <Bot className="h-6 w-6" />,
      title: "Multi-Agent AI Orchestration",
      description: "Four specialized AI agents work in harmony: Planner analyzes structure, Analyzer detects tech stack, Generator creates pipelines, and Verifier ensures quality.",
      tech: "Sequential Agents + Llama 3 70B",
      highlight: "NEW"
    },
    {
      icon: <Search className="h-6 w-6" />,
      title: "Code Analysis",
      description: "Agents scan your repository's file structure and dependency manifests, then Llama 3 70B interprets its frameworks, dependencies and architectural patterns.",
      tech: "Repository Scan + Novita.ai",
      highlight: "ANALYSIS"
    },
    {
      icon: <Database className="h-6 w-6" />,
      title: "Persistent Memory",
      description: "Mem0 provides persistent memory across projects, enabling personalized DevOps recommendations that improve with every interaction.",
      tech: "Mem0 + Vector DB",
      highlight: "MEMORY"
    },
    {
      icon: <Monitor className="h-6 w-6" />,
      title: "Real-time Observability",
      description: "Keywords AI powers comprehensive monitoring, logging, and analytics for complete visibility into your AI-driven DevOps pipeline performance.",
      tech: "Keywords AI + Metrics",
      highlight: "MONITORING"
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: "Supabase Backend Infrastructure",
      description: "Secure, scalable backend powered by Supabase with built-in authentication, a Postgres database, and row-level security that keeps each user's files private.",
      tech: "Supabase",
      highlight: "SECURE"
    },
    {
      icon: <Workflow className="h-6 w-6" />,
      title: "Automated CI/CD Generation",
      description: "Generate production-ready Docker configurations, GitHub Actions workflows, and deployment scripts tailored to your specific technology stack.",
      tech: "AI-Generated",
      highlight: "AUTOMATED"
    }
  ];

  const techStack = [
    { 
      name: "Llama 3 70B", 
      description: "Advanced large language model via Novita.ai",
      category: "AI Core",
      features: ["Code Understanding", "Pattern Recognition", "Best Practices"],
      provider: "Novita.ai"
    },
    { 
      name: "Agent Pipeline", 
      description: "Custom sequential multi-agent workflow",
      category: "Agent System",
      features: ["Agent Sequencing", "Shared State", "LLM Retry Handling"],
      provider: "InfraMind"
    },
    { 
      name: "Tavily", 
      description: "AI-powered search and research platform",
      category: "Search & Analysis",
      features: ["Code Search", "Documentation Lookup", "Best Practice Research"],
      provider: "Tavily"
    },
    { 
      name: "Mem0", 
      description: "Persistent memory and context for AI",
      category: "Memory & Context",
      features: ["Project Memory", "User Preferences", "Historical Context"],
      provider: "Mem0"
    },
    { 
      name: "Supabase", 
      description: "Open-source Postgres development platform",
      category: "Backend Services",
      features: ["Authentication", "Postgres Database", "Row-Level Security", "OAuth Providers"],
      provider: "Supabase"
    },
    { 
      name: "Keywords AI", 
      description: "AI observability and monitoring",
      category: "Observability",
      features: ["Performance Tracking", "Usage Analytics", "Error Monitoring"],
      provider: "Keywords AI"
    }
  ];

  const workflows = [
    {
      step: "1",
      title: "Repository Analysis",
      description: "Planner Agent analyzes codebase structure while Analyzer Agent detects tech stack",
      icon: <Search className="h-5 w-5" />,
      details: "File-structure scan and dependency detection, interpreted by Llama 3 70B"
    },
    {
      step: "2", 
      title: "AI Agent Coordination",
      description: "The planner, analyzer, generator and verifier run in sequence, each building on the previous result",
      icon: <Network className="h-5 w-5" />,
      details: "Shared state between agents, with progress updates over Socket.IO"
    },
    {
      step: "3",
      title: "Pipeline Generation",
      description: "Generator Agent creates tailored CI/CD pipelines and infrastructure code",
      icon: <Cpu className="h-5 w-5" />,
      details: "Production-ready Docker, GitHub Actions, and deployment configs"
    },
    {
      step: "4",
      title: "Verification & Learning",
      description: "Verifier Agent validates output while Mem0 stores insights for future improvements",
      icon: <RefreshCw className="h-5 w-5" />,
      details: "Quality assurance + persistent memory for continuous learning"
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
                <span className="text-[11px] text-muted-foreground">Powered by Supabase</span>
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
                Get Started Free
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
                Get Started Free
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
                <span className="text-primary"><span className="whitespace-nowrap">four-agent</span> pipeline</span>
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">
                Four specialized AI agents collaborate to understand, analyze, and automate your entire DevOps pipeline.
                <span className="font-medium text-foreground"> Powered by Llama 3 70B and Supabase.</span>
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button onClick={() => navigate('/auth')} size="lg">
                  Start Free Trial
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => navigate('/demo')} size="lg">
                  <Play className="h-4 w-4" />
                  Watch AI Agents Demo
                </Button>
              </div>
              <div className="mt-10 flex items-center gap-2.5 border-t border-border pt-6 font-mono text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-running" />
                <span>Planner → Analyzer → Generator → Verifier</span>
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
                  live preview
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
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Automated Pipeline Architecture</h2>
              <p className="mt-4 text-lg leading-8 text-muted-foreground">
                Four specialized agents collaborate in an automated pipeline to produce
                production-grade deployment configurations.
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
              <p className="mt-4 text-lg leading-8 text-muted-foreground">Built on AI models and cloud-native infrastructure.</p>
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
                Deterministic sequence from repository ingestion to verified CI/CD artifact creation.
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
                  Ready to Automate Your DevOps Pipeline?
                </h2>
                <p className="mt-3 text-primary-foreground/80">
                  Connect your repository and generate Docker and CI/CD pipelines in seconds.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={() => navigate('/auth')}
                  size="lg"
                  className="bg-card text-primary hover:bg-card/90 focus-visible:ring-card focus-visible:ring-offset-primary"
                >
                  Start Free Trial
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => window.open('https://github.com', '_blank')}
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground shadow-none hover:border-primary-foreground/50 hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:ring-card focus-visible:ring-offset-primary"
                >
                  <Github className="h-4 w-4" />
                  View on GitHub
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
                Multi-agent AI system for automated DevOps with authentication, Postgres data, and row-level security.
              </p>
              <div className="font-mono text-[11px] leading-5 text-muted-foreground">
                <div>AI Core: Llama 3 70B • Tavily • Mem0</div>
                <div>Backend: Supabase Cloud Infrastructure</div>
              </div>
            </div>
            <div>
              <h3 className="eyebrow mb-3 text-muted-foreground">
                AI Agents
              </h3>
              <div className="space-y-2 text-sm text-foreground/80">
                <div>Planner Agent</div>
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
                <div>Llama 3 70B Model</div>
                <div>Supabase Backend</div>
                <div>Docker & GitHub Actions</div>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
            <p>&copy; 2024 InfraMind. Built with Supabase and modern AI technologies.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
