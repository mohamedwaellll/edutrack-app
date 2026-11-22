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

export function parseRpcPayload(raw: unknown): Record<string, any> | null {
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
