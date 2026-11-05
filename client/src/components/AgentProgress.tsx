import React, { useState, useEffect, useReducer, useRef } from 'react';
import { CardDescription, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
  Bot,
  Search,
  Cog,
  Shield,
  Loader2,
  Save,
  FileCode,
  ClipboardCheck,
  RefreshCw
} from 'lucide-react';
import { io } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { API_BASE_URL, SavedFilesAPI } from '@/lib/api';
import { getAccessToken } from '@/lib/supabase';
import { useSessionPoller } from '@/hooks/use-session-poller';
import type { GoneReason } from '@/hooks/use-session-poller';
import { GeneratedFilesView } from '@/components/GeneratedFilesView';
import {
  currentGeneration,
  finishSaving,
  getCachedResult,
  isSaved,
  isSaving,
  loadResult,
  markSaving,
  storeResult
} from '@/lib/resultCache';
import type { PollUpdate } from '@/hooks/use-session-poller';
import type { AgentMessage, ProgressPayload, SessionFilesResponse, SessionStatus, TechStack } from '@/lib/session';

interface AgentProgressProps {
  sessionId?: string | null;
  repoUrl?: string;
  currentStep: string;
  progress: number;
  status: SessionStatus;
  // undefined until the first per-agent event (after the analyzer) arrives; then the
  // messages of the agents that have finished so far
  messages?: AgentMessage[];
  errors?: string[];
  techStack?: TechStack | null;
  generatedFiles?: string[];
  // GET /api/files/:sessionId for this session when the parent has already loaded it (the
  // ?session= view of a completed analysis); otherwise it is loaded here once the run
  // completes. It carries the file contents and the verifier's review.
  loadedResult?: SessionFilesResponse;
  // Progress events from the socket, and from the status poller when events are missed
  onProgressUpdate?: (data: ProgressPayload) => void;
}

// agent: the `agent` value of the agent's entry in state.messages; errorPrefix: the start
// of the string the agent adds to state.errors on failure (server/agents/index.js).
// Sessions stored before B2.6 may also hold a planner message or a "Planner Agent Error:"
// entry: no card matches them, so they only appear in the message list.
const WORKFLOW_STEPS = [
  {
    id: 'analyze',
    agent: 'analyzer',
    errorPrefix: 'Analyzer Agent Error:',
    title: 'Analyzer Agent',
    description: 'Scans the cloned files and detects the tech stack',
    icon: Search,
    aiUsage: 'none'
  },
  {
    id: 'generate',
    agent: 'generator',
    errorPrefix: 'Generator Agent Error:',
    title: 'Generator Agent',
    description: 'Generates the Dockerfile, workflow and .env.example',
    icon: Cog,
    // One call per file, plus one repair call for a file whose output fails its check
    aiUsage: 'generator, 3 to 6 calls'
  },
  {
    id: 'verify',
    agent: 'verifier',
    errorPrefix: 'Verifier Agent Error:',
    title: 'Verifier Agent',
    description: 'Asks the AI to review the generated files',
    icon: Shield,
    aiUsage: 'verifier, 1 call, none without files'
  }
];

type StepState = 'waiting' | 'in-sequence' | 'running' | 'done' | 'partial' | 'failed' | 'not-run' | 'unknown';

const STEP_LABELS: Record<StepState, string> = {
  waiting: 'Waiting',
  // Analyzing, before the first agent has reported: no per-agent claim yet
  'in-sequence': 'In sequence',
  running: 'Running',
  done: 'Done',
  partial: 'Partial',
  failed: 'Failed',
  'not-run': 'Not run',
  unknown: 'No details'
};

// Agent output keys -> saved-file name and type, and the name shown on the badges (the
// download name: a browser does not accept a path in one, so the workflow is ci.yml)
const FILE_META: Record<string, { name: string; type: string; downloadName: string }> = {
  dockerfile: { name: 'Dockerfile', type: 'dockerfile', downloadName: 'Dockerfile' },
  githubActions: { name: '.github/workflows/ci.yml', type: 'github-actions', downloadName: 'ci.yml' },
  envExample: { name: '.env.example', type: 'env', downloadName: '.env.example' },
};

// Clone URLs never carry credentials: server/utils/git.js passes a token to git as an
// HTTP header, and the URL shown here is the one the user typed or the server's display
// URL. This only drops a user:password@ part, should a URL ever contain one, before it
// is stored in saved_files.
const stripCredentials = (url?: string): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url.includes('@') ? undefined : url;
  }
};

export const AgentProgress: React.FC<AgentProgressProps> = ({
  sessionId,
  repoUrl,
  currentStep,
  progress,
  status,
  messages,
  errors = [],
  techStack,
  generatedFiles = [],
  loadedResult,
  onProgressUpdate
}) => {
  const [showDetails, setShowDetails] = useState(false);
  // Re-renders after the result cache (lib/resultCache.ts) changes
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  // The session whose files could not be loaded; cleared by "Try again"
  const [resultErrorFor, setResultErrorFor] = useState<string | null>(null);
  const [, setSaving] = useState(false);
  // The session whose status polling gave up after 30 minutes
  const [pollGaveUpFor, setPollGaveUpFor] = useState<string | null>(null);
  // The poller saw a 404 or 401 for this session: it stopped, and the reason is shown
  const [goneFor, setGoneFor] = useState<{ id: string; reason: GoneReason } | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  // The socket lives as long as the session id; the latest callback is read from a ref,
  // so a parent re-render does not reconnect
  const onProgressUpdateRef = useRef(onProgressUpdate);
  useEffect(() => {
    onProgressUpdateRef.current = onProgressUpdate;
  });

  useEffect(() => {
    if (!sessionId) return;

    // The auth callback runs on every (re)connect, so refreshed tokens are picked up.
    // forceNew: socket.io-client otherwise keeps the first Manager for a URL in a
    // module-level cache for the life of the page, and with it this callback and the
    // component state its closure reaches (a previous user's files after sign-out). Later
    // mounts already got a new Manager, so this only stops the first one being cached.
    const socket = io(API_BASE_URL, {
      forceNew: true,
      auth: (cb) => {
        getAccessToken().then((token) => cb({ token: token ?? '' }));
      }
    });

    socket.on('connect', () => {
      // Progress is delivered only to sockets subscribed to a session they own. The server
      // answers a new subscription with the latest stored progress event.
      socket.emit('subscribe', { sessionId }, (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok) {
          console.warn('Could not subscribe to session progress:', ack?.error);
        }
      });
    });

    socket.on('disconnect', (reason) => {
      // The server disconnects sockets whose access token expired; Socket.IO does not
      // reconnect those on its own. Reconnecting runs the auth callback, which
      // supplies a refreshed token.
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('progress', (data: ProgressPayload) => {
      if (data?.sessionId === sessionId) {
        onProgressUpdateRef.current?.(data);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId]);

  // The result-cache generation this session was opened in: when the signed-in user
  // changes, the cache is cleared and a session opened before that never writes into it
  const sessionGenerationRef = useRef(currentGeneration());
  useEffect(() => {
    sessionGenerationRef.current = currentGeneration();
  }, [sessionId]);

  // Backstop for missed socket events (B2.1): poll GET /api/status/:id while the session
  // is in flight. On "completed" the poller loads GET /api/files once; that response is
  // kept here, so it is not requested again.
  useSessionPoller({
    sessionId,
    active: Boolean(sessionId) && (status === 'cloning' || status === 'analyzing'),
    onUpdate: ({ payload, files }: PollUpdate) => {
      if (files && sessionId && storeResult(sessionId, files, sessionGenerationRef.current)) {
        refresh();
      }
      onProgressUpdateRef.current?.(payload);
    },
    onGiveUp: () => setPollGaveUpFor(sessionId ?? null),
    onGone: (reason) => {
      if (sessionId) setGoneFor({ id: sessionId, reason });
    }
  });

  // Neither the socket's completed event nor the status carries file contents or the
  // review: once the run has completed, load GET /api/files/:sessionId, unless the parent
  // or the poller already did. A load already in flight (from an earlier mount) is joined,
  // not repeated.
  const cachedResult = sessionId ? getCachedResult(sessionId) : undefined;
  useEffect(() => {
    if (!sessionId || status !== 'completed' || loadedResult || cachedResult) return;
    if (resultErrorFor === sessionId) return;
    const id = sessionId;
    let active = true;
    loadResult(id).then(
      () => {
        if (active) refresh();
      },
      (error) => {
        console.warn(`The generated files of session ${id} could not be loaded:`, error);
        if (active) setResultErrorFor(id);
      }
    );
    return () => {
      active = false;
    };
  }, [sessionId, status, loadedResult, cachedResult, resultErrorFor]);

  const result = status === 'completed' ? loadedResult ?? cachedResult : undefined;
  const resultFiles = result?.files && Object.keys(result.files).length > 0 ? result.files : null;
  const resultFailed = status === 'completed' && !result && resultErrorFor !== null && resultErrorFor === sessionId;
  const reviewText = result?.verificationResults;
  const review = typeof reviewText === 'string' && reviewText.trim() !== '' ? reviewText : null;
  const saved = Boolean(sessionId && isSaved(sessionId));
  const saving = Boolean(sessionId && isSaving(sessionId));

  // Driven only by what the server reports. The server sends an event as each agent
  // finishes (B2.1), carrying the messages and errors so far. An agent with both a message
  // and an error (e.g. 2 of 3 files generated) is Partial; an error only is Failed; a
  // message only is Done. While analyzing, the first agent with neither is Running and
  // the ones after it are Waiting; once the run has ended, an agent with neither did not
  // run. Before the first agent's event, the cards make no per-agent claim.
  const hasAgentReport = Array.isArray(messages);
  const reportOf = (step: typeof WORKFLOW_STEPS[number]) => ({
    failed: errors.some((error) => error.startsWith(step.errorPrefix)),
    finished: (messages ?? []).some((message) => message.agent === step.agent)
  });
  const firstPendingIndex = WORKFLOW_STEPS.findIndex((step) => {
    const report = reportOf(step);
    return !report.failed && !report.finished;
  });
  const getStepState = (step: typeof WORKFLOW_STEPS[number], index: number): StepState => {
    if (hasAgentReport) {
      const { failed, finished } = reportOf(step);
      if (failed && finished) return 'partial';
      if (failed) return 'failed';
      if (finished) return 'done';
      if (status === 'analyzing') return index === firstPendingIndex ? 'running' : 'waiting';
      return 'not-run';
    }
    if (status === 'cloning' || status === 'cloned') return 'waiting';
    if (status === 'analyzing') return 'in-sequence';
    if (status === 'completed') return 'unknown';
    return 'not-run';
  };

  const getStatusIcon = (stepState: StepState) => {
    switch (stepState) {
      case 'done':
        return <CheckCircle aria-hidden="true" className="h-4 w-4 text-status-success" />;
      case 'running':
      case 'in-sequence':
        return <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-status-running" />;
      case 'partial':
        return <AlertTriangle aria-hidden="true" className="h-4 w-4 text-status-warning" />;
      case 'failed':
        return <AlertCircle aria-hidden="true" className="h-4 w-4 text-status-error" />;
      default:
        return <Clock aria-hidden="true" className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStepColor = (stepState: StepState) => {
    switch (stepState) {
      case 'done':
        return 'border-status-success/25 bg-card';
      case 'running':
      case 'in-sequence':
        return 'border-primary/30 bg-primary/[0.03]';
      case 'partial':
        return 'border-status-warning/30 bg-status-warning/[0.05]';
      case 'failed':
        return 'border-status-error/30 bg-status-error/[0.05]';
      default:
        return 'border-border bg-muted/40';
    }
  };

  const getBadgeColor = (stepState: StepState) => {
    switch (stepState) {
      case 'done':
        return 'border-status-success/30 bg-status-success/[0.06] text-status-success';
      case 'running':
      case 'in-sequence':
        return 'border-primary/30 bg-primary/[0.06] text-primary';
      case 'partial':
        return 'border-status-warning/30 bg-status-warning/[0.06] text-status-warning';
      case 'failed':
        return 'border-status-error/30 bg-status-error/[0.06] text-status-error';
      default:
        return 'text-muted-foreground';
    }
  };

  // Every non-empty file in one insert, once per session
  const handleSaveFiles = async () => {
    if (!sessionId || !resultFiles || saved || saving) return;
    if (!user?.id) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to save files.',
        variant: 'destructive'
      });
      return;
    }

    const id = sessionId;
    const startedIn = currentGeneration();
    let succeeded = false;
    markSaving(id);
    setSaving(true);
    try {
      const requests = Object.entries(resultFiles)
        .filter(([, content]) => typeof content === 'string' && content.trim() !== '')
        .map(([key, content]) => ({
          userId: user.id,
          content,
          name: FILE_META[key]?.name || key,
          type: FILE_META[key]?.type || key,
          repoUrl: stripCredentials(repoUrl),
        }));

      if (requests.length === 0) {
        throw new Error('No generated files to save');
      }

      await SavedFilesAPI.saveFiles(requests);
      succeeded = true;
      toast({
        title: 'Files saved',
        description: `${requests.length} file${requests.length === 1 ? '' : 's'} saved to your account. They are listed under Saved Files.`,
      });
    } catch (error) {
      console.error('Save error:', error);
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save files',
        variant: 'destructive'
      });
    } finally {
      finishSaving(id, succeeded, startedIn);
      setSaving(false);
      refresh();
    }
  };

  const displayMessages = messages ?? [];
  const noFilesGenerated = status === 'completed' && generatedFiles.length === 0;
  const showSharedRunning = !hasAgentReport && status === 'analyzing';
  const showNoDetails = !hasAgentReport && status === 'completed';

  return (
    <section className="w-full space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Bot aria-hidden="true" className="h-5 w-5 text-primary" />
            <span>AI DevOps Agent Pipeline</span>
            {sessionId && (
              <Badge variant="outline" className="font-mono text-[11px] font-normal text-muted-foreground">
                Session: {sessionId.substring(0, 8)}...
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Progress arrives after the clone, when the analysis starts and as each of the three agents finishes
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDetails(!showDetails)}
          aria-expanded={showDetails}
          className="shrink-0 self-start"
        >
          {showDetails ? 'Hide Details' : 'Show Details'}
        </Button>
      </div>

      <div className="space-y-6">
        {/* Progress Bar */}
        <div className="space-y-2.5 rounded-md border border-border bg-muted/30 p-4">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 font-medium" aria-live="polite">{currentStep}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{progress}% Complete</span>
          </div>
          <Progress
            value={progress}
            aria-label="Generation progress"
            className={`h-2 ${status === 'failed' ? 'bg-status-error/15' : 'bg-muted'}`}
          />
        </div>

        {showSharedRunning && (
          <p className="text-sm leading-6 text-muted-foreground">
            The three agents run one after another. Each card updates when its agent finishes.
          </p>
        )}

        {pollGaveUpFor !== null && pollGaveUpFor === sessionId && (status === 'cloning' || status === 'analyzing') && (
          <Alert className="border-status-warning/30 bg-status-warning/[0.07]">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 text-status-warning" />
            <AlertDescription>
              No update for this analysis after 30 minutes. Reload the page to check it again.
            </AlertDescription>
          </Alert>
        )}

        {goneFor !== null && goneFor.id === sessionId && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" className="h-4 w-4" />
            <AlertDescription>
              {goneFor.reason === 'not-found'
                ? 'This analysis no longer exists. It may have expired or been deleted.'
                : 'Your sign-in has expired. Sign in again to see this analysis.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Workflow Steps */}
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW_STEPS.map((step, index) => {
            const stepState = getStepState(step, index);
            const Icon = step.icon;

            return (
              <li
                key={step.id}
                className={`flex flex-col gap-3 rounded-md border p-4 transition-colors duration-200 ${
                  getStepColor(stepState)
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-medium text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {getStatusIcon(stepState)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-foreground/70" />
                    <h3 className="truncate text-sm font-semibold">{step.title}</h3>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-border/80 pt-3">
                  <Badge variant="outline" className={`w-fit text-[11px] ${getBadgeColor(stepState)}`}>
                    {STEP_LABELS[stepState]}
                  </Badge>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    AI task: {step.aiUsage}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        {showNoDetails && (
          <p className="text-sm leading-6 text-muted-foreground">
            Per-agent results are reported only while this page is open during the analysis.
          </p>
        )}

        {/* No files: the run completed, but the generator produced nothing */}
        {noFilesGenerated && (
          <Alert className="border-status-warning/30 bg-status-warning/[0.07]">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 text-status-warning" />
            <AlertDescription className="space-y-1">
              <p className="font-medium text-status-warning">No files were generated</p>
              {errors.map((error, index) => (
                <p key={index} className="break-words text-sm leading-6 text-foreground/80">
                  {error}
                </p>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* Error Display */}
        {!noFilesGenerated && errors.length > 0 && (
          <div className="rounded-md border border-status-error/30 bg-status-error/[0.05] p-4">
            <div className="mb-2 flex items-center gap-2">
              <AlertCircle aria-hidden="true" className="h-4 w-4 text-status-error" />
              <h3 className="text-sm font-semibold text-status-error">Errors Detected</h3>
            </div>
            <div className="space-y-1 pl-6">
              {errors.map((error, index) => (
                <p key={index} className="break-words text-sm leading-6 text-status-error">
                  {error}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Agent Messages */}
        {showDetails && displayMessages.length > 0 && (
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Bot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <span>Agent Activity Log</span>
            </h3>
            <ScrollArea className="code-surface scrollbar-slim h-56 w-full rounded-md border border-border">
              <div className="divide-y divide-border/70">
                {displayMessages.map((message, index) => (
                  <div key={index} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                    <Badge variant="outline" className="w-fit shrink-0 font-mono text-[11px] font-normal">
                      {message.agent}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm leading-6">{message.message}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Tech Stack Detection. The server may leave out frameworks, tools or databases: each defaults to [] */}
        {techStack && showDetails && (
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Detected Tech Stack</h3>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Primary:</dt>
                <dd className="mt-0.5 font-medium">{techStack.primary}</dd>
              </div>
              {(techStack.frameworks ?? []).length > 0 && (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Frameworks:</dt>
                  <dd className="mt-0.5">{(techStack.frameworks ?? []).join(', ')}</dd>
                </div>
              )}
              {(techStack.tools ?? []).length > 0 && (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Tools:</dt>
                  <dd className="mt-0.5">{(techStack.tools ?? []).join(', ')}</dd>
                </div>
              )}
              {(techStack.databases ?? []).length > 0 && (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Databases:</dt>
                  <dd className="mt-0.5">{(techStack.databases ?? []).join(', ')}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Generated Files: names while the contents load, then the viewer */}
        {generatedFiles.length > 0 && (
          <div className="min-w-0 space-y-3 rounded-md border border-status-success/25 bg-status-success/[0.05] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-status-success">
              <CheckCircle aria-hidden="true" className="h-4 w-4" />
              <span>Generated Files</span>
            </h3>
            {resultFiles ? (
              <GeneratedFilesView key={sessionId ?? ''} files={resultFiles} sessionId={sessionId} />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {generatedFiles.map((file, index) => (
                    <Badge
                      key={index}
                      variant="outline"
                      className="gap-1.5 rounded-md bg-card py-1.5 font-mono text-[11px] font-normal"
                    >
                      <FileCode aria-hidden="true" className="h-3.5 w-3.5 text-status-success" />
                      {FILE_META[file]?.downloadName || file}
                    </Badge>
                  ))}
                </div>
                {resultFailed && (
                  <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-status-error">The file contents could not be loaded.</span>
                    <Button size="sm" variant="outline" onClick={() => setResultErrorFor(null)} className="w-fit">
                      <RefreshCw aria-hidden="true" className="h-4 w-4" />
                      Try Again
                    </Button>
                  </div>
                )}
                {status === 'completed' && !resultFailed && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-busy="true">
                    <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                    Loading file contents...
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* The verifier's review, as plain text: never rendered as Markdown or HTML */}
        {review !== null && (
          <div className="min-w-0 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <span>Review</span>
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              The verifier agent's AI review of the generated files. It is advice, not a test result.
            </p>
            <pre
              className="code-surface scrollbar-slim max-h-96 w-full overflow-auto whitespace-pre rounded-md border border-border p-4 font-mono text-xs leading-5"
              aria-label="Verifier review"
              tabIndex={0}
            >
              {review}
            </pre>
          </div>
        )}

        {/* Status Actions */}
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                status === 'completed' ? 'bg-status-success' :
                status === 'failed' ? 'bg-status-error' :
                'bg-status-running'
              }`}
            />
            <span className="text-sm font-medium capitalize">{status}</span>
          </div>

          {status === 'completed' && !noFilesGenerated && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleSaveFiles} disabled={saving || saved || !resultFiles}>
                {saving ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle aria-hidden="true" className="h-4 w-4" /> : <Save aria-hidden="true" className="h-4 w-4" />}
                {saving ? 'Saving...' : saved ? 'Saved' : 'Save to Account'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
