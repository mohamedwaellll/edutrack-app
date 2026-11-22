import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { GradeRecord, StudentStatus } from '../types/database';
import type { ServiceResult } from './adminService';
import { getCairoDateString } from './attendanceService';

export type VerifiedStudentStatus = StudentStatus | 'unknown';
export type TeacherGradeCategory = GradeRecord['type'];

export interface TeacherPortalSummary {
  id: string;
  full_name: string;
  subject: string;
}

export interface TeacherAssignedGroup {
  id: string;
  name: string;
  grade_level: string;
  student_count: number;
}

export interface TeacherPortalContext {
  linked: boolean;
  teacher: TeacherPortalSummary | null;
  groups: TeacherAssignedGroup[];
}

export interface TeacherRosterStudent {
  id: string;
  full_name: string;
  student_code: string;
  status: VerifiedStudentStatus;
  group_id: string;
}

export interface TeacherGroupRosterResult {
  group: {
    id: string;
    name: string;
    grade_level: string;
  };
  students: TeacherRosterStudent[];
}

export interface TeacherStudentGrade {
  id: string;
  student_id: string;
  group_id: string;
  teacher_id: string;
  author_name: string;
  assessment_title: string;
  grade_type: TeacherGradeCategory;
  score: number;
  max_score: number;
  assessment_date: string;
  remarks: string;
  created_at: string;
}

export interface TeacherStudentNote {
  id: string;
  student_id: string;
  teacher_id: string;
  author_name: string;
  feedback_text: string;
  is_parent_visible: boolean;
  note_date: string;
  created_at: string;
}

export interface TeacherStudentRecordsResult {
  student: TeacherRosterStudent;
  grades: TeacherStudentGrade[];
  notes: TeacherStudentNote[];
}

export interface SaveTeacherGradeInput {
  groupId: string;
  studentId: string;
  assessmentTitle: string;
  gradeType: TeacherGradeCategory;
  score: number;
  maxScore: number;
  assessmentDate: string;
  notes?: string;
}

export interface SaveTeacherNoteInput {
  groupId: string;
  studentId: string;
  feedbackText: string;
  isParentVisible: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRpcPayload(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, any>) : null;
}

export function normalizeStudentStatus(status: unknown): VerifiedStudentStatus {
  if (status === 'active' || status === 'suspended' || status === 'graduated') {
    return status;
  }
  return 'unknown';
}

const VALID_GRADE_TYPES: ReadonlySet<string> = new Set([
  'exam',
  'quiz',
  'assignment',
  'participation',
]);

function normalizeGradeType(value: unknown): TeacherGradeCategory {
  if (typeof value === 'string' && VALID_GRADE_TYPES.has(value)) {
    return value as TeacherGradeCategory;
  }
  return 'exam';
}

function mapGradeRow(raw: any): TeacherStudentGrade {
  return {
    id: String(raw?.id || ''),
    student_id: String(raw?.student_id || ''),
    group_id: String(raw?.group_id || ''),
    teacher_id: String(raw?.teacher_id || ''),
    author_name: String(raw?.author_name || ''),
    assessment_title: String(raw?.assessment_title || ''),
    grade_type: normalizeGradeType(raw?.grade_type),
    score: Number(raw?.score ?? 0),
    max_score: Number(raw?.max_score ?? 100),
    assessment_date: String(raw?.assessment_date || ''),
    remarks: String(raw?.remarks || ''),
    created_at: String(raw?.created_at || ''),
  };
}

function mapNoteRow(raw: any): TeacherStudentNote {
  return {
    id: String(raw?.id || ''),
    student_id: String(raw?.student_id || ''),
    teacher_id: String(raw?.teacher_id || ''),
    author_name: String(raw?.author_name || ''),
    feedback_text: String(raw?.feedback_text || ''),
    is_parent_visible: Boolean(raw?.is_parent_visible),
    note_date: String(raw?.note_date || ''),
    created_at: String(raw?.created_at || ''),
  };
}

/**
 * Read-only Stage C.1 service for verified teacher accounts.
 * Identity is always derived server-side via auth.uid(); no teacherId is accepted from client code.
 */
export const teacherPortalService = {
  async getTeacherPortalContext(): Promise<ServiceResult<TeacherPortalContext>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_teacher_portal_context');
      if (error) {
        return { data: null, error: error.message || 'Failed to load teacher portal.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || typeof payload.linked !== 'boolean') {
        return { data: null, error: 'Unexpected teacher portal response from database.' };
      }

      if (!payload.linked) {
        return {
          data: {
            linked: false,
            teacher: null,
            groups: [],
          },
          error: null,
        };
      }

      const rawTeacher = payload.teacher;
      const teacher: TeacherPortalSummary | null =
        rawTeacher && typeof rawTeacher === 'object'
          ? {
              id: String(rawTeacher.id || ''),
              full_name: String(rawTeacher.full_name || ''),
              subject: String(rawTeacher.subject || ''),
            }
          : null;

      const rawGroups = Array.isArray(payload.groups) ? payload.groups : [];
      const groups: TeacherAssignedGroup[] = rawGroups.map((g: any) => ({
        id: String(g.id || ''),
        name: String(g.name || ''),
        grade_level: String(g.grade_level || ''),
        student_count: Number.isFinite(Number(g.student_count)) ? Number(g.student_count) : 0,
      }));

      return {
        data: {
          linked: true,
          teacher,
          groups,
        },
        error: null,
      };
    } catch (err: any) {
      return {
        data: null,
        error: err?.message || 'Unable to contact database while loading teacher groups.',
      };
    }
  },

  async getTeacherGroupStudents(groupId: string): Promise<ServiceResult<TeacherGroupRosterResult>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedGroupId = groupId.trim();
    if (!UUID_REGEX.test(trimmedGroupId)) {
      return { data: null, error: 'Invalid class group identifier.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_teacher_group_students', {
        p_group_id: trimmedGroupId,
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to load students for this group.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || !payload.group || !Array.isArray(payload.students)) {
        return { data: null, error: 'Unexpected group roster response from database.' };
      }

      const students: TeacherRosterStudent[] = payload.students.map((s: any) => ({
        id: String(s.id || ''),
        full_name: String(s.full_name || ''),
        student_code: String(s.student_code || ''),
        status: normalizeStudentStatus(s.status),
        group_id: String(s.group_id || payload.group.id || trimmedGroupId),
      }));

      return {
        data: {
          group: {
            id: String(payload.group.id || trimmedGroupId),
            name: String(payload.group.name || ''),
            grade_level: String(payload.group.grade_level || ''),
          },
          students,
        },
        error: null,
      };
    } catch (err: any) {
      return {
        data: null,
        error: err?.message || 'Unable to contact database while loading group roster.',
      };
    }
  },

  async getTeacherStudentRecords(
    groupId: string,
    studentId: string
  ): Promise<ServiceResult<TeacherStudentRecordsResult>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedGroupId = groupId.trim();
    const trimmedStudentId = studentId.trim();
    if (!UUID_REGEX.test(trimmedGroupId) || !UUID_REGEX.test(trimmedStudentId)) {
      return { data: null, error: 'Invalid group or student identifier.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_teacher_student_records', {
        p_group_id: trimmedGroupId,
        p_student_id: trimmedStudentId,
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to load saved student records.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || !payload.student || !Array.isArray(payload.grades) || !Array.isArray(payload.notes)) {
        return { data: null, error: 'Unexpected student records response from database.' };
      }

      const student: TeacherRosterStudent = {
        id: String(payload.student.id || trimmedStudentId),
        full_name: String(payload.student.full_name || ''),
        student_code: String(payload.student.student_code || ''),
        status: normalizeStudentStatus(payload.student.status),
        group_id: String(payload.student.group_id || trimmedGroupId),
      };

      return {
        data: {
          student,
          grades: payload.grades.map(mapGradeRow),
          notes: payload.notes.map(mapNoteRow),
        },
        error: null,
      };
    } catch (err: any) {
      return {
        data: null,
        error: err?.message || 'Unable to contact database while loading student records.',
      };
    }
  },

  async saveTeacherStudentGrade(input: SaveTeacherGradeInput): Promise<ServiceResult<TeacherStudentGrade>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedGroupId = input.groupId.trim();
    const trimmedStudentId = input.studentId.trim();
    if (!UUID_REGEX.test(trimmedGroupId) || !UUID_REGEX.test(trimmedStudentId)) {
      return { data: null, error: 'Invalid group or student identifier.' };
    }

    const title = input.assessmentTitle.trim();
    if (!title) {
      return { data: null, error: 'Assessment title is required.' };
    }
    if (!VALID_GRADE_TYPES.has(input.gradeType)) {
      return { data: null, error: 'Invalid assessment type.' };
    }
    if (
      !Number.isFinite(input.score) ||
      !Number.isFinite(input.maxScore) ||
      input.maxScore <= 0 ||
      input.maxScore >= 1000 ||
      input.score < 0 ||
      input.score > input.maxScore
    ) {
      return {
        data: null,
        error: 'Score must satisfy 0 <= score <= maximum score, with 0 < maximum score < 1000.',
      };
    }

    const assessmentDate = input.assessmentDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate) || assessmentDate > getCairoDateString()) {
      return {
        data: null,
        error: 'Assessment date must be valid and must not exceed today (Africa/Cairo).',
      };
    }

    try {
      const { data, error } = await supabase.rpc('save_teacher_student_grade', {
        p_group_id: trimmedGroupId,
        p_student_id: trimmedStudentId,
        p_assessment_title: title,
        p_grade_type: input.gradeType,
        p_score: input.score,
        p_max_score: input.maxScore,
        p_assessment_date: assessmentDate,
        p_notes: input.notes?.trim() || null,
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to save grade.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || !payload.grade) {
        return { data: null, error: 'Grade confirmation was not returned by database.' };
      }

      return { data: mapGradeRow(payload.grade), error: null };
    } catch (err: any) {
      return { data: null, error: err?.message || 'Failed to save grade.' };
    }
  },

  async saveTeacherStudentNote(input: SaveTeacherNoteInput): Promise<ServiceResult<TeacherStudentNote>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedGroupId = input.groupId.trim();
    const trimmedStudentId = input.studentId.trim();
    if (!UUID_REGEX.test(trimmedGroupId) || !UUID_REGEX.test(trimmedStudentId)) {
      return { data: null, error: 'Invalid group or student identifier.' };
    }

    const text = input.feedbackText.trim();
    if (!text) {
      return { data: null, error: 'Note text is required.' };
    }

    try {
      const { data, error } = await supabase.rpc('save_teacher_student_note', {
        p_group_id: trimmedGroupId,
        p_student_id: trimmedStudentId,
        p_feedback_text: text,
        p_is_parent_visible: Boolean(input.isParentVisible),
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to save teacher note.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || !payload.note) {
        return { data: null, error: 'Note confirmation was not returned by database.' };
      }

      return { data: mapNoteRow(payload.note), error: null };
    } catch (err: any) {
      return { data: null, error: err?.message || 'Failed to save teacher note.' };
    }
  },
};
