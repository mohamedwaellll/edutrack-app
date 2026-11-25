import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Award, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { teacherService } from '../services/teacherService';
import { adminService } from '../services/adminService';
import { getCairoDateString } from '../services/attendanceService';
import { useOptionalAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import { translateGradeType } from '../i18n/translations';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';
import type { GradeRecord, TeacherFeedback, GroupClass, Student, Teacher } from '../types/database';

interface TeacherDashboardProps { onSwitchToAdmin?: () => void; teacherName?: string; mutationsDisabled?: boolean }
const panel = 'bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 space-y-4';
const input = 'w-full px-3 py-2.5 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#174E50] dark:focus:ring-teal-400';
const button = 'px-4 py-2.5 rounded-full bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition cursor-pointer';

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ onSwitchToAdmin, mutationsDisabled = false }) => {
  const auth = useOptionalAuth();
  const { language, t } = usePreferences();
  const isSessionRevalidating = Boolean(mutationsDisabled || auth?.isRevalidating);
  const isSessionRevalidatingRef = useRef(isSessionRevalidating);
  useEffect(() => {
    isSessionRevalidatingRef.current = isSessionRevalidating;
  }, [isSessionRevalidating]);

  const [classes, setClasses] = useState<GroupClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [feedbacks, setFeedbacks] = useState<TeacherFeedback[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'grade' | 'feedback' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const [studentId, setStudentId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [title, setTitle] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [date, setDate] = useState(getCairoDateString);
  const [gradeType, setGradeType] = useState<GradeRecord['type']>('exam');
  const [notes, setNotes] = useState('');
  const [parentVisible, setParentVisible] = useState(true);

  const fetchDashboardSnapshot = useCallback(async () => {
    const [cls, std, tch, grd, fb] = await Promise.all([
      adminService.getClasses(), adminService.getStudents(), adminService.getTeachers(),
      teacherService.getGrades(), teacherService.getFeedback(),
    ]);
    const failed = [cls, std, tch, grd, fb].find(result => result.error);
    if (failed) throw new Error(failed.error!);
    return {
      classes: cls.data ?? [],
      students: std.data ?? [],
      teachers: tch.data ?? [],
      grades: grd.data ?? [],
      feedbacks: fb.data ?? [],
    };
  }, []);

  const applyDashboardSnapshot = useCallback((snapshot: {
    classes: GroupClass[];
    students: Student[];
    teachers: Teacher[];
    grades: GradeRecord[];
    feedbacks: TeacherFeedback[];
  }) => {
    setClasses(snapshot.classes);
    setStudents(snapshot.students);
    setTeachers(snapshot.teachers);
    setGrades(snapshot.grades);
    setFeedbacks(snapshot.feedbacks);
    setError(null);
    setSelectedClass(previous =>
      snapshot.classes.some(group => group.id === previous) ? previous : snapshot.classes[0]?.id ?? ''
    );
  }, []);

  async function loadData() {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchDashboardSnapshot();
      if (request !== generation.current) return;
      applyDashboardSnapshot(snapshot);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load records. Please retry.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    const genRef = generation;
    const request = ++genRef.current;
    fetchDashboardSnapshot()
      .then((snapshot) => {
        if (request !== genRef.current) return;
        applyDashboardSnapshot(snapshot);
      })
      .catch((cause) => {
        if (request === genRef.current) setError(cause instanceof Error ? cause.message : 'Could not load records. Please retry.');
      })
      .finally(() => {
        if (request === genRef.current) setLoading(false);
      });
    return () => { genRef.current++; };
  }, [fetchDashboardSnapshot, applyDashboardSnapshot]);

  useEffect(() => {
    if (!modal) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !savingRef.current) setModal(null);
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]') ?? [])
        .filter(control => !control.matches(':disabled'));
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [modal]);

  const group = classes.find(item => item.id === selectedClass);
  const groupStudents = students.filter(student => student.group_id === selectedClass);
  const activeStudents = groupStudents.filter(student => student.status === 'active');
  const filteredGrades = grades.filter(grade => grade.class_id === selectedClass);
  const filteredFeedback = feedbacks.filter(feedback => groupStudents.some(student => student.id === feedback.student_id));
  const validGrades = filteredGrades.filter(grade => grade.max_score > 0 && Number.isFinite(grade.score) && Number.isFinite(grade.max_score));
  const average = validGrades.length ? (validGrades.reduce((sum, grade) => sum + grade.score / grade.max_score * 100, 0) / validGrades.length).toFixed(1) : null;
  const blocked = loading || !!error || !group || !activeStudents.length;

  function openModal(kind: 'grade' | 'feedback') {
    setStudentId(activeStudents[0]?.id ?? '');
    setTeacherId(group?.teacher_id ?? '');
    setTitle(''); setScore(''); setMaxScore('100'); setDate(getCairoDateString());
    setGradeType('exam'); setNotes(''); setParentVisible(true);
    setFormError(null); setNotice(''); setModal(kind);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (isSessionRevalidatingRef.current) {
      setFormError(t('errRevalidatingBeforeSave'));
      return;
    }
    if (savingRef.current || !modal) return;
    if (!group || !activeStudents.some(student => student.id === studentId)) {
      setFormError('Choose an active student in the selected group.'); return;
    }
    savingRef.current = true;
    setSaving(true); setFormError(null);
    const request = generation.current;
    try {
      if (modal === 'grade') {
        if (!score.trim() || !maxScore.trim()) throw new Error('Enter the score and maximum score.');
        const result = await teacherService.addGrade({
          student_id: studentId, class_id: group.id, assessment_title: title,
          score: Number(score), max_score: Number(maxScore), date, type: gradeType, notes,
        });
        if (request !== generation.current) return;
        if (result.error || !result.data) throw new Error(result.error || 'Grade was not returned. Refresh before retrying.');
        setGrades(previous => [result.data!, ...previous]);
        setNotice(language === 'ar' ? 'تم حفظ الدرجة في قاعدة البيانات.' : 'Grade saved to the database.');
      } else {
        if (!teachers.some(teacher => teacher.id === teacherId)) throw new Error('Choose the teacher who provided this feedback.');
        const result = await teacherService.addFeedback({ student_id: studentId, teacher_id: teacherId, feedback_text: notes, is_parent_visible: parentVisible });
        if (request !== generation.current) return;
        if (result.error || !result.data) throw new Error(result.error || 'Feedback was not returned. Refresh before retrying.');
        setFeedbacks(previous => [result.data!, ...previous]);
        setNotice(language === 'ar' ? 'تم حفظ الملاحظة في قاعدة البيانات.' : 'Feedback saved to the database.');
      }
      setModal(null);
    } catch (cause) {
      if (request === generation.current) setFormError(cause instanceof Error ? cause.message : 'Save failed. Please try again.');
    } finally {
      savingRef.current = false;
      if (request === generation.current) setSaving(false);
    }
  }

  const gradeTableHeaders = [
    t('thStudentSimple'),
    t('thAssessmentSimple'),
    t('thDateSimple'),
    t('thTypeSimple'),
    t('thScoreSimple'),
    t('thPercentageSimple'),
    t('thRemarksSimple'),
  ];

  return (
    <div className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 font-sans">
      <main className="max-w-7xl mx-auto p-4 md:p-10 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#174E50] dark:text-teal-300 font-bold mb-2">
              <BrandMark className="w-6 h-6" /> {t('brandName')}
            </div>
            <h1 className="text-3xl font-extrabold text-[#17213B] dark:text-white">{t('navGradesFeedback')}</h1>
            <p className="text-sm text-[#7B8794] dark:text-slate-400 mt-1">{t('tdSubtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DisplayControls variant="surface" />
            {onSwitchToAdmin && (
              <button className={button} onClick={onSwitchToAdmin} disabled={saving}>
                <ArrowLeft size={16} className="rtl:rotate-180" /> {t('backToAdminBtn')}
              </button>
            )}
            <button className={button} onClick={() => { setNotice(''); void loadData(); }} disabled={loading || saving || !!modal}>
              <RefreshCw size={16} /> {t('refresh')}
            </button>
          </div>
        </header>
        {isSessionRevalidating && (
          <p data-testid="teacher-revalidating-banner" role="status" className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 text-sm font-semibold">
            {t('tdRevalidating')}
          </p>
        )}
        {loading && <p role="status">{t('tdLoadingSaved')}</p>}
        {error && <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-rose-950/40 text-red-800 dark:text-rose-200">{error} <button className="underline ms-2" onClick={() => void loadData()}>{t('retry')}</button></div>}
        {notice && <p role="status" className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">{notice}</p>}
        {!loading && !error && <>
          <section className={panel}>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex-1 min-w-0 space-y-1 text-sm font-semibold">{t('tdClassGroupLabel')}
                <select className={input} value={selectedClass} disabled={saving || !!modal} onChange={event => { setSelectedClass(event.target.value); setNotice(''); }}>
                  {!classes.length && <option value="">{t('tdNoGroupsAvailable')}</option>}
                  {classes.map(item => <option key={item.id} value={item.id}>{item.name} ({item.grade_level})</option>)}
                </select>
              </label>
              <button className={button} disabled={blocked} onClick={() => openModal('grade')}><Plus size={16} /> {t('tdRecordGradeBtn')}</button>
              <button className={button} disabled={blocked || !teachers.length} onClick={() => openModal('feedback')}><MessageSquare size={16} /> {t('tdAddFeedbackBtn')}</button>
            </div>
            <p className="text-sm text-[#7B8794] dark:text-slate-400">
              {group ? [group.subject || t('tdNoSubjectAssigned'), group.room || t('tdNoRoomAssigned')].join(' • ') : t('tdCreateGroupPrompt')}
            </p>
            {group && !activeStudents.length && <p>{t('tdNoActiveStudentsInGroup')}</p>}
            {!teachers.length && <p>{t('tdNoTeachersForFeedback')}</p>}
          </section>
          <section className="grid sm:grid-cols-3 gap-4" aria-label="Group summary">
            <div className={panel}><p>{t('tdStudentsInGroupStat')}</p><strong className="text-3xl">{groupStudents.length}</strong></div>
            <div className={panel}><p>{t('tdAvgPercentageStat')}</p><strong className="text-3xl">{average === null ? '—' : `${average}%`}</strong><p className="text-xs text-[#7B8794] dark:text-slate-400">{t('tdEqualWeightHint')}</p></div>
            <div className={panel}><p>{t('tdSavedAssessmentsStat')}</p><strong className="text-3xl">{filteredGrades.length}</strong></div>
          </section>
          <section className={panel}>
            <h2 className="font-bold text-lg flex gap-2 items-center"><Award size={20} /> {t('gradesLedgerHeading')}</h2>
            {!filteredGrades.length ? <p>{t('tdNoGradesForGroup')}</p> : <div className="overflow-x-auto">
              <table className="w-full text-start text-sm"><thead className="bg-[#D8E8DC]/40 dark:bg-slate-800/80"><tr>
                {gradeTableHeaders.map(label => <th key={label} className="p-3">{label}</th>)}
              </tr></thead><tbody>
                {filteredGrades.map(grade => <tr key={grade.id} className="border-b border-[#E6E8E2] dark:border-slate-800">
                  <td className="p-3 font-semibold">{grade.student_name}</td><td className="p-3">{grade.assessment_title}</td>
                  <td className="p-3 whitespace-nowrap">{grade.date}</td><td className="p-3">{translateGradeType(language, grade.type)}</td>
                  <td dir="ltr" className="p-3 whitespace-nowrap tabular-nums">{grade.score} / {grade.max_score}</td>
                  <td className="p-3">{grade.max_score > 0 ? `${(grade.score / grade.max_score * 100).toFixed(1)}%` : '—'}</td>
                  <td className="p-3 break-words">{grade.notes || '—'}</td>
                </tr>)}
              </tbody></table>
            </div>}
          </section>
          <section className={panel}>
            <h2 className="font-bold text-lg">{t('tdFeedbackLogHeading')}</h2>
            <p className="text-xs text-[#7B8794] dark:text-slate-400">{t('tdParentVisHint')}</p>
            {!filteredFeedback.length ? <p>{t('tdNoFeedbackForGroup')}</p> : <div className="grid md:grid-cols-2 gap-4">
              {filteredFeedback.map(feedback => <article key={feedback.id} className="border border-[#E6E8E2] dark:border-slate-800 rounded-2xl p-4 space-y-3 bg-[#F8F7F2]/40 dark:bg-[#0D1520]">
                <div className="flex flex-wrap justify-between gap-2"><strong>{feedback.student_name}</strong><span className="text-xs rounded-full bg-[#D8E8DC] dark:bg-teal-950/70 text-[#174E50] dark:text-teal-200 px-3 py-1">{feedback.is_parent_visible ? t('tdParentVisEnabled') : t('tdInternalOnly')}</span></div>
                <p className="whitespace-pre-wrap break-words">{feedback.feedback_text}</p>
                <p className="text-xs text-[#7B8794] dark:text-slate-400">{feedback.teacher_name} • {feedback.date}</p>
              </article>)}
            </div>}
          </section>
        </>}
      </main>
      {modal && <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="assessment-dialog-title" className={`${panel} w-full max-w-lg max-h-[90vh] overflow-y-auto`}>
          <h2 id="assessment-dialog-title" className="font-bold text-xl">{modal === 'grade' ? t('tdModalRecordGradeTitle') : t('tdModalAddFeedbackTitle')}</h2>
          <p className="text-sm">{group?.name}</p>
          <form onSubmit={save}>
            <fieldset disabled={saving} className="space-y-4 text-sm">
              {formError && <p role="alert" className="p-3 rounded-xl bg-red-50 dark:bg-rose-950/50 text-red-800 dark:text-rose-200">{formError}</p>}
              <label className="block space-y-1">{t('tdStudentField')}<select autoFocus required className={input} value={studentId} onChange={event => setStudentId(event.target.value)}>
                {activeStudents.map(student => <option key={student.id} value={student.id}>{student.full_name} ({student.student_code})</option>)}
              </select></label>
              {modal === 'grade' ? <>
                <label className="block space-y-1">{t('tdAssessmentTitleLabel')}<input className={input} required value={title} onChange={event => setTitle(event.target.value)} /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">{t('scoreLabel')}<input className={input} type="number" required min="0" max={maxScore || '999.99'} step="0.01" value={score} onChange={event => setScore(event.target.value)} /></label>
                  <label className="block space-y-1">{t('tdMaxScoreLabel')}<input className={input} type="number" required min="0.01" max="999.99" step="0.01" value={maxScore} onChange={event => setMaxScore(event.target.value)} /></label>
                </div>
                <label className="block space-y-1">{t('assessmentDateCairoLabel')}<input className={input} type="date" required max={getCairoDateString()} value={date} onChange={event => setDate(event.target.value)} /></label>
                <label className="block space-y-1">{t('categoryLabel')}<select className={input} value={gradeType} onChange={event => setGradeType(event.target.value as GradeRecord['type'])}>
                  <option value="exam">{t('catExam')}</option><option value="quiz">{t('catQuiz')}</option><option value="assignment">{t('catAssignment')}</option><option value="participation">{t('catParticipation')}</option>
                </select></label>
              </> : <label className="block space-y-1">{t('tdTeacherField')}<select className={input} required value={teacherId} onChange={event => setTeacherId(event.target.value)}>
                <option value="">{t('tdSelectFeedbackAuthor')}</option>
                {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.full_name} — {teacher.subject}</option>)}
              </select></label>}
              <label className="block space-y-1">{modal === 'grade' ? t('remarksOptionalLabel') : t('tdFeedbackTextLabel')}<textarea className={input} rows={3} required={modal === 'feedback'} value={notes} onChange={event => setNotes(event.target.value)} /></label>
              {modal === 'feedback' && <label className="flex gap-2 items-center"><input type="checkbox" checked={parentVisible} onChange={event => setParentVisible(event.target.checked)} /> {t('tdAllowParentVisLabel')}</label>}
              <div className="flex justify-end gap-3"><button type="button" className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700" onClick={() => setModal(null)}>{t('cancel')}</button><button type="submit" disabled={saving || isSessionRevalidating} className={button}>{saving ? t('tdSaving') : modal === 'grade' ? t('saveGradeBtn') : t('tdSaveFeedbackBtn')}</button></div>
            </fieldset>
          </form>
        </div>
      </div>}
    </div>
  );
};
export default TeacherDashboard;
