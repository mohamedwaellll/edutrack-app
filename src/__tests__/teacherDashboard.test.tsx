// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TeacherDashboard from '../components/TeacherDashboard';
import { adminService } from '../services/adminService';
import { teacherService } from '../services/teacherService';

vi.mock('../services/adminService', () => ({ adminService: { getClasses: vi.fn(), getStudents: vi.fn(), getTeachers: vi.fn() } }));
vi.mock('../services/teacherService', () => ({ teacherService: { getGrades: vi.fn(), getFeedback: vi.fn(), addGrade: vi.fn(), addFeedback: vi.fn() } }));
const groups = [{ id: 'group-a', name: 'Same name', grade_level: 'Grade 8', subject: 'Math', room: 'R1' }, { id: 'group-b', name: 'Same name', grade_level: 'Grade 9', subject: 'Art' }];
const students = [{ id: 'student-a', full_name: 'Mohamed', student_code: 'A', group_id: 'group-a', status: 'active' }, { id: 'student-b', full_name: 'Ali', student_code: 'B', group_id: 'group-b', status: 'active' }, { id: 'student-c', full_name: 'Inactive', group_id: 'group-a', status: 'suspended' }];
const saved = { id: 'server-id', student_id: 'student-a', student_name: 'Mohamed', class_id: 'group-a', class_name: 'Same name', subject: 'Math', assessment_title: 'Saved Quiz', score: 8, max_score: 10, date: '2026-01-01', type: 'quiz' as const };
const ok = (data: unknown) => ({ data, error: null }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminService.getClasses).mockResolvedValue(ok(groups));
  vi.mocked(adminService.getStudents).mockResolvedValue(ok(students));
  vi.mocked(adminService.getTeachers).mockResolvedValue(ok([{ id: 'teacher-a', full_name: 'Teacher A', subject: 'Math' }]));
  vi.mocked(teacherService.getGrades).mockResolvedValue(ok([]));
  vi.mocked(teacherService.getFeedback).mockResolvedValue(ok([]));
});
afterEach(cleanup);
async function openGrade() {
  render(<TeacherDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record Grade' }));
  fireEvent.change(screen.getByLabelText('Assessment title'), { target: { value: 'Saved Quiz' } });
  fireEvent.change(screen.getByLabelText('Score', { exact: true }), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Maximum score'), { target: { value: '10' } });
}
describe('Grades & Feedback UI', () => {
  it('uses group IDs even when names match and excludes other/inactive students', async () => {
    await openGrade();
    const selector = screen.getByLabelText('Student');
    expect(within(selector).getAllByRole('option')).toHaveLength(1);
    expect(within(selector).getByRole('option').textContent).toContain('Mohamed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.change(screen.getByLabelText('Class group'), { target: { value: 'group-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Grade' }));
    expect(within(screen.getByLabelText('Student')).getByRole('option').textContent).toContain('Ali');
  });
  it('keeps the form and entered values on save failure, without a fake ledger row', async () => {
    vi.mocked(teacherService.addGrade).mockResolvedValue({ data: null, error: 'Permission denied' });
    await openGrade();
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Assessment title') as HTMLInputElement).value).toBe('Saved Quiz');
    expect(screen.queryByRole('table')).toBeNull();
    expect(teacherService.addGrade).toHaveBeenCalledWith(expect.objectContaining({ student_id: 'student-a', class_id: 'group-a' }));
  });
  it('prevents repeated pending submits and displays only the confirmed row; refresh reloads it', async () => {
    let finish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(teacherService.addGrade).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openGrade();
    const form = screen.getByRole('button', { name: 'Save Grade' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(teacherService.addGrade).toHaveBeenCalledTimes(1);
    finish(ok(saved));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('table')).getByText('80.0%')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Group summary' })).getByText('80.0%')).toBeTruthy();
    vi.mocked(teacherService.getGrades).mockResolvedValue(ok([saved]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Saved Quiz')).toBeTruthy();
    expect(teacherService.getGrades).toHaveBeenCalledTimes(2);
  });
  it('saves the selected feedback author and internal visibility', async () => {
    vi.mocked(teacherService.addFeedback).mockResolvedValue(ok({ id: 'note-1', student_id: 'student-a', student_name: 'Mohamed', teacher_id: 'teacher-a', teacher_name: 'Teacher A', feedback_text: 'Private note', is_parent_visible: false, date: '2026-01-01' }));
    render(<TeacherDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
    fireEvent.change(screen.getByLabelText('Teacher', { exact: true }), { target: { value: 'teacher-a' } });
    fireEvent.change(screen.getByLabelText('Feedback text'), { target: { value: 'Private note' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Feedback' }));
    expect(await screen.findByText('Internal only')).toBeTruthy();
    expect(teacherService.addFeedback).toHaveBeenCalledWith({ student_id: 'student-a', teacher_id: 'teacher-a', feedback_text: 'Private note', is_parent_visible: false });
  });
  it('shows a load error and retries instead of presenting sample data', async () => {
    vi.mocked(teacherService.getGrades).mockResolvedValueOnce({ data: null, error: 'Connection failed' });
    render(<TeacherDashboard />);
    expect((await screen.findByRole('alert')).textContent).toContain('Connection failed');
    expect(screen.queryByRole('button', { name: 'Record Grade' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No grades recorded for this group.')).toBeTruthy();
  });
});
