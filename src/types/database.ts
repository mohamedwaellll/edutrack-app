export type UserRole = 'admin' | 'teacher' | 'student' | 'parent';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url?: string;
  phone?: string;
  created_at: string;
}

export interface GroupClass {
  id: string;
  name: string; // e.g. "Grade 8A", "Grade 7B"
  grade_level: string; // e.g. "Grade 8"
  teacher_id?: string;
  teacher_name?: string;
  subject?: string; // e.g. "Science", "Mathematics"
  room?: string; // e.g. "Room 204"
  capacity: number;
  enrolled_count: number;
  schedule?: string;
  created_at: string;
}

export interface Teacher {
  id: string;
  user_id?: string;
  full_name: string;
  subject: string;
  email: string;
  phone?: string;
  assigned_classes?: string[];
  avatar_initials?: string;
  created_at: string;
}

export interface Student {
  id: string;
  user_id?: string;
  full_name: string;
  student_code?: string;
  class_id?: string;
  class_name: string; // e.g. "Grade 8A"
  grade_level: string;
  qr_code?: string;
  parent_name?: string;
  parent_phone?: string;
  status: 'active' | 'inactive';
  created_at: string;
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
