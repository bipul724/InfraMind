import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Github,
  GitBranch,
  Zap,
  Code,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Activity,
  Plus,
  FileText,
  Loader2,
  Play,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AgentGenerationForm } from '@/components/AgentGenerationForm';
import { AgentProgress } from '@/components/AgentProgress';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SavedFiles } from '@/components/dashboard/SavedFiles';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/apiClient';
import { startAnalysis } from '@/lib/analysis';
import { UNREACHABLE_MESSAGE, describeApiError, readApiError } from '@/lib/apiError';
import { repoLabel } from '@/lib/githubUrl';
import { isStatusRegression, isUuidV4 } from '@/lib/session';
import type {
  AgentMessage,
  GenerationResult,
  ProgressPayload,
  SessionFilesResponse,
  SessionStatus,
  SessionStatusResponse,
  TechStack
} from '@/lib/session';

interface Project {
  id: string; // session id
  name: string;
  repoUrl: string;
  techStack: string;
  status: 'completed';
  createdAt: string;
}

// A session opened with /dashboard?session=<id>
interface SessionView {
  id: string;
  phase: 'loading' | 'ready' | 'error';
  status?: SessionStatus;
  repoUrl?: string;
  error?: string;
  currentStep: string;
  progress: number;
  messages?: AgentMessage[];
  errors: string[];
  techStack: TechStack | null;
  generatedFiles: string[];
  // GET /api/files for a session that was already completed when opened: passed to
  // AgentProgress, which shows its files and review without loading them again. Left
  // undefined otherwise, so AgentProgress loads it when the run completes.
  result?: SessionFilesResponse;
}

// The step and percentage the server emits when a session enters each status
// (server/server.js handleCloneRequest and runAnalysisJob); the socket snapshot, the
// per-agent events and the status poller in AgentProgress replace them
const STATUS_START: Record<SessionStatus, { step: string; progress: number }> = {
  cloning: { step: 'Cloning repository...', progress: 10 },
  cloned: { step: 'Repository cloned successfully', progress: 25 },
  analyzing: { step: 'Starting AI agent analysis...', progress: 30 },
  completed: { step: 'Analysis complete!', progress: 100 },
  failed: { step: 'Analysis failed', progress: 0 }
};

export const ModernDashboard = () => {
  const { user } = useAuth();
  const { isConnected, isLoading, connectGitHub } = useGitHub();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = searchParams.get('session');

  // State management
  const [activeTab, setActiveTab] = useState('generate');
  const [projects, setProjects] = useState<Project[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);
  const [useManualUrl, setUseManualUrl] = useState(false);
  const [sessionView, setSessionView] = useState<SessionView | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Starting a session opened while still `cloned`: the request in flight (a ref, so a
  // double click sends one request) and the outcome to show when it did not start
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startNotice, setStartNotice] = useState<{ kind: 'busy' | 'error'; message: string } | null>(null);

  // The repository connection (GitHubContext), for the empty-state card
  useEffect(() => {
    setGithubConnected(isConnected);
  }, [isConnected]);

  // Move focus to the repository URL field once the manual form appears
  useEffect(() => {
    if (useManualUrl) {
      document.getElementById('repo-url')?.focus();
    }
  }, [useManualUrl]);

  const clearSessionParam = useCallback(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('session');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // /dashboard?session=<id>: load that session's status and, once completed, its results
  useEffect(() => {
    if (!sessionParam) {
      setSessionView(null);
      return;
    }
    if (!isUuidV4(sessionParam)) {
      setSessionView(null);
      clearSessionParam();
      return;
    }
    // The server accepts session ids in lower case only (isSessionId in lib/session.ts): show
    // and load that form
    const lowerCased = sessionParam.toLowerCase();
    if (sessionParam !== lowerCased) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('session', lowerCased);
        return next;
      }, { replace: true });
      return;
    }

    const id = sessionParam;
    let cancelled = false;
    setActiveTab('generate');
    setStartNotice(null);
    setSessionView({
      id,
      phase: 'loading',
      currentStep: '',
      progress: 0,
      errors: [],
      techStack: null,
      generatedFiles: []
    });

    // A failed load: 404 closes the view; anything else shows the server's message
    // (null: the request did not reach the server) and offers Try Again
    const handleFailure = async (response: Response | null) => {
      if (response?.status === 404) {
        toast({ title: 'This analysis was not found or has expired', variant: 'destructive' });
        setSessionView(null);
        clearSessionParam();
        return;
      }
      const description = response ? describeApiError(await readApiError(response, 'Please try again.')) : UNREACHABLE_MESSAGE;
      if (cancelled) return;
      toast({ title: 'Could not load this analysis', description, variant: 'destructive' });
      setSessionView((previous) => (previous && previous.id === id ? { ...previous, phase: 'error' } : previous));
    };

    const load = async () => {
      try {
        const statusResponse = await apiFetch(`/api/status/${id}`);
        if (cancelled) return;
        if (!statusResponse.ok) {
          await handleFailure(statusResponse);
          return;
        }
        const session: SessionStatusResponse = await statusResponse.json();
        if (cancelled) return;

        const start = STATUS_START[session.status] ?? STATUS_START.cloning;
        const base: SessionView = {
          id,
          phase: 'ready',
          status: session.status,
          repoUrl: session.repoUrl,
          error: session.error,
          currentStep: start.step,
          progress: start.progress,
          errors: [],
          techStack: null,
          generatedFiles: []
        };

        if (session.status !== 'completed') {
          setSessionView(base);
          return;
        }

        const filesResponse = await apiFetch(`/api/files/${id}`);
        if (cancelled) return;
        if (!filesResponse.ok) {
          await handleFailure(filesResponse);
          return;
        }
        const result: SessionFilesResponse = await filesResponse.json();
        if (cancelled) return;
        setSessionView({
          ...base,
          techStack: result.techStack ?? null,
          generatedFiles: Object.keys(result.files ?? {}),
          result,
          ...(Array.isArray(result.messages) ? { messages: result.messages } : {}),
          ...(Array.isArray(result.errors) ? { errors: result.errors } : {})
        });
      } catch {
        if (!cancelled) await handleFailure(null);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [sessionParam, reloadKey, clearSessionParam, setSearchParams, toast]);

  // Live updates for an opened session that is still in progress: socket events, and
  // the status poller's updates when events are missed (AgentProgress)
  const handleSessionProgress = useCallback((data: ProgressPayload) => {
    setSessionView((previous) => {
      if (!previous || previous.id !== data.sessionId || !previous.status) return previous;
      const next = { ...previous };
      if (!data.status || !isStatusRegression(previous.status, data.status)) {
        if (data.status) next.status = data.status;
        if (data.step) next.currentStep = data.step;
        if (typeof data.progress === 'number') next.progress = data.progress;
      }
      if (Array.isArray(data.messages)) next.messages = data.messages;
      if (Array.isArray(data.errors)) next.errors = data.errors;
      if (data.error) next.error = data.error;
      if (data.techStack) next.techStack = data.techStack;
      if (Array.isArray(data.generatedFiles)) next.generatedFiles = data.generatedFiles;
      return next;
    });
  }, []);

  // POST /api/analyze for an opened session that is still `cloned`. On 202 the view moves
  // to analyzing, and AgentProgress (socket and poller) takes over
  const handleStartCloned = async (id: string) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartNotice(null);
    try {
      const outcome = await startAnalysis(id);
      if (outcome.kind === 'started') {
        setSessionView((previous) => (previous && previous.id === id && previous.status === 'cloned'
          ? { ...previous, status: 'analyzing', currentStep: STATUS_START.analyzing.step, progress: STATUS_START.analyzing.progress }
          : previous));
      } else {
        setStartNotice({ kind: outcome.kind, message: outcome.message });
      }
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  // connectGitHub shows its own toast when the connection cannot be started
  const handleConnectGitHub = () => void connectGitHub();

  const handleProjectComplete = useCallback((result: GenerationResult) => {
    setProjects((previous) => {
      if (previous.some((project) => project.id === result.sessionId)) return previous;
      const newProject: Project = {
        id: result.sessionId,
        name: repoLabel(result.repoUrl),
        repoUrl: result.repoUrl,
        techStack: result.techStack?.primary || 'Detected',
        status: 'completed',
        createdAt: new Date().toISOString()
      };
      return [newProject, ...previous];
    });
  }, []);

  const openSession = (id: string) => {
    setActiveTab('generate');
    setSearchParams({ session: id });
  };

  const renderSessionView = (view: SessionView) => (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Analysis Result</h3>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {view.repoUrl ? repoLabel(view.repoUrl) : `Session ${view.id.substring(0, 8)}...`}
            </p>
          </div>
          <Button onClick={clearSessionParam} className="shrink-0">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Start a New Generation
          </Button>
        </CardContent>
      </Card>

      {view.phase === 'loading' && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground" aria-busy="true">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            Loading analysis...
          </CardContent>
        </Card>
      )}

      {view.phase === 'error' && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>This analysis could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((key) => key + 1)} className="w-fit">
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Try Again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {view.phase === 'ready' && view.status === 'failed' && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">This analysis failed</p>
            <p className="mt-1 break-words">{view.error || 'No error message was stored for this session.'}</p>
          </AlertDescription>
        </Alert>
      )}

      {view.phase === 'ready' && view.status === 'cloned' && (
        <Card>
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">This repository is cloned. Its analysis has not started yet.</p>
              <Button onClick={() => void handleStartCloned(view.id)} disabled={starting} className="shrink-0">
                {starting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Play aria-hidden="true" className="h-4 w-4" />}
                Start analysis
              </Button>
            </div>
            {startNotice && (
              <Alert variant={startNotice.kind === 'error' ? 'destructive' : 'default'}>
                <AlertCircle aria-hidden="true" className="h-4 w-4" />
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{startNotice.message}</span>
                  {startNotice.kind === 'busy' && (
                    <Button size="sm" variant="outline" onClick={() => void handleStartCloned(view.id)} disabled={starting} className="w-fit shrink-0">
                      <RefreshCw aria-hidden="true" className="h-4 w-4" />
                      Retry
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {view.phase === 'ready' && view.status && view.status !== 'failed' && (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <AgentProgress
              sessionId={view.id}
              repoUrl={view.repoUrl}
              currentStep={view.currentStep}
              progress={view.progress}
              status={view.status}
              messages={view.messages}
              errors={view.errors}
              techStack={view.techStack}
              generatedFiles={view.generatedFiles}
              loadedResult={view.result}
              onProgressUpdate={handleSessionProgress}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="text-foreground">
        <div className="space-y-8">
          {/* Welcome. The GitHub status and account actions are in the layout's header. */}
          <div className="flex flex-col gap-5 border-b border-border pb-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <p className="eyebrow">AI-Powered DevOps</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[2rem] sm:leading-tight">
                Welcome back, {user?.name?.split(' ')[0]}!
              </h2>
              <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
                Generate a Dockerfile, a GitHub Actions workflow and a .env.example for a GitHub repository
              </p>
            </div>
          </div>

          {/* Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid h-auto w-full grid-cols-3 sm:inline-flex sm:h-11 sm:w-auto">
              <TabsTrigger value="generate" className="h-9 sm:h-full">
                <Zap aria-hidden="true" className="h-4 w-4" />
                <span>Generate</span>
              </TabsTrigger>
              <TabsTrigger value="projects" className="h-9 sm:h-full">
                <Activity aria-hidden="true" className="h-4 w-4" />
                <span>Projects</span>
              </TabsTrigger>
              <TabsTrigger value="saved" className="h-9 sm:h-full">
                <FileText aria-hidden="true" className="h-4 w-4" />
                <span>Saved Files</span>
              </TabsTrigger>
            </TabsList>

            {/* Generate Tab: kept mounted while another tab is shown, so a run started here
                keeps its socket and poller, and its completion still reaches Projects */}
            <TabsContent value="generate" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
              <div className="flex items-center gap-2">
                <Zap aria-hidden="true" className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">AI Agent Generation</h3>
              </div>
              {sessionView && renderSessionView(sessionView)}
              {/* The form stays mounted (hidden) while a result is open, so a run started
                  in it keeps its socket and poller and still reaches Projects;
                  "Start a New Generation" shows it again as it was */}
              <div hidden={sessionView !== null}>
              {!useManualUrl ? (
                <Card>
                  <CardContent className="px-5 py-12 sm:px-6 sm:py-14">
                    <div className="mx-auto max-w-md space-y-6 text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted">
                        <Github aria-hidden="true" className="h-7 w-7 text-foreground" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">
                          {githubConnected ? 'Choose a Repository or Enter a URL' : 'Connect GitHub or Enter a URL'}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {githubConnected
                            ? 'Your repositories, including private ones, are on the Repositories page linked in the header. A typed URL works for public repositories.'
                            : 'With GitHub connected, you can pick from your repositories, including private ones, on the Repositories page linked in the header. A typed URL works for public repositories.'}
                        </p>
                      </div>
                      <div className="flex flex-col justify-center gap-3 sm:flex-row">
                        {githubConnected ? (
                          <Button onClick={() => navigate('/select-repo')}>
                            <GitBranch aria-hidden="true" className="h-4 w-4" />
                            Choose from Your Repositories
                          </Button>
                        ) : (
                          <Button
                            onClick={handleConnectGitHub}
                            disabled={isLoading}
                          >
                            <Github aria-hidden="true" className="h-4 w-4" />
                            {isLoading ? 'Connecting...' : 'Connect GitHub'}
                          </Button>
                        )}
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
                  onComplete={handleProjectComplete}
                  onError={(error) => console.error('Generation failed:', error)}
                />
              )}
              </div>
            </TabsContent>

            {/* Projects Tab */}
            <TabsContent value="projects" className="mt-0 space-y-6">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Activity aria-hidden="true" className="h-5 w-5 text-primary" />
                    <span>Results from This Visit</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {projects.length === 0 ? (
                    <div className="mx-auto max-w-md rounded-lg border border-dashed border-border px-6 py-10 text-center">
                      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
                        <Code aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
                      </div>
                       <h3 className="text-base font-semibold">No Results Yet</h3>
                       <p className="mt-2 text-sm text-muted-foreground">
                        Generations completed on this page appear here until you leave it. To keep files, use Save to Account.
                      </p>
                      <Button
                        onClick={() => setActiveTab('generate')}
                        className="mt-5"
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        Start a Generation
                      </Button>
                    </div>
                  ) : (
                    <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
                      {projects.map((project) => (
                         <div key={project.id} className="bg-card p-4 transition-colors duration-150 hover:bg-muted/40">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                               <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                                 <Code aria-hidden="true" className="h-5 w-5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                 <h3 className="truncate font-semibold">{project.name}</h3>
                                 <p className="truncate text-sm text-muted-foreground">{project.techStack}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="border-status-success/30 bg-status-success/[0.06] capitalize text-status-success"
                              >
                                <CheckCircle aria-hidden="true" className="h-3 w-3" />
                                {project.status}
                              </Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5"
                                onClick={() => openSession(project.id)}
                                aria-label={`View the result for ${project.name}`}
                              >
                                <ExternalLink aria-hidden="true" className="h-3 w-3" />
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
