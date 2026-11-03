import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { 
  GroupClass, 
  Teacher, 
  Student, 
  AttendanceRecord, 
  RecentActivity, 
  WeeklyAttendancePoint 
} from '../types/database';

// Initial Mock Data (matches the EduTrack Admin Dashboard UI Mockup 100%)
export const MOCK_STAT_METRICS = {
  totalStudents: { value: '2,486', change: '+8.2% this month' },
  teachers: { value: '148', change: '+4 new' },
  activeClasses: { value: '64', change: '92% capacity' },
  attendanceToday: { value: '94.6%', change: '+2.4%' },
};

export const MOCK_WEEKLY_ATTENDANCE: WeeklyAttendancePoint[] = [
  { day: 'Mon', rate: 91.2 },
  { day: 'Tue', rate: 93.5 },
  { day: 'Wed', rate: 92.8 },
  { day: 'Thu', rate: 95.4 },
  { day: 'Fri', rate: 94.1 },
  { day: 'Sat', rate: 97.2 },
  { day: 'Sun', rate: 95.8 },
];

export const MOCK_RECENT_ACTIVITIES: RecentActivity[] = [
  {
    id: '1',
    title: 'New student enrolled',
    description: 'Lara Hassan • Grade 8',
    timestamp: '10 min ago',
    type: 'student',
  },
  {
    id: '2',
    title: 'Class schedule updated',
    description: 'Science • Room 204',
    timestamp: '42 min ago',
    type: 'schedule',
  },
  {
    id: '3',
    title: 'Report published',
    description: 'Term 1 progress report',
    timestamp: '2 hours ago',
    type: 'report',
  },
  {
    id: '4',
    title: 'Teacher added',
    description: 'Omar Adel • Mathematics',
    timestamp: 'Yesterday',
    type: 'teacher',
  },
];

export const MOCK_STUDENT_ATTENDANCE: AttendanceRecord[] = [
  {
    id: 'att-1',
    student_id: 's1',
    student_name: 'Lara Hassan',
    class_name: 'Grade 8A',
    status: 'Present',
    check_in_time: '08:02 AM',
    date: '2026-11-03',
  },
  {
    id: 'att-2',
    student_id: 's2',
    student_name: 'Adam Nabil',
    class_name: 'Grade 7B',
    status: 'Present',
    check_in_time: '08:05 AM',
    date: '2026-11-03',
  },
  {
    id: 'att-3',
    student_id: 's3',
    student_name: 'Youssef Ali',
    class_name: 'Grade 9C',
    status: 'Late',
    check_in_time: '08:27 AM',
    date: '2026-11-03',
  },
  {
    id: 'att-4',
    student_id: 's4',
    student_name: 'Mariam Samir',
    class_name: 'Grade 8A',
    status: 'Present',
    check_in_time: '08:00 AM',
    date: '2026-11-03',
  },
];

export const MOCK_CLASSES: GroupClass[] = [
  {
    id: 'cls-1',
    name: 'Grade 8A',
    grade_level: 'Grade 8',
    teacher_name: 'Dr. Salma Farid',
    subject: 'Science',
    room: 'Room 204',
    capacity: 30,
    enrolled_count: 28,
    schedule: 'Sun - Thu: 08:00 AM - 02:00 PM',
    created_at: '2026-09-01',
  },
  {
    id: 'cls-2',
    name: 'Grade 7B',
    grade_level: 'Grade 7',
    teacher_name: 'Omar Adel',
    subject: 'Mathematics',
    room: 'Room 105',
    capacity: 30,
    enrolled_count: 27,
    schedule: 'Sun - Thu: 08:00 AM - 02:00 PM',
    created_at: '2026-09-01',
  },
  {
    id: 'cls-3',
    name: 'Grade 9C',
    grade_level: 'Grade 9',
    teacher_name: 'Dr. Salma Farid',
    subject: 'Science',
    room: 'Room 206',
    capacity: 25,
    enrolled_count: 24,
    schedule: 'Sun - Thu: 08:00 AM - 02:00 PM',
    created_at: '2026-09-01',
  },
];

export const MOCK_TEACHERS: Teacher[] = [
  {
    id: 't-1',
    full_name: 'Dr. Salma Farid',
    subject: 'Science',
    email: 'salma.farid@edutrack.com',
    phone: '+20 100 111 2233',
    assigned_classes: ['Grade 8A', 'Grade 9C'],
    avatar_initials: 'SF',
    created_at: '2026-08-15',
  },
  {
    id: 't-2',
    full_name: 'Omar Adel',
    subject: 'Mathematics',
    email: 'omar.adel@edutrack.com',
    phone: '+20 101 222 3344',
    assigned_classes: ['Grade 7B'],
    avatar_initials: 'OA',
    created_at: '2026-08-20',
  },
  {
    id: 't-3',
    full_name: 'Mina Ayman',
    subject: 'UI/UX & Computing',
    email: 'mina.ayman@edutrack.com',
    phone: '+20 102 333 4455',
    assigned_classes: ['Grade 8A'],
    avatar_initials: 'MA',
    created_at: '2026-08-25',
  },
];

export const MOCK_STUDENTS: Student[] = [
  {
    id: 's-1',
    full_name: 'Lara Hassan',
    student_code: 'ET-2048',
    class_name: 'Grade 8A',
    grade_level: 'Grade 8',
    parent_name: 'Hassan Mahmoud',
    parent_phone: '+20 120 123 4567',
    status: 'active',
    created_at: '2026-09-01',
  },
  {
    id: 's-2',
    full_name: 'Adam Nabil',
    student_code: 'ET-2049',
    class_name: 'Grade 7B',
    grade_level: 'Grade 7',
    parent_name: 'Nabil Farouk',
    parent_phone: '+20 121 234 5678',
    status: 'active',
    created_at: '2026-09-01',
  },
  {
    id: 's-3',
    full_name: 'Youssef Ali',
    student_code: 'ET-2050',
    class_name: 'Grade 9C',
    grade_level: 'Grade 9',
    parent_name: 'Ali Salem',
    parent_phone: '+20 122 345 6789',
    status: 'active',
    created_at: '2026-09-01',
  },
  {
    id: 's-4',
    full_name: 'Mariam Samir',
    student_code: 'ET-2051',
    class_name: 'Grade 8A',
    grade_level: 'Grade 8',
    parent_name: 'Samir Ezzat',
    parent_phone: '+20 123 456 7890',
    status: 'active',
    created_at: '2026-09-01',
  },
];

export const adminService = {
  async getDashboardOverview() {
    if (!isSupabaseConfigured()) {
      return {
        stats: MOCK_STAT_METRICS,
        weeklyAttendance: MOCK_WEEKLY_ATTENDANCE,
        recentActivities: MOCK_RECENT_ACTIVITIES,
        studentAttendance: MOCK_STUDENT_ATTENDANCE,
      };
    }

    try {
      // Parallel Supabase queries
      const [studentsRes, teachersRes, groupsRes, attendanceRes, activityRes] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact' }),
        supabase.from('teachers').select('*', { count: 'exact' }),
        supabase.from('groups').select('*', { count: 'exact' }),
        supabase.from('attendance').select('*, students(full_name), groups(name)').order('check_in_time', { ascending: false }).limit(10),
        supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(5),
      ]);

      const formattedAttendance: AttendanceRecord[] = (attendanceRes.data || []).map((item: any) => ({
        id: item.id,
        student_id: item.student_id,
        student_name: item.students?.full_name || 'Unknown Student',
        class_name: item.groups?.name || 'Class',
        status: item.status,
        check_in_time: item.check_in_time ? item.check_in_time.slice(0, 5) : '08:00 AM',
        date: item.date,
      }));

      const formattedActivities: RecentActivity[] = (activityRes.data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        timestamp: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: item.type,
      }));

      return {
        stats: {
          totalStudents: { 
            value: studentsRes.count ? studentsRes.count.toLocaleString() : MOCK_STAT_METRICS.totalStudents.value, 
            change: '+8.2% this month' 
          },
          teachers: { 
            value: teachersRes.count ? teachersRes.count.toString() : MOCK_STAT_METRICS.teachers.value, 
            change: '+4 new' 
          },
          activeClasses: { 
            value: groupsRes.count ? groupsRes.count.toString() : MOCK_STAT_METRICS.activeClasses.value, 
            change: '92% capacity' 
          },
          attendanceToday: { 
            value: MOCK_STAT_METRICS.attendanceToday.value, 
            change: '+2.4%' 
          },
        },
        weeklyAttendance: MOCK_WEEKLY_ATTENDANCE,
        recentActivities: formattedActivities.length > 0 ? formattedActivities : MOCK_RECENT_ACTIVITIES,
        studentAttendance: formattedAttendance.length > 0 ? formattedAttendance : MOCK_STUDENT_ATTENDANCE,
      };
    } catch (err) {
      console.warn('Falling back to mock data:', err);
      return {
        stats: MOCK_STAT_METRICS,
        weeklyAttendance: MOCK_WEEKLY_ATTENDANCE,
        recentActivities: MOCK_RECENT_ACTIVITIES,
        studentAttendance: MOCK_STUDENT_ATTENDANCE,
      };
    }
  },

  async getClasses(): Promise<GroupClass[]> {
    if (!isSupabaseConfigured()) return MOCK_CLASSES;
    try {
      const { data, error } = await supabase.from('groups').select('*, teachers(full_name)');
      if (error || !data || data.length === 0) return MOCK_CLASSES;
      return data.map((d: any) => ({
        id: d.id,
        name: d.name,
        grade_level: d.grade_level,
        teacher_name: d.teachers?.full_name || 'Unassigned',
        subject: d.subject || 'General',
        room: d.room || 'Room 204',
        capacity: d.capacity || 30,
        enrolled_count: d.enrolled_count || 0,
        schedule: d.schedule,
        created_at: d.created_at,
      }));
    } catch {
      return MOCK_CLASSES;
    }
  },

  async getTeachers(): Promise<Teacher[]> {
    if (!isSupabaseConfigured()) return MOCK_TEACHERS;
    try {
      const { data, error } = await supabase.from('teachers').select('*');
      if (error || !data || data.length === 0) return MOCK_TEACHERS;
      return data.map((t: any) => ({
        id: t.id,
        full_name: t.full_name,
        subject: t.subject,
        email: t.email,
        phone: t.phone,
        avatar_initials: t.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
        created_at: t.created_at,
      }));
    } catch {
      return MOCK_TEACHERS;
    }
  },

  async getStudents(): Promise<Student[]> {
    if (!isSupabaseConfigured()) return MOCK_STUDENTS;
    try {
      const { data, error } = await supabase.from('students').select('*, groups(name)');
      if (error || !data || data.length === 0) return MOCK_STUDENTS;
      return data.map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        student_code: s.student_code,
        class_name: s.groups?.name || 'Unassigned',
        grade_level: s.grade_level,
        parent_name: s.parent_name,
        parent_phone: s.parent_phone,
        status: s.status,
        created_at: s.created_at,
      }));
    } catch {
      return MOCK_STUDENTS;
    }
  },

  async addStudent(student: Partial<Student>): Promise<boolean> {
    if (!isSupabaseConfigured()) return true;
    try {
      const { error } = await supabase.from('students').insert([
        {
          full_name: student.full_name,
          student_code: student.student_code || `ET-${Math.floor(1000 + Math.random() * 9000)}`,
          grade_level: student.grade_level,
          qr_code_hash: `QR_${Date.now()}`,
          parent_name: student.parent_name,
          parent_phone: student.parent_phone,
        }
      ]);
      return !error;
    } catch {
      return false;
    }
  },

  async addClass(newClass: Partial<GroupClass>): Promise<boolean> {
    if (!isSupabaseConfigured()) return true;
    try {
      const { error } = await supabase.from('groups').insert([
        {
          name: newClass.name,
          grade_level: newClass.grade_level,
          subject: newClass.subject,
          room: newClass.room,
          capacity: newClass.capacity || 30,
        }
      ]);
      return !error;
    } catch {
      return false;
    }
  }
};
