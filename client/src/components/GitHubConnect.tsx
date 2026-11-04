import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Github, CheckCircle, AlertCircle, ExternalLink, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export const GitHubConnect = () => {
  const { user, login } = useAuth();
  const { toast } = useToast();
  
  // Check if user logged in via GitHub OAuth
  const isGitHubUser = user?.prefs?.loginProvider === 'github';
  const githubUsername = user?.prefs?.githubUsername;

  const handleGitHubLogin = async () => {
    try {
      await login.withGitHub();
      toast({
        title: 'Success',
        description: 'Redirecting to GitHub for authentication...',
      });
    } catch (error) {
      console.error('Failed to connect GitHub:', error);
      toast({
        title: 'Error',
        description: 'GitHub sign-in could not be started. Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (!user) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-4 space-y-0 pb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
          <Github className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">
            GitHub Sign-in
          </CardTitle>
          <CardDescription>
            How you signed in to InfraMind. Repository access is a separate connection: use Connect GitHub on the dashboard.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isGitHubUser ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-md border border-status-success/25 bg-status-success/[0.06] p-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-start gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-success" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-status-success">Signed in with GitHub</p>
                  {githubUsername ? (
                    <p className="text-sm text-foreground/80">Signed in as <span className="font-mono">@{githubUsername}</span></p>
                  ) : (
                    <p className="text-sm text-foreground/80">Signed in through GitHub</p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('https://github.com', '_blank')}
                className="w-full sm:w-auto"
              >
                <ExternalLink className="h-4 w-4" />
                Open GitHub
              </Button>
            </div>
            
            <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />Sign-in only: no repository access</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />Repositories: Connect GitHub on the dashboard</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />Public repositories also work by URL</li>
            </ul>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] lg:items-start">
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/[0.05] p-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">You signed in without GitHub</p>
                  <p className="text-sm text-muted-foreground">
                    You can also sign in with GitHub. That does not connect your repositories.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Signing in with GitHub:
                </p>
                <ul className="grid gap-2 text-sm text-foreground/80 sm:grid-cols-2">
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Signs you in through Supabase</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Shows your GitHub username in the header</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Gives InfraMind no repository access</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />For repositories, use Connect GitHub</li>
                </ul>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border bg-muted/60 p-4">
              <div className="flex flex-col gap-2">
                <Button onClick={handleGitHubLogin} className="w-full">
                  <Github className="h-4 w-4" />
                  Sign in with GitHub
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open('https://github.com', '_blank')}
                  className="w-full"
                >
                  <ExternalLink className="h-4 w-4" />
                  Visit GitHub
                </Button>
              </div>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                This is separate from the GitHub repository connection on the dashboard
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
