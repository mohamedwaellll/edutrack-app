// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboard from '../components/AdminDashboard';
import { adminService } from '../services/adminService';
import { accountLinkingService } from '../services/accountLinkingService';
import { Teacher, Student, UserProfile } from '../types/database';
import { ParentStudentLink } from '../services/accountLinkingService';

vi.mock('../contexts/authState', () => ({
  useAuth: () => ({
    user: { id: 'admin-0000-0000-0000-000000000001', email: 'admin@edutrack.com' },
    profile: {
      id: 'admin-0000-0000-0000-000000000001',
      email: 'admin@edutrack.com',
      full_name: 'Admin User',
      role: 'admin',
      created_at: '2026-11-01T00:00:00Z',
    },
    signOut: vi.fn(),
  }),
}));

vi.mock('../components/AttendanceQRScanner', () => ({
  AttendanceQRScanner: () => <div data-testid="mock-scanner">Scanner</div>,
}));

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

describe('AdminDashboard Account Linking Workflows (Stage B.2 Component Tests)', () => {
  const teacher1Id = '11111111-1111-4111-8111-111111111111';
  const teacherUser1Id = 'aaaa1111-1111-4111-8111-111111111111';
  const teacherUser2Id = 'aaaa2222-2222-4222-8222-222222222222';

  const student1Id = '22221111-1111-4111-8111-111111111111';
  const student2Id = '22222222-2222-4222-8222-222222222222';
  const studentUser1Id = 'bbbb1111-1111-4111-8111-111111111111';
  const studentUser2Id = 'bbbb2222-2222-4222-8222-222222222222';

  const parent1Id = '33331111-1111-4111-8111-111111111111';
  const parent2Id = '33332222-2222-4222-8222-222222222222';

  const baseTeachers: Teacher[] = [
    {
      id: teacher1Id,
      user_id: null,
      full_name: 'Dr. Tarek Mansour',
      subject: 'Physics',
      email: 'tarek@edutrack.edu',
      assigned_classes: ['Grade 10A'],
      created_at: '2026-11-01T00:00:00Z',
    },
  ];

  // Two students with identical names distinguished by student_code
  const baseStudents: Student[] = [
    {
      id: student1Id,
      user_id: studentUser1Id,
      full_name: 'Omar Hassan',
      student_code: 'ET-1001',
      group_id: 'group-1',
      class_name: 'Grade 10A',
      grade_level: 'Grade 10',
      qr_code_hash: 'QR-1001',
      status: 'active',
      created_at: '2026-11-01T00:00:00Z',
    },
    {
      id: student2Id,
      user_id: null,
      full_name: 'Omar Hassan',
      student_code: 'ET-2002',
      group_id: 'group-2',
      class_name: 'Grade 11B',
      grade_level: 'Grade 11',
      qr_code_hash: 'QR-2002',
      status: 'active',
      created_at: '2026-11-02T00:00:00Z',
    },
  ];

  const teacherProfiles: UserProfile[] = [
    {
      id: teacherUser1Id,
      email: 'tarek@edutrack.edu',
      full_name: 'Dr. Tarek Mansour',
      role: 'teacher',
      created_at: '2026-11-01T00:00:00Z',
    },
    {
      id: teacherUser2Id,
      email: 'mona.other@edutrack.edu',
      full_name: 'Mona Adel',
      role: 'teacher',
      created_at: '2026-11-01T00:00:00Z',
    },
  ];

  const studentProfiles: UserProfile[] = [
    {
      id: studentUser1Id,
      email: 'omar1@student.edu',
      full_name: 'Omar Hassan',
      role: 'student',
      created_at: '2026-11-01T00:00:00Z',
    },
    {
      id: studentUser2Id,
      email: 'omar2@student.edu',
      full_name: 'Omar Hassan',
      role: 'student',
      created_at: '2026-11-01T00:00:00Z',
    },
  ];

  const parentProfiles: UserProfile[] = [
    {
      id: parent1Id,
      email: 'hassan.father@parent.edu',
      full_name: 'Hassan Ali',
      role: 'parent',
      created_at: '2026-11-01T00:00:00Z',
    },
    {
      id: parent2Id,
      email: 'nadia.mother@parent.edu',
      full_name: 'Nadia Samir',
      role: 'parent',
      created_at: '2026-11-01T00:00:00Z',
    },
  ];

  const baseLinks: ParentStudentLink[] = [
    {
      id: 'link-1',
      parent_id: parent1Id,
      student_id: student1Id,
      created_at: '2026-11-05T00:00:00Z',
      parent_name: 'Hassan Ali',
      parent_email: 'hassan.father@parent.edu',
      student_name: 'Omar Hassan',
      student_code: 'ET-1001',
    },
    // Student 2 already has another parent link (tests N:1 multiple parents per student)
    {
      id: 'link-2',
      parent_id: parent2Id,
      student_id: student2Id,
      created_at: '2026-11-06T00:00:00Z',
      parent_name: 'Nadia Samir',
      parent_email: 'nadia.mother@parent.edu',
      student_name: 'Omar Hassan',
      student_code: 'ET-2002',
    },
  ];

  const mockOverview = {
    stats: {
      totalStudents: { value: '2', change: 'Active' },
      teachers: { value: '1', change: 'Active' },
      activeClasses: { value: '2', change: 'Active' },
      attendanceToday: { value: '100%', change: 'Normal' },
    },
    weeklyAttendance: [],
    recentActivities: [],
    studentAttendance: [],
  };

  let currentTeachers: Teacher[];
  let currentStudents: Student[];
  let currentLinks: ParentStudentLink[];

  beforeEach(() => {
    vi.restoreAllMocks();
    currentTeachers = baseTeachers.map((t) => ({ ...t }));
    currentStudents = baseStudents.map((s) => ({ ...s }));
    currentLinks = baseLinks.map((l) => ({ ...l }));

    vi.spyOn(adminService, 'getDashboardOverview').mockResolvedValue({ data: mockOverview, error: null });
    vi.spyOn(adminService, 'getClasses').mockResolvedValue({ data: [], error: null });
    vi.spyOn(adminService, 'getTeachers').mockImplementation(async () => ({ data: currentTeachers, error: null }));
    vi.spyOn(adminService, 'getStudents').mockImplementation(async () => ({ data: currentStudents, error: null }));

    vi.spyOn(accountLinkingService, 'getProfilesByRole').mockImplementation(async (role) => {
      if (role === 'teacher') return { data: teacherProfiles, error: null };
      if (role === 'student') return { data: studentProfiles, error: null };
      if (role === 'parent') return { data: parentProfiles, error: null };
      return { data: [], error: null };
    });
    vi.spyOn(accountLinkingService, 'getParentStudentLinks').mockImplementation(async () => ({
      data: currentLinks,
      error: null,
    }));
  });

  afterEach(() => {
    cleanup();
  });

  async function openAccountLinkingFromSidebar() {
    render(<AdminDashboard />);
    const navBtn = await screen.findByRole('button', { name: /Account Linking/i });
    fireEvent.click(navBtn);
    await waitFor(() => {
      expect(screen.getByText('Teacher Account Linking')).toBeDefined();
    });
  }

  it('1. Teachers workflow: opens from AdminDashboard, forbids auto-linking, links explicitly, persists on re-open, and unlinks with two-sided confirmation + expectedUserId', async () => {
    const linkSpy = vi.spyOn(accountLinkingService, 'linkTeacherAccount').mockImplementation(async (tId, uId) => {
      currentTeachers = currentTeachers.map((t) => (t.id === tId ? { ...t, user_id: uId } : t));
      return { data: { success: true, teacher_id: tId, user_id: uId }, error: null };
    });

    const unlinkSpy = vi.spyOn(accountLinkingService, 'unlinkTeacherAccount').mockImplementation(async (tId, expUId) => {
      currentTeachers = currentTeachers.map((t) => (t.id === tId ? { ...t, user_id: null } : t));
      return { data: { success: true, teacher_id: tId, previous_user_id: expUId || null }, error: null };
    });

    await openAccountLinkingFromSidebar();

    // Verify Teacher is initially Unlinked
    expect(screen.getByText('Dr. Tarek Mansour')).toBeDefined();
    expect(screen.getByText('Unlinked')).toBeDefined();

    // Open Link Account modal
    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));

    // Assert NO auto-linking even though name and email match tarek@edutrack.edu
    const select = screen.getByLabelText(/Select Account by UUID/i) as HTMLSelectElement;
    expect(select.value).toBe('');
    const confirmLinkBtn = screen.getByRole('button', { name: /Confirm Link/i }) as HTMLButtonElement;
    expect(confirmLinkBtn.disabled).toBe(true);

    // Search by name inside modal, then explicitly select account UUID
    fireEvent.change(screen.getByLabelText(/Search Available Teacher Accounts/i), { target: { value: 'Tarek' } });
    fireEvent.change(select, { target: { value: teacherUser1Id } });
    expect(confirmLinkBtn.disabled).toBe(false);

    fireEvent.click(confirmLinkBtn);

    await waitFor(() => {
      expect(linkSpy).toHaveBeenCalledWith(teacher1Id, teacherUser1Id);
      expect(screen.getByText(`UUID: ${teacherUser1Id}`)).toBeDefined();
    });

    // Navigate away and re-open Account Linking -> verify persisted state reloads freshly
    fireEvent.click(screen.getByRole('button', { name: /^Overview$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Account Linking/i }));

    await waitFor(() => {
      expect(screen.getByText(`UUID: ${teacherUser1Id}`)).toBeDefined();
      expect(screen.getByRole('button', { name: /Unlink Account/i })).toBeDefined();
    });

    // Click Unlink Account -> verify BOTH sides are presented in confirmation dialog
    fireEvent.click(screen.getByRole('button', { name: /Unlink Account/i }));
    const confirmModalHeading = screen.getByText('Confirm Account Unlink');
    const modal = confirmModalHeading.closest('div.bg-white') as HTMLElement;
    expect(within(modal).getByText('Teacher Record')).toBeDefined();
    expect(within(modal).getByText('Linked User Account')).toBeDefined();
    expect(within(modal).getAllByText('Dr. Tarek Mansour').length).toBe(2);
    expect(within(modal).getByText(`UUID: ${teacher1Id}`)).toBeDefined();
    expect(within(modal).getByText(`UUID: ${teacherUser1Id}`)).toBeDefined();

    fireEvent.click(within(modal).getByRole('button', { name: /Confirm Unlink/i }));

    await waitFor(() => {
      expect(unlinkSpy).toHaveBeenCalledWith(teacher1Id, teacherUser1Id);
      expect(screen.getByText('Unlinked')).toBeDefined();
    });
  });

  it('2. Students workflow: distinguishes identical student names via student_code, links explicitly, and unlinks with expectedUserId confirmation', async () => {
    const linkStudentSpy = vi.spyOn(accountLinkingService, 'linkStudentAccount').mockImplementation(async (sId, uId) => {
      currentStudents = currentStudents.map((s) => (s.id === sId ? { ...s, user_id: uId } : s));
      return { data: { success: true, student_id: sId, user_id: uId }, error: null };
    });

    const unlinkStudentSpy = vi.spyOn(accountLinkingService, 'unlinkStudentAccount').mockImplementation(async (sId, expUId) => {
      currentStudents = currentStudents.map((s) => (s.id === sId ? { ...s, user_id: null } : s));
      return { data: { success: true, student_id: sId, previous_user_id: expUId || null }, error: null };
    });

    await openAccountLinkingFromSidebar();

    // Switch to Students pathway
    fireEvent.click(screen.getByRole('button', { name: /Students \(2\)/i }));
    expect(screen.getByText('Student Account Linking')).toBeDefined();

    // Both students named "Omar Hassan" are visible with distinct student_code badges and IDs
    expect(screen.getAllByText('Omar Hassan').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(`ID: ${student1Id}`)).toBeDefined();
    expect(screen.getByText(`ID: ${student2Id}`)).toBeDefined();
    expect(screen.getByText('ET-1001')).toBeDefined();
    expect(screen.getByText('ET-2002')).toBeDefined();

    // Filter by student_code ET-2002 to isolate the second Omar Hassan
    fireEvent.change(screen.getByLabelText(/Search students/i), { target: { value: 'ET-2002' } });
    expect(screen.queryByText('ET-1001')).toBeNull();
    expect(screen.getByText('ET-2002')).toBeDefined();

    // Link ET-2002 to studentUser2Id
    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));
    const linkModalHeading = screen.getByText('Link Student Account');
    const modal = linkModalHeading.closest('div.bg-white') as HTMLElement;
    expect(within(modal).getByText('Code: ET-2002')).toBeDefined();

    const select = within(modal).getByLabelText(/Select Account by UUID/i) as HTMLSelectElement;
    expect(select.value).toBe(''); // No auto-selection
    fireEvent.change(select, { target: { value: studentUser2Id } });
    fireEvent.click(within(modal).getByRole('button', { name: /Confirm Link/i }));

    await waitFor(() => {
      expect(linkStudentSpy).toHaveBeenCalledWith(student2Id, studentUser2Id);
      expect(screen.getByText(`UUID: ${studentUser2Id}`)).toBeDefined();
    });

    // Unlink ET-2002 -> confirmation displays Code: ET-2002 and linked UUID
    fireEvent.click(screen.getByRole('button', { name: /Unlink Account/i }));
    const unlinkModal = screen.getByText('Confirm Account Unlink').closest('div.bg-white') as HTMLElement;
    expect(within(unlinkModal).getByText('Code: ET-2002')).toBeDefined();
    expect(within(unlinkModal).getByText(`UUID: ${studentUser2Id}`)).toBeDefined();

    fireEvent.click(within(unlinkModal).getByRole('button', { name: /Confirm Unlink/i }));

    await waitFor(() => {
      expect(unlinkStudentSpy).toHaveBeenCalledWith(student2Id, studentUser2Id);
    });
  });

  it('3. Parents & Children workflow: manages multiple children per parent and multiple parents per student, and confirms removal with both parties', async () => {
    const linkParentSpy = vi.spyOn(accountLinkingService, 'linkParentStudent').mockImplementation(async (pId, sId) => {
      const s = currentStudents.find((item) => item.id === sId)!;
      const p = parentProfiles.find((item) => item.id === pId)!;
      currentLinks = [
        ...currentLinks,
        {
          id: 'link-new',
          parent_id: pId,
          student_id: sId,
          created_at: new Date().toISOString(),
          parent_name: p.full_name,
          parent_email: p.email,
          student_name: s.full_name,
          student_code: s.student_code,
        },
      ];
      return { data: { success: true, link_id: 'link-new', parent_id: pId, student_id: sId }, error: null };
    });

    const unlinkParentSpy = vi.spyOn(accountLinkingService, 'unlinkParentStudent').mockImplementation(async (pId, sId) => {
      currentLinks = currentLinks.filter((l) => !(l.parent_id === pId && l.student_id === sId));
      return { data: { success: true, parent_id: pId, student_id: sId }, error: null };
    });

    await openAccountLinkingFromSidebar();

    // Switch to Parents & Children tab
    fireEvent.click(screen.getByRole('button', { name: /Parents & Children/i }));
    expect(screen.getByText('Parent-Child Relationship Linking')).toBeDefined();

    // Explicitly select Parent 1 (Hassan Ali) by UUID
    const parentSelect = screen.getByLabelText(/Select Parent Account/i) as HTMLSelectElement;
    expect(parentSelect.value).toBe('');
    fireEvent.change(parentSelect, { target: { value: parent1Id } });

    // Existing linked child (ET-1001) appears
    await waitFor(() => {
      expect(screen.getByText('1 linked student(s)')).toBeDefined();
      expect(screen.getByText('ET-1001')).toBeDefined();
    });

    // Student 2 (ET-2002) is already linked to Nadia (parent2Id), yet still selectable for Hassan (N:1 support)
    const childSelect = screen.getByLabelText(/Select Student \(Explicit Code & UUID\)/i) as HTMLSelectElement;
    fireEvent.change(childSelect, { target: { value: student2Id } });
    fireEvent.click(screen.getByRole('button', { name: /Link Child/i }));

    await waitFor(() => {
      expect(linkParentSpy).toHaveBeenCalledWith(parent1Id, student2Id);
      expect(screen.getByText('2 linked student(s)')).toBeDefined();
      expect(screen.getByText('ET-2002')).toBeDefined();
    });

    // Remove link for ET-1001 -> two-sided confirmation shows Parent + Child
    const removeButtons = screen.getAllByRole('button', { name: /Remove Link/i });
    fireEvent.click(removeButtons[removeButtons.length - 1]); // remove one link

    const modal = screen.getByText('Confirm Account Unlink').closest('div.bg-white') as HTMLElement;
    expect(within(modal).getByText('Hassan Ali')).toBeDefined();
    expect(within(modal).getByText('Omar Hassan')).toBeDefined();

    fireEvent.click(within(modal).getByRole('button', { name: /Confirm Unlink/i }));

    await waitFor(() => {
      expect(unlinkParentSpy).toHaveBeenCalled();
      expect(screen.getByText('1 linked student(s)')).toBeDefined();
    });
  });

  it('4. Directory failure disables dependent actions, preserves unaffected tabs, distinguishes empty vs error, and recovers via Retry', async () => {
    const getProfilesSpy = vi.spyOn(accountLinkingService, 'getProfilesByRole').mockImplementation(async (role) => {
      if (role === 'teacher') {
        return { data: null, error: 'Teacher profiles query timed out', code: 'DATABASE_ERROR' };
      }
      if (role === 'student') return { data: studentProfiles, error: null };
      return { data: parentProfiles, error: null };
    });

    await openAccountLinkingFromSidebar();

    // Teacher section displays error banner and disables Link Account button
    await waitFor(() => {
      expect(screen.getByText('Required teacher data failed to load')).toBeDefined();
      expect(screen.getByText(/Teacher profiles query timed out/i)).toBeDefined();
    });
    const teacherLinkBtn = screen.getByRole('button', { name: /Link Account/i }) as HTMLButtonElement;
    expect(teacherLinkBtn.disabled).toBe(true);

    // Meanwhile Students pathway (independent) remains enabled
    fireEvent.click(screen.getByRole('button', { name: /Students \(2\)/i }));
    const studentUnlinkBtn = screen.getByRole('button', { name: /Unlink Account/i }) as HTMLButtonElement;
    expect(studentUnlinkBtn.disabled).toBe(false);

    // Return to Teachers and Retry with empty teachers list to verify empty state vs error
    fireEvent.click(screen.getByRole('button', { name: /Teachers \(1\)/i }));
    getProfilesSpy.mockImplementation(async (role) => {
      if (role === 'teacher') return { data: teacherProfiles, error: null };
      if (role === 'student') return { data: studentProfiles, error: null };
      return { data: parentProfiles, error: null };
    });
    vi.spyOn(adminService, 'getTeachers').mockResolvedValueOnce({ data: [], error: null });

    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));

    await waitFor(() => {
      expect(screen.queryByText('Required teacher data failed to load')).toBeNull();
      expect(screen.getByText('No teacher records found in the directory.')).toBeDefined();
    });
  });

  it('5. Double-click guard prevents duplicate RPC submissions while request is in flight', async () => {
    type LinkResult = Awaited<ReturnType<typeof accountLinkingService.linkTeacherAccount>>;
    let resolveRpc!: (val: LinkResult) => void;
    const pendingPromise = new Promise<LinkResult>((resolve) => {
      resolveRpc = resolve;
    });

    const linkSpy = vi.spyOn(accountLinkingService, 'linkTeacherAccount').mockReturnValue(pendingPromise);

    await openAccountLinkingFromSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));
    fireEvent.change(screen.getByLabelText(/Select Account by UUID/i), { target: { value: teacherUser1Id } });

    const confirmBtn = screen.getByRole('button', { name: /Confirm Link/i });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(linkSpy).toHaveBeenCalledTimes(1);

    resolveRpc({ data: { success: true, teacher_id: teacher1Id, user_id: teacherUser1Id }, error: null });

    await waitFor(() => {
      expect(screen.queryByText('Link Teacher Account')).toBeNull();
    });
  });

  it('6. Stale confirmation conflict refreshes view before permitting another attempt (and locks if refresh fails)', async () => {
    // Seed teacher already linked to Account A
    currentTeachers = [{ ...baseTeachers[0], user_id: teacherUser1Id }];

    vi.spyOn(accountLinkingService, 'unlinkTeacherAccount').mockResolvedValue({
      data: null,
      error: `Conflict: Teacher link changed to another user account (${teacherUser2Id}). Current link preserved; please refresh the list.`,
      code: 'CONFLICT',
    });

    await openAccountLinkingFromSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Unlink Account/i }));

    // Simulate refresh failure after conflict + updated teacher on next manual reload
    const teachersSpy = vi.spyOn(adminService, 'getTeachers');
    teachersSpy.mockResolvedValueOnce({ data: null, error: 'Temporary network loss during conflict refresh' });

    fireEvent.click(screen.getByRole('button', { name: /Confirm Unlink/i }));

    await waitFor(() => {
      expect(screen.getByText('Link conflict detected')).toBeDefined();
      expect(screen.getByText(/Automatic directory refresh failed/i)).toBeDefined();
    });

    // While conflict refresh failed, stale directory table is hidden and no Unlink action is clickable
    expect(screen.getByText('Teachers directory unavailable. Use Retry above to load teachers.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Unlink Account/i })).toBeNull();

    // Manual Reload List succeeds with updated Account B -> unlocks view with real current link
    teachersSpy.mockResolvedValueOnce({
      data: [{ ...baseTeachers[0], user_id: teacherUser2Id }],
      error: null,
    });

    fireEvent.click(screen.getByRole('button', { name: /Reload List/i }));

    await waitFor(() => {
      expect(screen.getByText(/Refresh completed — showing the latest saved state/i)).toBeDefined();
      expect(screen.getByText(`UUID: ${teacherUser2Id}`)).toBeDefined();
      expect((screen.getByRole('button', { name: /Unlink Account/i }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('7. Save succeeded but affected pathway reload failed locks affected pathway, leaves unaffected pathways usable, and Retry never re-saves', async () => {
    const linkSpy = vi.spyOn(accountLinkingService, 'linkTeacherAccount').mockImplementation(async (tId, uId) => {
      currentTeachers = currentTeachers.map((t) => (t.id === tId ? { ...t, user_id: uId } : t));
      return { data: { success: true, teacher_id: tId, user_id: uId }, error: null };
    });

    await openAccountLinkingFromSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));
    fireEvent.change(screen.getByLabelText(/Select Account by UUID/i), { target: { value: teacherUser1Id } });

    // Cause post-save getTeachers refresh to fail (affected pathway = teachers)
    const teachersSpy = vi.spyOn(adminService, 'getTeachers');
    teachersSpy.mockResolvedValueOnce({ data: null, error: 'Refresh timeout' });

    fireEvent.click(screen.getByRole('button', { name: /Confirm Link/i }));

    await waitFor(() => {
      expect(screen.getByText('Save succeeded, but list reload failed')).toBeDefined();
      expect(screen.getByText(/Do not re-submit the action/i)).toBeDefined();
      expect(screen.queryByText('Link Teacher Account')).toBeNull();
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^Link Account$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unlink Account$/i })).toBeNull();

    // Unaffected Students pathway remains fully usable
    fireEvent.click(screen.getByRole('button', { name: /Students \(2\)/i }));
    expect((screen.getByRole('button', { name: /^Link Account$/i }) as HTMLButtonElement).disabled).toBe(false);

    // Return to Teachers and click Reload List -> re-reads only and NEVER calls linkTeacherAccount again
    fireEvent.click(screen.getByRole('button', { name: /Teachers \(1\)/i }));
    teachersSpy.mockResolvedValueOnce({ data: currentTeachers, error: null });
    fireEvent.click(screen.getByRole('button', { name: /Reload List/i }));

    await waitFor(() => {
      expect(screen.queryByText('Save succeeded, but list reload failed')).toBeNull();
      expect(screen.getByText(`UUID: ${teacherUser1Id}`)).toBeDefined();
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
  });

  it('8. Hiding selected teacher or student account by search clears selection, blocks Enter submit, and sends visible UUID once when re-selected', async () => {
    const user = userEvent.setup();
    const linkTeacherSpy = vi.spyOn(accountLinkingService, 'linkTeacherAccount').mockImplementation(async (tId, uId) => {
      currentTeachers = currentTeachers.map((t) => (t.id === tId ? { ...t, user_id: uId } : t));
      return { data: { success: true, teacher_id: tId, user_id: uId }, error: null };
    });
    const linkStudentSpy = vi.spyOn(accountLinkingService, 'linkStudentAccount').mockImplementation(async (sId, uId) => {
      currentStudents = currentStudents.map((s) => (s.id === sId ? { ...s, user_id: uId } : s));
      return { data: { success: true, student_id: sId, user_id: uId }, error: null };
    });

    await openAccountLinkingFromSidebar();

    // --- Teachers Modal ---
    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));
    const accountSelect = screen.getByLabelText(/Select Account by UUID/i) as HTMLSelectElement;
    const modalSearch = screen.getByLabelText(/Search Available Teacher Accounts/i) as HTMLInputElement;

    // Select Tarek's account
    fireEvent.change(accountSelect, { target: { value: teacherUser1Id } });
    expect(accountSelect.value).toBe(teacherUser1Id);

    // Filter out Tarek by typing 'Mona' -> clears selection & disables Confirm Link
    fireEvent.change(modalSearch, { target: { value: 'Mona' } });
    expect(accountSelect.value).toBe('');
    expect((screen.getByRole('button', { name: /Confirm Link/i }) as HTMLButtonElement).disabled).toBe(true);

    // Attempt Enter submission and direct form submit while hidden -> service MUST NOT be called
    await user.type(modalSearch, '{enter}');
    fireEvent.submit(modalSearch.closest('form')!);
    expect(linkTeacherSpy).not.toHaveBeenCalled();

    // Clearing search must NOT resurrect the cleared selection
    fireEvent.change(modalSearch, { target: { value: '' } });
    expect(accountSelect.value).toBe('');

    // Select a visible option (Mona) and submit via Enter -> sends exact visible UUID once
    fireEvent.change(accountSelect, { target: { value: teacherUser2Id } });
    await user.type(modalSearch, '{enter}');

    await waitFor(() => {
      expect(linkTeacherSpy).toHaveBeenCalledTimes(1);
      expect(linkTeacherSpy).toHaveBeenCalledWith(teacher1Id, teacherUser2Id);
    });

    // --- Students Modal ---
    fireEvent.click(screen.getByRole('button', { name: /Students \(2\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Link Account$/i }));
    const studentSelect = screen.getByLabelText(/Select Account by UUID/i) as HTMLSelectElement;
    const studentModalSearch = screen.getByLabelText(/Search Available Student Accounts/i) as HTMLInputElement;

    fireEvent.change(studentSelect, { target: { value: studentUser2Id } });
    expect(studentSelect.value).toBe(studentUser2Id);

    // Filter out studentUser2Id
    fireEvent.change(studentModalSearch, { target: { value: 'no-such-student-account' } });
    expect(studentSelect.value).toBe('');
    await user.type(studentModalSearch, '{enter}');
    expect(linkStudentSpy).not.toHaveBeenCalled();

    fireEvent.change(studentModalSearch, { target: { value: '' } });
    fireEvent.change(studentSelect, { target: { value: studentUser2Id } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Link/i }));

    await waitFor(() => {
      expect(linkStudentSpy).toHaveBeenCalledTimes(1);
      expect(linkStudentSpy).toHaveBeenCalledWith(student2Id, studentUser2Id);
    });
  });

  it('9. Parents workflow: hiding selected parent clears both parent and child selections, and hiding child blocks linking old relationship', async () => {
    const user = userEvent.setup();
    const linkParentSpy = vi.spyOn(accountLinkingService, 'linkParentStudent').mockResolvedValue({
      data: { success: true, link_id: 'link-new', parent_id: parent1Id, student_id: student2Id },
      error: null,
    });

    await openAccountLinkingFromSidebar();
    fireEvent.click(screen.getByRole('button', { name: /Parents & Children/i }));

    const parentFilter = screen.getByLabelText(/Filter Parent Accounts/i) as HTMLInputElement;
    const parentSelect = screen.getByLabelText(/Select Parent Account/i) as HTMLSelectElement;

    // Select Parent 1 and Child Student 2
    fireEvent.change(parentSelect, { target: { value: parent1Id } });
    screen.getByLabelText(/Filter Students by Name or Code/i);
    const childSelect = screen.getByLabelText(/Select Student \(Explicit Code & UUID\)/i) as HTMLSelectElement;
    fireEvent.change(childSelect, { target: { value: student2Id } });
    expect(childSelect.value).toBe(student2Id);

    // Filter out Parent 1 by searching 'Nadia' -> clears parent AND clears child selection
    fireEvent.change(parentFilter, { target: { value: 'Nadia' } });
    expect(parentSelect.value).toBe('');
    expect(screen.queryByLabelText(/Select Student \(Explicit Code & UUID\)/i)).toBeNull();

    // Clear parent filter and re-select Parent 1 -> child selection MUST remain cleared ('')
    fireEvent.change(parentFilter, { target: { value: '' } });
    expect(parentSelect.value).toBe('');
    fireEvent.change(parentSelect, { target: { value: parent1Id } });
    const childSelectAfterReset = screen.getByLabelText(/Select Student \(Explicit Code & UUID\)/i) as HTMLSelectElement;
    expect(childSelectAfterReset.value).toBe('');

    // Re-select Student 2, then filter out Student 2 via child search -> clears child & blocks Enter submit
    fireEvent.change(childSelectAfterReset, { target: { value: student2Id } });
    const childFilterRe = screen.getByLabelText(/Filter Students by Name or Code/i) as HTMLInputElement;
    fireEvent.change(childFilterRe, { target: { value: 'ET-9999' } });
    expect(childSelectAfterReset.value).toBe('');
    expect((screen.getByRole('button', { name: /Link Child/i }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(childFilterRe, '{enter}');
    fireEvent.submit(childFilterRe.closest('form')!);
    expect(linkParentSpy).not.toHaveBeenCalled();

    // Clear child filter, explicitly choose Student 2 again, and submit once
    fireEvent.change(childFilterRe, { target: { value: '' } });
    fireEvent.change(childSelectAfterReset, { target: { value: student2Id } });
    fireEvent.click(screen.getByRole('button', { name: /Link Child/i }));

    await waitFor(() => {
      expect(linkParentSpy).toHaveBeenCalledTimes(1);
      expect(linkParentSpy).toHaveBeenCalledWith(parent1Id, student2Id);
    });
  });

  it('10. Independent post-save refresh failure in parent links preserves teacher success & usability, while surfacing Retry on Parents pathway', async () => {
    const linkTeacherSpy = vi.spyOn(accountLinkingService, 'linkTeacherAccount').mockImplementation(async (tId, uId) => {
      currentTeachers = currentTeachers.map((t) => (t.id === tId ? { ...t, user_id: uId } : t));
      return { data: { success: true, teacher_id: tId, user_id: uId }, error: null };
    });

    await openAccountLinkingFromSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));
    fireEvent.change(screen.getByLabelText(/Select Account by UUID/i), { target: { value: teacherUser1Id } });

    // During post-save refresh: Teachers + Teacher profiles SUCCEED, ONLY getParentStudentLinks fails!
    const linksSpy = vi.spyOn(accountLinkingService, 'getParentStudentLinks');
    linksSpy.mockResolvedValueOnce({ data: null, error: 'Parent links service temporarily down', code: 'NETWORK_ERROR' });

    fireEvent.click(screen.getByRole('button', { name: /Confirm Link/i }));

    // Teachers pathway shows success, does NOT show save-refresh failure, and stays unlocked
    await waitFor(() => {
      expect(screen.getByText(/Linked teacher "Dr. Tarek Mansour" to account "tarek@edutrack.edu"/i)).toBeDefined();
      expect(screen.queryByText('Save succeeded, but list reload failed')).toBeNull();
      expect((screen.getByRole('button', { name: /Unlink Account/i }) as HTMLButtonElement).disabled).toBe(false);
    });

    expect(linkTeacherSpy).toHaveBeenCalledTimes(1);

    // Parents pathway shows isolated error + Retry and locks parent actions
    fireEvent.click(screen.getByRole('button', { name: /Parents & Children/i }));
    expect(screen.getByText('Required parent linking data failed to load')).toBeDefined();
    expect(screen.getByText(/Parent-student links: Parent links service temporarily down/i)).toBeDefined();

    // Retry recovers Parents pathway without re-invoking teacher link save
    linksSpy.mockResolvedValueOnce({ data: currentLinks, error: null });
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));

    await waitFor(() => {
      expect(screen.queryByText('Required parent linking data failed to load')).toBeNull();
    });
    expect(linkTeacherSpy).toHaveBeenCalledTimes(1);
  });
});
