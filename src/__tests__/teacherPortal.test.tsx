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
import { normalizeStudentStatus } from '../services/teacherPortalService';
import { getCairoDateString } from '../services/attendanceService';

const STU_1 = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const STU_2 = 'cccccccc-cccc-4ccc-8ccc-000000000002';
const STU_UNK = 'cccccccc-cccc-4ccc-8ccc-000000000003';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function setupTeacherAuthSession(userId: string, fullName: string, role: 'teacher' | 'admin' | 'student' = 'teacher') {
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: {
      session: {
        user: { id: userId, email: `${role}@edutrack.com` },
        access_token: `tok-${userId}`,
      } as any,
    },
    error: null,
  });

  vi.spyOn(supabase, 'from').mockImplementation((table: string): any => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_col: string, uid: string) => ({
            maybeSingle: async () => ({
              data: { id: uid, email: `${role}@edutrack.com`, role, full_name: fullName },
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
  });
}

const GRP_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const GRP_EMPTY = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const GRP_M1 = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
const GRP_SLOW = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
const GRP_FAST = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005';
const GRP_T2 = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006';
const GRP_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000007';
const GRP_TWO = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000008';

describe('Teacher Portal Stage C.1 (App Entry Point, Read-Only Scope & Stale Response Protection)', () => {
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

  it('1. Displays assigned groups and minimal read-only student fields (never parent PII or QR hash), handles empty groups, and never calls write/admin services', async () => {
    setupTeacherAuthSession('teacher-u-1', 'Tariq Teacher');

    const getOverviewSpy = vi.spyOn(adminService, 'getDashboardOverview');
    const addGradeSpy = vi.spyOn(teacherService, 'addGrade');
    const addFeedbackSpy = vi.spyOn(teacherService, 'addFeedback');
    const getProfilesSpy = vi.spyOn(accountLinkingService, 'getProfilesByRole');

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, params?: any): any => {
      if (fnName === 'get_teacher_portal_context') {
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 't-rec-1', full_name: 'Tariq Teacher', subject: 'Physics' },
            groups: [
              { id: GRP_1, name: 'Grade 10A', grade_level: 'Grade 10', student_count: 2 },
              { id: GRP_EMPTY, name: 'Grade 11 Lab', grade_level: 'Grade 11', student_count: 0 },
            ],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_group_students' && params?.p_group_id === GRP_1) {
        return Promise.resolve({
          data: {
            group: { id: GRP_1, name: 'Grade 10A', grade_level: 'Grade 10' },
            students: [
              {
                id: 'stu-1',
                full_name: 'Salma Hassan',
                student_code: 'ET-101',
                status: 'active',
                group_id: GRP_1,
                // Even if extra private properties existed, service & UI strip them strictly:
                qr_code_hash: 'LEAKED-QR-SECRET',
                parent_phone: '+201009998877',
              },
              {
                id: 'stu-2',
                full_name: 'Omar Nabil',
                student_code: 'ET-102',
                status: 'suspended',
                group_id: GRP_1,
              },
            ],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_group_students' && params?.p_group_id === GRP_EMPTY) {
        return Promise.resolve({
          data: {
            group: { id: GRP_EMPTY, name: 'Grade 11 Lab', grade_level: 'Grade 11' },
            students: [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: 'Unexpected RPC' } });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-teacher')).toBeDefined();
      expect(screen.getByText('Salma Hassan')).toBeDefined();
    });

    // Only assigned groups & required roster columns are displayed
    expect(screen.getByTestId(`teacher-group-item-${GRP_1}`)).toBeDefined();
    expect(screen.getByTestId('selected-group-title').textContent).toBe('Grade 10A');
    expect(screen.getByText('Grade 11 Lab')).toBeDefined();
    expect(screen.getByText('ET-101')).toBeDefined();
    expect(screen.getByText('active')).toBeDefined();
    expect(screen.getByText('Omar Nabil')).toBeDefined();
    expect(screen.getByText('suspended')).toBeDefined();

    // Parent contact info, QR secrets, and Stage C.2 write controls must NEVER appear
    expect(screen.queryByText(/LEAKED-QR-SECRET/)).toBeNull();
    expect(screen.queryByText(/\+201009998877/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Record Grade/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add Feedback/i })).toBeNull();

    // RPC calls never passed client-side teacherId
    expect(rpcSpy).toHaveBeenCalledWith('get_teacher_portal_context');
    expect(rpcSpy).toHaveBeenCalledWith('get_teacher_group_students', { p_group_id: GRP_1 });
    expect(getOverviewSpy).not.toHaveBeenCalled();
    expect(addGradeSpy).not.toHaveBeenCalled();
    expect(addFeedbackSpy).not.toHaveBeenCalled();
    expect(getProfilesSpy).not.toHaveBeenCalled();

    // Switch to empty assigned group -> distinct empty roster state
    fireEvent.click(screen.getByTestId(`teacher-group-item-${GRP_EMPTY}`));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-empty-group-state')).toBeDefined();
      expect(screen.getByText('No Students Enrolled in This Group')).toBeDefined();
    });
  });

  it('2. Distinguishes unlinked teacher account, linked teacher with zero groups, and load errors with working Retry', async () => {
    setupTeacherAuthSession('teacher-u-2', 'Nadia Teacher');

    let phase: 'error' | 'unlinked' | 'no_groups' | 'has_group' | 'group_error' | 'group_recovered' = 'error';

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string): any => {
      if (fnName === 'get_teacher_portal_context') {
        if (phase === 'error') {
          return Promise.resolve({ data: null, error: { message: 'Context RPC failed' } });
        }
        if (phase === 'unlinked') {
          return Promise.resolve({ data: { linked: false, teacher: null, groups: [] }, error: null });
        }
        if (phase === 'no_groups') {
          return Promise.resolve({
            data: {
              linked: true,
              teacher: { id: 't-2', full_name: 'Nadia Teacher', subject: 'Math' },
              groups: [],
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 't-2', full_name: 'Nadia Teacher', subject: 'Math' },
            groups: [{ id: GRP_M1, name: 'Grade 9B', grade_level: 'Grade 9', student_count: 1 }],
          },
          error: null,
        });
      }

      if (fnName === 'get_teacher_group_students') {
        if (phase === 'group_error') {
          return Promise.resolve({ data: null, error: { message: 'Access denied: Group unassigned' } });
        }
        return Promise.resolve({
          data: {
            group: { id: GRP_M1, name: 'Grade 9B', grade_level: 'Grade 9' },
            students: [{ id: 'stu-m1', full_name: 'Ziad Samir', student_code: 'ET-209', status: 'active', group_id: GRP_M1 }],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<App />);

    // 1) Initial context load error + Retry
    await waitFor(() => {
      expect(screen.getByTestId('teacher-context-error')).toBeDefined();
      expect(screen.getByText(/Context RPC failed/i)).toBeDefined();
    });

    // 2) Unlinked teacher state
    phase = 'unlinked';
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-unlinked-state')).toBeDefined();
    });

    // 3) Linked teacher with 0 assigned groups
    phase = 'no_groups';
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-no-groups-state')).toBeDefined();
    });

    // 4) Group assigned, but roster fetch fails -> shows group error + Retry
    phase = 'group_error';
    fireEvent.click(screen.getByRole('button', { name: /Refresh Groups/i }));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-students-error')).toBeDefined();
      expect(screen.getByText(/Access denied: Group unassigned/i)).toBeDefined();
    });

    // 5) Retry loads roster cleanly
    phase = 'group_recovered';
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    await waitFor(() => {
      expect(screen.getByText('Ziad Samir')).toBeDefined();
    });
  });

  it('3. Ignores delayed roster response after switching groups and delayed portal response after account switch or sign-out', async () => {
    let resolveSlowGroupA: (val: any) => void;
    let resolveSlowTeacher1Ctx: (val: any) => void;
    let ctxCalls = 0;

    setupTeacherAuthSession('teacher-race-1', 'Teacher Race 1');

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, params?: any): any => {
      if (fnName === 'get_teacher_portal_context') {
        ctxCalls++;
        if (ctxCalls === 1) {
          return Promise.resolve({
            data: {
              linked: true,
              teacher: { id: 'tr-1', full_name: 'Teacher Race 1', subject: 'Bio' },
              groups: [
                { id: GRP_SLOW, name: 'Slow Group A', grade_level: 'Grade 8', student_count: 1 },
                { id: GRP_FAST, name: 'Fast Group B', grade_level: 'Grade 9', student_count: 1 },
              ],
            },
            error: null,
          });
        }
        if (ctxCalls === 2) {
          // Slow context reload for Teacher 1 before account switch
          return new Promise((resolve) => {
            resolveSlowTeacher1Ctx = resolve;
          });
        }
        // Teacher 2 portal context
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 'tr-2', full_name: 'Teacher Race 2', subject: 'Chem' },
            groups: [{ id: GRP_T2, name: 'Teacher 2 Only Group', grade_level: 'Grade 12', student_count: 1 }],
          },
          error: null,
        });
      }

      if (fnName === 'get_teacher_group_students') {
        if (params?.p_group_id === GRP_SLOW) {
          return new Promise((resolve) => {
            resolveSlowGroupA = resolve;
          });
        }
        if (params?.p_group_id === GRP_FAST) {
          return Promise.resolve({
            data: {
              group: { id: GRP_FAST, name: 'Fast Group B', grade_level: 'Grade 9' },
              students: [{ id: 'stu-fast', full_name: 'Fast Group Student', student_code: 'F-01', status: 'active', group_id: GRP_FAST }],
            },
            error: null,
          });
        }
        if (params?.p_group_id === GRP_T2) {
          return Promise.resolve({
            data: {
              group: { id: GRP_T2, name: 'Teacher 2 Only Group', grade_level: 'Grade 12' },
              students: [{ id: 'stu-t2', full_name: 'Teacher Two Student', student_code: 'T2-01', status: 'active', group_id: GRP_T2 }],
            },
            error: null,
          });
        }
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<App />);

    // Wait for groups to render while Slow Group A roster request is still pending
    await waitFor(() => {
      expect(screen.getByTestId(`teacher-group-item-${GRP_FAST}`)).toBeDefined();
      expect(screen.getByTestId('teacher-students-loading')).toBeDefined();
    });

    // Switch immediately to Fast Group B before Slow Group A resolves
    fireEvent.click(screen.getByTestId(`teacher-group-item-${GRP_FAST}`));
    await waitFor(() => {
      expect(screen.getByText('Fast Group Student')).toBeDefined();
    });

    // Late Slow Group A response resolves now -> MUST BE IGNORED
    await act(async () => {
      resolveSlowGroupA!({
        data: {
          group: { id: GRP_SLOW, name: 'Slow Group A', grade_level: 'Grade 8' },
          students: [{ id: 'stu-slow', full_name: 'Stale Group A Student', student_code: 'S-99', status: 'active', group_id: GRP_SLOW }],
        },
        error: null,
      });
    });

    expect(screen.getByText('Fast Group Student')).toBeDefined();
    expect(screen.queryByText('Stale Group A Student')).toBeNull();

    // Trigger context reload for Teacher 1 (slow), then switch account to Teacher 2 immediately
    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-context-loading')).toBeDefined();
    });

    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'teacher-race-2', email: 'teacher2@edutrack.com' },
        access_token: 'tok-race-2',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-group-title').textContent).toBe('Teacher 2 Only Group');
      expect(screen.getByText('Teacher Two Student')).toBeDefined();
    });

    // Late Teacher 1 context response resolves now -> MUST NOT overwrite Teacher 2
    await act(async () => {
      resolveSlowTeacher1Ctx!({
        data: {
          linked: true,
          teacher: { id: 'tr-1', full_name: 'Teacher Race 1', subject: 'Bio' },
          groups: [{ id: GRP_SLOW, name: 'Slow Group A', grade_level: 'Grade 8', student_count: 1 }],
        },
        error: null,
      });
    });

    expect(screen.getByTestId('selected-group-title').textContent).toBe('Teacher 2 Only Group');
    expect(screen.queryByText('Slow Group A')).toBeNull();
  });

  it('4. Preserves same-user TOKEN_REFRESHED selection and protects Sign Out / Retry Sign Out in Teacher Portal', async () => {
    let profileReads = 0;
    let resolveTokenRefreshProfile: (val: any) => void;

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: { user: { id: 'teacher-so-1', email: 't@edutrack.com' }, access_token: 'tok-1' } as any,
      },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockImplementation((table: string): any => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_col: string, uid: string) => ({
              maybeSingle: () => {
                profileReads++;
                if (profileReads === 1) {
                  return Promise.resolve({
                    data: { id: uid, email: 't@edutrack.com', role: 'teacher', full_name: 'Teacher KeepState' },
                    error: null,
                  });
                }
                return new Promise((resolve) => {
                  resolveTokenRefreshProfile = resolve;
                });
              },
            }),
          }),
        };
      }
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    });

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, params?: any): any => {
      if (fnName === 'get_teacher_portal_context') {
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 'tk-1', full_name: 'Teacher KeepState', subject: 'History' },
            groups: [
              { id: GRP_ONE, name: 'Group One', grade_level: 'Grade 7', student_count: 1 },
              { id: GRP_TWO, name: 'Group Two', grade_level: 'Grade 8', student_count: 1 },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          group: {
            id: params?.p_group_id,
            name: params?.p_group_id === GRP_TWO ? 'Group Two' : 'Group One',
            grade_level: 'Grade 8',
          },
          students: [
            {
              id: `stu-${params?.p_group_id}`,
              full_name: params?.p_group_id === GRP_TWO ? 'Selected Two Student' : 'First Student',
              student_code: 'CODE-1',
              status: 'active',
              group_id: params?.p_group_id,
            },
          ],
        },
        error: null,
      });
    });

    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockResolvedValueOnce({ error: { message: 'Signout failed in TeacherPortal' } as any })
      .mockResolvedValueOnce({ error: null });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('First Student')).toBeDefined();
    });

    // Select second group
    fireEvent.click(screen.getByTestId(`teacher-group-item-${GRP_TWO}`));
    await waitFor(() => {
      expect(screen.getByText('Selected Two Student')).toBeDefined();
    });

    // Trigger same-user TOKEN_REFRESHED -> keeps selected Group Two intact
    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'teacher-so-1', email: 't@edutrack.com' },
        access_token: 'tok-2',
      });
    });
    expect(screen.getByTestId('teacher-portal-revalidating-banner')).toBeDefined();
    expect(screen.getByText('Selected Two Student')).toBeDefined();

    await act(async () => {
      resolveTokenRefreshProfile!({
        data: { id: 'teacher-so-1', email: 't@edutrack.com', role: 'teacher', full_name: 'Teacher KeepState' },
        error: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('teacher-portal-revalidating-banner')).toBeNull();
    });
    expect(screen.getByText('Selected Two Student')).toBeDefined();

    // Sign Out failure + Retry Sign Out works cleanly
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('signout-error-screen')).toBeDefined();
    });
    expect(screen.queryByTestId('role-portal-teacher')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry Sign Out/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
    expect(signOutSpy).toHaveBeenCalledTimes(2);
  });

  it('5. Teacher saves grade and note (internal default), reloads App, and reads saved records back from database RPCs', async () => {
    setupTeacherAuthSession('teacher-c2-save', 'Hossam Teacher');

    const persistedGrades: any[] = [];
    const persistedNotes: any[] = [];
    const today = getCairoDateString();

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, params?: any): any => {
      if (fnName === 'get_teacher_portal_context') {
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 'tch-c2-1', full_name: 'Hossam Teacher', subject: 'Physics' },
            groups: [{ id: GRP_1, name: 'Physics 10A', grade_level: 'Grade 10', student_count: 1 }],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_group_students') {
        return Promise.resolve({
          data: {
            group: { id: GRP_1, name: 'Physics 10A', grade_level: 'Grade 10' },
            students: [{ id: STU_1, full_name: 'Laila Adel', student_code: 'ET-301', status: 'active', group_id: GRP_1 }],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_student_records') {
        return Promise.resolve({
          data: {
            student: { id: STU_1, full_name: 'Laila Adel', student_code: 'ET-301', status: 'active', group_id: GRP_1 },
            grades: [...persistedGrades],
            notes: [...persistedNotes],
          },
          error: null,
        });
      }
      if (fnName === 'save_teacher_student_grade') {
        const created = {
          id: `grd-${persistedGrades.length + 1}`,
          student_id: params.p_student_id,
          group_id: params.p_group_id,
          teacher_id: 'tch-c2-1',
          author_name: 'Hossam Teacher',
          assessment_title: params.p_assessment_title,
          grade_type: params.p_grade_type,
          score: params.p_score,
          max_score: params.p_max_score,
          assessment_date: params.p_assessment_date,
          remarks: params.p_notes || '',
          created_at: new Date().toISOString(),
        };
        persistedGrades.push(created);
        return Promise.resolve({ data: { grade: created }, error: null });
      }
      if (fnName === 'save_teacher_student_note') {
        const created = {
          id: `note-${persistedNotes.length + 1}`,
          student_id: params.p_student_id,
          teacher_id: 'tch-c2-1',
          author_name: 'Hossam Teacher',
          feedback_text: params.p_feedback_text,
          is_parent_visible: params.p_is_parent_visible,
          note_date: today,
          created_at: new Date().toISOString(),
        };
        persistedNotes.push(created);
        return Promise.resolve({ data: { note: created }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId(`select-student-${STU_1}`)).toBeDefined();
    });

    // Open student records
    fireEvent.click(screen.getByTestId(`select-student-${STU_1}`));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-student-records-panel')).toBeDefined();
    });

    // Save grade
    fireEvent.click(screen.getByRole('button', { name: /Add Grade/i }));
    expect(screen.getByTestId('modal-student-context').textContent).toContain('ET-301');
    expect(screen.getByTestId('modal-student-context').textContent).toContain('Physics 10A');
    fireEvent.change(screen.getByLabelText(/Assessment Title/i), { target: { value: 'Midterm Quiz 1' } });
    fireEvent.change(screen.getByLabelText(/^Score$/i), { target: { value: '19' } });
    fireEvent.change(screen.getByLabelText(/Maximum Score/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/Remarks/i), { target: { value: 'Excellent lab work' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Grade/i }));

    await waitFor(() => {
      expect(screen.getByText('Midterm Quiz 1')).toBeDefined();
      expect(screen.getByText('19 / 20')).toBeDefined();
    });

    // Save note: verify default visibility is Internal Only (false)
    fireEvent.click(screen.getByRole('button', { name: /Add Note/i }));
    const internalRadio = screen.getByDisplayValue('internal') as HTMLInputElement;
    const parentRadio = screen.getByDisplayValue('parent') as HTMLInputElement;
    expect(internalRadio.checked).toBe(true);
    expect(parentRadio.checked).toBe(false);
    fireEvent.change(screen.getByLabelText(/Note Text/i), { target: { value: 'Prepared all homework cleanly' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Note/i }));

    await waitFor(() => {
      expect(screen.getByText('Prepared all homework cleanly')).toBeDefined();
      expect(screen.getByText('Internal Only')).toBeDefined();
    });

    // Verify client RPC payloads NEVER sent teacher_id
    const saveGradeCall = rpcSpy.mock.calls.find((c) => c[0] === 'save_teacher_student_grade');
    expect(saveGradeCall?.[1]).not.toHaveProperty('p_teacher_id');
    expect(saveGradeCall?.[1]).not.toHaveProperty('teacher_id');

    // Simulate page reload: unmount and re-mount App cleanly
    unmount();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId(`select-student-${STU_1}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`select-student-${STU_1}`));
    await waitFor(() => {
      expect(screen.getByText('Midterm Quiz 1')).toBeDefined();
      expect(screen.getByText('Prepared all homework cleanly')).toBeDefined();
    });
  });

  it('6. Disambiguates two identical student names by student_code and saves specifically for the chosen code', async () => {
    setupTeacherAuthSession('teacher-dup-names', 'Nour Teacher');

    const saveCalls: any[] = [];
    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, params?: any): any => {
      if (fnName === 'get_teacher_portal_context') {
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 'tch-dn-1', full_name: 'Nour Teacher', subject: 'Arabic' },
            groups: [{ id: GRP_1, name: 'Grade 8C', grade_level: 'Grade 8', student_count: 2 }],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_group_students') {
        return Promise.resolve({
          data: {
            group: { id: GRP_1, name: 'Grade 8C', grade_level: 'Grade 8' },
            students: [
              { id: STU_1, full_name: 'Mohamed Ali', student_code: 'ET-101', status: 'active', group_id: GRP_1 },
              { id: STU_2, full_name: 'Mohamed Ali', student_code: 'ET-102', status: 'active', group_id: GRP_1 },
            ],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_student_records') {
        return Promise.resolve({
          data: {
            student: { id: params.p_student_id, full_name: 'Mohamed Ali', student_code: 'ET-102', status: 'active', group_id: GRP_1 },
            grades: [],
            notes: [],
          },
          error: null,
        });
      }
      if (fnName === 'save_teacher_student_note') {
        saveCalls.push(params);
        return Promise.resolve({
          data: {
            note: {
              id: 'note-dn-1',
              student_id: params.p_student_id,
              teacher_id: 'tch-dn-1',
              author_name: 'Nour Teacher',
              feedback_text: params.p_feedback_text,
              is_parent_visible: params.p_is_parent_visible,
              note_date: getCairoDateString(),
              created_at: new Date().toISOString(),
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('ET-101')).toBeDefined();
      expect(screen.getByText('ET-102')).toBeDefined();
    });

    // Pick second Mohamed Ali specifically (ET-102)
    fireEvent.click(screen.getByTestId(`select-student-${STU_2}`));
    await waitFor(() => {
      expect(screen.getByTestId('selected-student-code').textContent).toBe('ET-102');
    });

    fireEvent.click(screen.getByRole('button', { name: /Add Note/i }));
    expect(screen.getByTestId('modal-student-context').textContent).toContain('Mohamed Ali');
    expect(screen.getByTestId('modal-student-context').textContent).toContain('ET-102');
    expect(screen.getByTestId('modal-student-context').textContent).toContain('Grade 8C');

    fireEvent.change(screen.getByLabelText(/Note Text/i), { target: { value: 'Note for ET-102 specifically' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Note/i }));

    await waitFor(() => {
      expect(saveCalls).toHaveLength(1);
    });
    expect(saveCalls[0].p_student_id).toBe(STU_2);
  });

  it('7. Blocks unknown status (never coerces to active), blocks saves during isRevalidating preserving draft, and prevents double-submit', async () => {
    expect(normalizeStudentStatus('weird_status')).toBe('unknown');
    expect(normalizeStudentStatus(null)).toBe('unknown');
    expect(normalizeStudentStatus('active')).toBe('active');

    let profileReads = 0;
    let resolveRefreshProfile: (val: any) => void;
    let resolveSaveGrade: (val: any) => void;

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: { user: { id: 'teacher-reval-c2', email: 't@edutrack.com' }, access_token: 'tok-1' } as any,
      },
      error: null,
    });

    vi.spyOn(supabase, 'from').mockImplementation((table: string): any => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_col: string, uid: string) => ({
              maybeSingle: () => {
                profileReads++;
                if (profileReads === 1) {
                  return Promise.resolve({
                    data: { id: uid, email: 't@edutrack.com', role: 'teacher', full_name: 'Teacher Guard' },
                    error: null,
                  });
                }
                return new Promise((resolve) => {
                  resolveRefreshProfile = resolve;
                });
              },
            }),
          }),
        };
      }
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    });

    const saveGradeSpy = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSaveGrade = resolve;
        })
    );

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, params?: any): any => {
      if (fnName === 'get_teacher_portal_context') {
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 'tch-g-1', full_name: 'Teacher Guard', subject: 'Science' },
            groups: [{ id: GRP_1, name: 'Grade 7A', grade_level: 'Grade 7', student_count: 2 }],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_group_students') {
        return Promise.resolve({
          data: {
            group: { id: GRP_1, name: 'Grade 7A', grade_level: 'Grade 7' },
            students: [
              { id: STU_1, full_name: 'Active Girl', student_code: 'ACT-1', status: 'active', group_id: GRP_1 },
              { id: STU_UNK, full_name: 'Weird Status Boy', student_code: 'UNK-1', status: 'archived_legacy', group_id: GRP_1 },
            ],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_student_records') {
        const isUnknown = params.p_student_id === STU_UNK;
        return Promise.resolve({
          data: {
            student: isUnknown
              ? { id: STU_UNK, full_name: 'Weird Status Boy', student_code: 'UNK-1', status: 'archived_legacy', group_id: GRP_1 }
              : { id: STU_1, full_name: 'Active Girl', student_code: 'ACT-1', status: 'active', group_id: GRP_1 },
            grades: [],
            notes: [],
          },
          error: null,
        });
      }
      if (fnName === 'save_teacher_student_grade') {
        return saveGradeSpy();
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId(`select-student-${STU_UNK}`)).toBeDefined();
    });

    // 1) Unknown status student is NOT coerced to active and cannot open write actions
    fireEvent.click(screen.getByTestId(`select-student-${STU_UNK}`));
    await waitFor(() => {
      expect(screen.getByTestId('selected-student-status').textContent).toBe('unknown');
      expect(screen.getByTestId('inactive-student-write-notice')).toBeDefined();
    });
    expect((screen.getByRole('button', { name: /Add Grade/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Add Note/i }) as HTMLButtonElement).disabled).toBe(true);

    // 2) Active student -> type grade draft -> trigger TOKEN_REFRESHED -> submit blocked & draft preserved
    fireEvent.click(screen.getByTestId(`select-student-${STU_1}`));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Add Grade/i }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Grade/i }));
    fireEvent.change(screen.getByLabelText(/Assessment Title/i), { target: { value: 'Quiz 4 Draft' } });
    fireEvent.change(screen.getByLabelText(/^Score$/i), { target: { value: '15' } });

    await act(async () => {
      authStateCallback?.('TOKEN_REFRESHED', {
        user: { id: 'teacher-reval-c2', email: 't@edutrack.com' },
        access_token: 'tok-2',
      });
    });

    const saveBtnDuringRefresh = screen.getByRole('button', { name: /Save Grade/i }) as HTMLButtonElement;
    expect(saveBtnDuringRefresh.disabled).toBe(true);
    fireEvent.submit(saveBtnDuringRefresh.closest('form')!);
    expect(saveGradeSpy).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Assessment Title/i) as HTMLInputElement).value).toBe('Quiz 4 Draft');

    await act(async () => {
      resolveRefreshProfile!({
        data: { id: 'teacher-reval-c2', email: 't@edutrack.com', role: 'teacher', full_name: 'Teacher Guard' },
        error: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('teacher-portal-revalidating-banner')).toBeNull();
    });
    expect(saveGradeSpy).not.toHaveBeenCalled();

    // 3) Double click / repeat submit fires ONLY ONE RPC
    const formEl = screen.getByRole('button', { name: /Save Grade/i }).closest('form')!;
    fireEvent.submit(formEl);
    fireEvent.submit(formEl);
    expect(saveGradeSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSaveGrade!({
        data: {
          grade: {
            id: 'grd-ok',
            student_id: STU_1,
            group_id: GRP_1,
            teacher_id: 'tch-g-1',
            author_name: 'Teacher Guard',
            assessment_title: 'Quiz 4 Draft',
            grade_type: 'exam',
            score: 15,
            max_score: 100,
            assessment_date: getCairoDateString(),
            remarks: '',
            created_at: new Date().toISOString(),
          },
        },
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('teacher-save-success-banner')).toBeDefined();
    });
  });

  it('8. Closes action and reloads groups on assignment revocation error, and keeps save confirmation with read-only Retry on refresh failure', async () => {
    setupTeacherAuthSession('teacher-post-err', 'Samy Teacher');

    let recordsFail = false;
    let contextCalls = 0;

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string, params?: any): any => {
      if (fnName === 'get_teacher_portal_context') {
        contextCalls++;
        return Promise.resolve({
          data: {
            linked: true,
            teacher: { id: 'tch-pe-1', full_name: 'Samy Teacher', subject: 'English' },
            groups: contextCalls === 1
              ? [{ id: GRP_1, name: 'English 10A', grade_level: 'Grade 10', student_count: 1 }]
              : [],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_group_students') {
        return Promise.resolve({
          data: {
            group: { id: GRP_1, name: 'English 10A', grade_level: 'Grade 10' },
            students: [{ id: STU_1, full_name: 'Rami Tarek', student_code: 'ENG-1', status: 'active', group_id: GRP_1 }],
          },
          error: null,
        });
      }
      if (fnName === 'get_teacher_student_records') {
        if (recordsFail) {
          return Promise.resolve({ data: null, error: { message: 'Temporary read timeout' } });
        }
        return Promise.resolve({
          data: {
            student: { id: STU_1, full_name: 'Rami Tarek', student_code: 'ENG-1', status: 'active', group_id: GRP_1 },
            grades: [],
            notes: [
              {
                id: 'note-persisted-1',
                student_id: STU_1,
                teacher_id: 'tch-pe-1',
                author_name: 'Samy Teacher',
                feedback_text: 'Saved despite refresh hiccup',
                is_parent_visible: false,
                note_date: getCairoDateString(),
                created_at: new Date().toISOString(),
              },
            ],
          },
          error: null,
        });
      }
      if (fnName === 'save_teacher_student_note') {
        return Promise.resolve({
          data: {
            note: {
              id: 'note-persisted-1',
              student_id: STU_1,
              teacher_id: 'tch-pe-1',
              author_name: 'Samy Teacher',
              feedback_text: params.p_feedback_text,
              is_parent_visible: params.p_is_parent_visible,
              note_date: getCairoDateString(),
              created_at: new Date().toISOString(),
            },
          },
          error: null,
        });
      }
      if (fnName === 'save_teacher_student_grade') {
        return Promise.resolve({
          data: null,
          error: { message: 'Access denied: Group is not currently assigned to the authenticated teacher.' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId(`select-student-${STU_1}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`select-student-${STU_1}`));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Note/i })).toBeDefined();
    });

    // Part A: Save succeeds, post-save record refresh fails -> Retry ONLY re-reads without re-saving
    recordsFail = true;
    fireEvent.click(screen.getByRole('button', { name: /Add Note/i }));
    fireEvent.change(screen.getByLabelText(/Note Text/i), { target: { value: 'Saved despite refresh hiccup' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Note/i }));

    await waitFor(() => {
      expect(screen.getByTestId('teacher-save-success-banner')).toBeDefined();
      expect(screen.getByTestId('teacher-records-error')).toBeDefined();
      expect(screen.getByText(/Your record was saved, but refreshing the records list failed/i)).toBeDefined();
    });

    const saveNoteCountBeforeRetry = rpcSpy.mock.calls.filter((c) => c[0] === 'save_teacher_student_note').length;
    expect(saveNoteCountBeforeRetry).toBe(1);

    recordsFail = false;
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));

    await waitFor(() => {
      expect(screen.getByText('Saved despite refresh hiccup')).toBeDefined();
    });
    expect(rpcSpy.mock.calls.filter((c) => c[0] === 'save_teacher_student_note').length).toBe(1);

    // Part B: Save rejected because group assignment was revoked -> closes modal & reloads groups (no groups left)
    fireEvent.click(screen.getByRole('button', { name: /Add Grade/i }));
    fireEvent.change(screen.getByLabelText(/Assessment Title/i), { target: { value: 'Revoked Quiz' } });
    fireEvent.change(screen.getByLabelText(/^Score$/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Grade/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByTestId('teacher-no-groups-state')).toBeDefined();
      expect(screen.getByTestId('teacher-action-revoked-banner')).toBeDefined();
    });
  });
});
