import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminService } from '../services/adminService';
import * as clientModule from '../lib/supabaseClient';

describe('adminService Contract & Business Logic (Unit Tests)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration handling', () => {
    it('returns explicit error when Supabase is unconfigured', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(false);

      const studentsRes = await adminService.getStudents();
      expect(studentsRes.data).toBeNull();
      expect(studentsRes.error).toContain('not configured');

      const classesRes = await adminService.getClasses();
      expect(classesRes.data).toBeNull();
      expect(classesRes.error).toContain('not configured');

      const addRes = await adminService.addStudent({
        full_name: 'Test Student',
        group_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        grade_level: 'Grade 8',
      });
      expect(addRes.data).toBeNull();
      expect(addRes.error).toContain('not configured');
    });
  });

  describe('addStudent validation & persistence', () => {
    it('rejects empty or single-character full name', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const res1 = await adminService.addStudent({
        full_name: '',
        group_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        grade_level: 'Grade 8',
      });
      expect(res1.data).toBeNull();
      expect(res1.error).toContain('minimum 2 characters');

      const res2 = await adminService.addStudent({
        full_name: 'A',
        group_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        grade_level: 'Grade 8',
      });
      expect(res2.data).toBeNull();
      expect(res2.error).toContain('minimum 2 characters');
    });

    it('rejects student creation without a valid group_id', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const res = await adminService.addStudent({
        full_name: 'Lara Hassan',
        group_id: '',
        grade_level: 'Grade 8',
      });
      expect(res.data).toBeNull();
      expect(res.error).toContain('select a valid group');
    });

    it('persists group_id and generates unique qr_code_hash on insert', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      let capturedPayload: any = null;

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        return {
          insert: vi.fn().mockImplementation((payload) => {
            capturedPayload = payload[0];
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'd1111111-1111-4111-8111-111111111111',
                    ...capturedPayload,
                    created_at: new Date().toISOString(),
                    groups: { name: 'Grade 8A' },
                  },
                  error: null,
                }),
              }),
            };
          }),
        };
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const targetGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const result = await adminService.addStudent({
        full_name: 'Karim Tarek',
        student_code: 'ET-9901',
        group_id: targetGroupId,
        grade_level: 'Grade 8',
        parent_name: 'Tarek Mahmoud',
        parent_phone: '+20 100 123 4567',
      });

      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
      expect(result.data?.full_name).toBe('Karim Tarek');
      expect(result.data?.group_id).toBe(targetGroupId);
      expect(result.data?.class_name).toBe('Grade 8A');

      // Verify the database received the correct fields
      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.group_id).toBe(targetGroupId);
      expect(capturedPayload.full_name).toBe('Karim Tarek');
      expect(capturedPayload.student_code).toBe('ET-9901');
      // Verifies random unique QR hash generation
      expect(capturedPayload.qr_code_hash).toBeDefined();
      expect(capturedPayload.qr_code_hash.length).toBeGreaterThan(10);
      expect(capturedPayload.status).toBe('active');
    });

    it('preserves an existing or explicit qr_code_hash when provided', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      let capturedPayload: any = null;
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'activity_logs') {
          return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }
        return {
          insert: vi.fn().mockImplementation((payload) => {
            capturedPayload = payload[0];
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'd1111111-1111-4111-8111-111111111111',
                    ...capturedPayload,
                    created_at: new Date().toISOString(),
                    groups: { name: 'Grade 8A' },
                  },
                  error: null,
                }),
              }),
            };
          }),
        };
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const explicitHash = '550e8400-e29b-41d4-a716-446655440000';
      const result = await adminService.addStudent({
        full_name: 'Existing Student',
        student_code: 'ET-9902',
        group_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        grade_level: 'Grade 8',
        qr_code_hash: explicitHash,
      });

      expect(result.error).toBeNull();
      expect(capturedPayload.qr_code_hash).toBe(explicitHash);
    });

    it('handles duplicate student codes gracefully with clean error message', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "students_student_code_key"',
              },
            }),
          }),
        }),
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const result = await adminService.addStudent({
        full_name: 'Duplicate Student',
        student_code: 'ET-2048',
        group_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        grade_level: 'Grade 8',
      });

      expect(result.data).toBeNull();
      expect(result.code).toBe('DUPLICATE_CODE');
      expect(result.error).toContain('already in use');
    });
  });

  describe('Empty database states and error handling', () => {
    it('returns empty array when table has zero records (does NOT fabricate fake students)', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const result = await adminService.getStudents();
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
      expect(result.data?.length).toBe(0);
    });

    it('returns explicit error when Supabase query fails', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database connection timeout', code: '57P01' },
          }),
        }),
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const result = await adminService.getStudents();
      expect(result.data).toBeNull();
      expect(result.error).toBe('Database connection timeout');
    });
  });

  describe('createTeacher validation & execution', () => {
    it('returns error when Supabase is unconfigured', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(false);

      const res = await adminService.createTeacher({
        full_name: 'Dr. Tariq',
        subject: 'Math',
        email: 'tariq@edutrack.edu',
      });
      expect(res.data).toBeNull();
      expect(res.error).toContain('not configured');
    });

    it('rejects missing or too short full_name', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const res = await adminService.createTeacher({
        full_name: ' A ',
        subject: 'Math',
        email: 'tariq@edutrack.edu',
      });
      expect(res.data).toBeNull();
      expect(res.error).toContain('minimum 2 characters');
    });

    it('rejects missing subject', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const res = await adminService.createTeacher({
        full_name: 'Dr. Tariq',
        subject: '   ',
        email: 'tariq@edutrack.edu',
      });
      expect(res.data).toBeNull();
      expect(res.error).toContain('Teaching subject is required');
    });

    it('rejects malformed email', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const invalidEmails = [
        'invalid-email-address',
        'user name@example.com', // internal space
        'user@@example.com',     // multiple @
        'user@example.',         // missing suffix
        'user@example',          // missing dot/suffix
      ];

      for (const email of invalidEmails) {
        const res = await adminService.createTeacher({
          full_name: 'Dr. Tariq',
          subject: 'Math',
          email,
        });
        expect(res.data).toBeNull();
        expect(res.error).toContain('valid email address is required');
      }
    });

    it('accepts valid short-domain email such as a@b.co', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'activity_logs') {
          return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }
        return {
          insert: vi.fn().mockImplementation((payload) => ({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: '11111111-2222-4333-8444-555555555555',
                  ...payload[0],
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          })),
        };
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const res = await adminService.createTeacher({
        full_name: 'Dr. Aly',
        subject: 'Math',
        email: '  A@B.CO  ',
      });

      expect(res.error).toBeNull();
      expect(res.data?.email).toBe('a@b.co');
    });

    it('trims input, inserts teacher record, and converts email to lowercase', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      let capturedPayload: any = null;
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          insert: vi.fn().mockImplementation((payload) => {
            capturedPayload = payload[0];
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: '11111111-2222-4333-8444-555555555555',
                    ...capturedPayload,
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            };
          }),
        };
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const res = await adminService.createTeacher({
        full_name: '  Dr. Tariq Mahmoud  ',
        subject: '  Physics  ',
        email: '  TARIQ.M@EduTrack.EDU  ',
        phone: '  +201099887766  ',
      });

      expect(res.error).toBeNull();
      expect(res.data?.full_name).toBe('Dr. Tariq Mahmoud');
      expect(res.data?.subject).toBe('Physics');
      expect(res.data?.email).toBe('tariq.m@edutrack.edu');
      expect('user_id' in capturedPayload).toBe(false);
      expect((capturedPayload as any).user_id).toBeUndefined();
    });

    it('handles duplicate email (error code 23505) with clear friendly message', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "idx_teachers_email_lower"',
                },
              }),
            }),
          }),
        };
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const res = await adminService.createTeacher({
        full_name: 'Sarah Nabil',
        subject: 'Biology',
        email: 'sarah.nabil@edutrack.edu',
      });

      expect(res.data).toBeNull();
      expect(res.code).toBe('23505');
      expect(res.error).toContain('already exists');
    });
  });

  describe('updateGroupTeacher validation & execution', () => {
    it('returns error when Supabase is unconfigured', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(false);

      const res = await adminService.updateGroupTeacher(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-4111-8111-111111111111'
      );
      expect(res.data).toBeNull();
      expect(res.error).toContain('not configured');
    });

    it('rejects invalid group UUID', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const res = await adminService.updateGroupTeacher('invalid-uuid', null);
      expect(res.data).toBeNull();
      expect(res.error).toContain('valid group UUID is required');
    });

    it('rejects invalid teacher UUID when assigning', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const res = await adminService.updateGroupTeacher(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'not-a-uuid'
      );
      expect(res.data).toBeNull();
      expect(res.error).toContain('valid teacher UUID is required');
    });

    it('successfully assigns an existing teacher to a group', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const teacherId = '11111111-1111-4111-8111-111111111111';

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'teachers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: teacherId, full_name: 'Mona Salem' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'groups') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: groupId,
                      name: 'Grade 8A',
                      grade_level: 'Grade 8',
                      subject: 'Science',
                      room: 'Room 204',
                      capacity: 30,
                      teacher_id: teacherId,
                      teachers: { full_name: 'Mona Salem' },
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {};
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const res = await adminService.updateGroupTeacher(groupId, teacherId);
      expect(res.error).toBeNull();
      expect(res.data?.teacher_id).toBe(teacherId);
      expect(res.data?.teacher_name).toBe('Mona Salem');
    });

    it('successfully unassigns a teacher when null is provided', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'groups') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: groupId,
                      name: 'Grade 8A',
                      grade_level: 'Grade 8',
                      subject: 'Science',
                      room: 'Room 204',
                      capacity: 30,
                      teacher_id: null,
                      teachers: null,
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {};
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const res = await adminService.updateGroupTeacher(groupId, null);
      expect(res.error).toBeNull();
      expect(res.data?.teacher_id).toBeNull();
      expect(res.data?.teacher_name).toBe('Unassigned');
    });
  });

  describe('getTeachers error handling and integrity', () => {
    it('surfaces groups query errors and does not silently default to empty classes', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'teachers') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: '11111111-1111-4111-8111-111111111111',
                    full_name: 'Dr. Salma',
                    subject: 'Science',
                    email: 'salma@edutrack.edu',
                    phone: null,
                    created_at: new Date().toISOString(),
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'groups') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Failed to fetch groups relationship', code: 'PGRST500' },
              }),
            }),
          };
        }
        return {};
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const res = await adminService.getTeachers();
      expect(res.data).toBeNull();
      expect(res.error).toBe('Failed to fetch groups relationship');
      expect(res.code).toBe('PGRST500');
    });

    it('surfaces teachers query errors', async () => {
      vi.spyOn(clientModule, 'isSupabaseConfigured').mockReturnValue(true);

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'teachers') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Connection timeout', code: '57P01' },
              }),
            }),
          };
        }
        if (table === 'groups') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          };
        }
        return {};
      });

      // @ts-ignore
      clientModule.supabase.from = mockFrom;

      const res = await adminService.getTeachers();
      expect(res.data).toBeNull();
      expect(res.error).toBe('Connection timeout');
    });
  });
});
