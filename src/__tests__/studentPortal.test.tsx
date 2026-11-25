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

type RpcReturn = ReturnType<typeof supabase.rpc>;
type RpcResolved = Awaited<RpcReturn>;
const rpcResolve = (data: unknown, error: { message: string } | null = null): RpcReturn =>
  Promise.resolve({ data, error }) as unknown as RpcReturn;

function setupStudentAuth(userId: string, fullName: string) {
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
              data: { id: uid, email: `${uid}@edutrack.com`, role: 'student', full_name: fullName },
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

describe('Student Portal Stage D (App Entry Point, Isolation & Error vs Empty States)', () => {
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

  it('1. Displays student card, attendance (newest first + missing-day note), and 18/20 grade across portal reopen without PII/QR or admin calls', async () => {
    setupStudentAuth('stu-acc-1', 'Mohamed Ali');

    const getOverviewSpy = vi.spyOn(adminService, 'getDashboardOverview');
    const getStudentsSpy = vi.spyOn(adminService, 'getStudents');
    const getProfilesSpy = vi.spyOn(accountLinkingService, 'getProfilesByRole');
    const getGradesSpy = vi.spyOn(teacherService, 'getGrades');

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string) => {
      if (fnName === 'get_student_portal_data') {
        return rpcResolve({
          linked: true,
          student: {
            id: 'stu-rec-1',
            full_name: 'Mohamed Ali',
            student_code: 'ET-D-101',
            grade_level: 'Grade 9',
            status: 'active',
            group: { id: 'grp-d-1', name: 'Group D-Alpha', grade_level: 'Grade 9' },
            // Extra fields in mock payload should still never leak in UI
            qr_code_hash: 'HIDDEN-QR-HASH',
            parent_phone: '+201009998811',
          },
          attendance: [
            { id: 'att-new', date: '2026-11-21', status: 'Present', check_in_time: '08:05' },
            { id: 'att-old', date: '2026-11-19', status: 'Absent', check_in_time: null },
          ],
          grades: [
            {
              id: 'grd-18',
              assessment_title: 'Algebra Midterm',
              grade_type: 'exam',
              score: 18,
              max_score: 20,
              assessment_date: '2026-11-21',
            },
          ],
        });
      }
      return rpcResolve(null);
    });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-card-code').textContent).toBe('ET-D-101');
    });

    expect(screen.getByTestId('student-card-name').textContent).toBe('Mohamed Ali');
    expect(screen.getByTestId('student-card-grade').textContent).toBe('Grade 9');
    expect(screen.getByTestId('student-card-group').textContent).toBe('Group D-Alpha');
    expect(screen.getAllByText('2026-11-21').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('08:05')).toBeDefined();
    expect(screen.getByText('Days without a record do not count as absent', { exact: false })).toBeDefined();
    expect(screen.getByText('Algebra Midterm')).toBeDefined();
    expect(screen.getByText('18 / 20')).toBeDefined();

    expect(screen.queryByText(/HIDDEN-QR-HASH/)).toBeNull();
    expect(screen.queryByText(/\+201009998811/)).toBeNull();
    expect(rpcSpy).toHaveBeenCalledWith('get_student_portal_data');
    expect(getOverviewSpy).not.toHaveBeenCalled();
    expect(getStudentsSpy).not.toHaveBeenCalled();
    expect(getProfilesSpy).not.toHaveBeenCalled();
    expect(getGradesSpy).not.toHaveBeenCalled();

    // Re-open portal cleanly -> records still displayed from backend RPC
    unmount();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('18 / 20')).toBeDefined();
      expect(screen.getByText('08:05')).toBeDefined();
    });
  });

  it('2. Distinguishes read error (+ Retry), unlinked state, unlinked-after-refresh, no-group state, and empty attendance/grades', async () => {
    setupStudentAuth('stu-acc-2', 'Sara Student');

    let phase: 'error' | 'empty_no_group' | 'unlinked' = 'error';

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string) => {
      if (fnName !== 'get_student_portal_data') return rpcResolve(null);
      if (phase === 'error') {
        return rpcResolve(null, { message: 'Database read timeout' });
      }
      if (phase === 'empty_no_group') {
        return rpcResolve({
          linked: true,
          student: {
            id: 'stu-rec-2',
            full_name: 'Sara Student',
            student_code: 'ET-D-202',
            grade_level: 'Grade 10',
            status: 'active',
            group: null,
          },
          attendance: [],
          grades: [],
        });
      }
      return rpcResolve({ linked: false, student: null, attendance: [], grades: [] });
    });

    render(<App />);

    // 1) Network/DB error must NOT look like empty data
    await waitFor(() => {
      expect(screen.getByTestId('student-portal-error')).toBeDefined();
      expect(screen.getByText(/Database read timeout/i)).toBeDefined();
    });
    expect(screen.queryByTestId('student-empty-attendance')).toBeNull();
    expect(screen.queryByTestId('student-unlinked-state')).toBeNull();

    // 2) Retry recovers to genuine linked student without group & empty attendance/grades
    phase = 'empty_no_group';
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('student-no-group-state')).toBeDefined();
      expect(screen.getByTestId('student-empty-attendance')).toBeDefined();
      expect(screen.getByTestId('student-empty-grades')).toBeDefined();
    });

    // 3) Admin unlinks account -> Refresh reflects unlinked state immediately
    phase = 'unlinked';
    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('student-unlinked-state')).toBeDefined();
    });
    expect(screen.queryByTestId('student-card')).toBeNull();
  });

  it('3. Wipes student data immediately on account switch/sign-out and ignores delayed RPC from previous student', async () => {
    let resolveSlowStudent1: (val: RpcResolved) => void;
    let rpcCallCount = 0;

    setupStudentAuth('stu-switch-1', 'Student One');

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string) => {
      if (fnName !== 'get_student_portal_data') return rpcResolve(null);
      rpcCallCount++;
      if (rpcCallCount === 1) {
        return new Promise<RpcResolved>((resolve) => {
          resolveSlowStudent1 = resolve;
        }) as unknown as RpcReturn;
      }
      return rpcResolve({
        linked: true,
        student: {
          id: 'stu-rec-s2',
          full_name: 'Student Two',
          student_code: 'ET-S2',
          grade_level: 'Grade 11',
          status: 'active',
          group: { id: 'g-2', name: 'Group S2', grade_level: 'Grade 11' },
        },
        attendance: [{ id: 'a-s2', date: '2026-11-21', status: 'Late', check_in_time: '08:25' }],
        grades: [],
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-portal-loading')).toBeDefined();
    });

    // Switch account to Student Two while Student One's RPC is still pending
    await act(async () => {
      authStateCallback?.('SIGNED_IN', {
        user: { id: 'stu-switch-2', email: 'stu-switch-2@edutrack.com' },
        access_token: 'tok-s2',
      } as unknown as Session);
    });

    await waitFor(() => {
      expect(screen.getByTestId('student-card-code').textContent).toBe('ET-S2');
      expect(screen.getByText('08:25')).toBeDefined();
    });

    // Late RPC response from Student One arrives now -> MUST BE IGNORED
    await act(async () => {
      resolveSlowStudent1!({
        data: {
          linked: true,
          student: {
            id: 'stu-rec-s1',
            full_name: 'Stale Student One',
            student_code: 'ET-STALE-S1',
            grade_level: 'Grade 8',
            status: 'active',
            group: null,
          },
          attendance: [],
          grades: [{ id: 'stale-g', assessment_title: 'Stale Score', grade_type: 'exam', score: 9, max_score: 10, assessment_date: '2026-11-20' }],
        },
        error: null,
      } as unknown as RpcResolved);
    });

    expect(screen.getByTestId('student-card-code').textContent).toBe('ET-S2');
    expect(screen.queryByText('ET-STALE-S1')).toBeNull();
    expect(screen.queryByText('Stale Score')).toBeNull();

    // Sign Out immediately clears student data and returns to AuthPage
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });
    expect(screen.queryByTestId('role-portal-student')).toBeNull();
  });

  it('4. Rejects missing lists, unknown statuses/grade types, or incomplete scores with Retry while keeping valid score=0, null check_in_time, and empty []', async () => {
    setupStudentAuth('stu-val-1', 'Validated Student');

    let attempt = 0;
    const payloads = [
      // Missing attendance list
      {
        linked: true,
        student: {
          id: 'stu-rec-val',
          full_name: 'Validated Student',
          student_code: 'ET-VAL',
          grade_level: 'Grade 10',
          status: 'active',
          group: null,
        },
        grades: [],
      },
      // Unknown attendance status
      {
        linked: true,
        student: {
          id: 'stu-rec-val',
          full_name: 'Validated Student',
          student_code: 'ET-VAL',
          grade_level: 'Grade 10',
          status: 'active',
          group: null,
        },
        attendance: [{ id: 'a-bad', date: '2026-11-22', status: 'MysteryStatus', check_in_time: null }],
        grades: [],
      },
      // Unknown grade type & missing score
      {
        linked: true,
        student: {
          id: 'stu-rec-val',
          full_name: 'Validated Student',
          student_code: 'ET-VAL',
          grade_level: 'Grade 10',
          status: 'active',
          group: null,
        },
        attendance: [],
        grades: [
          { id: 'g-bad', assessment_title: 'Quiz 1', grade_type: 'popquiz', score: null, max_score: 20, assessment_date: '2026-11-22' },
        ],
      },
      // Valid response: score=0 preserved, check_in_time=null preserved
      {
        linked: true,
        student: {
          id: 'stu-rec-val',
          full_name: 'Validated Student',
          student_code: 'ET-VAL',
          grade_level: 'Grade 10',
          status: 'active',
          group: null,
        },
        attendance: [{ id: 'a-null-time', date: '2026-11-22', status: 'Absent', check_in_time: null }],
        grades: [
          { id: 'g-zero', assessment_title: 'Zero Score Exam', grade_type: 'exam', score: 0, max_score: 20, assessment_date: '2026-11-22' },
        ],
      },
    ];

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string) => {
      if (fnName !== 'get_student_portal_data') return rpcResolve(null);
      const data = payloads[Math.min(attempt, payloads.length - 1)];
      attempt++;
      return rpcResolve(data);
    });

    render(<App />);

    // 1) Missing attendance list -> error + Retry
    await waitFor(() => {
      expect(screen.getByTestId('student-portal-error').textContent).toMatch(/Missing attendance list/i);
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    // 2) Unknown attendance status -> error + Retry
    await waitFor(() => {
      expect(screen.getByTestId('student-portal-error').textContent).toMatch(/Unknown attendance status/i);
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    // 3) Unknown grade type -> error + Retry
    await waitFor(() => {
      expect(screen.getByTestId('student-portal-error').textContent).toMatch(/Unknown grade type/i);
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    // 4) Valid payload with score = 0 and check_in_time = null renders cleanly
    await waitFor(() => {
      expect(screen.getByTestId('student-card')).toBeDefined();
      expect(screen.getByText('Zero Score Exam')).toBeDefined();
      expect(screen.getByText('0 / 20')).toBeDefined();
      expect(screen.getByText('Absent')).toBeDefined();
    });

    // 5) Genuine empty [] lists also render cleanly without errors
    payloads.push({
      linked: true,
      student: {
        id: 'stu-rec-val',
        full_name: 'Validated Student',
        student_code: 'ET-VAL',
        grade_level: 'Grade 10',
        status: 'active',
        group: null,
      },
      attendance: [],
      grades: [],
    });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('student-empty-attendance')).toBeDefined();
      expect(screen.getByTestId('student-empty-grades')).toBeDefined();
    });
  });

  it('5. Enforces DB score bounds (0 <= score <= max_score and 0 < max_score < 1000), rejecting 21/20 and max_score=1000 while rendering 0/20 and 18/20', async () => {
    const { validateGradesList } = await import('../services/portalPayloadValidation');

    const overMaxResult = validateGradesList([
      {
        id: 'g-over',
        assessment_title: 'Invalid Score',
        grade_type: 'quiz',
        score: 21,
        max_score: 20,
        assessment_date: '2026-11-22',
      },
    ]);
    expect(overMaxResult.data).toBeNull();
    expect(overMaxResult.error).toMatch(/0 <= score <= max_score/i);

    const thousandMaxResult = validateGradesList([
      {
        id: 'g-1000',
        assessment_title: 'Invalid Max',
        grade_type: 'exam',
        score: 900,
        max_score: 1000,
        assessment_date: '2026-11-22',
      },
    ]);
    expect(thousandMaxResult.data).toBeNull();
    expect(thousandMaxResult.error).toMatch(/0 < max_score < 1000/i);

    setupStudentAuth('stu-bounds-1', 'Bounds Student');
    let phase = 0;
    const responses = [
      {
        linked: true,
        student: {
          id: 'stu-rec-bounds',
          full_name: 'Bounds Student',
          student_code: 'ET-BND',
          grade_level: 'Grade 10',
          status: 'active',
          group: null,
        },
        attendance: [],
        grades: [
          { id: 'g-21', assessment_title: 'Bad 21/20', grade_type: 'quiz', score: 21, max_score: 20, assessment_date: '2026-11-22' },
        ],
      },
      {
        linked: true,
        student: {
          id: 'stu-rec-bounds',
          full_name: 'Bounds Student',
          student_code: 'ET-BND',
          grade_level: 'Grade 10',
          status: 'active',
          group: null,
        },
        attendance: [],
        grades: [
          { id: 'g-1000', assessment_title: 'Bad Max 1000', grade_type: 'exam', score: 10, max_score: 1000, assessment_date: '2026-11-22' },
        ],
      },
      {
        linked: true,
        student: {
          id: 'stu-rec-bounds',
          full_name: 'Bounds Student',
          student_code: 'ET-BND',
          grade_level: 'Grade 10',
          status: 'active',
          group: null,
        },
        attendance: [],
        grades: [
          { id: 'g-0', assessment_title: 'Boundary Zero', grade_type: 'quiz', score: 0, max_score: 20, assessment_date: '2026-11-22' },
          { id: 'g-18', assessment_title: 'Demo Eighteen', grade_type: 'exam', score: 18, max_score: 20, assessment_date: '2026-11-22' },
        ],
      },
    ];

    vi.spyOn(supabase, 'rpc').mockImplementation((fnName: string) => {
      if (fnName !== 'get_student_portal_data') return rpcResolve(null);
      const data = responses[Math.min(phase, responses.length - 1)];
      phase++;
      return rpcResolve(data);
    });

    render(<App />);

    // 21/20 rejected in UI -> Retry
    await waitFor(() => {
      expect(screen.getByTestId('student-portal-error').textContent).toMatch(/0 <= score <= max_score/i);
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    // max_score=1000 rejected in UI -> Retry
    await waitFor(() => {
      expect(screen.getByTestId('student-portal-error').textContent).toMatch(/0 < max_score < 1000/i);
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    // 0/20 and 18/20 render cleanly
    await waitFor(() => {
      expect(screen.getByText('Boundary Zero')).toBeDefined();
      expect(screen.getByText('0 / 20')).toBeDefined();
      expect(screen.getByText('Demo Eighteen')).toBeDefined();
      expect(screen.getByText('18 / 20')).toBeDefined();
    });
  });
});
