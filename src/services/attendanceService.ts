import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { AttendanceStatus, AttendanceRecord } from '../types/database';
import { ServiceResult } from './adminService';

export interface AttendanceRosterItem {
  student_id: string;
  student_name: string;
  student_code: string;
  group_id: string;
  group_name?: string;
  attendance_id: string | null;
  status: AttendanceStatus | 'Not marked';
  check_in_time: string | null;
  date: string;
}

export interface QRAttendanceResult {
  success: boolean;
  code: 'RECORDED' | 'ALREADY_RECORDED' | 'CONFLICT_EXISTS' | 'INVALID_TOKEN' | 'INACTIVE_STUDENT' | 'GROUP_MISMATCH' | 'STUDENT_UNASSIGNED' | 'GROUP_REQUIRED' | 'HISTORICAL_GROUP_MISMATCH' | 'EMPTY_TOKEN' | 'ERROR';
  message: string;
  attendance?: AttendanceRecord;
}

export interface SaveAttendanceInput {
  student_id: string;
  group_id: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  check_in_time?: string | null;
}

/**
 * Returns the current date formatted as YYYY-MM-DD in Africa/Cairo timezone.
 */
export function getCairoDateString(d: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

/**
 * Returns the current time formatted as HH:mm:ss in Africa/Cairo timezone.
 */
export function getCairoTimeString(d: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(d);
}

export const attendanceService = {
  /**
   * Fetches the complete attendance roster for a given group and date in Africa/Cairo.
   * Students without an attendance entry are returned as 'Not marked'.
   */
  async getGroupRosterAttendance(
    groupId: string,
    date: string
  ): Promise<ServiceResult<AttendanceRosterItem[]>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    if (!groupId) {
      return { data: [], error: null };
    }

    try {
      // 1. Fetch all active students assigned to this group
      const { data: students, error: studentsErr } = await supabase
        .from('students')
        .select('id, full_name, student_code, group_id, groups(name)')
        .eq('group_id', groupId)
        .order('full_name', { ascending: true });

      if (studentsErr) {
        return { data: null, error: `Failed to load students: ${studentsErr.message}`, code: studentsErr.code };
      }

      if (!students || students.length === 0) {
        return { data: [], error: null };
      }

      // 2. Fetch existing attendance records for these students on the given date
      const studentIds = students.map((s) => s.id);
      const { data: attendanceLogs, error: attendanceErr } = await supabase
        .from('attendance')
        .select('*')
        .in('student_id', studentIds)
        .eq('date', date);

      if (attendanceErr) {
        return { data: null, error: `Failed to load attendance records: ${attendanceErr.message}`, code: attendanceErr.code };
      }

      interface AttendanceLogRow {
        id: string;
        student_id: string;
        status: AttendanceStatus;
        check_in_time: string | null;
        date: string;
      }

      interface RosterStudentRow {
        id: string;
        full_name: string;
        student_code: string;
        group_id: string;
        groups?: { name?: string | null } | null;
      }

      const logMap = new Map<string, AttendanceLogRow>();
      ((attendanceLogs || []) as AttendanceLogRow[]).forEach((item) => {
        logMap.set(item.student_id, item);
      });

      // 3. Merge: students without an entry are explicitly marked 'Not marked'
      const roster: AttendanceRosterItem[] = (students as RosterStudentRow[]).map((s) => {
        const record = logMap.get(s.id);
        const groupName = s.groups?.name || 'Class';

        if (record) {
          return {
            student_id: s.id,
            student_name: s.full_name,
            student_code: s.student_code,
            group_id: s.group_id,
            group_name: groupName,
            attendance_id: record.id,
            status: record.status,
            check_in_time: record.check_in_time || null,
            date: record.date,
          };
        }

        return {
          student_id: s.id,
          student_name: s.full_name,
          student_code: s.student_code,
          group_id: s.group_id,
          group_name: groupName,
          attendance_id: null,
          status: 'Not marked',
          check_in_time: null,
          date,
        };
      });

      return { data: roster, error: null };
    } catch (err: unknown) {
      return {
        data: null,
        error: err instanceof Error && err.message ? err.message : 'Failed to fetch group roster attendance',
      };
    }
  },

  /**
   * Saves or corrects an attendance status for a student on a specific date.
   * - Enforces that student belongs to the selected group.
   * - Sets scan_method = 'manual'.
   * - Absent/Excused records receive NULL check_in_time.
   * - Present/Late records receive valid Cairo time.
   * - Uses UNIQUE(student_id, date) onConflict to update without duplicating.
   */
  async saveStudentAttendance(
    input: SaveAttendanceInput
  ): Promise<ServiceResult<AttendanceRecord>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    if (!input.student_id || !input.group_id || !input.date || !input.status) {
      return { data: null, error: 'student_id, group_id, date, and status are required' };
    }

    const validStatuses: AttendanceStatus[] = ['Present', 'Late', 'Absent', 'Excused'];
    if (!validStatuses.includes(input.status)) {
      return { data: null, error: `Invalid attendance status: ${input.status}` };
    }

    try {
      // 1. Validate that the student exists and actually belongs to the selected group
      const { data: student, error: studentErr } = await supabase
        .from('students')
        .select('id, group_id, full_name')
        .eq('id', input.student_id)
        .single();

      if (studentErr || !student) {
        return { data: null, error: 'Student does not exist or could not be loaded' };
      }

      if (student.group_id !== input.group_id) {
        return {
          data: null,
          error: `Student does not belong to the selected group (assigned to: ${student.group_id})`,
        };
      }

      // 2. Check for conflicts with existing records under a different group
      const { data: existing, error: existingErr } = await supabase
        .from('attendance')
        .select('id, group_id, status, check_in_time, date')
        .eq('student_id', input.student_id)
        .eq('date', input.date)
        .maybeSingle();

      if (existingErr) {
        return { data: null, error: `Error checking existing attendance: ${existingErr.message}` };
      }

      if (existing && existing.group_id && existing.group_id !== input.group_id) {
        return {
          data: null,
          error: `Conflict: Student already has attendance on ${input.date} recorded under a different group.`,
        };
      }

      // 3. Determine check_in_time with strict Africa/Cairo rules:
      // - Absent/Excused always have NULL check_in_time
      // - Present <-> Late corrections strictly retain original arrival time
      // - Backdated manual entries (date < today) NEVER receive today's time
      // - Future attendance (date > today) NEVER receive today's time
      // - Today's entries receive current Cairo time if no prior arrival time exists
      const cairoToday = getCairoDateString();
      const isToday = input.date === cairoToday;

      let checkInTime: string | null = null;
      if (input.status === 'Absent' || input.status === 'Excused') {
        checkInTime = null;
      } else if (input.status === 'Present' || input.status === 'Late') {
        if (input.check_in_time !== undefined && input.check_in_time !== null && input.check_in_time.trim() !== '') {
          checkInTime = input.check_in_time.trim();
        } else if (existing && existing.check_in_time && (existing.status === 'Present' || existing.status === 'Late')) {
          // Retain original arrival time across Present <-> Late corrections
          checkInTime = existing.check_in_time;
        } else if (isToday) {
          checkInTime = getCairoTimeString();
        } else {
          // Backdated or future dates: do not fabricate current time
          checkInTime = null;
        }
      }

      const payload = {
        student_id: input.student_id,
        group_id: input.group_id,
        date: input.date,
        status: input.status,
        check_in_time: checkInTime,
        scan_method: 'manual',
      };

      // 4. Upsert using unique constraint (student_id, date)
      const { data, error } = await supabase
        .from('attendance')
        .upsert(payload, { onConflict: 'student_id,date' })
        .select('*, students(full_name), groups(name)')
        .single();

      if (error) {
        return { data: null, error: error.message, code: error.code };
      }

      // 5. Log activity
      try {
        await supabase.from('activity_logs').insert([
          {
            title: `Attendance marked (${input.status})`,
            description: `${data.students?.full_name || 'Student'} • ${input.date} (${input.status})`,
            type: 'schedule',
          },
        ]);
      } catch {
        // Logging is best-effort
      }

      const formatted: AttendanceRecord = {
        id: data.id,
        student_id: data.student_id,
        student_name: data.students?.full_name || 'Student',
        class_name: data.groups?.name || 'Class',
        status: data.status,
        check_in_time: data.check_in_time ? data.check_in_time.slice(0, 5) : '-',
        date: data.date,
        method: data.scan_method,
      };

      return { data: formatted, error: null };
    } catch (err: unknown) {
      return {
        data: null,
        error: err instanceof Error && err.message ? err.message : 'Failed to save attendance record',
      };
    }
  },

  /**
   * Records attendance for a student using their QR code hash and target group ID.
   * Calls the atomic Postgres RPC `record_qr_attendance`.
   */
  async recordQRAttendance(
    qrHash: string,
    groupId?: string | null
  ): Promise<ServiceResult<QRAttendanceResult>> {
    if (!isSupabaseConfigured()) {
      return {
        data: null,
        error: 'Supabase credentials are not configured in .env',
      };
    }

    if (!groupId || !groupId.trim()) {
      return {
        data: {
          success: false,
          code: 'GROUP_REQUIRED',
          message: 'A target class group is required before scanning.',
        },
        error: null,
      };
    }

    if (!qrHash || !qrHash.trim()) {
      return {
        data: {
          success: false,
          code: 'EMPTY_TOKEN',
          message: 'QR code token cannot be empty',
        },
        error: null,
      };
    }

    try {
      const { data, error } = await supabase.rpc('record_qr_attendance', {
        p_qr_hash: qrHash.trim(),
        p_group_id: groupId.trim(),
      });

      if (error) {
        return {
          data: null,
          error: error.message,
          code: error.code,
        };
      }

      return {
        data: data as QRAttendanceResult,
        error: null,
      };
    } catch (err: unknown) {
      return {
        data: null,
        error: err instanceof Error && err.message ? err.message : 'Failed to record QR attendance',
      };
    }
  },
};
