import { createContext, useContext } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { UserProfile, UserRole } from '../types/database';

export type AuthPortalStatus =
  | 'unconfigured'
  | 'loading'
  | 'unauthenticated'
  | 'signing_out'
  | 'signout_error'
  | 'recovery_verifying'
  | 'password_recovery'
  | 'recovery_invalid'
  | 'recovery_signout_error'
  | 'authenticated_admin'
  | 'authenticated_teacher'
  | 'authenticated_student'
  | 'authenticated_parent'
  | 'missing_profile'
  | 'profile_error'
  | 'unknown_role';

export const PASSWORD_RESET_PATH = '/reset-password';
const TAB_RECOVERY_BINDING_KEY = 'edutrack:password_recovery_binding';
const TAB_RECOVERY_SIGNOUT_PENDING_KEY = 'edutrack:recovery_signout_pending';

export interface TabRecoveryBinding {
  userId: string;
  sessionId: string;
}

export function extractSessionIdFromAccessToken(accessToken: string | null | undefined): string | null {
  if (!accessToken || typeof accessToken !== 'string') return null;
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    let jsonStr = '';
    if (typeof atob === 'function') {
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      jsonStr = new TextDecoder().decode(bytes);
    } else if (typeof Buffer !== 'undefined') {
      jsonStr = Buffer.from(padded, 'base64').toString('utf8');
    } else {
      return null;
    }
    const payload = JSON.parse(jsonStr) as { session_id?: unknown };
    if (typeof payload?.session_id === 'string' && payload.session_id.trim().length > 0) {
      return payload.session_id;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractSessionIdFromSession(session: Session | null): string | null {
  if (!session) return null;
  return extractSessionIdFromAccessToken(session.access_token);
}

export interface RecoveryUrlInspection {
  isRecoveryPath: boolean;
  hasRecoveryType: boolean;
  hasAuthCode: boolean;
  hasRecoveryError: boolean;
  errorMessage: string | null;
  isRecoveryIntent: boolean;
}

export function getPasswordResetRedirectUrl(): string {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return PASSWORD_RESET_PATH;
  }
  return `${window.location.origin}${PASSWORD_RESET_PATH}`;
}

export function inspectRecoveryLocation(): RecoveryUrlInspection {
  if (typeof window === 'undefined' || !window.location) {
    return {
      isRecoveryPath: false,
      hasRecoveryType: false,
      hasAuthCode: false,
      hasRecoveryError: false,
      errorMessage: null,
      isRecoveryIntent: false,
    };
  }

  const { pathname, hash, search } = window.location;
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const isRecoveryPath = normalizedPath === PASSWORD_RESET_PATH;

  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const hashType = hashParams.get('type');
  const searchType = searchParams.get('type');
  const hasRecoveryType = hashType === 'recovery' || searchType === 'recovery';
  const hasAuthCode = Boolean(searchParams.get('code'));

  const err = hashParams.get('error') || searchParams.get('error');
  const errCode = hashParams.get('error_code') || searchParams.get('error_code');
  const errDesc = hashParams.get('error_description') || searchParams.get('error_description');

  const isRecoveryErrorContext =
    isRecoveryPath ||
    hasRecoveryType ||
    errCode === 'otp_expired' ||
    Boolean(errDesc && /expired|invalid|recovery/i.test(errDesc));

  const hasRecoveryError = Boolean((err || errCode) && isRecoveryErrorContext);
  const errorMessage = hasRecoveryError
    ? errDesc || 'This password reset link is invalid or has expired. Please request a new reset link.'
    : null;

  const isRecoveryIntent =
    !hasRecoveryError && (isRecoveryPath || hasRecoveryType || (isRecoveryPath && hasAuthCode));

  return {
    isRecoveryPath,
    hasRecoveryType,
    hasAuthCode,
    hasRecoveryError,
    errorMessage,
    isRecoveryIntent,
  };
}

export function clearRecoveryUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState || !window.location) return;
  const { pathname, hash, search } = window.location;
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const isResetPath = normalizedPath === PASSWORD_RESET_PATH;
  const hasAuthParams =
    hash.includes('access_token=') ||
    hash.includes('type=recovery') ||
    hash.includes('error=') ||
    hash.includes('error_code=') ||
    search.includes('code=') ||
    search.includes('type=recovery') ||
    search.includes('error=') ||
    search.includes('error_code=');

  if (isResetPath || hasAuthParams) {
    window.history.replaceState({}, document.title, '/');
  }
}

function getSafeSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
      return window.sessionStorage;
    }
  } catch {
    // Ignore storage access restriction errors
  }
  return null;
}

export function readTabRecoveryBinding(): TabRecoveryBinding | null {
  const raw = getSafeSessionStorage()?.getItem(TAB_RECOVERY_BINDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TabRecoveryBinding>;
    if (
      typeof parsed.userId === 'string' &&
      parsed.userId &&
      typeof parsed.sessionId === 'string' &&
      parsed.sessionId
    ) {
      return { userId: parsed.userId, sessionId: parsed.sessionId };
    }
  } catch {
    // Corrupted binding cannot confirm recovery
  }
  return null;
}

export function setTabRecoveryBinding(userId: string, sessionId: string): void {
  if (!userId || !sessionId) return;
  getSafeSessionStorage()?.setItem(
    TAB_RECOVERY_BINDING_KEY,
    JSON.stringify({ userId, sessionId })
  );
}

export function clearTabRecoveryBinding(): void {
  getSafeSessionStorage()?.removeItem(TAB_RECOVERY_BINDING_KEY);
}

export function matchesTabRecoveryBinding(
  session: Session | null,
  binding: TabRecoveryBinding | null = readTabRecoveryBinding()
): boolean {
  if (!session || !session.user?.id || !binding) {
    return false;
  }
  const sessionId = extractSessionIdFromSession(session);
  if (!sessionId) {
    return false;
  }
  return session.user.id === binding.userId && sessionId === binding.sessionId;
}

export function readTabRecoverySignOutPending(): TabRecoveryBinding | null {
  const raw = getSafeSessionStorage()?.getItem(TAB_RECOVERY_SIGNOUT_PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TabRecoveryBinding>;
    if (
      typeof parsed.userId === 'string' &&
      parsed.userId &&
      typeof parsed.sessionId === 'string' &&
      parsed.sessionId
    ) {
      return { userId: parsed.userId, sessionId: parsed.sessionId };
    }
  } catch {
    // Ignore invalid format
  }
  return null;
}

export function setTabRecoverySignOutPending(userId: string, sessionId: string): void {
  if (!userId || !sessionId) return;
  getSafeSessionStorage()?.setItem(
    TAB_RECOVERY_SIGNOUT_PENDING_KEY,
    JSON.stringify({ userId, sessionId })
  );
}

export function clearTabRecoverySignOutPending(): void {
  getSafeSessionStorage()?.removeItem(TAB_RECOVERY_SIGNOUT_PENDING_KEY);
}

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

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  role: UserRole | null;
  status: AuthPortalStatus;
  loading: boolean;
  isRevalidating: boolean;
  sessionInstanceId?: number;
  error: string | null;
  authNotice?: string | null;
  authInitialView?: 'sign_in' | 'forgot_password';
  isConfigured: boolean;
  isLocalDemoMode?: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error: string | null }>;
  signOut: () => Promise<{ success: boolean; error: string | null }>;
  refreshProfile: () => Promise<void>;
  clearAuthFeedback?: () => void;
  requestPasswordReset?: (email: string) => Promise<{ success: boolean; error: string | null }>;
  updateRecoveryPassword?: (newPassword: string) => Promise<{ success: boolean; error: string | null }>;
  completeRecoverySignOut?: () => Promise<{ success: boolean; error: string | null }>;
  exitRecoveryToAuth?: (view: 'sign_in' | 'forgot_password') => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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
