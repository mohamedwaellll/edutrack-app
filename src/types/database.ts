export type UserRole = 'admin' | 'teacher' | 'student' | 'parent';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url?: string | null;
  phone?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface GroupClass {
  id: string;
  name: string; // e.g. "Grade 8A", "Grade 7B"
  grade_level: string; // e.g. "Grade 8"
  teacher_id?: string | null;
  teacher_name?: string;
  subject?: string | null; // e.g. "Science", "Mathematics"
  room?: string | null; // e.g. "Room 204"
  capacity: number;
  enrolled_count: number;
  schedule?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Teacher {
  id: string;
  user_id?: string | null;
  full_name: string;
  subject: string;
  email: string;
  phone?: string | null;
  assigned_classes?: string[];
  avatar_initials?: string;
  created_at: string;
}

export type StudentStatus = 'active' | 'suspended' | 'graduated';

export interface Student {
  id: string;
  user_id?: string | null;
  full_name: string;
  student_code: string;
  group_id: string | null;
  class_name?: string; // resolved group name for display
  grade_level: string;
  qr_code_hash: string;
  parent_name?: string | null;
  parent_phone?: string | null;
  status: StudentStatus;
  created_at: string;
}

export interface CreateStudentInput {
  full_name: string;
  student_code?: string;
  group_id: string;
  grade_level: string;
  qr_code_hash?: string;
  parent_name?: string | null;
  parent_phone?: string | null;
  status?: StudentStatus;
}

export interface CreateGroupInput {
  name: string;
  grade_level: string;
  subject?: string | null;
  room?: string | null;
  capacity?: number;
  teacher_id?: string | null;
  schedule?: string | null;
}

export interface CreateTeacherInput {
  full_name: string;
  subject: string;
  email: string;
  phone?: string | null;
}

export interface UpdateGroupTeacherInput {
  groupId: string;
  teacherId: string | null;
}

export type AttendanceStatus = 'Present' | 'Late' | 'Absent' | 'Excused';

export interface AttendanceRecord {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  status: AttendanceStatus;
  check_in_time: string; // "08:02 AM"
  date: string; // "2026-11-03"
  method?: 'qr' | 'manual';
}

export interface GradeRecord {
  id: string;
  student_id: string;
  student_name: string;
  class_id: string;
  class_name: string;
  subject: string;
  assessment_title: string; // e.g. "Chapter 06 Exam"
  score: number;
  max_score: number;
  date: string;
  type: 'exam' | 'quiz' | 'assignment' | 'participation';
  notes?: string;
}

export interface TeacherFeedback {
  id: string;
  teacher_id: string;
  teacher_name: string;
  student_id: string;
  student_name: string;
  feedback_text: string;
  is_parent_visible: boolean;
  date: string;
}

export interface RecentActivity {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  type: 'student' | 'schedule' | 'report' | 'teacher';
}

export interface WeeklyAttendancePoint {
  day: string; // "Mon", "Tue", ...
  rate: number; // 92.4, 95.1 ...
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
