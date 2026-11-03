import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { GradeRecord, TeacherFeedback } from '../types/database';

export const MOCK_GRADES: GradeRecord[] = [
  {
    id: 'g-1',
    student_id: 's-1',
    student_name: 'Lara Hassan',
    class_id: 'cls-1',
    class_name: 'Grade 8A',
    subject: 'Science',
    assessment_title: 'Midterm Science Exam',
    score: 96,
    max_score: 100,
    date: '2026-10-24',
    type: 'exam',
    notes: 'Exceptional mastery of solar system physics',
  },
  {
    id: 'g-2',
    student_id: 's-1',
    student_name: 'Lara Hassan',
    class_id: 'cls-1',
    class_name: 'Grade 8A',
    subject: 'Science',
    assessment_title: 'Lab Experiment #3',
    score: 94,
    max_score: 100,
    date: '2026-10-18',
    type: 'assignment',
    notes: 'Accurate measurements and neat documentation',
  },
  {
    id: 'g-3',
    student_id: 's-2',
    student_name: 'Adam Nabil',
    class_id: 'cls-2',
    class_name: 'Grade 7B',
    subject: 'Mathematics',
    assessment_title: 'Algebra Quiz 2',
    score: 88.5,
    max_score: 100,
    date: '2026-10-22',
    type: 'quiz',
    notes: 'Good conceptual grasp, minor arithmetic error',
  },
  {
    id: 'g-4',
    student_id: 's-3',
    student_name: 'Youssef Ali',
    class_id: 'cls-3',
    class_name: 'Grade 9C',
    subject: 'Science',
    assessment_title: 'Chemistry Lab Report',
    score: 82,
    max_score: 100,
    date: '2026-10-20',
    type: 'assignment',
    notes: 'Needs closer adherence to lab safety rules',
  },
  {
    id: 'g-5',
    student_id: 's-4',
    student_name: 'Mariam Samir',
    class_id: 'cls-1',
    class_name: 'Grade 8A',
    subject: 'Science',
    assessment_title: 'Midterm Science Exam',
    score: 92,
    max_score: 100,
    date: '2026-10-24',
    type: 'exam',
    notes: 'Consistent performance in thermodynamics questions',
  },
];

export const MOCK_TEACHER_FEEDBACK: TeacherFeedback[] = [
  {
    id: 'fb-1',
    teacher_id: 't-1',
    teacher_name: 'Dr. Salma Farid',
    student_id: 's-1',
    student_name: 'Lara Hassan',
    feedback_text: 'Lara is showing wonderful curiosity and steady progress in science. Her class participation has improved.',
    is_parent_visible: true,
    date: '2026-10-28',
  },
  {
    id: 'fb-2',
    teacher_id: 't-2',
    teacher_name: 'Omar Adel',
    student_id: 's-2',
    student_name: 'Adam Nabil',
    feedback_text: 'Adam is excelling in linear equations. Encouraged to join the mathematics olympiad preparation group.',
    is_parent_visible: true,
    date: '2026-10-29',
  },
];

export const teacherService = {
  async getGrades(classId?: string): Promise<GradeRecord[]> {
    if (!isSupabaseConfigured()) {
      if (classId) return MOCK_GRADES.filter(g => g.class_id === classId || g.class_name === classId);
      return MOCK_GRADES;
    }

    try {
      let query = supabase.from('grades').select('*, students(full_name), groups(name)').order('created_at', { ascending: false });
      if (classId) {
        query = query.eq('group_id', classId);
      }
      const { data, error } = await query;
      if (error || !data || data.length === 0) return MOCK_GRADES;

      return data.map((d: any) => ({
        id: d.id,
        student_id: d.student_id,
        student_name: d.students?.full_name || 'Student',
        class_id: d.group_id,
        class_name: d.groups?.name || 'Class',
        subject: 'Science',
        assessment_title: d.assessment_title,
        score: Number(d.score),
        max_score: Number(d.max_score),
        date: d.assessment_date,
        type: d.grade_type,
        notes: d.remarks,
      }));
    } catch {
      return MOCK_GRADES;
    }
  },

  async addGrade(grade: Omit<GradeRecord, 'id'>): Promise<boolean> {
    if (!isSupabaseConfigured()) {
      MOCK_GRADES.unshift({
        id: `g-${Date.now()}`,
        ...grade,
      });
      return true;
    }

    try {
      const { error } = await supabase.from('grades').insert([
        {
          student_id: grade.student_id,
          group_id: grade.class_id,
          assessment_title: grade.assessment_title,
          grade_type: grade.type,
          score: grade.score,
          max_score: grade.max_score,
          assessment_date: grade.date,
          remarks: grade.notes,
        }
      ]);
      return !error;
    } catch {
      return false;
    }
  },

  async getFeedback(studentId?: string): Promise<TeacherFeedback[]> {
    if (!isSupabaseConfigured()) {
      if (studentId) return MOCK_TEACHER_FEEDBACK.filter(f => f.student_id === studentId);
      return MOCK_TEACHER_FEEDBACK;
    }

    try {
      let query = supabase.from('teacher_notes').select('*, teachers(full_name), students(full_name)').order('created_at', { ascending: false });
      if (studentId) {
        query = query.eq('student_id', studentId);
      }
      const { data, error } = await query;
      if (error || !data || data.length === 0) return MOCK_TEACHER_FEEDBACK;

      return data.map((d: any) => ({
        id: d.id,
        teacher_id: d.teacher_id,
        teacher_name: d.teachers?.full_name || 'Teacher',
        student_id: d.student_id,
        student_name: d.students?.full_name || 'Student',
        feedback_text: d.feedback_text,
        is_parent_visible: d.is_parent_visible,
        date: d.created_at ? d.created_at.slice(0, 10) : '2026-11-03',
      }));
    } catch {
      return MOCK_TEACHER_FEEDBACK;
    }
  },

  async addFeedback(feedback: Omit<TeacherFeedback, 'id'>): Promise<boolean> {
    if (!isSupabaseConfigured()) {
      MOCK_TEACHER_FEEDBACK.unshift({
        id: `fb-${Date.now()}`,
        ...feedback,
      });
      return true;
    }

    try {
      const { error } = await supabase.from('teacher_notes').insert([
        {
          teacher_id: feedback.teacher_id,
          student_id: feedback.student_id,
          feedback_text: feedback.feedback_text,
          is_parent_visible: feedback.is_parent_visible,
        }
      ]);
      return !error;
    } catch {
      return false;
    }
  }
};
