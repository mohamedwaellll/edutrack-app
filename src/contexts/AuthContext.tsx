import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabaseClient';
import { UserProfile, UserRole } from '../types/database';

export type AuthPortalStatus =
  | 'unconfigured'
  | 'loading'
  | 'unauthenticated'
  | 'signing_out'
  | 'signout_error'
  | 'authenticated_admin'
  | 'authenticated_teacher'
  | 'authenticated_student'
  | 'authenticated_parent'
  | 'missing_profile'
  | 'profile_error'
  | 'unknown_role';

export interface AuthDecisionInput {
  isConfigured: boolean;
  session: Session | null;
  profile: UserProfile | null;
  profileError: string | null;
}

export interface AuthAccessDecision {
  status: AuthPortalStatus;
  error: string | null;
}

/**
 * Pure, fail-closed access decision shared across sign-in, session restore,
 * auth state changes, and manual profile re-verification.
 */
export function resolveAuthAccessDecision({
  isConfigured,
  session,
  profile,
  profileError,
}: AuthDecisionInput): AuthAccessDecision {
  if (!isConfigured) {
    return { status: 'unconfigured', error: null };
  }

  if (!session || !session.user) {
    return { status: 'unauthenticated', error: null };
  }

  if (profileError) {
    return {
      status: 'profile_error',
      error: `Failed to verify user profile: ${profileError}`,
    };
  }

  if (!profile) {
    return {
      status: 'missing_profile',
      error:
        'Your login succeeded, but no profile record was found in the database. Please contact the administrator.',
    };
  }

  if (profile.id !== session.user.id) {
    return {
      status: 'profile_error',
      error: 'Profile verification mismatch for the active session user.',
    };
  }

  switch (profile.role) {
    case 'admin':
      return { status: 'authenticated_admin', error: null };
    case 'teacher':
      return { status: 'authenticated_teacher', error: null };
    case 'student':
      return { status: 'authenticated_student', error: null };
    case 'parent':
      return { status: 'authenticated_parent', error: null };
    default:
      return {
        status: 'unknown_role',
        error: `Unrecognized account role "${String(profile.role)}". Please contact the administrator.`,
      };
  }
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  role: UserRole | null;
  status: AuthPortalStatus;
  loading: boolean;
  isRevalidating: boolean;
  error: string | null;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error: string | null }>;
  signOut: () => Promise<{ success: boolean; error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isVerifiedRoleStatus(status: AuthPortalStatus): boolean {
  return (
    status === 'authenticated_admin' ||
    status === 'authenticated_teacher' ||
    status === 'authenticated_student' ||
    status === 'authenticated_parent'
  );
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<AuthPortalStatus>('loading');
  const [loading, setLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRequestId = useRef(0);
  const statusRef = useRef<AuthPortalStatus>('loading');
  const verifiedUserIdRef = useRef<string | null>(null);
  const signingOutUserIdRef = useRef<string | null>(null);
  const signOutInProgressRef = useRef(false);
  const isConfigured = useMemo(() => isSupabaseConfigured(), []);

  const updateStatus = useCallback((nextStatus: AuthPortalStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

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
    async (currentSession: Session | null, event?: string) => {
      const isSigningOutState =
        signOutInProgressRef.current ||
        statusRef.current === 'signing_out' ||
        statusRef.current === 'signout_error';

      // Ignore passive background refresh/restore events AND duplicate SIGNED_IN for the outgoing account
      // while signing out or locked on signout_error
      if (isSigningOutState) {
        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
          return;
        }
        if (
          event === 'SIGNED_IN' &&
          currentSession?.user?.id &&
          signingOutUserIdRef.current &&
          currentSession.user.id === signingOutUserIdRef.current
        ) {
          return;
        }
        if (signOutInProgressRef.current && event === 'SIGNED_OUT') {
          // Let signOut() confirm { error } vs success cleanly before transitioning to unauthenticated
          return;
        }
      }

      const requestId = ++activeRequestId.current;

      if (!isConfigured || !currentSession || !currentSession.user) {
        verifiedUserIdRef.current = null;
        signingOutUserIdRef.current = null;
        signOutInProgressRef.current = false;
        setIsRevalidating(false);

        const decision = resolveAuthAccessDecision({
          isConfigured,
          session: null,
          profile: null,
          profileError: null,
        });
        setUser(null);
        setSession(null);
        setProfile(null);
        updateStatus(decision.status);
        setError(decision.error);
        setLoading(false);
        return;
      }

      const previousStatus = statusRef.current;
      const isSameVerifiedUser =
        Boolean(verifiedUserIdRef.current) &&
        verifiedUserIdRef.current === currentSession.user.id &&
        isVerifiedRoleStatus(previousStatus) &&
        event !== 'SIGNED_OUT';

      if (isSameVerifiedUser) {
        // Same verified identity (e.g., TOKEN_REFRESHED or duplicate SIGNED_IN):
        // Keep current portal mounted so active tab/modals/unsaved drafts survive if role holds,
        // while locking protected mutations via isRevalidating until profile verification completes.
        setUser(currentSession.user);
        setSession(currentSession);
        setIsRevalidating(true);
        setError(null);

        const { profile: userProfile, error: fetchErr } = await fetchProfileForUser(currentSession.user);

        if (requestId !== activeRequestId.current) return;

        const decision = resolveAuthAccessDecision({
          isConfigured: true,
          session: currentSession,
          profile: userProfile,
          profileError: fetchErr,
        });

        setIsRevalidating(false);

        if (decision.status === previousStatus) {
          verifiedUserIdRef.current = currentSession.user.id;
          setProfile(userProfile);
          updateStatus(decision.status);
          setError(null);
          setLoading(false);
          return;
        }

        // Role changed or verification failed -> revoke previous portal immediately
        verifiedUserIdRef.current = isVerifiedRoleStatus(decision.status) ? currentSession.user.id : null;
        setProfile(decision.status === 'profile_error' ? null : userProfile);
        updateStatus(decision.status);
        setError(decision.error);
        setLoading(false);
        return;
      }

      // Different identity or unverified state -> immediately hide prior protected UI while verifying
      verifiedUserIdRef.current = null;
      setIsRevalidating(false);
      setUser(currentSession.user);
      setSession(currentSession);
      setProfile(null);
      updateStatus('loading');
      setError(null);
      setLoading(true);

      const { profile: userProfile, error: fetchErr } = await fetchProfileForUser(currentSession.user);

      // Discard stale response if a newer auth request, event, or sign-out occurred in the meantime
      if (requestId !== activeRequestId.current) return;

      const decision = resolveAuthAccessDecision({
        isConfigured: true,
        session: currentSession,
        profile: userProfile,
        profileError: fetchErr,
      });

      verifiedUserIdRef.current = isVerifiedRoleStatus(decision.status) ? currentSession.user.id : null;
      setProfile(decision.status === 'profile_error' ? null : userProfile);
      updateStatus(decision.status);
      setError(decision.error);
      setLoading(false);
    },
    [isConfigured, fetchProfileForUser, updateStatus]
  );

  useEffect(() => {
    let mounted = true;

    if (!isConfigured) {
      updateStatus('unconfigured');
      setLoading(false);
      return;
    }

    updateStatus('loading');
    setLoading(true);
    const initEpoch = ++activeRequestId.current;

    // Initial session retrieval (discarded if a newer auth event or sign-out occurs before it resolves)
    supabase.auth.getSession().then(({ data: { session: initSession }, error: sessionErr }) => {
      if (!mounted || initEpoch !== activeRequestId.current) return;
      if (sessionErr) {
        console.error('Session retrieval error:', sessionErr.message);
        verifiedUserIdRef.current = null;
        setIsRevalidating(false);
        setUser(null);
        setSession(null);
        setProfile(null);
        setError(sessionErr.message);
        updateStatus('unauthenticated');
        setLoading(false);
        return;
      }
      evaluateAuthState(initSession, 'INITIAL_SESSION');
    });

    // Listen to auth events (login, logout, token refresh, account switches)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      evaluateAuthState(newSession, event);
    });

    return () => {
      mounted = false;
      activeRequestId.current++;
      subscription.unsubscribe();
    };
  }, [isConfigured, evaluateAuthState, updateStatus]);

  const signIn = async (email: string, password: string): Promise<{ success: boolean; error: string | null }> => {
    if (!isConfigured) {
      const err = getSupabaseConfigStatus().message;
      setError(err);
      return { success: false, error: err };
    }

    signOutInProgressRef.current = false;
    verifiedUserIdRef.current = null;
    signingOutUserIdRef.current = null;
    setIsRevalidating(false);
    const signInEpoch = ++activeRequestId.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInErr) {
        const errorMsg = signInErr.message || 'Invalid email or password';
        if (signInEpoch === activeRequestId.current) {
          setError(errorMsg);
          updateStatus('unauthenticated');
          setLoading(false);
        }
        return { success: false, error: errorMsg };
      }

      if (signInEpoch === activeRequestId.current) {
        await evaluateAuthState(data.session, 'SIGNED_IN');
      }
      return { success: true, error: null };
    } catch (err: any) {
      const msg = err.message || 'An unexpected error occurred during sign in';
      if (signInEpoch === activeRequestId.current) {
        setError(msg);
        updateStatus('unauthenticated');
        setLoading(false);
      }
      return { success: false, error: msg };
    }
  };

  const signOut = async (): Promise<{ success: boolean; error: string | null }> => {
    // Invalidate any inflight getSession, token refresh, or profile fetches immediately
    const signOutEpoch = ++activeRequestId.current;
    const outgoingUserId =
      user?.id ?? session?.user?.id ?? verifiedUserIdRef.current ?? signingOutUserIdRef.current;
    signingOutUserIdRef.current = outgoingUserId || null;
    verifiedUserIdRef.current = null;
    signOutInProgressRef.current = true;

    // Immediately revoke all protected data and profile state from UI
    setUser(null);
    setSession(null);
    setProfile(null);
    setError(null);
    setIsRevalidating(false);

    if (!isConfigured) {
      signOutInProgressRef.current = false;
      signingOutUserIdRef.current = null;
      updateStatus('unconfigured');
      setLoading(false);
      return { success: true, error: null };
    }

    updateStatus('signing_out');
    setLoading(true);

    try {
      const res = await supabase.auth.signOut();

      if (signOutEpoch !== activeRequestId.current) {
        return { success: false, error: 'Sign out was superseded by a newer session event.' };
      }

      if (res?.error) {
        const errMsg = res.error.message || 'Unable to confirm sign out. Please retry.';
        signOutInProgressRef.current = false;
        setError(errMsg);
        updateStatus('signout_error');
        setLoading(false);
        return { success: false, error: errMsg };
      }

      signOutInProgressRef.current = false;
      signingOutUserIdRef.current = null;
      setUser(null);
      setSession(null);
      setProfile(null);
      setError(null);
      updateStatus('unauthenticated');
      setLoading(false);
      return { success: true, error: null };
    } catch (err: any) {
      if (signOutEpoch !== activeRequestId.current) {
        return { success: false, error: 'Sign out was superseded by a newer session event.' };
      }
      const errMsg = err?.message || 'Unable to confirm sign out. Please retry.';
      signOutInProgressRef.current = false;
      setError(errMsg);
      updateStatus('signout_error');
      setLoading(false);
      return { success: false, error: errMsg };
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    const requestId = ++activeRequestId.current;
    verifiedUserIdRef.current = null;
    setIsRevalidating(false);

    // Immediately hide prior access state while re-verifying the current session profile
    setProfile(null);
    updateStatus('loading');
    setError(null);
    setLoading(true);

    const { profile: p, error: fetchErr } = await fetchProfileForUser(user);

    if (requestId !== activeRequestId.current) return;

    const effectiveSession = session ?? ({ user } as Session);
    const decision = resolveAuthAccessDecision({
      isConfigured,
      session: effectiveSession,
      profile: p,
      profileError: fetchErr,
    });

    verifiedUserIdRef.current = isVerifiedRoleStatus(decision.status) ? user.id : null;
    setProfile(decision.status === 'profile_error' ? null : p);
    updateStatus(decision.status);
    setError(decision.error);
    setLoading(false);
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
        isRevalidating,
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

export const useOptionalAuth = (): AuthContextValue | null => {
  return useContext(AuthContext) ?? null;
};
