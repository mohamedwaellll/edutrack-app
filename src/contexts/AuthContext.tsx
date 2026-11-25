import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabaseClient';
import { UserProfile } from '../types/database';
import {
  AuthContext,
  AuthPortalStatus,
  clearRecoveryUrl,
  clearTabRecoveryBinding,
  clearTabRecoverySignOutPending,
  extractSessionIdFromSession,
  getPasswordResetRedirectUrl,
  inspectRecoveryLocation,
  matchesTabRecoveryBinding,
  readTabRecoveryBinding,
  readTabRecoverySignOutPending,
  resolveAuthAccessDecision,
  setTabRecoveryBinding,
  setTabRecoverySignOutPending,
  TabRecoveryBinding,
} from './authState';

function isRecoverySessionExpiredError(message: string): boolean {
  return /session_not_found|auth session missing|jwt expired|token has expired|otp_expired|invalid refresh token|invalid claim|recovery session/i.test(
    message
  );
}

function isVerifiedRoleStatus(status: AuthPortalStatus): boolean {
  return (
    status === 'authenticated_admin' ||
    status === 'authenticated_teacher' ||
    status === 'authenticated_student' ||
    status === 'authenticated_parent'
  );
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isConfigured = useMemo(() => isSupabaseConfigured(), []);
  const isLocalDemoMode = useMemo(
    () => (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim() === 'edutrack-local-demo-anon-key',
    []
  );
  const [initialUrlInspection] = useState(() => inspectRecoveryLocation());
  const initialPendingRecoverySignOut = useMemo(() => readTabRecoverySignOutPending(), []);

  const initialStatus: AuthPortalStatus = !isConfigured
    ? 'unconfigured'
    : initialUrlInspection.hasRecoveryError
    ? 'recovery_invalid'
    : initialUrlInspection.isRecoveryIntent
    ? 'recovery_verifying'
    : 'loading';

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<AuthPortalStatus>(initialStatus);
  const [loading, setLoading] = useState<boolean>(
    () => isConfigured && !initialUrlInspection.hasRecoveryError
  );
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [sessionInstanceId, setSessionInstanceId] = useState(0);
  const [error, setError] = useState<string | null>(
    () => (initialUrlInspection.hasRecoveryError ? initialUrlInspection.errorMessage : null)
  );
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authInitialView, setAuthInitialView] = useState<'sign_in' | 'forgot_password'>('sign_in');

  const activeRequestId = useRef(0);
  const sessionInstanceIdRef = useRef(0);
  const statusRef = useRef<AuthPortalStatus>(initialStatus);
  const verifiedUserIdRef = useRef<string | null>(null);
  const confirmedRecoverySessionRef = useRef<TabRecoveryBinding | null>(null);
  const recoverySessionEpochRef = useRef(0);
  const initialGetSessionResolvedRef = useRef<boolean>(false);
  const recoveryErrorBypassRef = useRef<boolean>(false);
  const recoverySignOutRequiredRef = useRef<boolean>(Boolean(initialPendingRecoverySignOut));
  const passwordUpdateInFlightRef = useRef<boolean>(false);
  const signingOutUserIdRef = useRef<string | null>(initialPendingRecoverySignOut?.userId ?? null);
  const signOutInProgressRef = useRef(false);

  const updateStatus = useCallback((nextStatus: AuthPortalStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const advanceSessionInstance = useCallback(() => {
    const next = sessionInstanceIdRef.current + 1;
    sessionInstanceIdRef.current = next;
    setSessionInstanceId(next);
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
      } catch (err: unknown) {
        console.error('Profile fetch exception:', err);
        return { profile: null, error: getErrorMessage(err, 'Unknown network error') };
      }
    },
    [isConfigured]
  );

  const evaluateAuthState = useCallback(
    async (
      currentSession: Session | null,
      event?: string,
      options?: { fromInitialGetSession?: boolean }
    ) => {
      const isSigningOutState =
        signOutInProgressRef.current ||
        recoverySignOutRequiredRef.current ||
        statusRef.current === 'signing_out' ||
        statusRef.current === 'signout_error' ||
        statusRef.current === 'recovery_signout_error';

      // Ignore passive background refresh/restore events AND duplicate SIGNED_IN for the outgoing account
      // while signing out or locked on signout_error / recovery_signout_error (except initial F5 session resolution)
      if (isSigningOutState && !options?.fromInitialGetSession) {
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

      // Explicit Supabase PASSWORD_RECOVERY event confirms recovery AND binds it strictly to (userId, session_id)
      if (event === 'PASSWORD_RECOVERY') {
        recoveryErrorBypassRef.current = false;
        verifiedUserIdRef.current = null;
        const recoverySessionId = extractSessionIdFromSession(currentSession);
        if (!isConfigured || !currentSession || !currentSession.user?.id || !recoverySessionId) {
          confirmedRecoverySessionRef.current = null;
          recoverySessionEpochRef.current++;
          clearTabRecoveryBinding();
          setIsRevalidating(false);
          setUser(null);
          setSession(null);
          setProfile(null);
          setError(
            'Unable to verify a valid recovery session identifier from this link. Please request a new reset link.'
          );
          updateStatus('recovery_invalid');
          setLoading(false);
          return;
        }
        const binding: TabRecoveryBinding = {
          userId: currentSession.user.id,
          sessionId: recoverySessionId,
        };
        const isDifferentRecoverySession =
          statusRef.current !== 'password_recovery' ||
          confirmedRecoverySessionRef.current?.userId !== binding.userId ||
          confirmedRecoverySessionRef.current?.sessionId !== binding.sessionId;
        if (isDifferentRecoverySession) {
          recoverySessionEpochRef.current++;
          advanceSessionInstance();
        }
        confirmedRecoverySessionRef.current = binding;
        setTabRecoveryBinding(binding.userId, binding.sessionId);
        setIsRevalidating(false);
        setUser(currentSession.user);
        setSession(currentSession);
        setProfile(null);
        setError(null);
        updateStatus('password_recovery');
        setLoading(false);
        return;
      }

      // If password update already succeeded for this exact recovery session prior to reload, enforce Retry Sign Out ONLY
      const pendingRecoverySignOut = readTabRecoverySignOutPending();
      const incomingSessionIdForSignOut = extractSessionIdFromSession(currentSession);
      if (
        pendingRecoverySignOut &&
        currentSession?.user?.id === pendingRecoverySignOut.userId &&
        incomingSessionIdForSignOut === pendingRecoverySignOut.sessionId
      ) {
        recoverySignOutRequiredRef.current = true;
        signingOutUserIdRef.current = currentSession.user.id;
        verifiedUserIdRef.current = null;
        confirmedRecoverySessionRef.current = null;
        clearTabRecoveryBinding();
        setIsRevalidating(false);
        setUser(null);
        setSession(null);
        setProfile(null);
        setError(
          'Your password was updated, but ending the recovery session did not complete. Please retry sign out.'
        );
        updateStatus('recovery_signout_error');
        setLoading(false);
        return;
      }
      if (pendingRecoverySignOut) {
        recoverySignOutRequiredRef.current = false;
        signingOutUserIdRef.current = null;
        recoveryErrorBypassRef.current = true;
        clearTabRecoverySignOutPending();
        clearRecoveryUrl();
        if (!currentSession || !currentSession.user) {
          setAuthInitialView('sign_in');
          setAuthNotice('Password updated successfully. Please sign in with your new password.');
        }
      }

      // Guard invalid/expired recovery link parameters even if a stale normal session exists in storage
      const liveUrlInspection = recoveryErrorBypassRef.current ? null : inspectRecoveryLocation();
      if (
        liveUrlInspection?.hasRecoveryError ||
        (initialUrlInspection.hasRecoveryError && !recoveryErrorBypassRef.current)
      ) {
        verifiedUserIdRef.current = null;
        confirmedRecoverySessionRef.current = null;
        recoverySessionEpochRef.current++;
        clearTabRecoveryBinding();
        setIsRevalidating(false);
        setUser(null);
        setSession(null);
        setProfile(null);
        setError(
          liveUrlInspection?.errorMessage ||
            initialUrlInspection.errorMessage ||
            'This password reset link is invalid or has expired. Please request a new reset link.'
        );
        updateStatus('recovery_invalid');
        setLoading(false);
        return;
      }

      const isOnRecoveryRoute =
        !recoveryErrorBypassRef.current && Boolean(liveUrlInspection?.isRecoveryIntent);
      const storedBinding = readTabRecoveryBinding();
      const activeRecoveryBinding = confirmedRecoverySessionRef.current ?? storedBinding;

      // Handle an already-confirmed recovery binding (live in-tab OR restored on F5 refresh)
      if (activeRecoveryBinding) {
        verifiedUserIdRef.current = null;
        setIsRevalidating(false);

        const incomingSessionId = extractSessionIdFromSession(currentSession);
        if (!isConfigured || !currentSession || !currentSession.user || event === 'SIGNED_OUT') {
          confirmedRecoverySessionRef.current = null;
          recoverySessionEpochRef.current++;
          clearTabRecoveryBinding();
          advanceSessionInstance();
          setUser(null);
          setSession(null);
          setProfile(null);
          setError('Your recovery session expired or ended. Please request a new reset link.');
          updateStatus('recovery_invalid');
          setLoading(false);
          return;
        }

        // Exact (userId, session_id) match:
        // - TOKEN_REFRESHED / USER_UPDATED inside the SAME session_id rotates token while preserving form & drafts
        // - INITIAL_SESSION / getSession restore on F5 refresh restores the recovery form cleanly
        if (
          incomingSessionId &&
          event !== 'SIGNED_IN' &&
          matchesTabRecoveryBinding(currentSession, activeRecoveryBinding)
        ) {
          const verifiedBinding: TabRecoveryBinding = {
            userId: currentSession.user.id,
            sessionId: incomingSessionId,
          };
          confirmedRecoverySessionRef.current = verifiedBinding;
          setTabRecoveryBinding(verifiedBinding.userId, verifiedBinding.sessionId);
          setUser(currentSession.user);
          setSession(currentSession);
          setProfile(null);
          setError(null);
          updateStatus('password_recovery');
          setLoading(false);
          return;
        }

        // Different session_id (even for same user), missing session_id, account switch, or new SIGNED_IN login:
        // Immediately invalidate previous recovery state and cancel the old form.
        confirmedRecoverySessionRef.current = null;
        recoverySessionEpochRef.current++;
        clearTabRecoveryBinding();
        advanceSessionInstance();

        if (isOnRecoveryRoute || statusRef.current === 'password_recovery') {
          // If navigating/signed-in explicitly OUTSIDE /reset-password (not SIGNED_IN on /reset-password),
          // only keep recovery_invalid when on /reset-password or when a new non-dashboard session replaces it;
          // wait: if URL is /reset-password -> always cancel to recovery_invalid (never dashboard on /reset-password).
          // If URL is NOT /reset-password and SIGNED_IN arrived -> fall through to new session if valid, cancelling form.
          if (isOnRecoveryRoute || event !== 'SIGNED_IN') {
            setUser(null);
            setSession(null);
            setProfile(null);
            setError(
              'Unable to prove recovery session continuity (session changed or expired). Please request a new reset link.'
            );
            updateStatus('recovery_invalid');
            setLoading(false);
            return;
          }
        }
        // Outside /reset-password with a new SIGNED_IN -> old form cancelled, fall through to evaluate new session
      }

      // Unconfirmed /reset-password route: NEVER accept INITIAL_SESSION, SIGNED_IN, or prior session alone
      if (isOnRecoveryRoute) {
        verifiedUserIdRef.current = null;
        setIsRevalidating(false);
        setUser(null);
        setSession(null);
        setProfile(null);

        if (options?.fromInitialGetSession || initialGetSessionResolvedRef.current) {
          setError(
            'Unable to confirm a password recovery session from this link. Please request a new reset link.'
          );
          updateStatus('recovery_invalid');
          setLoading(false);
        } else {
          setError(null);
          updateStatus('recovery_verifying');
          setLoading(true);
        }
        return;
      }

      if (!isConfigured || !currentSession || !currentSession.user) {
        verifiedUserIdRef.current = null;
        confirmedRecoverySessionRef.current = null;
        signingOutUserIdRef.current = null;
        signOutInProgressRef.current = false;
        setIsRevalidating(false);
        advanceSessionInstance();

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
        advanceSessionInstance();
        setProfile(decision.status === 'profile_error' ? null : userProfile);
        updateStatus(decision.status);
        setError(decision.error);
        setLoading(false);
        return;
      }

      // Different identity or unverified state -> immediately hide prior protected UI while verifying
      verifiedUserIdRef.current = null;
      advanceSessionInstance();
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
    [isConfigured, initialUrlInspection, fetchProfileForUser, updateStatus, advanceSessionInstance]
  );

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    let mounted = true;
    initialGetSessionResolvedRef.current = false;
    const reqIdRef = activeRequestId;
    const initEpoch = ++reqIdRef.current;

    // Initial session retrieval (discarded if a newer auth event or sign-out occurs before it resolves)
    supabase.auth
      .getSession()
      .then(({ data: { session: initSession }, error: sessionErr }) => {
        if (!mounted) return;
        if (initEpoch !== reqIdRef.current && statusRef.current !== 'recovery_verifying') return;
        initialGetSessionResolvedRef.current = true;
        if (initialUrlInspection.hasRecoveryError && !recoveryErrorBypassRef.current) {
          return;
        }
        if (sessionErr) {
          console.error('Session retrieval error:', sessionErr.message);
          verifiedUserIdRef.current = null;
          confirmedRecoverySessionRef.current = null;
          clearTabRecoveryBinding();
          advanceSessionInstance();
          setIsRevalidating(false);
          setUser(null);
          setSession(null);
          setProfile(null);
          setError(sessionErr.message);
          if (readTabRecoverySignOutPending()) {
            recoverySignOutRequiredRef.current = true;
            updateStatus('recovery_signout_error');
          } else if (!recoveryErrorBypassRef.current && initialUrlInspection.isRecoveryIntent) {
            updateStatus('recovery_invalid');
          } else {
            updateStatus('unauthenticated');
          }
          setLoading(false);
          return;
        }
        evaluateAuthState(initSession, 'INITIAL_SESSION', { fromInitialGetSession: true });
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        if (initEpoch !== reqIdRef.current && statusRef.current !== 'recovery_verifying') return;
        initialGetSessionResolvedRef.current = true;
        const msg = getErrorMessage(err, 'Failed to verify current session.');
        verifiedUserIdRef.current = null;
        confirmedRecoverySessionRef.current = null;
        clearTabRecoveryBinding();
        advanceSessionInstance();
        setIsRevalidating(false);
        setUser(null);
        setSession(null);
        setProfile(null);
        setError(msg);
        if (readTabRecoverySignOutPending()) {
          recoverySignOutRequiredRef.current = true;
          updateStatus('recovery_signout_error');
        } else if (!recoveryErrorBypassRef.current && initialUrlInspection.isRecoveryIntent) {
          updateStatus('recovery_invalid');
        } else {
          updateStatus('unauthenticated');
        }
        setLoading(false);
      });

    // Listen to auth events (login, logout, token refresh, recovery, account switches)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      evaluateAuthState(newSession, event);
    });

    return () => {
      mounted = false;
      reqIdRef.current++;
      subscription.unsubscribe();
    };
  }, [isConfigured, initialUrlInspection, evaluateAuthState, updateStatus, advanceSessionInstance]);

  const signIn = async (email: string, password: string): Promise<{ success: boolean; error: string | null }> => {
    if (!isConfigured) {
      const err = getSupabaseConfigStatus().message;
      setError(err);
      return { success: false, error: err };
    }

    signOutInProgressRef.current = false;
    recoverySignOutRequiredRef.current = false;
    confirmedRecoverySessionRef.current = null;
    recoverySessionEpochRef.current++;
    recoveryErrorBypassRef.current = true;
    verifiedUserIdRef.current = null;
    signingOutUserIdRef.current = null;
    clearTabRecoveryBinding();
    clearTabRecoverySignOutPending();
    clearRecoveryUrl();
    setAuthNotice(null);
    setAuthInitialView('sign_in');
    advanceSessionInstance();
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
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'An unexpected error occurred during sign in');
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
    confirmedRecoverySessionRef.current = null;
    recoverySessionEpochRef.current++;
    clearTabRecoveryBinding();
    signOutInProgressRef.current = true;
    advanceSessionInstance();

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
      confirmedRecoverySessionRef.current = null;
      recoverySignOutRequiredRef.current = false;
      recoveryErrorBypassRef.current = true;
      clearTabRecoveryBinding();
      clearTabRecoverySignOutPending();
      clearRecoveryUrl();
      setUser(null);
      setSession(null);
      setProfile(null);
      setError(null);
      updateStatus('unauthenticated');
      setLoading(false);
      return { success: true, error: null };
    } catch (err: unknown) {
      if (signOutEpoch !== activeRequestId.current) {
        return { success: false, error: 'Sign out was superseded by a newer session event.' };
      }
      const errMsg = getErrorMessage(err, 'Unable to confirm sign out. Please retry.');
      signOutInProgressRef.current = false;
      setError(errMsg);
      updateStatus('signout_error');
      setLoading(false);
      return { success: false, error: errMsg };
    }
  };

  const requestPasswordReset = useCallback(
    async (email: string): Promise<{ success: boolean; error: string | null }> => {
      if (!isConfigured) {
        const err = getSupabaseConfigStatus().message;
        return { success: false, error: err };
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        return { success: false, error: 'Please enter your email address.' };
      }

      try {
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: getPasswordResetRedirectUrl(),
        });

        if (resetErr) {
          const rawMsg = resetErr.message || 'Unable to send password reset email. Please try again.';
          const code = (resetErr as { code?: string }).code;
          const httpStatus = (resetErr as { status?: number }).status;
          if (
            httpStatus === 501 ||
            code === 'demo_recovery_unsupported' ||
            rawMsg.includes('Unhandled route POST /auth/v1/recover')
          ) {
            return {
              success: false,
              error:
                'Password reset email delivery requires Supabase Auth and is not supported by the local PGlite demo bridge.',
            };
          }
          return { success: false, error: rawMsg };
        }

        return { success: true, error: null };
      } catch (err: unknown) {
        return {
          success: false,
          error: getErrorMessage(err, 'Network error while requesting password reset. Please try again.'),
        };
      }
    },
    [isConfigured]
  );

  const finalizeRecoverySignOut = useCallback(
    async (boundSession?: TabRecoveryBinding | null): Promise<{ success: boolean; error: string | null }> => {
      const signOutEpoch = ++activeRequestId.current;
      const pendingBinding = readTabRecoverySignOutPending() ?? boundSession ?? null;
      if (!pendingBinding) {
        signOutInProgressRef.current = false;
        recoverySignOutRequiredRef.current = false;
        signingOutUserIdRef.current = null;
        recoveryErrorBypassRef.current = true;
        clearRecoveryUrl();
        setAuthInitialView('sign_in');
        setAuthNotice('Password updated successfully. Please sign in with your new password.');
        setError(null);
        updateStatus('unauthenticated');
        setLoading(false);
        return { success: true, error: null };
      }

      signingOutUserIdRef.current = pendingBinding.userId;
      setTabRecoverySignOutPending(pendingBinding.userId, pendingBinding.sessionId);
      recoverySignOutRequiredRef.current = true;
      signOutInProgressRef.current = true;
      confirmedRecoverySessionRef.current = null;
      recoverySessionEpochRef.current++;
      verifiedUserIdRef.current = null;
      clearTabRecoveryBinding();
      advanceSessionInstance();

      setUser(null);
      setSession(null);
      setProfile(null);
      setError(null);
      setIsRevalidating(false);
      updateStatus('signing_out');
      setLoading(true);

      try {
        // Always compare live persisted session against pending { userId, sessionId } before calling signOut
        const { data: liveData, error: liveErr } = await supabase.auth.getSession();
        if (signOutEpoch !== activeRequestId.current) {
          return { success: false, error: 'Sign out was superseded by a newer session event.' };
        }
        if (liveErr) {
          signOutInProgressRef.current = false;
          const errMsg =
            liveErr.message ||
            'Your password was updated, but verifying the recovery session failed temporarily. Please retry sign out.';
          setError(errMsg);
          updateStatus('recovery_signout_error');
          setLoading(false);
          return { success: false, error: errMsg };
        }

        const liveSession = liveData?.session ?? null;
        if (!liveSession) {
          // Original recovery session already gone; complete transition to Sign In without calling signOut
          signOutInProgressRef.current = false;
          signingOutUserIdRef.current = null;
          recoverySignOutRequiredRef.current = false;
          recoveryErrorBypassRef.current = true;
          clearTabRecoverySignOutPending();
          clearRecoveryUrl();
          advanceSessionInstance();
          setAuthInitialView('sign_in');
          setAuthNotice('Password updated successfully. Please sign in with your new password.');
          setError(null);
          updateStatus('unauthenticated');
          setLoading(false);
          return { success: true, error: null };
        }

        const liveSessionId = extractSessionIdFromSession(liveSession);
        const matchesPending = Boolean(
          liveSessionId &&
            liveSession.user?.id === pendingBinding.userId &&
            liveSessionId === pendingBinding.sessionId
        );

        if (!matchesPending) {
          // A different session is now active -> end old recovery state WITHOUT signing out the new session
          signOutInProgressRef.current = false;
          signingOutUserIdRef.current = null;
          recoverySignOutRequiredRef.current = false;
          recoveryErrorBypassRef.current = true;
          clearTabRecoverySignOutPending();
          clearTabRecoveryBinding();
          clearRecoveryUrl();
          updateStatus('loading');
          await evaluateAuthState(liveSession, 'SIGNED_IN');
          return { success: true, error: null };
        }

        const res = await supabase.auth.signOut({ scope: 'local' });
        if (signOutEpoch !== activeRequestId.current) {
          return { success: false, error: 'Sign out was superseded by a newer session event.' };
        }
        if (res?.error) {
          signOutInProgressRef.current = false;
          const errMsg =
            res.error.message ||
            'Your password was updated, but ending the recovery session failed. Please retry sign out.';
          setError(errMsg);
          updateStatus('recovery_signout_error');
          setLoading(false);
          return { success: false, error: errMsg };
        }

        signOutInProgressRef.current = false;
        signingOutUserIdRef.current = null;
        recoverySignOutRequiredRef.current = false;
        recoveryErrorBypassRef.current = true;
        clearTabRecoverySignOutPending();
        clearRecoveryUrl();
        advanceSessionInstance();
        setAuthInitialView('sign_in');
        setAuthNotice('Password updated successfully. Please sign in with your new password.');
        setError(null);
        updateStatus('unauthenticated');
        setLoading(false);
        return { success: true, error: null };
      } catch (err: unknown) {
        if (signOutEpoch !== activeRequestId.current) {
          return { success: false, error: 'Sign out was superseded by a newer session event.' };
        }
        signOutInProgressRef.current = false;
        const errMsg = getErrorMessage(
          err,
          'Your password was updated, but ending the recovery session failed. Please retry sign out.'
        );
        setError(errMsg);
        updateStatus('recovery_signout_error');
        setLoading(false);
        return { success: false, error: errMsg };
      }
    },
    [advanceSessionInstance, updateStatus, evaluateAuthState]
  );

  const updateRecoveryPassword = async (
    newPassword: string
  ): Promise<{ success: boolean; error: string | null }> => {
    if (!isConfigured) {
      return { success: false, error: getSupabaseConfigStatus().message };
    }
    const startEpoch = recoverySessionEpochRef.current;
    const expectedBinding = confirmedRecoverySessionRef.current;
    const storedBinding = readTabRecoveryBinding();
    const currentSessionId = extractSessionIdFromSession(session);
    if (
      statusRef.current !== 'password_recovery' ||
      !user ||
      !session ||
      !expectedBinding ||
      !storedBinding ||
      !currentSessionId ||
      user.id !== expectedBinding.userId ||
      session.user.id !== expectedBinding.userId ||
      currentSessionId !== expectedBinding.sessionId ||
      storedBinding.userId !== expectedBinding.userId ||
      storedBinding.sessionId !== expectedBinding.sessionId
    ) {
      confirmedRecoverySessionRef.current = null;
      recoverySessionEpochRef.current++;
      clearTabRecoveryBinding();
      setUser(null);
      setSession(null);
      setProfile(null);
      const mismatchMsg =
        'No matching verified password recovery session is active. Please request a new reset link.';
      setError(mismatchMsg);
      updateStatus('recovery_invalid');
      return {
        success: false,
        error: mismatchMsg,
      };
    }
    if (passwordUpdateInFlightRef.current || recoverySignOutRequiredRef.current) {
      return { success: false, error: 'Password update is already being processed.' };
    }
    if (newPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    passwordUpdateInFlightRef.current = true;
    try {
      // Confirm the persisted auth session still matches (userId, session_id) after getSession() and before updateUser()
      const { data: liveData, error: liveErr } = await supabase.auth.getSession();

      // If session already switched via auth events while awaiting getSession(), ignore stale request without overwriting new session
      if (recoverySessionEpochRef.current !== startEpoch) {
        return { success: false, error: null };
      }

      const liveSession = liveData?.session ?? null;
      const liveSessionId = extractSessionIdFromSession(liveSession);
      const postGetStoredBinding = readTabRecoveryBinding();
      const postGetMemoryBinding = confirmedRecoverySessionRef.current;
      if (
        statusRef.current !== 'password_recovery' ||
        !postGetMemoryBinding ||
        !postGetStoredBinding ||
        postGetMemoryBinding.userId !== expectedBinding.userId ||
        postGetMemoryBinding.sessionId !== expectedBinding.sessionId ||
        postGetStoredBinding.userId !== expectedBinding.userId ||
        postGetStoredBinding.sessionId !== expectedBinding.sessionId ||
        liveErr ||
        !liveSession ||
        !liveSessionId ||
        liveSession.user.id !== expectedBinding.userId ||
        liveSessionId !== expectedBinding.sessionId
      ) {
        // Session changed in storage before updateUser(): discard stale update without calling updateUser() or signOut()
        confirmedRecoverySessionRef.current = null;
        recoverySessionEpochRef.current++;
        clearTabRecoveryBinding();
        setUser(null);
        setSession(null);
        setProfile(null);
        const msg =
          liveErr?.message ||
          'Your recovery session changed or could not be verified before saving. Please request a new reset link.';
        setError(msg);
        updateStatus('recovery_invalid');
        return { success: false, error: msg };
      }

      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });

      // If session changed while updateUser() was in flight, ignore stale completion (never sign out or clear new session)
      const postUpdateStored = readTabRecoveryBinding();
      if (
        recoverySessionEpochRef.current !== startEpoch ||
        statusRef.current !== 'password_recovery' ||
        confirmedRecoverySessionRef.current?.userId !== expectedBinding.userId ||
        confirmedRecoverySessionRef.current?.sessionId !== expectedBinding.sessionId ||
        !postUpdateStored ||
        postUpdateStored.userId !== expectedBinding.userId ||
        postUpdateStored.sessionId !== expectedBinding.sessionId
      ) {
        return { success: false, error: null };
      }

      if (updateErr) {
        const msg = updateErr.message || 'Unable to update password.';
        if (isRecoverySessionExpiredError(msg)) {
          confirmedRecoverySessionRef.current = null;
          recoverySessionEpochRef.current++;
          clearTabRecoveryBinding();
          setUser(null);
          setSession(null);
          setProfile(null);
          setError(msg);
          updateStatus('recovery_invalid');
        }
        return { success: false, error: msg };
      }

      // Immediately record successful password update & lock save form BEFORE checking/ending session,
      // so even if post-update session read fails over network, the user sees Retry Sign Out ONLY.
      setTabRecoverySignOutPending(expectedBinding.userId, expectedBinding.sessionId);
      recoverySignOutRequiredRef.current = true;
      signingOutUserIdRef.current = expectedBinding.userId;
      confirmedRecoverySessionRef.current = null;
      recoverySessionEpochRef.current++;
      clearTabRecoveryBinding();

      return await finalizeRecoverySignOut(expectedBinding);
    } catch (err: unknown) {
      if (recoverySessionEpochRef.current !== startEpoch || statusRef.current !== 'password_recovery') {
        return { success: false, error: null };
      }
      const msg = getErrorMessage(err, 'Unexpected error while updating password.');
      if (isRecoverySessionExpiredError(msg)) {
        confirmedRecoverySessionRef.current = null;
        recoverySessionEpochRef.current++;
        clearTabRecoveryBinding();
        setUser(null);
        setSession(null);
        setProfile(null);
        setError(msg);
        updateStatus('recovery_invalid');
      }
      return { success: false, error: msg };
    } finally {
      passwordUpdateInFlightRef.current = false;
    }
  };

  const exitRecoveryToAuth = async (view: 'sign_in' | 'forgot_password'): Promise<void> => {
    setAuthInitialView(view);
    setAuthNotice(null);
    if (statusRef.current === 'password_recovery' && user) {
      await signOut();
      return;
    }

    recoveryErrorBypassRef.current = true;
    confirmedRecoverySessionRef.current = null;
    recoverySessionEpochRef.current++;
    verifiedUserIdRef.current = null;
    clearTabRecoveryBinding();
    clearTabRecoverySignOutPending();
    clearRecoveryUrl();
    setUser(null);
    setSession(null);
    setProfile(null);
    setError(null);
    updateStatus('unauthenticated');
    setLoading(false);
  };

  const clearAuthFeedback = useCallback(() => {
    setAuthNotice(null);
    setError(null);
  }, []);

  const refreshProfile = async () => {
    if (!user) return;
    const requestId = ++activeRequestId.current;
    verifiedUserIdRef.current = null;
    advanceSessionInstance();
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
        sessionInstanceId,
        error,
        authNotice,
        authInitialView,
        isConfigured,
        isLocalDemoMode,
        signIn,
        signOut,
        refreshProfile,
        clearAuthFeedback,
        requestPasswordReset,
        updateRecoveryPassword,
        completeRecoverySignOut: () => finalizeRecoverySignOut(),
        exitRecoveryToAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
