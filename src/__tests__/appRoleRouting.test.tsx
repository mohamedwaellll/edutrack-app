// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';
import { adminService } from '../services/adminService';
import { accountLinkingService } from '../services/accountLinkingService';
import { teacherService } from '../services/teacherService';
import { attendanceService } from '../services/attendanceService';

vi.mock('jsqr', () => ({
  default: vi.fn(() => ({ data: 'ET-QR-HASH-101' })),
}));

// Polyfill ResizeObserver for JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function mockProfileLookup(
  resolver: (userId: string) => Promise<{ data: any; error: any }>
) {
  vi.spyOn(supabase, 'from').mockImplementation((table: string): any => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: () => resolver(val),
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
  });
}

describe('App Role Routing & Immediate Access Revocation (Stage B.3)', () => {
  let authStateCallback: ((event: string, session: any) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    authStateCallback = null;
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null } as any);
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb: any) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1A. Routes each role cleanly on session restoration and never invokes admin services for non-admin roles', async () => {
    const roleCases: Array<{
      id: string;
      role: 'admin' | 'teacher' | 'student' | 'parent';
      fullName: string;
      expectedText: string;
      testId?: string;
    }> = [
      { id: 'u-admin', role: 'admin', fullName: 'Ada Admin', expectedText: 'EduTrack Admin' },
      { id: 'u-teacher', role: 'teacher', fullName: 'Tariq Teacher', expectedText: 'Teacher Portal', testId: 'role-portal-teacher' },
      { id: 'u-student', role: 'student', fullName: 'Salma Student', expectedText: 'Student Portal', testId: 'role-portal-student' },
      { id: 'u-parent', role: 'parent', fullName: 'Pari Parent', expectedText: 'Parent Portal', testId: 'role-portal-parent' },
    ];

    for (const tc of roleCases) {
      vi.clearAllMocks();
      vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
      vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb: any) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
      });

      const getOverviewSpy = vi.spyOn(adminService, 'getDashboardOverview');
      const getStudentsSpy = vi.spyOn(adminService, 'getStudents');
      const getTeachersSpy = vi.spyOn(adminService, 'getTeachers');
      const getClassesSpy = vi.spyOn(adminService, 'getClasses');
      const getProfilesByRoleSpy = vi.spyOn(accountLinkingService, 'getProfilesByRole');
      const getParentStudentLinksSpy = vi.spyOn(accountLinkingService, 'getParentStudentLinks');

      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: tc.id, email: `${tc.role}@edutrack.com` }, access_token: 'tok' } as any },
        error: null,
      });

      mockProfileLookup(async (uid) => ({
        data: { id: uid, email: `${tc.role}@edutrack.com`, role: tc.role, full_name: tc.fullName },
        error: null,
      }));

      const { unmount } = render(<App />);

      await waitFor(() => {
        expect(screen.getByText(tc.expectedText)).toBeDefined();
      });

      if (tc.role === 'admin') {
        expect(screen.getByRole('button', { name: /Account Linking/i })).toBeDefined();
      } else {
        expect(screen.getByTestId(tc.testId!)).toBeDefined();
        expect(screen.getByTestId('portal-user-name').textContent).toBe(tc.fullName);
        expect(screen.getByTestId('portal-user-role').textContent).toBe(tc.role);
        expect(screen.getByRole('button', { name: /Sign Out/i })).toBeDefined();

        // Strictly zero admin screens, Account Linking, or admin/linking services invoked
        expect(screen.queryByText('EduTrack Admin')).toBeNull();
        expect(screen.queryByText(/Account Linking/i)).toBeNull();
        expect(screen.queryByText(/ISOLATED PREVIEW/i)).toBeNull();
        expect(screen.queryByText(/Parent Dashboard/i)).toBeNull();
        expect(getOverviewSpy).not.toHaveBeenCalled();
        expect(getStudentsSpy).not.toHaveBeenCalled();
        expect(getTeachersSpy).not.toHaveBeenCalled();
        expect(getClassesSpy).not.toHaveBeenCalled();
        expect(getProfilesByRoleSpy).not.toHaveBeenCalled();
        expect(getParentStudentLinksSpy).not.toHaveBeenCalled();
      }

      unmount();
    }
  });

  it('1B. Routes all four roles cleanly on interactive login from AuthPage', async () => {
    const loginRoles: Array<{
      id: string;
      role: 'admin' | 'teacher' | 'student' | 'parent';
      fullName: string;
      expectedText: string;
      testId?: string;
    }> = [
      { id: 'login-admin', role: 'admin', fullName: 'Ada Admin', expectedText: 'EduTrack Admin' },
      { id: 'login-teacher', role: 'teacher', fullName: 'Mona Teacher', expectedText: 'Teacher Portal', testId: 'role-portal-teacher' },
      { id: 'login-student', role: 'student', fullName: 'Karim Student', expectedText: 'Student Portal', testId: 'role-portal-student' },
      { id: 'login-parent', role: 'parent', fullName: 'Nadia Parent', expectedText: 'Parent Portal', testId: 'role-portal-parent' },
    ];

    for (const tc of loginRoles) {
      vi.clearAllMocks();
      vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
      vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null } as any);
      vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb: any) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
      });
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      });

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
        data: {
          user: { id: tc.id, email: `${tc.role}@edutrack.com` } as any,
          session: {
            user: { id: tc.id, email: `${tc.role}@edutrack.com` },
            access_token: `tok-${tc.role}`,
          } as any,
        },
        error: null,
      });

      const getProfilesByRoleSpy = vi.spyOn(accountLinkingService, 'getProfilesByRole');
      const getOverviewSpy = vi.spyOn(adminService, 'getDashboardOverview');

      mockProfileLookup(async () => ({
        data: {
          id: tc.id,
          email: `${tc.role}@edutrack.com`,
          role: tc.role,
          full_name: tc.fullName,
        },
        error: null,
      }));

      const { unmount } = render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
      });

      fireEvent.change(screen.getByLabelText(/Email address/i), {
        target: { value: `${tc.role}@edutrack.com` },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'SecretPass123!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Sign In to EduTrack/i }));

      await waitFor(() => {
        expect(screen.getByText(tc.expectedText)).toBeDefined();
      });

      if (tc.role === 'admin') {
        expect(screen.getByRole('button', { name: /Account Linking/i })).toBeDefined();
      } else {
        expect(screen.getByTestId(tc.testId!)).toBeDefined();
        expect(screen.getByTestId('portal-user-name').textContent).toBe(tc.fullName);
        expect(screen.getByTestId('portal-user-role').textContent).toBe(tc.role);
        expect(screen.queryByText('EduTrack Admin')).toBeNull();
        expect(getProfilesByRoleSpy).not.toHaveBeenCalled();
        expect(getOverviewSpy).not.toHaveBeenCalled();
      }

      unmount();
    }
  });

  it('2. Switching from admin (with active preview) to student immediately hides AdminDashboard & preview before student profile resolves', async () => {
    let resolveStudentProfile: (val: { data: any; error: any }) => void;
    const studentProfilePromise = new Promise<{ data: any; error: any }>((resolve) => {
      resolveStudentProfile = resolve;
    });

    const getOverviewSpy = vi.spyOn(adminService, 'getDashboardOverview');
    const getStudentsSpy = vi.spyOn(adminService, 'getStudents');
    const getTeachersSpy = vi.spyOn(adminService, 'getTeachers');
    const getClassesSpy = vi.spyOn(adminService, 'getClasses');

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          user: { id: 'admin-1', email: 'admin@edutrack.com' },
          access_token: 'admin-tok',
        } as any,
      },
      error: null,
    });

    mockProfileLookup(async (uid) => {
      if (uid === 'admin-1') {
        return {
          data: { id: 'admin-1', email: 'admin@edutrack.com', role: 'admin', full_name: 'Root Admin' },
          error: null,
        };
      }
      return studentProfilePromise;
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    // Open admin's ParentDashboard preview
    fireEvent.click(screen.getByRole('button', { name: /^Parent$/i }));
    await waitFor(() => {
      expect(screen.getByText(/ParentDashboard/i)).toBeDefined();
    });

    // Reset spy call counts before switching to student
    getOverviewSpy.mockClear();
    getStudentsSpy.mockClear();
    getTeachersSpy.mockClear();
    getClassesSpy.mockClear();
    const getProfilesByRoleSpy = vi.spyOn(accountLinkingService, 'getProfilesByRole');

    // Switch session to student while student profile fetch is still pending
    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'student-2', email: 'student@edutrack.com' },
        access_token: 'student-tok',
      });
    });

    // AdminDashboard and preview MUST vanish immediately while verifying
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(screen.queryByText(/ParentDashboard/i)).toBeNull();
    expect(screen.getByText('Restoring authenticated session...')).toBeDefined();

    // Now finish fetching student profile
    await act(async () => {
      resolveStudentProfile!({
        data: { id: 'student-2', email: 'student@edutrack.com', role: 'student', full_name: 'Ziad Student' },
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-student')).toBeDefined();
      expect(screen.getByTestId('portal-user-name').textContent).toBe('Ziad Student');
    });

    // Preview must stay cleared and admin/linking services must never be called for student
    expect(screen.queryByText(/ParentDashboard/i)).toBeNull();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(getProfilesByRoleSpy).not.toHaveBeenCalled();
    expect(getOverviewSpy).not.toHaveBeenCalled();
    expect(getStudentsSpy).not.toHaveBeenCalled();
    expect(getTeachersSpy).not.toHaveBeenCalled();
    expect(getClassesSpy).not.toHaveBeenCalled();
  });

  it('3. Ignores delayed initial getSession() and delayed profile responses arriving after newer login or sign-out', async () => {
    let resolveDelayedGetSession: (val: any) => void;
    const delayedGetSessionPromise = new Promise<any>((resolve) => {
      resolveDelayedGetSession = resolve;
    });

    vi.spyOn(supabase.auth, 'getSession').mockReturnValue(delayedGetSessionPromise);

    mockProfileLookup(async (uid) => {
      if (uid === 'teacher-new') {
        return {
          data: { id: 'teacher-new', email: 't@edutrack.com', role: 'teacher', full_name: 'Current Teacher' },
          error: null,
        };
      }
      return {
        data: { id: 'admin-stale', email: 'stale@edutrack.com', role: 'admin', full_name: 'Stale Admin' },
        error: null,
      };
    });

    render(<App />);

    // While initial getSession() is still pending, user logs in as teacher via auth event
    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'teacher-new', email: 't@edutrack.com' },
        access_token: 'teacher-tok',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-teacher')).toBeDefined();
    });

    // Delayed getSession() now resolves with an old admin session -> MUST be ignored
    await act(async () => {
      resolveDelayedGetSession!({
        data: {
          session: { user: { id: 'admin-stale', email: 'stale@edutrack.com' }, access_token: 'old-tok' },
        },
        error: null,
      });
    });

    expect(screen.getByTestId('role-portal-teacher')).toBeDefined();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();

    // Now test sign-out during an in-flight profile fetch: never reopen dashboard after sign-out
    let resolveLateAdminProfile: (val: { data: any; error: any }) => void;
    mockProfileLookup(
      () =>
        new Promise((resolve) => {
          resolveLateAdminProfile = resolve;
        })
    );

    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'admin-late', email: 'late@edutrack.com' },
        access_token: 'late-tok',
      });
    });

    expect(screen.getByText('Restoring authenticated session...')).toBeDefined();

    await act(async () => {
      authStateCallback?.('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });

    // Late admin profile response resolves after sign-out -> MUST NOT open AdminDashboard
    await act(async () => {
      resolveLateAdminProfile!({
        data: { id: 'admin-late', email: 'late@edutrack.com', role: 'admin', full_name: 'Late Admin' },
        error: null,
      });
    });

    expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
  });

  it('4. Handles missing_profile, profile_error, unknown_role, and Retry (Recheck Access) recovery', async () => {
    let phase: 'error' | 'missing' | 'unknown' | 'parent' = 'error';

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: { user: { id: 'user-recover', email: 'u@edutrack.com' }, access_token: 'tok' } as any,
      },
      error: null,
    });

    mockProfileLookup(async (uid) => {
      if (phase === 'error') {
        return { data: null, error: { message: 'Temporary DB outage' } };
      }
      if (phase === 'missing') {
        return { data: null, error: null };
      }
      if (phase === 'unknown') {
        return {
          data: { id: uid, email: 'u@edutrack.com', role: 'auditor', full_name: 'Unknown Role User' },
          error: null,
        };
      }
      return {
        data: { id: uid, email: 'u@edutrack.com', role: 'parent', full_name: 'Recovered Parent' },
        error: null,
      };
    });

    render(<App />);

    // 1) Initial DB error
    await waitFor(() => {
      expect(screen.getByText('Profile Verification Error')).toBeDefined();
      expect(screen.getByRole('button', { name: /Recheck Access/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Sign Out/i })).toBeDefined();
    });

    // 2) Retry when row is missing
    phase = 'missing';
    fireEvent.click(screen.getByRole('button', { name: /Recheck Access/i }));
    await waitFor(() => {
      expect(screen.getByText('Profile Record Missing')).toBeDefined();
    });

    // 3) Retry when role is unrecognized
    phase = 'unknown';
    fireEvent.click(screen.getByRole('button', { name: /Recheck Access/i }));
    await waitFor(() => {
      expect(screen.getByText('Unrecognized Account Role')).toBeDefined();
    });

    // 4) Retry when role is fixed to parent -> enters Parent Portal cleanly
    phase = 'parent';
    fireEvent.click(screen.getByRole('button', { name: /Recheck Access/i }));
    await waitFor(() => {
      expect(screen.getByTestId('role-portal-parent')).toBeDefined();
      expect(screen.getByTestId('portal-user-name').textContent).toBe('Recovered Parent');
    });

    // 5) Sign Out from RolePortalLanding returns cleanly to AuthPage
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
  });

  it('5. Same-user TOKEN_REFRESHED & duplicate SIGNED_IN preserve Add Teacher draft/tab while locking saves during verification', async () => {
    let profileFetchCount = 0;
    let resolveRefreshProfile: (val: { data: any; error: any }) => void;

    const createTeacherSpy = vi.spyOn(adminService, 'createTeacher').mockResolvedValue({
      data: {
        id: 't-new',
        full_name: 'Dr. Hisham Draft',
        subject: 'Physics',
        email: 'hisham@edutrack.com',
        phone: null,
        user_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          user: { id: 'admin-draft', email: 'admin@edutrack.com' },
          access_token: 'tok-1',
        } as any,
      },
      error: null,
    });

    mockProfileLookup((uid) => {
      profileFetchCount++;
      if (profileFetchCount === 1) {
        return Promise.resolve({
          data: { id: uid, email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin Draft' },
          error: null,
        });
      }
      return new Promise((resolve) => {
        resolveRefreshProfile = resolve;
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    // Navigate to Teachers tab and type an unsaved draft inside Add Teacher modal
    fireEvent.click(screen.getByRole('button', { name: /^Teachers$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Teacher/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Teacher/i }));

    const nameInput = screen.getByLabelText(/Full Name/i) as HTMLInputElement;
    const subjectInput = screen.getByLabelText(/Subject \/ Specialization/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/Email Address/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Dr. Hisham Draft' } });
    fireEvent.change(subjectInput, { target: { value: 'Physics' } });
    fireEvent.change(emailInput, { target: { value: 'hisham@edutrack.com' } });

    // Trigger TOKEN_REFRESHED for the same verified admin
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'admin-draft', email: 'admin@edutrack.com' },
        access_token: 'tok-2',
      });
    });

    // Active tab, modal, and typed draft remain intact while protected save is blocked during verification
    expect(screen.getByTestId('session-revalidating-banner')).toBeDefined();
    expect((screen.getByLabelText(/Full Name/i) as HTMLInputElement).value).toBe('Dr. Hisham Draft');
    const saveBtnDuringRefresh = screen.getByRole('button', { name: /Save Teacher/i }) as HTMLButtonElement;
    expect(saveBtnDuringRefresh.disabled).toBe(true);

    // Even direct form submission while verification is pending must NOT invoke createTeacher
    fireEvent.submit(saveBtnDuringRefresh.closest('form')!);
    expect(createTeacherSpy).not.toHaveBeenCalled();

    // Resolve delayed verification with admin role intact
    await act(async () => {
      resolveRefreshProfile!({
        data: { id: 'admin-draft', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin Draft' },
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('session-revalidating-banner')).toBeNull();
    });

    // Modal, tab, and draft remain intact after verification and refresh alone saved nothing
    expect(createTeacherSpy).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Full Name/i) as HTMLInputElement).value).toBe('Dr. Hisham Draft');
    expect((screen.getByRole('button', { name: /Save Teacher/i }) as HTMLButtonElement).disabled).toBe(false);

    // Also test duplicate SIGNED_IN for same verified user preserves draft identically
    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'admin-draft', email: 'admin@edutrack.com' },
        access_token: 'tok-3',
      });
    });
    expect(screen.getByTestId('session-revalidating-banner')).toBeDefined();
    await act(async () => {
      resolveRefreshProfile!({
        data: { id: 'admin-draft', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin Draft' },
        error: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('session-revalidating-banner')).toBeNull();
    });
    expect((screen.getByLabelText(/Full Name/i) as HTMLInputElement).value).toBe('Dr. Hisham Draft');
    expect(createTeacherSpy).not.toHaveBeenCalled();
  });

  it('6. TOKEN_REFRESHED revealing role demotion or profile error immediately revokes AdminDashboard', async () => {
    let phase: 'admin' | 'student' | 'error' = 'admin';
    let resolveDelayed: ((val: { data: any; error: any }) => void) | null = null;

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          user: { id: 'admin-revoked', email: 'admin@edutrack.com' },
          access_token: 'tok-1',
        } as any,
      },
      error: null,
    });

    mockProfileLookup((uid) => {
      if (phase === 'admin') {
        return Promise.resolve({
          data: { id: uid, email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin One' },
          error: null,
        });
      }
      return new Promise((resolve) => {
        resolveDelayed = resolve;
      });
    });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    // Trigger refresh whose delayed response reveals role changed to student
    phase = 'student';
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'admin-revoked', email: 'admin@edutrack.com' },
        access_token: 'tok-2',
      });
    });

    await act(async () => {
      resolveDelayed!({
        data: { id: 'admin-revoked', email: 'admin@edutrack.com', role: 'student', full_name: 'Demoted User' },
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-student')).toBeDefined();
      expect(screen.queryByText('EduTrack Admin')).toBeNull();
    });

    unmount();

    // Now test profile read failure during TOKEN_REFRESHED revokes AdminDashboard to AccessDenied
    phase = 'admin';
    resolveDelayed = null;
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    phase = 'error';
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'admin-revoked', email: 'admin@edutrack.com' },
        access_token: 'tok-3',
      });
    });

    await act(async () => {
      resolveDelayed!({
        data: null,
        error: { message: 'Profile read timeout' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Profile Verification Error')).toBeDefined();
      expect(screen.queryByText('EduTrack Admin')).toBeNull();
    });
  });

  it('7. Switching accounts while same-user TOKEN_REFRESHED is pending immediately hides first account and ignores stale refresh', async () => {
    let resolveAdminRefresh: (val: { data: any; error: any }) => void;
    let resolveStudentProfile: (val: { data: any; error: any }) => void;
    let adminFetchCalls = 0;

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          user: { id: 'admin-switch-1', email: 'admin1@edutrack.com' },
          access_token: 'tok-a1',
        } as any,
      },
      error: null,
    });

    mockProfileLookup((uid) => {
      if (uid === 'admin-switch-1') {
        adminFetchCalls++;
        if (adminFetchCalls === 1) {
          return Promise.resolve({
            data: { id: uid, email: 'admin1@edutrack.com', role: 'admin', full_name: 'Admin One' },
            error: null,
          });
        }
        return new Promise((resolve) => {
          resolveAdminRefresh = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveStudentProfile = resolve;
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    // Start TOKEN_REFRESHED for admin-switch-1 (stays pending)
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'admin-switch-1', email: 'admin1@edutrack.com' },
        access_token: 'tok-a2',
      });
    });
    expect(screen.getByTestId('session-revalidating-banner')).toBeDefined();

    // Switch to student-switch-2 BEFORE admin refresh finishes -> AdminDashboard must disappear IMMEDIATELY
    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'student-switch-2', email: 'student2@edutrack.com' },
        access_token: 'tok-s2',
      });
    });

    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(screen.getByText('Restoring authenticated session...')).toBeDefined();

    // Stale admin refresh response arrives late -> MUST NOT restore AdminDashboard
    await act(async () => {
      resolveAdminRefresh!({
        data: { id: 'admin-switch-1', email: 'admin1@edutrack.com', role: 'admin', full_name: 'Admin One' },
        error: null,
      });
    });

    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(screen.getByText('Restoring authenticated session...')).toBeDefined();

    // Resolve student-switch-2 profile -> opens Student Portal
    await act(async () => {
      resolveStudentProfile!({
        data: { id: 'student-switch-2', email: 'student2@edutrack.com', role: 'student', full_name: 'Student Two' },
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-student')).toBeDefined();
      expect(screen.getByTestId('portal-user-name').textContent).toBe('Student Two');
    });
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
  });

  it('8. Sign Out failures ({ error } and rejected Promise) lock protected UI, block stale responses, and recover on Retry Sign Out', async () => {
    let resolvePendingRefresh: ((val: { data: any; error: any }) => void) | null = null;
    let adminProfileCalls = 0;

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          user: { id: 'admin-signout-1', email: 'admin@edutrack.com' },
          access_token: 'tok-1',
        } as any,
      },
      error: null,
    });

    mockProfileLookup((uid) => {
      adminProfileCalls++;
      if (adminProfileCalls === 1) {
        return Promise.resolve({
          data: { id: uid, email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin SignOut' },
          error: null,
        });
      }
      return new Promise((resolve) => {
        resolvePendingRefresh = resolve;
      });
    });

    // Case A: signOut resolves with { error } first, then succeeds on Retry
    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockResolvedValueOnce({ error: { message: 'Logout endpoint unavailable' } as any })
      .mockResolvedValueOnce({ error: null });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    // Trigger background refresh that remains pending when user clicks Sign Out
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'admin-signout-1', email: 'admin@edutrack.com' },
        access_token: 'tok-refresh',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Sign Out'));
    });

    // Protected dashboard must stay hidden and dedicated Sign Out Failed screen shown
    await waitFor(() => {
      expect(screen.getByTestId('signout-error-screen')).toBeDefined();
      expect(screen.getByText(/Logout endpoint unavailable/i)).toBeDefined();
    });
    expect(screen.queryByText('EduTrack Admin')).toBeNull();

    // Pending refresh from before signOut resolves now -> MUST NOT bring back AdminDashboard
    await act(async () => {
      resolvePendingRefresh!({
        data: { id: 'admin-signout-1', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin SignOut' },
        error: null,
      });
    });
    expect(screen.getByTestId('signout-error-screen')).toBeDefined();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();

    // Retry Sign Out -> succeeds and shows login page
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
    expect(signOutSpy).toHaveBeenCalledTimes(2);

    unmount();

    // Case B: signOut Promise rejects from non-admin portal, then succeeds on Retry
    adminProfileCalls = 0;
    mockProfileLookup((uid) =>
      Promise.resolve({
        data: { id: uid, email: 'teacher@edutrack.com', role: 'teacher', full_name: 'Teacher SignOut' },
        error: null,
      })
    );
    const signOutRejectSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockRejectedValueOnce(new Error('Network offline during signOut'))
      .mockResolvedValueOnce({ error: null });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-teacher')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('signout-error-screen')).toBeDefined();
      expect(screen.getByText(/Network offline during signOut/i)).toBeDefined();
    });
    expect(screen.queryByTestId('role-portal-teacher')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
    expect(signOutRejectSpy).toHaveBeenCalledTimes(2);
  });

  it('9. Blocks grade & feedback writes during isRevalidating, preserves drafts across refresh, and submits once explicitly after verification', async () => {
    let profileFetchCount = 0;
    let resolveRefreshProfile: (val: { data: any; error: any }) => void;

    vi.spyOn(adminService, 'getClasses').mockResolvedValue({
      data: [{ id: 'grp-1', name: 'Grade 8A', grade_level: 'Grade 8', subject: 'Physics', room: 'Lab 1' } as any],
      error: null,
    });
    vi.spyOn(adminService, 'getStudents').mockResolvedValue({
      data: [{ id: 'stu-1', full_name: 'Salma Ali', student_code: 'S-101', group_id: 'grp-1', grade_level: 'Grade 8', status: 'active' } as any],
      error: null,
    });
    vi.spyOn(adminService, 'getTeachers').mockResolvedValue({
      data: [{ id: 'tch-1', full_name: 'Dr. Omar', subject: 'Physics', email: 'omar@edutrack.com' } as any],
      error: null,
    });
    vi.spyOn(teacherService, 'getGrades').mockResolvedValue({ data: [], error: null });
    vi.spyOn(teacherService, 'getFeedback').mockResolvedValue({ data: [], error: null });

    const addGradeSpy = vi.spyOn(teacherService, 'addGrade').mockResolvedValue({
      data: {
        id: 'grade-1',
        student_id: 'stu-1',
        student_name: 'Salma Ali',
        class_id: 'grp-1',
        class_name: 'Grade 8A',
        subject: 'Physics',
        assessment_title: 'Midterm Physics',
        score: 88,
        max_score: 100,
        date: '2026-11-21',
        type: 'exam',
      },
      error: null,
    });
    const addFeedbackSpy = vi.spyOn(teacherService, 'addFeedback').mockResolvedValue({
      data: {
        id: 'fb-1',
        student_id: 'stu-1',
        student_name: 'Salma Ali',
        teacher_id: 'tch-1',
        teacher_name: 'Dr. Omar',
        feedback_text: 'Strong lab progress',
        is_parent_visible: true,
        date: '2026-11-21',
      },
      error: null,
    });

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: { user: { id: 'admin-gf-1', email: 'admin@edutrack.com' }, access_token: 'tok-1' } as any,
      },
      error: null,
    });

    mockProfileLookup((uid) => {
      profileFetchCount++;
      if (profileFetchCount === 1) {
        return Promise.resolve({
          data: { id: uid, email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin Grades' },
          error: null,
        });
      }
      return new Promise((resolve) => {
        resolveRefreshProfile = resolve;
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    // Navigate to Grades & Feedback view
    fireEvent.click(screen.getByRole('button', { name: /Grades & Feedback/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Record Grade/i })).toBeDefined();
    });

    // 1) Draft a Grade
    fireEvent.click(screen.getByRole('button', { name: /Record Grade/i }));
    fireEvent.change(screen.getByLabelText(/Assessment title/i), { target: { value: 'Midterm Physics' } });
    fireEvent.change(screen.getByLabelText(/^Score$/i), { target: { value: '88' } });
    fireEvent.change(screen.getByLabelText(/Maximum score/i), { target: { value: '100' } });

    // Start TOKEN_REFRESHED revalidation while grade draft is open
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'admin-gf-1', email: 'admin@edutrack.com' },
        access_token: 'tok-2',
      });
    });

    expect(screen.getByTestId('teacher-revalidating-banner')).toBeDefined();
    const saveGradeBtn = screen.getByRole('button', { name: /Save Grade/i }) as HTMLButtonElement;
    expect(saveGradeBtn.disabled).toBe(true);
    fireEvent.submit(saveGradeBtn.closest('form')!);
    expect(addGradeSpy).not.toHaveBeenCalled();

    // Complete verification with same role -> draft stays intact & still ZERO auto-saves
    await act(async () => {
      resolveRefreshProfile!({
        data: { id: 'admin-gf-1', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin Grades' },
        error: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('teacher-revalidating-banner')).toBeNull();
    });
    expect(addGradeSpy).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Assessment title/i) as HTMLInputElement).value).toBe('Midterm Physics');

    // Explicit Save Grade after verification sends once
    fireEvent.click(screen.getByRole('button', { name: /Save Grade/i }));
    await waitFor(() => {
      expect(addGradeSpy).toHaveBeenCalledTimes(1);
    });

    // 2) Draft Feedback
    fireEvent.click(screen.getByRole('button', { name: /Add Feedback/i }));
    fireEvent.change(screen.getByLabelText(/^Teacher$/i), { target: { value: 'tch-1' } });
    fireEvent.change(screen.getByLabelText(/Feedback text/i), { target: { value: 'Strong lab progress' } });

    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'admin-gf-1', email: 'admin@edutrack.com' },
        access_token: 'tok-3',
      });
    });

    expect(screen.getByTestId('teacher-revalidating-banner')).toBeDefined();
    const saveFeedbackBtn = screen.getByRole('button', { name: /Save Feedback/i }) as HTMLButtonElement;
    expect(saveFeedbackBtn.disabled).toBe(true);
    fireEvent.submit(saveFeedbackBtn.closest('form')!);
    expect(addFeedbackSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveRefreshProfile!({
        data: { id: 'admin-gf-1', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin Grades' },
        error: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('teacher-revalidating-banner')).toBeNull();
    });
    expect(addFeedbackSpy).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Feedback text/i) as HTMLTextAreaElement).value).toBe('Strong lab progress');

    fireEvent.click(screen.getByRole('button', { name: /Save Feedback/i }));
    await waitFor(() => {
      expect(addFeedbackSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('10. Blocks AttendanceQRScanner writes across camera, async image decode started before refresh, and manual scan without queueing', async () => {
    let profileFetchCount = 0;
    let resolveRefreshProfile: (val: { data: any; error: any }) => void;
    let pendingImgOnload: (() => void) | null = null;
    let getUserMediaResolve: ((stream: any) => void) | null = null;
    const mockTrack = { stop: vi.fn(), readyState: 'live' };

    const originalFileReader = global.FileReader;
    const originalImage = global.Image;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalMediaDevices = global.navigator.mediaDevices;

    class DeferredFileReader {
      result: string | ArrayBuffer | null = 'data:image/png;base64,AAA';
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    class DeferredImage {
      width = 100;
      height = 100;
      onload: (() => void) | null = null;
      set src(_val: string) {
        pendingImgOnload = () => this.onload?.();
      }
    }

    (global as any).FileReader = DeferredFileReader;
    (global as any).Image = DeferredImage;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;
    Object.defineProperty(global.navigator, 'mediaDevices', {
      writable: true,
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolve) => {
              getUserMediaResolve = resolve;
            })
        ),
      },
    });

    try {
      vi.spyOn(adminService, 'getClasses').mockResolvedValue({
        data: [{ id: 'grp-qr-1', name: 'Math QR', grade_level: 'Grade 9', subject: 'Math', room: '102' } as any],
        error: null,
      });
      const recordQRSpy = vi.spyOn(attendanceService, 'recordQRAttendance').mockResolvedValue({
        data: {
          success: true,
          code: 'RECORDED',
          message: 'Checked in successfully',
          attendance: {
            id: 'att-1',
            student_id: 'stu-1',
            group_id: 'grp-qr-1',
            date: '2026-11-21',
            status: 'Present',
            check_in_time: '09:05:00',
            scan_method: 'qr_scan',
            student_name: 'Omar',
            student_code: 'S-01',
          } as any,
        },
        error: null,
      });

      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: {
          session: { user: { id: 'admin-qr-1', email: 'admin@edutrack.com' }, access_token: 'tok-1' } as any,
        },
        error: null,
      });

      mockProfileLookup((uid) => {
        profileFetchCount++;
        if (profileFetchCount === 1) {
          return Promise.resolve({
            data: { id: uid, email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin QR' },
            error: null,
          });
        }
        return new Promise((resolve) => {
          resolveRefreshProfile = resolve;
        });
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('EduTrack Admin')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: /^Attendance$/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /QR Attendance Scanner/i })).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: /QR Attendance Scanner/i }));

      // Cycle A: Active live camera whose queued rAF frame fires during TOKEN_REFRESHED
      const rAFSpy = vi.spyOn(window, 'requestAnimationFrame');
      const playOriginal = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
      let resolveCameraFrameStream: ((stream: any) => void) | null = null;
      (global.navigator.mediaDevices.getUserMedia as any).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCameraFrameStream = resolve;
          })
      );

      fireEvent.click(screen.getByRole('button', { name: /Start Camera/i }));
      await act(async () => {
        resolveCameraFrameStream?.({ getTracks: () => [mockTrack] });
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Stop Camera/i })).toBeDefined();
      });
      const videoEl = document.querySelector('video') as HTMLVideoElement;
      Object.defineProperty(videoEl, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(videoEl, 'videoWidth', { value: 120, configurable: true });
      Object.defineProperty(videoEl, 'videoHeight', { value: 120, configurable: true });
      const queuedFrameCb = rAFSpy.mock.calls.at(-1)?.[0];

      // Start TOKEN_REFRESHED while camera is STILL live and fire the queued frame during revalidation
      await act(async () => {
        authStateCallback?.('TOKEN_REFRESHED', {
          user: { id: 'admin-qr-1', email: 'admin@edutrack.com' },
          access_token: 'tok-2a',
        });
      });
      expect(screen.getByTestId('qr-revalidating-banner')).toBeDefined();
      await act(async () => {
        queuedFrameCb?.(16);
      });
      expect(recordQRSpy).not.toHaveBeenCalled();

      // Finish Cycle A verification -> still 0 queued QR writes; stop camera before Cycle B
      await act(async () => {
        resolveRefreshProfile!({
          data: { id: 'admin-qr-1', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin QR' },
          error: null,
        });
      });
      await waitFor(() => {
        expect(screen.queryByTestId('qr-revalidating-banner')).toBeNull();
      });
      expect(recordQRSpy).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /Stop Camera/i }));
      HTMLMediaElement.prototype.play = playOriginal;
      rAFSpy.mockRestore();

      // Cycle B: Pending image decode & pending camera permission started BEFORE refresh, completing DURING refresh
      fireEvent.click(screen.getByRole('button', { name: /Upload Image/i }));
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const fakeFile = new File(['qr'], 'card.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
      expect(pendingImgOnload).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Live Camera/i }));
      fireEvent.click(screen.getByRole('button', { name: /Start Camera/i }));

      await act(async () => {
        authStateCallback?.('TOKEN_REFRESHED', {
          user: { id: 'admin-qr-1', email: 'admin@edutrack.com' },
          access_token: 'tok-2b',
        });
      });
      expect(screen.getByTestId('qr-revalidating-banner')).toBeDefined();

      // 1) In-flight camera stream resolves during revalidation -> stopped, 0 QR writes
      await act(async () => {
        getUserMediaResolve?.({ getTracks: () => [mockTrack] });
      });
      expect(mockTrack.stop).toHaveBeenCalled();
      expect(recordQRSpy).not.toHaveBeenCalled();

      // 2) Pre-refresh image decode completes during revalidation -> ignored, 0 QR writes
      await act(async () => {
        pendingImgOnload?.();
      });
      expect(recordQRSpy).not.toHaveBeenCalled();

      // 3) Upload file input is disabled while revalidating
      fireEvent.click(screen.getByRole('button', { name: /Upload Image/i }));
      expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);

      // 3) Manual scan attempted during revalidation -> disabled button & blocked submit, draft kept
      fireEvent.click(screen.getByRole('button', { name: /Token Test/i }));
      const tokenInput = screen.getByPlaceholderText(/Paste QR hash/i) as HTMLInputElement;
      fireEvent.change(tokenInput, { target: { value: 'ET-QR-HASH-101' } });
      const manualSubmitBtn = screen.getByRole('button', { name: /Submit Scan/i }) as HTMLButtonElement;
      expect(manualSubmitBtn.disabled).toBe(true);
      fireEvent.submit(manualSubmitBtn.closest('form')!);
      expect(recordQRSpy).not.toHaveBeenCalled();
      expect(tokenInput.value).toBe('ET-QR-HASH-101');

      // Complete revalidation -> STILL 0 queued/auto-fired QR writes
      await act(async () => {
        resolveRefreshProfile!({
          data: { id: 'admin-qr-1', email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin QR' },
          error: null,
        });
      });
      await waitFor(() => {
        expect(screen.queryByTestId('qr-revalidating-banner')).toBeNull();
      });
      expect(recordQRSpy).not.toHaveBeenCalled();

      // Explicit new scan action after verification sends ONCE
      fireEvent.click(screen.getByRole('button', { name: /Submit Scan/i }));
      await waitFor(() => {
        expect(recordQRSpy).toHaveBeenCalledTimes(1);
        expect(recordQRSpy).toHaveBeenCalledWith('ET-QR-HASH-101', 'grp-qr-1');
      });
    } finally {
      (global as any).FileReader = originalFileReader;
      (global as any).Image = originalImage;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      Object.defineProperty(global.navigator, 'mediaDevices', {
        writable: true,
        configurable: true,
        value: originalMediaDevices,
      });
    }
  });

  it('11. Ignores duplicate SIGNED_IN for outgoing user during signing_out & signout_error, allows Retry Sign Out, then normal login afterwards', async () => {
    let resolvePendingSignOut: (val: any) => void;
    const pendingSignOutPromise = new Promise((resolve) => {
      resolvePendingSignOut = resolve;
    });

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: { user: { id: 'admin-out-1', email: 'admin@edutrack.com' }, access_token: 'tok-1' } as any,
      },
      error: null,
    });

    mockProfileLookup(async (uid) => ({
      data: { id: uid, email: 'admin@edutrack.com', role: 'admin', full_name: 'Admin Out' },
      error: null,
    }));

    const getOverviewSpy = vi.spyOn(adminService, 'getDashboardOverview');
    const getStudentsSpy = vi.spyOn(adminService, 'getStudents');

    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockReturnValueOnce(pendingSignOutPromise as any)
      .mockResolvedValueOnce({ error: null });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });

    getOverviewSpy.mockClear();
    getStudentsSpy.mockClear();

    // User clicks Sign Out (remains pending in signing_out)
    fireEvent.click(screen.getByTitle('Sign Out'));

    await waitFor(() => {
      expect(screen.getByTestId('signing-out-screen')).toBeDefined();
    });
    expect(screen.queryByText('EduTrack Admin')).toBeNull();

    // Duplicate SIGNED_IN arrives for the SAME outgoing account during signing_out -> MUST BE IGNORED
    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'admin-out-1', email: 'admin@edutrack.com' },
        access_token: 'tok-dup-1',
      });
    });

    expect(screen.getByTestId('signing-out-screen')).toBeDefined();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(getOverviewSpy).not.toHaveBeenCalled();
    expect(getStudentsSpy).not.toHaveBeenCalled();

    // Pending signOut returns { error } -> lands on signout_error screen
    await act(async () => {
      resolvePendingSignOut!({ error: { message: 'Session revoke timeout' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('signout-error-screen')).toBeDefined();
      expect(screen.getByText(/Session revoke timeout/i)).toBeDefined();
    });

    // Duplicate SIGNED_IN arrives for SAME outgoing account during signout_error -> STILL IGNORED
    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'admin-out-1', email: 'admin@edutrack.com' },
        access_token: 'tok-dup-2',
      });
    });

    expect(screen.getByTestId('signout-error-screen')).toBeDefined();
    expect(screen.queryByText('EduTrack Admin')).toBeNull();
    expect(getOverviewSpy).not.toHaveBeenCalled();
    expect(getStudentsSpy).not.toHaveBeenCalled();

    // User clicks Retry Sign Out -> succeeds and shows login page
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
    expect(signOutSpy).toHaveBeenCalledTimes(2);

    // Normal sign-in with that same account works cleanly after completed sign-out
    vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
      data: {
        user: { id: 'admin-out-1', email: 'admin@edutrack.com' } as any,
        session: {
          user: { id: 'admin-out-1', email: 'admin@edutrack.com' },
          access_token: 'tok-fresh-login',
        } as any,
      },
      error: null,
    });

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'admin@edutrack.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'SecretPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign In to EduTrack/i }));

    await waitFor(() => {
      expect(screen.getByText('EduTrack Admin')).toBeDefined();
    });
  });
});
