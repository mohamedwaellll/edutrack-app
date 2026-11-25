// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { AuthChangeEvent, Session, Subscription } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';
import { adminService } from '../services/adminService';
import { accountLinkingService } from '../services/accountLinkingService';
import { teacherService } from '../services/teacherService';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const CHILD_1_ID = '11111111-1111-4111-8111-100000000101';
const CHILD_2_ID = '11111111-1111-4111-8111-100000000102';
const PARENT_1_ID = '33333333-3333-4333-8333-100000000001';
const PARENT_2_ID = '33333333-3333-4333-8333-100000000002';

type RpcReturn = ReturnType<typeof supabase.rpc>;
type RpcResolved = Awaited<RpcReturn>;
const rpcResolve = (data: unknown, error: { message: string } | null = null): RpcReturn =>
  Promise.resolve({ data, error }) as unknown as RpcReturn;

function setupParentAuth(userId: string, fullName: string) {
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: {
      session: {
        user: { id: userId, email: `${userId}@edutrack.com` },
        access_token: `tok-${userId}`,
      } as unknown as Session,
    },
    error: null,
  });

  vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_col: string, uid: string) => ({
            maybeSingle: async () => ({
              data: { id: uid, email: `${uid}@edutrack.com`, role: 'parent', full_name: fullName },
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

describe('Parent Portal Stage E (App Entry Point, Child Switch, Validation & Revocation)', () => {
  let authStateCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    authStateCallback = null;
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } as unknown as Subscription } };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Lists identical-name linked children with unique codes, loads 18/20 grade, attendance & parent-visible notes without admin/QR/PII leaks', async () => {
    setupParentAuth(PARENT_1_ID, 'Mr. Ali Guardian');

    const getOverviewSpy = vi.spyOn(adminService, 'getDashboardOverview');
    const getStudentsSpy = vi.spyOn(adminService, 'getStudents');
    const getProfilesSpy = vi.spyOn(accountLinkingService, 'getProfilesByRole');
    const getGradesSpy = vi.spyOn(teacherService, 'getGrades');

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, args?: unknown) => {
      const params = args as { p_student_id?: string } | undefined;
      if (fnName === 'get_parent_portal_children') {
        return rpcResolve({
          children: [
            {
              id: CHILD_1_ID,
              full_name: 'Sara Ali',
              student_code: 'ET-E-101',
              grade_level: 'Grade 10',
              status: 'active',
              group: { id: 'g-1', name: 'Group Alpha', grade_level: 'Grade 10' },
              qr_code_hash: 'HIDDEN-QR-E101',
              parent_phone: '+201009998888',
            },
            {
              id: CHILD_2_ID,
              full_name: 'Sara Ali',
              student_code: 'ET-E-102',
              grade_level: 'Grade 11',
              status: 'active',
              group: null,
            },
          ],
        });
      }

      if (fnName === 'get_parent_child_details') {
        if (params?.p_student_id === CHILD_1_ID) {
          return rpcResolve({
            child: {
              id: CHILD_1_ID,
              full_name: 'Sara Ali',
              student_code: 'ET-E-101',
              grade_level: 'Grade 10',
              status: 'active',
              group: { id: 'g-1', name: 'Group Alpha', grade_level: 'Grade 10' },
            },
            attendance: [
              { id: 'att-1', date: '2026-11-22', status: 'Present', check_in_time: '08:10' },
            ],
            grades: [
              {
                id: 'gr-1',
                assessment_title: 'Linear Algebra Quiz',
                grade_type: 'quiz',
                score: 18,
                max_score: 20,
                assessment_date: '2026-11-21',
              },
            ],
            notes: [
              {
                id: 'note-1',
                author_name: 'Ms. Nadia',
                feedback_text: 'Great progress in Algebra',
                note_date: '2026-11-22',
                created_at: '2026-11-22T08:30:00Z',
              },
            ],
          });
        }

        if (params?.p_student_id === CHILD_2_ID) {
          return rpcResolve({
            child: {
              id: CHILD_2_ID,
              full_name: 'Sara Ali',
              student_code: 'ET-E-102',
              grade_level: 'Grade 11',
              status: 'active',
              group: null,
            },
            attendance: [],
            grades: [],
            notes: [],
          });
        }
      }

      return rpcResolve(null);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-parent')).toBeDefined();
      expect(screen.getByTestId('parent-child-selector')).toBeDefined();
      expect(screen.getByTestId('parent-child-code').textContent).toBe('ET-E-101');
    });

    // Both identical-name children are disambiguated by student_code
    expect(screen.getByTestId('parent-child-option-ET-E-101')).toBeDefined();
    expect(screen.getByTestId('parent-child-option-ET-E-102')).toBeDefined();
    expect(screen.getByText('Linear Algebra Quiz')).toBeDefined();
    expect(screen.getByText('18 / 20')).toBeDefined();
    expect(screen.getByText('Present')).toBeDefined();
    expect(screen.getByText('Check-in: 08:10')).toBeDefined();
    expect(screen.getByText('Ms. Nadia')).toBeDefined();
    expect(screen.getByText('Great progress in Algebra')).toBeDefined();

    // No QR hashes, phone PII, or admin/teacher writes leaked
    expect(document.body.textContent).not.toContain('HIDDEN-QR-E101');
    expect(document.body.textContent).not.toContain('+201009998888');
    expect(getOverviewSpy).not.toHaveBeenCalled();
    expect(getStudentsSpy).not.toHaveBeenCalled();
    expect(getProfilesSpy).not.toHaveBeenCalled();
    expect(getGradesSpy).not.toHaveBeenCalled();
    expect(rpcSpy).toHaveBeenCalledWith('get_parent_portal_children');

    // Switch to second same-name child ET-E-102 -> displays clean empty child records
    fireEvent.click(screen.getByTestId('parent-child-option-ET-E-102'));
    await waitFor(() => {
      expect(screen.getByTestId('parent-child-code').textContent).toBe('ET-E-102');
      expect(screen.getByTestId('parent-attendance-empty')).toBeDefined();
      expect(screen.getByTestId('parent-grades-empty')).toBeDefined();
      expect(screen.getByTestId('parent-notes-empty')).toBeDefined();
    });
  });

  it('2. Clears previous child immediately on switch and ignores stale delayed child details responses', async () => {
    setupParentAuth(PARENT_1_ID, 'Mr. Ali Guardian');

    let resolveSlowChild1: (val: RpcResolved) => void;
    let resolveChild2: (val: RpcResolved) => void;

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, args?: unknown) => {
      const params = args as { p_student_id?: string } | undefined;
      if (fnName === 'get_parent_portal_children') {
        return rpcResolve({
          children: [
            {
              id: CHILD_1_ID,
              full_name: 'Child One',
              student_code: 'ET-101',
              grade_level: 'Grade 9',
              status: 'active',
              group: null,
            },
            {
              id: CHILD_2_ID,
              full_name: 'Child Two',
              student_code: 'ET-102',
              grade_level: 'Grade 10',
              status: 'active',
              group: null,
            },
          ],
        });
      }

      if (fnName === 'get_parent_child_details') {
        if (params?.p_student_id === CHILD_1_ID) {
          return new Promise<RpcResolved>((resolve) => {
            resolveSlowChild1 = resolve;
          }) as unknown as RpcReturn;
        }
        if (params?.p_student_id === CHILD_2_ID) {
          return new Promise<RpcResolved>((resolve) => {
            resolveChild2 = resolve;
          }) as unknown as RpcReturn;
        }
      }

      return rpcResolve(null);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('parent-child-option-ET-102')).toBeDefined();
      expect(screen.getByTestId('parent-details-loading')).toBeDefined();
    });

    // Switch to Child Two BEFORE Child One resolves
    fireEvent.click(screen.getByTestId('parent-child-option-ET-102'));
    expect(screen.queryByTestId('parent-child-card')).toBeNull();

    // Child Two resolves first
    await act(async () => {
      resolveChild2!({
        data: {
          child: {
            id: CHILD_2_ID,
            full_name: 'Child Two',
            student_code: 'ET-102',
            grade_level: 'Grade 10',
            status: 'active',
            group: null,
          },
          attendance: [],
          grades: [
            {
              id: 'g-c2',
              assessment_title: 'Child Two Physics',
              grade_type: 'exam',
              score: 19,
              max_score: 20,
              assessment_date: '2026-11-22',
            },
          ],
          notes: [],
        },
        error: null,
      } as unknown as RpcResolved);
    });

    await waitFor(() => {
      expect(screen.getByTestId('parent-child-code').textContent).toBe('ET-102');
      expect(screen.getByText('Child Two Physics')).toBeDefined();
    });

    // Late Child One response arrives now -> MUST BE IGNORED
    await act(async () => {
      resolveSlowChild1!({
        data: {
          child: {
            id: CHILD_1_ID,
            full_name: 'Child One',
            student_code: 'ET-101',
            grade_level: 'Grade 9',
            status: 'active',
            group: null,
          },
          attendance: [],
          grades: [
            {
              id: 'g-stale-c1',
              assessment_title: 'Stale Child One Grade',
              grade_type: 'quiz',
              score: 5,
              max_score: 20,
              assessment_date: '2026-11-20',
            },
          ],
          notes: [],
        },
        error: null,
      } as unknown as RpcResolved);
    });

    expect(screen.getByTestId('parent-child-code').textContent).toBe('ET-102');
    expect(screen.queryByText('Stale Child One Grade')).toBeNull();
  });

  it('3. Distinguishes empty children [], malformed/failed reads with Retry, link revocation, and immediate wipe on Sign Out', async () => {
    setupParentAuth(PARENT_2_ID, 'Parent Retry User');

    let scenario: 'children_error' | 'details_error' | 'revoked_then_empty' = 'children_error';
    let childCalls = 0;

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string) => {
      if (fnName === 'get_parent_portal_children') {
        childCalls++;
        if (scenario === 'children_error' && childCalls === 1) {
          return rpcResolve(null, { message: 'Temporary RPC read failure' });
        }
        if (scenario === 'revoked_then_empty') {
          return rpcResolve({ children: [] });
        }
        return rpcResolve({
          children: [
            {
              id: CHILD_1_ID,
              full_name: 'Sara Ali',
              student_code: 'ET-E-101',
              grade_level: 'Grade 10',
              status: 'active',
              group: null,
            },
          ],
        });
      }

      if (fnName === 'get_parent_child_details') {
        if (scenario === 'details_error') {
          // Simulate invalid unknown attendance status or read failure
          return rpcResolve({
            child: {
              id: CHILD_1_ID,
              full_name: 'Sara Ali',
              student_code: 'ET-E-101',
              grade_level: 'Grade 10',
              status: 'active',
              group: null,
            },
            attendance: [{ id: 'bad-a', date: '2026-11-22', status: 'InvalidEnum', check_in_time: null }],
            grades: [],
            notes: [],
          });
        }
        if (scenario === 'revoked_then_empty') {
          return rpcResolve(null, { message: 'Access denied: Child is not linked to the authenticated parent account.' });
        }
        return rpcResolve({
          child: {
            id: CHILD_1_ID,
            full_name: 'Sara Ali',
            student_code: 'ET-E-101',
            grade_level: 'Grade 10',
            status: 'active',
            group: null,
          },
          attendance: [],
          grades: [],
          notes: [],
        });
      }

      return rpcResolve(null);
    });

    render(<App />);

    // 1) Initial children read error shows Retry
    await waitFor(() => {
      expect(screen.getByTestId('parent-children-error')).toBeDefined();
      expect(screen.getByText(/Temporary RPC read failure/i)).toBeDefined();
    });

    // Retry loads children, then invalid details payload shows details Retry
    scenario = 'details_error';
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.getByTestId('parent-details-error')).toBeDefined();
      expect(screen.getByText(/Unknown attendance status/i)).toBeDefined();
    });

    // Retry after fixing details shows clean empty records
    scenario = 'children_error'; // childCalls > 1 so children succeeds and details succeeds
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.getByTestId('parent-child-card')).toBeDefined();
    });

    // Admin revokes child link -> Refresh sees revoked link or Refresh reloads empty children cleanly
    scenario = 'revoked_then_empty';
    // Re-click child option directly after details error simulation, or first simulate revocation on child select:
    // Let's switch scenario inside Refresh cleanly by first having a valid children list then revoked on details:
    let phaseRevoke = false;
    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string) => {
      if (fnName === 'get_parent_portal_children') {
        return rpcResolve({
          children: phaseRevoke
            ? []
            : [
                {
                  id: CHILD_1_ID,
                  full_name: 'Sara Ali',
                  student_code: 'ET-E-101',
                  grade_level: 'Grade 10',
                  status: 'active',
                  group: null,
                },
              ],
        });
      }
      phaseRevoke = true;
      return rpcResolve(null, { message: 'Access denied: Child is not linked to the authenticated parent account.' });
    });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('parent-link-revoked-banner')).toBeDefined();
      expect(screen.getByTestId('parent-no-children')).toBeDefined();
    });
    expect(screen.queryByTestId('parent-child-card')).toBeNull();

    // Sign Out clears portal immediately
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
    expect(screen.queryByTestId('role-portal-parent')).toBeNull();
  });

  it('4. Ignores sign-in / auth state changes gracefully when switching parent account', async () => {
    setupParentAuth(PARENT_1_ID, 'Parent A');
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { children: [] },
      error: null,
    } as unknown as RpcResolved);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('parent-no-children')).toBeDefined();
    });

    await act(async () => {
      authStateCallback?.('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
  });
});
