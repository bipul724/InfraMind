import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, AlertTriangle, Github } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { API_BASE_URL } from '@/lib/api';

export const GitHubCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { connectGitHub } = useGitHub();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setMessage(`GitHub OAuth error: ${error}`);
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from GitHub');
      return;
    }

    setMessage('Verifying GitHub authorization...');

    // The server checks the OAuth state against its HttpOnly cookie, so it must
    // exchange the code. It stores nothing at this step: it parks the result under a
    // one-time completion id and redirects to /auth/success?complete=<id> (or ?error=),
    // where the signed-in user claims it (server/server.js /auth/github/callback).
    window.location.replace(`${API_BASE_URL}/auth/github/callback?${searchParams.toString()}`);
  }, [searchParams]);

  const handleRetry = () => {
    // Restart through the server with a fresh one-time ticket and state cookie
    void connectGitHub();
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center py-8 text-foreground">
      <Card className="w-full max-w-md shadow-raised">
        <CardHeader className="items-center pb-4 text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
            <Github className="h-6 w-6" />
          </div>
          <CardTitle className="flex items-center gap-2">
            <span>GitHub Connection</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'loading' && (
            <div className="space-y-4 py-4 text-center" aria-busy="true">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
          )}

          {status === 'success' && (
              <Alert className="border-status-success/25 bg-status-success/[0.06]">
              <CheckCircle className="h-4 w-4 text-status-success" />
              <AlertDescription className="text-status-success">
                {message}
              </AlertDescription>
            </Alert>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {message}
                </AlertDescription>
              </Alert>
              
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={handleRetry} className="flex-1">
                  Try Again
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => navigate('/dashboard')}
                  className="flex-1"
                >
                  Skip for Now
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
