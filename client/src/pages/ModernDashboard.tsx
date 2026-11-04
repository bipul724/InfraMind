import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Github, 
  GitBranch, 
  Zap, 
  Rocket, 
  Code, 
  Play, 
  CheckCircle, 
  AlertCircle,
  ExternalLink,
  Settings,
  LogOut,
  User,
  Home,
  Activity,
  Clock,
  Star,
  Plus,
  Search,
  Filter,
  FileText
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { useNavigate } from 'react-router-dom';
import { AgentGenerationForm } from '@/components/AgentGenerationForm';
import { AgentProgress } from '@/components/AgentProgress';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SavedFiles } from '@/components/dashboard/SavedFiles';

interface Repository {
  id: string;
  name: string;
  fullName: string;
  description?: string;
  language: string;
  private: boolean;
  stars: number;
  updatedAt: string;
  url: string;
}

interface Project {
  id: string;
  name: string;
  repoUrl: string;
  techStack: string;
  status: 'generating' | 'completed' | 'failed';
  createdAt: string;
  progress?: number;
}

export const ModernDashboard = () => {
  const { user, logout } = useAuth();
  const { user: githubUser, isConnected, isLoading, error, connectGitHub, disconnect } = useGitHub();
  const navigate = useNavigate();
  
  // State management
  const [activeTab, setActiveTab] = useState('generate');
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [manualRepoUrl, setManualRepoUrl] = useState('');
  const [useManualUrl, setUseManualUrl] = useState(false);

  // GitHub connection status - use context values
  const githubUsername = githubUser?.login;

  useEffect(() => {
    setGithubConnected(isConnected);
    if (isConnected) {
      loadRepositories();
    }
  }, [isConnected]);

  // Move focus to the repository URL field once the manual form appears
  useEffect(() => {
    if (useManualUrl) {
      document.getElementById('repo-url')?.focus();
    }
  }, [useManualUrl]);

  const loadRepositories = async () => {
    try {
      // Mock repositories for demonstration
      const mockRepos: Repository[] = [
        {
          id: '1',
          name: 'my-awesome-app',
          fullName: 'user/my-awesome-app',
          description: 'A modern React application with TypeScript',
          language: 'TypeScript',
          private: false,
          stars: 42,
          updatedAt: '2024-01-20',
          url: 'https://github.com/user/my-awesome-app'
        },
        {
          id: '2',
          name: 'api-server',
          fullName: 'user/api-server',
          description: 'Node.js REST API with Express and MongoDB',
          language: 'JavaScript',
          private: true,
          stars: 15,
          updatedAt: '2024-01-19',
          url: 'https://github.com/user/api-server'
        },
        {
          id: '3',
          name: 'python-ml-project',
          fullName: 'user/python-ml-project',
          description: 'Machine learning project with Python and scikit-learn',
          language: 'Python',
          private: false,
          stars: 128,
          updatedAt: '2024-01-18',
          url: 'https://github.com/user/python-ml-project'
        }
      ];
      setRepositories(mockRepos);
    } catch (error) {
      console.error('Failed to load repositories:', error);
    }
  };

  const handleGitHubConnect = async () => {
    try {
      connectGitHub();
    } catch (error) {
      console.error('GitHub connection failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/auth');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepo(repo);
    setManualRepoUrl(repo.url);
  };

  const handleProjectComplete = (result: any) => {
    const newProject: Project = {
      id: Date.now().toString(),
      name: selectedRepo?.name || 'Manual Project',
      repoUrl: selectedRepo?.url || manualRepoUrl,
      techStack: result.techStack?.primary || 'Detected',
      status: 'completed',
      createdAt: new Date().toISOString(),
      progress: 100
    };
    setProjects(prev => [newProject, ...prev]);
  };

  const filteredRepos = repositories.filter(repo =>
    repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getLanguageColor = (language: string) => {
    const colors: { [key: string]: string } = {
      TypeScript: 'bg-primary/10 text-primary border-primary/20',
      JavaScript: 'bg-status-warning/10 text-status-warning border-status-warning/30',
      Python: 'bg-status-success/10 text-status-success border-status-success/30',
      Java: 'bg-status-error/10 text-status-error border-status-error/30',
      Go: 'bg-muted text-muted-foreground border-border',
      Rust: 'bg-secondary text-secondary-foreground border-border',
    };
    return colors[language] || 'bg-muted text-muted-foreground border-border';
  };

  return (
    <ErrorBoundary>
      <div className="text-foreground">
        <div className="space-y-8">
          {/* Page header: welcome, GitHub status and account actions */}
          <header className="flex flex-col gap-5 border-b border-border pb-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <p className="eyebrow">AI-Powered DevOps</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[2rem] sm:leading-tight">
                Welcome back, {user?.name?.split(' ')[0]}!
              </h2>
              <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
                Generate production-ready CI/CD configurations with our AI-powered agents
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {githubConnected && githubUsername && (
                <div className="flex items-center gap-2 rounded-full border border-status-success/30 bg-status-success/[0.06] px-3 py-1.5">
                  <Github className="h-4 w-4 text-status-success" />
                  <span className="font-mono text-xs font-medium text-status-success">@{githubUsername}</span>
                </div>
              )}

              <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-soft">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user?.prefs?.avatarUrl} />
                  <AvatarFallback>{user?.name?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </header>

          {/* Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-flex sm:h-11 sm:w-auto">
              <TabsTrigger value="generate" className="h-9 sm:h-full">
                <Zap className="h-4 w-4" />
                <span>Generate</span>
              </TabsTrigger>
              <TabsTrigger value="repositories" className="h-9 sm:h-full">
                <GitBranch className="h-4 w-4" />
                <span>Repositories</span>
              </TabsTrigger>
              <TabsTrigger value="projects" className="h-9 sm:h-full">
                <Activity className="h-4 w-4" />
                <span>Projects</span>
              </TabsTrigger>
              <TabsTrigger value="saved" className="h-9 sm:h-full">
                <FileText className="h-4 w-4" />
                <span>Saved Files</span>
              </TabsTrigger>
            </TabsList>

            {/* Generate Tab */}
            <TabsContent value="generate" className="mt-0 space-y-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">AI Agent Generation</h3>
              </div>
              {!githubConnected && !useManualUrl ? (
                <Card>
                  <CardContent className="px-5 py-12 sm:px-6 sm:py-14">
                    <div className="mx-auto max-w-md space-y-6 text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted">
                        <Github className="h-7 w-7 text-foreground" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">Connect GitHub for Best Experience</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Connect your GitHub account to browse repositories and get enhanced features
                        </p>
                      </div>
                      <div className="flex flex-col justify-center gap-3 sm:flex-row">
                        <Button
                          onClick={handleGitHubConnect}
                          disabled={isLoading}
                        >
                          <Github className="h-4 w-4" />
                          {isLoading ? 'Connecting...' : 'Connect GitHub'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setUseManualUrl(true)}
                        >
                          Use Manual URL
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <AgentGenerationForm
                  repoUrl={manualRepoUrl}
                  onComplete={handleProjectComplete}
                  onError={(error) => console.error('Generation failed:', error)}
                />
              )}
            </TabsContent>

            {/* Repositories Tab */}
            <TabsContent value="repositories" className="mt-0 space-y-6">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-primary" />
                      <span>Your Repositories</span>
                    </div>
                    {githubConnected && (
                      <Badge variant="outline" className="border-status-success/30 bg-status-success/[0.06] text-status-success">
                        GitHub Connected
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {githubConnected ? (
                    <div className="space-y-4">
                      {/* Search */}
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search repositories..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>

                      {/* Repository List */}
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {filteredRepos.map((repo) => (
                          <Card
                            key={repo.id}
                            className={`cursor-pointer shadow-none transition-colors duration-150 hover:border-primary/30 hover:bg-accent/30 ${
                               selectedRepo?.id === repo.id ? 'border-primary bg-primary/[0.04] ring-1 ring-primary' : ''
                            }`}
                            onClick={() => handleRepoSelect(repo)}
                          >
                            <CardContent className="p-4 sm:p-4">
                              <div className="flex h-full flex-col gap-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <h3 className="truncate font-mono text-sm font-semibold">
                                      {repo.name}
                                    </h3>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {repo.fullName}
                                    </p>
                                  </div>
                                  {repo.private && (
                                    <Badge variant="outline" className="shrink-0 text-[11px]">
                                      Private
                                    </Badge>
                                  )}
                                </div>

                                {repo.description && (
                                   <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                                    {repo.description}
                                  </p>
                                )}

                                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={getLanguageColor(repo.language)}>
                                      {repo.language}
                                    </Badge>
                                     <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Star className="h-3 w-3" />
                                      <span>{repo.stars}</span>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveTab('generate');
                                      setManualRepoUrl(repo.url);
                                    }}
                                  >
                                    <Play className="h-3 w-3" />
                                    Generate
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto max-w-md py-10 text-center">
                       <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
                         <Github className="h-6 w-6 text-muted-foreground" />
                       </div>
                       <h3 className="text-base font-semibold">No GitHub Connection</h3>
                       <p className="mt-2 text-sm text-muted-foreground">
                        Connect your GitHub account to browse repositories
                      </p>
                      <Button
                        onClick={handleGitHubConnect}
                         className="mt-5"
                      >
                        <Github className="h-4 w-4" />
                        Connect GitHub
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Projects Tab */}
            <TabsContent value="projects" className="mt-0 space-y-6">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    <span>Your Projects</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {projects.length === 0 ? (
                    <div className="mx-auto max-w-md rounded-lg border border-dashed border-border px-6 py-10 text-center">
                      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
                        <Code className="h-6 w-6 text-muted-foreground" />
                      </div>
                       <h3 className="text-base font-semibold">No Projects Yet</h3>
                       <p className="mt-2 text-sm text-muted-foreground">
                        Generate your first CI/CD configuration to get started
                      </p>
                      <Button
                        onClick={() => setActiveTab('generate')}
                        className="mt-5"
                      >
                        <Plus className="h-4 w-4" />
                        Create Project
                      </Button>
                    </div>
                  ) : (
                    <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
                      {projects.map((project) => (
                         <div key={project.id} className="bg-card p-4 transition-colors duration-150 hover:bg-muted/40">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                               <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                                 <Code className="h-5 w-5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                 <h3 className="truncate font-semibold">{project.name}</h3>
                                 <p className="truncate text-sm text-muted-foreground">{project.techStack}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  project.status === 'completed'
                                     ? 'border-status-success/30 bg-status-success/[0.06] capitalize text-status-success'
                                     : 'border-status-warning/30 bg-status-warning/10 capitalize text-status-warning'
                                }
                              >
                                {project.status === 'completed' ? (
                                  <CheckCircle className="h-3 w-3" />
                                ) : (
                                  <Clock className="h-3 w-3" />
                                )}
                                {project.status}
                              </Badge>
                              <Button size="sm" variant="outline" className="h-8 px-2.5">
                                <ExternalLink className="h-3 w-3" />
                                View
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Saved Files Tab */}
            <TabsContent value="saved" className="mt-0 space-y-6">
              <SavedFiles />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </ErrorBoundary>
  );
};
