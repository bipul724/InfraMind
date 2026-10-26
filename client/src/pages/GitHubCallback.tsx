import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, AlertTriangle, Github } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/lib/api';

export const GitHubCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = () => {
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
    // exchange the code. It redirects back to /auth/success with a session token.
    window.location.replace(`${API_BASE_URL}/auth/github/callback?${searchParams.toString()}`);
  };

  const handleRetry = () => {
    // Restart through the server so a fresh state cookie is issued
    window.location.href = `${API_BASE_URL}/auth/github`;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <Card className="w-full max-w-md bg-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Github className="h-5 w-5" />
            <span>GitHub Connection</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'loading' && (
            <div className="text-center space-y-4">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">{message}</p>
            </div>
          )}

          {status === 'success' && (
              <Alert className="border-status-success/30 bg-status-success/10">
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
              
              <div className="flex space-x-3">
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
