// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';

// Helper component that consumes useAuth and renders state
const TestConsumer: React.FC = () => {
  const { user, status, error, signOut, refreshProfile } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="user-id">{user?.id || 'none'}</div>
      <div data-testid="error-message">{error || 'none'}</div>
      <button onClick={() => signOut()} data-testid="sign-out-btn">Sign Out</button>
      <button onClick={() => refreshProfile()} data-testid="refresh-btn">Refresh Profile</button>
    </div>
  );
};

describe('AuthProvider & Application Access Gates (Real Component Tests)', () => {
  let authStateCallback: ((event: string, session: any) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    authStateCallback = null;

    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);

    // Spy on onAuthStateChange to capture listener
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb: any) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Restored session: loads user profile and grants admin access when role is admin', async () => {
    const mockUser = { id: 'admin-uuid-1', email: 'admin@edutrack.com' };
    const mockSession = { user: mockUser, access_token: 'fake-token' };

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: mockSession as any },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { id: 'admin-uuid-1', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin User' },
            error: null,
          }),
        }),
      }),
    } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated_admin');
      expect(screen.getByTestId('user-id').textContent).toBe('admin-uuid-1');
      expect(screen.getByTestId('error-message').textContent).toBe('none');
    });
  });

  it('2. Logout while profile request is still pending: stale response is ignored and access is revoked', async () => {
    const mockUser = { id: 'admin-uuid-2', email: 'admin@edutrack.com' };
    const mockSession = { user: mockUser, access_token: 'token-2' };

    let resolvePendingProfile: (val: any) => void;
    const pendingProfilePromise = new Promise((resolve) => {
      resolvePendingProfile = resolve;
    });

    let onProfileFetchStarted: () => void;
    const profileFetchStarted = new Promise<void>((resolve) => {
      onProfileFetchStarted = resolve;
    });

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: mockSession as any },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            onProfileFetchStarted();
            return pendingProfilePromise;
          },
        }),
      }),
    } as any);

    vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Wait for the profile fetch to be actively in-flight
    await profileFetchStarted;

    // Now user clicks Sign Out while request is pending
    await act(async () => {
      screen.getByTestId('sign-out-btn').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('user-id').textContent).toBe('none');

    // Now resolve the late profile response that was in-flight
    await act(async () => {
      resolvePendingProfile!({
        data: { id: 'admin-uuid-2', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin' },
        error: null,
      });
    });

    // The status MUST stay unauthenticated, NOT get promoted to admin by stale response
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('user-id').textContent).toBe('none');
  });

  it('3. Account change while profile is pending: prevents race condition / stale profile overwrite', async () => {
    let resolveProfileA: (val: any) => void;
    const pendingProfileA = new Promise((resolve) => {
      resolveProfileA = resolve;
    });

    let onProfileAStarted: () => void;
    const profileAStarted = new Promise<void>((resolve) => {
      onProfileAStarted = resolve;
    });

    const userA = { id: 'user-a-uuid', email: 'admin@edutrack.com' };
    const sessionA = { user: userA, access_token: 'token-a' };

    const userB = { id: 'user-b-uuid', email: 'student@edutrack.com' };
    const sessionB = { user: userB, access_token: 'token-b' };

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: sessionA as any },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: () => {
              if (val === 'user-a-uuid') {
                onProfileAStarted();
                return pendingProfileA;
              }
              return Promise.resolve({
                data: { id: 'user-b-uuid', email: 'student@edutrack.com', role: 'student', full_name: 'Student B' },
                error: null,
              });
            },
          }),
        }),
      } as any;
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Wait until profile A request is actively in-flight
    await profileAStarted;

    // Switch to User B before User A profile resolves
    await act(async () => {
      if (authStateCallback) {
        authStateCallback('SIGNED_IN', sessionB);
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated_non_admin');
      expect(screen.getByTestId('user-id').textContent).toBe('user-b-uuid');
    });

    // Now resolve User A's delayed admin profile
    await act(async () => {
      resolveProfileA!({
        data: { id: 'user-a-uuid', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin A' },
        error: null,
      });
    });

    // User B's student status and identity must be preserved
    expect(screen.getByTestId('status').textContent).toBe('authenticated_non_admin');
    expect(screen.getByTestId('user-id').textContent).toBe('user-b-uuid');
  });

  it('4. Distinguishes profile-fetch errors versus genuinely missing profiles', async () => {
    const mockUser = { id: 'user-c-uuid', email: 'missing@edutrack.com' };
    const mockSession = { user: mockUser, access_token: 'token-c' };

    // Case 4A: Genuinely missing profile (data = null, error = null)
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: mockSession as any },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    } as any);

    const { unmount } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('missing_profile');
      expect(screen.getByTestId('error-message').textContent).toContain('no profile record was found');
    });

    unmount();

    // Case 4B: Database / network error (error = { message: 'Connection refused' })
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: mockSession as any },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'Connection refused' } }),
        }),
      }),
    } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      // Must not claim "no profile record was found", reports database failure
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
      expect(screen.getByTestId('error-message').textContent).toContain('Failed to load user profile: Connection refused');
    });
  });

  it('5. Admin role removal followed by profile refresh: correctly revokes admin access to non-admin', async () => {
    const mockUser = { id: 'admin-uuid-5', email: 'admin@edutrack.com' };
    const mockSession = { user: mockUser, access_token: 'token-5' };

    let currentRole = 'admin';

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: mockSession as any },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockImplementation((): any => {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: { id: 'admin-uuid-5', email: 'admin@edutrack.com', role: currentRole, full_name: 'Admin Demoted' },
              error: null,
            }),
          }),
        }),
      };
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated_admin');
    });

    // Simulate admin role being removed in the database
    currentRole = 'teacher';

    // Call refreshProfile
    await act(async () => {
      screen.getByTestId('refresh-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated_non_admin');
      expect(screen.getByTestId('error-message').textContent).toContain('Account role is "teacher"');
    });
  });
});
