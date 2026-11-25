import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { AttendanceStatus, GradeRecord } from '../types/database';
import type { ServiceResult } from './adminService';
import {
  buildSubmissionAttachmentPath,
  getAuthorizedAttachmentDownloadUrl,
  getAuthorizedSubmissionAttachmentDownloadUrl,
  SUBMISSION_ATTACHMENT_BUCKET,
  validateAssignmentPdfFile,
} from './assignmentAttachmentService';
import type { VerifiedStudentStatus } from './teacherPortalService';
import {
  parseAssignmentAttachment,
  parseRpcPayload,
  validateAssignmentsList,
  validateAttendanceList,
  validateGradesList,
  validateStudentCardSummary,
  type AssignmentItem,
  type AssignmentSubmissionItem,
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

export interface SubmitAssignmentResult {
  saved: boolean;
  conflict: boolean;
  submission: AssignmentSubmissionItem | null;
  latestAssignment?: {
    id: string;
    title: string;
    instructions: string;
    due_at: string;
    assignment_version: number;
    is_past_due: boolean;
  };
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
    } catch (err: unknown) {
      return {
        data: null,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unable to contact database while loading student portal.',
      };
    }
  },

  async getStudentAssignments(): Promise<ServiceResult<{ linked: boolean; assignments: AssignmentItem[] }>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_student_assignments');
      if (error) {
        return { data: null, error: error.message || 'Failed to load student assignments.' };
      }

      const payload = parseRpcPayload(data);
      if (!payload || typeof payload.linked !== 'boolean') {
        return { data: null, error: 'Unexpected student assignments response from database.' };
      }

      if (!payload.linked) {
        return { data: { linked: false, assignments: [] }, error: null };
      }

      const validated = validateAssignmentsList(payload.assignments);
      if (validated.error || !validated.data) {
        return { data: null, error: validated.error || 'Invalid assignments list in database response.' };
      }

      return { data: { linked: true, assignments: validated.data }, error: null };
    } catch (err: unknown) {
      return {
        data: null,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unable to contact database while loading student assignments.',
      };
    }
  },

  async submitStudentAssignment(
    assignmentId: string,
    answerText: string,
    options?: {
      studentId?: string;
      attachmentFile?: File | null;
      hasExistingAttachment?: boolean;
      expectedAssignmentVersion?: number | null;
    }
  ): Promise<ServiceResult<SubmitAssignmentResult>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }

    const cleanAnswer = answerText.trim();
    const attachmentFile = options?.attachmentFile ?? null;
    const hasExistingAttachment = Boolean(options?.hasExistingAttachment);

    if (!cleanAnswer && !attachmentFile && !hasExistingAttachment) {
      return { data: null, error: 'Please enter an answer or attach a PDF file.' };
    }

    let uploadedPath: string | null = null;
    if (attachmentFile) {
      const check = validateAssignmentPdfFile(attachmentFile);
      if (!check.valid) {
        if (check.errorCode === 'TOO_LARGE') {
          return { data: null, error: 'Attachment exceeds the 5 MB limit.' };
        }
        return { data: null, error: 'Only valid non-empty PDF files are allowed.' };
      }

      const studentId = options?.studentId?.trim();
      if (!studentId) {
        return { data: null, error: 'Student profile identifier is required to upload PDF.' };
      }

      const objectPath = buildSubmissionAttachmentPath(studentId, assignmentId);
      try {
        const { error: uploadError } = await supabase.storage
          .from(SUBMISSION_ATTACHMENT_BUCKET)
          .upload(objectPath, attachmentFile, {
            contentType: 'application/pdf',
            upsert: false,
          });
        if (uploadError) {
          return {
            data: null,
            error: `SUBMISSION_UPLOAD_FAILED: ${uploadError.message || 'Failed to upload submission PDF.'}`,
          };
        }
        uploadedPath = objectPath;
      } catch (uploadErr: unknown) {
        return {
          data: null,
          error: `SUBMISSION_UPLOAD_FAILED: ${uploadErr instanceof Error ? uploadErr.message : 'Failed to upload submission PDF.'}`,
        };
      }
    }

    try {
      const rpcParams: Record<string, unknown> = {
        p_assignment_id: assignmentId,
        p_answer_text: cleanAnswer || null,
        p_expected_assignment_version: options?.expectedAssignmentVersion ?? null,
      };
      if (attachmentFile && uploadedPath) {
        rpcParams.p_attachment_path = uploadedPath;
        rpcParams.p_attachment_name = attachmentFile.name;
        rpcParams.p_attachment_size = attachmentFile.size;
        rpcParams.p_attachment_mime_type = 'application/pdf';
      }

      const { data, error } = await supabase.rpc('submit_student_assignment', rpcParams);

      if (error) {
        if (uploadedPath) {
          await supabase.storage.from(SUBMISSION_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        return { data: null, error: error.message || 'Failed to submit assignment.' };
      }

      const payload = parseRpcPayload(data);
      if (payload?.conflict === true && payload.assignment && typeof payload.assignment === 'object') {
        if (uploadedPath) {
          await supabase.storage.from(SUBMISSION_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        const a = payload.assignment as Record<string, unknown>;
        return {
          data: {
            saved: false,
            conflict: true,
            submission: null,
            latestAssignment: {
              id: typeof a.id === 'string' ? a.id : assignmentId,
              title: typeof a.title === 'string' ? a.title : '',
              instructions: typeof a.instructions === 'string' ? a.instructions : '',
              due_at: typeof a.due_at === 'string' ? a.due_at : '',
              assignment_version:
                typeof a.assignment_version === 'number' ? a.assignment_version : 1,
              is_past_due: a.is_past_due === true,
            },
          },
          error: null,
        };
      }

      const rawSub = payload?.submission as Record<string, unknown> | undefined;
      const parsedAttachment = parseAssignmentAttachment(rawSub?.attachment);
      const hasAnswer = typeof rawSub?.answer_text === 'string' && rawSub.answer_text.trim().length > 0;
      if (
        !rawSub ||
        typeof rawSub.id !== 'string' ||
        (!hasAnswer && !parsedAttachment) ||
        typeof rawSub.submitted_at !== 'string' ||
        typeof rawSub.updated_at !== 'string'
      ) {
        if (uploadedPath) {
          await supabase.storage.from(SUBMISSION_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        return { data: null, error: 'Submission confirmation was not returned by database.' };
      }

      const previousObjectPath =
        typeof payload?.previous_object_path === 'string' ? payload.previous_object_path : null;
      if (previousObjectPath && uploadedPath && previousObjectPath !== uploadedPath) {
        await supabase.storage.from(SUBMISSION_ATTACHMENT_BUCKET).remove([previousObjectPath]).catch(() => {});
      }

      return {
        data: {
          saved: true,
          conflict: false,
          submission: {
            id: rawSub.id,
            answer_text: hasAnswer ? (rawSub.answer_text as string) : null,
            submitted_at: rawSub.submitted_at,
            updated_at: rawSub.updated_at,
            attachment: parsedAttachment,
          },
        },
        error: null,
      };
    } catch (err: unknown) {
      if (uploadedPath) {
        await supabase.storage.from(SUBMISSION_ATTACHMENT_BUCKET).remove([uploadedPath]).catch(() => {});
      }
      return {
        data: null,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unable to submit assignment answer.',
      };
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
};
