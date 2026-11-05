import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { PublicLayout } from '@/components/layouts/PublicLayout';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { GitHubProvider } from '@/contexts/GitHubContext';
import { Landing } from '@/pages/Landing';
import { Demo } from '@/pages/Demo';
import { Auth } from '@/pages/Auth';
import { NotFound } from '@/pages/NotFound';
import { ModernDashboard } from '@/pages/ModernDashboard';
import { GitHubCallback } from '@/pages/GitHubCallback';
import { RepoSelection } from '@/pages/RepoSelection';
import AuthSuccess from '@/pages/AuthSuccess';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { readOAuthError } from '@/lib/oauthError';
import { authUrlFor } from '@/lib/returnTo';

// Signed-in pages. A signed-out visitor goes to /auth?returnTo=<this page>, and comes back
// here after signing in. A failed Google or GitHub sign-in lands here too (Supabase
// redirects to /dashboard with the error in the URL): it goes to /auth?oauth_error=<code>
// instead, so the error is shown rather than lost.
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const oauthError = readOAuthError(location.search, location.hash);
    if (oauthError) return <Navigate to={`/auth?oauth_error=${oauthError}`} replace />;
    return <Navigate to={authUrlFor(location.pathname + location.search)} replace />;
  }

  return <>{children}</>;
};

// The signed-in pages, keyed by the user id: when a different user signs in (in this tab
// or another, which shares the Supabase session), every page under it remounts, so no
// state of the previous user (an open ?session= view, the form, a load in flight) is
// kept. A token refresh keeps the same id and remounts nothing.
const UserScopedOutlet: React.FC = () => {
  const { user } = useAuth();
  return <Outlet key={user?.id ?? 'signed-out'} />;
};

// /login is an old name for the sign-in page; its query string (returnTo) is kept
const LoginRedirect: React.FC = () => {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/auth', search }} replace />;
};

// One error boundary for every page, keyed by the path: moving to another page clears a
// caught error. Pages may add their own (ModernDashboard does).
const RoutesWithBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
};

function App() {
  return (
    <AuthProvider>
      <GitHubProvider>
        <Router>
          <RoutesWithBoundary>
          <Routes>
            {/* Landing route uses its own navigation without the public shell header. */}
            <Route element={<PublicLayout showHeader={false}><Outlet /></PublicLayout>}>
              <Route path="/" element={<Landing />} />
            </Route>

            {/* Public Routes - No Auth Required */}
            {/* /auth/success and /auth/github/callback handle a signed-out visitor themselves:
                the callback only forwards GitHub's answer to the server, and the server's
                redirect to /auth/success discards a completion nobody signed in can claim */}
            <Route element={<PublicLayout><Outlet /></PublicLayout>}>
              <Route path="/demo" element={<Demo />} />
              <Route path="/auth/success" element={<AuthSuccess />} />
              <Route path="/auth/github/callback" element={<GitHubCallback />} />
            </Route>

            {/* Sign-in pages (Auth has its own header); a signed-in visitor is sent on */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/sign-in/*" element={<Auth />} />
            <Route path="/sign-up/*" element={<Auth />} />
            <Route path="/login" element={<LoginRedirect />} />

          {/* Protected Routes - Auth Required */}
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout>
                  <UserScopedOutlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            {/* Dashboard Routes */}
            <Route path="/dashboard" element={<ModernDashboard />} />
            <Route path="/select-repo" element={<RepoSelection />} />
            
            {/* Redirect /profile to /dashboard for now */}
            <Route path="/profile" element={<Navigate to="/dashboard" replace />} />
          </Route>

          {/* 404 Route */}
          <Route path="*" element={<NotFound />} />
          </Routes>
          </RoutesWithBoundary>
          <Toaster />
        </Router>
      </GitHubProvider>
    </AuthProvider>
  );
}

export default App;
