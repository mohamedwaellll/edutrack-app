import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { ServiceResult } from './adminService';
import { UserProfile, UserRole } from '../types/database';

export interface LinkTeacherResult {
  success: boolean;
  teacher_id: string;
  user_id: string;
}

export interface UnlinkTeacherResult {
  success: boolean;
  teacher_id: string;
  previous_user_id?: string | null;
}

export interface LinkStudentResult {
  success: boolean;
  student_id: string;
  user_id: string;
}

export interface UnlinkStudentResult {
  success: boolean;
  student_id: string;
  previous_user_id?: string | null;
}

export interface LinkParentStudentResult {
  success: boolean;
  link_id: string;
  parent_id: string;
  student_id: string;
}

export interface UnlinkParentStudentResult {
  success: boolean;
  parent_id: string;
  student_id: string;
}

export interface ParentStudentLink {
  id: string;
  parent_id: string;
  student_id: string;
  created_at: string;
  created_by?: string | null;
  parent_name?: string;
  parent_email?: string;
  student_name?: string;
  student_code?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

function mapDatabaseError(error: { message?: string; details?: string; hint?: string }): { error: string; code: string } {
  const msg = (error.message || '').toLowerCase();

  if (msg.includes('unauthorized') || msg.includes('privileges required') || msg.includes('permission denied')) {
    return { error: error.message || 'Unauthorized action', code: 'PERMISSION_DENIED' };
  }
  if (msg.includes('must have role') || msg.includes('role')) {
    return { error: error.message || 'Role compatibility check failed', code: 'ROLE_MISMATCH' };
  }
  if (msg.includes('already linked') || msg.includes('already exists') || msg.includes('duplicate')) {
    return { error: error.message || 'Record is already linked', code: 'ALREADY_LINKED' };
  }
  if (msg.includes('conflict')) {
    return { error: error.message || 'Operation conflicted with concurrent state', code: 'CONFLICT' };
  }
  if (msg.includes('not found')) {
    return { error: error.message || 'Target record not found', code: 'NOT_FOUND' };
  }

  return { error: error.message || 'Failed to complete database operation', code: 'DATABASE_ERROR' };
}

/**
 * Executes an administrative linking RPC and verifies an explicit success payload.
 */
async function executeLinkingRpc<T extends { success: boolean }>(
  rpcName: string,
  params: Record<string, string>,
  fallbackError: string
): Promise<ServiceResult<T>> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Supabase credentials are not configured in .env', code: 'CONFIG_ERROR' };
  }

  try {
    const { data, error } = await supabase.rpc(rpcName, params);

    if (error) {
      const mapped = mapDatabaseError(error);
      return { data: null, error: mapped.error, code: mapped.code };
    }

    const payload = data as T | null;
    if (!payload || payload.success !== true) {
      return {
        data: null,
        error: 'Account linking operation did not confirm a modified record.',
        code: 'CONFLICT',
      };
    }

    return { data: payload, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : fallbackError,
      code: 'NETWORK_ERROR',
    };
  }
}

export const accountLinkingService = {
  /**
   * Links an existing auth user profile (role = 'teacher') to a teacher record.
   * Atomic, administrative RPC with fail-closed security.
   */
  async linkTeacherAccount(teacherId: string, userId: string): Promise<ServiceResult<LinkTeacherResult>> {
    if (!isValidUUID(teacherId) || !isValidUUID(userId)) {
      return { data: null, error: 'Valid Teacher ID and User ID are required.', code: 'INVALID_INPUT' };
    }

    return executeLinkingRpc<LinkTeacherResult>(
      'link_teacher_account',
      { p_teacher_id: teacherId.trim(), p_user_id: userId.trim() },
      'Unexpected error during teacher account linking'
    );
  },

  /**
   * Unlinks a user account from a teacher record (sets user_id = NULL).
   * Optionally verifies the expected linked user ID on the database side before unlinking.
   */
  async unlinkTeacherAccount(teacherId: string, expectedUserId?: string): Promise<ServiceResult<UnlinkTeacherResult>> {
    if (!isValidUUID(teacherId)) {
      return { data: null, error: 'Valid Teacher ID is required.', code: 'INVALID_INPUT' };
    }
    if (expectedUserId !== undefined && !isValidUUID(expectedUserId)) {
      return { data: null, error: 'Valid expected User ID is required.', code: 'INVALID_INPUT' };
    }

    const params: Record<string, string> = { p_teacher_id: teacherId.trim() };
    if (expectedUserId) {
      params.p_expected_user_id = expectedUserId.trim();
    }

    return executeLinkingRpc<UnlinkTeacherResult>(
      'unlink_teacher_account',
      params,
      'Unexpected error during teacher unlinking'
    );
  },

  /**
   * Links an existing auth user profile (role = 'student') to a student record.
   */
  async linkStudentAccount(studentId: string, userId: string): Promise<ServiceResult<LinkStudentResult>> {
    if (!isValidUUID(studentId) || !isValidUUID(userId)) {
      return { data: null, error: 'Valid Student ID and User ID are required.', code: 'INVALID_INPUT' };
    }

    return executeLinkingRpc<LinkStudentResult>(
      'link_student_account',
      { p_student_id: studentId.trim(), p_user_id: userId.trim() },
      'Unexpected error during student account linking'
    );
  },

  /**
   * Unlinks a user account from a student record (sets user_id = NULL).
   * Optionally verifies the expected linked user ID on the database side before unlinking.
   */
  async unlinkStudentAccount(studentId: string, expectedUserId?: string): Promise<ServiceResult<UnlinkStudentResult>> {
    if (!isValidUUID(studentId)) {
      return { data: null, error: 'Valid Student ID is required.', code: 'INVALID_INPUT' };
    }
    if (expectedUserId !== undefined && !isValidUUID(expectedUserId)) {
      return { data: null, error: 'Valid expected User ID is required.', code: 'INVALID_INPUT' };
    }

    const params: Record<string, string> = { p_student_id: studentId.trim() };
    if (expectedUserId) {
      params.p_expected_user_id = expectedUserId.trim();
    }

    return executeLinkingRpc<UnlinkStudentResult>(
      'unlink_student_account',
      params,
      'Unexpected error during student unlinking'
    );
  },

  /**
   * Links a parent account (role = 'parent') to a student record.
   */
  async linkParentStudent(parentId: string, studentId: string): Promise<ServiceResult<LinkParentStudentResult>> {
    if (!isValidUUID(parentId) || !isValidUUID(studentId)) {
      return { data: null, error: 'Valid Parent ID and Student ID are required.', code: 'INVALID_INPUT' };
    }

    return executeLinkingRpc<LinkParentStudentResult>(
      'link_parent_student',
      { p_parent_id: parentId.trim(), p_student_id: studentId.trim() },
      'Unexpected error during parent-student linking'
    );
  },

  /**
   * Unlinks a parent account from a student record.
   */
  async unlinkParentStudent(parentId: string, studentId: string): Promise<ServiceResult<UnlinkParentStudentResult>> {
    if (!isValidUUID(parentId) || !isValidUUID(studentId)) {
      return { data: null, error: 'Valid Parent ID and Student ID are required.', code: 'INVALID_INPUT' };
    }

    return executeLinkingRpc<UnlinkParentStudentResult>(
      'unlink_parent_student',
      { p_parent_id: parentId.trim(), p_student_id: studentId.trim() },
      'Unexpected error during parent-student unlinking'
    );
  },

  /**
   * Reads parent-student links for a given parent or all links if admin.
   */
  async getParentStudentLinks(parentId?: string): Promise<ServiceResult<ParentStudentLink[]>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase credentials are not configured in .env', code: 'CONFIG_ERROR' };
    }

    try {
      let query = supabase
        .from('parent_student_links')
        .select(`
          id,
          parent_id,
          student_id,
          created_at,
          created_by,
          parent:profiles!parent_student_links_parent_id_fkey(full_name, email),
          student:students!parent_student_links_student_id_fkey(full_name, student_code)
        `)
        .order('created_at', { ascending: false });

      if (parentId) {
        if (!isValidUUID(parentId)) {
          return { data: null, error: 'Invalid Parent ID format.', code: 'INVALID_INPUT' };
        }
        query = query.eq('parent_id', parentId.trim());
      }

      const { data, error } = await query;

      if (error) {
        const mapped = mapDatabaseError(error);
        return { data: null, error: mapped.error, code: mapped.code };
      }

      const formatted: ParentStudentLink[] = (data || []).map((row: any) => ({
        id: row.id,
        parent_id: row.parent_id,
        student_id: row.student_id,
        created_at: row.created_at,
        created_by: row.created_by,
        parent_name: row.parent?.full_name,
        parent_email: row.parent?.email,
        student_name: row.student?.full_name,
        student_code: row.student?.student_code,
      }));

      return { data: formatted, error: null };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Unexpected error fetching parent-student links',
        code: 'NETWORK_ERROR',
      };
    }
  },

  /**
   * Helper to retrieve unlinked or role-matching user profiles for admin linking dropdowns.
   */
  async getProfilesByRole(role: UserRole): Promise<ServiceResult<UserProfile[]>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase credentials are not configured in .env', code: 'CONFIG_ERROR' };
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', role)
        .order('full_name', { ascending: true });

      if (error) {
        const mapped = mapDatabaseError(error);
        return { data: null, error: mapped.error, code: mapped.code };
      }

      return { data: (data || []) as UserProfile[], error: null };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Unexpected error fetching profiles by role',
        code: 'NETWORK_ERROR',
      };
    }
  },
};
