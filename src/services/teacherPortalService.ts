import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { GradeRecord, StudentStatus } from '../types/database';
import type { ServiceResult } from './adminService';
import { getCairoDateString } from './attendanceService';
import {
  ASSIGNMENT_ATTACHMENT_BUCKET,
  buildAssignmentAttachmentPath,
  getAuthorizedAttachmentDownloadUrl,
  getAuthorizedSubmissionAttachmentDownloadUrl,
  validateAssignmentPdfFile,
} from './assignmentAttachmentService';
import {
  parseAssignmentGradeSummary,
  parseRpcPayload as parsePortalRpcPayload,
  validateAssignmentsList,
  validateTeacherAssignmentSubmissions,
  type AssignmentGradeSummary,
  type AssignmentItem,
  type TeacherAssignmentSubmission,
} from './portalPayloadValidation';

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

function parseRpcPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

function getErrMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
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

function mapGradeRow(rawInput: unknown): TeacherStudentGrade {
  const raw = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;
  return {
    id: String(raw.id || ''),
    student_id: String(raw.student_id || ''),
    group_id: String(raw.group_id || ''),
    teacher_id: String(raw.teacher_id || ''),
    author_name: String(raw.author_name || ''),
    assessment_title: String(raw.assessment_title || ''),
    grade_type: normalizeGradeType(raw.grade_type),
    score: Number(raw.score ?? 0),
    max_score: Number(raw.max_score ?? 100),
    assessment_date: String(raw.assessment_date || ''),
    remarks: String(raw.remarks || ''),
    created_at: String(raw.created_at || ''),
  };
}

function mapNoteRow(rawInput: unknown): TeacherStudentNote {
  const raw = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;
  return {
    id: String(raw.id || ''),
    student_id: String(raw.student_id || ''),
    teacher_id: String(raw.teacher_id || ''),
    author_name: String(raw.author_name || ''),
    feedback_text: String(raw.feedback_text || ''),
    is_parent_visible: Boolean(raw.is_parent_visible),
    note_date: String(raw.note_date || ''),
    created_at: String(raw.created_at || ''),
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

      const rawTeacher =
        payload.teacher && typeof payload.teacher === 'object'
          ? (payload.teacher as Record<string, unknown>)
          : null;
      const teacher: TeacherPortalSummary | null = rawTeacher
        ? {
            id: String(rawTeacher.id || ''),
            full_name: String(rawTeacher.full_name || ''),
            subject: String(rawTeacher.subject || ''),
          }
        : null;

      const rawGroups = Array.isArray(payload.groups) ? payload.groups : [];
      const groups: TeacherAssignedGroup[] = rawGroups.map((item) => {
        const g = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          id: String(g.id || ''),
          name: String(g.name || ''),
          grade_level: String(g.grade_level || ''),
          student_count: Number.isFinite(Number(g.student_count)) ? Number(g.student_count) : 0,
        };
      });

      return {
        data: {
          linked: true,
          teacher,
          groups,
        },
        error: null,
      };
    } catch (err: unknown) {
      return {
        data: null,
        error: getErrMessage(err, 'Unable to contact database while loading teacher groups.'),
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
      const rawGroup =
        payload?.group && typeof payload.group === 'object'
          ? (payload.group as Record<string, unknown>)
          : null;
      if (!payload || !rawGroup || !Array.isArray(payload.students)) {
        return { data: null, error: 'Unexpected group roster response from database.' };
      }

      const students: TeacherRosterStudent[] = payload.students.map((item) => {
        const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          id: String(s.id || ''),
          full_name: String(s.full_name || ''),
          student_code: String(s.student_code || ''),
          status: normalizeStudentStatus(s.status),
          group_id: String(s.group_id || rawGroup.id || trimmedGroupId),
        };
      });

      return {
        data: {
          group: {
            id: String(rawGroup.id || trimmedGroupId),
            name: String(rawGroup.name || ''),
            grade_level: String(rawGroup.grade_level || ''),
          },
          students,
        },
        error: null,
      };
    } catch (err: unknown) {
      return {
        data: null,
        error: getErrMessage(err, 'Unable to contact database while loading group roster.'),
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
      const rawStudent =
        payload?.student && typeof payload.student === 'object'
          ? (payload.student as Record<string, unknown>)
          : null;
      if (!payload || !rawStudent || !Array.isArray(payload.grades) || !Array.isArray(payload.notes)) {
        return { data: null, error: 'Unexpected student records response from database.' };
      }

      const student: TeacherRosterStudent = {
        id: String(rawStudent.id || trimmedStudentId),
        full_name: String(rawStudent.full_name || ''),
        student_code: String(rawStudent.student_code || ''),
        status: normalizeStudentStatus(rawStudent.status),
        group_id: String(rawStudent.group_id || trimmedGroupId),
      };

      return {
        data: {
          student,
          grades: payload.grades.map(mapGradeRow),
          notes: payload.notes.map(mapNoteRow),
        },
        error: null,
      };
    } catch (err: unknown) {
      return {
        data: null,
        error: getErrMessage(err, 'Unable to contact database while loading student records.'),
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
    } catch (err: unknown) {
      return { data: null, error: getErrMessage(err, 'Failed to save grade.') };
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
    } catch (err: unknown) {
      return { data: null, error: getErrMessage(err, 'Failed to save teacher note.') };
    }
  },

  async getTeacherAssignments(groupId: string): Promise<ServiceResult<AssignmentItem[]>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedGroupId = groupId.trim();
    if (!UUID_REGEX.test(trimmedGroupId)) {
      return { data: null, error: 'Invalid group identifier.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_teacher_assignments', {
        p_group_id: trimmedGroupId,
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to load assignments.' };
      }

      const payload = parsePortalRpcPayload(data);
      if (!payload) {
        return { data: null, error: 'Unexpected assignments response from database.' };
      }

      return validateAssignmentsList(payload.assignments);
    } catch (err: unknown) {
      return { data: null, error: getErrMessage(err, 'Unable to load group assignments.') };
    }
  },

  async createTeacherAssignment(input: {
    groupId: string;
    title: string;
    instructions: string;
    dueAtIso: string;
    attachmentFile?: File | null;
  }): Promise<ServiceResult<AssignmentItem>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedGroupId = input.groupId.trim();
    if (!UUID_REGEX.test(trimmedGroupId)) {
      return { data: null, error: 'Invalid group identifier.' };
    }

    const title = input.title.trim();
    if (!title) {
      return { data: null, error: 'Assignment title is required.' };
    }

    const instructions = input.instructions.trim();
    if (!instructions) {
      return { data: null, error: 'Assignment instructions are required.' };
    }

    const dueDate = new Date(input.dueAtIso);
    if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
      return { data: null, error: 'Due date and time must be in the future.' };
    }

    let uploadedPath: string | null = null;
    const attachmentFile = input.attachmentFile ?? null;
    if (attachmentFile) {
      const check = validateAssignmentPdfFile(attachmentFile);
      if (!check.valid) {
        if (check.errorCode === 'TOO_LARGE') {
          return { data: null, error: 'Attachment exceeds the 5 MB limit.' };
        }
        return { data: null, error: 'Only valid non-empty PDF files are allowed.' };
      }

      const objectPath = buildAssignmentAttachmentPath(trimmedGroupId);
      try {
        const { error: uploadError } = await supabase.storage
          .from(ASSIGNMENT_ATTACHMENT_BUCKET)
          .upload(objectPath, attachmentFile, {
            contentType: 'application/pdf',
            upsert: false,
          });
        if (uploadError) {
          return {
            data: null,
            error: `ATTACHMENT_UPLOAD_FAILED: ${uploadError.message || 'Failed to upload PDF attachment.'}`,
          };
        }
        uploadedPath = objectPath;
      } catch (uploadErr: unknown) {
        return {
          data: null,
          error: `ATTACHMENT_UPLOAD_FAILED: ${getErrMessage(uploadErr, 'Failed to upload PDF attachment.')}`,
        };
      }
    }

    try {
      const rpcParams: Record<string, unknown> = {
        p_group_id: trimmedGroupId,
        p_title: title,
        p_instructions: instructions,
        p_due_at: dueDate.toISOString(),
      };
      if (attachmentFile && uploadedPath) {
        rpcParams.p_attachment_path = uploadedPath;
        rpcParams.p_attachment_name = attachmentFile.name;
        rpcParams.p_attachment_size = attachmentFile.size;
        rpcParams.p_attachment_mime_type = 'application/pdf';
      }

      const { data, error } = await supabase.rpc('create_teacher_assignment', rpcParams);

      if (error) {
        if (uploadedPath) {
          await supabase.storage.from(ASSIGNMENT_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        return { data: null, error: error.message || 'Failed to publish assignment.' };
      }

      const payload = parsePortalRpcPayload(data);
      if (!payload || !payload.assignment) {
        if (uploadedPath) {
          await supabase.storage.from(ASSIGNMENT_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        return { data: null, error: 'Assignment confirmation was not returned by database.' };
      }

      const validated = validateAssignmentsList([payload.assignment]);
      if (validated.error || !validated.data || validated.data.length === 0) {
        if (uploadedPath) {
          await supabase.storage.from(ASSIGNMENT_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        return { data: null, error: validated.error || 'Malformed assignment confirmation.' };
      }

      return { data: validated.data[0], error: null };
    } catch (err: unknown) {
      if (uploadedPath) {
        await supabase.storage.from(ASSIGNMENT_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
      }
      return { data: null, error: getErrMessage(err, 'Failed to publish assignment.') };
    }
  },

  async openAssignmentAttachment(
    attachmentId: string
  ): Promise<ServiceResult<{ signedUrl: string; fileName: string }>> {
    return getAuthorizedAttachmentDownloadUrl(attachmentId);
  },

  async openSubmissionAttachment(
    attachmentId: string
  ): Promise<ServiceResult<{ signedUrl: string; fileName: string }>> {
    return getAuthorizedSubmissionAttachmentDownloadUrl(attachmentId);
  },

  async updateTeacherAssignment(input: {
    assignmentId: string;
    title: string;
    instructions: string;
    dueAtIso: string;
    expectedVersion: number;
  }): Promise<
    ServiceResult<{
      saved: boolean;
      conflict: boolean;
      assignment: AssignmentItem;
    }>
  > {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedId = input.assignmentId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return { data: null, error: 'Invalid assignment identifier.' };
    }

    const title = input.title.trim();
    if (!title) {
      return { data: null, error: 'Assignment title is required.' };
    }

    const instructions = input.instructions.trim();
    if (!instructions) {
      return { data: null, error: 'Assignment instructions are required.' };
    }

    const dueDate = new Date(input.dueAtIso);
    if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
      return { data: null, error: 'Due date and time must be in the future.' };
    }

    try {
      const { data, error } = await supabase.rpc('update_teacher_assignment', {
        p_assignment_id: trimmedId,
        p_title: title,
        p_instructions: instructions,
        p_due_at: dueDate.toISOString(),
        p_expected_version: input.expectedVersion,
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to update assignment.' };
      }

      const payload = parsePortalRpcPayload(data);
      if (!payload || !payload.assignment) {
        return { data: null, error: 'Assignment update confirmation was not returned by database.' };
      }

      const validated = validateAssignmentsList([payload.assignment]);
      if (validated.error || !validated.data || validated.data.length === 0) {
        return { data: null, error: validated.error || 'Malformed assignment update confirmation.' };
      }

      return {
        data: {
          saved: payload.saved === true,
          conflict: payload.conflict === true,
          assignment: validated.data[0],
        },
        error: null,
      };
    } catch (err: unknown) {
      return { data: null, error: getErrMessage(err, 'Failed to update assignment.') };
    }
  },

  async getTeacherAssignmentSubmissions(
    assignmentId: string
  ): Promise<
    ServiceResult<{
      assignmentTitle: string;
      groupName: string;
      canGrade: boolean;
      dueAt: string;
      submissions: TeacherAssignmentSubmission[];
    }>
  > {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedId = assignmentId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return { data: null, error: 'Invalid assignment identifier.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_teacher_assignment_submissions', {
        p_assignment_id: trimmedId,
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to load submissions.' };
      }

      const payload = parsePortalRpcPayload(data);
      if (!payload) {
        return { data: null, error: 'Unexpected submissions response from database.' };
      }

      const rawMeta = (payload.assignment && typeof payload.assignment === 'object'
        ? payload.assignment
        : {}) as Record<string, unknown>;

      const validated = validateTeacherAssignmentSubmissions(payload.submissions);
      if (validated.error || !validated.data) {
        return { data: null, error: validated.error || 'Malformed submissions payload.' };
      }

      return {
        data: {
          assignmentTitle: typeof rawMeta.title === 'string' ? rawMeta.title : '',
          groupName: typeof rawMeta.group_name === 'string' ? rawMeta.group_name : '',
          canGrade: Boolean(rawMeta.can_grade),
          dueAt: typeof rawMeta.due_at === 'string' ? rawMeta.due_at : '',
          submissions: validated.data,
        },
        error: null,
      };
    } catch (err: unknown) {
      return { data: null, error: getErrMessage(err, 'Unable to load assignment submissions.') };
    }
  },

  async gradeAssignmentSubmission(input: {
    submissionId: string;
    score: number;
    maxScore: number;
    expectedGradeVersion: number | null;
  }): Promise<
    ServiceResult<{
      saved: boolean;
      conflict: boolean;
      grade: AssignmentGradeSummary | null;
    }>
  > {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const trimmedId = input.submissionId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return { data: null, error: 'Invalid submission identifier.' };
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
        error: 'Invalid score: expected 0 <= score <= maximum, with 0 < maximum < 1000.',
      };
    }

    try {
      const { data, error } = await supabase.rpc('grade_assignment_submission', {
        p_submission_id: trimmedId,
        p_score: input.score,
        p_max_score: input.maxScore,
        p_expected_grade_version: input.expectedGradeVersion,
      });

      if (error) {
        return { data: null, error: error.message || 'Failed to save assignment grade.' };
      }

      const payload = parsePortalRpcPayload(data);
      if (!payload || typeof payload.saved !== 'boolean' || typeof payload.conflict !== 'boolean') {
        return { data: null, error: 'Unexpected grading response from database.' };
      }

      return {
        data: {
          saved: payload.saved,
          conflict: payload.conflict,
          grade: parseAssignmentGradeSummary(payload.grade),
        },
        error: null,
      };
    } catch (err: unknown) {
      return { data: null, error: getErrMessage(err, 'Failed to save assignment grade.') };
    }
  },
};
