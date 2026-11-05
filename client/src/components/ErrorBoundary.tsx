import React, { Component, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, RefreshCw, Copy, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  // When this changes while an error is shown (the app passes the path), the error is
  // cleared, so moving to another page leaves the error screen. While nothing failed, a
  // change does nothing: the pages below are not remounted.
  resetKey?: string;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  errorId: string;
  copy: 'idle' | 'copied' | 'failed';
}

const newErrorId = (): string => `error_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;

// Catches a render error below it and shows a fixed screen instead of a blank page.
// Production builds show only the error ID: the message and stacks can hold data from the
// page, so they appear only in development (import.meta.env.DEV). Nothing is sent
// anywhere; "Copy error details" puts the ID, message, stack and time on the clipboard.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, errorId: newErrorId(), copy: 'idle' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, errorId: newErrorId(), copy: 'idle' };
  }

  // Only an error that was already showing before this update is cleared: an error thrown
  // by the page being navigated to stays on screen
  componentDidUpdate(previousProps: Props, previousState: State) {
    if (this.state.error && previousState.error && previousProps.resetKey !== this.props.resetKey) this.handleRetry();
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ componentStack: errorInfo.componentStack ?? null });
    if (import.meta.env.DEV) console.error(`Error boundary caught ${this.state.errorId}:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ error: null, componentStack: null, errorId: newErrorId(), copy: 'idle' });
  };

  handleCopy = async () => {
    const { error, errorId } = this.state;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(JSON.stringify({
        errorId,
        message: error?.message,
        stack: error?.stack,
        time: new Date().toISOString()
      }, null, 2));
      this.setState({ copy: 'copied' });
    } catch {
      this.setState({ copy: 'failed' });
    }
  };

  render() {
    const { error, componentStack, errorId, copy } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <Card className="w-full max-w-2xl shadow-raised">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-destructive">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/[0.06]">
                <AlertTriangle aria-hidden="true" className="h-5 w-5" />
              </span>
              <span>Something went wrong</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">This page hit an unexpected error. Try again, or go back to the home page.</p>
                  <p className="text-sm text-muted-foreground">
                    Error ID: <code className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-xs text-foreground">{errorId}</code>
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            {import.meta.env.DEV && (
              <div className="space-y-4" data-testid="error-details">
                <div>
                  <h3 className="mb-2 text-sm font-medium">Message (development only)</h3>
                  <p className="break-words font-mono text-xs">{error.message}</p>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Stack</h3>
                  <pre className="code-surface scrollbar-slim max-h-48 overflow-auto rounded-md border border-border p-3 font-mono text-xs leading-5">
                    {error.stack}
                  </pre>
                </div>
                {componentStack && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Component stack</h3>
                    <pre className="code-surface scrollbar-slim max-h-48 overflow-auto rounded-md border border-border p-3 font-mono text-xs leading-5">
                      {componentStack}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button onClick={this.handleRetry} className="flex-1">
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Try Again
              </Button>
              <Button variant="outline" onClick={() => void this.handleCopy()} className="flex-1">
                <Copy aria-hidden="true" className="h-4 w-4" />
                Copy error details
              </Button>
              {/* A full page load: nothing of the failed page is kept */}
              <a href="/" className={buttonVariants({ variant: 'outline' })}>
                <Home aria-hidden="true" className="h-4 w-4" />
                Go to Home
              </a>
            </div>
            <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
              {copy === 'copied' && 'Copied'}
              {copy === 'failed' && 'The error details could not be copied. Select the error ID above instead.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
}
