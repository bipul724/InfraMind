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
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/80 bg-background">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Terminal className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-semibold tracking-tight">InfraMind</span>
                <span className="text-xs text-muted-foreground">Powered by Supabase</span>
              </div>
            </div>
            <div className="hidden items-center gap-6 md:flex">
              <a
                href="#features"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                AI Agents
              </a>
              <a
                href="#tech"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Technology
              </a>
              <Button onClick={() => navigate('/auth')}>
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="md:hidden">
              <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="animate-slideDown space-y-3 border-t border-border/80 py-4 md:hidden">
              <a
                href="#features"
                className="block text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                AI Agents
              </a>
              <a
                href="#tech"
                className="block text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Technology
              </a>
              <Button onClick={() => navigate('/auth')} className="w-full">
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </nav>

      <main>
        <section className="border-b border-border bg-muted/20">
          <div className="container mx-auto grid gap-12 px-4 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-24">
            <div className="max-w-xl">
              <Badge variant="outline" className="mb-6 gap-2 border-primary/30 bg-primary/5 text-primary">
                <GitBranch className="h-3.5 w-3.5" />
                Multi-agent DevOps pipeline
              </Badge>
              <h1 className="text-5xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
                DevOps config, generated by a four-agent pipeline
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
              <div className="mt-8 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-status-running" />
                <span>Planner → Analyzer → Generator → Verifier</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-3 py-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">agent-run / pipeline</span>
                </div>
                <Badge variant="secondary" className="font-mono text-[11px]">live preview</Badge>
              </div>
              <div className="grid gap-4 p-3 md:grid-cols-[1fr_1.15fr]">
                <div className="space-y-2">
                  <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-status-running" />
                    <span>Running {agents[currentAgentIndex].name}</span>
                  </div>
                  {agents.map((agent, index) => (
                    <div
                      key={agent.name}
                      className={`flex items-center gap-3 rounded-md border p-3 transition-colors ${
                        index === currentAgentIndex
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-background'
                      }`}
                    >
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono
                          text-[11px] ${
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
                <div className="overflow-hidden rounded-md border border-border bg-foreground">
                  <div className="flex items-center justify-between border-b border-background/15 px-3 py-2">
                    <span className="font-mono text-[11px] text-background/70">Dockerfile</span>
                    <Container className="h-3.5 w-3.5 text-background/60" />
                  </div>
                  <pre className="overflow-x-auto p-4 font-mono text-xs leading-6 text-background/90">
                    <code>
                      {`FROM node:20-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\nEXPOSE 80`}
                    </code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-b border-border bg-background">
          <div className="container mx-auto px-4 py-20">
            <div className="mb-10 max-w-2xl">
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-primary">What it does</p>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Automated Pipeline Architecture</h2>
              <p className="mt-3 text-muted-foreground">
                Four specialized agents collaborate in an automated pipeline to produce
                production-grade deployment configurations.
              </p>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {features.map((feature, index) => (
                 <div
                   key={index}
                   className="grid gap-4 py-5 md:grid-cols-[2rem_1fr_auto] md:items-start md:gap-6"
                 >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border
                      bg-muted text-primary"
                  >
                    {React.cloneElement(feature.icon, { className: "h-4 w-4" })}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{feature.title}</h3>
                      {feature.highlight && (
                        <Badge variant="secondary" className="text-[11px]">
                          {feature.highlight}
                        </Badge>
                      )}
                    </div>
                     <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                       {feature.description}
                     </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit font-mono text-[11px] text-muted-foreground"
                  >
                    {feature.tech}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="tech" className="border-b border-border bg-muted/20">
        <div className="container mx-auto px-4 py-20">
          <div className="mb-10 max-w-2xl">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-primary">Under the hood</p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Technology stack</h2>
            <p className="mt-3 text-muted-foreground">Built on AI models and cloud-native infrastructure.</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div
              className="hidden grid-cols-[1.1fr_1fr_1.5fr] gap-6 border-b border-border bg-muted/50 px-5 py-3
                font-mono text-[11px] uppercase tracking-wider text-muted-foreground md:grid"
            >
              <span>Component</span>
              <span>Role</span>
              <span>Capabilities</span>
            </div>
            {techStack.map((tech, index) => (
              <div
                key={index}
                className="grid gap-3 border-b border-border px-5 py-5 last:border-0
                  md:grid-cols-[1.1fr_1fr_1.5fr] md:items-start md:gap-6"
              >
                <div>
                  <p className="font-medium">{tech.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{tech.provider}</p>
                </div>
                <Badge variant="outline" className="w-fit text-[11px]">
                  {tech.category}
                </Badge>
                <div>
                  <p className="text-sm text-muted-foreground">{tech.description}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
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

      <section id="workflow" className="bg-background">
        <div className="container mx-auto px-4 py-20">
          <div className="mb-10 max-w-2xl">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-primary">Execution flow</p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">How the Multi-Agent Pipeline Works</h2>
            <p className="mt-3 text-muted-foreground">
              Deterministic sequence from repository ingestion to verified CI/CD artifact creation.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
             {workflows.map((workflow, index) => (
               <div
                 key={index}
                 className="flex gap-4 rounded-lg border border-border bg-card p-5"
               >
                 <div
                   className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs
                     text-primary-foreground"
                 >
                   {workflow.step}
                 </div>
                 <div>
                   <div className="flex items-center gap-2">
                     <span className="text-primary">{workflow.icon}</span>
                     <h3 className="font-medium">{workflow.title}</h3>
                   </div>
                   <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                     {workflow.description}
                   </p>
                   <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                     {workflow.details}
                   </p>
                 </div>
               </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-secondary/50">
        <div className="container mx-auto grid gap-8 px-4 py-16 md:grid-cols-[1fr_auto] md:items-center">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">
              Ready to Automate Your DevOps Pipeline?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Connect your repository and generate Docker and CI/CD pipelines in seconds.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => navigate('/auth')} size="lg">
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => window.open('https://github.com', '_blank')}
            >
              <Github className="h-4 w-4" />
              View on GitHub
            </Button>
          </div>
        </div>
      </section>
      </main>

      <footer className="bg-foreground text-background">
        <div className="container mx-auto px-4 py-12">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="space-y-3 md:col-span-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-background text-foreground">
                  <Terminal className="h-3.5 w-3.5" />
                </div>
                <span className="font-semibold tracking-tight">InfraMind</span>
              </div>
              <p className="max-w-sm text-xs leading-5 text-background/70">
                Multi-agent AI system for automated DevOps with authentication, Postgres data, and row-level security.
              </p>
              <div className="font-mono text-[11px] leading-5 text-background/60">
                <div>AI Core: Llama 3 70B • Tavily • Mem0</div>
                <div>Backend: Supabase Cloud Infrastructure</div>
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-background/70">
                AI Agents
              </h3>
              <div className="space-y-2 text-xs text-background/70">
                <div>Planner Agent</div>
                <div>Analyzer Agent</div>
                <div>Generator Agent</div>
                <div>Verifier Agent</div>
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-background/70">
                Technology
              </h3>
              <div className="space-y-2 text-xs text-background/70">
                <div>Sequential Agent Pipeline</div>
                <div>Llama 3 70B Model</div>
                <div>Supabase Backend</div>
                <div>Docker & GitHub Actions</div>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t border-background/15 pt-6 text-xs text-background/60">
            <p>&copy; 2024 InfraMind. Built with Supabase and modern AI technologies.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
