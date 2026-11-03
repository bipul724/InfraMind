import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Github, CheckCircle, XCircle } from 'lucide-react';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'Invalid authentication state. Please try again.',
  github_auth_failed: 'GitHub authentication failed. Please try again.',
  connect_expired: 'The connection link expired. Please try again.',
  access_denied: 'GitHub access was not granted.'
};
const GENERIC_ERROR_MESSAGE = 'Authentication failed. Please try again.';

// The server redirects here with ?status=connected or ?error=<code>, never a token.
// The page is reached by a full-page redirect, so GitHubContext's own mount effect
// makes the single status request; this page makes none.
const AuthSuccess: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = React.useState<string>('');

  useEffect(() => {
    const statusParam = searchParams.get('status');
    const errorParam = searchParams.get('error');

    let timer: ReturnType<typeof setTimeout>;
    if (statusParam === 'connected' && !errorParam) {
      setStatus('success');
      timer = setTimeout(() => navigate('/dashboard', { replace: true }), 2000);
    } else {
      setStatus('error');
      setError((errorParam && ERROR_MESSAGES[errorParam]) || GENERIC_ERROR_MESSAGE);
      timer = setTimeout(() => navigate('/dashboard', { replace: true }), 3000);
    }
    return () => clearTimeout(timer);
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <Card className="w-full max-w-md bg-card">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <Github className="h-6 w-6" />
            GitHub Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'loading' && (
            <div className="text-center py-8">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary"></div>
              <p className="text-muted-foreground">Processing authentication...</p>
            </div>
          )}

          {status === 'success' && (
              <Alert className="border-status-success/30 bg-status-success/10">
              <CheckCircle className="h-4 w-4 text-status-success" />
              <AlertDescription className="text-status-success">
                <strong>Success!</strong> Your GitHub account has been connected. 
                Redirecting to dashboard...
              </AlertDescription>
            </Alert>
          )}

          {status === 'error' && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Authentication Failed</strong><br />
                {error}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthSuccess;
