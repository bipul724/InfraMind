import { createClient, User as SupabaseUser } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in client/.env');
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerification: boolean;
  prefs: Record<string, any>;
}

// Map a Supabase user onto the app's User shape
const toUser = (user: SupabaseUser): User => {
  const metadata = user.user_metadata || {};
  const provider = user.app_metadata?.provider;

  return {
    id: user.id,
    name: metadata.full_name || metadata.name || user.email?.split('@')[0] || '',
    email: user.email || '',
    emailVerification: !!user.email_confirmed_at,
    prefs: {
      loginProvider: provider,
      avatarUrl: metadata.avatar_url,
      githubUsername: provider === 'github' ? metadata.user_name : undefined,
      ...(metadata.prefs || {}),
    },
  };
};

export class AuthService {
  // Get current user
  static async getCurrentUser(): Promise<User | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      console.log('No active session:', error);
      return null;
    }
    return toUser(data.session.user);
  }

  // Subscribe to sign-in, sign-out and token refresh events
  static onAuthChange(callback: (user: User | null) => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session ? toUser(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  // Login with OAuth (Google)
  static async loginWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      console.error('Google OAuth failed:', error);
      throw error;
    }
  }

  // Login with OAuth (GitHub)
  static async loginWithGitHub(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      console.error('GitHub OAuth failed:', error);
      throw error;
    }
  }

  // Login with email and password
  static async loginWithEmail(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Email login failed:', error);
      throw error;
    }
    return toUser(data.user);
  }

  // Register with email and password
  static async registerWithEmail(email: string, password: string, name: string): Promise<User> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) {
      console.error('Registration failed:', error);
      throw error;
    }
    // With "Confirm email" enabled, Supabase creates the user but no session
    if (!data.session || !data.user) {
      throw new Error('Check your email to confirm your account, then sign in.');
    }
    return toUser(data.user);
  }

  // Logout
  static async logout(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }

  // Delete all sessions (logout from all devices)
  static async logoutAll(): Promise<void> {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) {
      console.error('Logout all failed:', error);
      throw error;
    }
  }

  // Get user preferences
  static async getPreferences(): Promise<Record<string, any>> {
    const user = await this.getCurrentUser();
    return user?.prefs || {};
  }

  // Update user preferences
  static async updatePreferences(prefs: Record<string, any>): Promise<User> {
    const { data, error } = await supabase.auth.updateUser({ data: { prefs } });
    if (error) {
      console.error('Failed to update preferences:', error);
      throw error;
    }
    return toUser(data.user);
  }
}

export { supabase };
