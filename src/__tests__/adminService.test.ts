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
      expect(capturedPayload.qr_code_hash).toContain('QR_ET-9901_');
      expect(capturedPayload.status).toBe('active');
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
});
