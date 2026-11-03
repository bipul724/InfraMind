import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Bot, 
  Search,
  Cog,
  Shield,
  Download,
  ExternalLink,
  Loader2,
  Save
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { API_BASE_URL, SavedFilesAPI } from '@/lib/api';
import { apiFetch } from '@/lib/apiClient';
import { getAccessToken } from '@/lib/supabase';

interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
}

interface AgentProgressProps {
  sessionId?: string;
  repoUrl?: string;
  currentStep: string;
  progress: number;
  status: 'cloning' | 'cloned' | 'analyzing' | 'completed' | 'failed';
  messages?: AgentMessage[];
  errors?: string[];
  techStack?: any;
  generatedFiles?: string[];
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
  onProgressUpdate?: (data: any) => void;
}

const WORKFLOW_STEPS = [
  {
    id: 'plan',
    title: 'Planner Agent',
    description: 'Planner Agent analyzing project structure',
    icon: Bot,
    estimatedTime: '15-45s'
  },
  {
    id: 'analyze',
    title: 'Analyzer Agent',
    description: 'Analyzer Agent detecting tech stack',
    icon: Search,
    estimatedTime: '30-60s'
  },
  {
    id: 'generate',
    title: 'Generator Agent',
    description: 'Generator Agent creating configurations',
    icon: Cog,
    estimatedTime: '45-90s'
  },
  {
    id: 'verify',
    title: 'Verifier Agent',
    description: 'Verifier Agent validating outputs',
    icon: Shield,
    estimatedTime: '15-30s'
  }
];

// Agent output keys -> the file names and types used for saved files (see OutputDisplay)
const SAVED_FILE_META: Record<string, { name: string; type: string }> = {
  dockerfile: { name: 'Dockerfile', type: 'dockerfile' },
  githubActions: { name: '.github/workflows/ci.yml', type: 'github-actions' },
  envExample: { name: '.env.example', type: 'env' },
};

// Private repos are cloned as https://<token>@github.com/..., so never store credentials
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
  messages = [],
  errors = [],
  techStack,
  generatedFiles = [],
  onComplete,
  onError,
  onProgressUpdate
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [localMessages, setLocalMessages] = useState<AgentMessage[]>(messages);
  const [localErrors, setLocalErrors] = useState<string[]>(errors);
  const [localTechStack, setLocalTechStack] = useState(techStack);
  const [localGeneratedFiles, setLocalGeneratedFiles] = useState<string[]>(generatedFiles);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Initialize Socket.IO connection
  useEffect(() => {
    // The auth callback runs on every (re)connect, so refreshed tokens are picked up
    const newSocket = io(API_BASE_URL, {
      auth: (cb) => {
        getAccessToken().then((token) => cb({ token: token ?? '' }));
      }
    });
    
    newSocket.on('connect', () => {
      console.log('🔗 Connected to InfraMind server');
      // Progress is delivered only to sockets subscribed to a session they own
      if (sessionId) {
        newSocket.emit('subscribe', { sessionId }, (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) {
            console.warn('Could not subscribe to session progress:', ack?.error);
          }
        });
      }
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from InfraMind server');
    });

    // Listen for progress updates
    newSocket.on('progress', (data) => {
      if (sessionId && data.sessionId === sessionId) {
        console.log('📡 Progress update received:', data);
        
        // Update local state
        if (data.messages) setLocalMessages(data.messages);
        if (data.errors) setLocalErrors(data.errors);
        if (data.techStack) setLocalTechStack(data.techStack);
        if (data.generatedFiles) setLocalGeneratedFiles(data.generatedFiles);
        
        // Call parent update handler
        if (onProgressUpdate) {
          onProgressUpdate(data);
        }
      }
    });

    setSocket(newSocket);

    // Cleanup on unmount
    return () => {
      newSocket.disconnect();
    };
  }, [sessionId, onProgressUpdate]);

  useEffect(() => {
    // Update current step index based on progress
    if (progress <= 35) setCurrentStepIndex(0);
    else if (progress <= 65) setCurrentStepIndex(1);
    else if (progress <= 90) setCurrentStepIndex(2);
    else setCurrentStepIndex(3);
  }, [progress]);

  useEffect(() => {
    if (status === 'completed' && onComplete) {
      onComplete({ 
        techStack: localTechStack, 
        generatedFiles: localGeneratedFiles, 
        messages: localMessages 
      });
    } else if (status === 'failed' && onError && localErrors.length > 0) {
      onError(localErrors[0]);
    }
  }, [status, onComplete, onError, localTechStack, localGeneratedFiles, localMessages, localErrors]);

  const getStepStatus = (stepIndex: number) => {
    if (status === 'failed' && stepIndex === currentStepIndex) return 'failed';
    if (status === 'completed' || stepIndex < currentStepIndex) return 'done';
    if (stepIndex === currentStepIndex && status !== 'cloned') return 'running';
    return 'pending';
  };

  const getStatusIcon = (stepStatus: string) => {
    switch (stepStatus) {
      case 'done':
        return <CheckCircle className="h-5 w-5 text-status-success" />;
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin text-status-running" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-status-error" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-muted-foreground" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStepColor = (stepStatus: string) => {
    switch (stepStatus) {
      case 'done':
        return 'border-status-success/30 bg-status-success/10';
      case 'running':
        return 'border-status-running/30 bg-status-running/10';
      case 'failed':
        return 'border-status-error/30 bg-status-error/10';
      case 'pending':
        return 'border-border bg-muted/40';
      default:
        return 'border-border bg-muted/40';
    }
  };

  const fetchGeneratedFiles = async (): Promise<Record<string, unknown>> => {
    const response = await apiFetch(`/api/files/${sessionId}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch generated files');
    }
    
    const data = await response.json();
    return data.files || {};
  };

  const handleDownloadFiles = async () => {
    if (!sessionId) return;
    
    try {
      // Create downloadable files
      const files = await fetchGeneratedFiles();
      Object.entries(files).forEach(([filename, content]) => {
        const blob = new Blob([content as string], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const handleSaveFiles = async () => {
    if (!sessionId) return;
    if (!user?.id) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to save files.',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const files = await fetchGeneratedFiles();
      const requests = Object.entries(files)
        .filter(([, content]) => typeof content === 'string' && content.trim() !== '')
        .map(([key, content]) => ({
          userId: user.id,
          content: content as string,
          name: SAVED_FILE_META[key]?.name || key,
          type: SAVED_FILE_META[key]?.type || key,
          repoUrl: stripCredentials(repoUrl),
        }));

      if (requests.length === 0) {
        throw new Error('No generated files to save');
      }

      await SavedFilesAPI.saveFiles(requests);
      toast({
        title: 'Files saved',
        description: `${requests.length} file${requests.length === 1 ? '' : 's'} saved to your account.`,
      });
    } catch (error) {
      console.error('Save error:', error);
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save files',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  // Use local state that gets updated via WebSocket, fallback to props
  const displayMessages = localMessages.length > 0 ? localMessages : messages;
  const displayErrors = localErrors.length > 0 ? localErrors : errors;
  const displayTechStack = localTechStack || techStack;
  const displayGeneratedFiles = localGeneratedFiles.length > 0 ? localGeneratedFiles : generatedFiles;

  return (
    <Card className="mx-auto w-full max-w-4xl border-border bg-card shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center space-x-2">
              <Bot className="h-6 w-6 text-primary" />
              <span>AI DevOps Agent Pipeline</span>
              {sessionId && (
                <Badge variant="outline" className="text-xs">
                  Session: {sessionId.substring(0, 8)}...
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Multi-agent system analyzing your repository and generating CI/CD configurations
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">{currentStep}</span>
            <span className="font-mono text-xs text-muted-foreground">{progress}% Complete</span>
          </div>
          <Progress
            value={progress}
            className={`h-2 ${status === 'failed' ? 'bg-status-error/10' : 'bg-muted'}`}
          />
        </div>

        {/* Workflow Steps */}
        <div className="grid gap-3 md:grid-cols-4">
          {WORKFLOW_STEPS.map((step, index) => {
            const stepStatus = getStepStatus(index);
            const Icon = step.icon;
            
            return (
              <div
                key={step.id}
                className={`flex min-h-40 flex-col gap-4 rounded-md border p-4 transition-colors duration-200 ${
                  getStepColor(stepStatus)
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {getStatusIcon(stepStatus)}
                </div>
                
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="h-4 w-4 text-foreground" />
                    <h3 className="font-medium">{step.title}</h3>
                  </div>
                  <Badge
                    variant="outline"
                    className={`mt-3 w-fit text-xs ${
                      stepStatus === 'done'
                        ? 'border-status-success/30 text-status-success'
                        : stepStatus === 'running'
                          ? 'border-status-running/30 text-status-running'
                          : stepStatus === 'failed'
                            ? 'border-status-error/30 text-status-error'
                            : 'border-border text-muted-foreground'
                    }`}
                  >
                    {stepStatus === 'done'
                      ? 'Done'
                      : stepStatus === 'running'
                        ? 'Running'
                        : stepStatus === 'failed'
                          ? 'Failed'
                          : 'Pending'}
                  </Badge>
                  <p className="mt-3 text-sm leading-5 text-muted-foreground">
                    {step.description}
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    Est. time: {step.estimatedTime}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Error Display */}
        {displayErrors.length > 0 && (
          <div className="rounded-md border border-status-error/30 bg-status-error/10 p-4">
            <div className="mb-2 flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-status-error" />
              <h3 className="font-medium text-status-error">Errors Detected</h3>
            </div>
            <div className="space-y-1">
              {displayErrors.map((error, index) => (
                <p key={index} className="text-sm text-status-error">
                  {error}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Agent Messages */}
        {showDetails && displayMessages.length > 0 && (
          <div className="space-y-3">
            <h3 className="flex items-center space-x-2 font-medium">
              <Bot className="h-4 w-4" />
              <span>Agent Activity Log</span>
            </h3>
            <ScrollArea className="scrollbar-slim h-48 w-full rounded-md border border-border p-3">
              <div className="space-y-3">
                {displayMessages.map((message, index) => (
                  <div key={index} className="flex items-start space-x-3">
                    <Badge variant="outline" className="text-xs">
                      {message.agent}
                    </Badge>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{message.message}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Tech Stack Detection */}
        {displayTechStack && showDetails && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
            <h3 className="mb-2 font-medium text-primary">Detected Tech Stack</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="font-medium">Primary:</span> {displayTechStack.primary}
              </div>
              {displayTechStack.frameworks?.length > 0 && (
                <div>
                  <span className="font-medium">Frameworks:</span> {displayTechStack.frameworks.join(', ')}
                </div>
              )}
              {displayTechStack.tools?.length > 0 && (
                <div>
                  <span className="font-medium">Tools:</span> {displayTechStack.tools.join(', ')}
                </div>
              )}
              {displayTechStack.databases?.length > 0 && (
                <div>
                  <span className="font-medium">Databases:</span> {displayTechStack.databases.join(', ')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Generated Files */}
        {displayGeneratedFiles.length > 0 && (
          <div className="rounded-md border border-status-success/30 bg-status-success/10 p-4">
            <h3 className="mb-2 flex items-center space-x-2 font-medium text-status-success">
              <CheckCircle className="h-4 w-4" />
              <span>Generated Files</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {displayGeneratedFiles.map((file, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="border border-status-success/30 bg-status-success/10 text-status-success"
                >
                  {file}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Status Actions */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center space-x-2">
            <div 
              className={`h-2 w-2 rounded-full ${
                status === 'completed' ? 'bg-status-success' :
                status === 'failed' ? 'bg-status-error' :
                'bg-status-running'
              }`}
            />
            <span className="text-sm font-medium capitalize">{status}</span>
          </div>
          
          {status === 'completed' && (
            <div className="flex space-x-2">
              <Button size="sm" variant="outline" onClick={handleDownloadFiles}>
                <Download className="h-4 w-4 mr-2" />
                Download Files
              </Button>
              <Button size="sm" variant="outline" onClick={handleSaveFiles} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {saving ? 'Saving...' : 'Save to Account'}
              </Button>
              <Button size="sm">
                <ExternalLink className="h-4 w-4 mr-2" />
                View Results
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
