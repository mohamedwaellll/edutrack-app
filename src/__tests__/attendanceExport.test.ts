import { describe, expect, it } from 'vitest';
import { buildAttendanceCsv } from '../services/attendanceExport';
import type { AttendanceRosterItem } from '../services/attendanceService';

const row: AttendanceRosterItem = {
  student_id: 'student-1',
  student_name: 'يوسف "طارق", الأول',
  student_code: 'ET-F-101',
  group_id: 'group-1',
  attendance_id: null,
  status: 'Not marked',
  check_in_time: null,
  date: '2026-11-24',
};

describe('buildAttendanceCsv', () => {
  it('includes Arabic text, escapes delimiters and keeps unmarked students distinct from absences', () => {
    const csv = buildAttendanceCsv([row], 'المجموعة أ', 'ar');

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"وقت الوصول"\r\n');
    expect(csv).toContain('"يوسف ""طارق"", الأول","ET-F-101"');
    expect(csv).toContain('"لم يُسجل",""');
  });

  it('writes Cairo check-in times and treats formula-like names as literal text', () => {
    const csv = buildAttendanceCsv(
      [{ ...row, student_name: ' =2+2', status: 'Late', check_in_time: '08:42:15' }],
      'Physics',
      'en'
    );

    expect(csv).toContain('"2026-11-24","Physics","\' =2+2","ET-F-101","Late","08:42"');
  });
});
