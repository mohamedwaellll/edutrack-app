// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AdminDashboard from '../components/AdminDashboard';
import { adminService } from '../services/adminService';
import { useAuth } from '../contexts/authState';

// Mock AuthContext
vi.mock('../contexts/authState', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'admin-uuid', email: 'admin@edutrack.com' },
    profile: { id: 'admin-uuid', email: 'admin@edutrack.com', full_name: 'Admin User', role: 'admin' },
    signOut: vi.fn(),
  })),
}));

// Mock AttendanceQRScanner to avoid camera/web-api requirements in jsdom
vi.mock('../components/AttendanceQRScanner', () => ({
  AttendanceQRScanner: () => <div data-testid="mock-scanner">Scanner</div>,
}));

// Mock recharts
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

describe('AdminDashboard Teacher Workflows & Integrity (Component Tests)', () => {
  const mockOverview = {
    stats: {
      totalStudents: { value: '10', change: 'Active' },
      teachers: { value: '3', change: 'Active' },
      activeClasses: { value: '2', change: 'Active' },
      attendanceToday: { value: '95%', change: 'Normal' },
    },
    weeklyAttendance: [],
    recentActivities: [],
    studentAttendance: [],
  };

  const mockClasses = [
    {
      id: 'group-1',
      name: 'Grade 8A',
      grade_level: 'Grade 8',
      subject: 'Science',
      room: 'Room 204',
      capacity: 30,
      enrolled_count: 15,
      teacher_id: 'teacher-1',
      teacher_name: 'Dr. Tariq',
      created_at: new Date().toISOString(),
    },
  ];

  const mockTeachers = [
    {
      id: 'teacher-1',
      full_name: 'Dr. Tariq',
      subject: 'Science',
      email: 'tariq@edutrack.edu',
      phone: '+201012345678',
      assigned_classes: ['Grade 8A'],
      avatar_initials: 'DT',
      created_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(adminService, 'getDashboardOverview').mockResolvedValue({ data: mockOverview, error: null });
    vi.spyOn(adminService, 'getClasses').mockResolvedValue({ data: mockClasses, error: null });
    vi.spyOn(adminService, 'getTeachers').mockResolvedValue({ data: mockTeachers, error: null });
    vi.spyOn(adminService, 'getStudents').mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('paginates the student directory and searches all loaded students', async () => {
    vi.mocked(adminService.getStudents).mockResolvedValue({
      error: null,
      data: Array.from({ length: 28 }, (_, index) => ({
        id: `student-${index + 1}`,
        full_name: `Student ${index + 1}`,
        student_code: `ET-${1000 + index}`,
        group_id: 'group-1',
        class_name: 'Grade 8A',
        grade_level: 'Grade 8',
        status: 'active',
        qr_code_hash: '',
        created_at: '2026-11-24T00:00:00Z',
      })),
    });

    render(<AdminDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Students', exact: true }));
    await screen.findByText('Page 1 of 2');
    expect(screen.getByText('ET-1000')).toBeDefined();
    expect(screen.queryByText('ET-1027')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 2')).toBeDefined();
    expect(screen.getByText('ET-1027')).toBeDefined();
    expect(screen.queryByText('ET-1000')).toBeNull();

    const search = screen.getByPlaceholderText(/search students/i);
    fireEvent.change(search, { target: { value: 'ET-1000' } });
    expect(screen.getByText('ET-1000')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('Page 1 of 2')).toBeDefined();
  });

  // 1. REPRODUCTION 1: Teacher directory failure inside assignment workflow
  it('1. Teacher directory failure in assignment modal displays error, preserves teacher, disables mutations, and allows retry', async () => {
    vi.spyOn(adminService, 'getClasses').mockResolvedValue({ data: mockClasses, error: null });
    const getTeachersSpy = vi.spyOn(adminService, 'getTeachers').mockResolvedValue({
      data: null,
      error: 'Directory unavailable',
    });

    render(<AdminDashboard />);

    // Switch to Classes tab
    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Assign \/ Change/i })).toBeDefined();
    });

    // Open Assign modal
    fireEvent.click(screen.getByRole('button', { name: /Assign \/ Change/i }));

    // 1. Directory loading/error status is displayed in modal
    await waitFor(() => {
      expect(screen.getByText('Faculty directory unavailable')).toBeDefined();
      expect(screen.getByText('Directory unavailable')).toBeDefined();
    });

    // 2. Current teacher identity is strictly preserved (never represented as unassigned)
    expect(screen.getByText(/Current Assigned Instructor:/i)).toBeDefined();
    expect(screen.getAllByText(/Dr. Tariq/i).length).toBeGreaterThan(0);

    // 3. Assignment mutations are prevented while directory is unavailable
    const select = screen.getByLabelText(/Assigned Teacher/i) as HTMLSelectElement;
    expect(select.disabled).toBe(true);

    const saveButton = screen.getByRole('button', { name: /Save Assignment/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    // 4. Retry directory interaction restores interaction after success
    getTeachersSpy.mockResolvedValueOnce({ data: mockTeachers, error: null });
    const retryDirectoryBtn = screen.getByRole('button', { name: /Retry Directory/i });
    fireEvent.click(retryDirectoryBtn);

    await waitFor(() => {
      expect(screen.queryByText('Faculty directory unavailable')).toBeNull();
      expect(select.disabled).toBe(false);
      expect(saveButton.disabled).toBe(false);
    });
  });

  // 2. REPRODUCTION 2: Rejected loading promises
  it('2. Rejected loading promise for teachers shows scoped error banner without rendering empty state', async () => {
    vi.spyOn(adminService, 'getTeachers').mockRejectedValue(new Error('Network connection lost'));

    render(<AdminDashboard />);

    // Switch to Teachers tab
    fireEvent.click(screen.getByRole('button', { name: /Teachers/i }));

    // Scoped directory error banner appears
    await waitFor(() => {
      expect(screen.getByText('Failed to load teachers directory')).toBeDefined();
      expect(screen.getByText('Network connection lost')).toBeDefined();
    });

    // Successful empty state must NOT be rendered
    expect(screen.queryByText('No teachers recorded in database yet.')).toBeNull();
  });

  // 3. Retry recovery for teacher directory loading
  it('3. Recovers from initial teacher directory failure when retry succeeds', async () => {
    const getTeachersSpy = vi.spyOn(adminService, 'getTeachers').mockResolvedValue({
      data: null,
      error: 'Faculty timeout',
    });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Teachers/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to load teachers directory')).toBeDefined();
    });

    // Setup retry success
    getTeachersSpy.mockResolvedValue({ data: mockTeachers, error: null });

    const retryBtn = screen.getByRole('button', { name: /Retry Loading Teachers/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByText('Failed to load teachers directory')).toBeNull();
      expect(screen.getByText('Dr. Tariq')).toBeDefined();
    });
  });

  // 4. Retry recovery for classes loading
  it('4. Recovers from classes loading failure when retry succeeds', async () => {
    const getClassesSpy = vi.spyOn(adminService, 'getClasses').mockResolvedValueOnce({
      data: null,
      error: 'Groups table network disconnect',
    });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to load classes and groups')).toBeDefined();
      expect(screen.getByText('Groups table network disconnect')).toBeDefined();
    });

    expect(screen.queryByText('No class groups found')).toBeNull();

    // Setup retry success
    getClassesSpy.mockResolvedValueOnce({ data: mockClasses, error: null });

    const retryBtn = screen.getByRole('button', { name: /Retry Loading Classes/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByText('Failed to load classes and groups')).toBeNull();
      expect(screen.getByText('Grade 8A')).toBeDefined();
    });
  });

  // 5. Teacher creation failure followed by a successful retry
  it('5. Teacher creation failure preserves form values and closes after successful retry', async () => {
    const createSpy = vi.spyOn(adminService, 'createTeacher')
      .mockResolvedValueOnce({
        data: null,
        error: 'A teacher with the email "dup@edutrack.edu" already exists.',
        code: '23505',
      })
      .mockResolvedValueOnce({
        data: {
          id: 'teacher-2',
          full_name: 'Dr. New',
          subject: 'Physics',
          email: 'new@edutrack.edu',
          phone: null,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Teachers/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Teacher/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Teacher/i }));

    const nameInput = screen.getByLabelText(/Full Name/i) as HTMLInputElement;
    const subjectInput = screen.getByLabelText(/Subject \/ Specialization/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/Email Address/i) as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: 'Dr. New' } });
    fireEvent.change(subjectInput, { target: { value: 'Physics' } });
    fireEvent.change(emailInput, { target: { value: 'dup@edutrack.edu' } });

    // First attempt fails
    fireEvent.click(screen.getByRole('button', { name: /^Save Teacher$/i }));

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeDefined();
    });

    // Form values strictly preserved
    expect(nameInput.value).toBe('Dr. New');
    expect(emailInput.value).toBe('dup@edutrack.edu');

    // Correct email and retry
    fireEvent.change(emailInput, { target: { value: 'new@edutrack.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save Teacher$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Add New Teacher/i })).toBeNull();
      expect(screen.getByText(/added to staff directory successfully/i)).toBeDefined();
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  // 6. Assignment failure followed by a successful retry
  it('6. Assignment failure keeps modal open with error and closes on successful retry', async () => {
    const assignSpy = vi.spyOn(adminService, 'updateGroupTeacher')
      .mockResolvedValueOnce({
        data: null,
        error: 'Database lock timeout during instructor assignment',
      })
      .mockResolvedValueOnce({
        data: {
          ...mockClasses[0],
          teacher_id: 'teacher-1',
          teacher_name: 'Dr. Tariq',
        },
        error: null,
      });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Assign \/ Change/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Assign \/ Change/i }));

    // Submit assignment (first attempt fails)
    fireEvent.click(screen.getByRole('button', { name: /^Save Assignment$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Database lock timeout/i)).toBeDefined();
    });

    expect(screen.getByRole('heading', { name: /Assign Group Instructor/i })).toBeDefined();

    // Retry assignment (second attempt succeeds)
    fireEvent.click(screen.getByRole('button', { name: /^Save Assignment$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Assign Group Instructor/i })).toBeNull();
    });

    expect(assignSpy).toHaveBeenCalledTimes(2);
  });

  // 7. Successful assignment followed by refresh failure
  it('7. Successful assignment with refresh failure closes modal, reports mutation, and allows refresh without re-submitting', async () => {
    const updateSpy = vi.spyOn(adminService, 'updateGroupTeacher').mockResolvedValue({
      data: {
        ...mockClasses[0],
        teacher_id: 'teacher-1',
        teacher_name: 'Dr. Tariq',
      },
      error: null,
    });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Assign \/ Change/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Assign \/ Change/i }));

    // Next loadData / getClasses call will fail
    vi.spyOn(adminService, 'getClasses').mockRejectedValue(new Error('Refresh network error'));

    fireEvent.click(screen.getByRole('button', { name: /^Save Assignment$/i }));

    // Modal closes to prevent re-submission
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Assign Group Instructor/i })).toBeNull();
    });

    // Saved mutation is accurately reported with warning about refresh
    await waitFor(() => {
      expect(screen.getByText(/instructor updated, but directory refresh failed/i)).toBeDefined();
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  // 8. Explicit unassignment submits teacherId = null
  it('8. Explicit unassignment submits teacherId = null to backend', async () => {
    const updateGroupTeacherSpy = vi.spyOn(adminService, 'updateGroupTeacher').mockResolvedValue({
      data: {
        ...mockClasses[0],
        teacher_id: null,
        teacher_name: 'Unassigned',
      },
      error: null,
    });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Assign \/ Change/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Assign \/ Change/i }));

    // Select Unassigned
    const select = screen.getByLabelText(/Assigned Teacher/i);
    fireEvent.change(select, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /^Save Assignment$/i }));

    await waitFor(() => {
      expect(updateGroupTeacherSpy).toHaveBeenCalledWith('group-1', null);
    });
  });

  // 9. Rapid repeated unassignment submits only once
  it('9. Rapid repeated unassignment submits only once due to synchronous guard', async () => {
    type AssignResult = Awaited<ReturnType<typeof adminService.updateGroupTeacher>>;
    let resolveAssign!: (val: AssignResult) => void;
    const assignPromise = new Promise<AssignResult>((resolve) => {
      resolveAssign = resolve;
    });

    const updateGroupTeacherSpy = vi.spyOn(adminService, 'updateGroupTeacher').mockReturnValue(assignPromise);

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Assign \/ Change/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Assign \/ Change/i }));

    const select = screen.getByLabelText(/Assigned Teacher/i);
    fireEvent.change(select, { target: { value: '' } });

    const form = screen.getByRole('button', { name: /^Save Assignment$/i }).closest('form')!;

    // Rapid double submission
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(updateGroupTeacherSpy).toHaveBeenCalledTimes(1);

    resolveAssign({
      data: {
        ...mockClasses[0],
        teacher_id: null,
        teacher_name: 'Unassigned',
      },
      error: null,
    });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Assign Group Instructor/i })).toBeNull();
    });
  });

  // 10. Submission guards release after returned errors and thrown exceptions
  it('10. Submission guards release properly after both returned errors and thrown exceptions', async () => {
    // A. Teacher Creation guard release on thrown error
    const createSpy = vi.spyOn(adminService, 'createTeacher')
      .mockRejectedValueOnce(new Error('Fatal connection fault'))
      .mockResolvedValueOnce({
        data: {
          id: 'teacher-x',
          full_name: 'Dr. Recovery',
          subject: 'History',
          email: 'rec@edutrack.edu',
          phone: null,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Teachers/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Teacher/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Teacher/i }));

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Dr. Recovery' } });
    fireEvent.change(screen.getByLabelText(/Subject \/ Specialization/i), { target: { value: 'History' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'rec@edutrack.edu' } });

    // First click throws
    fireEvent.click(screen.getByRole('button', { name: /^Save Teacher$/i }));

    await waitFor(() => {
      expect(screen.getByText('Fatal connection fault')).toBeDefined();
    });

    // Second click must proceed (guard was released)
    fireEvent.click(screen.getByRole('button', { name: /^Save Teacher$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Add New Teacher/i })).toBeNull();
    });

    expect(createSpy).toHaveBeenCalledTimes(2);

    // B. Group Assignment guard release on thrown error
    const updateSpy = vi.spyOn(adminService, 'updateGroupTeacher')
      .mockRejectedValueOnce(new Error('Crash on update'))
      .mockResolvedValueOnce({
        data: {
          ...mockClasses[0],
          teacher_id: 'teacher-1',
          teacher_name: 'Dr. Tariq',
        },
        error: null,
      });

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Assign \/ Change/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Assign \/ Change/i }));

    // First click throws
    fireEvent.click(screen.getByRole('button', { name: /^Save Assignment$/i }));

    await waitFor(() => {
      expect(screen.getByText('Crash on update')).toBeDefined();
    });

    // Second click must proceed (guard was released)
    fireEvent.click(screen.getByRole('button', { name: /^Save Assignment$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Assign Group Instructor/i })).toBeNull();
    });

    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  // 11. Add Group optional instructor behavior with directory failure
  it('11. Add Group modal displays directory notice and allows unassigned group creation when directory is down', async () => {
    vi.spyOn(adminService, 'getTeachers').mockResolvedValue({
      data: null,
      error: 'Directory unavailable',
    });

    const addClassSpy = vi.spyOn(adminService, 'addClass').mockResolvedValue({
      data: {
        id: 'new-group-1',
        name: 'Grade 9B',
        grade_level: 'Grade 9',
        subject: 'Art',
        room: 'Room 101',
        capacity: 25,
        enrolled_count: 0,
        teacher_id: null,
        teacher_name: 'Unassigned',
        created_at: new Date().toISOString(),
      },
      error: null,
    });

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Class Group/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Class Group/i }));

    // Modal displays directory notice
    expect(screen.getByText(/Faculty directory unavailable/i)).toBeDefined();

    // Teacher select is disabled or unassigned
    const select = screen.getByLabelText(/Assign Instructor/i) as HTMLSelectElement;
    expect(select.disabled).toBe(true);

    // Enter group details
    fireEvent.change(screen.getByLabelText(/Class Group Name/i), { target: { value: 'Grade 9B' } });
    fireEvent.change(screen.getByLabelText(/Grade Level/i), { target: { value: 'Grade 9' } });
    fireEvent.change(screen.getByLabelText(/^Subject$/i), { target: { value: 'Art' } });

    // Form can still be submitted (optional instructor preserved)
    fireEvent.click(screen.getByRole('button', { name: /Save Group/i }));

    await waitFor(() => {
      expect(addClassSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Grade 9B',
          teacher_id: null,
        })
      );
    });
  });

  // 12. Edit Class Group workflow: prefill, validation, draft preservation on error, double-submit guard, revalidation guard, and confirmed server update
  it('12. Edit Class Group prefills values, validates capacity, keeps draft on error, blocks double submit & revalidation, and updates from server result', async () => {
    let currentClass = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Grade 8A',
      grade_level: 'Grade 8',
      subject: 'Science',
      room: 'Room 204',
      capacity: 30,
      enrolled_count: 12,
      schedule: 'Sun - Thu: 08:00 AM - 02:00 PM',
      teacher_id: '11111111-1111-4111-8111-111111111111',
      teacher_name: 'Dr. Salma',
      created_at: new Date().toISOString(),
    };

    vi.spyOn(adminService, 'getClasses').mockImplementation(async () => ({
      data: [currentClass],
      error: null,
    }));

    let resolveSecondSave!: (val: { data: typeof currentClass | null; error: string | null }) => void;
    const updateClassSpy = vi
      .spyOn(adminService, 'updateClass')
      .mockResolvedValueOnce({
        data: null,
        error: 'Permission denied on groups update',
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondSave = resolve;
          })
      );

    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Edit Grade 8A/i })).toBeDefined();
    });

    // Open Edit modal and verify prefilled fields
    fireEvent.click(screen.getByRole('button', { name: /Edit Grade 8A/i }));

    const nameInput = screen.getByLabelText(/Class Group Name/i) as HTMLInputElement;
    const gradeInput = screen.getByLabelText(/Grade Level/i) as HTMLInputElement;
    const subjectInput = screen.getByLabelText(/^Subject$/i) as HTMLInputElement;
    const roomInput = screen.getByLabelText(/^Room$/i) as HTMLInputElement;
    const capacityInput = screen.getByLabelText(/^Capacity/i) as HTMLInputElement;
    const scheduleInput = screen.getByLabelText(/^Schedule$/i) as HTMLInputElement;

    expect(nameInput.value).toBe('Grade 8A');
    expect(gradeInput.value).toBe('Grade 8');
    expect(subjectInput.value).toBe('Science');
    expect(roomInput.value).toBe('Room 204');
    expect(capacityInput.value).toBe('30');
    expect(scheduleInput.value).toBe('Sun - Thu: 08:00 AM - 02:00 PM');

    // Invalid capacity (0) blocked before calling service
    fireEvent.change(capacityInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    expect(screen.getByText(/positive whole number/i)).toBeDefined();
    expect(updateClassSpy).not.toHaveBeenCalled();

    // Enter valid updated values, trigger server error, and verify draft is preserved
    fireEvent.change(nameInput, { target: { value: 'Grade 8A Honors' } });
    fireEvent.change(roomInput, { target: { value: 'Lab 101' } });
    fireEvent.change(capacityInput, { target: { value: '35' } });
    fireEvent.change(scheduleInput, { target: { value: 'Mon - Wed: 09:00 AM - 01:00 PM' } });

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Permission denied on groups update')).toBeDefined();
    });
    expect((screen.getByLabelText(/Class Group Name/i) as HTMLInputElement).value).toBe('Grade 8A Honors');
    expect((screen.getByLabelText(/^Room$/i) as HTMLInputElement).value).toBe('Lab 101');
    expect((screen.getByLabelText(/^Capacity/i) as HTMLInputElement).value).toBe('35');

    // Double-click Save Changes while in-flight -> only 1 additional call
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    expect(updateClassSpy).toHaveBeenCalledTimes(2);
    const secondCallArg = updateClassSpy.mock.calls[1][0];
    expect(secondCallArg).toEqual({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Grade 8A Honors',
      grade_level: 'Grade 8',
      subject: 'Science',
      room: 'Lab 101',
      capacity: 35,
      schedule: 'Mon - Wed: 09:00 AM - 01:00 PM',
    });
    expect(secondCallArg).not.toHaveProperty('teacher_id');
    expect(secondCallArg).not.toHaveProperty('enrolled_count');

    const updatedRow = {
      ...currentClass,
      name: 'Grade 8A Honors',
      room: 'Lab 101',
      capacity: 35,
      schedule: 'Mon - Wed: 09:00 AM - 01:00 PM',
    };
    currentClass = updatedRow;
    resolveSecondSave({ data: updatedRow, error: null });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Edit Class Group/i })).toBeNull();
      expect(screen.getByText('Grade 8A Honors')).toBeDefined();
      expect(screen.getByText('Lab 101')).toBeDefined();
      expect(screen.getByText('12 / 35')).toBeDefined();
      expect(screen.getByText('Dr. Salma')).toBeDefined();
    });
  });

  // 13. Edit Class Group honors auth revalidation guard
  it('13. Edit Class Group blocks submission while session is revalidating', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'admin-1', email: 'admin@edutrack.edu' } as unknown as ReturnType<typeof useAuth>['user'],
      profile: {
        id: 'admin-1',
        email: 'admin@edutrack.edu',
        full_name: 'Admin User',
        role: 'admin',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      isRevalidating: true,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });

    vi.spyOn(adminService, 'getClasses').mockResolvedValue({
      data: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Grade 8A',
          grade_level: 'Grade 8',
          subject: 'Science',
          room: 'Room 204',
          capacity: 30,
          enrolled_count: 12,
          schedule: 'Sun - Thu: 08:00 AM - 02:00 PM',
          teacher_id: null,
          teacher_name: 'Unassigned',
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const updateClassSpy = vi.spyOn(adminService, 'updateClass');
    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Edit Grade 8A/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Edit Grade 8A/i }));
    const form = screen.getByLabelText(/Class Group Name/i).closest('form')!;
    fireEvent.submit(form);

    expect(screen.getByText('Verifying session permissions. Please wait before saving.')).toBeDefined();
    expect(updateClassSpy).not.toHaveBeenCalled();
  });
});
