import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { apiFetch, getApiErrorCode } from '@/lib/apiClient';
import { useAuth } from '@/contexts/AuthContext';

interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

interface GitHubContextType {
  isConnected: boolean;
  user: GitHubUser | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  connectGitHub: () => void;
  disconnect: () => void;
  setTokenFromCallback: (token: string) => void;
}

const GitHubContext = createContext<GitHubContextType | undefined>(undefined);

// The GitHub session token and the Supabase user id it was connected under.
// A token is only ever used for the user recorded next to it.
const TOKEN_KEY = 'github_token';
const OWNER_KEY = 'github_token_owner';
const RECONNECT_MESSAGE = 'Authentication failed. Please reconnect.';

interface GitHubProviderProps {
  children: ReactNode;
}

export const GitHubProvider: React.FC<GitHubProviderProps> = ({ children }) => {
  const { user: authUser, loading: authLoading } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [user, setUser] = useState<GitHubUser | null>(null);
  // Not read from storage up front: a stored token is exposed only after its owner is checked
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A token arrived from /auth/success before the Supabase user had loaded.
  // In memory only: after a reload such a token has no owner marker and is discarded.
  const pendingOwnerRef = useRef(false);
  const [pendingTick, setPendingTick] = useState(0);

  // Latest auth state for callbacks that must keep a stable identity
  const authRef = useRef({ user: authUser, loading: authLoading });
  authRef.current = { user: authUser, loading: authLoading };

  // Incremented by every validation and disconnect, so stale validation results are ignored
  const generationRef = useRef(0);

  // Disconnect and clear all data
  const disconnect = useCallback(() => {
    generationRef.current++;
    setToken(null);
    setUser(null);
    setIsConnected(false);
    setError(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(OWNER_KEY);
  }, []);

  // Validate token and set user
  const validateAndSetUser = useCallback(async (authToken: string) => {
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current;

    try {
      setIsLoading(true);
      setError(null);

      // Only data.user is needed, so ask for the smallest page
      const response = await apiFetch('/api/github/repositories?page=1&per_page=1', {}, { githubToken: authToken });
      if (!isCurrent()) return;

      if (response.ok) {
        const data = await response.json();
        if (!isCurrent()) return;
        setUser(data.user);
        setIsConnected(true);
        return;
      }

      const code = await getApiErrorCode(response);
      if (!isCurrent()) return;

      // A transient Supabase problem must not delete the GitHub token
      if (response.status === 503 || (response.status === 401 && code === 'AUTH_REQUIRED')) {
        setUser(null);
        setIsConnected(false);
        return;
      }

      // GITHUB_AUTH_INVALID, GITHUB_AUTH_REQUIRED and any other failure
      throw new Error('Invalid or expired token');
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof TypeError) {
        // Network failure (server unreachable): keep the token, report not connected
        console.error('Token validation failed: server unreachable');
        setUser(null);
        setIsConnected(false);
        return;
      }
      console.error('Token validation failed:', error);
      disconnect();
      setError(RECONNECT_MESSAGE);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [disconnect]);

  // GitHub access follows the Supabase user: cleared on sign-out, on a user switch
  // and when the stored owner marker is missing
  useEffect(() => {
    if (authLoading) return;

    if (pendingOwnerRef.current) {
      pendingOwnerRef.current = false;
      const pendingToken = localStorage.getItem(TOKEN_KEY);
      if (!authUser || !pendingToken) {
        disconnect();
        setIsLoading(false);
        return;
      }
      localStorage.setItem(OWNER_KEY, authUser.id);
      setToken(pendingToken);
      validateAndSetUser(pendingToken);
      return;
    }

    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedOwner = localStorage.getItem(OWNER_KEY);

    if (!authUser || !savedToken || savedOwner !== authUser.id) {
      disconnect();
      setIsLoading(false);
      return;
    }

    setToken(savedToken);
    validateAndSetUser(savedToken);
  }, [authLoading, authUser?.id, pendingTick, disconnect, validateAndSetUser]);

  // Initiate GitHub OAuth flow
  const connectGitHub = useCallback(() => {
    try {
      setError(null);
      // Navigate (not fetch) so the server's OAuth state cookie is set first-party,
      // then the server redirects to GitHub
      window.location.href = `${API_BASE_URL}/auth/github`;
    } catch (error) {
      console.error('GitHub connection error:', error);
      setError('Failed to connect to GitHub. Please try again.');
    }
  }, []);

  // Set token from OAuth callback
  const setTokenFromCallback = useCallback((authToken: string) => {
    const { user: currentUser, loading } = authRef.current;
    setToken(authToken);
    localStorage.setItem(TOKEN_KEY, authToken);

    if (!loading && currentUser) {
      pendingOwnerRef.current = false;
      localStorage.setItem(OWNER_KEY, currentUser.id);
      validateAndSetUser(authToken);
      return;
    }

    // The owner is decided once auth has loaded (see the effect above).
    // Drop any marker left by a previous user so a reload cannot reuse it.
    localStorage.removeItem(OWNER_KEY);
    pendingOwnerRef.current = true;
    setPendingTick((tick) => tick + 1);
  }, [validateAndSetUser]);

  const value = useMemo<GitHubContextType>(() => ({
    isConnected,
    user,
    token,
    isLoading,
    error,
    connectGitHub,
    disconnect,
    setTokenFromCallback
  }), [isConnected, user, token, isLoading, error, connectGitHub, disconnect, setTokenFromCallback]);

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
