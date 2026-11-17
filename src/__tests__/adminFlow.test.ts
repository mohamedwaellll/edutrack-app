import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminService } from '../services/adminService';
import * as clientModule from '../lib/supabaseClient';

describe('Milestone Integration Test: Authenticated Admin Student Enrollment Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('executes full flow: load groups -> enroll student with group_id -> refresh students -> student persists from Supabase', async () => {
    vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

    // Mock in-memory database store
    const dbGroups = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Grade 8A',
        grade_level: 'Grade 8',
        subject: 'Science',
        room: 'Room 204',
        capacity: 30,
        enrolled_count: 0,
        created_at: new Date().toISOString(),
        teachers: { full_name: 'Dr. Salma Farid' },
      },
    ];

    const dbStudents: any[] = [];
    const dbLogs: any[] = [];

    // Mock supabase.from queries based on table
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'groups') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: dbGroups,
              error: null,
            }),
          }),
        };
      }

      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockImplementation(() => {
              // Join with group name
              const joined = dbStudents.map((s) => ({
                ...s,
                groups: { name: dbGroups.find((g) => g.id === s.group_id)?.name || 'Class' },
              }));
              return Promise.resolve({
                data: joined,
                error: null,
              });
            }),
          }),
          insert: vi.fn().mockImplementation((rows) => {
            const row = rows[0];
            const newRecord = {
              id: 'd5555555-5555-4555-8555-555555555555',
              ...row,
              created_at: new Date().toISOString(),
              groups: { name: dbGroups.find((g) => g.id === row.group_id)?.name || 'Class' },
            };
            dbStudents.unshift(newRecord);

            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: newRecord,
                  error: null,
                }),
              }),
            };
          }),
        };
      }

      if (table === 'activity_logs') {
        return {
          insert: vi.fn().mockImplementation((rows) => {
            dbLogs.push(...rows);
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }

      return {
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    // @ts-ignore
    clientModule.supabase.from = mockFrom;

    // STEP 1: Admin views groups
    const classesResult = await adminService.getClasses();
    expect(classesResult.error).toBeNull();
    expect(classesResult.data).toHaveLength(1);
    const selectedGroup = classesResult.data![0];
    expect(selectedGroup.name).toBe('Grade 8A');
    expect(selectedGroup.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    // STEP 2: Verify zero students initially in database
    const initialStudentsResult = await adminService.getStudents();
    expect(initialStudentsResult.error).toBeNull();
    expect(initialStudentsResult.data).toHaveLength(0);

    // STEP 3: Admin enrolls a student assigned to the group
    const addResult = await adminService.addStudent({
      full_name: 'Ziad Mansour',
      student_code: 'ET-3099',
      group_id: selectedGroup.id,
      grade_level: selectedGroup.grade_level,
      parent_name: 'Mansour Ahmed',
      parent_phone: '+20 100 999 8877',
      status: 'active',
    });

    expect(addResult.error).toBeNull();
    expect(addResult.data).toBeDefined();
    expect(addResult.data?.full_name).toBe('Ziad Mansour');
    expect(addResult.data?.group_id).toBe(selectedGroup.id);
    expect(addResult.data?.student_code).toBe('ET-3099');
    expect(addResult.data?.qr_code_hash).toContain('QR_ET-3099_');

    // STEP 4: Simulate page refresh / data reload from Supabase
    const refreshedStudentsResult = await adminService.getStudents();
    expect(refreshedStudentsResult.error).toBeNull();
    expect(refreshedStudentsResult.data).toHaveLength(1);

    const persistedStudent = refreshedStudentsResult.data![0];
    expect(persistedStudent.full_name).toBe('Ziad Mansour');
    expect(persistedStudent.student_code).toBe('ET-3099');
    expect(persistedStudent.group_id).toBe(selectedGroup.id);
    expect(persistedStudent.class_name).toBe('Grade 8A');
    expect(persistedStudent.status).toBe('active');
  });
});
