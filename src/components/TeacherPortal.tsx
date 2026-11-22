import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Link2Off,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getCairoDateString } from '../services/attendanceService';
import {
  teacherPortalService,
  TeacherAssignedGroup,
  TeacherGradeCategory,
  TeacherPortalContext,
  TeacherRosterStudent,
  TeacherStudentGrade,
  TeacherStudentNote,
} from '../services/teacherPortalService';

const STATUS_BADGE_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300',
  suspended: 'bg-amber-500/15 border-amber-400/35 text-amber-300',
  graduated: 'bg-slate-500/20 border-slate-400/35 text-slate-300',
  unknown: 'bg-rose-500/15 border-rose-400/35 text-rose-300',
};

function isAuthorizationRevokedError(message: string): boolean {
  return /access denied|not currently assigned|not linked|does not currently belong|teacher record|unauthorized/i.test(
    message
  );
}

export const TeacherPortal: React.FC = () => {
  const { user, profile, signOut, isRevalidating } = useAuth();
  const isRevalidatingRef = useRef(isRevalidating);
  isRevalidatingRef.current = isRevalidating;

  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [portalContext, setPortalContext] = useState<TeacherPortalContext | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterGroupHeader, setRosterGroupHeader] = useState<{
    id: string;
    name: string;
    grade_level: string;
  } | null>(null);
  const [rosterStudents, setRosterStudents] = useState<TeacherRosterStudent[]>([]);

  // Selected student & scoped records (Stage C.2)
  const [selectedStudent, setSelectedStudent] = useState<TeacherRosterStudent | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [studentGrades, setStudentGrades] = useState<TeacherStudentGrade[]>([]);
  const [studentNotes, setStudentNotes] = useState<TeacherStudentNote[]>([]);

  // Save banners & modal forms
  const [actionBannerError, setActionBannerError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<'grade' | 'note' | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Grade form draft state
  const [assessmentTitle, setAssessmentTitle] = useState('');
  const [gradeType, setGradeType] = useState<TeacherGradeCategory>('exam');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [assessmentDate, setAssessmentDate] = useState(getCairoDateString);
  const [gradeRemarks, setGradeRemarks] = useState('');

  // Note form draft state (defaults to internal only / isParentVisible = false)
  const [feedbackText, setFeedbackText] = useState('');
  const [isParentVisible, setIsParentVisible] = useState(false);

  const mountedRef = useRef(true);
  const contextReqIdRef = useRef(0);
  const rosterReqIdRef = useRef(0);
  const recordsReqIdRef = useRef(0);
  const saveEpochRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const selectedGroupIdRef = useRef<string | null>(null);
  const selectedStudentIdRef = useRef<string | null>(null);

  const displayName = profile?.full_name || user?.email || 'Authenticated User';

  const clearStudentSelection = useCallback(() => {
    recordsReqIdRef.current++;
    saveEpochRef.current++;
    selectedStudentIdRef.current = null;
    setSelectedStudent(null);
    setStudentGrades([]);
    setStudentNotes([]);
    setRecordsError(null);
    setRecordsLoading(false);
    setActiveModal(null);
    setModalError(null);
    setSavedNotice(null);
  }, []);

  const loadStudentRecords = useCallback(async (groupId: string, student: TeacherRosterStudent) => {
    const requestId = ++recordsReqIdRef.current;
    selectedStudentIdRef.current = student.id;
    setSelectedStudent(student);
    setStudentGrades([]);
    setStudentNotes([]);
    setRecordsError(null);
    setRecordsLoading(true);

    const res = await teacherPortalService.getTeacherStudentRecords(groupId, student.id);

    if (
      !mountedRef.current ||
      requestId !== recordsReqIdRef.current ||
      selectedGroupIdRef.current !== groupId ||
      selectedStudentIdRef.current !== student.id
    ) {
      return;
    }

    setRecordsLoading(false);

    if (res.error || !res.data) {
      setStudentGrades([]);
      setStudentNotes([]);
      setRecordsError(res.error || 'Failed to load saved student records.');
      return;
    }

    setSelectedStudent(res.data.student);
    setStudentGrades(res.data.grades);
    setStudentNotes(res.data.notes);
    setRecordsError(null);
  }, []);

  const loadGroupRoster = useCallback(
    async (group: TeacherAssignedGroup) => {
      const requestId = ++rosterReqIdRef.current;
      selectedGroupIdRef.current = group.id;
      setSelectedGroupId(group.id);
      setRosterGroupHeader({
        id: group.id,
        name: group.name,
        grade_level: group.grade_level,
      });
      setRosterStudents([]);
      setRosterError(null);
      setRosterLoading(true);
      clearStudentSelection();

      const res = await teacherPortalService.getTeacherGroupStudents(group.id);

      if (
        !mountedRef.current ||
        requestId !== rosterReqIdRef.current ||
        selectedGroupIdRef.current !== group.id
      ) {
        return;
      }

      setRosterLoading(false);

      if (res.error || !res.data) {
        setRosterStudents([]);
        setRosterError(res.error || 'Failed to load students for the selected group.');
        return;
      }

      setRosterGroupHeader(res.data.group);
      setRosterStudents(res.data.students);
      setRosterError(null);
    },
    [clearStudentSelection]
  );

  const loadPortalContext = useCallback(async () => {
    const requestId = ++contextReqIdRef.current;
    rosterReqIdRef.current++;
    clearStudentSelection();
    setActionBannerError(null);

    setContextLoading(true);
    setContextError(null);

    const res = await teacherPortalService.getTeacherPortalContext();

    if (!mountedRef.current || requestId !== contextReqIdRef.current) {
      return;
    }

    setContextLoading(false);

    if (res.error || !res.data) {
      setPortalContext(null);
      setSelectedGroupId(null);
      selectedGroupIdRef.current = null;
      setRosterGroupHeader(null);
      setRosterStudents([]);
      setRosterError(null);
      setContextError(res.error || 'Failed to load teacher portal data.');
      return;
    }

    setPortalContext(res.data);

    if (!res.data.linked || res.data.groups.length === 0) {
      setSelectedGroupId(null);
      selectedGroupIdRef.current = null;
      setRosterGroupHeader(null);
      setRosterStudents([]);
      setRosterError(null);
      setRosterLoading(false);
      return;
    }

    const currentStillExists = res.data.groups.find((g) => g.id === selectedGroupIdRef.current);
    const nextGroup = currentStillExists ?? res.data.groups[0];
    void loadGroupRoster(nextGroup);
  }, [clearStudentSelection, loadGroupRoster]);

  useEffect(() => {
    mountedRef.current = true;
    void loadPortalContext();

    return () => {
      mountedRef.current = false;
      contextReqIdRef.current++;
      rosterReqIdRef.current++;
      recordsReqIdRef.current++;
      saveEpochRef.current++;
      selectedGroupIdRef.current = null;
      selectedStudentIdRef.current = null;
    };
  }, [user?.id, loadPortalContext]);

  const selectedGroupMeta =
    portalContext?.groups.find((g) => g.id === selectedGroupId) ?? rosterGroupHeader;

  const canWriteSelectedStudent = Boolean(selectedStudent && selectedStudent.status === 'active');

  const openGradeModal = () => {
    if (!selectedStudent || selectedStudent.status !== 'active') return;
    setAssessmentTitle('');
    setGradeType('exam');
    setScore('');
    setMaxScore('100');
    setAssessmentDate(getCairoDateString());
    setGradeRemarks('');
    setModalError(null);
    setActiveModal('grade');
  };

  const openNoteModal = () => {
    if (!selectedStudent || selectedStudent.status !== 'active') return;
    setFeedbackText('');
    setIsParentVisible(false);
    setModalError(null);
    setActiveModal('note');
  };

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRevalidatingRef.current) {
      setModalError('Verifying session permissions. Please wait before saving.');
      return;
    }
    if (isSubmittingRef.current || !selectedGroupId || !selectedStudent) return;
    if (selectedStudent.status !== 'active') {
      setModalError('Only verified active students can receive grades.');
      return;
    }

    const trimmedTitle = assessmentTitle.trim();
    if (!trimmedTitle) {
      setModalError('Assessment title is required.');
      return;
    }

    const numScore = Number(score);
    const numMax = Number(maxScore);
    if (
      score.trim() === '' ||
      maxScore.trim() === '' ||
      !Number.isFinite(numScore) ||
      !Number.isFinite(numMax) ||
      numMax <= 0 ||
      numMax >= 1000 ||
      numScore < 0 ||
      numScore > numMax
    ) {
      setModalError('Score must satisfy 0 <= score <= maximum score, with 0 < maximum score < 1000.');
      return;
    }

    const cairoToday = getCairoDateString();
    if (!assessmentDate || assessmentDate > cairoToday) {
      setModalError('Assessment date must not exceed today (Africa/Cairo).');
      return;
    }

    const targetGroupId = selectedGroupId;
    const targetStudent = selectedStudent;
    const targetGroupName = selectedGroupMeta?.name || 'group';
    const saveEpoch = ++saveEpochRef.current;

    isSubmittingRef.current = true;
    setSubmitting(true);
    setModalError(null);

    const res = await teacherPortalService.saveTeacherStudentGrade({
      groupId: targetGroupId,
      studentId: targetStudent.id,
      assessmentTitle: trimmedTitle,
      gradeType,
      score: numScore,
      maxScore: numMax,
      assessmentDate,
      notes: gradeRemarks.trim() || undefined,
    });

    if (
      !mountedRef.current ||
      saveEpoch !== saveEpochRef.current ||
      selectedGroupIdRef.current !== targetGroupId ||
      selectedStudentIdRef.current !== targetStudent.id
    ) {
      isSubmittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
      return;
    }

    isSubmittingRef.current = false;
    setSubmitting(false);

    if (res.error || !res.data) {
      const errMsg = res.error || 'Failed to save grade.';
      if (isAuthorizationRevokedError(errMsg)) {
        setActiveModal(null);
        setModalError(null);
        void loadPortalContext().then(() => {
          if (mountedRef.current) {
            setActionBannerError(errMsg);
          }
        });
        return;
      }
      setModalError(errMsg);
      return;
    }

    // Confirmed DB save -> close modal, reset draft, surface confirmed message, then reload records
    setActiveModal(null);
    setModalError(null);
    setAssessmentTitle('');
    setScore('');
    setGradeRemarks('');
    setSavedNotice(
      `Grade "${res.data.assessment_title}" saved for ${targetStudent.full_name} (${targetStudent.student_code}) in ${targetGroupName}.`
    );

    await loadStudentRecords(targetGroupId, targetStudent);
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRevalidatingRef.current) {
      setModalError('Verifying session permissions. Please wait before saving.');
      return;
    }
    if (isSubmittingRef.current || !selectedGroupId || !selectedStudent) return;
    if (selectedStudent.status !== 'active') {
      setModalError('Only verified active students can receive notes.');
      return;
    }

    const trimmedNote = feedbackText.trim();
    if (!trimmedNote) {
      setModalError('Feedback text is required.');
      return;
    }

    const targetGroupId = selectedGroupId;
    const targetStudent = selectedStudent;
    const targetGroupName = selectedGroupMeta?.name || 'group';
    const saveEpoch = ++saveEpochRef.current;

    isSubmittingRef.current = true;
    setSubmitting(true);
    setModalError(null);

    const res = await teacherPortalService.saveTeacherStudentNote({
      groupId: targetGroupId,
      studentId: targetStudent.id,
      feedbackText: trimmedNote,
      isParentVisible,
    });

    if (
      !mountedRef.current ||
      saveEpoch !== saveEpochRef.current ||
      selectedGroupIdRef.current !== targetGroupId ||
      selectedStudentIdRef.current !== targetStudent.id
    ) {
      isSubmittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
      return;
    }

    isSubmittingRef.current = false;
    setSubmitting(false);

    if (res.error || !res.data) {
      const errMsg = res.error || 'Failed to save teacher note.';
      if (isAuthorizationRevokedError(errMsg)) {
        setActiveModal(null);
        setModalError(null);
        void loadPortalContext().then(() => {
          if (mountedRef.current) {
            setActionBannerError(errMsg);
          }
        });
        return;
      }
      setModalError(errMsg);
      return;
    }

    setActiveModal(null);
    setModalError(null);
    setFeedbackText('');
    setIsParentVisible(false);
    setSavedNotice(
      `Note saved (${res.data.is_parent_visible ? 'Visible to Parent' : 'Internal Only'}) for ${targetStudent.full_name} (${targetStudent.student_code}) in ${targetGroupName}.`
    );

    await loadStudentRecords(targetGroupId, targetStudent);
  };

  return (
    <div
      data-testid="role-portal-teacher"
      className="min-h-screen bg-[#0D1322] text-[#E6E6F2] p-4 sm:p-8"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Identity Card */}
        <header className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 shadow-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl border bg-cyan-500/15 border-cyan-400/40 text-cyan-300 flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>EduTrack Portal</span>
              </div>
              <h1 className="text-xl font-bold text-white mt-0.5">Teacher Portal</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-semibold text-white" data-testid="portal-user-name">
                  {displayName}
                </span>
                <span
                  className="font-mono text-[11px] uppercase px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/35 text-cyan-200"
                  data-testid="portal-user-role"
                >
                  {profile?.role || 'teacher'}
                </span>
                {portalContext?.linked && portalContext.teacher?.subject && (
                  <span className="text-slate-400">• {portalContext.teacher.subject}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-center">
            <button
              type="button"
              onClick={() => void loadPortalContext()}
              disabled={contextLoading}
              className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/60 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${contextLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              className="px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {/* Session revalidation notice */}
        {isRevalidating && (
          <div
            data-testid="teacher-portal-revalidating-banner"
            role="status"
            className="rounded-xl bg-amber-500/15 border border-amber-400/35 px-4 py-3 text-xs text-amber-200 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>Re-verifying teacher session permissions... Save actions are paused until confirmed.</span>
          </div>
        )}

        {/* Revocation / Action error alert */}
        {actionBannerError && (
          <div
            data-testid="teacher-action-revoked-banner"
            role="alert"
            className="rounded-xl bg-rose-950/50 border border-rose-500/40 px-4 py-3 text-xs text-rose-200 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{actionBannerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionBannerError(null)}
              className="text-rose-300 hover:text-white"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stage C.2 Scope notice */}
        <div className="flex items-start gap-2.5 rounded-xl bg-slate-900/70 border border-slate-700/70 p-3.5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            Scoped Teacher Workspace (Stage C.2): View assigned groups and record grades or notes for active students. Parent portal note display opens in Stage E.
          </span>
        </div>

        {/* State 1: Initial / Reloading Context */}
        {contextLoading && (
          <div
            data-testid="teacher-context-loading"
            className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-10 text-center text-sm text-[#C7B8ED] flex flex-col items-center gap-3"
          >
            <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
            <span>Loading assigned groups...</span>
          </div>
        )}

        {/* State 2: Context Load Failure + Retry */}
        {!contextLoading && contextError && (
          <div
            data-testid="teacher-context-error"
            role="alert"
            className="rounded-2xl bg-rose-950/40 border border-rose-500/40 p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold text-white">Unable to Load Assigned Groups</h2>
                <p className="text-xs text-rose-200 mt-1">{contextError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadPortalContext()}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-2 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* State 3: Teacher Account Not Linked */}
        {!contextLoading && !contextError && portalContext && !portalContext.linked && (
          <div
            data-testid="teacher-unlinked-state"
            className="rounded-2xl bg-[#161F36]/90 border border-amber-500/35 p-8 text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-400/35 text-amber-300 flex items-center justify-center mx-auto">
              <Link2Off className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-white">Teacher Account Not Linked Yet</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your account is verified as a teacher, but it has not been linked to a staff teacher record yet. Please ask an administrator to link your account.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadPortalContext()}
              className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-xs font-semibold inline-flex items-center gap-1.5 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* State 4: Linked Teacher With Zero Assigned Groups */}
        {!contextLoading &&
          !contextError &&
          portalContext?.linked &&
          portalContext.groups.length === 0 && (
            <div
              data-testid="teacher-no-groups-state"
              className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-8 text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 text-cyan-300 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h2 className="text-lg font-bold text-white">No Assigned Groups</h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Your teacher record ({portalContext.teacher?.full_name || displayName}) is linked, but no class groups are currently assigned to you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadPortalContext()}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Groups</span>
              </button>
            </div>
          )}

        {/* State 5: Linked Teacher With Assigned Groups */}
        {!contextLoading &&
          !contextError &&
          portalContext?.linked &&
          portalContext.groups.length > 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Assigned Groups Sidebar */}
                <section
                  aria-label="Assigned Groups"
                  className="lg:col-span-4 rounded-2xl bg-[#161F36]/90 border border-[#324066] p-5 space-y-3 h-fit"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-white">Assigned Groups</h2>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {portalContext.groups.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {portalContext.groups.map((grp) => {
                      const isSelected = grp.id === selectedGroupId;
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => void loadGroupRoster(grp)}
                          aria-pressed={isSelected}
                          data-testid={`teacher-group-item-${grp.id}`}
                          className={`w-full text-left p-3.5 rounded-xl border transition ${
                            isSelected
                              ? 'bg-cyan-500/15 border-cyan-400/50 text-white'
                              : 'bg-[#0D1322]/70 border-[#2C395D] text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          <div className="font-semibold text-sm">{grp.name}</div>
                          <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                            <span>{grp.grade_level}</span>
                            <span>{grp.student_count} students</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Selected Group Student Roster */}
                <section
                  aria-label="Selected Group Students"
                  className="lg:col-span-8 rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2C395D] pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-white" data-testid="selected-group-title">
                        {selectedGroupMeta?.name || 'Group Students'}
                      </h2>
                      {selectedGroupMeta?.grade_level && (
                        <p className="text-xs text-slate-400 mt-0.5" data-testid="selected-group-grade">
                          {selectedGroupMeta.grade_level} • Student Roster
                        </p>
                      )}
                    </div>
                    {selectedGroupMeta && (
                      <button
                        type="button"
                        onClick={() => {
                          const target =
                            portalContext.groups.find((g) => g.id === selectedGroupMeta.id) ?? {
                              ...selectedGroupMeta,
                              student_count: rosterStudents.length,
                            };
                          void loadGroupRoster(target);
                        }}
                        disabled={rosterLoading}
                        className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/60 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${rosterLoading ? 'animate-spin' : ''}`} />
                        <span>Reload Roster</span>
                      </button>
                    )}
                  </div>

                  {rosterLoading && (
                    <div
                      data-testid="teacher-students-loading"
                      className="py-10 text-center text-xs text-[#C7B8ED] flex flex-col items-center gap-2.5"
                    >
                      <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
                      <span>Loading students in {selectedGroupMeta?.name || 'selected group'}...</span>
                    </div>
                  )}

                  {!rosterLoading && rosterError && (
                    <div
                      data-testid="teacher-students-error"
                      role="alert"
                      className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-5 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-white">Unable to Load Group Students</p>
                          <p className="text-xs text-rose-200 mt-0.5">{rosterError}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedGroupMeta && (
                          <button
                            type="button"
                            onClick={() =>
                              void loadGroupRoster(
                                portalContext.groups.find((g) => g.id === selectedGroupMeta.id) ?? {
                                  ...selectedGroupMeta,
                                  student_count: 0,
                                }
                              )
                            }
                            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Retry</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void loadPortalContext()}
                          className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <span>Refresh Groups</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {!rosterLoading && !rosterError && rosterStudents.length === 0 && (
                    <div
                      data-testid="teacher-empty-group-state"
                      className="py-10 text-center space-y-2 rounded-xl bg-[#0D1322]/60 border border-[#2C395D]"
                    >
                      <GraduationCap className="w-7 h-7 text-slate-400 mx-auto" />
                      <p className="text-sm font-semibold text-white">No Students Enrolled in This Group</p>
                      <p className="text-xs text-slate-400">
                        Students assigned to {selectedGroupMeta?.name} will appear here automatically.
                      </p>
                    </div>
                  )}

                  {!rosterLoading && !rosterError && rosterStudents.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[#2C395D] text-slate-400 uppercase tracking-wider text-[11px]">
                            <th className="py-2.5 pr-4">Student Name</th>
                            <th className="py-2.5 pr-4">Student Code</th>
                            <th className="py-2.5 pr-4">Status</th>
                            <th className="py-2.5 text-right">Records</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2C395D]/70">
                          {rosterStudents.map((stu) => {
                            const isSelectedStudent = selectedStudent?.id === stu.id;
                            return (
                              <tr
                                key={stu.id}
                                data-testid={`teacher-student-row-${stu.id}`}
                                className={isSelectedStudent ? 'bg-cyan-500/10' : undefined}
                              >
                                <td className="py-3 pr-4 font-semibold text-white">{stu.full_name}</td>
                                <td className="py-3 pr-4 font-mono text-slate-300">{stu.student_code}</td>
                                <td className="py-3 pr-4">
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold capitalize ${
                                      STATUS_BADGE_STYLES[stu.status] || STATUS_BADGE_STYLES.unknown
                                    }`}
                                  >
                                    {stu.status}
                                  </span>
                                </td>
                                <td className="py-3 text-right">
                                  <button
                                    type="button"
                                    data-testid={`select-student-${stu.id}`}
                                    onClick={() => {
                                      setSavedNotice(null);
                                      void loadStudentRecords(stu.group_id, stu);
                                    }}
                                    className={`px-3 py-1 rounded-lg border text-[11px] font-semibold transition ${
                                      isSelectedStudent
                                        ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                                        : 'bg-slate-800/80 border-slate-600/70 text-slate-200 hover:bg-slate-700/80'
                                    }`}
                                  >
                                    {isSelectedStudent ? 'Selected' : 'Open Records'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>

              {/* Selected Student Grades & Notes Panel */}
              {selectedStudent && selectedGroupId && (
                <section
                  data-testid="teacher-student-records-panel"
                  className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 space-y-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2C395D] pb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-white" data-testid="selected-student-name">
                          {selectedStudent.full_name}
                        </h3>
                        <span
                          className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-600 text-cyan-200"
                          data-testid="selected-student-code"
                        >
                          {selectedStudent.student_code}
                        </span>
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold capitalize ${
                            STATUS_BADGE_STYLES[selectedStudent.status] || STATUS_BADGE_STYLES.unknown
                          }`}
                          data-testid="selected-student-status"
                        >
                          {selectedStudent.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1" data-testid="selected-student-group-label">
                        Group: {selectedGroupMeta?.name} ({selectedGroupMeta?.grade_level}) • Showing records authored by you
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadStudentRecords(selectedGroupId, selectedStudent)}
                        disabled={recordsLoading}
                        className="px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/60 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${recordsLoading ? 'animate-spin' : ''}`} />
                        <span>Reload Records</span>
                      </button>
                      <button
                        type="button"
                        onClick={openGradeModal}
                        disabled={!canWriteSelectedStudent || isRevalidating || submitting}
                        className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Grade</span>
                      </button>
                      <button
                        type="button"
                        onClick={openNoteModal}
                        disabled={!canWriteSelectedStudent || isRevalidating || submitting}
                        className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed transition"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Add Note</span>
                      </button>
                    </div>
                  </div>

                  {!canWriteSelectedStudent && (
                    <div
                      data-testid="inactive-student-write-notice"
                      className="rounded-xl bg-amber-500/10 border border-amber-400/35 px-4 py-3 text-xs text-amber-200 flex items-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>
                        Grades and notes can only be recorded for active students (current status: {selectedStudent.status}).
                      </span>
                    </div>
                  )}

                  {savedNotice && (
                    <div
                      data-testid="teacher-save-success-banner"
                      role="status"
                      className="rounded-xl bg-emerald-500/15 border border-emerald-400/40 px-4 py-3 text-xs text-emerald-200 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                        <span>{savedNotice}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSavedNotice(null)}
                        className="text-emerald-300 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {recordsLoading && (
                    <div
                      data-testid="teacher-records-loading"
                      className="py-8 text-center text-xs text-[#C7B8ED] flex flex-col items-center gap-2"
                    >
                      <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
                      <span>Loading your saved grades and notes for {selectedStudent.full_name}...</span>
                    </div>
                  )}

                  {!recordsLoading && recordsError && (
                    <div
                      data-testid="teacher-records-error"
                      role="alert"
                      className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-4 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div className="text-xs">
                          <p className="font-semibold text-white">
                            {savedNotice
                              ? 'Your record was saved, but refreshing the records list failed.'
                              : 'Unable to Load Student Records'}
                          </p>
                          <p className="text-rose-200 mt-0.5">{recordsError}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadStudentRecords(selectedGroupId, selectedStudent)}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  {!recordsLoading && !recordsError && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Grades column */}
                      <div className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                            <Award className="w-4 h-4 text-cyan-400" />
                            <span>Your Saved Grades</span>
                          </h4>
                          <span className="text-[11px] font-mono text-slate-400">{studentGrades.length}</span>
                        </div>
                        {studentGrades.length === 0 ? (
                          <p className="text-xs text-slate-400 py-3">No grades saved by you for this student yet.</p>
                        ) : (
                          <div className="space-y-2.5">
                            {studentGrades.map((g) => (
                              <div
                                key={g.id}
                                data-testid={`saved-grade-item-${g.id}`}
                                className="rounded-lg bg-[#161F36] border border-[#2C395D] p-3 text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-white">{g.assessment_title}</span>
                                  <span className="font-mono font-bold text-cyan-300">
                                    {g.score} / {g.max_score}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400 flex flex-wrap gap-2">
                                  <span className="uppercase">{g.grade_type}</span>
                                  <span>•</span>
                                  <span>{g.assessment_date}</span>
                                  {g.author_name && (
                                    <>
                                      <span>•</span>
                                      <span>{g.author_name}</span>
                                    </>
                                  )}
                                </div>
                                {g.remarks && <p className="text-slate-300 pt-1">{g.remarks}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Notes column */}
                      <div className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                            <MessageSquare className="w-4 h-4 text-violet-400" />
                            <span>Your Saved Notes</span>
                          </h4>
                          <span className="text-[11px] font-mono text-slate-400">{studentNotes.length}</span>
                        </div>
                        {studentNotes.length === 0 ? (
                          <p className="text-xs text-slate-400 py-3">No notes saved by you for this student yet.</p>
                        ) : (
                          <div className="space-y-2.5">
                            {studentNotes.map((n) => (
                              <div
                                key={n.id}
                                data-testid={`saved-note-item-${n.id}`}
                                className="rounded-lg bg-[#161F36] border border-[#2C395D] p-3 text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                      n.is_parent_visible
                                        ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                                        : 'bg-slate-700/60 border-slate-500/40 text-slate-300'
                                    }`}
                                  >
                                    {n.is_parent_visible ? 'Visible to Parent' : 'Internal Only'}
                                  </span>
                                  <span className="text-[11px] text-slate-400">{n.note_date}</span>
                                </div>
                                <p className="text-slate-200 whitespace-pre-wrap">{n.feedback_text}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
      </div>

      {/* Modal: Record Grade */}
      {activeModal === 'grade' && selectedStudent && selectedGroupMeta && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-grade-modal-title"
            className="bg-[#161F36] border border-[#324066] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 id="teacher-grade-modal-title" className="text-base font-bold text-white">
                Add Student Grade
              </h3>
              <button
                type="button"
                onClick={() => !submitting && setActiveModal(null)}
                disabled={submitting}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Identity disambiguation block before saving */}
            <div
              data-testid="modal-student-context"
              className="rounded-xl bg-[#0D1322] border border-[#2C395D] p-3 space-y-1 text-slate-300"
            >
              <div>
                <span className="text-slate-400">Student: </span>
                <strong className="text-white">{selectedStudent.full_name}</strong>{' '}
                <span className="font-mono text-cyan-300">({selectedStudent.student_code})</span>
              </div>
              <div>
                <span className="text-slate-400">Group: </span>
                <span className="text-white">{selectedGroupMeta.name}</span>
              </div>
            </div>

            {modalError && (
              <div
                data-testid="modal-error-banner"
                role="alert"
                className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveGrade} className="space-y-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1" htmlFor="tpGradeTitle">
                  Assessment Title
                </label>
                <input
                  id="tpGradeTitle"
                  type="text"
                  required
                  value={assessmentTitle}
                  onChange={(e) => setAssessmentTitle(e.target.value)}
                  disabled={submitting}
                  placeholder="e.g. Unit 3 Quiz"
                  className="w-full px-3 py-2 rounded-xl bg-[#0D1322] border border-[#2C395D] text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1" htmlFor="tpGradeType">
                    Category
                  </label>
                  <select
                    id="tpGradeType"
                    value={gradeType}
                    onChange={(e) => setGradeType(e.target.value as TeacherGradeCategory)}
                    disabled={submitting}
                    className="w-full px-3 py-2 rounded-xl bg-[#0D1322] border border-[#2C395D] text-white focus:outline-none focus:border-cyan-400"
                  >
                    <option value="exam">Exam</option>
                    <option value="quiz">Quiz</option>
                    <option value="assignment">Assignment</option>
                    <option value="participation">Participation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1" htmlFor="tpGradeDate">
                    Assessment Date (Cairo)
                  </label>
                  <input
                    id="tpGradeDate"
                    type="date"
                    required
                    max={getCairoDateString()}
                    value={assessmentDate}
                    onChange={(e) => setAssessmentDate(e.target.value)}
                    disabled={submitting}
                    className="w-full px-3 py-2 rounded-xl bg-[#0D1322] border border-[#2C395D] text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1" htmlFor="tpGradeScore">
                    Score
                  </label>
                  <input
                    id="tpGradeScore"
                    type="number"
                    required
                    min="0"
                    max="999.99"
                    step="0.01"
                    value={score}
                    onChange={(e) => setScore(e.target.value)}
                    disabled={submitting}
                    className="w-full px-3 py-2 rounded-xl bg-[#0D1322] border border-[#2C395D] text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1" htmlFor="tpGradeMax">
                    Maximum Score
                  </label>
                  <input
                    id="tpGradeMax"
                    type="number"
                    required
                    min="0.01"
                    max="999.99"
                    step="0.01"
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                    disabled={submitting}
                    className="w-full px-3 py-2 rounded-xl bg-[#0D1322] border border-[#2C395D] text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1" htmlFor="tpGradeRemarks">
                  Remarks (Optional)
                </label>
                <textarea
                  id="tpGradeRemarks"
                  rows={2}
                  value={gradeRemarks}
                  onChange={(e) => setGradeRemarks(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 rounded-xl bg-[#0D1322] border border-[#2C395D] text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#2C395D]">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl border border-[#2C395D] text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || isRevalidating}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving Grade...' : 'Save Grade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Teacher Note */}
      {activeModal === 'note' && selectedStudent && selectedGroupMeta && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-note-modal-title"
            className="bg-[#161F36] border border-[#324066] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 id="teacher-note-modal-title" className="text-base font-bold text-white">
                Add Student Note
              </h3>
              <button
                type="button"
                onClick={() => !submitting && setActiveModal(null)}
                disabled={submitting}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              data-testid="modal-student-context"
              className="rounded-xl bg-[#0D1322] border border-[#2C395D] p-3 space-y-1 text-slate-300"
            >
              <div>
                <span className="text-slate-400">Student: </span>
                <strong className="text-white">{selectedStudent.full_name}</strong>{' '}
                <span className="font-mono text-cyan-300">({selectedStudent.student_code})</span>
              </div>
              <div>
                <span className="text-slate-400">Group: </span>
                <span className="text-white">{selectedGroupMeta.name}</span>
              </div>
            </div>

            {modalError && (
              <div
                data-testid="modal-error-banner"
                role="alert"
                className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveNote} className="space-y-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1" htmlFor="tpNoteText">
                  Note Text
                </label>
                <textarea
                  id="tpNoteText"
                  rows={3}
                  required
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  disabled={submitting}
                  placeholder="Write observation or feedback..."
                  className="w-full px-3 py-2 rounded-xl bg-[#0D1322] border border-[#2C395D] text-white focus:outline-none focus:border-violet-400"
                />
              </div>

              <fieldset className="space-y-2">
                <legend className="text-slate-300 font-semibold mb-1">Visibility</legend>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#0D1322] border border-[#2C395D] cursor-pointer">
                  <input
                    type="radio"
                    name="noteVisibility"
                    value="internal"
                    checked={!isParentVisible}
                    onChange={() => setIsParentVisible(false)}
                    disabled={submitting}
                  />
                  <span>Internal Only (داخلية — staff/teacher only)</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#0D1322] border border-[#2C395D] cursor-pointer">
                  <input
                    type="radio"
                    name="noteVisibility"
                    value="parent"
                    checked={isParentVisible}
                    onChange={() => setIsParentVisible(true)}
                    disabled={submitting}
                  />
                  <span>Visible to Parent (متاحة لولي الأمر — parent view opens in Stage E)</span>
                </label>
              </fieldset>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#2C395D]">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl border border-[#2C395D] text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || isRevalidating}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving Note...' : 'Save Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherPortal;
