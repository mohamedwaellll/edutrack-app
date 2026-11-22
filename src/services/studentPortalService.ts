import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { AttendanceStatus, GradeRecord } from '../types/database';
import type { ServiceResult } from './adminService';
import type { VerifiedStudentStatus } from './teacherPortalService';
import {
  parseRpcPayload,
  validateAttendanceList,
  validateGradesList,
  validateStudentCardSummary,
} from './portalPayloadValidation';

export interface StudentGroupSummary {
  id: string;
  name: string;
  grade_level: string;
}

export interface StudentCardSummary {
  id: string;
  full_name: string;
  student_code: string;
  grade_level: string;
  status: VerifiedStudentStatus;
  group: StudentGroupSummary | null;
}

export interface StudentAttendanceItem {
  id: string;
  date: string;
  status: AttendanceStatus;
  check_in_time: string | null;
}

export interface StudentGradeItem {
  id: string;
  assessment_title: string;
  grade_type: GradeRecord['type'];
  score: number;
  max_score: number;
  assessment_date: string;
}

export interface StudentPortalData {
  linked: boolean;
  student: StudentCardSummary | null;
  attendance: StudentAttendanceItem[];
  grades: StudentGradeItem[];
}

/**
 * Read-only Stage D service for verified student accounts.
 * Identity is always derived server-side from auth.uid(); no studentId is accepted from client code.
 */
export const studentPortalService = {
  async getStudentPortalData(): Promise<ServiceResult<StudentPortalData>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_student_portal_data');
      if (error) {
        return { data: null, error: error.message || 'Failed to load student records.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || typeof payload.linked !== 'boolean') {
        return { data: null, error: 'Unexpected student portal response from database.' };
      }

      if (!payload.linked) {
        return {
          data: {
            linked: false,
            student: null,
            attendance: [],
            grades: [],
          },
          error: null,
        };
      }

      const studentResult = validateStudentCardSummary(payload.student);
      if (studentResult.error || !studentResult.data) {
        return { data: null, error: studentResult.error || 'Invalid student card in database response.' };
      }

      const attendanceResult = validateAttendanceList(payload.attendance);
      if (attendanceResult.error || !attendanceResult.data) {
        return { data: null, error: attendanceResult.error || 'Invalid attendance list in database response.' };
      }

      const gradesResult = validateGradesList(payload.grades);
      if (gradesResult.error || !gradesResult.data) {
        return { data: null, error: gradesResult.error || 'Invalid grades list in database response.' };
      }

      return {
        data: {
          linked: true,
          student: studentResult.data,
          attendance: attendanceResult.data,
          grades: gradesResult.data,
        },
        error: null,
      };
    } catch (err: any) {
      return {
        data: null,
        error: err?.message || 'Unable to contact database while loading student portal.',
      };
    }
  },
};
