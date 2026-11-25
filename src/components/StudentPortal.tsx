import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CalendarCheck,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Link2Off,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import {
  translateAttendanceStatus,
  translateGradeType,
  translateRole,
} from '../i18n/translations';
import { formatAttachmentSize, validateAssignmentPdfFile } from '../services/assignmentAttachmentService';
import { studentPortalService, StudentPortalData } from '../services/studentPortalService';
import { formatCairoDateTime, type AssignmentItem } from '../services/portalPayloadValidation';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';
import { AssignmentDueCalendar } from './AssignmentDueCalendar';
import { AssignmentDeadlineNotice } from './AssignmentDeadlineNotice';
import { GroupDiscussionChat } from './GroupDiscussionChat';

const ATTENDANCE_BADGE_STYLES: Record<string, string> = {
  Present:
    'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-400/35 dark:text-emerald-300',
  Late:
    'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/15 dark:border-amber-400/35 dark:text-amber-300',
  Absent:
    'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-500/15 dark:border-rose-400/35 dark:text-rose-300',
  Excused:
    'bg-violet-50 border-violet-200 text-violet-800 dark:bg-violet-500/15 dark:border-violet-400/35 dark:text-violet-300',
};

export const StudentPortal: React.FC = () => {
  const { user, profile, signOut, isRevalidating } = useAuth();
  const { language, t } = usePreferences();
  const currentUserId = user?.id ?? null;

  const [state, setState] = useState<{
    ownerUserId: string | null;
    loading: boolean;
    error: string | null;
    portalData: StudentPortalData | null;
  }>({
    ownerUserId: null,
    loading: true,
    error: null,
    portalData: null,
  });

  const [assignmentsState, setAssignmentsState] = useState<{
    ownerUserId: string | null;
    loading: boolean;
    error: string | null;
    assignments: AssignmentItem[];
  }>({
    ownerUserId: null,
    loading: true,
    error: null,
    assignments: [],
  });

  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [draftPdfByAssignment, setDraftPdfByAssignment] = useState<Record<string, File | null>>({});
  const [seenVersionByAssignment, setSeenVersionByAssignment] = useState<Record<string, number>>({});
  const [conflictAssignmentById, setConflictAssignmentById] = useState<
    Record<string, { title: string; instructions: string; due_at: string; assignment_version: number }>
  >({});
  const submissionPdfInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [submittingAssignmentId, setSubmittingAssignmentId] = useState<string | null>(null);
  const [submissionErrorById, setSubmissionErrorById] = useState<Record<string, string>>({});
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [attachmentErrorById, setAttachmentErrorById] = useState<Record<string, string>>({});
  const [savedRefreshPendingWarning, setSavedRefreshPendingWarning] = useState(false);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const assignmentsReqIdRef = useRef(0);
  const submittingAssignmentRef = useRef(false);

  const isStaleUser = state.ownerUserId !== null && state.ownerUserId !== currentUserId;
  const loading = isStaleUser ? true : state.loading;
  const error = isStaleUser ? null : state.error;
  const portalData = isStaleUser ? null : state.portalData;

  const isStaleAssignmentsUser =
    assignmentsState.ownerUserId !== null && assignmentsState.ownerUserId !== currentUserId;
  const assignmentsLoading = isStaleAssignmentsUser ? true : assignmentsState.loading;
  const assignmentsError = isStaleAssignmentsUser ? null : assignmentsState.error;
  const assignmentsList = isStaleAssignmentsUser ? [] : assignmentsState.assignments;

  const displayName =
    portalData?.linked && portalData.student?.full_name
      ? portalData.student.full_name
      : profile?.full_name || user?.email || t('studentUserFallback');

  const applyPortalResult = useCallback(
    (
      ownerUserId: string | null,
      res: Awaited<ReturnType<typeof studentPortalService.getStudentPortalData>>
    ) => {
      if (res.error || !res.data) {
        setState({
          ownerUserId,
          loading: false,
          error: res.error || 'Failed to load your student records.',
          portalData: null,
        });
        return;
      }

      setState({
        ownerUserId,
        loading: false,
        error: null,
        portalData: res.data,
      });
    },
    []
  );

  const loadStudentAssignments = useCallback(async () => {
    const requestId = ++assignmentsReqIdRef.current;
    setAssignmentsState({
      ownerUserId: currentUserId,
      loading: true,
      error: null,
      assignments: [],
    });
    const res = await studentPortalService.getStudentAssignments();
    if (!mountedRef.current || requestId !== assignmentsReqIdRef.current) {
      return;
    }
    if (res.error || !res.data) {
      setAssignmentsState({
        ownerUserId: currentUserId,
        loading: false,
        error: res.error || 'Failed to load assignments.',
        assignments: [],
      });
      return;
    }
    setAssignmentsState({
      ownerUserId: currentUserId,
      loading: false,
      error: null,
      assignments: res.data.assignments,
    });
    setSavedRefreshPendingWarning(false);
  }, [currentUserId]);

  const handleOpenStudentAttachment = async (assignment: AssignmentItem) => {
    const att = assignment.attachment;
    if (!att || openingAttachmentId) return;
    setOpeningAttachmentId(att.id);
    setAttachmentErrorById((prev) => {
      const next = { ...prev };
      delete next[att.id];
      return next;
    });
    const res = await studentPortalService.openAssignmentAttachment(att.id);
    if (!mountedRef.current) return;
    setOpeningAttachmentId(null);
    if (res.error || !res.data) {
      setAttachmentErrorById((prev) => ({
        ...prev,
        [att.id]: res.error || t('attachmentOpenFailedErr'),
      }));
      return;
    }
    window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenSubmissionAttachment = async (attachmentId: string) => {
    if (!attachmentId || openingAttachmentId) return;
    setOpeningAttachmentId(attachmentId);
    setAttachmentErrorById((prev) => {
      const next = { ...prev };
      delete next[attachmentId];
      return next;
    });
    const res = await studentPortalService.openSubmissionAttachment(attachmentId);
    if (!mountedRef.current) return;
    setOpeningAttachmentId(null);
    if (res.error || !res.data) {
      setAttachmentErrorById((prev) => ({
        ...prev,
        [attachmentId]: res.error || t('attachmentOpenFailedErr'),
      }));
      return;
    }
    window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const captureSeenAssignmentVersion = (assignment: AssignmentItem) => {
    setSeenVersionByAssignment((prev) => {
      if (prev[assignment.id] !== undefined) return prev;
      return { ...prev, [assignment.id]: assignment.assignment_version ?? 1 };
    });
  };

  const handleSelectSubmissionPdf = (
    assignment: AssignmentItem,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const assignmentId = assignment.id;
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    captureSeenAssignmentVersion(assignment);
    const validation = validateAssignmentPdfFile(file);
    if (!validation.valid) {
      setSubmissionErrorById((prev) => ({
        ...prev,
        [assignmentId]:
          validation.errorCode === 'TOO_LARGE'
            ? t('assignmentPdfTooLargeErr')
            : validation.errorCode === 'EMPTY_FILE'
              ? t('assignmentPdfEmptyErr')
              : t('assignmentPdfInvalidTypeErr'),
      }));
      e.target.value = '';
      return;
    }
    setSubmissionErrorById((prev) => {
      const next = { ...prev };
      delete next[assignmentId];
      return next;
    });
    setDraftPdfByAssignment((prev) => ({ ...prev, [assignmentId]: file }));
  };

  const handleRemoveDraftSubmissionPdf = (assignmentId: string) => {
    setDraftPdfByAssignment((prev) => {
      const next = { ...prev };
      delete next[assignmentId];
      return next;
    });
    const input = submissionPdfInputRefs.current[assignmentId];
    if (input) input.value = '';
  };

  const handleSubmitAssignment = async (assignment: AssignmentItem) => {
    if (submittingAssignmentRef.current || submittingAssignmentId) return;

    const draft = draftAnswers[assignment.id] ?? assignment.submission?.answer_text ?? '';
    const trimmed = draft.trim();
    const draftPdf = draftPdfByAssignment[assignment.id] ?? null;
    const hasExistingAttachment = Boolean(assignment.submission?.attachment);

    if (!trimmed && !draftPdf && !hasExistingAttachment) {
      setSubmissionErrorById((prev) => ({
        ...prev,
        [assignment.id]: t('submissionTextOrPdfRequiredErr'),
      }));
      return;
    }

    const expectedAssignmentVersion =
      seenVersionByAssignment[assignment.id] ?? assignment.assignment_version ?? 1;

    submittingAssignmentRef.current = true;
    setSubmittingAssignmentId(assignment.id);
    setSubmissionErrorById((prev) => {
      const next = { ...prev };
      delete next[assignment.id];
      return next;
    });

    const saveRes = await studentPortalService.submitStudentAssignment(assignment.id, trimmed, {
      studentId: portalData?.student?.id,
      attachmentFile: draftPdf,
      hasExistingAttachment,
      expectedAssignmentVersion,
    });
    if (!mountedRef.current) {
      submittingAssignmentRef.current = false;
      return;
    }

    if (saveRes.error || !saveRes.data) {
      submittingAssignmentRef.current = false;
      setSubmittingAssignmentId(null);
      const errMsg = saveRes.error || 'Failed to submit answer.';
      setSubmissionErrorById((prev) => ({
        ...prev,
        [assignment.id]: errMsg.startsWith('SUBMISSION_UPLOAD_FAILED:')
          ? t('submissionPdfUploadFailedErr')
          : errMsg,
      }));
      return;
    }

    if (saveRes.data.conflict && saveRes.data.latestAssignment) {
      const latest = saveRes.data.latestAssignment;
      submittingAssignmentRef.current = false;
      setSubmittingAssignmentId(null);
      setConflictAssignmentById((prev) => ({
        ...prev,
        [assignment.id]: latest,
      }));
      setSeenVersionByAssignment((prev) => ({
        ...prev,
        [assignment.id]: latest.assignment_version,
      }));
      setAssignmentsState((prev) => ({
        ...prev,
        assignments: prev.assignments.map((item) =>
          item.id === assignment.id
            ? {
                ...item,
                title: latest.title,
                instructions: latest.instructions,
                due_at: latest.due_at,
                assignment_version: latest.assignment_version,
                is_past_due: latest.is_past_due,
              }
            : item
        ),
      }));
      return;
    }

    setConflictAssignmentById((prev) => {
      const next = { ...prev };
      delete next[assignment.id];
      return next;
    });
    setSeenVersionByAssignment((prev) => {
      const next = { ...prev };
      delete next[assignment.id];
      return next;
    });
    setDraftPdfByAssignment((prev) => {
      const next = { ...prev };
      delete next[assignment.id];
      return next;
    });
    const input = submissionPdfInputRefs.current[assignment.id];
    if (input) input.value = '';

    const reqId = ++assignmentsReqIdRef.current;
    const refreshRes = await studentPortalService.getStudentAssignments();
    if (!mountedRef.current || reqId !== assignmentsReqIdRef.current) {
      submittingAssignmentRef.current = false;
      return;
    }

    submittingAssignmentRef.current = false;
    setSubmittingAssignmentId(null);

    if (refreshRes.error || !refreshRes.data) {
      setSavedRefreshPendingWarning(true);
      setAssignmentsState((prev) => ({
        ...prev,
        ownerUserId: currentUserId,
        loading: false,
        error: refreshRes.error || 'Failed to refresh assignments.',
      }));
      return;
    }

    setSavedRefreshPendingWarning(false);
    setDraftAnswers((prev) => {
      const next = { ...prev };
      delete next[assignment.id];
      return next;
    });
    setAssignmentsState({
      ownerUserId: currentUserId,
      loading: false,
      error: null,
      assignments: refreshRes.data.assignments,
    });
  };

  const loadStudentPortal = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({
      ownerUserId: currentUserId,
      loading: true,
      error: null,
      portalData: null,
    });
    void loadStudentAssignments();
    const res = await studentPortalService.getStudentPortalData();
    if (!mountedRef.current || requestId !== requestIdRef.current) {
      return;
    }
    applyPortalResult(currentUserId, res);
  }, [currentUserId, applyPortalResult, loadStudentAssignments]);

  useEffect(() => {
    mountedRef.current = true;
    const reqRef = requestIdRef;
    const assignReqRef = assignmentsReqIdRef;
    const requestId = ++reqRef.current;
    const assignReqId = ++assignReqRef.current;

    studentPortalService.getStudentPortalData().then((res) => {
      if (!mountedRef.current || requestId !== reqRef.current) {
        return;
      }
      applyPortalResult(currentUserId, res);
    });

    studentPortalService.getStudentAssignments().then((res) => {
      if (!mountedRef.current || assignReqId !== assignReqRef.current) {
        return;
      }
      if (res.error || !res.data) {
        setAssignmentsState({
          ownerUserId: currentUserId,
          loading: false,
          error: res.error || 'Failed to load assignments.',
          assignments: [],
        });
        return;
      }
      setAssignmentsState({
        ownerUserId: currentUserId,
        loading: false,
        error: null,
        assignments: res.data.assignments,
      });
    });

    return () => {
      mountedRef.current = false;
      reqRef.current++;
      assignReqRef.current++;
    };
  }, [currentUserId, applyPortalResult]);

  const handleSignOut = async () => {
    requestIdRef.current++;
    assignmentsReqIdRef.current++;
    setState({
      ownerUserId: currentUserId,
      loading: false,
      error: null,
      portalData: null,
    });
    setAssignmentsState({
      ownerUserId: currentUserId,
      loading: false,
      error: null,
      assignments: [],
    });
    await signOut();
  };

  return (
    <div
      data-testid="role-portal-student"
      className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 p-4 sm:p-8"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Verified Identity */}
        <header className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl border bg-[#D8E8DC] border-[#A8BDA6]/50 text-[#174E50] dark:bg-teal-950/60 dark:border-teal-700/50 dark:text-teal-300 flex items-center justify-center shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                <BrandMark className="w-4 h-4" />
                <span>{t('edutrackPortalBadge')}</span>
              </div>
              <h1 className="text-xl font-extrabold text-[#17213B] dark:text-white mt-0.5">
                {t('roleStudentTitle')}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-slate-300">
                <span className="font-semibold text-[#17213B] dark:text-white" data-testid="portal-user-name">
                  {displayName}
                </span>
                <span
                  className="font-mono text-[11px] uppercase px-2 py-0.5 rounded bg-[#D8E8DC]/70 border border-[#A8BDA6]/50 text-[#174E50] dark:bg-teal-950/60 dark:border-teal-700/50 dark:text-teal-300"
                  data-testid="portal-user-role"
                >
                  {translateRole(language, profile?.role || 'student')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
            <DisplayControls variant="compact" />
            <button
              type="button"
              onClick={() => void loadStudentPortal()}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-[#F8F7F2] hover:bg-[#E6E8E2]/60 dark:bg-slate-800 dark:hover:bg-slate-700 border border-[#E6E8E2] dark:border-slate-700 text-[#26334A] dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t('refresh')}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:border-rose-500/40 dark:text-rose-200 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('signOut')}</span>
            </button>
          </div>
        </header>

        {/* Session revalidation notice */}
        {isRevalidating && (
          <div
            data-testid="student-portal-revalidating-banner"
            role="status"
            className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-500/15 dark:border-amber-400/35 dark:text-amber-200 px-4 py-3 text-xs flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>{t('studentRevalidatingBanner')}</span>
          </div>
        )}

        {/* Read-only scope notice */}
        <div className="flex items-start gap-2.5 rounded-xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-3.5 text-xs text-[#64748B] dark:text-slate-300">
          <ShieldCheck className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0 mt-0.5" />
          <span>{t('studentScopeNotice')}</span>
        </div>

        {/* State 1: Loading */}
        {loading && (
          <div
            data-testid="student-portal-loading"
            className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-10 text-center text-sm text-[#64748B] dark:text-slate-300 flex flex-col items-center gap-3"
          >
            <RefreshCw className="w-6 h-6 text-[#174E50] dark:text-teal-400 animate-spin" />
            <span>{t('loadingStudentRecords')}</span>
          </div>
        )}

        {/* State 2: Load / Network / Permission Error */}
        {!loading && error && (
          <div
            data-testid="student-portal-error"
            role="alert"
            className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/40 p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold text-rose-900 dark:text-white">
                  {t('unableLoadStudentPortalTitle')}
                </h2>
                <p className="text-xs text-rose-700 dark:text-rose-200 mt-1">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadStudentPortal()}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-2 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('retry')}</span>
            </button>
          </div>
        )}

        {/* State 3: Unlinked Student Account */}
        {!loading && !error && portalData && !portalData.linked && (
          <div
            data-testid="student-unlinked-state"
            className="rounded-2xl bg-white dark:bg-[#131E2B] border border-amber-200 dark:border-amber-500/35 p-8 text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/35 text-amber-600 dark:text-amber-300 flex items-center justify-center mx-auto">
              <Link2Off className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-[#17213B] dark:text-white">
                {t('studentUnlinkedTitle')}
              </h2>
              <p className="text-xs text-[#64748B] dark:text-slate-300 leading-relaxed">
                {t('studentUnlinkedDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadStudentPortal()}
              className="px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 dark:border-amber-400/40 dark:text-amber-200 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('retry')}</span>
            </button>
          </div>
        )}

        {/* State 4: Linked Student Content */}
        {!loading && !error && portalData?.linked && portalData.student && (
          <div className="space-y-6">
            {/* Student Card */}
            <section
              data-testid="student-card"
              aria-label={t('studentProfileCardAria')}
              className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs shadow-xs"
            >
              <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-1">
                <span className="text-[#64748B] dark:text-slate-400">{t('studentNameCardLabel')}</span>
                <p className="text-sm font-bold text-[#17213B] dark:text-white" data-testid="student-card-name">
                  {portalData.student.full_name}
                </p>
              </div>
              <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-1">
                <span className="text-[#64748B] dark:text-slate-400">{t('studentCodeCardLabel')}</span>
                <p className="text-sm font-mono font-bold text-[#174E50] dark:text-teal-300" data-testid="student-card-code">
                  {portalData.student.student_code}
                </p>
              </div>
              <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-1">
                <span className="text-[#64748B] dark:text-slate-400">{t('gradeLevelCardLabel')}</span>
                <p className="text-sm font-semibold text-[#17213B] dark:text-white" data-testid="student-card-grade">
                  {portalData.student.grade_level}
                </p>
              </div>
              <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-1">
                <span className="text-[#64748B] dark:text-slate-400">{t('currentGroupCardLabel')}</span>
                {portalData.student.group ? (
                  <p className="text-sm font-semibold text-[#17213B] dark:text-white" data-testid="student-card-group">
                    {portalData.student.group.name}
                  </p>
                ) : (
                  <p
                    className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5"
                    data-testid="student-no-group-state"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{t('noGroupAssignedLabel')}</span>
                  </p>
                )}
              </div>
            </section>

            {/* Attendance & Grades Columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recorded Attendance */}
              <section
                data-testid="student-attendance-section"
                aria-label={t('attendanceHistoryHeading')}
                className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 space-y-4 shadow-xs"
              >
                <div className="flex items-center justify-between gap-2 border-b border-[#E6E8E2] dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <CalendarCheck className="w-4 h-4 text-[#174E50] dark:text-teal-300" />
                    <h2 className="text-base font-bold text-[#17213B] dark:text-white">
                      {t('attendanceHistoryHeading')}
                    </h2>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#F8F7F2] dark:bg-slate-800 text-[#64748B] dark:text-slate-300 border border-[#E6E8E2] dark:border-slate-700">
                    {portalData.attendance.length}
                  </span>
                </div>

                <p className="text-[11px] text-[#7B8794] dark:text-slate-400">
                  {t('attendanceHistoryNote')}
                </p>

                {portalData.attendance.length === 0 ? (
                  <div
                    data-testid="student-empty-attendance"
                    className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#7B8794] dark:text-slate-400"
                  >
                    {t('noAttendanceLoggedStudent')}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#E6E8E2] dark:border-slate-800 text-[#7B8794] dark:text-slate-400 uppercase tracking-wider text-[11px]">
                          <th className="py-2 pe-3">{t('thDate')}</th>
                          <th className="py-2 pe-3">{t('colStatusTitle')}</th>
                          <th className="py-2">{t('thArrivalTime')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                        {portalData.attendance.map((att) => (
                          <tr key={att.id} data-testid={`student-attendance-row-${att.id}`}>
                            <td className="py-2.5 pe-3 font-mono text-[#17213B] dark:text-white">{att.date}</td>
                            <td className="py-2.5 pe-3">
                              <span
                                className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                                  ATTENDANCE_BADGE_STYLES[att.status] || ATTENDANCE_BADGE_STYLES.Absent
                                }`}
                              >
                                {translateAttendanceStatus(language, att.status)}
                              </span>
                            </td>
                            <td className="py-2.5 font-mono text-[#64748B] dark:text-slate-300">
                              {att.check_in_time || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Saved Grades */}
              <section
                data-testid="student-grades-section"
                aria-label={t('gradesLedgerHeading')}
                className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 space-y-4 shadow-xs"
              >
                <div className="flex items-center justify-between gap-2 border-b border-[#E6E8E2] dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-[#174E50] dark:text-teal-300" />
                    <h2 className="text-base font-bold text-[#17213B] dark:text-white">
                      {t('gradesLedgerHeading')}
                    </h2>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#F8F7F2] dark:bg-slate-800 text-[#64748B] dark:text-slate-300 border border-[#E6E8E2] dark:border-slate-700">
                    {portalData.grades.length}
                  </span>
                </div>

                <p className="text-[11px] text-[#7B8794] dark:text-slate-400">
                  {t('gradesLedgerNote')}
                </p>

                {portalData.grades.length === 0 ? (
                  <div
                    data-testid="student-empty-grades"
                    className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#7B8794] dark:text-slate-400"
                  >
                    {t('noGradesRecordedStudent')}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {portalData.grades.map((gr) => (
                      <div
                        key={gr.id}
                        data-testid={`student-grade-row-${gr.id}`}
                        className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3.5 text-xs flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-[#17213B] dark:text-white">
                            {gr.assessment_title}
                          </div>
                          <div className="text-[11px] text-[#7B8794] dark:text-slate-400 flex items-center gap-2">
                            <span className="uppercase font-medium text-[#26334A] dark:text-slate-300">
                              {translateGradeType(language, gr.grade_type)}
                            </span>
                            <span>•</span>
                            <span className="font-mono">{gr.assessment_date}</span>
                          </div>
                        </div>
                        <div
                          dir="ltr"
                          className="font-mono font-bold text-sm text-[#174E50] dark:text-teal-300 shrink-0 tabular-nums"
                        >
                          {gr.score} / {gr.max_score}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Group Assignments (Read-Only Phase 1) */}
            <section
              data-testid="student-assignments-section"
              aria-label={t('studentAssignmentsHeading')}
              className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 space-y-4 shadow-xs"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[#E6E8E2] dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-[#174E50] dark:text-teal-300" />
                  <h2 className="text-base font-bold text-[#17213B] dark:text-white">
                    {t('studentAssignmentsHeading')}
                  </h2>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#F8F7F2] dark:bg-slate-800 text-[#64748B] dark:text-slate-300 border border-[#E6E8E2] dark:border-slate-700">
                  {assignmentsList.length}
                </span>
              </div>

              {assignmentsLoading && (
                <div
                  data-testid="student-assignments-loading"
                  className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#64748B] dark:text-slate-400 flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4 animate-spin text-[#174E50] dark:text-teal-300" />
                  <span>{t('loadingAssignmentsNotice')}</span>
                </div>
              )}

              {!assignmentsLoading && assignmentsError && (
                <div
                  role="alert"
                  data-testid="student-assignments-error"
                  className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 p-4 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5 text-rose-800 dark:text-rose-200">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <div>
                      <p className="font-bold">
                        {savedRefreshPendingWarning
                          ? t('assignmentSubmissionSavedRefreshFailed')
                          : t('unableLoadAssignments')}
                      </p>
                      <p className="mt-0.5">{assignmentsError}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="student-retry-assignments-btn"
                    onClick={() => void loadStudentAssignments()}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
                  >
                    {t('retryLoadAssignmentsBtn')}
                  </button>
                </div>
              )}

              {!assignmentsLoading && !assignmentsError && (
                <AssignmentDeadlineNotice assignments={assignmentsList.filter((item) => !item.submission && !item.is_past_due)} />
              )}

              {!assignmentsLoading && !assignmentsError && (
                <AssignmentDueCalendar
                  testIdPrefix="student"
                  assignments={assignmentsList.map((a) => {
                    const isPastDue = Boolean(a.is_past_due);
                    const hasSubmission = Boolean(a.submission);
                    return {
                      id: a.id,
                      title: a.title,
                      due_at: a.due_at,
                      statusLabel: isPastDue
                        ? t('assignmentStatusClosed')
                        : hasSubmission
                          ? t('assignmentStatusSubmitted')
                          : t('assignmentStatusNotSubmitted'),
                      statusStyle: isPastDue
                        ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/50 dark:border-rose-700/50 dark:text-rose-200'
                        : hasSubmission
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200'
                          : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-200',
                    };
                  })}
                />
              )}

              {!assignmentsLoading && !assignmentsError && assignmentsList.length === 0 && (
                <div
                  data-testid="student-empty-assignments"
                  className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#7B8794] dark:text-slate-400"
                >
                  {t('noStudentAssignments')}
                </div>
              )}

              {!assignmentsLoading && !assignmentsError && assignmentsList.length > 0 && (
                <div className="space-y-4">
                  {assignmentsList.map((a) => {
                    const isPastDue = Boolean(a.is_past_due);
                    const hasSubmission = Boolean(a.submission);
                    const draftValue = draftAnswers[a.id] ?? a.submission?.answer_text ?? '';
                    const isSavingThis = submittingAssignmentId === a.id;
                    const itemError = submissionErrorById[a.id];

                    return (
                      <article
                        key={a.id}
                        data-testid={`student-assignment-card-${a.id}`}
                        className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <h3 className="text-sm font-bold text-[#17213B] dark:text-white">{a.title}</h3>
                            {a.group_name && (
                              <p className="text-[11px] font-semibold text-[#174E50] dark:text-teal-300">
                                {a.group_name}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              data-testid={`student-assignment-status-${a.id}`}
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${
                                isPastDue
                                  ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/50 dark:border-rose-700/50 dark:text-rose-200'
                                  : hasSubmission
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200'
                                    : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-200'
                              }`}
                            >
                              {isPastDue
                                ? t('assignmentStatusClosed')
                                : hasSubmission
                                  ? t('assignmentStatusSubmitted')
                                  : t('assignmentStatusNotSubmitted')}
                            </span>
                            <span
                              dir="ltr"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[11px] font-mono font-semibold text-[#174E50] dark:text-teal-300"
                            >
                              <Clock className="w-3 h-3" />
                              {formatCairoDateTime(a.due_at)}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-[#26334A] dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                          {a.instructions}
                        </p>

                        {a.attachment && (
                          <div className="space-y-1.5">
                            <div className="rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0" />
                                <span
                                  data-testid={`student-attachment-name-${a.id}`}
                                  className="text-xs font-semibold text-[#17213B] dark:text-white truncate"
                                >
                                  {a.attachment.file_name}
                                </span>
                                <span
                                  dir="ltr"
                                  className="text-[11px] font-mono text-[#64748B] dark:text-slate-400 shrink-0"
                                >
                                  ({formatAttachmentSize(a.attachment.size_bytes)})
                                </span>
                              </div>
                              <button
                                type="button"
                                data-testid={`student-open-attachment-${a.id}`}
                                disabled={openingAttachmentId === a.attachment.id}
                                onClick={() => void handleOpenStudentAttachment(a)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-[11px] font-bold disabled:opacity-50 transition cursor-pointer"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>
                                  {openingAttachmentId === a.attachment.id
                                    ? t('openingAttachmentBtn')
                                    : t('openAttachmentBtn')}
                                </span>
                              </button>
                            </div>
                            {attachmentErrorById[a.attachment.id] && (
                              <p
                                role="alert"
                                data-testid={`student-attachment-error-${a.id}`}
                                className="text-[11px] font-medium text-rose-700 dark:text-rose-300"
                              >
                                {attachmentErrorById[a.attachment.id]}
                              </p>
                            )}
                          </div>
                        )}

                        {isPastDue && (
                          <div className="text-[11px] font-semibold text-[#64748B] dark:text-slate-300">
                            {hasSubmission ? t('assignmentSavedAnswerExists') : t('assignmentNoSavedAnswer')}
                          </div>
                        )}

                        {a.submission && (
                          <div
                            data-testid={`student-saved-submission-${a.id}`}
                            className="rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 p-3 text-xs space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B] dark:text-slate-400">
                              <span className="font-bold text-[#174E50] dark:text-teal-300">
                                {t('assignmentSavedAnswerLabel')}
                              </span>
                              <span dir="ltr" className="font-mono">
                                {t('assignmentLastSubmittedLabel')}: {formatCairoDateTime(a.submission.updated_at)}
                              </span>
                            </div>
                            {a.submission.answer_text && (
                              <p className="text-[#17213B] dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
                                {a.submission.answer_text}
                              </p>
                            )}
                            {a.submission.attachment && (
                              <div className="space-y-1">
                                <div className="rounded-lg bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0" />
                                    <span
                                      data-testid={`student-saved-submission-attachment-name-${a.id}`}
                                      className="text-xs font-semibold text-[#17213B] dark:text-white truncate"
                                    >
                                      {a.submission.attachment.file_name}
                                    </span>
                                    <span
                                      dir="ltr"
                                      className="text-[11px] font-mono text-[#64748B] dark:text-slate-400 shrink-0"
                                    >
                                      ({formatAttachmentSize(a.submission.attachment.size_bytes)})
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    data-testid={`student-open-submission-attachment-${a.id}`}
                                    disabled={openingAttachmentId === a.submission.attachment.id}
                                    onClick={() => void handleOpenSubmissionAttachment(a.submission!.attachment!.id)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-[11px] font-bold disabled:opacity-50 transition cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>
                                      {openingAttachmentId === a.submission.attachment.id
                                        ? t('openingAttachmentBtn')
                                        : t('openAttachmentBtn')}
                                    </span>
                                  </button>
                                </div>
                                {attachmentErrorById[a.submission.attachment.id] && (
                                  <p
                                    role="alert"
                                    className="text-[11px] font-medium text-rose-700 dark:text-rose-300"
                                  >
                                    {attachmentErrorById[a.submission.attachment.id]}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {a.grade && (
                          <div
                            data-testid={`student-assignment-grade-${a.id}`}
                            className="rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 px-3 py-2 text-xs flex items-center justify-between gap-2"
                          >
                            <span className="font-bold text-emerald-900 dark:text-emerald-200">
                              {t('assignmentGradeResultLabel')}
                            </span>
                            <span
                              dir="ltr"
                              className="font-mono font-extrabold text-sm text-[#174E50] dark:text-teal-300 tabular-nums"
                            >
                              {a.grade.score} / {a.grade.max_score}
                            </span>
                          </div>
                        )}

                        {!isPastDue && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleSubmitAssignment(a);
                            }}
                            className="space-y-2 pt-1 border-t border-[#E6E8E2] dark:border-slate-800"
                            noValidate
                          >
                            <label
                              htmlFor={`student-answer-input-${a.id}`}
                              className="block text-[11px] font-bold text-[#17213B] dark:text-slate-200"
                            >
                              {t('assignmentAnswerLabel')}
                            </label>
                            <textarea
                              id={`student-answer-input-${a.id}`}
                              data-testid={`student-answer-input-${a.id}`}
                              rows={3}
                              value={draftValue}
                              onChange={(e) => {
                                captureSeenAssignmentVersion(a);
                                setDraftAnswers((prev) => ({ ...prev, [a.id]: e.target.value }));
                              }}
                              disabled={isSavingThis}
                              placeholder={t('assignmentAnswerPlaceholder')}
                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 text-xs text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                            />
                            <div className="space-y-1.5">
                              <label
                                htmlFor={`student-submission-pdf-input-${a.id}`}
                                className="block text-[11px] font-bold text-[#17213B] dark:text-slate-200"
                              >
                                {t('submissionPdfLabel')}
                              </label>
                              <input
                                ref={(el) => {
                                  submissionPdfInputRefs.current[a.id] = el;
                                }}
                                id={`student-submission-pdf-input-${a.id}`}
                                data-testid={`student-submission-pdf-input-${a.id}`}
                                type="file"
                                accept="application/pdf,.pdf"
                                disabled={isSavingThis}
                                onChange={(e) => handleSelectSubmissionPdf(a, e)}
                                className="sr-only"
                              />
                              {!draftPdfByAssignment[a.id] ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white dark:bg-[#131E2B] border border-dashed border-[#CBD5E1] dark:border-slate-700 px-3 py-2">
                                  <span className="text-[11px] text-[#64748B] dark:text-slate-400">
                                    {t('submissionPdfHint')}
                                  </span>
                                  <label
                                    htmlFor={`student-submission-pdf-input-${a.id}`}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-[#E6E8E2] dark:border-slate-700 bg-[#F8F7F2] dark:bg-slate-800 hover:bg-[#D8E8DC]/40 dark:hover:bg-slate-700 text-[11px] font-bold text-[#174E50] dark:text-teal-300 cursor-pointer"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                    <span>
                                      {a.submission?.attachment
                                        ? t('submissionPdfReplaceBtn')
                                        : t('submissionPdfChooseBtn')}
                                    </span>
                                  </label>
                                </div>
                              ) : (
                                <div
                                  data-testid={`student-selected-submission-pdf-${a.id}`}
                                  className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0" />
                                    <span className="text-xs font-semibold text-[#17213B] dark:text-white truncate">
                                      {draftPdfByAssignment[a.id]!.name}
                                    </span>
                                    <span
                                      dir="ltr"
                                      className="text-[11px] font-mono text-[#64748B] dark:text-slate-400 shrink-0"
                                    >
                                      ({formatAttachmentSize(draftPdfByAssignment[a.id]!.size)})
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    data-testid={`remove-student-submission-pdf-${a.id}`}
                                    disabled={isSavingThis}
                                    onClick={() => handleRemoveDraftSubmissionPdf(a.id)}
                                    className="text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:underline cursor-pointer shrink-0"
                                  >
                                    {t('assignmentPdfRemoveBtn')}
                                  </button>
                                </div>
                              )}
                            </div>
                            {conflictAssignmentById[a.id] && (
                              <div
                                role="alert"
                                data-testid={`student-assignment-conflict-${a.id}`}
                                className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 text-[11px] space-y-1.5"
                              >
                                <div className="font-bold flex items-start gap-2">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>{t('studentAssignmentVersionConflictErr')}</span>
                                </div>
                                <div className="font-semibold">{t('studentAssignmentLatestBannerLabel')}</div>
                                <div className="whitespace-pre-wrap text-amber-800 dark:text-amber-300">
                                  {conflictAssignmentById[a.id].instructions}
                                </div>
                                <div dir="ltr" className="font-mono">
                                  {formatCairoDateTime(conflictAssignmentById[a.id].due_at)}
                                </div>
                              </div>
                            )}
                            {itemError && (
                              <div
                                role="alert"
                                data-testid={`student-submission-error-${a.id}`}
                                className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-700 dark:text-rose-200 text-[11px] flex items-center gap-2"
                              >
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>{itemError}</span>
                              </div>
                            )}
                            <div className="flex justify-end">
                              <button
                                type="submit"
                                data-testid={`student-submit-assignment-btn-${a.id}`}
                                disabled={isSavingThis}
                                className="px-4 py-2 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer transition"
                              >
                                {isSavingThis
                                  ? t('submittingAnswerBtn')
                                  : hasSubmission
                                    ? t('updateAnswerBtn')
                                    : t('submitAnswerBtn')}
                              </button>
                            </div>
                          </form>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {portalData.student.group && portalData.student.status === 'active' && (
              <GroupDiscussionChat
                groupId={portalData.student.group.id}
                groupName={portalData.student.group.name}
                userId={currentUserId}
                disabled={isRevalidating}
                testIdPrefix="student-group-chat"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentPortal;
