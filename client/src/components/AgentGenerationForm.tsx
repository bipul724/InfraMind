import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from './ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from './ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { apiFetch } from '@/lib/apiClient';
import { 
  Bot, 
  GitBranch, 
  Sparkles, 
  AlertTriangle, 
  Info,
  Zap,
  Settings,
  Key,
  Play,
  AlertCircle,
  CheckCircle,
  Github,
  Loader2
} from 'lucide-react';
import { AgentProgress } from './AgentProgress';

interface AgentGenerationFormProps {
  repoUrl?: string;
  authToken?: string;
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
  className?: string;
}

// Temporary AgentAPI service implementation
class AgentAPIService {
  initializeSocket(callback: (data: any) => void) {
    // Mock implementation for now
    console.log('Socket initialized');
  }
  
  async cloneRepository(params: { repoUrl: string; authToken?: string }) {
    // Mock implementation
    const response = await apiFetch('/api/clone-repo', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    return response.json();
  }
  
  async runAnalysis(params: { sessionId: string }) {
    // Mock implementation  
    const response = await apiFetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    return response.json();
  }
}

const validateGitHubUrl = (url: string) => {
  const githubUrlPattern = /^https:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+(?:\.git)?$/;
  return githubUrlPattern.test(url);
};

export const AgentGenerationForm: React.FC<AgentGenerationFormProps> = ({
  repoUrl: initialRepoUrl = '',
  authToken,
  onComplete,
  onError,
  className
}) => {
  // Form state
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [useAdvancedMode, setUseAdvancedMode] = useState(false);
  
  // Agent workflow state
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState('Ready to analyze');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'cloning' | 'cloned' | 'analyzing' | 'completed' | 'failed'>('cloned');
  const [messages, setMessages] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [techStack, setTechStack] = useState<any>(null);
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

  const handleStartAnalysis = async () => {
    if (!isValidUrl) {
      setUrlError('Please enter a valid GitHub repository URL');
      return;
    }

    setIsRunning(true);
    setCurrentStep('Initializing AI agents...');
    setProgress(5);
    setStatus('cloning');
    setMessages([]);
    setErrors([]);
    setSessionId(null);

    try {
      const agentAPI = new AgentAPIService();
      
      // Initialize WebSocket connection for real-time updates
      agentAPI.initializeSocket(handleProgressUpdate);
      
      // Step 1: Clone repository
      setCurrentStep('Cloning repository...');
      setProgress(15);
      
      const cloneResult = await agentAPI.cloneRepository({
        repoUrl,
        authToken
      });
      
      if (!cloneResult.success) {
        throw new Error(cloneResult.error || 'Failed to clone repository');
      }
      
      setSessionId(cloneResult.sessionId);
      setCurrentStep('Repository cloned successfully');
      setProgress(25);
      setStatus('cloned');
      
      // Step 2: Start AI analysis
      setCurrentStep('Starting AI agent analysis...');
      setProgress(30);
      setStatus('analyzing');
      
      const analysisResult = await agentAPI.runAnalysis({
        sessionId: cloneResult.sessionId
      });
      
      if (!analysisResult.success) {
        throw new Error(analysisResult.error || 'Analysis failed');
      }
      
      // Analysis will continue via WebSocket updates
      
    } catch (error) {
      console.error('Agent workflow error:', error);
      setStatus('failed');
      setErrors([error instanceof Error ? error.message : 'Unknown error occurred']);
      setCurrentStep('Analysis failed');
      setProgress(0);
      
      if (onError) {
        onError(error instanceof Error ? error.message : 'Unknown error occurred');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleProgressUpdate = (progressData: any) => {
    console.log('Progress update:', progressData);
    
    if (progressData.sessionId && !sessionId) {
      setSessionId(progressData.sessionId);
    }
    
    if (progressData.step) {
      setCurrentStep(progressData.step);
    }
    
    if (progressData.progress !== undefined) {
      setProgress(progressData.progress);
    }
    
    if (progressData.status) {
      setStatus(progressData.status);
    }
    
    if (progressData.messages) {
      setMessages(progressData.messages);
    }
    
    if (progressData.errors) {
      setErrors(progressData.errors);
    }
    
    if (progressData.techStack) {
      setTechStack(progressData.techStack);
    }
    
    if (progressData.generatedFiles) {
      setGeneratedFiles(progressData.generatedFiles);
    }
    
    // Handle completion
    if (progressData.status === 'completed' && onComplete) {
      onComplete({
        sessionId: progressData.sessionId,
        techStack: progressData.techStack,
        generatedFiles: progressData.generatedFiles,
        messages: progressData.messages
      });
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    setSessionId(null);
    setCurrentStep('Ready to analyze');
    setProgress(0);
    setStatus('cloned');
    setMessages([]);
    setErrors([]);
    setTechStack(null);
    setGeneratedFiles([]);
  };

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
                Enter your GitHub repository URL to let our AI agents analyze and generate production-ready CI/CD configurations
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-5 sm:pt-6">
          <Tabs defaultValue="setup" className="w-full">
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
                        Valid GitHub repository URL detected
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUseAdvancedMode(!useAdvancedMode)}
                      disabled={isRunning}
                      aria-expanded={useAdvancedMode}
                    >
                      <Settings className="h-4 w-4" />
                      {useAdvancedMode ? 'Hide' : 'Show'} Advanced Options
                    </Button>
                    <Badge variant="secondary" className="font-normal">
                      For Private Repos
                    </Badge>
                  </div>

                  {useAdvancedMode && (
                    <div
                      className="animate-in fade-in-0 slide-in-from-top-1 space-y-4 rounded-md border border-border
                        bg-muted/50 p-4 duration-200"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="auth-token" className="flex flex-wrap items-center gap-2">
                          <Key className="h-4 w-4 text-muted-foreground" />
                          <span>GitHub Personal Access Token</span>
                          <Badge variant="outline" className="font-normal">
                            Optional
                          </Badge>
                        </Label>
                        <Input
                          id="auth-token"
                          type="password"
                          placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          value={authToken}
                          onChange={(e) => {
                            // Handle auth token change
                          }}
                          disabled={isRunning}
                          className="font-mono text-[13px]"
                        />
                        <Alert className="mt-2 bg-card">
                          <Info className="h-4 w-4 text-muted-foreground" />
                          <AlertDescription className="text-sm text-muted-foreground">
                            Required only for private repositories. Generate at{' '}
                            <a
                              href="https://github.com/settings/tokens"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              GitHub Settings → Developer settings → Personal access tokens
                            </a>
                          </AlertDescription>
                        </Alert>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                      <Zap className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">AI-Powered Analysis</h3>
                      <p className="text-sm text-muted-foreground">
                        Multi-agent system analyzes your repository
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                      <Github className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">Production Ready</h3>
                      <p className="text-sm text-muted-foreground">
                        Generates optimized CI/CD configurations
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
                repoUrl={repoUrl}
                currentStep={currentStep}
                progress={progress}
                status={status}
                messages={messages}
                errors={errors}
                techStack={techStack}
                generatedFiles={generatedFiles}
                onComplete={onComplete}
                onError={onError}
                onProgressUpdate={handleProgressUpdate}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
