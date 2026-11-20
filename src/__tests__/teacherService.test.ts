import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teacherService, type CreateGradeInput } from '../services/teacherService';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

vi.mock('../lib/supabaseClient', () => ({ supabase: { from: vi.fn() }, isSupabaseConfigured: vi.fn() }));
const studentId = 'd1111111-1111-4111-8111-111111111111';
const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = '11111111-1111-4111-8111-111111111111';
const grade: CreateGradeInput = { student_id: studentId, class_id: groupId, assessment_title: ' Quiz ', score: 8, max_score: 10, date: '2026-01-01', type: 'quiz' };

function queryResult(data: unknown, error: { message: string } | null = null) {
  const result = Promise.resolve({ data, error });
  const query = { select: vi.fn(), order: vi.fn(), eq: vi.fn(), insert: vi.fn(), single: vi.fn(), then: result.then.bind(result) };
  for (const name of ['select', 'order', 'eq', 'insert', 'single'] as const) query[name].mockReturnValue(query);
  vi.mocked(supabase.from).mockReturnValue(query as never);
  return query;
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isSupabaseConfigured).mockReturnValue(true); });

describe('Live grades and feedback service', () => {
  it('fails explicitly when unconfigured and never simulates successful saves', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    for (const result of await Promise.all([
      teacherService.getGrades(), teacherService.getFeedback(), teacherService.addGrade(grade),
      teacherService.addFeedback({ teacher_id: teacherId, student_id: studentId, feedback_text: 'Good', is_parent_visible: false }),
    ])) { expect(result.data).toBeNull(); expect(result.error).toContain('not configured'); }
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it('returns empty data without sample records and filters by actual group ID', async () => {
    const query = queryResult([]);
    expect(await teacherService.getGrades(groupId)).toEqual({ data: [], error: null });
    expect(query.eq).toHaveBeenCalledWith('group_id', groupId);
    expect(await teacherService.getFeedback()).toEqual({ data: [], error: null });
  });
  it('reports database failures instead of replacing them with demo rows', async () => {
    queryResult(null, { message: 'Permission denied' });
    expect((await teacherService.getGrades()).error).toBe('Permission denied');
    expect((await teacherService.getFeedback()).error).toBe('Permission denied');
    expect((await teacherService.addGrade(grade)).data).toBeNull();
    expect((await teacherService.addFeedback({ teacher_id: teacherId, student_id: studentId, feedback_text: 'Good', is_parent_visible: true })).error).toBe('Permission denied');
  });
  it.each([
    { score: -1 }, { score: 11 }, { max_score: 0 }, { max_score: 1000 }, { score: NaN },
    { max_score: Infinity }, { assessment_title: ' ' }, { date: '2026-02-30' }, { date: '9999-01-01' }, { class_id: 'cls-1' },
  ])('rejects invalid input before writing: %j', async patch => {
    expect((await teacherService.addGrade({ ...grade, ...patch })).error).toBeTruthy();
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it('returns the server ID and real subject after saving a valid zero score', async () => {
    const query = queryResult({ id: 'saved-grade', student_id: studentId, group_id: groupId, assessment_title: 'Quiz', score: '0.00', max_score: '10.00', assessment_date: grade.date, grade_type: 'quiz', remarks: null, students: { full_name: 'Mohamed' }, groups: { name: 'Test', subject: 'Math' } });
    const result = await teacherService.addGrade({ ...grade, score: 0 });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ group_id: groupId, student_id: studentId, assessment_title: 'Quiz', score: 0 }));
    expect(result.data).toMatchObject({ id: 'saved-grade', subject: 'Math', score: 0 });
  });
  it('keeps private feedback private and formats its date in Cairo', async () => {
    const query = queryResult({ id: 'saved-note', student_id: studentId, teacher_id: teacherId, feedback_text: 'Good work', is_parent_visible: false, created_at: '2026-01-01T23:30:00Z', students: { full_name: 'Mohamed' }, teachers: { full_name: 'Teacher' } });
    const result = await teacherService.addFeedback({ student_id: studentId, teacher_id: teacherId, feedback_text: ' Good work ', is_parent_visible: false });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ feedback_text: 'Good work', is_parent_visible: false, teacher_id: teacherId }));
    expect(result.data).toMatchObject({ id: 'saved-note', is_parent_visible: false, date: '2026-01-02' });
  });
  it('rejects a blank note and a fabricated teacher ID', async () => {
    for (const patch of [{ feedback_text: ' ' }, { teacher_id: 't-1' }]) {
      expect((await teacherService.addFeedback({ student_id: studentId, teacher_id: teacherId, feedback_text: 'Good', is_parent_visible: false, ...patch })).error).toBeTruthy();
    }
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
