import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthService, User } from '@/lib/supabase';
import { clearResultCache } from '@/lib/resultCache';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: {
    withGoogle: () => Promise<void>;
    withGitHub: () => Promise<void>;
    withEmail: (email: string, password: string) => Promise<User>;
  };
  register: (email: string, password: string, name: string) => Promise<User>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Every change of the signed-in user goes through here. When the user id changes, to
  // another user or to null (sign-out, SIGNED_OUT from another tab, an expired session),
  // per-user client state is cleared first (T-133): sign-out does not reload the page.
  // A token refresh keeps the id and clears nothing.
  const userIdRef = useRef<string | null>(null);
  const applyUser = useCallback((next: User | null) => {
    const nextId = next?.id ?? null;
    if (nextId !== userIdRef.current) {
      userIdRef.current = nextId;
      clearResultCache();
    }
    setUser(next);
  }, []);

  useEffect(() => {
    const checkUserSession = async () => {
      try {
        const currentUser = await AuthService.getCurrentUser();
        applyUser(currentUser);
      } catch (error) {
        console.log('No active session');
      } finally {
        setLoading(false);
      }
    };
    checkUserSession();
    // Picks up OAuth redirects, token refreshes and sign-outs from other tabs
    return AuthService.onAuthChange(applyUser);
  }, [applyUser]);

  const loginWithGoogle = async () => {
    await AuthService.loginWithGoogle();
    // Note: OAuth redirects, so user state will be updated on return
  };

  const loginWithGitHub = async () => {
    await AuthService.loginWithGitHub();
    // Note: OAuth redirects, so user state will be updated on return
  };

  const loginWithEmail = async (email: string, password: string) => {
    const user = await AuthService.loginWithEmail(email, password);
    applyUser(user);
    return user;
  };

  const register = async (email: string, password: string, name: string) => {
    const user = await AuthService.registerWithEmail(email, password, name);
    applyUser(user);
    return user;
  };

  const logout = async () => {
    await AuthService.logout();
    applyUser(null);
  };

  const value: AuthContextType = {
    user,
    loading,
    login: {
      withGoogle: loginWithGoogle,
      withGitHub: loginWithGitHub,
      withEmail: loginWithEmail,
    },
    register,
    logout,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 