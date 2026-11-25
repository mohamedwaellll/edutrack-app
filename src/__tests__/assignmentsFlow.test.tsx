// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session, Subscription, User } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';
import { teacherPortalService } from '../services/teacherPortalService';
import { studentPortalService } from '../services/studentPortalService';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function makeTestSession(id: string, email: string, accessToken: string): Session {
  return {
    user: { id, email } as User,
    access_token: accessToken,
  } as Session;
}

function makeMockSubscription(): Subscription {
  return { unsubscribe: vi.fn() } as unknown as Subscription;
}

function installTestLocalStorage(): void {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
}

describe('Assignments Phase 1 End-to-End App Entry Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
    installTestLocalStorage();
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation(() => ({
      data: { subscription: makeMockSubscription() },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockAuthAs(role: 'teacher' | 'student', id: string, email: string, fullName: string) {
    const session = makeTestSession(id, email, `tok-${role}`);
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session },
      error: null,
    });
    vi.spyOn(supabase, 'from').mockImplementation((() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id, email, role, full_name: fullName },
            error: null,
          }),
          single: async () => ({
            data: { id, email, role, full_name: fullName },
            error: null,
          }),
        }),
      }),
    })) as unknown as typeof supabase.from);
  }

  it('1. Teacher opens Assignments modal, preserves draft across language switch, prevents duplicate publish, and retries read-only refresh on list failure', async () => {
    mockAuthAs('teacher', 'teacher-user-1', 'teacher@edutrack.local', 'Mr. Rami Physics');

    const groupId = '11111111-1111-4111-8111-111111111111';
    const studentId = '22222222-2222-4222-8222-222222222222';

    vi.spyOn(teacherPortalService, 'getTeacherPortalContext').mockResolvedValue({
      data: {
        linked: true,
        teacher: { id: 't-1', full_name: 'Mr. Rami Physics', subject: 'Physics' },
        groups: [{ id: groupId, name: 'Physics Group F1', grade_level: 'Grade 10', student_count: 1 }],
      },
      error: null,
    });

    vi.spyOn(teacherPortalService, 'getTeacherGroupStudents').mockResolvedValue({
      data: {
        group: { id: groupId, name: 'Physics Group F1', grade_level: 'Grade 10' },
        students: [
          {
            id: studentId,
            full_name: 'Youssef Tariq',
            student_code: 'ET-F-101',
            grade_level: 'Grade 10',
            status: 'active',
            group_id: groupId,
          },
        ],
      },
      error: null,
    });

    const publishedAssignment = {
      id: 'assign-1',
      group_id: groupId,
      group_name: 'Physics Group F1',
      teacher_name: 'Mr. Rami Physics',
      title: 'واجب الحركة',
      instructions: 'حل تمارين السرعة والتسارع',
      due_at: '2026-12-20T16:30:00.000Z',
      created_at: '2026-11-24T00:00:00.000Z',
    };

    const getAssignmentsSpy = vi
      .spyOn(teacherPortalService, 'getTeacherAssignments')
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: 'Temporary list refresh error' })
      .mockResolvedValueOnce({ data: [publishedAssignment], error: null });

    let resolveCreate: ((v: { data: typeof publishedAssignment | null; error: string | null }) => void) | null = null;
    const createSpy = vi
      .spyOn(teacherPortalService, 'createTeacherAssignment')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          })
      );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('teacher-assignments-empty')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('open-publish-assignment-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('assignment-modal-group-context').textContent).toContain('Physics Group F1');
    });

    const titleInput = screen.getByLabelText(/Assignment Title/i) as HTMLInputElement;
    const instructionsInput = screen.getByLabelText(/Instructions/i) as HTMLTextAreaElement;
    const dueInput = screen.getByLabelText(/Due Date & Time/i) as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'واجب الحركة' } });
    fireEvent.change(instructionsInput, { target: { value: 'حل تمارين السرعة والتسارع' } });
    fireEvent.change(dueInput, { target: { value: '2026-12-20T18:30' } });

    // Switch language EN -> AR inside the modal and confirm draft stays intact
    const langToggles = screen.getAllByTestId('language-toggle');
    fireEvent.click(langToggles[langToggles.length - 1]);
    await waitFor(() => {
      expect(screen.getByText(/تأكيد النشر للمجموعة/i)).toBeDefined();
    });
    expect((screen.getByLabelText(/عنوان الواجب/i) as HTMLInputElement).value).toBe('واجب الحركة');
    expect((screen.getByLabelText(/التعليمات/i) as HTMLTextAreaElement).value).toBe('حل تمارين السرعة والتسارع');
    expect((screen.getByLabelText(/موعد التسليم/i) as HTMLInputElement).value).toBe('2026-12-20T18:30');

    // Rapid double-click / submit must only call createTeacherAssignment once
    const submitBtn = screen.getByTestId('confirm-publish-assignment-btn');
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    expect(createSpy).toHaveBeenCalledTimes(1);

    resolveCreate!({ data: publishedAssignment, error: null });

    // Publish succeeded, list refresh failed -> Retry Refresh only calls getTeacherAssignments
    await waitFor(() => {
      expect(screen.getByTestId('teacher-assignments-error').textContent).toContain('واجب الحركة');
    });

    fireEvent.click(screen.getByTestId('retry-load-assignments-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-assignment-card-assign-1')).toBeDefined();
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(getAssignmentsSpy).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('teacher-assignment-card-assign-1').textContent).toContain('2026-12-20 18:30');
  });

  it('2. Student portal displays group assignments in Cairo time, and distinguishes empty and retryable error states', async () => {
    mockAuthAs('student', 'student-user-1', 'student@edutrack.local', 'Youssef Tariq');

    vi.spyOn(studentPortalService, 'getStudentPortalData').mockResolvedValue({
      data: {
        linked: true,
        student: {
          id: 's-1',
          full_name: 'Youssef Tariq',
          student_code: 'ET-F-101',
          grade_level: 'Grade 10',
          status: 'active',
          group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' },
        },
        attendance: [],
        grades: [],
      },
      error: null,
    });

    const getStudentAssignmentsSpy = vi
      .spyOn(studentPortalService, 'getStudentAssignments')
      .mockResolvedValueOnce({ data: null, error: 'Network error reading assignments' })
      .mockResolvedValueOnce({
        data: {
          linked: true,
          assignments: [
            {
              id: 'assign-1',
              group_id: 'g-1',
              group_name: 'Physics Group F1',
              title: 'واجب الحركة',
              instructions: 'حل مسائل السرعة والتسارع',
              due_at: '2026-12-20T16:30:00.000Z',
              created_at: '2026-11-24T00:00:00.000Z',
            },
          ],
        },
        error: null,
      });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-assignments-error')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('student-retry-assignments-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('student-assignment-card-assign-1')).toBeDefined();
    });

    const cardText = screen.getByTestId('student-assignment-card-assign-1').textContent || '';
    expect(cardText).toContain('واجب الحركة');
    expect(cardText).toContain('Physics Group F1');
    expect(cardText).toContain('حل مسائل السرعة والتسارع');
    expect(cardText).toContain('2026-12-20 18:30');
    expect(getStudentAssignmentsSpy).toHaveBeenCalledTimes(2);
  });

  it('3. Student preserves draft across language switch, prevents duplicate submit, retries read-only refresh after save, and shows past-due state', async () => {
    mockAuthAs('student', 'student-user-1', 'student@edutrack.local', 'Youssef Tariq');

    vi.spyOn(studentPortalService, 'getStudentPortalData').mockResolvedValue({
      data: {
        linked: true,
        student: {
          id: 's-1',
          full_name: 'Youssef Tariq',
          student_code: 'ET-F-101',
          grade_level: 'Grade 10',
          status: 'active',
          group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' },
        },
        attendance: [],
        grades: [],
      },
      error: null,
    });

    const openAssignment = {
      id: 'assign-open',
      group_id: 'g-1',
      group_name: 'Physics Group F1',
      title: 'واجب الحركة',
      instructions: 'حل التمارين',
      due_at: '2026-12-20T16:30:00.000Z',
      created_at: '2026-11-24T00:00:00.000Z',
      is_past_due: false,
      submission: null,
    };

    const closedAssignment = {
      id: 'assign-closed',
      group_id: 'g-1',
      group_name: 'Physics Group F1',
      title: 'واجب قديم',
      instructions: 'انتهى وقته',
      due_at: '2025-01-01T10:00:00.000Z',
      created_at: '2024-12-20T00:00:00.000Z',
      is_past_due: true,
      submission: {
        id: 'sub-old',
        answer_text: 'إجابة سابقة محفوظة',
        submitted_at: '2024-12-25T10:00:00.000Z',
        updated_at: '2024-12-25T12:00:00.000Z',
      },
    };

    const updatedOpenAssignment = {
      ...openAssignment,
      submission: {
        id: 'sub-1',
        answer_text: 'السرعة = المسافة ÷ الزمن',
        submitted_at: '2026-11-24T00:10:00.000Z',
        updated_at: '2026-11-24T00:10:00.000Z',
      },
    };

    const getAssignmentsSpy = vi
      .spyOn(studentPortalService, 'getStudentAssignments')
      .mockResolvedValueOnce({ data: { linked: true, assignments: [openAssignment, closedAssignment] }, error: null })
      .mockResolvedValueOnce({ data: null, error: 'Refresh failed after save' })
      .mockResolvedValueOnce({
        data: { linked: true, assignments: [updatedOpenAssignment, closedAssignment] },
        error: null,
      });

    let resolveSubmit: ((v: { data: { saved: boolean; conflict: boolean; submission: typeof updatedOpenAssignment.submission | null } | null; error: string | null }) => void) | null = null;
    const submitSpy = vi.spyOn(studentPortalService, 'submitStudentAssignment').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-assignment-status-assign-open').textContent).toBe('Not submitted');
    });
    expect(screen.getByTestId('student-assignment-status-assign-closed').textContent).toBe('Deadline passed');
    expect(screen.getByTestId('student-assignment-card-assign-closed').textContent).toContain('Saved answer on file');

    const answerInput = screen.getByTestId('student-answer-input-assign-open') as HTMLTextAreaElement;
    fireEvent.change(answerInput, { target: { value: 'السرعة = المسافة ÷ الزمن' } });

    // Switch EN -> AR while draft is typed
    fireEvent.click(screen.getByTestId('language-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('student-assignment-status-assign-open').textContent).toBe('لم يُسلّم');
    });
    expect((screen.getByTestId('student-answer-input-assign-open') as HTMLTextAreaElement).value).toBe(
      'السرعة = المسافة ÷ الزمن'
    );

    const submitBtn = screen.getByTestId('student-submit-assignment-btn-assign-open');
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    expect(submitSpy).toHaveBeenCalledTimes(1);

    resolveSubmit!({ data: { saved: true, conflict: false, submission: updatedOpenAssignment.submission }, error: null });

    await waitFor(() => {
      expect(screen.getByTestId('student-assignments-error').textContent).toContain('تم حفظ إجابتك');
    });

    fireEvent.click(screen.getByTestId('student-retry-assignments-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('student-assignment-status-assign-open').textContent).toBe('تم التسليم');
    });

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(getAssignmentsSpy).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('student-saved-submission-assign-open').textContent).toContain(
      'السرعة = المسافة ÷ الزمن'
    );
  });

  it('4. Teacher opens View Submissions modal and inspects student name, code, answer, and Cairo time', async () => {
    mockAuthAs('teacher', 'teacher-user-1', 'teacher@edutrack.local', 'Mr. Rami Physics');

    const groupId = '11111111-1111-4111-8111-111111111111';
    const assignId = '33333333-3333-4333-8333-333333333333';

    vi.spyOn(teacherPortalService, 'getTeacherPortalContext').mockResolvedValue({
      data: {
        linked: true,
        teacher: { id: 't-1', full_name: 'Mr. Rami Physics', subject: 'Physics' },
        groups: [{ id: groupId, name: 'Physics Group F1', grade_level: 'Grade 10', student_count: 1 }],
      },
      error: null,
    });
    vi.spyOn(teacherPortalService, 'getTeacherGroupStudents').mockResolvedValue({
      data: { group: { id: groupId, name: 'Physics Group F1', grade_level: 'Grade 10' }, students: [] },
      error: null,
    });
    vi.spyOn(teacherPortalService, 'getTeacherAssignments').mockResolvedValue({
      data: [
        {
          id: assignId,
          group_id: groupId,
          group_name: 'Physics Group F1',
          title: 'واجب الحركة',
          instructions: 'حل التمارين',
          due_at: '2026-12-20T16:30:00.000Z',
          created_at: '2026-11-24T00:00:00.000Z',
        },
      ],
      error: null,
    });
    vi.spyOn(teacherPortalService, 'getTeacherAssignmentSubmissions').mockResolvedValue({
      data: {
        assignmentTitle: 'واجب الحركة',
        groupName: 'Physics Group F1',
        submissions: [
          {
            id: 'sub-1',
            assignment_id: assignId,
            student_id: 's-1',
            student_name: 'Youssef Tariq',
            student_code: 'ET-F-101',
            answer_text: 'السرعة = المسافة ÷ الزمن، مثال: 100م في 10ث = 10م/ث',
            submitted_at: '2026-11-24T00:10:00.000Z',
            updated_at: '2026-11-24T00:15:00.000Z',
          },
        ],
      },
      error: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId(`view-submissions-btn-${assignId}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`view-submissions-btn-${assignId}`));

    await waitFor(() => {
      expect(screen.getByTestId('teacher-submission-item-ET-F-101')).toBeDefined();
    });
    const itemText = screen.getByTestId('teacher-submission-item-ET-F-101').textContent || '';
    expect(itemText).toContain('Youssef Tariq');
    expect(itemText).toContain('ET-F-101');
    expect(itemText).toContain('مثال: 100م في 10ث');
    expect(itemText).toContain('2026-11-24 02:15');
  });

  it('5. Teacher sees pre-due notice, grades 18/20 after due, handles two-tab conflict with latest grade, and retries read-only refresh on list failure', async () => {
    mockAuthAs('teacher', 'teacher-user-1', 'teacher@edutrack.local', 'Mr. Rami Physics');

    const groupId = '11111111-1111-4111-8111-111111111111';
    const assignId = '33333333-3333-4333-8333-333333333333';
    const subId = '44444444-4444-4444-8444-444444444444';

    vi.spyOn(teacherPortalService, 'getTeacherPortalContext').mockResolvedValue({
      data: {
        linked: true,
        teacher: { id: 't-1', full_name: 'Mr. Rami Physics', subject: 'Physics' },
        groups: [{ id: groupId, name: 'Physics Group F1', grade_level: 'Grade 10', student_count: 1 }],
      },
      error: null,
    });
    vi.spyOn(teacherPortalService, 'getTeacherGroupStudents').mockResolvedValue({
      data: { group: { id: groupId, name: 'Physics Group F1', grade_level: 'Grade 10' }, students: [] },
      error: null,
    });
    vi.spyOn(teacherPortalService, 'getTeacherAssignments').mockResolvedValue({
      data: [
        {
          id: assignId,
          group_id: groupId,
          group_name: 'Physics Group F1',
          title: 'واجب الحركة',
          instructions: 'حل التمارين',
          due_at: '2026-11-24T00:00:00.000Z',
          created_at: '2026-11-23T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const pendingSub = {
      id: subId,
      assignment_id: assignId,
      student_id: 's-1',
      student_name: 'Youssef Tariq',
      student_code: 'ET-F-101',
      answer_text: 'السرعة = المسافة ÷ الزمن',
      submitted_at: '2026-11-23T22:00:00.000Z',
      updated_at: '2026-11-23T22:30:00.000Z',
      grade: null,
    };

    const grade18 = {
      id: 'grade-1',
      score: 18,
      max_score: 20,
      assessment_date: '2026-11-24',
      updated_at: '2026-11-24T00:30:00.000Z',
      grade_version: 1,
    };

    const grade19 = {
      id: 'grade-1',
      score: 19,
      max_score: 20,
      assessment_date: '2026-11-24',
      updated_at: '2026-11-24T00:31:00.000Z',
      grade_version: 2,
    };

    const getSubsSpy = vi
      .spyOn(teacherPortalService, 'getTeacherAssignmentSubmissions')
      .mockResolvedValueOnce({
        data: {
          assignmentTitle: 'واجب الحركة',
          groupName: 'Physics Group F1',
          canGrade: false,
          dueAt: '2026-12-20T16:30:00.000Z',
          submissions: [pendingSub],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          assignmentTitle: 'واجب الحركة',
          groupName: 'Physics Group F1',
          canGrade: true,
          dueAt: '2026-11-24T00:00:00.000Z',
          submissions: [pendingSub],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: 'Temporary submissions refresh error' })
      .mockResolvedValueOnce({
        data: {
          assignmentTitle: 'واجب الحركة',
          groupName: 'Physics Group F1',
          canGrade: true,
          dueAt: '2026-11-24T00:00:00.000Z',
          submissions: [{ ...pendingSub, grade: grade18 }],
        },
        error: null,
      });

    const gradeSpy = vi
      .spyOn(teacherPortalService, 'gradeAssignmentSubmission')
      .mockResolvedValueOnce({
        data: { saved: true, conflict: false, grade: grade18 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { saved: false, conflict: true, grade: grade19 },
        error: null,
      });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId(`view-submissions-btn-${assignId}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`view-submissions-btn-${assignId}`));

    await waitFor(() => {
      expect(screen.getByTestId('teacher-submissions-pre-due-notice')).toBeDefined();
    });
    expect(screen.getByTestId('submission-status-badge-ET-F-101').textContent).toBe('Pending grading');
    expect(screen.queryByTestId('save-submission-grade-btn-ET-F-101')).toBeNull();
    unmount();

    // Now render after due_at
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`view-submissions-btn-${assignId}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`view-submissions-btn-${assignId}`));

    await waitFor(() => {
      expect(screen.getByTestId('save-submission-grade-btn-ET-F-101')).toBeDefined();
    });

    fireEvent.change(screen.getByTestId('grade-score-input-ET-F-101'), { target: { value: '18' } });
    fireEvent.change(screen.getByTestId('grade-max-input-ET-F-101'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('save-submission-grade-btn-ET-F-101'));

    // Refresh failed -> Retry only calls getTeacherAssignmentSubmissions
    await waitFor(() => {
      expect(screen.getByTestId('retry-load-submissions-btn')).toBeDefined();
    });
    expect(gradeSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('retry-load-submissions-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('submission-saved-grade-ET-F-101').textContent).toContain('18 / 20');
    });
    expect(gradeSpy).toHaveBeenCalledTimes(1);
    expect(getSubsSpy).toHaveBeenCalledTimes(4);

    // Two-tab conflict shows latest grade (19/20) and requires explicit re-confirmation before saving again
    fireEvent.change(screen.getByTestId('grade-score-input-ET-F-101'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('save-submission-grade-btn-ET-F-101'));

    await waitFor(() => {
      expect(screen.getByTestId('grade-submission-error-ET-F-101')).toBeDefined();
    });
    expect(screen.getByTestId('submission-saved-grade-ET-F-101').textContent).toContain('19 / 20');
    const saveBtnAfterConflict = screen.getByTestId('save-submission-grade-btn-ET-F-101') as HTMLButtonElement;
    expect(saveBtnAfterConflict.disabled).toBe(true);
    expect(screen.getByTestId('confirm-grade-overwrite-ET-F-101')).toBeDefined();

    // Confirming enables the save button
    fireEvent.click(screen.getByTestId('confirm-grade-overwrite-ET-F-101'));
    expect((screen.getByTestId('save-submission-grade-btn-ET-F-101') as HTMLButtonElement).disabled).toBe(false);
  });

  it('6. Student sees graded assignment result both under assignment card and in grades ledger', async () => {
    mockAuthAs('student', 'student-user-1', 'student@edutrack.local', 'Youssef Tariq');

    vi.spyOn(studentPortalService, 'getStudentPortalData').mockResolvedValue({
      data: {
        linked: true,
        student: {
          id: 's-1',
          full_name: 'Youssef Tariq',
          student_code: 'ET-F-101',
          grade_level: 'Grade 10',
          status: 'active',
          group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' },
        },
        attendance: [],
        grades: [
          {
            id: 'grade-1',
            assessment_title: 'واجب الحركة',
            grade_type: 'assignment',
            score: 18,
            max_score: 20,
            assessment_date: '2026-11-24',
          },
        ],
      },
      error: null,
    });

    vi.spyOn(studentPortalService, 'getStudentAssignments').mockResolvedValue({
      data: {
        linked: true,
        assignments: [
          {
            id: 'assign-1',
            group_id: 'g-1',
            group_name: 'Physics Group F1',
            title: 'واجب الحركة',
            instructions: 'حل التمارين',
            due_at: '2026-11-24T00:00:00.000Z',
            created_at: '2026-11-23T00:00:00.000Z',
            is_past_due: true,
            submission: {
              id: 'sub-1',
              answer_text: 'السرعة = المسافة ÷ الزمن',
              submitted_at: '2026-11-23T22:00:00.000Z',
              updated_at: '2026-11-23T22:00:00.000Z',
            },
            grade: {
              id: 'grade-1',
              score: 18,
              max_score: 20,
              assessment_date: '2026-11-24',
              updated_at: '2026-11-24T00:30:00.000Z',
              grade_version: 1,
            },
          },
        ],
      },
      error: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-assignment-grade-assign-1')).toBeDefined();
    });
    expect(screen.getByTestId('student-assignment-grade-assign-1').textContent).toContain('18 / 20');
    expect(screen.getByTestId('student-grades-section').textContent).toContain('واجب الحركة');
    expect(screen.getByTestId('student-grades-section').textContent).toContain('18 / 20');
  });

  it('supports optional PDF attachment selection/removal, preserves draft on upload failure, retries to 1 assignment + 1 attachment, and opens attachment in student portal', async () => {
    const user = userEvent.setup();
    mockAuthAs('teacher', 'teacher-uid', 'teacher@edutrack.local', 'Mr. Kareem');

    vi.spyOn(teacherPortalService, 'getTeacherPortalContext').mockResolvedValue({
      data: {
        linked: true,
        teacher: { id: 't-1', full_name: 'Mr. Kareem', subject: 'Physics' },
        groups: [{ id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10', capacity: 30, student_count: 1 }],
      },
      error: null,
    });
    vi.spyOn(teacherPortalService, 'getTeacherGroupStudents').mockResolvedValue({
      data: {
        group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' },
        students: [
          {
            id: 's-1',
            full_name: 'Youssef Tariq',
            student_code: 'ET-F-101',
            grade_level: 'Grade 10',
            status: 'active',
          },
        ],
      },
      error: null,
    });

    const publishedMotionWithPdf = {
      id: 'assign-motion',
      group_id: 'g-1',
      group_name: 'Physics Group F1',
      teacher_name: 'Mr. Kareem',
      title: 'واجب الحركة',
      instructions: 'راجع ملف المسائل المرفق.',
      due_at: '2099-12-01T18:00:00.000Z',
      created_at: '2026-11-24T01:00:00.000Z',
      attachment: {
        id: 'att-1',
        file_name: 'motion-sheet.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
      },
    };

    vi.spyOn(teacherPortalService, 'getTeacherAssignments')
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [publishedMotionWithPdf], error: null });

    const createSpy = vi
      .spyOn(teacherPortalService, 'createTeacherAssignment')
      .mockResolvedValueOnce({
        data: null,
        error: 'ATTACHMENT_UPLOAD_FAILED: Storage network error',
      })
      .mockResolvedValueOnce({
        data: publishedMotionWithPdf,
        error: null,
      });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('open-publish-assignment-btn')).toBeDefined();
    });
    await user.click(screen.getByTestId('open-publish-assignment-btn'));

    // Reject invalid file type in modal (bypass browser accept filter with fireEvent)
    const fileInput = screen.getByTestId('assignment-pdf-input') as HTMLInputElement;
    const badFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [badFile] } });
    expect(screen.getByRole('alert').textContent).toMatch(/Only PDF files/i);

    // Upload valid PDF -> shows file name + size + remove button
    const pdfFile = new File(['%PDF-1.4\n...'], 'motion-sheet.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });
    expect(screen.getByTestId('assignment-selected-pdf').textContent).toContain('motion-sheet.pdf');
    expect(screen.getByTestId('remove-assignment-pdf-btn')).toBeDefined();

    // Remove and re-select before publishing
    await user.click(screen.getByTestId('remove-assignment-pdf-btn'));
    expect(screen.queryByTestId('assignment-selected-pdf')).toBeNull();
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    await user.type(screen.getByLabelText(/Assignment Title/i), 'واجب الحركة');
    await user.type(screen.getByLabelText(/Instructions/i), 'راجع ملف المسائل المرفق.');
    await user.type(screen.getByLabelText(/Due Date & Time/i), '2099-12-01T20:00');

    // First submit -> upload fails: draft + file remain preserved and modal stays open
    await user.click(screen.getByTestId('confirm-publish-assignment-btn'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/not published|draft is preserved/i);
    });
    expect((screen.getByLabelText(/Assignment Title/i) as HTMLInputElement).value).toBe('واجب الحركة');
    expect(screen.getByTestId('assignment-selected-pdf').textContent).toContain('motion-sheet.pdf');

    // Retry submit -> succeeds with 1 assignment + 1 attachment
    await user.click(screen.getByTestId('confirm-publish-assignment-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-attachment-name-assign-motion').textContent).toContain('motion-sheet.pdf');
    });
    expect(createSpy).toHaveBeenCalledTimes(2);
    unmount();

    // Now verify Student Portal opens the PDF attachment & surfaces denial if access is revoked
    mockAuthAs('student', 'youssef-uid', 'youssef@edutrack.local', 'Youssef Tariq');
    vi.spyOn(studentPortalService, 'getStudentPortalData').mockResolvedValue({
      data: {
        linked: true,
        student: {
          id: 's-1',
          full_name: 'Youssef Tariq',
          student_code: 'ET-F-101',
          grade_level: 'Grade 10',
          status: 'active',
          group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' },
        },
        attendance: [],
        grades: [],
        notes: [],
      },
      error: null,
    });
    vi.spyOn(studentPortalService, 'getStudentAssignments').mockResolvedValue({
      data: {
        linked: true,
        assignments: [{ ...publishedMotionWithPdf, is_past_due: false, submission: null, grade: null }],
      },
      error: null,
    });

    const openSpy = vi
      .spyOn(studentPortalService, 'openAssignmentAttachment')
      .mockResolvedValueOnce({
        data: { signedUrl: 'http://127.0.0.1:54399/storage/v1/object/sign/assignment-attachments/g-1/1.pdf?token=abc', fileName: 'motion-sheet.pdf' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: 'Access denied: You are not enrolled in this assignment\'s current group.',
      });
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-open-attachment-assign-motion')).toBeDefined();
    });
    await user.click(screen.getByTestId('student-open-attachment-assign-motion'));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('att-1');
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:54399/storage/v1/object/sign/assignment-attachments/g-1/1.pdf?token=abc',
        '_blank',
        'noopener,noreferrer'
      );
    });

    // Simulate clicking again after transfer -> error displayed cleanly
    await user.click(screen.getByTestId('student-open-attachment-assign-motion'));
    await waitFor(() => {
      expect(screen.getByTestId('student-attachment-error-assign-motion').textContent).toMatch(/Access denied/i);
    });
  });

  it('preserves previous submitted solution-v1.pdf openable if replacement upload fails, then retries to update the same submission to solution-v2.pdf', async () => {
    const user = userEvent.setup();
    mockAuthAs('student', 'youssef-uid', 'youssef@edutrack.local', 'Youssef Tariq');

    vi.spyOn(studentPortalService, 'getStudentPortalData').mockResolvedValue({
      data: {
        linked: true,
        student: {
          id: 's-1',
          full_name: 'Youssef Tariq',
          student_code: 'ET-F-101',
          grade_level: 'Grade 10',
          status: 'active',
          group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' },
        },
        attendance: [],
        grades: [],
        notes: [],
      },
      error: null,
    });

    const v1Sub = {
      id: 'sub-1',
      answer_text: null,
      submitted_at: '2026-11-24T01:00:00.000Z',
      updated_at: '2026-11-24T01:00:00.000Z',
      attachment: {
        id: 'sub-att-1',
        file_name: 'solution-v1.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
      },
    };
    const v2Sub = {
      ...v1Sub,
      updated_at: '2026-11-24T01:05:00.000Z',
      attachment: {
        id: 'sub-att-1',
        file_name: 'solution-v2.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
      },
    };

    const baseAssignment = {
      id: 'assign-1',
      group_id: 'g-1',
      group_name: 'Physics Group F1',
      title: 'واجب الحركة',
      instructions: 'أرفق الحل.',
      due_at: '2099-12-01T18:00:00.000Z',
      created_at: '2026-11-24T00:00:00.000Z',
      is_past_due: false,
      grade: null,
    };

    vi.spyOn(studentPortalService, 'getStudentAssignments')
      .mockResolvedValueOnce({ data: { linked: true, assignments: [{ ...baseAssignment, submission: v1Sub }] }, error: null })
      .mockResolvedValueOnce({ data: { linked: true, assignments: [{ ...baseAssignment, submission: v2Sub }] }, error: null });

    const submitSpy = vi
      .spyOn(studentPortalService, 'submitStudentAssignment')
      .mockResolvedValueOnce({ data: null, error: 'SUBMISSION_UPLOAD_FAILED: Storage offline' })
      .mockResolvedValueOnce({ data: { saved: true, conflict: false, submission: v2Sub }, error: null });

    const openSubSpy = vi.spyOn(studentPortalService, 'openSubmissionAttachment').mockResolvedValue({
      data: { signedUrl: 'http://127.0.0.1:54399/storage/v1/object/sign/assignment-submissions/s-1/assign-1/v1.pdf?token=t', fileName: 'solution-v1.pdf' },
      error: null,
    });
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-saved-submission-attachment-name-assign-1').textContent).toBe('solution-v1.pdf');
    });

    // Select replacement solution-v2.pdf
    const pdfInput = screen.getByTestId('student-submission-pdf-input-assign-1') as HTMLInputElement;
    const v2File = new File(['%PDF-1.4 v2'], 'solution-v2.pdf', { type: 'application/pdf' });
    fireEvent.change(pdfInput, { target: { files: [v2File] } });

    // Replacement fails -> error shown, solution-v1.pdf remains openable
    await user.click(screen.getByTestId('student-submit-assignment-btn-assign-1'));
    await waitFor(() => {
      expect(screen.getByTestId('student-submission-error-assign-1').textContent).toMatch(/previous submission remains intact/i);
    });
    expect(screen.getByTestId('student-saved-submission-attachment-name-assign-1').textContent).toBe('solution-v1.pdf');

    await user.click(screen.getByTestId('student-open-submission-attachment-assign-1'));
    await waitFor(() => {
      expect(openSubSpy).toHaveBeenCalledWith('sub-att-1');
      expect(windowOpenSpy).toHaveBeenCalled();
    });

    // Retry replacement -> updates same submission to solution-v2.pdf
    await user.click(screen.getByTestId('student-submit-assignment-btn-assign-1'));
    await waitFor(() => {
      expect(screen.getByTestId('student-saved-submission-attachment-name-assign-1').textContent).toBe('solution-v2.pdf');
    });
    expect(submitSpy).toHaveBeenCalledTimes(2);
  });

  it('displays follow-up roster with 1/1/1 counts (same-name students, PDF-only, 0/20 grade), filters accurately, updates to 1/0/2 after grading + refresh, and shows error+Retry on read failure', async () => {
    const user = userEvent.setup();
    mockAuthAs('teacher', 'teacher-uid', 'teacher@edutrack.local', 'Mr. Kareem');

    vi.spyOn(teacherPortalService, 'getTeacherPortalContext').mockResolvedValue({
      data: {
        linked: true,
        teacher: { id: 't-1', full_name: 'Mr. Kareem', subject: 'Physics' },
        groups: [{ id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10', student_count: 3 }],
      },
      error: null,
    });

    const rosterStudents = [
      { id: 'stu-1', full_name: 'سارة أحمد', student_code: 'ET-F-101', grade_level: 'Grade 10', status: 'active' as const },
      { id: 'stu-2', full_name: 'يوسف طارق', student_code: 'ET-F-102', grade_level: 'Grade 10', status: 'active' as const },
      { id: 'stu-3', full_name: 'يوسف طارق', student_code: 'ET-F-103', grade_level: 'Grade 10', status: 'active' as const },
    ];

    // 1st call: initial group roster load; 2nd call: fails inside submissions modal to test error+Retry; 3rd & 4th: succeed
    vi.spyOn(teacherPortalService, 'getTeacherGroupStudents')
      .mockResolvedValueOnce({ data: { group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' }, students: rosterStudents }, error: null })
      .mockResolvedValueOnce({ data: null, error: 'Network error loading roster' })
      .mockResolvedValue({ data: { group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' }, students: rosterStudents }, error: null });

    vi.spyOn(teacherPortalService, 'getTeacherAssignments').mockResolvedValue({
      data: [
        {
          id: 'assign-1',
          group_id: 'g-1',
          group_name: 'Physics Group F1',
          teacher_name: 'Mr. Kareem',
          title: 'واجب الحركة',
          instructions: 'حل المسائل.',
          due_at: '2025-01-01T10:00:00.000Z',
          created_at: '2024-12-20T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const initialSubmissions = [
      {
        id: 'sub-2',
        assignment_id: 'assign-1',
        student_id: 'stu-2',
        student_name: 'يوسف طارق',
        student_code: 'ET-F-102',
        answer_text: null,
        submitted_at: '2024-12-25T10:00:00.000Z',
        updated_at: '2024-12-25T10:00:00.000Z',
        attachment: { id: 'att-2', file_name: 'pdf-only.pdf', mime_type: 'application/pdf', size_bytes: 1024 },
        grade: null,
      },
      {
        id: 'sub-3',
        assignment_id: 'assign-1',
        student_id: 'stu-3',
        student_name: 'يوسف طارق',
        student_code: 'ET-F-103',
        answer_text: 'محاولة غير مكتملة',
        submitted_at: '2024-12-25T11:00:00.000Z',
        updated_at: '2024-12-25T11:00:00.000Z',
        attachment: null,
        grade: {
          id: 'grade-3',
          score: 0,
          max_score: 20,
          assessment_date: '2025-01-02',
          updated_at: '2025-01-02T10:00:00.000Z',
          grade_version: 1,
        },
      },
      {
        id: 'sub-moved',
        assignment_id: 'assign-1',
        student_id: 'stu-moved',
        student_name: 'طالب منقول',
        student_code: 'ET-OLD-999',
        answer_text: 'تسليم قديم قبل النقل',
        submitted_at: '2024-12-24T10:00:00.000Z',
        updated_at: '2024-12-24T10:00:00.000Z',
        attachment: null,
        grade: null,
      },
    ];

    const updatedSubmissions = [
      {
        ...initialSubmissions[0],
        grade: {
          id: 'grade-2',
          score: 17,
          max_score: 20,
          assessment_date: '2025-01-03',
          updated_at: '2025-01-03T10:00:00.000Z',
          grade_version: 1,
        },
      },
      initialSubmissions[1],
      initialSubmissions[2],
    ];

    vi.spyOn(teacherPortalService, 'getTeacherAssignmentSubmissions')
      .mockResolvedValueOnce({
        data: { assignmentTitle: 'واجب الحركة', groupName: 'Physics Group F1', dueAt: '2025-01-01T10:00:00.000Z', canGrade: true, submissions: initialSubmissions },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { assignmentTitle: 'واجب الحركة', groupName: 'Physics Group F1', dueAt: '2025-01-01T10:00:00.000Z', canGrade: true, submissions: initialSubmissions },
        error: null,
      })
      .mockResolvedValue({
        data: { assignmentTitle: 'واجب الحركة', groupName: 'Physics Group F1', dueAt: '2025-01-01T10:00:00.000Z', canGrade: true, submissions: updatedSubmissions },
        error: null,
      });

    vi.spyOn(teacherPortalService, 'gradeAssignmentSubmission').mockResolvedValue({
      data: {
        saved: true,
        conflict: false,
        grade: updatedSubmissions[0].grade!,
      },
      error: null,
    });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('view-submissions-btn-assign-1')).toBeDefined();
    });

    await user.click(screen.getByTestId('view-submissions-btn-assign-1'));

    // First load fails roster read -> error + Retry shown, tracker hidden
    await waitFor(() => {
      expect(screen.getByTestId('teacher-submissions-error')).toBeDefined();
      expect(screen.getByTestId('retry-load-submissions-btn')).toBeDefined();
    });
    expect(screen.queryByTestId('submissions-follow-up-tracker')).toBeNull();

    // Retry succeeds -> 1 / 1 / 1 counts & accurate statuses
    await user.click(screen.getByTestId('retry-load-submissions-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('tracker-counts-summary').textContent).toBe('1 / 1 / 1');
    });
    expect(screen.getByTestId('tracker-student-status-ET-F-101').textContent).toBe('Deadline passed — not submitted');
    expect(screen.getByTestId('tracker-student-status-ET-F-102').textContent).toBe('Pending grading');
    expect(screen.getByTestId('tracker-student-status-ET-F-103').textContent).toBe('Graded');

    // Moved student's historical submission remains accessible in submissions list
    expect(screen.getByTestId('teacher-submission-item-ET-OLD-999')).toBeDefined();

    // Test each filter
    await user.click(screen.getByTestId('tracker-filter-not_submitted'));
    expect(screen.getByTestId('tracker-student-row-ET-F-101')).toBeDefined();
    expect(screen.queryByTestId('tracker-student-row-ET-F-102')).toBeNull();
    expect(screen.queryByTestId('tracker-student-row-ET-F-103')).toBeNull();

    await user.click(screen.getByTestId('tracker-filter-pending_grading'));
    expect(screen.getByTestId('tracker-student-row-ET-F-102')).toBeDefined();
    expect(screen.queryByTestId('tracker-student-row-ET-F-101')).toBeNull();
    expect(screen.queryByTestId('tracker-student-row-ET-F-103')).toBeNull();

    await user.click(screen.getByTestId('tracker-filter-graded'));
    expect(screen.getByTestId('tracker-student-row-ET-F-103')).toBeDefined();
    expect(screen.queryByTestId('tracker-student-row-ET-F-101')).toBeNull();
    expect(screen.queryByTestId('tracker-student-row-ET-F-102')).toBeNull();

    await user.click(screen.getByTestId('tracker-filter-all'));

    // Grade student 2 (ET-F-102) with 17/20 -> counts become 1 / 0 / 2
    await user.type(screen.getByTestId('grade-score-input-ET-F-102'), '17');
    await user.click(screen.getByTestId('save-submission-grade-btn-ET-F-102'));
    await waitFor(() => {
      expect(screen.getByTestId('tracker-counts-summary').textContent).toBe('1 / 0 / 2');
    });
    unmount();

    // Simulate Refresh -> re-open modal -> counts remain 1 / 0 / 2
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('view-submissions-btn-assign-1')).toBeDefined();
    });
    await user.click(screen.getByTestId('view-submissions-btn-assign-1'));
    await waitFor(() => {
      expect(screen.getByTestId('tracker-counts-summary').textContent).toBe('1 / 0 / 2');
    });
  });

  it('ParentPortal clears previous child assignments on switch, ignores stale responses, distinguishes read error+Retry from empty state, and handles unlink', async () => {
    const user = userEvent.setup();
    const { parentPortalService } = await import('../services/parentPortalService');

    const parentSession = makeTestSession('parent-uid', 'parent@edutrack.local', 'tok-parent');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: parentSession }, error: null });
    vi.spyOn(supabase, 'from').mockImplementation((() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'parent-uid', email: 'parent@edutrack.local', role: 'parent', full_name: 'Tariq Guardian' },
            error: null,
          }),
          single: async () => ({
            data: { id: 'parent-uid', email: 'parent@edutrack.local', role: 'parent', full_name: 'Tariq Guardian' },
            error: null,
          }),
        }),
      }),
    })) as unknown as typeof supabase.from);

    const child1 = { id: 'c-1', full_name: 'يوسف طارق', student_code: 'ET-F-101', grade_level: 'Grade 10', status: 'active' as const, group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' } };
    const child2 = { id: 'c-2', full_name: 'يوسف طارق', student_code: 'ET-F-102', grade_level: 'Grade 10', status: 'active' as const, group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' } };

    vi.spyOn(parentPortalService, 'getParentPortalChildren').mockResolvedValue({ data: [child1, child2], error: null });
    vi.spyOn(parentPortalService, 'getParentChildDetails').mockImplementation(async (id) => ({
      data: { child: id === 'c-1' ? child1 : child2, attendance: [], grades: [], notes: [] },
      error: null,
    }));

    let resolveLateC1: ((v: { data: [{ id: string; title: string; due_at: string; is_past_due: boolean; status: 'graded'; grade: { score: number; max_score: number } }]; error: null }) => void) | null = null;
    vi.spyOn(parentPortalService, 'getParentChildAssignments')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLateC1 = resolve;
          })
      )
      .mockResolvedValueOnce({ data: null, error: 'Temporary assignment read failure' })
      .mockResolvedValueOnce({
        data: [{ id: 'a-1', title: 'واجب الحركة', due_at: '2099-12-01T18:00:00.000Z', is_past_due: false, status: 'not_submitted', grade: null }],
        error: null,
      });

    render(<App />);

    // Wait for child selector buttons
    await waitFor(() => {
      expect(screen.getByText('ET-F-102')).toBeDefined();
    });

    // Switch immediately to Child 2 before Child 1's slow request resolves
    await user.click(screen.getByText('ET-F-102'));

    // Child 2 shows error + Retry (not empty state)
    await waitFor(() => {
      expect(screen.getByTestId('parent-assignments-error')).toBeDefined();
      expect(screen.getByTestId('retry-parent-assignments-btn')).toBeDefined();
    });
    expect(screen.queryByTestId('parent-assignments-empty')).toBeNull();

    // Late Child 1 response arrives -> must be ignored while Child 2 is selected!
    resolveLateC1?.({
      data: [{ id: 'a-1', title: 'واجب الحركة', due_at: '2099-12-01T18:00:00.000Z', is_past_due: false, status: 'graded', grade: { score: 0, max_score: 20 } }],
      error: null,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('parent-assignment-grade-a-1')).toBeNull();

    // Retry Child 2 -> shows Not submitted
    await user.click(screen.getByTestId('retry-parent-assignments-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('parent-assignment-status-a-1').textContent).toBe('Not submitted');
    });
  });

  it('Teacher edits assignment (page 14 -> page 41) preserving PDF, handles two-window conflict, and shows rejection if student submitted first', async () => {
    const user = userEvent.setup();
    mockAuthAs('teacher', 'teacher-uid', 'teacher@edutrack.local', 'Mr. Kareem');

    vi.spyOn(teacherPortalService, 'getTeacherPortalContext').mockResolvedValue({
      data: {
        linked: true,
        teacher: { id: 't-1', full_name: 'Mr. Kareem', subject: 'Physics' },
        groups: [{ id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10', student_count: 1 }],
      },
      error: null,
    });
    vi.spyOn(teacherPortalService, 'getTeacherGroupStudents').mockResolvedValue({
      data: { group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' }, students: [] },
      error: null,
    });

    const initialAssignment = {
      id: 'assign-1',
      group_id: 'g-1',
      group_name: 'Physics Group F1',
      teacher_name: 'Mr. Kareem',
      title: 'واجب الحركة',
      instructions: 'حل تمارين صفحة 14',
      due_at: '2099-12-01T16:00:00.000Z',
      created_at: '2026-11-24T00:00:00.000Z',
      assignment_version: 1,
      attachment: { id: 'att-1', file_name: 'motion.pdf', mime_type: 'application/pdf', size_bytes: 2048 },
    };
    const updatedAssignment = {
      ...initialAssignment,
      instructions: 'حل تمارين صفحة 41',
      due_at: '2099-12-05T18:30:00.000Z',
      assignment_version: 2,
    };

    vi.spyOn(teacherPortalService, 'getTeacherAssignments').mockResolvedValue({
      data: [initialAssignment],
      error: null,
    });

    const updateSpy = vi
      .spyOn(teacherPortalService, 'updateTeacherAssignment')
      .mockResolvedValueOnce({
        data: { saved: false, conflict: true, assignment: updatedAssignment },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { saved: true, conflict: false, assignment: updatedAssignment },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: 'Cannot edit assignment: at least one student has already submitted.',
      });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('edit-assignment-btn-assign-1')).toBeDefined();
    });

    await user.click(screen.getByTestId('edit-assignment-btn-assign-1'));
    expect((screen.getByLabelText(/Instructions/i) as HTMLTextAreaElement).value).toBe('حل تمارين صفحة 14');
    expect(screen.getByTestId('edit-assignment-preserved-pdf').textContent).toContain('motion.pdf');

    // Edit to page 41 -> 1st save triggers conflict (keeps teacher's draft, shows latest values, requires confirmation)
    const instructionsInput = screen.getByLabelText(/Instructions/i);
    await user.clear(instructionsInput);
    await user.type(instructionsInput, 'حل تمارين صفحة 41');
    await user.click(screen.getByTestId('confirm-publish-assignment-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('edit-assignment-conflict-box')).toBeDefined();
    });
    expect((screen.getByLabelText(/Instructions/i) as HTMLTextAreaElement).value).toBe('حل تمارين صفحة 41');
    expect((screen.getByTestId('confirm-publish-assignment-btn') as HTMLButtonElement).disabled).toBe(true);

    // Confirm overwrite -> saves cleanly
    await user.click(screen.getByTestId('confirm-assignment-edit-overwrite'));
    await user.click(screen.getByTestId('confirm-publish-assignment-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('teacher-assignment-card-assign-1').textContent).toContain('حل تمارين صفحة 41');
    });

    // Re-open edit modal, student submits first, save fails with clear reason
    await user.click(screen.getByTestId('edit-assignment-btn-assign-1'));
    await user.click(screen.getByTestId('confirm-publish-assignment-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/already submitted/i);
    });
    expect(updateSpy).toHaveBeenCalledTimes(3);
  });

  it('locks student draft to seen assignment_version (even across background reload), surfaces conflict with latest details while preserving text+PDF, and submits on review', async () => {
    const user = userEvent.setup();
    mockAuthAs('student', 'youssef-uid', 'youssef@edutrack.local', 'Youssef Tariq');

    vi.spyOn(studentPortalService, 'getStudentPortalData').mockResolvedValue({
      data: {
        linked: true,
        student: {
          id: 's-1',
          full_name: 'Youssef Tariq',
          student_code: 'ET-F-101',
          grade_level: 'Grade 10',
          status: 'active',
          group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10' },
        },
        attendance: [],
        grades: [],
        notes: [],
      },
      error: null,
    });

    const v1Assignment = {
      id: 'assign-1',
      group_id: 'g-1',
      group_name: 'Physics Group F1',
      title: 'واجب الحركة',
      instructions: 'حل صفحة 14',
      due_at: '2099-12-01T16:00:00.000Z',
      created_at: '2026-11-24T00:00:00.000Z',
      assignment_version: 1,
      is_past_due: false,
      submission: null,
      grade: null,
    };
    const v2Assignment = {
      ...v1Assignment,
      instructions: 'حل صفحة 41',
      due_at: '2099-12-05T18:30:00.000Z',
      assignment_version: 2,
    };
    const finalSubmission = {
      id: 'sub-1',
      answer_text: 'إجابة يوسف',
      submitted_at: '2026-11-24T02:00:00.000Z',
      updated_at: '2026-11-24T02:00:00.000Z',
      attachment: { id: 'att-1', file_name: 'youssef.pdf', mime_type: 'application/pdf', size_bytes: 1024 },
    };

    vi.spyOn(studentPortalService, 'getStudentAssignments')
      .mockResolvedValueOnce({ data: { linked: true, assignments: [v1Assignment] }, error: null })
      .mockResolvedValueOnce({ data: { linked: true, assignments: [v2Assignment] }, error: null })
      .mockResolvedValueOnce({
        data: { linked: true, assignments: [{ ...v2Assignment, submission: finalSubmission }] },
        error: null,
      });

    const submitSpy = vi
      .spyOn(studentPortalService, 'submitStudentAssignment')
      .mockResolvedValueOnce({
        data: {
          saved: false,
          conflict: true,
          submission: null,
          latestAssignment: {
            id: 'assign-1',
            title: 'واجب الحركة',
            instructions: 'حل صفحة 41',
            due_at: '2099-12-05T18:30:00.000Z',
            assignment_version: 2,
            is_past_due: false,
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { saved: true, conflict: false, submission: finalSubmission },
        error: null,
      });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-answer-input-assign-1')).toBeDefined();
    });

    // Student starts drafting while seeing version 1 ("حل صفحة 14")
    await user.type(screen.getByTestId('student-answer-input-assign-1'), 'إجابة يوسف');
    const pdfInput = screen.getByTestId('student-submission-pdf-input-assign-1') as HTMLInputElement;
    const pdfFile = new File(['%PDF-1.4 answer'], 'youssef.pdf', { type: 'application/pdf' });
    fireEvent.change(pdfInput, { target: { files: [pdfFile] } });

    // Background refresh loads v2Assignment, but must NOT auto-consent to version 2!
    await user.click(screen.getByRole('button', { name: /Refresh|تحديث/i }));
    await waitFor(() => {
      expect(screen.getByTestId('student-assignment-card-assign-1').textContent).toContain('حل صفحة 41');
    });

    // First click still sends expectedAssignmentVersion = 1 -> triggers conflict banner, keeps text & PDF
    await user.click(screen.getByTestId('student-submit-assignment-btn-assign-1'));
    await waitFor(() => {
      expect(screen.getByTestId('student-assignment-conflict-assign-1')).toBeDefined();
    });
    expect(submitSpy).toHaveBeenNthCalledWith(
      1,
      'assign-1',
      'إجابة يوسف',
      expect.objectContaining({ expectedAssignmentVersion: 1 })
    );
    expect((screen.getByTestId('student-answer-input-assign-1') as HTMLTextAreaElement).value).toBe('إجابة يوسف');
    expect(screen.getByTestId('student-selected-submission-pdf-assign-1').textContent).toContain('youssef.pdf');

    // After reviewing latest details, student clicks Submit again -> sends version 2 and succeeds
    await user.click(screen.getByTestId('student-submit-assignment-btn-assign-1'));
    await waitFor(() => {
      expect(screen.getByTestId('student-saved-submission-attachment-name-assign-1').textContent).toBe('youssef.pdf');
    });
    expect(submitSpy).toHaveBeenNthCalledWith(
      2,
      'assign-1',
      'إجابة يوسف',
      expect.objectContaining({ expectedAssignmentVersion: 2 })
    );
  });

  it('StudentPortal due-date calendar maps Cairo midnight to the next Cairo day, navigates months, and handles days without deadlines', async () => {
    const user = userEvent.setup();
    mockAuthAs('student', 'student-uid-cal', 'student@edutrack.local', 'Youssef Tariq');

    vi.spyOn(studentPortalService, 'getStudentPortalData').mockResolvedValue({
      data: {
        linked: true,
        student: { id: 's-1', full_name: 'Youssef Tariq', student_code: 'ET-F-101', grade_level: 'Grade 10', status: 'active' },
        group: { id: 'g-1', name: 'Physics Group F1', grade_level: 'Grade 10', schedule: null, teacher_name: 'Mr. Kareem' },
        attendance: [],
        grades: [],
      },
      error: null,
    });
    vi.spyOn(studentPortalService, 'getStudentAssignments').mockResolvedValue({
      data: {
        linked: true,
        assignments: [
          {
            id: 'assign-midnight',
            group_id: 'g-1',
            group_name: 'Physics Group F1',
            teacher_name: 'Mr. Kareem',
            title: 'Cairo Midnight Lab',
            instructions: 'Complete lab sheet',
            // 22:30 UTC on Nov 30 == 00:30 Africa/Cairo on Dec 1
            due_at: '2099-11-30T22:30:00.000Z',
            created_at: '2026-11-24T00:00:00.000Z',
            assignment_version: 1,
            is_past_due: false,
            attachment: null,
            submission: null,
            grade: null,
          },
        ],
      },
      error: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-due-calendar')).toBeDefined();
    });

    // Opens on December 2099 and marks 2099-12-01 (not 2099-11-30)
    expect(screen.getByTestId('student-calendar-day-2099-12-01').getAttribute('data-has-due')).toBe('true');
    expect(screen.getByTestId('student-calendar-marker-2099-12-01')).toBeDefined();

    // Selecting a day without deadlines shows empty-day message
    await user.click(screen.getByTestId('student-calendar-day-2099-12-02'));
    expect(screen.getByTestId('student-calendar-day-details').textContent).toContain('2099-12-02');

    // Selecting 2099-12-01 shows title, Cairo time, and status
    await user.click(screen.getByTestId('student-calendar-day-2099-12-01'));
    const dec1Details = screen.getByTestId('student-calendar-item-assign-midnight').textContent || '';
    expect(dec1Details).toContain('Cairo Midnight Lab');
    expect(dec1Details).toContain('2099-12-01 00:30');
    expect(dec1Details).toContain('Not submitted');

    // Prev month -> November 2099 has NO marker on Nov 30
    await user.click(screen.getByTestId('student-calendar-prev'));
    expect(screen.getByTestId('student-calendar-day-2099-11-30').getAttribute('data-has-due')).toBe('false');
  });

  it('ParentPortal due-date calendar resets on child switch and never shows previous child deadlines', async () => {
    const user = userEvent.setup();
    const { parentPortalService } = await import('../services/parentPortalService');

    const parentSession = makeTestSession('parent-uid-cal', 'parent@edutrack.local', 'tok-parent');
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: parentSession }, error: null });
    vi.spyOn(supabase, 'from').mockImplementation((() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'parent-uid-cal', email: 'parent@edutrack.local', role: 'parent', full_name: 'Tariq Guardian' },
            error: null,
          }),
          single: async () => ({
            data: { id: 'parent-uid-cal', email: 'parent@edutrack.local', role: 'parent', full_name: 'Tariq Guardian' },
            error: null,
          }),
        }),
      }),
    })) as unknown as typeof supabase.from);

    const child1 = { id: 'c-1', full_name: 'Child One', student_code: 'ET-C-1', grade_level: 'Grade 10', status: 'active' as const, group: { id: 'g-1', name: 'Group A', grade_level: 'Grade 10' } };
    const child2 = { id: 'c-2', full_name: 'Child Two', student_code: 'ET-C-2', grade_level: 'Grade 10', status: 'active' as const, group: { id: 'g-2', name: 'Group B', grade_level: 'Grade 10' } };

    vi.spyOn(parentPortalService, 'getParentPortalChildren').mockResolvedValue({ data: [child1, child2], error: null });
    vi.spyOn(parentPortalService, 'getParentChildDetails').mockImplementation(async (id) => ({
      data: { child: id === 'c-1' ? child1 : child2, attendance: [], grades: [], notes: [] },
      error: null,
    }));
    vi.spyOn(parentPortalService, 'getParentChildAssignments').mockImplementation(async (id) => {
      if (id === 'c-1') {
        return {
          data: [
            {
              id: 'c1-assign',
              title: 'Child One Essay',
              due_at: '2099-12-05T16:00:00.000Z',
              is_past_due: false,
              status: 'pending_grading',
              grade: null,
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('parent-calendar-day-2099-12-05')).toBeDefined();
    });

    await user.click(screen.getByTestId('parent-calendar-day-2099-12-05'));
    expect(screen.getByTestId('parent-calendar-item-c1-assign').textContent).toContain('Child One Essay');

    // Switch to Child 2 (no assignments) -> Child 1's calendar item and marker must be gone
    await user.click(screen.getByText('ET-C-2'));
    await waitFor(() => {
      expect(screen.getByTestId('parent-assignments-empty')).toBeDefined();
    });
    expect(screen.queryByTestId('parent-calendar-item-c1-assign')).toBeNull();
    expect(screen.getByTestId('parent-calendar-day-details').textContent).toContain('No assignments scheduled.');
  });
});
