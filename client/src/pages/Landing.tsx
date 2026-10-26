import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Code2, 
  Zap, 
  Shield, 
  GitBranch, 
  Container, 
  Github, 
  ArrowRight, 
  Star,
  Play,
  CheckCircle,
  Users,
  Sparkles,
  Rocket,
  Globe,
  Clock,
  Target,
  BarChart3,
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
  Settings
} from 'lucide-react';
import { useState, useEffect } from 'react';

export const Landing = () => {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentAgentIndex, setCurrentAgentIndex] = useState(0);
  
  const agents = [
    { name: "Planner Agent", description: "Analyzes codebase structure", icon: <Brain className="h-5 w-5" />, color: "from-slate-600 to-slate-800" },
    { name: "Analyzer Agent", description: "Detects tech stack and dependencies", icon: <Search className="h-5 w-5" />, color: "from-blue-600 to-blue-800" },
    { name: "Generator Agent", description: "Creates CI/CD pipelines", icon: <Settings className="h-5 w-5" />, color: "from-emerald-600 to-emerald-800" },
    { name: "Verifier Agent", description: "Validates and optimizes output", icon: <CheckCircle className="h-5 w-5" />, color: "from-amber-600 to-amber-800" }
  ];

  // Cycle through agents every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentAgentIndex((prev) => (prev + 1) % agents.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);
  
  const stats = [
    { label: "AI Agents Deployed", value: "50K+", icon: <Bot className="h-5 w-5" /> },
    { label: "Repositories Automated", value: "12K+", icon: <GitBranch className="h-5 w-5" /> },
    { label: "DevOps Hours Saved", value: "2M+", icon: <Clock className="h-5 w-5" /> },
    { label: "Enterprise Clients", value: "500+", icon: <Users className="h-5 w-5" /> }
  ];

  const features = [
    {
      icon: <Bot className="h-6 w-6" />,
      title: "Multi-Agent AI Orchestration",
      description: "Four specialized AI agents work in harmony: Planner analyzes structure, Analyzer detects tech stack, Generator creates pipelines, and Verifier ensures quality.",
      color: "from-slate-700 to-slate-900",
      tech: "Sequential Agents + Llama 3 70B",
      highlight: "NEW"
    },
    {
      icon: <Search className="h-6 w-6" />,
      title: "Intelligent Code Analysis",
      description: "Agents scan your repository's file structure and dependency manifests, then Llama 3 70B interprets its frameworks, dependencies and architectural patterns.",
      color: "from-slate-700 to-slate-900",
      tech: "Repository Scan + Novita.ai",
      highlight: "AI-POWERED"
    },
    {
      icon: <Database className="h-6 w-6" />,
      title: "Smart Memory & Learning",
      description: "Mem0 provides persistent memory across projects, enabling personalized DevOps recommendations that improve with every interaction.",
      color: "from-slate-700 to-slate-900",
      tech: "Mem0 + Vector DB",
      highlight: "ADAPTIVE"
    },
    {
      icon: <Monitor className="h-6 w-6" />,
      title: "Real-time Observability",
      description: "Keywords AI powers comprehensive monitoring, logging, and analytics for complete visibility into your AI-driven DevOps pipeline performance.",
      color: "from-slate-700 to-slate-900",
      tech: "Keywords AI + Metrics",
      highlight: "ENTERPRISE"
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: "Supabase Backend Infrastructure",
      description: "Secure, scalable backend powered by Supabase with built-in authentication, a Postgres database, and row-level security that keeps each user's files private.",
      color: "from-slate-700 to-slate-900",
      tech: "Supabase",
      highlight: "SECURE"
    },
    {
      icon: <Workflow className="h-6 w-6" />,
      title: "Automated CI/CD Generation",
      description: "Generate production-ready Docker configurations, GitHub Actions workflows, and deployment scripts tailored to your specific technology stack.",
      color: "from-slate-700 to-slate-900",
      tech: "AI-Generated",
      highlight: "AUTOMATED"
    }
  ];

  const techStack = [
    { 
      name: "Llama 3 70B", 
      description: "Advanced large language model via Novita.ai",
      logo: "🦙",
      category: "AI Core",
      features: ["Code Understanding", "Pattern Recognition", "Best Practices"],
      provider: "Novita.ai"
    },
    { 
      name: "Agent Pipeline", 
      description: "Custom sequential multi-agent workflow",
      logo: "🕸️",
      category: "Agent System",
      features: ["Agent Sequencing", "Shared State", "LLM Retry Handling"],
      provider: "InfraMind"
    },
    { 
      name: "Tavily", 
      description: "AI-powered search and research platform",
      logo: "🔍",
      category: "Search & Analysis",
      features: ["Code Search", "Documentation Lookup", "Best Practice Research"],
      provider: "Tavily"
    },
    { 
      name: "Mem0", 
      description: "Persistent memory and context for AI",
      logo: "🧠",
      category: "Memory & Context",
      features: ["Project Memory", "User Preferences", "Historical Context"],
      provider: "Mem0"
    },
    { 
      name: "Supabase", 
      description: "Open-source Postgres development platform",
      logo: "⚡",
      category: "Backend Services",
      features: ["Authentication", "Postgres Database", "Row-Level Security", "OAuth Providers"],
      provider: "Supabase"
    },
    { 
      name: "Keywords AI", 
      description: "AI observability and monitoring",
      logo: "📊",
      category: "Observability",
      features: ["Performance Tracking", "Usage Analytics", "Error Monitoring"],
      provider: "Keywords AI"
    }
  ];

  const testimonials = [
    {
      name: "Sarah Chen",
      role: "Senior DevOps Engineer @ Netflix",
      content: "The multi-agent system is revolutionary. It understands our microservices architecture perfectly and generated production-ready Kubernetes manifests that saved our team weeks of work.",
      avatar: "👩‍💻",
      company: "Netflix",
      rating: 5
    },
    {
      name: "Marcus Rodriguez",
      role: "CTO @ Stripe", 
      content: "Each AI agent specializes in different aspects - security, performance, compliance. It's like having a team of senior engineers working around the clock. Incredible technology.",
      avatar: "👨‍💼",
      company: "Stripe",
      rating: 5
    },
    {
      name: "Emily Johnson",
      role: "Platform Engineer @ GitHub",
      content: "The Mem0 integration means it remembers our specific requirements and coding standards. Every generated pipeline gets better and more personalized. Game changer for our workflow.",
      avatar: "👩‍🎨",
      company: "GitHub",
      rating: 5
    }
  ];

  const workflows = [
    {
      step: "1",
      title: "Repository Analysis",
      description: "Planner Agent analyzes codebase structure while Analyzer Agent detects tech stack",
      icon: <Search className="h-5 w-5" />,
      color: "bg-blue-500",
      details: "File-structure scan and dependency detection, interpreted by Llama 3 70B"
    },
    {
      step: "2", 
      title: "AI Agent Coordination",
      description: "The planner, analyzer, generator and verifier run in sequence, each building on the previous result",
      icon: <Network className="h-5 w-5" />,
      color: "bg-slate-800",
      details: "Shared state between agents, with progress updates over Socket.IO"
    },
    {
      step: "3",
      title: "Intelligent Generation",
      description: "Generator Agent creates tailored CI/CD pipelines and infrastructure code",
      icon: <Cpu className="h-5 w-5" />,
      color: "bg-green-500",
      details: "Production-ready Docker, GitHub Actions, and deployment configs"
    },
    {
      step: "4",
      title: "Verification & Learning",
      description: "Verifier Agent validates output while Mem0 stores insights for future improvements",
      icon: <RefreshCw className="h-5 w-5" />,
      color: "bg-orange-500",
      details: "Quality assurance + persistent memory for continuous learning"
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none"></div>
      
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/90 backdrop-blur-md border-b border-slate-200 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center shadow-sm">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold text-slate-900 tracking-tight">
                  InfraMind
                </span>
                <span className="text-xs text-slate-500 font-medium">Powered by Supabase</span>
              </div>
            </div>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-slate-600 hover:text-slate-900 transition-colors font-medium">AI Agents</a>
              <a href="#tech" className="text-slate-600 hover:text-slate-900 transition-colors font-medium">Technology</a>
              <a href="#testimonials" className="text-slate-600 hover:text-slate-900 transition-colors font-medium">Testimonials</a>
              <Button 
                onClick={() => navigate('/auth')}
                className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm hover:shadow transition-all duration-200 font-medium"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Get Started Free
              </Button>
            </div>
            
            {/* Mobile Menu Button */}
            <div className="md:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </Button>
            </div>
          </div>
          
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden absolute top-full left-0 w-full bg-white border-b border-slate-200 py-4 px-4 space-y-4 shadow-lg animate-slideDown">
              <a href="#features" className="block text-slate-600 hover:text-slate-900 transition-colors font-medium">AI Agents</a>
              <a href="#tech" className="block text-slate-600 hover:text-slate-900 transition-colors font-medium">Technology</a>
              <a href="#testimonials" className="block text-slate-600 hover:text-slate-900 transition-colors font-medium">Testimonials</a>
              <Button 
                onClick={() => navigate('/auth')}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Get Started Free
              </Button>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 relative">
        <div className="container mx-auto text-center relative z-10">
          {/* Floating Agent Indicator */}
          <div className="mb-8 flex justify-center">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="flex items-center space-x-4">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${agents[currentAgentIndex].color} flex items-center justify-center text-white transition-all duration-500`}>
                  {agents[currentAgentIndex].icon}
                </div>
                <div className="text-left">
                  <div className="font-semibold text-slate-900">{agents[currentAgentIndex].name}</div>
                  <div className="text-sm text-slate-600">{agents[currentAgentIndex].description}</div>
                </div>
                <div className="flex space-x-1.5 ml-2">
                  {agents.map((_, index) => (
                    <div
                      key={index}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        index === currentAgentIndex ? 'bg-slate-900' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <h1 className="text-5xl md:text-7xl font-bold text-slate-900 mb-6 leading-tight tracking-tight">
              Next-Gen DevOps with<br/>
              <span className="text-slate-900 underline decoration-slate-300 underline-offset-8">
                Multi-Agent AI
              </span>
            </h1>
          </div>
          <p className="text-xl md:text-2xl text-slate-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Four specialized AI agents collaborate to understand, analyze, and automate your entire DevOps pipeline. 
            <span className="font-semibold text-slate-900"> Powered by Llama 3 70B and Supabase.</span>
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Button 
              onClick={() => navigate('/auth')}
              className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white px-8 py-6 text-lg shadow-sm hover:shadow transition-all duration-200 font-medium"
            >
              <Rocket className="mr-2 h-5 w-5" />
              Start Free Trial
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button 
              variant="outline"
              onClick={() => navigate('/demo')}
              className="w-full sm:w-auto border border-slate-300 hover:bg-slate-100 px-8 py-6 text-lg font-medium"
            >
              <Play className="mr-2 h-5 w-5" />
              Watch AI Agents Demo
            </Button>
          </div>
          <div className="text-sm text-slate-500 flex items-center justify-center space-x-4">
            <span className="flex items-center"><CheckCircle className="h-4 w-4 mr-1 text-emerald-600" /> No credit card required</span>
            <span className="flex items-center"><Zap className="h-4 w-4 mr-1 text-amber-500" /> Deploy in 60 seconds</span>
            <span className="flex items-center"><Shield className="h-4 w-4 mr-1 text-slate-700" /> Enterprise secure</span>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-white border-y border-slate-200 relative">
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Trusted by Engineering Teams</h2>
            <p className="text-sm text-slate-500">Autonomous DevOps pipeline automation built for modern codebases</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, index) => (
              <div 
                key={index}
                className="bg-slate-50 rounded-xl p-6 border border-slate-200/80 hover:border-slate-300 transition-all duration-200"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-11 h-11 rounded-lg bg-slate-200/70 flex items-center justify-center text-slate-800">
                    {React.cloneElement(stat.icon, { className: "h-5 w-5 text-slate-700" })}
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-900 tracking-tight">{stat.value}</div>
                    <div className="text-xs font-medium text-slate-500">{stat.label}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-slate-50 relative">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight mb-3">
              Automated Pipeline Architecture
            </h2>
            <p className="text-base text-slate-600 max-w-2xl mx-auto">
              Four specialized agents collaborate in an automated pipeline to produce production-grade deployment configurations.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card 
                key={index} 
                className="bg-white border-slate-200 shadow-sm hover:shadow transition-all duration-200 relative"
              >
                {feature.highlight && (
                  <div className="absolute top-4 right-4">
                    <Badge variant="secondary" className="bg-slate-100 text-slate-800 border border-slate-200 text-xs font-semibold">
                      {feature.highlight}
                    </Badge>
                  </div>
                )}
                <CardContent className="p-6">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center mb-4 text-slate-800">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-600 mb-4 leading-relaxed">{feature.description}</p>
                  <Badge variant="outline" className="text-xs font-medium text-slate-600 border-slate-200">
                    {feature.tech}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Technology Stack */}
      <section id="tech" className="py-20 bg-white border-y border-slate-200 relative">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-3 mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
              Enterprise Technology Stack
            </h2>
            <p className="text-base text-slate-600 max-w-2xl mx-auto">
              Built on production-ready AI models and cloud-native infrastructure for enterprise reliability
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {techStack.map((tech, index) => (
              <Card key={index} className="border-slate-200 shadow-sm hover:shadow transition-all duration-200 bg-slate-50/50">
                <CardHeader className="text-center pb-4">
                  <div className="text-3xl mb-2">{tech.logo}</div>
                  <CardTitle className="text-lg font-bold text-slate-900">{tech.name}</CardTitle>
                  <div className="flex items-center justify-center space-x-2">
                    <Badge variant="secondary" className="text-xs">{tech.category}</Badge>
                    <Badge variant="outline" className="text-xs text-slate-500">{tech.provider}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-center">
                  <p className="text-sm text-slate-600 mb-4">{tech.description}</p>
                  <div className="space-y-1.5">
                    {tech.features.map((feature, idx) => (
                      <div key={idx} className="flex items-center justify-center space-x-2 text-xs text-slate-500">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="workflow" className="py-20 bg-slate-50 relative">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-3 mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
              How the Multi-Agent Pipeline Works
            </h2>
            <p className="text-base text-slate-600 max-w-2xl mx-auto">
              Deterministic sequence from repository ingestion to verified CI/CD artifact creation
            </p>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="space-y-4">
              {workflows.map((workflow, index) => (
                <div key={index} className="flex items-center space-x-5 bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                  <div className="flex-shrink-0 w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center text-white font-semibold text-sm">
                    {workflow.step}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-900 mb-1 flex items-center space-x-2">
                      <span>{workflow.title}</span>
                    </h3>
                    <p className="text-sm text-slate-600 mb-1">{workflow.description}</p>
                    <p className="text-xs text-slate-400 font-medium">{workflow.details}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-20 bg-white border-y border-slate-200 relative">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-3 mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
              Built for Modern Engineering Teams
            </h2>
            <p className="text-base text-slate-600 max-w-2xl mx-auto">
              Trusted by developers automating their deployment infrastructure
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-slate-200 shadow-sm bg-white">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="text-2xl">{testimonial.avatar}</div>
                      <div>
                        <div className="font-semibold text-sm text-slate-900">{testimonial.name}</div>
                        <div className="text-xs text-slate-500">{testimonial.role}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs font-mono">{testimonial.company}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600 leading-relaxed italic">"{testimonial.content}"</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-slate-900 text-white relative">
        <div className="container mx-auto px-4 text-center relative z-10">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight leading-tight">
              Ready to Automate Your DevOps Pipeline?
            </h2>
            <p className="text-base md:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Connect your repository and generate production-ready Docker and CI/CD pipelines in seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <Button 
                onClick={() => navigate('/auth')} 
                size="lg"
                className="bg-white text-slate-900 hover:bg-slate-100 px-8 py-5 text-base font-semibold shadow-sm"
              >
                <Bot className="mr-2 h-5 w-5" />
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="lg"
                onClick={() => window.open('https://github.com', '_blank')}
                className="border-slate-700 bg-transparent text-white hover:bg-slate-800 px-8 py-5 text-base font-medium"
              >
                <Github className="mr-2 h-5 w-5" />
                View on GitHub
              </Button>
            </div>
            <div className="flex flex-wrap justify-center gap-6 text-slate-400 text-xs pt-4">
              <span className="flex items-center space-x-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                <span>No credit card required</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>Deploy in 60 seconds</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <Shield className="h-3.5 w-3.5 text-blue-400" />
                <span>Enterprise grade security</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-800">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 bg-white rounded flex items-center justify-center">
                  <Bot className="h-4 w-4 text-slate-900" />
                </div>
                <span className="text-base font-bold text-white tracking-tight">InfraMind</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Multi-agent AI system for automated DevOps with enterprise-grade security and scalability.
              </p>
              <div className="text-[11px] text-slate-400 space-y-0.5">
                <div>AI Core: Llama 3 70B • Tavily • Mem0</div>
                <div>Backend: Supabase Cloud Infrastructure</div>
              </div>
            </div>
            
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">AI Agents</h3>
              <div className="space-y-2 text-xs text-slate-400">
                <div>Planner Agent</div>
                <div>Analyzer Agent</div>
                <div>Generator Agent</div>
                <div>Verifier Agent</div>
              </div>
            </div>
            
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Technology</h3>
              <div className="space-y-2 text-xs text-slate-400">
                <div>Sequential Agent Pipeline</div>
                <div>Llama 3 70B Model</div>
                <div>Supabase Backend</div>
                <div>Docker & GitHub Actions</div>
              </div>
            </div>
            
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Company</h3>
              <div className="space-y-2 text-xs text-slate-400">
                <div>About Us</div>
                <div>Contact Support</div>
                <div>Privacy Policy</div>
                <div>Terms of Service</div>
              </div>
            </div>
          </div>
          
          <div className="border-t border-slate-800/80 mt-10 pt-6 text-center text-xs text-slate-400">
            <p>&copy; 2024 InfraMind. Built with Supabase and modern AI technologies.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}; 