import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabaseClient';
import { UserProfile, UserRole } from '../types/database';

export type AuthPortalStatus =
  | 'unconfigured'
  | 'loading'
  | 'unauthenticated'
  | 'authenticated_admin'
  | 'authenticated_non_admin'
  | 'missing_profile';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  role: UserRole | null;
  status: AuthPortalStatus;
  loading: boolean;
  error: string | null;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<AuthPortalStatus>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeRequestId = useRef(0);
  const isConfigured = useMemo(() => isSupabaseConfigured(), []);

  const fetchProfileForUser = useCallback(
    async (currentUser: User | null): Promise<{ profile: UserProfile | null; error: string | null }> => {
      if (!currentUser || !isConfigured) return { profile: null, error: null };

      try {
        const { data, error: profileErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profileErr) {
          console.error('Error fetching profile:', profileErr.message);
          return { profile: null, error: profileErr.message };
        }
        return { profile: (data as UserProfile) || null, error: null };
      } catch (err: any) {
        console.error('Profile fetch exception:', err);
        return { profile: null, error: err.message || 'Unknown network error' };
      }
    },
    [isConfigured]
  );

  const evaluateAuthState = useCallback(
    async (currentSession: Session | null) => {
      const requestId = ++activeRequestId.current;

      if (!isConfigured) {
        setStatus('unconfigured');
        setLoading(false);
        return;
      }

      if (!currentSession || !currentSession.user) {
        setUser(null);
        setSession(null);
        setProfile(null);
        setStatus('unauthenticated');
        setError(null);
        setLoading(false);
        return;
      }

      setUser(currentSession.user);
      setSession(currentSession);
      setLoading(true);

      const { profile: userProfile, error: fetchErr } = await fetchProfileForUser(currentSession.user);

      // Discard stale response if a newer auth request or sign-out was issued in the meantime
      if (requestId !== activeRequestId.current) return;

      setProfile(userProfile);
      setLoading(false);

      if (fetchErr) {
        // Distinguish network/database query errors from missing profiles
        setStatus('unauthenticated');
        setError(`Failed to load user profile: ${fetchErr}`);
      } else if (!userProfile) {
        // Genuinely missing profile row in public.profiles
        setStatus('missing_profile');
        setError('Your login succeeded, but no profile record was found in the database. Please contact the administrator.');
      } else if (userProfile.role === 'admin') {
        setStatus('authenticated_admin');
        setError(null);
      } else {
        setStatus('authenticated_non_admin');
        setError(`Access denied. Account role is "${userProfile.role}". Admin privileges are required.`);
      }
    },
    [isConfigured, fetchProfileForUser]
  );

  useEffect(() => {
    let mounted = true;

    if (!isConfigured) {
      setStatus('unconfigured');
      setLoading(false);
      return;
    }

    setLoading(true);

    // Initial session retrieval
    supabase.auth.getSession().then(({ data: { session: initSession }, error: sessionErr }) => {
      if (!mounted) return;
      if (sessionErr) {
        console.error('Session retrieval error:', sessionErr.message);
        setError(sessionErr.message);
        setStatus('unauthenticated');
        setLoading(false);
        return;
      }
      evaluateAuthState(initSession);
    });

    // Listen to auth events (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      evaluateAuthState(newSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isConfigured, evaluateAuthState]);

  const signIn = async (email: string, password: string): Promise<{ success: boolean; error: string | null }> => {
    if (!isConfigured) {
      const err = getSupabaseConfigStatus().message;
      setError(err);
      return { success: false, error: err };
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInErr) {
        const errorMsg = signInErr.message || 'Invalid email or password';
        setError(errorMsg);
        setLoading(false);
        return { success: false, error: errorMsg };
      }

      await evaluateAuthState(data.session);
      return { success: true, error: null };
    } catch (err: any) {
      const msg = err.message || 'An unexpected error occurred during sign in';
      setError(msg);
      setLoading(false);
      return { success: false, error: msg };
    }
  };

  const signOut = async () => {
    // Invalidate any inflight profile fetches immediately
    activeRequestId.current++;

    if (isConfigured) {
      await supabase.auth.signOut().catch((e) => console.warn('Sign out warning:', e));
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setError(null);
    setStatus(isConfigured ? 'unauthenticated' : 'unconfigured');
    setLoading(false);
  };

  const refreshProfile = async () => {
    if (!user) return;
    const requestId = ++activeRequestId.current;
    setLoading(true);

    const { profile: p, error: fetchErr } = await fetchProfileForUser(user);

    if (requestId !== activeRequestId.current) return;

    setProfile(p);
    setLoading(false);

    if (fetchErr) {
      setError(`Failed to refresh profile: ${fetchErr}`);
    } else if (!p) {
      setStatus('missing_profile');
      setError('Your profile record no longer exists in the database. Please contact the administrator.');
    } else if (p.role === 'admin') {
      setStatus('authenticated_admin');
      setError(null);
    } else {
      setStatus('authenticated_non_admin');
      setError(`Access denied. Account role is "${p.role}". Admin privileges are required.`);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        role: profile?.role || null,
        status,
        loading,
        error,
        isConfigured,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
