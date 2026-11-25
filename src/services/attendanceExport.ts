import { translate, translateAttendanceStatus, type Language } from '../i18n/translations';
import type { AttendanceRosterItem } from './attendanceService';

function csvCell(value: string): string {
  const safeValue = /^\s*[=+@-]/u.test(value) ? "'" + value : value;
  return '"' + safeValue.replace(/"/g, '""') + '"';
}

export function buildAttendanceCsv(
  roster: readonly AttendanceRosterItem[],
  groupName: string,
  language: Language
): string {
  const headers = [
    translate(language, 'dateCairoLabel'),
    translate(language, 'colClass'),
    translate(language, 'colStudentUpper'),
    translate(language, 'colCodeUpper'),
    translate(language, 'colCurrentStatus'),
    translate(language, 'colCheckInTime'),
  ];
  const rows = roster.map((student) => [
    student.date,
    groupName,
    student.student_name,
    student.student_code,
    translateAttendanceStatus(language, student.status),
    student.check_in_time?.slice(0, 5) ?? '',
  ]);

  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadAttendanceCsv(
  roster: readonly AttendanceRosterItem[],
  groupName: string,
  date: string,
  language: Language
) {
  const file = new Blob([buildAttendanceCsv(roster, groupName, language)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `attendance-${date}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
