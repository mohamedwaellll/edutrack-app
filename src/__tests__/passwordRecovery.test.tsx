// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { AuthChangeEvent, AuthError, Session, Subscription, User } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';
import { adminService } from '../services/adminService';

function makeTestJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.test-signature`;
}

function makeTestSession(
  id: string,
  email: string,
  sessionId: string,
  tokenSeq = '1'
): Session {
  return {
    user: { id, email } as User,
    access_token: makeTestJwt({
      sub: id,
      email,
      session_id: sessionId,
      jti: `${sessionId}-tok-${tokenSeq}`,
    }),
  } as Session;
}

function makeMockSubscription(): Subscription {
  return { unsubscribe: vi.fn() } as unknown as Subscription;
}

function mockProfileTable(role: 'admin' | 'teacher' | 'student' | 'parent' = 'admin') {
  return vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_col: string, uid: string) => ({
            maybeSingle: async () => ({
              data: { id: uid, email: `${role}@edutrack.com`, role, full_name: `Test ${role}` },
              error: null,
            }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    };
  }) as unknown as typeof supabase.from);
}

describe('Password Recovery End-to-End Flows (from App Entry Point)', () => {
  let authStateCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    authStateCallback = null;

    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb) => {
      authStateCallback = cb;
      return { data: { subscription: makeMockSubscription() } };
    });
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null,
    });
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('1. Requests password reset via Forgot password?, sends fixed /reset-password redirect, prevents duplicate submits, and shows generic confirmation', async () => {
    type ResetResult = Awaited<ReturnType<typeof supabase.auth.resetPasswordForEmail>>;
    let resolveReset!: (val: ResetResult) => void;
    const pendingReset = new Promise<ResetResult>((resolve) => {
      resolveReset = resolve;
    });

    const resetSpy = vi
      .spyOn(supabase.auth, 'resetPasswordForEmail')
      .mockReturnValueOnce(pendingReset);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'teacher@edutrack.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Forgot password\?/i }));

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeDefined();
    });

    // Single email input carried forward so user never enters email twice
    const resetEmailInput = screen.getByLabelText(/Email address/i) as HTMLInputElement;
    expect(resetEmailInput.value).toBe('teacher@edutrack.com');
    expect(screen.getAllByLabelText(/Email address/i)).toHaveLength(1);

    const submitBtn = screen.getByTestId('send-reset-link-button') as HTMLButtonElement;
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy).toHaveBeenCalledWith('teacher@edutrack.com', {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    expect(submitBtn.disabled).toBe(true);

    await act(async () => {
      resolveReset({ data: {}, error: null });
    });

    await waitFor(() => {
      const banner = screen.getByTestId('reset-request-sent-banner');
      expect(banner.textContent).toMatch(/If an account exists for that email address/i);
    });
  });

  it('2. Shows retryable error on network failure (and clear local demo bridge unsupported message), then succeeds on retry', async () => {
    const resetSpy = vi
      .spyOn(supabase.auth, 'resetPasswordForEmail')
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        data: null,
        error: {
          message:
            'Password reset email delivery requires Supabase Auth and is not supported by the local PGlite demo bridge.',
        } as unknown as AuthError,
      })
      .mockResolvedValueOnce({ data: {}, error: null });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Forgot password\?/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Forgot password\?/i }));
    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'student@edutrack.com' },
    });

    // First attempt -> network rejection
    fireEvent.click(screen.getByTestId('send-reset-link-button'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Failed to fetch/i);
    });

    // Retry -> local demo unsupported error reported clearly
    fireEvent.click(screen.getByRole('button', { name: /Retry Send Reset Link/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/requires Supabase Auth/i);
    });

    // Third attempt -> succeeds cleanly
    fireEvent.click(screen.getByRole('button', { name: /Retry Send Reset Link/i }));
    await waitFor(() => {
      expect(screen.getByTestId('reset-request-sent-banner')).toBeDefined();
    });
    expect(resetSpy).toHaveBeenCalledTimes(3);
  });

  it('3. Shows verifying wait screen on /reset-password until PASSWORD_RECOVERY confirms, never exposes dashboard on out-of-order events, and survives F5 refresh once confirmed', async () => {
    window.history.replaceState({}, '', '/reset-password#access_token=rec-tok-1&type=recovery');

    const profileSpy = mockProfileTable('admin');
    const overviewSpy = vi.spyOn(adminService, 'getDashboardOverview');

    const recoverySession = makeTestSession('admin-rec-1', 'admin@edutrack.com', 'sess-rec-1', '1');
    type GetSessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
    let resolveInitialGetSession!: (val: GetSessionResult) => void;
    vi.spyOn(supabase.auth, 'getSession').mockReturnValueOnce(
      new Promise<GetSessionResult>((resolve) => {
        resolveInitialGetSession = resolve;
      })
    );

    const { unmount } = render(<App />);

    // 1) Waiting screen shows during verification — neither password form nor dashboard is visible
    expect(screen.getByTestId('recovery-verifying-screen')).toBeDefined();
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();

    // 2) Out-of-order SIGNED_IN alone does NOT open the password form or dashboard before PASSWORD_RECOVERY
    await act(async () => {
      authStateCallback?.('SIGNED_IN', recoverySession);
    });
    expect(screen.getByTestId('recovery-verifying-screen')).toBeDefined();
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();

    // 3) Supabase confirms PASSWORD_RECOVERY -> password form opens bound ONLY to (userId, sessionId)
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
      resolveInitialGetSession({ data: { session: recoverySession }, error: null });
    });

    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    // Verify sessionStorage stores ONLY userId & sessionId (no access_token or secrets)
    const rawStored = window.sessionStorage.getItem('edutrack:password_recovery_binding');
    expect(rawStored).not.toBeNull();
    expect(JSON.parse(rawStored!)).toEqual({ userId: 'admin-rec-1', sessionId: 'sess-rec-1' });
    expect(rawStored).not.toContain(recoverySession.access_token);

    // Type draft password before TOKEN_REFRESHED rotates access_token within the SAME session_id
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'DraftKeep123!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'DraftKeep123!' },
    });

    const refreshedRecoverySession = makeTestSession('admin-rec-1', 'admin@edutrack.com', 'sess-rec-1', '2');
    expect(refreshedRecoverySession.access_token).not.toBe(recoverySession.access_token);
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', refreshedRecoverySession);
    });
    expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    expect((screen.getByLabelText(/^New password$/i) as HTMLInputElement).value).toBe('DraftKeep123!');
    expect((screen.getByLabelText(/Confirm new password/i) as HTMLInputElement).value).toBe('DraftKeep123!');
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(profileSpy).not.toHaveBeenCalled();
    expect(overviewSpy).not.toHaveBeenCalled();

    // 4) Simulate page refresh AFTER Supabase stripped hash BEFORE saving password (same refreshed session in storage)
    unmount();
    window.history.replaceState({}, '', '/reset-password');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: refreshedRecoverySession },
      error: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(profileSpy).not.toHaveBeenCalled();
    expect(overviewSpy).not.toHaveBeenCalled();
  });

  it('4. Renders invalid/expired link screen with Request New Reset Link for expired URL hash or failed session recovery (even with stale session)', async () => {
    // Case A: Expired link hash while an existing admin session is in localStorage -> MUST still show recovery_invalid
    window.history.replaceState(
      {},
      '',
      '/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );
    mockProfileTable('admin');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: makeTestSession('admin-cached', 'admin@edutrack.com', 'cached-tok') },
      error: null,
    });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('recovery-invalid-screen')).toBeDefined();
    });
    expect(screen.getByText(/Email link is invalid or has expired/i)).toBeDefined();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();

    // Clicking Request New Reset Link navigates directly to the Forgot password form and cleans URL
    fireEvent.click(screen.getByRole('button', { name: /Request New Reset Link/i }));
    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeDefined();
    });
    expect(window.location.pathname).toBe('/');
    unmount();

    // Case B: Consumed/expired PKCE link (?code=expired) where getSession returns null
    window.history.replaceState({}, '', '/reset-password?code=expired-pkce-code');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null,
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('recovery-invalid-screen')).toBeDefined();
    });
  });

  it('5. Validates password mismatch, updates via updateUser once, terminates recovery session, and signs in with new password across roles', async () => {
    mockProfileTable('teacher');
    const recoverySession = makeTestSession('teacher-rec-1', 'teacher@edutrack.com', 'rec-tok');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
      data: { user: recoverySession.user },
      error: null,
    });
    const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });

    render(<App />);

    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    // Mismatch check -> error shown, updateUser NOT called
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'NewStrongPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'DifferentPass999!' },
    });
    fireEvent.click(screen.getByTestId('update-password-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Passwords do not match/i);
    });
    expect(updateUserSpy).not.toHaveBeenCalled();

    // Matching passwords -> updateUser + signOut -> Sign In screen with success banner
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'NewStrongPass123!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });

    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(updateUserSpy).toHaveBeenCalledWith({ password: 'NewStrongPass123!' });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).toHaveBeenCalledWith({ scope: 'local' });

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
      expect(screen.getByTestId('auth-notice-banner').textContent).toMatch(
        /Password updated successfully/i
      );
    });

    // Subsequent sign-in with new password opens TeacherPortal cleanly (normal role flow preserved)
    vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
      data: {
        user: recoverySession.user,
        session: makeTestSession('teacher-rec-1', 'teacher@edutrack.com', 'fresh-tok'),
      },
      error: null,
    });

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'teacher@edutrack.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: 'NewStrongPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign In to EduTrack/i }));

    await waitFor(() => {
      expect(screen.getByText('Teacher Portal')).toBeDefined();
    });
  });

  it('6. If updateUser succeeds and signOut fails, shows Retry Sign Out ONLY (without re-calling updateUser or opening dashboard)', async () => {
    const profileSpy = mockProfileTable('admin');
    const recoverySession = makeTestSession('admin-rec-out', 'admin@edutrack.com', 'rec-tok');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });

    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
      data: { user: recoverySession.user },
      error: null,
    });
    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockResolvedValueOnce({ error: { message: 'Session termination timeout' } as AuthError })
      .mockResolvedValueOnce({ error: null });

    render(<App />);

    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'UpdatedPass#2026' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'UpdatedPass#2026' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('recovery-signout-error-screen')).toBeDefined();
      expect(screen.getByText(/Session termination timeout/i)).toBeDefined();
    });

    // Only Retry Sign Out screen is visible — no dashboard, no password update form
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(profileSpy).not.toHaveBeenCalled();

    // Duplicate SIGNED_IN / USER_UPDATED events must not bypass Retry Sign Out lock
    await act(async () => {
      authStateCallback?.('USER_UPDATED', recoverySession);
      authStateCallback?.('SIGNED_IN', recoverySession);
    });
    expect(screen.getByTestId('recovery-signout-error-screen')).toBeDefined();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();

    // Clicking Retry Sign Out invokes signOut ONLY (updateUser still called only once)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
      expect(screen.getByTestId('auth-notice-banner')).toBeDefined();
    });
    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).toHaveBeenCalledTimes(2);
  });

  it('7. Normal logged-in session + opening /reset-password without recovery confirmation never shows save form or dashboard and keeps updateUser at 0', async () => {
    window.history.replaceState({}, '', '/reset-password');
    const profileSpy = mockProfileTable('admin');
    const overviewSpy = vi.spyOn(adminService, 'getDashboardOverview');
    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser');

    const normalSessionA = makeTestSession('admin-normal-a', 'adminA@edutrack.com', 'normal-tok-a');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: normalSessionA },
      error: null,
    });

    render(<App />);

    // Even if INITIAL_SESSION / SIGNED_IN arrive for Account A without PASSWORD_RECOVERY confirmation:
    await act(async () => {
      authStateCallback?.('INITIAL_SESSION', normalSessionA);
      authStateCallback?.('SIGNED_IN', normalSessionA);
    });

    await waitFor(() => {
      expect(screen.getByTestId('recovery-invalid-screen')).toBeDefined();
    });

    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(screen.queryByLabelText(/^New password$/i)).toBeNull();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(screen.getByRole('button', { name: /Request New Reset Link/i })).toBeDefined();
    expect(updateUserSpy).not.toHaveBeenCalled();
    expect(profileSpy).not.toHaveBeenCalled();
    expect(overviewSpy).not.toHaveBeenCalled();
  });

  it('8. Stale session A arriving during verification keeps save locked until Supabase confirms PASSWORD_RECOVERY for account B', async () => {
    window.history.replaceState({}, '', '/reset-password');
    const profileSpy = mockProfileTable('admin');
    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser');

    const staleSessionA = makeTestSession('user-a', 'a@edutrack.com', 'stale-tok-a');
    const recoverySessionB = makeTestSession('user-b', 'b@edutrack.com', 'rec-tok-b');

    type GetSessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
    let resolvePendingGetSession!: (val: GetSessionResult) => void;
    const getSessionSpy = vi.spyOn(supabase.auth, 'getSession').mockReturnValueOnce(
      new Promise<GetSessionResult>((resolve) => {
        resolvePendingGetSession = resolve;
      })
    );

    render(<App />);

    // Waiting state during verification
    expect(screen.getByTestId('recovery-verifying-screen')).toBeDefined();
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();

    // Stale session A arrives via INITIAL_SESSION and SIGNED_IN during verification -> form MUST remain absent/locked
    await act(async () => {
      authStateCallback?.('INITIAL_SESSION', staleSessionA);
      authStateCallback?.('SIGNED_IN', staleSessionA);
    });

    expect(screen.getByTestId('recovery-verifying-screen')).toBeDefined();
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(updateUserSpy).not.toHaveBeenCalled();

    // Supabase now confirms PASSWORD_RECOVERY for Account B
    getSessionSpy.mockResolvedValue({ data: { session: recoverySessionB }, error: null });
    updateUserSpy.mockResolvedValue({ data: { user: recoverySessionB.user }, error: null });

    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySessionB);
      resolvePendingGetSession({ data: { session: staleSessionA }, error: null });
    });

    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });
    expect(screen.getByText(/b@edutrack\.com/i)).toBeDefined();
    expect(screen.queryByText(/a@edutrack\.com/i)).toBeNull();
    expect(profileSpy).not.toHaveBeenCalled();

    // Saving now updates password cleanly for Account B
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'AccountBNewPass1!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'AccountBNewPass1!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });

    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(updateUserSpy).toHaveBeenCalledWith({ password: 'AccountBNewPass1!' });
  });

  it('9. Refreshing inside confirmed recovery allows completion; session switch (or same-user new login / save-time mismatch) cancels old form', async () => {
    window.history.replaceState({}, '', '/reset-password');
    const recoverySessionB = makeTestSession('user-b', 'b@edutrack.com', 'rec-tok-b');
    const getSessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: recoverySessionB },
      error: null,
    });
    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
      data: { user: recoverySessionB.user },
      error: null,
    });

    // Subcase A: Same-user new login session (different token) via SIGNED_IN cancels the active form
    const { unmount } = render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySessionB);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    await act(async () => {
      authStateCallback?.('SIGNED_IN', makeTestSession('user-b', 'b@edutrack.com', 'new-login-tok-b'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('recovery-invalid-screen')).toBeDefined();
    });
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(updateUserSpy).not.toHaveBeenCalled();
    unmount();

    // Subcase B: Re-confirm recovery for B -> F5 refresh -> mismatch right at save time blocks updateUser
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/reset-password');
    getSessionSpy.mockResolvedValue({ data: { session: recoverySessionB }, error: null });

    const secondMount = render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySessionB);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    // Refresh while still in confirmed recovery -> restores form cleanly
    secondMount.unmount();
    const afterRefresh = render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    // Suppose session changed in storage BEFORE Save is clicked -> save-time check rejects & cancels form
    getSessionSpy.mockResolvedValueOnce({
      data: { session: makeTestSession('user-b', 'b@edutrack.com', 'hijacked-new-login-tok') },
      error: null,
    });

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'SecretNewPass1!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'SecretNewPass1!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('recovery-invalid-screen')).toBeDefined();
    });
    expect(updateUserSpy).not.toHaveBeenCalled();
    afterRefresh.unmount();

    // Subcase C: Refresh inside clean confirmed recovery WITHOUT session change completes updateUser + signOut
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/reset-password');
    getSessionSpy.mockResolvedValue({ data: { session: recoverySessionB }, error: null });
    const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });

    const thirdMount = render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySessionB);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    thirdMount.unmount();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'CompletedPass#99' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'CompletedPass#99' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });

    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(updateUserSpy).toHaveBeenCalledWith({ password: 'CompletedPass#99' });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
      expect(screen.getByTestId('auth-notice-banner')).toBeDefined();
    });
  });

  it('10. Token arrival for SAME user with DIFFERENT session_id or unprovable session_id cancels old form and requires a new reset link', async () => {
    window.history.replaceState({}, '', '/reset-password');
    const recoverySession = makeTestSession('same-user-1', 'user@edutrack.com', 'sess-rec-orig', '1');
    const getSessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser');

    // Case A: TOKEN_REFRESHED / event arrives for SAME user with DIFFERENT session_id -> cancels form
    const firstRender = render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    await act(async () => {
      authStateCallback?.(
        'TOKEN_REFRESHED',
        makeTestSession('same-user-1', 'user@edutrack.com', 'sess-different-same-user', '1')
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('recovery-invalid-screen')).toBeDefined();
    });
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(screen.getByRole('button', { name: /Request New Reset Link/i })).toBeDefined();
    expect(updateUserSpy).not.toHaveBeenCalled();
    firstRender.unmount();

    // Case B: Token lacking session_id claim (cannot prove session continuity) fails closed to recovery_invalid
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/reset-password');
    const opaqueNoSessionId = {
      user: { id: 'same-user-1', email: 'user@edutrack.com' } as User,
      access_token: 'opaque-token-missing-session-id',
    } as Session;
    getSessionSpy.mockResolvedValue({ data: { session: opaqueNoSessionId }, error: null });

    render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', opaqueNoSessionId);
    });
    await waitFor(() => {
      expect(screen.getByTestId('recovery-invalid-screen')).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /Request New Reset Link/i })).toBeDefined();
    expect(updateUserSpy).not.toHaveBeenCalled();
  });

  it('11. Session switch during pending getSession() or pending updateUser() never saves, signs out, or clears the new session data', async () => {
    window.history.replaceState({}, '', '/reset-password');
    mockProfileTable('teacher');

    const recoverySession = makeTestSession('user-rec-old', 'old@edutrack.com', 'sess-rec-old', '1');
    const newLoginSession = makeTestSession('teacher-new-2', 'teacher@edutrack.com', 'sess-teacher-new', '1');

    type GetSessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
    type UpdateUserResult = Awaited<ReturnType<typeof supabase.auth.updateUser>>;

    const getSessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser');
    const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });

    // Part A: Switch session while save-time getSession() is pending -> stale save ignored, updateUser NOT called
    const renderA = render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    let resolveSaveGetSession!: (val: GetSessionResult) => void;
    getSessionSpy.mockReturnValueOnce(
      new Promise<GetSessionResult>((resolve) => {
        resolveSaveGetSession = resolve;
      })
    );

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'OldAttemptPass1!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'OldAttemptPass1!' },
    });
    fireEvent.click(screen.getByTestId('update-password-submit'));

    // Leave /reset-password and sign in as a new verified teacher session while old getSession() is pending
    window.history.replaceState({}, '', '/');
    getSessionSpy.mockResolvedValue({ data: { session: newLoginSession }, error: null });
    await act(async () => {
      authStateCallback?.('SIGNED_IN', newLoginSession);
    });

    await waitFor(() => {
      expect(screen.getByText('Teacher Portal')).toBeDefined();
    });

    // Old getSession() resolves with recoverySession -> MUST be ignored without calling updateUser/signOut or wiping TeacherPortal
    await act(async () => {
      resolveSaveGetSession({ data: { session: recoverySession }, error: null });
    });

    expect(updateUserSpy).not.toHaveBeenCalled();
    expect(signOutSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Teacher Portal')).toBeDefined();
    expect(screen.getByTestId('portal-user-name').textContent).toBe('Test teacher');
    renderA.unmount();

    // Part B: Switch session while updateUser() itself is pending -> stale updateUser resolution NEVER calls signOut or clears new portal
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/reset-password');
    getSessionSpy.mockResolvedValue({ data: { session: recoverySession }, error: null });

    let resolvePendingUpdateUser!: (val: UpdateUserResult) => void;
    updateUserSpy.mockReturnValueOnce(
      new Promise<UpdateUserResult>((resolve) => {
        resolvePendingUpdateUser = resolve;
      })
    );

    render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'OldAttemptPass2!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'OldAttemptPass2!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });
    expect(updateUserSpy).toHaveBeenCalledTimes(1);

    // Now switch away from recovery to new teacher session WHILE updateUser() is in flight
    window.history.replaceState({}, '', '/');
    getSessionSpy.mockResolvedValue({ data: { session: newLoginSession }, error: null });
    await act(async () => {
      authStateCallback?.('SIGNED_IN', newLoginSession);
    });

    await waitFor(() => {
      expect(screen.getByText('Teacher Portal')).toBeDefined();
    });
    expect(signOutSpy).not.toHaveBeenCalled();

    // Old updateUser() resolves cleanly -> MUST NOT call signOut() on the new session or clear Teacher Portal
    await act(async () => {
      resolvePendingUpdateUser({ data: { user: recoverySession.user }, error: null });
    });

    expect(signOutSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Teacher Portal')).toBeDefined();
    expect(screen.getByTestId('portal-user-name').textContent).toBe('Test teacher');
  });

  it('12. Locks form immediately after updateUser even if subsequent getSession() fails temporarily, and completes local signOut on Retry without re-calling updateUser', async () => {
    window.history.replaceState({}, '', '/reset-password');
    const recoverySession = makeTestSession('user-rec-net', 'net@edutrack.com', 'sess-rec-net', '1');
    const getSessionSpy = vi.spyOn(supabase.auth, 'getSession');
    // 1) Initial mount check, 2) Pre-updateUser save check -> both return recoverySession
    getSessionSpy
      .mockResolvedValueOnce({ data: { session: recoverySession }, error: null })
      .mockResolvedValueOnce({ data: { session: recoverySession }, error: null })
      // 3) Post-updateUser session check fails temporarily (network error)
      .mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'Temporary network timeout reading session' } as AuthError,
      })
      // 4) Retry Sign Out attempt #1 rejects -> still preserves Retry Sign Out
      .mockRejectedValueOnce(new Error('Transient DNS failure'))
      // 5) Retry Sign Out attempt #2 succeeds cleanly
      .mockResolvedValueOnce({ data: { session: recoverySession }, error: null });

    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
      data: { user: recoverySession.user },
      error: null,
    });
    const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });

    render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'NetSafePass123!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'NetSafePass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });

    // Save succeeded -> form locked & replaced by recovery_signout_error informing user password was saved
    await waitFor(() => {
      expect(screen.getByTestId('recovery-signout-error-screen')).toBeDefined();
    });
    expect(screen.queryByTestId('password-recovery-form-card')).toBeNull();
    expect(screen.getByText(/Your new password has been saved cleanly/i)).toBeDefined();
    expect(screen.getByText(/remaining step is ending your recovery session/i)).toBeDefined();
    expect(screen.getByText(/Temporary network timeout reading session/i)).toBeDefined();
    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).not.toHaveBeenCalled();

    // Retry #1 hits transient rejection -> stays on Retry Sign Out
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('recovery-signout-error-screen')).toBeDefined();
      expect(screen.getByText(/Transient DNS failure/i)).toBeDefined();
    });
    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).not.toHaveBeenCalled();

    // Retry #2 reads matching original session & calls signOut({ scope: 'local' }) -> returns to Sign In
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
      expect(screen.getByTestId('auth-notice-banner')).toBeDefined();
    });
    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('13. When initial signOut fails and a new session starts for the SAME user before Retry (or F5), Retry does not call signOut on the new session and preserves it', async () => {
    window.history.replaceState({}, '', '/reset-password');
    mockProfileTable('teacher');

    const recoverySession = makeTestSession('same-teacher-1', 't@edutrack.com', 'sess-rec-orig', '1');
    const newSessionSameUser = makeTestSession('same-teacher-1', 't@edutrack.com', 'sess-new-same-user', '1');

    const getSessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    const updateUserSpy = vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
      data: { user: recoverySession.user },
      error: null,
    });
    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockResolvedValueOnce({ error: { message: 'Initial local sign-out failure' } as AuthError })
      .mockResolvedValue({ error: null });

    // Part A: Initial signOut fails -> new session starts for SAME user before Retry Sign Out is clicked
    const firstRender = render(<App />);
    await act(async () => {
      authStateCallback?.('PASSWORD_RECOVERY', recoverySession);
    });
    await waitFor(() => {
      expect(screen.getByTestId('password-recovery-form-card')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'TeacherNewPass1!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: 'TeacherNewPass1!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-password-submit'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('recovery-signout-error-screen')).toBeDefined();
    });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).toHaveBeenCalledWith({ scope: 'local' });

    // Confirm pending sign-out binding stores ONLY { userId, sessionId }
    const pendingRaw = window.sessionStorage.getItem('edutrack:recovery_signout_pending');
    expect(pendingRaw).not.toBeNull();
    expect(JSON.parse(pendingRaw!)).toEqual({
      userId: 'same-teacher-1',
      sessionId: 'sess-rec-orig',
    });

    // Simulate a new login session starting for the SAME user in storage BEFORE user clicks Retry Sign Out
    getSessionSpy.mockResolvedValue({ data: { session: newSessionSameUser }, error: null });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });

    // Clicking Retry MUST end old recovery state cleanly, preserve new session (Teacher Portal), and NOT call signOut again
    await waitFor(() => {
      expect(screen.getByText('Teacher Portal')).toBeDefined();
    });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('edutrack:recovery_signout_pending')).toBeNull();
    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    firstRender.unmount();

    // Part B: F5 reload while pending sign-out exists:
    // B1) Temporary getSession failure on F5 keeps Retry Sign Out available
    window.sessionStorage.setItem(
      'edutrack:recovery_signout_pending',
      JSON.stringify({ userId: 'same-teacher-1', sessionId: 'sess-rec-orig' })
    );
    window.history.replaceState({}, '', '/');
    getSessionSpy.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Temporary F5 session read failure' } as AuthError,
    });

    const f5ErrorMount = render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('recovery-signout-error-screen')).toBeDefined();
    });
    expect(screen.getByText(/Temporary F5 session read failure/i)).toBeDefined();
    f5ErrorMount.unmount();

    // B1b) F5 reload when original recovery session is still active keeps Retry Sign Out screen
    getSessionSpy.mockResolvedValueOnce({ data: { session: recoverySession }, error: null });
    const f5SameMount = render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('recovery-signout-error-screen')).toBeDefined();
    });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    f5SameMount.unmount();

    // B2) F5 reload when new session for SAME user is active in storage clears old recovery & preserves new session
    getSessionSpy.mockResolvedValue({ data: { session: newSessionSameUser }, error: null });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Teacher Portal')).toBeDefined();
    });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('edutrack:recovery_signout_pending')).toBeNull();
  });
});
