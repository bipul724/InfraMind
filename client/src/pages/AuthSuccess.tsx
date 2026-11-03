import React, { useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Github, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useGitHub } from '../contexts/GitHubContext';
import { API_BASE_URL } from '@/lib/api';
import { apiFetch, getApiErrorCode } from '@/lib/apiClient';

// Error codes the server puts in ?error=
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_state: 'Invalid authentication state. Please try again.',
  github_auth_failed: 'GitHub authentication failed. Please try again.',
  connect_expired: 'The connection link expired. Please try again.',
  access_denied: 'GitHub access was not granted.'
};

// Codes returned by POST /api/github/connect/complete
const CLAIM_MESSAGES: Readonly<Record<string, string>> = {
  GITHUB_CONNECT_EXPIRED: 'The connection link expired. Please connect GitHub again.',
  GITHUB_CONNECT_MISMATCH:
    'This GitHub connection was started from a different InfraMind account. Nothing was connected. Please connect GitHub again.',
  GITHUB_STORE_UNAVAILABLE: 'The GitHub connection service is unavailable. Please try again later.',
  INVALID_REQUEST: 'The connection link is invalid. Please connect GitHub again.'
};

const GENERIC_ERROR_MESSAGE = 'Authentication failed. Please try again.';
const SIGNED_OUT_MESSAGE = 'Sign in, then connect GitHub again.';
const SUCCESS_DELAY_MS = 2000;
const ERROR_DELAY_MS = 3000;
const COMPLETION_PATTERN = /^[0-9a-f]{64}$/i;

// Codes come from the URL or the network: only the table's own keys may match, never
// inherited names such as "constructor"
const messageFor = (table: Readonly<Record<string, string>>, code: string | null): string =>
  code !== null && Object.prototype.hasOwnProperty.call(table, code) ? table[code] : GENERIC_ERROR_MESSAGE;

// The server redirects here with ?complete=<one-time id> or ?error=<code>, never a token.
// A completion is claimed by the signed-in user; the server stores the GitHub connection
// only if that user started the flow. Signed out, the completion is discarded instead.
const AuthSuccess: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: authUser, loading: authLoading } = useAuth();
  const { refresh } = useGitHub();
  const [status, setStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = React.useState<string>('');

  // Read once, on the first render: the id is removed from the address bar right away
  const hadCompleteParamRef = useRef(searchParams.has('complete'));
  const completionRef = useRef<string | null>(
    COMPLETION_PATTERN.test(searchParams.get('complete') ?? '') ? searchParams.get('complete') : null
  );
  const errorCodeRef = useRef<string | null>(searchParams.get('error'));
  // The completion already claimed or discarded. Effects can run more than once
  // (React StrictMode in development); the server accepts each completion only once.
  const sentCompletionRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback((next: 'success' | 'error', message: string, delayMs: number, target = '/dashboard') => {
    setStatus(next);
    setError(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => navigate(target, { replace: true }), delayMs);
  }, [navigate]);

  // Clears a pending redirect when the page really unmounts
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Remove the completion id from the address bar (and history) before claiming it
  useEffect(() => {
    if (hadCompleteParamRef.current && location.search) {
      navigate(location.pathname, { replace: true });
    }
    // Runs once: the values were captured on the first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?error=<code>, or any other or missing parameter
  useEffect(() => {
    if (completionRef.current) return;
    setStatus('error');
    setError(messageFor(ERROR_MESSAGES, errorCodeRef.current));
    const timer = setTimeout(() => navigate('/dashboard', { replace: true }), ERROR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [navigate]);

  // ?complete=<id>: once auth has loaded, claim it (signed in) or discard it (signed out)
  useEffect(() => {
    const completion = completionRef.current;
    if (!completion || authLoading) return;
    if (sentCompletionRef.current === completion) return;
    sentCompletionRef.current = completion;

    const run = async () => {
      if (!authUser) {
        try {
          await fetch(`${API_BASE_URL}/auth/github/discard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completion })
          });
        } catch {
          // Best effort: the server also revokes unclaimed completions when they expire
        }
        finish('error', SIGNED_OUT_MESSAGE, ERROR_DELAY_MS, '/auth');
        return;
      }

      try {
        const response = await apiFetch('/api/github/connect/complete', {
          method: 'POST',
          body: JSON.stringify({ completion })
        });
        if (response.ok) {
          await refresh();
          finish('success', '', SUCCESS_DELAY_MS);
          return;
        }
        if (response.status === 400 || response.status === 403 || response.status === 503) {
          finish('error', messageFor(CLAIM_MESSAGES, await getApiErrorCode(response)), ERROR_DELAY_MS);
          return;
        }
        finish('error', GENERIC_ERROR_MESSAGE, ERROR_DELAY_MS);
      } catch {
        finish('error', GENERIC_ERROR_MESSAGE, ERROR_DELAY_MS);
      }
    };
    void run();
  }, [authLoading, authUser, refresh, finish]);

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
