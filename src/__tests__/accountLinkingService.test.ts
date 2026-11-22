import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accountLinkingService } from '../services/accountLinkingService';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

vi.mock('../lib/supabaseClient', () => {
  return {
    isSupabaseConfigured: vi.fn(),
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(),
    },
  };
});

describe('accountLinkingService (Unit Tests)', () => {
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const studentId = '22222222-2222-4222-8222-222222222222';
  const parentId = '33333333-3333-4333-8333-333333333333';
  const userId = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  });

  describe('Configuration Guard', () => {
    it('returns CONFIG_ERROR if Supabase is unconfigured', async () => {
      vi.mocked(isSupabaseConfigured).mockReturnValue(false);

      const res = await accountLinkingService.linkTeacherAccount(teacherId, userId);
      expect(res.data).toBeNull();
      expect(res.code).toBe('CONFIG_ERROR');
      expect(res.error).toContain('Supabase credentials are not configured');
    });
  });

  describe('Input Validation Guards', () => {
    it('rejects invalid UUIDs for linkTeacherAccount', async () => {
      const res1 = await accountLinkingService.linkTeacherAccount('not-a-uuid', userId);
      expect(res1.data).toBeNull();
      expect(res1.code).toBe('INVALID_INPUT');

      const res2 = await accountLinkingService.linkTeacherAccount(teacherId, '');
      expect(res2.data).toBeNull();
      expect(res2.code).toBe('INVALID_INPUT');
    });

    it('rejects invalid UUIDs for unlinkTeacherAccount', async () => {
      const res = await accountLinkingService.unlinkTeacherAccount('invalid');
      expect(res.data).toBeNull();
      expect(res.code).toBe('INVALID_INPUT');
    });

    it('rejects invalid UUIDs for linkStudentAccount and unlinkStudentAccount', async () => {
      const res1 = await accountLinkingService.linkStudentAccount(studentId, 'bad-id');
      expect(res1.code).toBe('INVALID_INPUT');

      const res2 = await accountLinkingService.unlinkStudentAccount('bad-id');
      expect(res2.code).toBe('INVALID_INPUT');
    });

    it('rejects invalid UUIDs for linkParentStudent and unlinkParentStudent', async () => {
      const res1 = await accountLinkingService.linkParentStudent('bad-parent', studentId);
      expect(res1.code).toBe('INVALID_INPUT');

      const res2 = await accountLinkingService.unlinkParentStudent(parentId, 'bad-student');
      expect(res2.code).toBe('INVALID_INPUT');
    });
  });

  describe('linkTeacherAccount', () => {
    it('calls link_teacher_account RPC and returns success data', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, teacher_id: teacherId, user_id: userId },
        error: null,
      } as any);

      const result = await accountLinkingService.linkTeacherAccount(teacherId, userId);

      expect(supabase.rpc).toHaveBeenCalledWith('link_teacher_account', {
        p_teacher_id: teacherId,
        p_user_id: userId,
      });
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ success: true, teacher_id: teacherId, user_id: userId });
    });

    it('maps unauthorized error to PERMISSION_DENIED', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'Unauthorized: Administrator privileges required to link accounts' } as any,
      } as any);

      const result = await accountLinkingService.linkTeacherAccount(teacherId, userId);
      expect(result.data).toBeNull();
      expect(result.code).toBe('PERMISSION_DENIED');
    });

    it('maps role error to ROLE_MISMATCH', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'Cannot link account: user profile must have role teacher, found student' } as any,
      } as any);

      const result = await accountLinkingService.linkTeacherAccount(teacherId, userId);
      expect(result.data).toBeNull();
      expect(result.code).toBe('ROLE_MISMATCH');
    });

    it('maps already linked error to ALREADY_LINKED', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'Conflict: Teacher is already linked to user account 44444444-4444-4444-8444-444444444444' } as any,
      } as any);

      const result = await accountLinkingService.linkTeacherAccount(teacherId, userId);
      expect(result.data).toBeNull();
      expect(result.code).toBe('ALREADY_LINKED');
    });

    it('maps generic state conflict error to CONFLICT and rejects unconfirmed payload', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: 'Conflict: Teacher link state changed during unlink operation' } as any,
      } as any);

      const resConflict = await accountLinkingService.unlinkTeacherAccount(teacherId);
      expect(resConflict.data).toBeNull();
      expect(resConflict.code).toBe('CONFLICT');

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { success: false },
        error: null,
      } as any);

      const resUnconfirmed = await accountLinkingService.linkTeacherAccount(teacherId, userId);
      expect(resUnconfirmed.data).toBeNull();
      expect(resUnconfirmed.code).toBe('CONFLICT');
    });
  });

  describe('unlinkTeacherAccount', () => {
    it('calls unlink_teacher_account RPC and returns success data', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, teacher_id: teacherId, previous_user_id: userId },
        error: null,
      } as any);

      const result = await accountLinkingService.unlinkTeacherAccount(teacherId);

      expect(supabase.rpc).toHaveBeenCalledWith('unlink_teacher_account', {
        p_teacher_id: teacherId,
      });
      expect(result.error).toBeNull();
      expect(result.data?.success).toBe(true);
    });

    it('calls unlink_teacher_account RPC with expectedUserId when supplied and validates UUID', async () => {
      const badExpected = await accountLinkingService.unlinkTeacherAccount(teacherId, 'not-a-uuid');
      expect(badExpected.code).toBe('INVALID_INPUT');

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, teacher_id: teacherId, previous_user_id: userId },
        error: null,
      } as any);

      const result = await accountLinkingService.unlinkTeacherAccount(teacherId, userId);
      expect(supabase.rpc).toHaveBeenCalledWith('unlink_teacher_account', {
        p_teacher_id: teacherId,
        p_expected_user_id: userId,
      });
      expect(result.error).toBeNull();
      expect(result.data?.previous_user_id).toBe(userId);
    });
  });

  describe('linkStudentAccount and unlinkStudentAccount', () => {
    it('links student successfully', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, student_id: studentId, user_id: userId },
        error: null,
      } as any);

      const result = await accountLinkingService.linkStudentAccount(studentId, userId);
      expect(supabase.rpc).toHaveBeenCalledWith('link_student_account', {
        p_student_id: studentId,
        p_user_id: userId,
      });
      expect(result.data?.success).toBe(true);
    });

    it('unlinks student successfully', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, student_id: studentId, previous_user_id: userId },
        error: null,
      } as any);

      const result = await accountLinkingService.unlinkStudentAccount(studentId);
      expect(supabase.rpc).toHaveBeenCalledWith('unlink_student_account', {
        p_student_id: studentId,
      });
      expect(result.data?.success).toBe(true);
    });

    it('unlinks student with optional expectedUserId cleanly and validates UUID', async () => {
      const badExpected = await accountLinkingService.unlinkStudentAccount(studentId, 'not-a-uuid');
      expect(badExpected.code).toBe('INVALID_INPUT');

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, student_id: studentId, previous_user_id: userId },
        error: null,
      } as any);

      const result = await accountLinkingService.unlinkStudentAccount(studentId, userId);
      expect(supabase.rpc).toHaveBeenCalledWith('unlink_student_account', {
        p_student_id: studentId,
        p_expected_user_id: userId,
      });
      expect(result.data?.success).toBe(true);
    });
  });

  describe('linkParentStudent and unlinkParentStudent', () => {
    it('links parent to student successfully', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, link_id: 'link-uuid', parent_id: parentId, student_id: studentId },
        error: null,
      } as any);

      const result = await accountLinkingService.linkParentStudent(parentId, studentId);
      expect(supabase.rpc).toHaveBeenCalledWith('link_parent_student', {
        p_parent_id: parentId,
        p_student_id: studentId,
      });
      expect(result.data?.success).toBe(true);
    });

    it('unlinks parent from student successfully', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { success: true, parent_id: parentId, student_id: studentId },
        error: null,
      } as any);

      const result = await accountLinkingService.unlinkParentStudent(parentId, studentId);
      expect(supabase.rpc).toHaveBeenCalledWith('unlink_parent_student', {
        p_parent_id: parentId,
        p_student_id: studentId,
      });
      expect(result.data?.success).toBe(true);
    });
  });

  describe('getParentStudentLinks', () => {
    it('retrieves and formats parent student links including student_code', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((resolve) =>
          resolve({
            data: [
              {
                id: 'link-1',
                parent_id: parentId,
                student_id: studentId,
                created_at: '2026-11-21T00:00:00Z',
                created_by: userId,
                parent: { full_name: 'Parent Name', email: 'parent@edutrack.com' },
                student: { full_name: 'Student Name', student_code: 'ET-1001' },
              },
            ],
            error: null,
          })
        ),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const result = await accountLinkingService.getParentStudentLinks();
      expect(result.error).toBeNull();
      expect(result.data?.length).toBe(1);
      expect(result.data?.[0].parent_name).toBe('Parent Name');
      expect(result.data?.[0].student_name).toBe('Student Name');
      expect(result.data?.[0].student_code).toBe('ET-1001');
    });
  });

  describe('getProfilesByRole', () => {
    it('retrieves user profiles by role', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{ id: userId, full_name: 'Teacher Joe', email: 'joe@edutrack.com', role: 'teacher' }],
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const result = await accountLinkingService.getProfilesByRole('teacher');
      expect(result.error).toBeNull();
      expect(result.data?.length).toBe(1);
      expect(result.data?.[0].role).toBe('teacher');
    });
  });
});
