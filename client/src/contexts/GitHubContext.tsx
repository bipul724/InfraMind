import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { apiFetch } from '@/lib/apiClient';
import { useAuth } from '@/contexts/AuthContext';

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
  error: string | null;
  connectGitHub: () => Promise<void>;
  disconnect: () => Promise<void>;
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

const STATUS_ERROR_MESSAGE = 'Could not check your GitHub connection. Please try again.';
const CONNECT_ERROR_MESSAGE = 'Failed to connect to GitHub. Please try again.';
const DISCONNECT_ERROR_MESSAGE = 'Failed to disconnect GitHub. Please try again.';

interface GitHubProviderProps {
  children: ReactNode;
}

export const GitHubProvider: React.FC<GitHubProviderProps> = ({ children }) => {
  const { user: authUser, loading: authLoading } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
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
        setError(response.status === 401 ? null : STATUS_ERROR_MESSAGE);
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
      setError(null);
    } catch {
      if (!isCurrent()) return;
      console.error('GitHub status check failed: server unreachable');
      setUser(null);
      setIsConnected(false);
      setError(STATUS_ERROR_MESSAGE);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, []);

  // GitHub state follows the Supabase user: reset on sign-out, re-read on sign-in or user switch
  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      resetState();
      return;
    }
    refresh();
  }, [authLoading, authUser?.id, refresh, resetState]);

  // Ask the server for a one-time ticket, then navigate (not fetch) so the server's
  // OAuth state cookie is set first-party before it redirects to GitHub
  const connectGitHub = useCallback(async () => {
    setError(null);
    try {
      const response = await apiFetch('/api/github/connect', { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: { ticket?: unknown } = await response.json();
      if (typeof data.ticket !== 'string' || data.ticket === '') throw new Error('No connect ticket');
      window.location.assign(`${API_BASE_URL}/auth/github?ticket=${encodeURIComponent(data.ticket)}`);
    } catch {
      console.error('GitHub connection could not be started');
      setError(CONNECT_ERROR_MESSAGE);
    }
  }, []);

  // The server revokes the grant at GitHub and deletes the stored token
  const disconnect = useCallback(async () => {
    setError(null);
    try {
      const response = await apiFetch('/api/github/connection', { method: 'DELETE' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      resetState();
    } catch {
      console.error('GitHub disconnect failed');
      await refresh();
      setError(DISCONNECT_ERROR_MESSAGE);
    }
  }, [refresh, resetState]);

  const value = useMemo<GitHubContextType>(() => ({
    isConnected,
    user,
    isLoading,
    error,
    connectGitHub,
    disconnect,
    refresh
  }), [isConnected, user, isLoading, error, connectGitHub, disconnect, refresh]);

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
