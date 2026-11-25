import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { ServiceResult } from './adminService';
import type {
  StudentAttendanceItem,
  StudentCardSummary,
  StudentGradeItem,
} from './studentPortalService';
import {
  type ParentChildAssignmentItem,
  type ParentTeacherNoteItem,
  parseRpcPayload,
  validateAttendanceList,
  validateGradesList,
  validateParentChildAssignments,
  validateParentNotesList,
  validateStudentCardSummary,
} from './portalPayloadValidation';

export type ParentChildSummary = StudentCardSummary;
export type { ParentChildAssignmentItem, ParentTeacherNoteItem };

export interface ParentChildDetails {
  child: ParentChildSummary;
  attendance: StudentAttendanceItem[];
  grades: StudentGradeItem[];
  notes: ParentTeacherNoteItem[];
}

export interface ParentChildDetailsResult extends ServiceResult<ParentChildDetails> {
  linkRevoked?: boolean;
}

export interface ParentChildAssignmentsResult extends ServiceResult<ParentChildAssignmentItem[]> {
  linkRevoked?: boolean;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLinkRevokedError(message: string): boolean {
  return /not linked|link.*revoked|record is unavailable/i.test(message);
}

/**
 * Read-only Stage E service for verified parent accounts.
 * Parent identity is always derived server-side from auth.uid() and verified against
 * public.parent_student_links on every read.
 */
export const parentPortalService = {
  async getParentPortalChildren(): Promise<ServiceResult<ParentChildSummary[]>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_parent_portal_children');
      if (error) {
        return { data: null, error: error.message || 'Failed to load linked children.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || !Array.isArray(payload.children)) {
        return { data: null, error: 'Unexpected parent children response from database.' };
      }

      const children: ParentChildSummary[] = [];
      for (const rawChild of payload.children) {
        const result = validateStudentCardSummary(rawChild);
        if (result.error || !result.data) {
          return { data: null, error: result.error || 'Invalid child summary in database response.' };
        }
        children.push(result.data);
      }

      return { data: children, error: null };
    } catch (err: unknown) {
      return {
        data: null,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unable to contact database while loading linked children.',
      };
    }
  },

  async getParentChildDetails(studentId: string): Promise<ParentChildDetailsResult> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedId = studentId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return { data: null, error: 'Invalid child identifier selected.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_parent_child_details', {
        p_student_id: trimmedId,
      });

      if (error) {
        const message = error.message || 'Failed to load child records.';
        return {
          data: null,
          error: message,
          linkRevoked: isLinkRevokedError(message),
        };
      }

      const payload = parseRpcPayload(data);
      if (!payload) {
        return { data: null, error: 'Unexpected child details response from database.' };
      }

      const childResult = validateStudentCardSummary(payload.child);
      if (childResult.error || !childResult.data) {
        return { data: null, error: childResult.error || 'Invalid child summary in database response.' };
      }

      const attendanceResult = validateAttendanceList(payload.attendance);
      if (attendanceResult.error || !attendanceResult.data) {
        return { data: null, error: attendanceResult.error || 'Invalid attendance list in database response.' };
      }

      const gradesResult = validateGradesList(payload.grades);
      if (gradesResult.error || !gradesResult.data) {
        return { data: null, error: gradesResult.error || 'Invalid grades list in database response.' };
      }

      const notesResult = validateParentNotesList(payload.notes);
      if (notesResult.error || !notesResult.data) {
        return { data: null, error: notesResult.error || 'Invalid teacher notes list in database response.' };
      }

      return {
        data: {
          child: childResult.data,
          attendance: attendanceResult.data,
          grades: gradesResult.data,
          notes: notesResult.data,
        },
        error: null,
      };
    } catch (err: unknown) {
      return {
        data: null,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unable to contact database while loading child details.',
      };
    }
  },

  async getParentChildAssignments(studentId: string): Promise<ParentChildAssignmentsResult> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedId = studentId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return { data: null, error: 'Invalid child identifier selected.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_parent_child_assignments', {
        p_student_id: trimmedId,
      });

      if (error) {
        const message = error.message || 'Failed to load child assignments.';
        return {
          data: null,
          error: message,
          linkRevoked: isLinkRevokedError(message),
        };
      }

      const payload = parseRpcPayload(data);
      if (!payload) {
        return { data: null, error: 'Unexpected child assignments response from database.' };
      }

      const validated = validateParentChildAssignments(payload.assignments);
      if (validated.error || !validated.data) {
        return {
          data: null,
          error: validated.error || 'Invalid child assignments list in database response.',
        };
      }

      return { data: validated.data, error: null };
    } catch (err: unknown) {
      return {
        data: null,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unable to contact database while loading child assignments.',
      };
    }
  },
};
