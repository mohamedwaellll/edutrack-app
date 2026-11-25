import type { AttendanceStatus, GradeRecord } from '../types/database';
import type { ServiceResult } from './adminService';
import { normalizeStudentStatus } from './teacherPortalService';
import type {
  StudentAttendanceItem,
  StudentCardSummary,
  StudentGradeItem,
  StudentGroupSummary,
} from './studentPortalService';

export interface ParentTeacherNoteItem {
  id: string;
  author_name: string;
  feedback_text: string;
  note_date: string;
  created_at: string;
}

const VALID_ATTENDANCE_STATUSES: ReadonlySet<AttendanceStatus> = new Set([
  'Present',
  'Late',
  'Absent',
  'Excused',
]);

const VALID_GRADE_TYPES: ReadonlySet<GradeRecord['type']> = new Set([
  'exam',
  'quiz',
  'assignment',
  'participation',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseFiniteNumeric(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object') {
    return null;
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function parseRpcPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

export function validateStudentCardSummary(rawStudent: unknown): ServiceResult<StudentCardSummary> {
  if (!rawStudent || typeof rawStudent !== 'object') {
    return { data: null, error: 'Missing student card in database response.' };
  }

  const candidate = rawStudent as Record<string, unknown>;
  if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.full_name) || !isNonEmptyString(candidate.student_code)) {
    return { data: null, error: 'Incomplete student card in database response.' };
  }

  let group: StudentGroupSummary | null = null;
  if (candidate.group !== null && candidate.group !== undefined) {
    if (typeof candidate.group !== 'object') {
      return { data: null, error: 'Invalid student group payload in database response.' };
    }
    const rawGroup = candidate.group as Record<string, unknown>;
    if (!isNonEmptyString(rawGroup.id) || !isNonEmptyString(rawGroup.name)) {
      return { data: null, error: 'Incomplete student group summary in database response.' };
    }
    group = {
      id: rawGroup.id,
      name: rawGroup.name,
      grade_level: typeof rawGroup.grade_level === 'string' ? rawGroup.grade_level : '',
    };
  }

  return {
    data: {
      id: candidate.id,
      full_name: candidate.full_name,
      student_code: candidate.student_code,
      grade_level: typeof candidate.grade_level === 'string' ? candidate.grade_level : '',
      status: normalizeStudentStatus(candidate.status),
      group,
    },
    error: null,
  };
}

export function validateAttendanceList(rawAttendance: unknown): ServiceResult<StudentAttendanceItem[]> {
  if (!Array.isArray(rawAttendance)) {
    return { data: null, error: 'Missing attendance list in database response.' };
  }

  const items: StudentAttendanceItem[] = [];
  for (const entry of rawAttendance) {
    if (!entry || typeof entry !== 'object') {
      return { data: null, error: 'Malformed attendance record in database response.' };
    }
    const record = entry as Record<string, unknown>;
    if (!isNonEmptyString(record.id) || !isNonEmptyString(record.date)) {
      return { data: null, error: 'Incomplete attendance record in database response.' };
    }
    if (!VALID_ATTENDANCE_STATUSES.has(record.status as AttendanceStatus)) {
      return {
        data: null,
        error: `Unknown attendance status in database response: ${String(record.status ?? 'missing')}.`,
      };
    }

    let checkInTime: string | null = null;
    if (record.check_in_time !== null && record.check_in_time !== undefined) {
      if (typeof record.check_in_time !== 'string') {
        return { data: null, error: 'Invalid attendance check-in time in database response.' };
      }
      checkInTime = record.check_in_time.trim().length > 0 ? record.check_in_time : null;
    }

    items.push({
      id: record.id,
      date: record.date,
      status: record.status as AttendanceStatus,
      check_in_time: checkInTime,
    });
  }

  return { data: items, error: null };
}

export function validateGradesList(rawGrades: unknown): ServiceResult<StudentGradeItem[]> {
  if (!Array.isArray(rawGrades)) {
    return { data: null, error: 'Missing grades list in database response.' };
  }

  const items: StudentGradeItem[] = [];
  for (const entry of rawGrades) {
    if (!entry || typeof entry !== 'object') {
      return { data: null, error: 'Malformed grade record in database response.' };
    }
    const record = entry as Record<string, unknown>;
    if (
      !isNonEmptyString(record.id) ||
      !isNonEmptyString(record.assessment_title) ||
      !isNonEmptyString(record.assessment_date)
    ) {
      return { data: null, error: 'Incomplete grade record in database response.' };
    }
    if (!VALID_GRADE_TYPES.has(record.grade_type as GradeRecord['type'])) {
      return {
        data: null,
        error: `Unknown grade type in database response: ${String(record.grade_type ?? 'missing')}.`,
      };
    }

    const score = parseFiniteNumeric(record.score);
    const maxScore = parseFiniteNumeric(record.max_score);
    if (
      score === null ||
      score < 0 ||
      maxScore === null ||
      maxScore <= 0 ||
      maxScore >= 1000 ||
      score > maxScore
    ) {
      return {
        data: null,
        error: 'Invalid grade score values in database response (expected 0 <= score <= max_score and 0 < max_score < 1000).',
      };
    }

    items.push({
      id: record.id,
      assessment_title: record.assessment_title,
      grade_type: record.grade_type as GradeRecord['type'],
      score,
      max_score: maxScore,
      assessment_date: record.assessment_date,
    });
  }

  return { data: items, error: null };
}

export function validateParentNotesList(rawNotes: unknown): ServiceResult<ParentTeacherNoteItem[]> {
  if (!Array.isArray(rawNotes)) {
    return { data: null, error: 'Missing teacher notes list in database response.' };
  }

  const items: ParentTeacherNoteItem[] = [];
  for (const entry of rawNotes) {
    if (!entry || typeof entry !== 'object') {
      return { data: null, error: 'Malformed teacher note record in database response.' };
    }
    const record = entry as Record<string, unknown>;
    if (
      !isNonEmptyString(record.id) ||
      !isNonEmptyString(record.author_name) ||
      !isNonEmptyString(record.feedback_text) ||
      !isNonEmptyString(record.created_at)
    ) {
      return { data: null, error: 'Incomplete teacher note record in database response.' };
    }

    const noteDate = isNonEmptyString(record.note_date)
      ? record.note_date
      : record.created_at.slice(0, 10);

    items.push({
      id: record.id,
      author_name: record.author_name,
      feedback_text: record.feedback_text,
      note_date: noteDate,
      created_at: record.created_at,
    });
  }

  return { data: items, error: null };
}

export interface AssignmentGradeSummary {
  id: string;
  score: number;
  max_score: number;
  assessment_date: string;
  updated_at: string;
  grade_version: number;
}

export interface AssignmentSubmissionItem {
  id: string;
  answer_text: string | null;
  submitted_at: string;
  updated_at: string;
  attachment?: AssignmentAttachment | null;
}

export interface AssignmentAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export function parseAssignmentAttachment(rawAtt: unknown): AssignmentAttachment | null {
  if (!rawAtt || typeof rawAtt !== 'object') return null;
  const att = rawAtt as Record<string, unknown>;
  const sizeBytes = parseFiniteNumeric(att.size_bytes);
  if (
    !isNonEmptyString(att.id) ||
    !isNonEmptyString(att.file_name) ||
    !isNonEmptyString(att.mime_type) ||
    sizeBytes === null ||
    sizeBytes <= 0
  ) {
    return null;
  }
  return {
    id: att.id,
    file_name: att.file_name,
    mime_type: att.mime_type,
    size_bytes: Math.trunc(sizeBytes),
  };
}

export interface AssignmentItem {
  id: string;
  group_id: string;
  group_name: string;
  teacher_name?: string;
  title: string;
  instructions: string;
  due_at: string;
  created_at: string;
  assignment_version?: number;
  is_past_due?: boolean;
  attachment?: AssignmentAttachment | null;
  submission?: AssignmentSubmissionItem | null;
  grade?: AssignmentGradeSummary | null;
}

export interface TeacherAssignmentSubmission {
  id: string;
  assignment_id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  answer_text: string | null;
  submitted_at: string;
  updated_at: string;
  attachment?: AssignmentAttachment | null;
  grade?: AssignmentGradeSummary | null;
}

export function parseAssignmentGradeSummary(rawGrade: unknown): AssignmentGradeSummary | null {
  if (!rawGrade || typeof rawGrade !== 'object') return null;
  const g = rawGrade as Record<string, unknown>;
  const score = parseFiniteNumeric(g.score);
  const maxScore = parseFiniteNumeric(g.max_score);
  const rawVersion = parseFiniteNumeric(g.grade_version);
  if (
    !isNonEmptyString(g.id) ||
    score === null ||
    maxScore === null ||
    !isNonEmptyString(g.assessment_date) ||
    !isNonEmptyString(g.updated_at)
  ) {
    return null;
  }
  return {
    id: g.id,
    score,
    max_score: maxScore,
    assessment_date: g.assessment_date,
    updated_at: g.updated_at,
    grade_version: rawVersion !== null && rawVersion >= 1 ? Math.trunc(rawVersion) : 1,
  };
}

export function validateAssignmentsList(rawAssignments: unknown): ServiceResult<AssignmentItem[]> {
  if (!Array.isArray(rawAssignments)) {
    return { data: null, error: 'Invalid assignments list in database response.' };
  }

  const items: AssignmentItem[] = [];
  for (const entry of rawAssignments) {
    if (!entry || typeof entry !== 'object') {
      return { data: null, error: 'Malformed assignment record in database response.' };
    }
    const record = entry as Record<string, unknown>;
    if (
      !isNonEmptyString(record.id) ||
      !isNonEmptyString(record.group_id) ||
      !isNonEmptyString(record.title) ||
      !isNonEmptyString(record.instructions) ||
      !isNonEmptyString(record.due_at) ||
      !isNonEmptyString(record.created_at)
    ) {
      return { data: null, error: 'Incomplete assignment record in database response.' };
    }

    let submission: AssignmentSubmissionItem | null = null;
    if (record.submission && typeof record.submission === 'object') {
      const sub = record.submission as Record<string, unknown>;
      const subAttachment = parseAssignmentAttachment(sub.attachment);
      if (sub.attachment !== undefined && sub.attachment !== null && !subAttachment) {
        return { data: null, error: 'Incomplete submission attachment in database response.' };
      }
      const hasAnswerText = isNonEmptyString(sub.answer_text);
      if (
        !isNonEmptyString(sub.id) ||
        (sub.answer_text !== null && sub.answer_text !== undefined && typeof sub.answer_text !== 'string') ||
        (!hasAnswerText && !subAttachment) ||
        !isNonEmptyString(sub.submitted_at) ||
        !isNonEmptyString(sub.updated_at)
      ) {
        return { data: null, error: 'Incomplete assignment submission in database response.' };
      }
      submission = {
        id: sub.id,
        answer_text: hasAnswerText ? (sub.answer_text as string) : null,
        submitted_at: sub.submitted_at,
        updated_at: sub.updated_at,
        attachment: subAttachment,
      };
    }

    const attachment = parseAssignmentAttachment(record.attachment);
    if (record.attachment !== undefined && record.attachment !== null && !attachment) {
      return { data: null, error: 'Incomplete assignment attachment in database response.' };
    }

    const rawAssignmentVersion = parseFiniteNumeric(record.assignment_version);

    items.push({
      id: record.id,
      group_id: record.group_id,
      group_name: typeof record.group_name === 'string' ? record.group_name : '',
      teacher_name: typeof record.teacher_name === 'string' ? record.teacher_name : undefined,
      title: record.title,
      instructions: record.instructions,
      due_at: record.due_at,
      created_at: record.created_at,
      assignment_version:
        rawAssignmentVersion !== null && rawAssignmentVersion >= 1
          ? Math.trunc(rawAssignmentVersion)
          : 1,
      is_past_due: typeof record.is_past_due === 'boolean' ? record.is_past_due : undefined,
      attachment,
      submission,
      grade: parseAssignmentGradeSummary(record.grade),
    });
  }

  return { data: items, error: null };
}

export function validateTeacherAssignmentSubmissions(
  rawSubmissions: unknown
): ServiceResult<TeacherAssignmentSubmission[]> {
  if (!Array.isArray(rawSubmissions)) {
    return { data: null, error: 'Invalid submissions list in database response.' };
  }

  const items: TeacherAssignmentSubmission[] = [];
  for (const entry of rawSubmissions) {
    if (!entry || typeof entry !== 'object') {
      return { data: null, error: 'Malformed submission record in database response.' };
    }
    const record = entry as Record<string, unknown>;
    const subAttachment = parseAssignmentAttachment(record.attachment);
    if (record.attachment !== undefined && record.attachment !== null && !subAttachment) {
      return { data: null, error: 'Incomplete submission attachment in database response.' };
    }
    const hasAnswerText = isNonEmptyString(record.answer_text);
    if (
      !isNonEmptyString(record.id) ||
      !isNonEmptyString(record.assignment_id) ||
      !isNonEmptyString(record.student_id) ||
      !isNonEmptyString(record.student_name) ||
      !isNonEmptyString(record.student_code) ||
      (record.answer_text !== null && record.answer_text !== undefined && typeof record.answer_text !== 'string') ||
      (!hasAnswerText && !subAttachment) ||
      !isNonEmptyString(record.submitted_at) ||
      !isNonEmptyString(record.updated_at)
    ) {
      return { data: null, error: 'Incomplete submission record in database response.' };
    }

    items.push({
      id: record.id,
      assignment_id: record.assignment_id,
      student_id: record.student_id,
      student_name: record.student_name,
      student_code: record.student_code,
      answer_text: hasAnswerText ? (record.answer_text as string) : null,
      submitted_at: record.submitted_at,
      updated_at: record.updated_at,
      attachment: subAttachment,
      grade: parseAssignmentGradeSummary(record.grade),
    });
  }

  return { data: items, error: null };
}

export function formatCairoDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';
  const hour = getPart('hour') === '24' ? '00' : getPart('hour');
  return `${getPart('year')}-${getPart('month')}-${getPart('day')} ${hour}:${getPart('minute')}`;
}

export function isoToCairoDateTimeLocal(isoString: string): string {
  const formatted = formatCairoDateTime(isoString);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatted) ? formatted.replace(' ', 'T') : '';
}

export function cairoDateTimeLocalToIso(localValue: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue.trim());
  if (!match) return null;

  const [, y, m, d, hh, mm] = match;
  const targetUtcGuess = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0, 0);
  if (Number.isNaN(targetUtcGuess)) return null;

  const guessDate = new Date(targetUtcGuess);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(guessDate);

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value || '0');
  const cairoHour = getPart('hour') === 24 ? 0 : getPart('hour');
  const cairoAsUtc = Date.UTC(
    getPart('year'),
    getPart('month') - 1,
    getPart('day'),
    cairoHour,
    getPart('minute'),
    0,
    0
  );
  const offsetMs = cairoAsUtc - targetUtcGuess;
  return new Date(targetUtcGuess - offsetMs).toISOString();
}


export type ParentChildAssignmentStatus = 'not_submitted' | 'missed' | 'pending_grading' | 'graded';

export interface ParentChildAssignmentItem {
  id: string;
  title: string;
  due_at: string;
  is_past_due: boolean;
  status: ParentChildAssignmentStatus;
  grade: { score: number; max_score: number } | null;
}

const VALID_PARENT_ASSIGNMENT_STATUSES = new Set<ParentChildAssignmentStatus>([
  'not_submitted',
  'missed',
  'pending_grading',
  'graded',
]);

export function validateParentChildAssignments(
  rawAssignments: unknown
): ServiceResult<ParentChildAssignmentItem[]> {
  if (!Array.isArray(rawAssignments)) {
    return { data: null, error: 'Invalid child assignments list in database response.' };
  }

  const items: ParentChildAssignmentItem[] = [];
  for (const entry of rawAssignments) {
    if (!entry || typeof entry !== 'object') {
      return { data: null, error: 'Malformed child assignment record in database response.' };
    }
    const record = entry as Record<string, unknown>;
    if (
      !isNonEmptyString(record.id) ||
      !isNonEmptyString(record.title) ||
      !isNonEmptyString(record.due_at) ||
      typeof record.is_past_due !== 'boolean' ||
      typeof record.status !== 'string' ||
      !VALID_PARENT_ASSIGNMENT_STATUSES.has(record.status as ParentChildAssignmentStatus)
    ) {
      return { data: null, error: 'Incomplete child assignment record in database response.' };
    }

    let grade: { score: number; max_score: number } | null = null;
    if (record.grade && typeof record.grade === 'object') {
      const g = record.grade as Record<string, unknown>;
      const score = parseFiniteNumeric(g.score);
      const maxScore = parseFiniteNumeric(g.max_score);
      if (score === null || maxScore === null || maxScore <= 0) {
        return { data: null, error: 'Malformed child assignment grade in database response.' };
      }
      grade = { score, max_score: maxScore };
    }

    items.push({
      id: record.id,
      title: record.title,
      due_at: record.due_at,
      is_past_due: record.is_past_due,
      status: record.status as ParentChildAssignmentStatus,
      grade,
    });
  }

  return { data: items, error: null };
}
