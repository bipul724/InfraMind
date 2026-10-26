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

  // GitHub connection status - use context values
  const githubUsername = githubUser?.login;

  useEffect(() => {
    setGithubConnected(isConnected);
    if (isConnected) {
      loadRepositories();
    }
  }, [isConnected]);

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
      <div className="min-h-screen bg-background text-foreground">
        {/* Modern Header */}
        <header className="sticky top-0 z-40 border-b border-border bg-background">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Logo */}
              <div className="flex items-center space-x-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Rocket className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">InfraMind</h1>
                  <p className="text-xs text-muted-foreground">AI-Powered DevOps</p>
                </div>
              </div>

              {/* User Menu */}
              <div className="flex items-center space-x-4">
                {githubConnected && githubUsername && (
                  <div className="flex items-center space-x-2 rounded-full border border-status-success/30 bg-status-success/10 px-3 py-1">
                    <Github className="h-4 w-4 text-status-success" />
                    <span className="text-sm font-medium text-status-success">@{githubUsername}</span>
                  </div>
                )}
                
                <div className="flex items-center space-x-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user?.prefs?.avatarUrl} />
                    <AvatarFallback>{user?.name?.[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="space-y-8">
            {/* Welcome Section */}
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-semibold tracking-tight">
                Welcome back, {user?.name?.split(' ')[0]}!
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Generate production-ready CI/CD configurations with our AI-powered agents
              </p>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
              <TabsList className="mx-auto grid w-full max-w-xl grid-cols-2 md:grid-cols-4">
                <TabsTrigger value="generate" className="flex items-center space-x-2">
                  <Zap className="h-4 w-4" />
                  <span>Generate</span>
                </TabsTrigger>
                <TabsTrigger value="repositories" className="flex items-center space-x-2">
                  <GitBranch className="h-4 w-4" />
                  <span>Repositories</span>
                </TabsTrigger>
                <TabsTrigger value="projects" className="flex items-center space-x-2">
                  <Activity className="h-4 w-4" />
                  <span>Projects</span>
                </TabsTrigger>
                <TabsTrigger value="saved" className="flex items-center space-x-2">
                  <FileText className="h-4 w-4" />
                  <span>Saved Files</span>
                </TabsTrigger>
              </TabsList>

              {/* Generate Tab */}
              <TabsContent value="generate" className="space-y-6">
                  <Card className="mx-auto max-w-4xl border-border bg-card">
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Zap className="h-5 w-5 text-primary" />
                      <span>AI Agent Generation</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!githubConnected ? (
                      <div className="text-center space-y-6 py-8">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                          <Github className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold">Connect GitHub for Best Experience</h3>
                          <p className="mt-2 text-muted-foreground">
                            Connect your GitHub account to browse repositories and get enhanced features
                          </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                          <Button
                            onClick={handleGitHubConnect}
                            disabled={isLoading}
                            className=""
                          >
                            <Github className="h-4 w-4 mr-2" />
                            {isLoading ? 'Connecting...' : 'Connect GitHub'}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setActiveTab('generate')}
                          >
                            Use Manual URL
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <AgentGenerationForm
                        repoUrl={manualRepoUrl}
                        onComplete={handleProjectComplete}
                        onError={(error) => console.error('Generation failed:', error)}
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Repositories Tab */}
              <TabsContent value="repositories" className="space-y-6">
                  <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <GitBranch className="h-5 w-5 text-primary" />
                        <span>Your Repositories</span>
                      </div>
                      {githubConnected && (
                          <Badge variant="secondary" className="border border-status-success/30 bg-status-success/10 text-status-success">
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
                          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search repositories..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                          />
                        </div>

                        {/* Repository List */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {filteredRepos.map((repo) => (
                            <Card
                              key={repo.id}
                              className={`cursor-pointer transition-all hover:shadow-md ${
                                 selectedRepo?.id === repo.id ? 'ring-2 ring-primary' : ''
                              }`}
                              onClick={() => handleRepoSelect(repo)}
                            >
                              <CardContent className="p-4">
                                <div className="space-y-3">
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <h3 className="truncate font-semibold">
                                        {repo.name}
                                      </h3>
                                      <p className="truncate text-sm text-muted-foreground">
                                        {repo.fullName}
                                      </p>
                                    </div>
                                    {repo.private && (
                                      <Badge variant="outline" className="text-xs">
                                        Private
                                      </Badge>
                                    )}
                                  </div>
                                  
                                  {repo.description && (
                                     <p className="line-clamp-2 text-sm text-muted-foreground">
                                      {repo.description}
                                    </p>
                                  )}
                                  
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                      <Badge className={getLanguageColor(repo.language)}>
                                        {repo.language}
                                      </Badge>
                                       <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                                        <Star className="h-3 w-3" />
                                        <span>{repo.stars}</span>
                                      </div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveTab('generate');
                                        setManualRepoUrl(repo.url);
                                      }}
                                    >
                                      <Play className="h-3 w-3 mr-1" />
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
                      <div className="text-center py-8">
                         <Github className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                         <h3 className="text-lg font-semibold">No GitHub Connection</h3>
                         <p className="mt-2 text-muted-foreground">
                          Connect your GitHub account to browse repositories
                        </p>
                        <Button
                          onClick={handleGitHubConnect}
                           className="mt-4"
                        >
                          <Github className="h-4 w-4 mr-2" />
                          Connect GitHub
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Projects Tab */}
              <TabsContent value="projects" className="space-y-6">
                  <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Activity className="h-5 w-5 text-primary" />
                      <span>Your Projects</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {projects.length === 0 ? (
                      <div className="text-center py-8">
                        <Code className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                         <h3 className="text-lg font-semibold">No Projects Yet</h3>
                         <p className="mt-2 text-muted-foreground">
                          Generate your first CI/CD configuration to get started
                        </p>
                        <Button
                          onClick={() => setActiveTab('generate')}
                          className="mt-4"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Create Project
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {projects.map((project) => (
                           <Card key={project.id} className="border-border bg-card p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                 <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                                   <Code className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                   <h3 className="font-semibold">{project.name}</h3>
                                   <p className="text-sm text-muted-foreground">{project.techStack}</p>
                                </div>
                              </div>
                              <div className="flex items-center space-x-3">
                                <Badge
                                  variant={project.status === 'completed' ? 'default' : 'secondary'}
                                  className={
                                    project.status === 'completed'
                                       ? 'border border-status-success/30 bg-status-success/10 text-status-success'
                                       : 'border border-status-warning/30 bg-status-warning/10 text-status-warning'
                                  }
                                >
                                  {project.status === 'completed' ? (
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                  ) : (
                                    <Clock className="h-3 w-3 mr-1" />
                                  )}
                                  {project.status}
                                </Badge>
                                <Button size="sm" variant="outline">
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  View
                                </Button>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Saved Files Tab */}
              <TabsContent value="saved" className="space-y-6">
                <div className="max-w-4xl mx-auto">
                  <SavedFiles />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
};
