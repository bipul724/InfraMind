import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet } from 'react-router-dom';
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

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
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

function App() {
  return (
    <AuthProvider>
      <GitHubProvider>
        <Router>
          <Routes>
            {/* Landing route uses its own navigation without the public shell header. */}
            <Route element={<PublicLayout showHeader={false}><Outlet /></PublicLayout>}>
              <Route path="/" element={<Landing />} />
            </Route>

            {/* Public Routes - No Auth Required */}
            <Route element={<PublicLayout><Outlet /></PublicLayout>}>
              <Route path="/demo" element={<Demo />} />
              <Route path="/auth/success" element={<AuthSuccess />} />
            </Route>

            {/* Auth Routes - No Layout (Auth has its own header) */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/sign-in/*" element={<Auth />} />
            <Route path="/sign-up/*" element={<Auth />} />

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
            <Route path="/auth/github/callback" element={<GitHubCallback />} />
            <Route path="/select-repo" element={<RepoSelection />} />
            
            {/* Redirect /profile to /dashboard for now */}
            <Route path="/profile" element={<Navigate to="/dashboard" replace />} />
            
            {/* Redirect /login to /auth */}
            <Route path="/login" element={<Navigate to="/auth" replace />} />
          </Route>

          {/* 404 Route */}
          <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster />
        </Router>
      </GitHubProvider>
    </AuthProvider>
  );
}

export default App;
