import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { apiFetch } from '@/lib/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

// GitHub tokens never reach the browser: the server stores them per Supabase user
// and this context only knows whether the signed-in user has a connection.
interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

interface GitHubContextType {
  isConnected: boolean;
  user: GitHubUser | null;
  isLoading: boolean;
  // Shows a toast when the connection cannot be started; on success the page navigates away
  connectGitHub: () => Promise<void>;
  // true when the connection is gone
  disconnect: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

interface GitHubStatusResponse {
  connected: boolean;
  user?: GitHubUser;
  connectedAt?: string;
}

const GitHubContext = createContext<GitHubContextType | undefined>(undefined);

// Written by earlier versions of the app; removed on load and never read
const LEGACY_STORAGE_KEYS = ['github_token', 'github_token_owner'];

interface GitHubProviderProps {
  children: ReactNode;
}

export const GitHubProvider: React.FC<GitHubProviderProps> = ({ children }) => {
  const { user: authUser, loading: authLoading } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Incremented by every status request and reset, so stale responses are ignored
  const generationRef = useRef(0);

  useEffect(() => {
    try {
      for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    } catch {
      // Storage unavailable (private mode): nothing to clean up
    }
  }, []);

  const resetState = useCallback(() => {
    generationRef.current++;
    setUser(null);
    setIsConnected(false);
    setIsLoading(false);
  }, []);

  // Exactly one GET /api/github/status; the server makes no GitHub call for it
  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current;

    setIsLoading(true);
    try {
      const response = await apiFetch('/api/github/status');
      if (!isCurrent()) return;
      if (!response.ok) {
        // Not signed in (401) or a server/store problem (5xx): not connected for now
        setUser(null);
        setIsConnected(false);
        return;
      }
      const data: GitHubStatusResponse = await response.json();
      if (!isCurrent()) return;
      if (data.connected && data.user) {
        setUser(data.user);
        setIsConnected(true);
      } else {
        setUser(null);
        setIsConnected(false);
      }
    } catch {
      if (!isCurrent()) return;
      console.error('GitHub status check failed: server unreachable');
      setUser(null);
      setIsConnected(false);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, []);

  // GitHub state follows the Supabase user: reset on sign-out, re-read on sign-in or user switch
  const authUserId = authUser?.id ?? null;
  useEffect(() => {
    if (authLoading) return;
    if (!authUserId) {
      resetState();
      return;
    }
    refresh();
  }, [authLoading, authUserId, refresh, resetState]);

  // Ask the server for a one-time ticket, then navigate (not fetch) so the server's
  // OAuth state cookie is set first-party before it redirects to GitHub. Every Connect and
  // Reconnect GitHub button calls this, so a failure is shown here, once, as a toast.
  const connectGitHub = useCallback(async () => {
    try {
      const response = await apiFetch('/api/github/connect', { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: { ticket?: unknown } = await response.json();
      if (typeof data.ticket !== 'string' || data.ticket === '') throw new Error('No connect ticket');
      window.location.assign(`${API_BASE_URL}/auth/github?ticket=${encodeURIComponent(data.ticket)}`);
    } catch {
      console.error('GitHub connection could not be started');
      toast({ title: 'GitHub could not be connected', description: 'Please try again.', variant: 'destructive' });
    }
  }, []);

  // DELETE /api/github/connection: the server asks GitHub to revoke the token (best effort)
  // and deletes the stored connection. Resolves true when the connection is gone; the
  // caller (DashboardLayout) shows the outcome, so there is no toast here.
  const disconnect = useCallback(async (): Promise<boolean> => {
    try {
      const response = await apiFetch('/api/github/connection', { method: 'DELETE' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      resetState();
      return true;
    } catch {
      console.error('GitHub disconnect failed');
      await refresh();
      return false;
    }
  }, [refresh, resetState]);

  const value = useMemo<GitHubContextType>(() => ({
    isConnected,
    user,
    isLoading,
    connectGitHub,
    disconnect,
    refresh
  }), [isConnected, user, isLoading, connectGitHub, disconnect, refresh]);

  return (
    <GitHubContext.Provider value={value}>
      {children}
    </GitHubContext.Provider>
  );
};

export const useGitHub = (): GitHubContextType => {
  const context = useContext(GitHubContext);
  if (context === undefined) {
    throw new Error('useGitHub must be used within a GitHubProvider');
  }
  return context;
};

export default GitHubProvider;
