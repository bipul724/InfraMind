import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { apiFetch } from '@/lib/apiClient';
import {
  Bot,
  GitBranch,
  AlertTriangle,
  Info,
  Zap,
  Play,
  AlertCircle,
  CheckCircle,
  Github,
  Loader2
} from 'lucide-react';
import { AgentProgress } from './AgentProgress';
import type {
  AgentMessage,
  GenerationResult,
  ProgressPayload,
  SessionStatus,
  TechStack
} from '@/lib/session';
import { isStatusRegression } from '@/lib/session';

interface AgentGenerationFormProps {
  repoUrl?: string;
  onComplete?: (result: GenerationResult) => void;
  onError?: (error: string) => void;
  className?: string;
}

// Response bodies of POST /api/clone-repo and POST /api/analyze (server/server.js)
interface CloneResponse {
  success?: boolean;
  sessionId?: string;
  error?: string;
}

interface AnalyzeResponse {
  success?: boolean;
  techStack?: TechStack | null;
  generatedFiles?: string[];
  messages?: AgentMessage[];
  errors?: string[];
  error?: string;
}

// The manual-URL path sends only the URL: no GitHub credential leaves the browser.
// Private repositories go through the connected-GitHub path (/select-repo).
async function cloneRepository(repoUrl: string): Promise<CloneResponse> {
  const response = await apiFetch('/api/clone-repo', {
    method: 'POST',
    body: JSON.stringify({ repoUrl })
  });
  return response.json();
}

async function runAnalysis(sessionId: string): Promise<AnalyzeResponse> {
  const response = await apiFetch('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  });
  return response.json();
}

const validateGitHubUrl = (url: string) => {
  const githubUrlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/;
  return githubUrlPattern.test(url);
};

export const AgentGenerationForm: React.FC<AgentGenerationFormProps> = ({
  repoUrl: initialRepoUrl = '',
  onComplete,
  onError,
  className
}) => {
  // Form state
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [activeTab, setActiveTab] = useState('setup');

  // Agent workflow state
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState('');
  const [currentStep, setCurrentStep] = useState('Ready to analyze');
  const [progress, setProgress] = useState(0);
  const [status, setStatusState] = useState<SessionStatus>('cloned');
  // Mirrors `status` synchronously, so a late progress event can be compared with it
  const statusRef = useRef<SessionStatus>('cloned');
  const setStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  // undefined until the pipeline's result event arrives (see AgentProgress)
  const [messages, setMessages] = useState<AgentMessage[] | undefined>(undefined);
  const [errors, setErrors] = useState<string[]>([]);
  const [techStack, setTechStack] = useState<TechStack | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);

  // Form validation
  const [urlError, setUrlError] = useState<string | null>(null);
  const isValidUrl = repoUrl && validateGitHubUrl(repoUrl);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setRepoUrl(url);

    if (url && !validateGitHubUrl(url)) {
      setUrlError('Please enter a valid GitHub repository URL (e.g., https://github.com/user/repo)');
    } else {
      setUrlError(null);
    }
  };

  // Stable, so the progress socket is not re-created on every render. Status, step and
  // progress never move backwards; messages, errors and results are always taken.
  const handleProgressUpdate = useCallback((data: ProgressPayload) => {
    if (!data.status || !isStatusRegression(statusRef.current, data.status)) {
      if (data.status) setStatus(data.status);
      if (data.step) setCurrentStep(data.step);
      if (typeof data.progress === 'number') setProgress(data.progress);
    }
    if (Array.isArray(data.messages)) setMessages(data.messages);
    if (Array.isArray(data.errors)) setErrors(data.errors);
    if (data.error) {
      const message = data.error;
      setErrors((previous) => (previous.includes(message) ? previous : [...previous, message]));
    }
    if (data.techStack) setTechStack(data.techStack);
    if (Array.isArray(data.generatedFiles)) setGeneratedFiles(data.generatedFiles);
  }, [setStatus]);

  const handleStartAnalysis = async () => {
    if (!isValidUrl) {
      setUrlError('Please enter a valid GitHub repository URL');
      return;
    }

    const url = repoUrl;
    setIsRunning(true);
    setActiveTab('progress');
    setAnalyzedUrl(url);
    setSessionId(null);
    setCurrentStep('Cloning repository...');
    setProgress(0);
    setStatus('cloning');
    setMessages(undefined);
    setErrors([]);
    setTechStack(null);
    setGeneratedFiles([]);

    try {
      // Step 1: Clone repository
      const cloneResult = await cloneRepository(url);
      if (!cloneResult.success || !cloneResult.sessionId) {
        throw new Error(cloneResult.error || 'Failed to clone repository');
      }

      // The progress panel subscribes to this session once the id is known
      setSessionId(cloneResult.sessionId);
      setCurrentStep('Repository cloned successfully');
      setProgress(25);
      setStatus('cloned');

      // Step 2: Run the agents. The server answers once the analysis has finished.
      setCurrentStep('Starting AI agent analysis...');
      setProgress(30);
      setStatus('analyzing');

      const analysisResult = await runAnalysis(cloneResult.sessionId);
      if (!analysisResult.success) {
        throw new Error(analysisResult.error || 'Analysis failed');
      }

      setCurrentStep('Analysis complete!');
      setProgress(100);
      setStatus('completed');
      setTechStack(analysisResult.techStack ?? null);
      setGeneratedFiles(Array.isArray(analysisResult.generatedFiles) ? analysisResult.generatedFiles : []);
      // The same per-agent results the progress events carry, for a client that missed them
      if (Array.isArray(analysisResult.messages)) setMessages(analysisResult.messages);
      if (Array.isArray(analysisResult.errors)) setErrors(analysisResult.errors);
    } catch (error) {
      console.error('Agent workflow error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      setStatus('failed');
      setErrors([message]);
      setCurrentStep('Analysis failed');
      setProgress(0);
      onError?.(message);
    } finally {
      setIsRunning(false);
    }
  };

  // Report each completed session to the page exactly once
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });
  const reportedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'completed' || !sessionId || reportedSessionRef.current === sessionId) return;
    reportedSessionRef.current = sessionId;
    onCompleteRef.current?.({ sessionId, repoUrl: analyzedUrl, techStack, generatedFiles });
  }, [status, sessionId, analyzedUrl, techStack, generatedFiles]);

  return (
    <div className={`space-y-6 ${className}`}>
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border pb-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/[0.07]">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span>AI Agent DevOps Generator</span>
                <Badge variant="secondary" className="font-normal">
                  Multi-Agent System
                </Badge>
              </CardTitle>
              <CardDescription>
                Enter a public GitHub repository URL. The agents analyze it and generate a Dockerfile, a GitHub Actions workflow and a .env.example.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-5 sm:pt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:min-w-[22rem]">
              <TabsTrigger value="setup">Repository Setup</TabsTrigger>
              <TabsTrigger value="progress">Analysis Progress</TabsTrigger>
            </TabsList>

            <TabsContent value="setup" className="mt-6 space-y-4">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="repo-url" className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span>GitHub Repository URL</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="repo-url"
                      placeholder="https://github.com/username/repository"
                      value={repoUrl}
                      onChange={handleUrlChange}
                      disabled={isRunning}
                      aria-invalid={urlError ? true : undefined}
                      className={`h-11 font-mono text-[13px] ${
                        urlError
                          ? 'border-status-error/60 pr-10'
                          : isValidUrl
                            ? 'border-status-success/50 pr-10'
                            : ''
                      }`}
                    />
                    {isValidUrl && (
                      <CheckCircle className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-status-success" />
                    )}
                    {urlError && (
                      <AlertCircle className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-status-error" />
                    )}
                  </div>
                  {urlError && (
                    <Alert variant="destructive" className="mt-2">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{urlError}</AlertDescription>
                    </Alert>
                  )}
                  {isValidUrl && (
                    <Alert className="mt-2 border-status-success/25 bg-status-success/[0.06]">
                       <CheckCircle className="h-4 w-4 text-status-success" />
                       <AlertDescription className="text-status-success">
                        The URL has the format of a GitHub repository
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <Alert className="bg-card">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <AlertDescription className="text-sm text-muted-foreground">
                    A typed URL is cloned without GitHub credentials, so it works for public repositories.
                    For a private repository, connect GitHub and choose it on the Repositories page linked in the header.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                      <Zap className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">Four Agents</h3>
                      <p className="text-sm text-muted-foreground">
                        Planner, analyzer, generator and verifier, in sequence
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                      <Github className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">Three Files</h3>
                      <p className="text-sm text-muted-foreground">
                        Dockerfile, GitHub Actions workflow, .env.example
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-t border-border pt-6">
                  <Button
                    onClick={handleStartAnalysis}
                    disabled={!isValidUrl || isRunning}
                    className="w-full"
                    size="lg"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Running Analysis...
                      </>
                    ) : (
                      <>
                        <Play className="h-5 w-5" />
                        Start AI Analysis
                      </>
                    )}
                  </Button>

                  {!isValidUrl && repoUrl && (
                    <p className="text-center text-sm text-muted-foreground">
                      Please enter a valid GitHub repository URL to continue
                    </p>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="progress" className="mt-6 space-y-4">
              <AgentProgress
                sessionId={sessionId}
                repoUrl={analyzedUrl}
                currentStep={currentStep}
                progress={progress}
                status={status}
                messages={messages}
                errors={errors}
                techStack={techStack}
                generatedFiles={generatedFiles}
                onProgressUpdate={handleProgressUpdate}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
