import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  attendanceService, 
  getCairoDateString, 
  getCairoTimeString 
} from '../services/attendanceService';
import { supabase } from '../lib/supabaseClient';

vi.mock('../lib/supabaseClient', () => {
  return {
    isSupabaseConfigured: vi.fn(() => true),
    supabase: {
      from: vi.fn(),
      rpc: vi.fn(),
    },
  };
});

describe('Manual Attendance Service Unit Tests (Milestone 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Africa/Cairo Date & Time Utilities', () => {
    it('formats dates consistently in Africa/Cairo (YYYY-MM-DD)', () => {
      // 2026-11-19T00:30:00Z is 02:30:00 AM on 2026-11-19 in Cairo (UTC+2)
      const d1 = new Date('2026-11-19T00:30:00Z');
      expect(getCairoDateString(d1)).toBe('2026-11-19');

      // 2026-11-18T22:30:00Z is 00:30:00 AM on 2026-11-19 in Cairo (UTC+2)
      const d2 = new Date('2026-11-18T22:30:00Z');
      expect(getCairoDateString(d2)).toBe('2026-11-19');

      // 2026-11-18T21:30:00Z is 23:30:00 PM on 2026-11-18 in Cairo (UTC+2)
      const d3 = new Date('2026-11-18T21:30:00Z');
      expect(getCairoDateString(d3)).toBe('2026-11-18');
    });

    it('formats times in Africa/Cairo timezone (HH:mm:ss)', () => {
      const d = new Date('2026-11-19T10:15:30Z');
      const time = getCairoTimeString(d);
      expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('getGroupRosterAttendance', () => {
    it('shows students without an existing log as "Not marked" rather than Absent', async () => {
      const mockStudents = [
        { id: 'student-1', full_name: 'Ahmed Ali', student_code: 'ET-1001', group_id: 'group-1', groups: { name: 'Grade 8A' } },
        { id: 'student-2', full_name: 'Mona Youssef', student_code: 'ET-1002', group_id: 'group-1', groups: { name: 'Grade 8A' } },
      ];

      const mockAttendanceLogs = [
        { id: 'att-1', student_id: 'student-1', group_id: 'group-1', date: '2026-11-19', status: 'Present', check_in_time: '08:15:00' }
      ];

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockStudents, error: null }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: mockAttendanceLogs, error: null }),
          };
        }
        return {};
      });

      const res = await attendanceService.getGroupRosterAttendance('group-1', '2026-11-19');
      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(2);

      // Student 1 has record
      expect(res.data![0].student_id).toBe('student-1');
      expect(res.data![0].status).toBe('Present');
      expect(res.data![0].check_in_time).toBe('08:15:00');

      // Student 2 has no record -> Must be 'Not marked', NEVER silently 'Absent'
      expect(res.data![1].student_id).toBe('student-2');
      expect(res.data![1].status).toBe('Not marked');
      expect(res.data![1].check_in_time).toBeNull();
      expect(res.data![1].attendance_id).toBeNull();
    });

    it('surfaces failed database queries explicitly instead of returning false empty', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Connection timeout', code: 'ETIMEDOUT' } }),
          };
        }
        return {};
      });

      const res = await attendanceService.getGroupRosterAttendance('group-1', '2026-11-19');
      expect(res.data).toBeNull();
      expect(res.error).toContain('Connection timeout');
    });
  });

  describe('saveStudentAttendance', () => {
    it('validates that student belongs to the selected group', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-ACTUAL', full_name: 'Test Student' },
              error: null,
            }),
          };
        }
        return {};
      });

      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-WRONG',
        date: '2026-11-19',
        status: 'Present',
      });

      expect(res.data).toBeNull();
      expect(res.error).toContain('Student does not belong to the selected group');
    });

    it('rejects conflict if student already has attendance under a different group', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-1', full_name: 'Test Student' },
              error: null,
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'att-old', group_id: 'group-DIFFERENT', status: 'Present' },
              error: null,
            }),
          };
        }
        return {};
      });

      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-1',
        date: '2026-11-19',
        status: 'Present',
      });

      expect(res.data).toBeNull();
      expect(res.error).toContain('Conflict');
    });

    it('persists Absent / Excused with NULL check_in_time (no fabricated time)', async () => {
      let insertedPayload: any = null;

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-1', full_name: 'Test Student' },
              error: null,
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockImplementation((payload: any) => {
              insertedPayload = payload;
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'att-1',
                    student_id: 'student-1',
                    group_id: 'group-1',
                    date: '2026-11-19',
                    status: 'Absent',
                    check_in_time: null,
                    scan_method: 'manual',
                    students: { full_name: 'Test Student' },
                    groups: { name: 'Grade 8A' },
                  },
                  error: null,
                }),
              };
            }),
          };
        }
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-1',
        date: '2026-11-19',
        status: 'Absent',
      });

      expect(res.error).toBeNull();
      expect(insertedPayload.check_in_time).toBeNull();
      expect(insertedPayload.scan_method).toBe('manual');
      expect(res.data?.status).toBe('Absent');
      expect(res.data?.check_in_time).toBe('-');
    });

    it('updates status without duplicate rows and sets Cairo check_in_time for Present', async () => {
      let upsertOptions: any = null;

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-1', full_name: 'Test Student' },
              error: null,
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'att-1', group_id: 'group-1', status: 'Absent' },
              error: null,
            }),
            upsert: vi.fn().mockImplementation((payload: any, options: any) => {
              upsertOptions = options;
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'att-1', // Same ID updated
                    student_id: 'student-1',
                    group_id: 'group-1',
                    date: '2026-11-19',
                    status: 'Present',
                    check_in_time: '08:30:00',
                    scan_method: 'manual',
                    students: { full_name: 'Test Student' },
                    groups: { name: 'Grade 8A' },
                  },
                  error: null,
                }),
              };
            }),
          };
        }
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-1',
        date: '2026-11-19',
        status: 'Present',
      });

      expect(res.error).toBeNull();
      // Verifies onConflict target preserves UNIQUE(student_id, date) contract
      expect(upsertOptions).toEqual({ onConflict: 'student_id,date' });
      expect(res.data?.id).toBe('att-1');
      expect(res.data?.status).toBe('Present');
      expect(res.data?.check_in_time).toBe('08:30');
    });

    it('returns error on failed database write without reporting false success', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-1', full_name: 'Test Student' },
              error: null,
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database write failed: RLS permission denied', code: '42501' },
              }),
            }),
          };
        }
        return {};
      });

      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-1',
        date: '2026-11-19',
        status: 'Present',
      });

      expect(res.data).toBeNull();
      expect(res.error).toBe('Database write failed: RLS permission denied');
    });
  });

  describe('recordQRAttendance (Milestone 3)', () => {
    it('rejects empty or whitespace-only tokens before database call', async () => {
      const resEmpty = await attendanceService.recordQRAttendance('', 'group-1');
      expect(resEmpty.data?.success).toBe(false);
      expect(resEmpty.data?.code).toBe('EMPTY_TOKEN');

      const resWhitespace = await attendanceService.recordQRAttendance('   ', 'group-1');
      expect(resWhitespace.data?.success).toBe(false);
      expect(resWhitespace.data?.code).toBe('EMPTY_TOKEN');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('successfully calls record_qr_attendance RPC and returns RECORDED result', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: {
          success: true,
          code: 'RECORDED',
          message: 'Check-in confirmed for Omar Sherif at 08:30',
          attendance: {
            id: 'att-qr-1',
            student_id: 'student-1',
            student_name: 'Omar Sherif',
            student_code: 'ET-1001',
            group_id: 'group-1',
            status: 'Present',
            check_in_time: '08:30',
            date: '2026-11-20',
            method: 'qr',
          },
        },
        error: null,
      });

      const res = await attendanceService.recordQRAttendance('QR-OMAR-001', 'group-1');
      expect(supabase.rpc).toHaveBeenCalledWith('record_qr_attendance', {
        p_qr_hash: 'QR-OMAR-001',
        p_group_id: 'group-1',
      });
      expect(res.error).toBeNull();
      expect(res.data?.success).toBe(true);
      expect(res.data?.code).toBe('RECORDED');
      expect(res.data?.attendance?.check_in_time).toBe('08:30');
    });

    it('returns ALREADY_RECORDED response when student is scanned twice', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: {
          success: true,
          code: 'ALREADY_RECORDED',
          message: 'Already recorded today for Omar Sherif at 08:30 (Present)',
          attendance: {
            id: 'att-qr-1',
            student_id: 'student-1',
            student_name: 'Omar Sherif',
            student_code: 'ET-1001',
            group_id: 'group-1',
            status: 'Present',
            check_in_time: '08:30',
            date: '2026-11-20',
            method: 'qr',
          },
        },
        error: null,
      });

      const res = await attendanceService.recordQRAttendance('QR-OMAR-001', 'group-1');
      expect(res.error).toBeNull();
      expect(res.data?.success).toBe(true);
      expect(res.data?.code).toBe('ALREADY_RECORDED');
      expect(res.data?.message).toContain('Already recorded today');
    });

    it('handles GROUP_MISMATCH when student belongs to another class', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: {
          success: false,
          code: 'GROUP_MISMATCH',
          message: 'Student "Omar Sherif" belongs to a different class group',
        },
        error: null,
      });

      const res = await attendanceService.recordQRAttendance('QR-OMAR-001', 'different-group');
      expect(res.error).toBeNull();
      expect(res.data?.success).toBe(false);
      expect(res.data?.code).toBe('GROUP_MISMATCH');
    });

    it('handles RPC database errors gracefully', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: null,
        error: { message: 'Unauthorized: Only administrators can record QR attendance', code: '42501' },
      });

      const res = await attendanceService.recordQRAttendance('QR-OMAR-001', 'group-1');
      expect(res.data).toBeNull();
      expect(res.error).toContain('Unauthorized');
    });

    it('rejects call when groupId is null, empty or missing', async () => {
      const resNull = await attendanceService.recordQRAttendance('QR-OMAR-001', null as any);
      expect(resNull.data?.success).toBe(false);
      expect(resNull.data?.code).toBe('GROUP_REQUIRED');

      const resEmpty = await attendanceService.recordQRAttendance('QR-OMAR-001', '   ');
      expect(resEmpty.data?.success).toBe(false);
      expect(resEmpty.data?.code).toBe('GROUP_REQUIRED');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('handles HISTORICAL_GROUP_MISMATCH from RPC', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: {
          success: false,
          code: 'HISTORICAL_GROUP_MISMATCH',
          message: 'Conflict: Student Omar Sherif already has attendance recorded today under a different group',
        },
        error: null,
      });

      const res = await attendanceService.recordQRAttendance('QR-OMAR-001', 'group-1');
      expect(res.data?.success).toBe(false);
      expect(res.data?.code).toBe('HISTORICAL_GROUP_MISMATCH');
    });

    it('strictly retains original arrival time on Present <-> Late status correction in saveStudentAttendance', async () => {
      let upsertPayload: any = null;
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-1', full_name: 'Omar Sherif' },
              error: null,
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'att-existing-1',
                group_id: 'group-1',
                status: 'Present',
                check_in_time: '08:14:00', // Original arrival time
                date: '2026-11-19',
              },
              error: null,
            }),
            upsert: vi.fn().mockImplementation((payload) => {
              upsertPayload = payload;
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'att-existing-1',
                    student_id: 'student-1',
                    group_id: 'group-1',
                    status: 'Late',
                    check_in_time: '08:14:00',
                    date: '2026-11-19',
                    scan_method: 'manual',
                    students: { full_name: 'Omar Sherif' },
                    groups: { name: 'Grade 8A' },
                  },
                  error: null,
                }),
              };
            }),
          };
        }
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      // Update from Present to Late without supplying check_in_time
      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-1',
        date: '2026-11-19',
        status: 'Late',
      });

      expect(res.error).toBeNull();
      // Payload MUST preserve original 08:14:00 and not overwrite with current time!
      expect(upsertPayload.check_in_time).toBe('08:14:00');
      expect(upsertPayload.status).toBe('Late');
    });

    it('does NOT fabricate current arrival time for backdated manual attendance (date < today)', async () => {
      let upsertPayload: any = null;
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-1', full_name: 'Omar Sherif' },
              error: null,
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockImplementation((payload) => {
              upsertPayload = payload;
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'att-backdated-1',
                    student_id: 'student-1',
                    group_id: 'group-1',
                    status: 'Present',
                    check_in_time: null,
                    date: '2026-10-01',
                    scan_method: 'manual',
                  },
                  error: null,
                }),
              };
            }),
          };
        }
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-1',
        date: '2026-10-01', // Backdated
        status: 'Present',
      });

      expect(res.error).toBeNull();
      // Backdated manual entry must have check_in_time === null
      expect(upsertPayload.check_in_time).toBeNull();
    });

    it('does NOT fabricate current arrival time for future manual attendance (date > today)', async () => {
      let upsertPayload: any = null;
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'student-1', group_id: 'group-1', full_name: 'Omar Sherif' },
              error: null,
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockImplementation((payload) => {
              upsertPayload = payload;
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'att-future-1',
                    student_id: 'student-1',
                    group_id: 'group-1',
                    status: 'Late',
                    check_in_time: null,
                    date: '2026-12-31',
                    scan_method: 'manual',
                  },
                  error: null,
                }),
              };
            }),
          };
        }
        if (table === 'activity_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const res = await attendanceService.saveStudentAttendance({
        student_id: 'student-1',
        group_id: 'group-1',
        date: '2026-12-31', // Future
        status: 'Late',
      });

      expect(res.error).toBeNull();
      expect(upsertPayload.check_in_time).toBeNull();
    });
  });
});
