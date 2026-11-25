import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { getCairoDateString } from './attendanceService';
import { 
  GroupClass, 
  Teacher, 
  Student, 
  AttendanceRecord, 
  RecentActivity, 
  WeeklyAttendancePoint,
  CreateStudentInput,
  CreateGroupInput,
  UpdateGroupInput,
  CreateTeacherInput
} from '../types/database';

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
  code?: string;
}

export interface AdminDashboardOverviewData {
  stats: {
    totalStudents: { value: string; change: string };
    teachers: { value: string; change: string };
    activeClasses: { value: string; change: string };
    attendanceToday: { value: string; change: string };
  };
  weeklyAttendance: WeeklyAttendancePoint[];
  recentActivities: RecentActivity[];
  studentAttendance: AttendanceRecord[];
}

interface RawGroupRow {
  id: string;
  name: string;
  grade_level: string;
  teacher_id?: string | null;
  teachers?: { full_name?: string | null } | null;
  subject?: string | null;
  room?: string | null;
  capacity?: number | null;
  enrolled_count?: number | null;
  schedule?: string | null;
  created_at: string;
  updated_at?: string;
}

interface RawStudentRow {
  id: string;
  user_id?: string | null;
  full_name: string;
  student_code: string;
  group_id: string | null;
  groups?: { name?: string | null } | null;
  grade_level: string;
  qr_code_hash: string;
  parent_name?: string | null;
  parent_phone?: string | null;
  status: Student['status'];
  created_at: string;
}

interface RawTeacherRow {
  id: string;
  user_id?: string | null;
  full_name: string;
  subject: string;
  email: string;
  phone?: string | null;
  room_number?: string | null;
  created_at: string;
}

interface RawAttendanceOverviewRow {
  id: string;
  student_id: string;
  students?: { full_name?: string | null } | null;
  groups?: { name?: string | null } | null;
  status: AttendanceRecord['status'];
  check_in_time?: string | null;
  date: string;
  scan_method?: AttendanceRecord['method'];
}

interface RawActivityRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
  type: RecentActivity['type'];
}

function getServiceErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

async function logActivitySafely(title: string, description: string, type: RecentActivity['type']): Promise<void> {
  try {
    await supabase.from('activity_logs').insert([{ title, description, type }]);
  } catch (err: unknown) {
    console.warn('Activity log write skipped:', getServiceErrorMessage(err, 'Unknown error'));
  }
}

export const adminService = {
  /**
   * Fetches real classes / groups from Supabase.
   * Returns empty array if no records exist; returns explicit error on failure.
   */
  async getClasses(): Promise<ServiceResult<GroupClass[]>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    try {
      const { data, error } = await supabase
        .from('groups')
        .select('*, teachers(full_name)')
        .order('name', { ascending: true });

      if (error) {
        return { data: null, error: error.message, code: error.code };
      }

      const formatted: GroupClass[] = ((data || []) as RawGroupRow[]).map((d) => ({
        id: d.id,
        name: d.name,
        grade_level: d.grade_level,
        teacher_id: d.teacher_id,
        teacher_name: d.teachers?.full_name || 'Unassigned',
        subject: d.subject || 'General',
        room: d.room || 'Room 204',
        capacity: d.capacity ?? 30,
        enrolled_count: d.enrolled_count ?? 0,
        schedule: d.schedule,
        created_at: d.created_at,
        updated_at: d.updated_at,
      }));

      return { data: formatted, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to fetch classes') };
    }
  },

  /**
   * Fetches real students from Supabase, joined with group name.
   */
  async getStudents(): Promise<ServiceResult<Student[]>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    try {
      const { data, error } = await supabase
        .from('students')
        .select('*, groups(name)')
        .order('created_at', { ascending: false });

      if (error) {
        return { data: null, error: error.message, code: error.code };
      }

      const formatted: Student[] = ((data || []) as RawStudentRow[]).map((s) => ({
        id: s.id,
        user_id: s.user_id,
        full_name: s.full_name,
        student_code: s.student_code,
        group_id: s.group_id,
        class_name: s.groups?.name || 'Unassigned',
        grade_level: s.grade_level,
        qr_code_hash: s.qr_code_hash,
        parent_name: s.parent_name,
        parent_phone: s.parent_phone,
        status: s.status,
        created_at: s.created_at,
      }));

      return { data: formatted, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to fetch students') };
    }
  },

  /**
   * Fetches teachers directory from Supabase with their real assigned classes.
   */
  async getTeachers(): Promise<ServiceResult<Teacher[]>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    try {
      const [teachersRes, groupsRes] = await Promise.all([
        supabase.from('teachers').select('*').order('full_name', { ascending: true }),
        supabase.from('groups').select('id, name, teacher_id').order('name', { ascending: true }),
      ]);

      if (teachersRes.error) {
        return { data: null, error: teachersRes.error.message, code: teachersRes.error.code };
      }

      if (groupsRes.error) {
        return { data: null, error: groupsRes.error.message, code: groupsRes.error.code };
      }

      const groups = (groupsRes.data || []) as Array<{ id: string; name: string; teacher_id: string | null }>;

      const formatted: Teacher[] = ((teachersRes.data || []) as RawTeacherRow[]).map((t) => {
        const assignedClasses = groups
          .filter((g) => g.teacher_id === t.id)
          .map((g) => g.name);

        return {
          id: t.id,
          user_id: t.user_id,
          full_name: t.full_name,
          subject: t.subject,
          email: t.email,
          phone: t.phone,
          room_number: t.room_number,
          assigned_classes: assignedClasses,
          avatar_initials: t.full_name
            .split(' ')
            .map((n: string) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase(),
          created_at: t.created_at,
        };
      });

      return { data: formatted, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to fetch teachers') };
    }
  },

  /**
   * Fetches real live overview metrics from Supabase.
   * - Calculates real Present + Late counts for today and last 7 calendar days in Africa/Cairo.
   * - Surfaces failed queries explicitly instead of displaying false success/zeros.
   */
  async getDashboardOverview(): Promise<ServiceResult<AdminDashboardOverviewData>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    try {
      // Calculate 7 calendar days in Africa/Cairo ending with today
      const now = new Date();
      const dates: { dateStr: string; label: string }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = getCairoDateString(d);
        const [y, m, dayNum] = dateStr.split('-');
        const utcDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(dayNum)));
        const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(utcDate);
        dates.push({ dateStr, label: `${dayName} ${Number(dayNum)}` });
      }

      const today = dates[6].dateStr;
      const startDate = dates[0].dateStr;

      const [
        studentsRes,
        teachersRes,
        groupsRes,
        attendanceTodayRes,
        attendanceWeekRes,
        recentAttendanceRes,
        activityRes,
      ] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact', head: true }),
        supabase.from('teachers').select('*', { count: 'exact', head: true }),
        supabase.from('groups').select('*', { count: 'exact', head: true }),
        supabase
          .from('attendance')
          .select('*', { count: 'exact', head: true })
          .eq('date', today)
          .in('status', ['Present', 'Late']),
        supabase
          .from('attendance')
          .select('date, status')
          .gte('date', startDate)
          .lte('date', today)
          .in('status', ['Present', 'Late']),
        supabase
          .from('attendance')
          .select('*, students(full_name), groups(name)')
          .order('date', { ascending: false })
          .limit(6),
        supabase
          .from('activity_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      // Surface failed queries explicitly
      if (studentsRes.error) throw new Error(`Failed to load students: ${studentsRes.error.message}`);
      if (teachersRes.error) throw new Error(`Failed to load teachers: ${teachersRes.error.message}`);
      if (groupsRes.error) throw new Error(`Failed to load groups: ${groupsRes.error.message}`);
      if (attendanceTodayRes.error) throw new Error(`Failed to load today attendance: ${attendanceTodayRes.error.message}`);
      if (attendanceWeekRes.error) throw new Error(`Failed to load weekly attendance: ${attendanceWeekRes.error.message}`);
      if (recentAttendanceRes.error) throw new Error(`Failed to load recent logs: ${recentAttendanceRes.error.message}`);
      if (activityRes.error) throw new Error(`Failed to load activity logs: ${activityRes.error.message}`);

      const studentCount = studentsRes.count ?? 0;
      const teacherCount = teachersRes.count ?? 0;
      const groupCount = groupsRes.count ?? 0;
      const presentTodayCount = attendanceTodayRes.count ?? 0;

      // Group weekly counts by Cairo date
      const countsByDate = new Map<string, number>();
      for (const item of dates) {
        countsByDate.set(item.dateStr, 0);
      }
      for (const row of attendanceWeekRes.data || []) {
        if (countsByDate.has(row.date)) {
          countsByDate.set(row.date, countsByDate.get(row.date)! + 1);
        }
      }

      const weeklyAttendance: WeeklyAttendancePoint[] = dates.map((item) => {
        const count = countsByDate.get(item.dateStr) || 0;
        return {
          day: item.label,
          rate: count,
        };
      });

      const studentAttendance: AttendanceRecord[] = ((recentAttendanceRes.data || []) as RawAttendanceOverviewRow[]).map((item) => ({
        id: item.id,
        student_id: item.student_id,
        student_name: item.students?.full_name || 'Student',
        class_name: item.groups?.name || 'Class',
        status: item.status,
        check_in_time: item.check_in_time ? item.check_in_time.slice(0, 5) : '-',
        date: item.date,
        method: item.scan_method,
      }));

      const recentActivities: RecentActivity[] = ((activityRes.data || []) as RawActivityRow[]).map((act) => ({
        id: act.id,
        title: act.title,
        description: act.description,
        timestamp: new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: act.type,
      }));

      return {
        data: {
          stats: {
            totalStudents: {
              value: studentCount.toLocaleString(),
              change: studentCount > 0 ? 'Active students' : 'No students yet',
            },
            teachers: {
              value: teacherCount.toString(),
              change: teacherCount > 0 ? 'Active staff' : 'No teachers yet',
            },
            activeClasses: {
              value: groupCount.toString(),
              change: groupCount > 0 ? 'Active groups' : 'No groups yet',
            },
            attendanceToday: {
              value: `${presentTodayCount}`,
              change: studentCount > 0
                ? `${presentTodayCount} of ${studentCount} present/late today`
                : `${presentTodayCount} present/late today`,
            },
          },
          weeklyAttendance,
          recentActivities,
          studentAttendance,
        },
        error: null,
      };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to load dashboard overview') };
    }
  },

  /**
   * Adds a new student assigned to a group.
   * Validates required inputs, generates QR hash, handles duplicate student codes,
   * and persists group_id correctly to Supabase.
   */
  async addStudent(input: CreateStudentInput): Promise<ServiceResult<Student>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    const trimmedName = (input.full_name || '').trim();
    if (!trimmedName || trimmedName.length < 2) {
      return { data: null, error: 'Student full name is required (minimum 2 characters).' };
    }

    if (!input.group_id) {
      return { data: null, error: 'Please select a valid group for the student.' };
    }

    if (!input.grade_level) {
      return { data: null, error: 'Grade level is required.' };
    }

    // Generate or format student_code
    const studentCode = (input.student_code || '').trim() || `ET-${Math.floor(1000 + Math.random() * 9000)}`;
    // Use random unique identifier for newly created students, preserving any provided identifier
    const randomHash = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `ET-QR-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
    const qrCodeHash = input.qr_code_hash?.trim() || randomHash;

    try {
      const payload = {
        full_name: trimmedName,
        student_code: studentCode,
        group_id: input.group_id,
        grade_level: input.grade_level,
        qr_code_hash: qrCodeHash,
        parent_name: input.parent_name?.trim() || null,
        parent_phone: input.parent_phone?.trim() || null,
        status: input.status || 'active',
      };

      const { data, error } = await supabase
        .from('students')
        .insert([payload])
        .select('*, groups(name)')
        .single();

      if (error) {
        // Handle unique constraint violations
        if (error.code === '23505' || error.message.includes('student_code')) {
          return {
            data: null,
            error: `Student code "${studentCode}" is already in use. Please enter a unique code.`,
            code: 'DUPLICATE_CODE',
          };
        }
        return { data: null, error: error.message, code: error.code };
      }

      // Log activity
      await logActivitySafely('New student enrolled', `${data.full_name} • ${data.grade_level}`, 'student');

      const createdStudent: Student = {
        id: data.id,
        user_id: data.user_id,
        full_name: data.full_name,
        student_code: data.student_code,
        group_id: data.group_id,
        class_name: data.groups?.name || 'Class',
        grade_level: data.grade_level,
        qr_code_hash: data.qr_code_hash,
        parent_name: data.parent_name,
        parent_phone: data.parent_phone,
        status: data.status,
        created_at: data.created_at,
      };

      return { data: createdStudent, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to save student to database') };
    }
  },

  /**
   * Adds a new class group to Supabase.
   */
  async addClass(input: CreateGroupInput): Promise<ServiceResult<GroupClass>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    const trimmedName = (input.name || '').trim();
    if (!trimmedName) {
      return { data: null, error: 'Group/Class name is required.' };
    }

    const trimmedGrade = (input.grade_level || '').trim();
    if (!trimmedGrade) {
      return { data: null, error: 'Grade level is required.' };
    }

    try {
      const payload = {
        name: trimmedName,
        grade_level: trimmedGrade,
        subject: input.subject?.trim() || 'General',
        room: input.room?.trim() || 'Room 204',
        capacity: input.capacity && input.capacity > 0 ? input.capacity : 30,
        teacher_id: input.teacher_id || null,
        schedule: input.schedule?.trim() || 'Sun - Thu: 08:00 AM - 02:00 PM',
      };

      const { data, error } = await supabase
        .from('groups')
        .insert([payload])
        .select('*, teachers(full_name)')
        .single();

      if (error) {
        return { data: null, error: error.message, code: error.code };
      }

      await logActivitySafely('Class group created', `${data.name} • ${data.subject}`, 'schedule');

      const createdGroup: GroupClass = {
        id: data.id,
        name: data.name,
        grade_level: data.grade_level,
        teacher_id: data.teacher_id,
        teacher_name: data.teachers?.full_name || 'Unassigned',
        subject: data.subject,
        room: data.room,
        capacity: data.capacity,
        enrolled_count: data.enrolled_count ?? 0,
        schedule: data.schedule,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      return { data: createdGroup, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to save group to database') };
    }
  },

  /**
   * Updates editable metadata for an existing class group in Supabase.
   * Preserves teacher_id, enrolled_count, id, and all historical/membership links.
   */
  async updateClass(input: UpdateGroupInput): Promise<ServiceResult<GroupClass>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!input.id || !uuidRegex.test(input.id)) {
      return { data: null, error: 'A valid group UUID is required.' };
    }

    const trimmedName = (input.name || '').trim();
    if (!trimmedName) {
      return { data: null, error: 'Group/Class name is required.' };
    }

    const trimmedGrade = (input.grade_level || '').trim();
    if (!trimmedGrade) {
      return { data: null, error: 'Grade level is required.' };
    }

    if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
      return { data: null, error: 'Capacity must be a positive whole number.' };
    }

    try {
      const payload = {
        name: trimmedName,
        grade_level: trimmedGrade,
        subject: input.subject?.trim() || 'General',
        room: input.room?.trim() || 'Room 204',
        capacity: input.capacity,
        schedule: input.schedule?.trim() || 'Sun - Thu: 08:00 AM - 02:00 PM',
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('groups')
        .update(payload)
        .eq('id', input.id)
        .select('*, teachers(full_name)')
        .maybeSingle();

      if (error) {
        return { data: null, error: error.message, code: error.code };
      }

      if (!data) {
        return { data: null, error: 'Class group not found or you lack permission to update it.' };
      }

      await logActivitySafely('Class group updated', `${data.name} • ${data.subject}`, 'schedule');

      const updatedGroup: GroupClass = {
        id: data.id,
        name: data.name,
        grade_level: data.grade_level,
        teacher_id: data.teacher_id,
        teacher_name: data.teachers?.full_name || 'Unassigned',
        subject: data.subject,
        room: data.room,
        capacity: data.capacity,
        enrolled_count: data.enrolled_count ?? 0,
        schedule: data.schedule,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      return { data: updatedGroup, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to update group in database') };
    }
  },

  /**
   * Adds a new teacher record to the faculty directory.
   * Does NOT create an Auth account or grant a user role.
   * Enforces trimmed required values, valid email format, and case-insensitive email uniqueness.
   */
  async createTeacher(input: CreateTeacherInput): Promise<ServiceResult<Teacher>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    const trimmedName = (input.full_name || '').trim();
    if (!trimmedName || trimmedName.length < 2) {
      return { data: null, error: 'Teacher full name is required (minimum 2 characters).' };
    }

    const trimmedSubject = (input.subject || '').trim();
    if (!trimmedSubject) {
      return { data: null, error: 'Teaching subject is required.' };
    }

    const trimmedEmail = (input.email || '').trim().toLowerCase();
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      return { data: null, error: 'A valid email address is required.' };
    }

    const trimmedPhone = (input.phone || '').trim() || null;

    try {
      const payload: {
        full_name: string;
        subject: string;
        email: string;
        phone: string | null;
      } = {
        full_name: trimmedName,
        subject: trimmedSubject,
        email: trimmedEmail,
        phone: trimmedPhone,
      };

      const { data, error } = await supabase
        .from('teachers')
        .insert([payload])
        .select('*')
        .single();

      if (error) {
        if (
          error.code === '23505' || 
          error.message.includes('unique') || 
          error.message.includes('idx_teachers_email_lower') ||
          error.message.includes('teachers_email_key')
        ) {
          return {
            data: null,
            error: `A teacher with the email "${trimmedEmail}" already exists. Teacher emails must be unique (case-insensitive).`,
            code: '23505',
          };
        }
        return { data: null, error: error.message, code: error.code };
      }

      await logActivitySafely('Teacher added', `${data.full_name} • ${data.subject} (${data.email})`, 'teacher');

      const createdTeacher: Teacher = {
        id: data.id,
        user_id: data.user_id,
        full_name: data.full_name,
        subject: data.subject,
        email: data.email,
        phone: data.phone,
        assigned_classes: [],
        avatar_initials: data.full_name
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
        created_at: data.created_at,
      };

      return { data: createdTeacher, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to create teacher') };
    }
  },

  /**
   * Assigns, changes, or unassigns the instructor for an existing group.
   * Passing teacherId = null unassigns the instructor.
   */
  async updateGroupTeacher(groupId: string, teacherId: string | null): Promise<ServiceResult<GroupClass>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!groupId || !uuidRegex.test(groupId)) {
      return { data: null, error: 'A valid group UUID is required.' };
    }

    const cleanTeacherId = teacherId && teacherId.trim() ? teacherId.trim() : null;
    if (cleanTeacherId && !uuidRegex.test(cleanTeacherId)) {
      return { data: null, error: 'A valid teacher UUID is required for assignment.' };
    }

    try {
      // If assigning a teacher, verify they exist before update
      if (cleanTeacherId) {
        const { data: teacher, error: teacherErr } = await supabase
          .from('teachers')
          .select('id, full_name')
          .eq('id', cleanTeacherId)
          .maybeSingle();

        if (teacherErr) {
          return { data: null, error: `Error validating teacher: ${teacherErr.message}` };
        }
        if (!teacher) {
          return { data: null, error: 'Selected teacher does not exist or has been deleted.' };
        }
      }

      const { data, error } = await supabase
        .from('groups')
        .update({
          teacher_id: cleanTeacherId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', groupId)
        .select('*, teachers(full_name)')
        .maybeSingle();

      if (error) {
        return { data: null, error: error.message, code: error.code };
      }

      if (!data) {
        return { data: null, error: 'Class group not found or you lack permission to update it.' };
      }

      await logActivitySafely(
        'Class instructor updated',
        `${data.name} assigned to: ${data.teachers?.full_name || 'Unassigned'}`,
        'schedule'
      );

      const updatedGroup: GroupClass = {
        id: data.id,
        name: data.name,
        grade_level: data.grade_level,
        teacher_id: data.teacher_id,
        teacher_name: data.teachers?.full_name || 'Unassigned',
        subject: data.subject,
        room: data.room,
        capacity: data.capacity,
        enrolled_count: data.enrolled_count ?? 0,
        schedule: data.schedule,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      return { data: updatedGroup, error: null };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to update group instructor') };
    }
  },

  /**
   * Updates a student's enrollment status via narrow admin RPC with atomic expected-status compare.
   */
  async updateStudentStatus(
    studentId: string,
    newStatus: Student['status'],
    expectedStatus: Student['status'] | null
  ): Promise<ServiceResult<{ id: string; status: Student['status'] }>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!studentId || !uuidRegex.test(studentId.trim())) {
      return { data: null, error: 'A valid student UUID is required.' };
    }

    const validStatuses: Student['status'][] = ['active', 'suspended', 'graduated'];
    if (!validStatuses.includes(newStatus) || (expectedStatus !== null && !validStatuses.includes(expectedStatus))) {
      return { data: null, error: 'Invalid student enrollment status.' };
    }

    try {
      const { data, error } = await supabase.rpc('update_student_enrollment_status', {
        p_student_id: studentId.trim(),
        p_new_status: newStatus,
        p_expected_status: expectedStatus,
      });

      if (error) {
        return { data: null, error: error.message, code: error.code };
      }

      if (!data || data.id !== studentId.trim().toLowerCase() || data.status !== newStatus) {
        return { data: null, error: 'Unexpected response from student status update.' };
      }

      await logActivitySafely(
        'Student enrollment status updated',
        `Student ${data.id} set to ${data.status}`,
        'student'
      );

      return {
        data: { id: data.id, status: data.status },
        error: null,
      };
    } catch (err: unknown) {
      return { data: null, error: getServiceErrorMessage(err, 'Failed to update student enrollment status') };
    }
  },
};
