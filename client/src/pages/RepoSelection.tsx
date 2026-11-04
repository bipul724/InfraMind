import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRight, Search, GitBranch, Github, Globe, Link, Users } from 'lucide-react';
import { TechStackSelector } from '@/components/TechStackSelector';
import { RepositorySelector } from '@/components/RepositorySelector';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/apiClient';

export const RepoSelection = () => {
  const { user } = useAuth();
  const { isConnected, connectGitHub } = useGitHub();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState('');
  const [selectedRepository, setSelectedRepository] = useState<any>(null);
  const [selectedTechStack, setSelectedTechStack] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('browse');

  const validateGitHubUrl = (url: string) => {
    const githubRegex = /^https:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+\/?$/;
    return githubRegex.test(url);
  };

  const handleRepositorySelect = (repository: any) => {
    setSelectedRepository(repository);
    toast({
      title: 'Repository Selected',
      description: `Selected ${repository.fullName}`,
    });
  };

  const handleGenerateCI = async () => {
    let repositoryData = null;
    let finalRepoUrl = '';

    // Determine which repository source to use
    if (activeTab === 'browse' && selectedRepository) {
      repositoryData = selectedRepository;
      finalRepoUrl = selectedRepository.cloneUrl;
    } else if (activeTab === 'manual' && repoUrl.trim()) {
      if (!validateGitHubUrl(repoUrl.trim())) {
        toast({
          title: 'Error',
          description: 'Please enter a valid GitHub repository URL (e.g., https://github.com/username/repo).',
          variant: 'destructive',
        });
        return;
      }
      finalRepoUrl = repoUrl.trim();
    } else {
      toast({
        title: 'Error',
        description: 'Please select a repository or enter a repository URL.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Clone repository; for repositoryData the server uses this user's stored GitHub connection
      const cloneResponse = await apiFetch('/api/clone-repo', {
        method: 'POST',
        body: JSON.stringify({
          repoUrl: finalRepoUrl,
          repositoryData
        }),
      });

      if (!cloneResponse.ok) {
        throw new Error('Failed to clone repository');
      }

      const cloneData = await cloneResponse.json();
      
      // Start analysis
      const analyzeResponse = await apiFetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: cloneData.sessionId
        }),
      });

      if (!analyzeResponse.ok) {
        throw new Error('Failed to start analysis');
      }

      toast({
        title: 'Success',
        description: 'Analysis finished. Redirecting to the dashboard...',
      });

      // Redirect to dashboard with session ID
      navigate(`/dashboard?session=${cloneData.sessionId}`);
      
    } catch (error) {
      console.error('Error generating CI/CD:', error);
      toast({
        title: 'Error',
        description: 'Failed to process repository. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const exampleRepos = [
    {
      name: 'react-todo-app',
      url: 'https://github.com/example/react-todo-app',
      description: 'A modern React todo application with TypeScript',
      language: 'TypeScript',
      techStack: 'react'
    },
    {
      name: 'node-api-server',
      url: 'https://github.com/example/node-api-server',
      description: 'RESTful API server built with Node.js and Express',
      language: 'JavaScript',
      techStack: 'node'
    },
    {
      name: 'python-ml-project',
      url: 'https://github.com/example/python-ml-project',
      description: 'Machine learning project with FastAPI backend',
      language: 'Python',
      techStack: 'python'
    }
  ];

  const handleExampleSelect = (example: typeof exampleRepos[0]) => {
    setRepoUrl(example.url);
    setSelectedTechStack(example.techStack);
  };

  return (
    <div className="text-foreground">
      <div className="space-y-8">
        <div className="border-b border-border pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Repository Selection</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Pick one of your GitHub repositories, or enter a public repository URL, to generate a Dockerfile, a GitHub Actions workflow and a .env.example
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          {/* Repository Selection Tabs */}
          <Card className="min-w-0">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                Select Repository
              </CardTitle>
              <CardDescription>
                Browse your GitHub repositories or enter a manual URL for AI analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="browse">
                    <Users className="h-4 w-4" />
                    <span className="truncate">Browse Repositories</span>
                  </TabsTrigger>
                  <TabsTrigger value="manual">
                    <Link className="h-4 w-4" />
                    <span className="truncate">Manual URL</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="browse" className="mt-6">
                  <RepositorySelector
                    onRepositorySelect={handleRepositorySelect}
                    isConnected={isConnected}
                    onConnect={connectGitHub}
                  />
                  {selectedRepository && (
                    <div className="mt-4 flex flex-col gap-2 rounded-md border border-primary/25 bg-primary/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
                      <h4 className="text-sm font-medium text-primary">Selected Repository:</h4>
                      <div className="flex min-w-0 items-center gap-2">
                        <Github className="h-4 w-4 shrink-0" />
                        <span className="truncate font-mono text-sm">{selectedRepository.fullName}</span>
                        {selectedRepository.private && (
                           <span className="shrink-0 rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-xs font-medium text-status-warning">Private</span>
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="manual" className="mt-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="repo-url" className="text-sm font-medium text-foreground">
                        Repository URL
                      </label>
                      <Input
                        id="repo-url"
                        type="url"
                        placeholder="https://github.com/username/repository"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        className="w-full font-mono text-[13px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        Example: <span className="font-mono">https://github.com/facebook/react</span>
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="mt-6 border-t border-border pt-6">
                <Button
                  onClick={handleGenerateCI}
                  disabled={loading || (activeTab === 'browse' && !selectedRepository) || (activeTab === 'manual' && !repoUrl.trim())}
                  className="w-full"
                  size="lg"
                >
                  {loading ? (
                    <>
                       <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"></div>
                      Processing Repository...
                    </>
                  ) : (
                    <>
                      Start AI Analysis
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {/* Example Repositories */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Sample URLs</CardTitle>
                <CardDescription>
                  Placeholder entries. Use This only fills in the Manual URL field; the repositories are not checked to exist.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2">
                  {exampleRepos.map((example, index) => (
                    <div
                      key={index}
                      className="group flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border bg-card p-3 transition-colors duration-150 hover:border-primary/30 hover:bg-accent/50"
                      onClick={() => handleExampleSelect(example)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                           <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                           <span className="truncate font-mono text-[13px] font-medium">{example.name}</span>
                           <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {example.language}
                          </span>
                        </div>
                         <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{example.description}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2.5 text-primary group-hover:bg-card">
                        Use This
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* GitHub Connection Notice */}
            <div className="rounded-lg border border-primary/20 bg-primary/[0.05] p-5">
              <div className="flex items-start gap-3">
                 <Globe className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                   <h3 className="text-sm font-semibold text-primary">Repository Access</h3>
                   <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Browse Repositories uses your connected GitHub account, so private repositories you can
                    access work there. Manual URL sends no GitHub credentials and works for public repositories only.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
