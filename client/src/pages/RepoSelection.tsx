import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRight, Github, Globe, Link, Users } from 'lucide-react';
import { RepositorySelector } from '@/components/RepositorySelector';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/apiClient';
import { startAnalysis } from '@/lib/analysis';
import { GITHUB_RECONNECT_CODES, UNREACHABLE_MESSAGE, describeApiError, readApiError } from '@/lib/apiError';
import { INVALID_REPO_URL_MESSAGE, canonicalRepoUrl, parseGitHubRepoUrl } from '@/lib/githubUrl';
import { isSessionId } from '@/lib/session';

// The repository object RepositorySelector passes to onRepositorySelect
type SelectedRepository = Parameters<React.ComponentProps<typeof RepositorySelector>['onRepositorySelect']>[0];

export const RepoSelection = () => {
  const { user } = useAuth();
  const { isConnected, connectGitHub } = useGitHub();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState('');
  const [selectedRepository, setSelectedRepository] = useState<SelectedRepository | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('browse');
  // A session that was cloned but got 503 ANALYSIS_BUSY: starting the same repository
  // again retries its analysis without cloning again
  const [pendingSession, setPendingSession] = useState<{ source: string; sessionId: string } | null>(null);

  const handleRepositorySelect = (repository: SelectedRepository) => {
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
      // The server's own rules; the canonical form is what is sent
      const parsed = parseGitHubRepoUrl(repoUrl);
      if (!parsed) {
        toast({ title: 'Invalid repository URL', description: INVALID_REPO_URL_MESSAGE, variant: 'destructive' });
        return;
      }
      finalRepoUrl = canonicalRepoUrl(parsed);
    } else {
      toast({
        title: 'Error',
        description: 'Please select a repository or enter a repository URL.',
        variant: 'destructive',
      });
      return;
    }

    const source = repositoryData ? `repo:${repositoryData.fullName}` : `url:${finalRepoUrl}`;
    // A failure shown with the server's text; a GitHub sign-in problem in the Browse flow
    // also offers to reconnect GitHub
    const showFailure = (description: string, code: string | null = null) => {
      const reconnect = repositoryData && code && GITHUB_RECONNECT_CODES.has(code);
      toast({
        title: 'Could not start the analysis',
        description,
        variant: 'destructive',
        ...(reconnect ? { action: <ToastAction altText="Reconnect GitHub" onClick={() => void connectGitHub()}>Reconnect GitHub</ToastAction> } : {})
      });
    };

    setLoading(true);
    try {
      let sessionId: string;
      if (pendingSession && pendingSession.source === source) {
        // Retry after ANALYSIS_BUSY: the repository is already cloned
        sessionId = pendingSession.sessionId;
      } else {
        // Clone repository; for repositoryData the server uses this user's stored GitHub connection
        let cloneResponse: Response;
        try {
          cloneResponse = await apiFetch('/api/clone-repo', {
            method: 'POST',
            body: JSON.stringify({
              repoUrl: finalRepoUrl,
              repositoryData
            }),
          });
        } catch {
          showFailure(UNREACHABLE_MESSAGE);
          return;
        }

        if (!cloneResponse.ok) {
          const error = await readApiError(cloneResponse, 'The repository could not be cloned. Please try again.');
          showFailure(describeApiError(error), error.code);
          return;
        }

        const cloneData = await cloneResponse.json().catch(() => null);
        if (!isSessionId(cloneData?.sessionId)) {
          showFailure('The server sent an unexpected answer. Please try again.');
          return;
        }
        sessionId = cloneData.sessionId;
      }

      // Start the analysis. The server answers 202 at once and runs it in the background;
      // the dashboard shows its progress live.
      const outcome = await startAnalysis(sessionId);
      if (outcome.kind === 'busy') {
        setPendingSession({ source, sessionId });
        toast({
          title: 'Analysis service busy',
          description: `${outcome.message} The repository is cloned: select Start AI Analysis again to retry without cloning it again.`,
          variant: 'destructive',
        });
        return;
      }
      if (outcome.kind === 'error') {
        setPendingSession(null);
        showFailure(outcome.message);
        return;
      }

      setPendingSession(null);
      toast({
        title: 'Analysis started',
        description: 'Opening the dashboard, where the progress is shown live.',
      });

      // Redirect to dashboard with session ID
      navigate(`/dashboard?session=${sessionId}`);
      
    } catch (error) {
      console.error('Error starting the analysis:', error);
      showFailure('Something went wrong in the browser. Please try again.');
    } finally {
      setLoading(false);
    }
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
                        Example: <span className="font-mono">https://github.com/octocat/Hello-World</span>
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
