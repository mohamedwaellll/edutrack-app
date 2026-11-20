import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { GradeRecord, TeacherFeedback } from '../types/database';
import type { ServiceResult } from './adminService';
import { getCairoDateString } from './attendanceService';

export interface CreateGradeInput {
  student_id: string;
  class_id: string;
  assessment_title: string;
  score: number;
  max_score: number;
  date: string;
  type: GradeRecord['type'];
  notes?: string;
}
export interface CreateFeedbackInput {
  teacher_id: string;
  student_id: string;
  feedback_text: string;
  is_parent_visible: boolean;
}
const gradeSelection = '*, students(full_name), groups(name, subject)';
const feedbackSelection = '*, teachers(full_name), students(full_name)';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = <T>(error: string): ServiceResult<T> => ({ data: null, error });
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to contact the database. Please try again.';
interface GradeRow {
  id: string; student_id: string; group_id: string; assessment_title: string;
  score: number | string; max_score: number | string; assessment_date: string;
  grade_type: GradeRecord['type']; remarks: string | null;
  students: { full_name: string } | null;
  groups: { name: string; subject: string | null } | null;
}
interface FeedbackRow {
  id: string; teacher_id: string; student_id: string; feedback_text: string;
  is_parent_visible: boolean; created_at: string;
  teachers: { full_name: string } | null; students: { full_name: string } | null;
}
const toGrade = (row: GradeRow): GradeRecord => ({
  id: row.id, student_id: row.student_id, student_name: row.students?.full_name ?? 'Unknown student',
  class_id: row.group_id, class_name: row.groups?.name ?? 'Unknown group', subject: row.groups?.subject ?? '',
  assessment_title: row.assessment_title, score: Number(row.score), max_score: Number(row.max_score),
  date: row.assessment_date, type: row.grade_type, notes: row.remarks ?? '',
});
const toFeedback = (row: FeedbackRow): TeacherFeedback => ({
  id: row.id, teacher_id: row.teacher_id, teacher_name: row.teachers?.full_name ?? 'Unknown teacher',
  student_id: row.student_id, student_name: row.students?.full_name ?? 'Unknown student',
  feedback_text: row.feedback_text, is_parent_visible: row.is_parent_visible,
  date: getCairoDateString(new Date(row.created_at)),
});
export const teacherService = {
  async getGrades(classId?: string): Promise<ServiceResult<GradeRecord[]>> {
    if (!isSupabaseConfigured()) return failure('Supabase is not configured.');
    try {
      let query = supabase.from('grades').select(gradeSelection).order('assessment_date', { ascending: false });
      if (classId) query = query.eq('group_id', classId);
      const { data, error } = await query;
      if (error) return failure(error.message);
      return { data: ((data ?? []) as GradeRow[]).map(toGrade), error: null };
    } catch (error) { return failure(message(error)); }
  },
  async addGrade(grade: CreateGradeInput): Promise<ServiceResult<GradeRecord>> {
    if (!isSupabaseConfigured()) return failure('Supabase is not configured.');
    if (!uuid.test(grade.student_id) || !uuid.test(grade.class_id)) return failure('Select a valid student and group.');
    if (!grade.assessment_title.trim()) return failure('Assessment title is required.');
    if (!Number.isFinite(grade.score) || !Number.isFinite(grade.max_score) || grade.max_score <= 0 ||
        grade.max_score > 999.99 || grade.score < 0 || grade.score > grade.max_score) {
      return failure('Score must be between 0 and the maximum. Maximum must be greater than 0 and at most 999.99.');
    }
    if (!['exam', 'quiz', 'assignment', 'participation'].includes(grade.type)) return failure('Invalid assessment category.');
    const parsed = new Date(`${grade.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(grade.date) || !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== grade.date || grade.date > getCairoDateString()) {
      return failure('Choose a valid assessment date no later than today in Cairo.');
    }
    try {
      const { data, error } = await supabase.from('grades').insert({
        student_id: grade.student_id, group_id: grade.class_id,
        assessment_title: grade.assessment_title.trim(), grade_type: grade.type,
        score: grade.score, max_score: grade.max_score, assessment_date: grade.date,
        remarks: grade.notes?.trim() || null,
      }).select(gradeSelection).single();
      if (error) return failure(error.message);
      if (!data) return failure('The database did not return the saved grade. Refresh before retrying.');
      return { data: toGrade(data as GradeRow), error: null };
    } catch (error) { return failure(message(error)); }
  },
  async getFeedback(studentId?: string): Promise<ServiceResult<TeacherFeedback[]>> {
    if (!isSupabaseConfigured()) return failure('Supabase is not configured.');
    try {
      let query = supabase.from('teacher_notes').select(feedbackSelection).order('created_at', { ascending: false });
      if (studentId) query = query.eq('student_id', studentId);
      const { data, error } = await query;
      if (error) return failure(error.message);
      return { data: ((data ?? []) as FeedbackRow[]).map(toFeedback), error: null };
    } catch (error) { return failure(message(error)); }
  },
  async addFeedback(feedback: CreateFeedbackInput): Promise<ServiceResult<TeacherFeedback>> {
    if (!isSupabaseConfigured()) return failure('Supabase is not configured.');
    if (!uuid.test(feedback.student_id) || !uuid.test(feedback.teacher_id)) return failure('Select a valid student and teacher.');
    if (!feedback.feedback_text.trim()) return failure('Feedback text is required.');
    if (typeof feedback.is_parent_visible !== 'boolean') return failure('Choose feedback visibility.');
    try {
      const { data, error } = await supabase.from('teacher_notes').insert({
        student_id: feedback.student_id, teacher_id: feedback.teacher_id,
        feedback_text: feedback.feedback_text.trim(), is_parent_visible: feedback.is_parent_visible,
      }).select(feedbackSelection).single();
      if (error) return failure(error.message);
      if (!data) return failure('The database did not return the saved feedback. Refresh before retrying.');
      return { data: toFeedback(data as FeedbackRow), error: null };
    } catch (error) { return failure(message(error)); }
  },
};
