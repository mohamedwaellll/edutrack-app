import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Link2Off,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import {
  translateGradeType,
  translateRole,
  translateStudentStatus,
} from '../i18n/translations';
import {
  formatAttachmentSize,
  validateAssignmentPdfFile,
} from '../services/assignmentAttachmentService';
import { getCairoDateString } from '../services/attendanceService';
import {
  cairoDateTimeLocalToIso,
  formatCairoDateTime,
  isoToCairoDateTimeLocal,
  type AssignmentItem,
  type TeacherAssignmentSubmission,
} from '../services/portalPayloadValidation';
import {
  teacherPortalService,
  TeacherAssignedGroup,
  TeacherGradeCategory,
  TeacherPortalContext,
  TeacherRosterStudent,
  TeacherStudentGrade,
  TeacherStudentNote,
} from '../services/teacherPortalService';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';
import { GroupDiscussionChat } from './GroupDiscussionChat';

const STATUS_BADGE_STYLES: Record<string, string> = {
  active:
    'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-400/35 dark:text-emerald-300',
  suspended:
    'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/15 dark:border-amber-400/35 dark:text-amber-300',
  graduated:
    'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-500/20 dark:border-slate-400/35 dark:text-slate-300',
  unknown:
    'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-500/15 dark:border-rose-400/35 dark:text-rose-300',
};

function isAuthorizationRevokedError(message: string): boolean {
  return /access denied|not currently assigned|not linked|does not currently belong|teacher record|unauthorized/i.test(
    message
  );
}

export const TeacherPortal: React.FC = () => {
  const { user, profile, signOut, isRevalidating } = useAuth();
  const { language, t } = usePreferences();
  const isRevalidatingRef = useRef(isRevalidating);
  useEffect(() => {
    isRevalidatingRef.current = isRevalidating;
  }, [isRevalidating]);

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

  const [selectedStudent, setSelectedStudent] = useState<TeacherRosterStudent | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [studentGrades, setStudentGrades] = useState<TeacherStudentGrade[]>([]);
  const [studentNotes, setStudentNotes] = useState<TeacherStudentNote[]>([]);

  const [actionBannerError, setActionBannerError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<'grade' | 'note' | 'assignment' | 'submissions' | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [submissionsAssignment, setSubmissionsAssignment] = useState<AssignmentItem | null>(null);
  const [submissionsList, setSubmissionsList] = useState<TeacherAssignmentSubmission[]>([]);
  const [submissionsTrackerStudents, setSubmissionsTrackerStudents] = useState<TeacherRosterStudent[]>([]);
  const [trackerFilter, setTrackerFilter] = useState<'all' | 'not_submitted' | 'pending_grading' | 'graded'>('all');
  const [submissionsCanGrade, setSubmissionsCanGrade] = useState(false);
  const [submissionsDueAt, setSubmissionsDueAt] = useState('');
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [submissionsRefreshPendingWarning, setSubmissionsRefreshPendingWarning] = useState(false);
  const [submissionGradeDrafts, setSubmissionGradeDrafts] = useState<
    Record<string, { score: string; maxScore: string }>
  >({});
  const [gradingSubmissionId, setGradingSubmissionId] = useState<string | null>(null);
  const [gradingErrorById, setGradingErrorById] = useState<Record<string, string>>({});
  const [conflictConfirmById, setConflictConfirmById] = useState<
    Record<string, { required: boolean; confirmed: boolean }>
  >({});
  const gradingInFlightRef = useRef(false);

  const [assignmentsList, setAssignmentsList] = useState<AssignmentItem[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [assignmentPublishedPendingTitle, setAssignmentPublishedPendingTitle] = useState<string | null>(null);

  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [assignmentInstructions, setAssignmentInstructions] = useState('');
  const [assignmentDueLocal, setAssignmentDueLocal] = useState('');
  const [editingAssignment, setEditingAssignment] = useState<AssignmentItem | null>(null);
  const [editConflictAssignment, setEditConflictAssignment] = useState<AssignmentItem | null>(null);
  const [editConflictConfirmed, setEditConflictConfirmed] = useState(false);
  const [assignmentPdfFile, setAssignmentPdfFile] = useState<File | null>(null);
  const assignmentPdfInputRef = useRef<HTMLInputElement | null>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [attachmentErrorById, setAttachmentErrorById] = useState<Record<string, string>>({});

  const [assessmentTitle, setAssessmentTitle] = useState('');
  const [gradeType, setGradeType] = useState<TeacherGradeCategory>('exam');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [assessmentDate, setAssessmentDate] = useState(getCairoDateString);
  const [gradeRemarks, setGradeRemarks] = useState('');

  const [feedbackText, setFeedbackText] = useState('');
  const [isParentVisible, setIsParentVisible] = useState(false);

  const mountedRef = useRef(true);
  const contextReqIdRef = useRef(0);
  const rosterReqIdRef = useRef(0);
  const recordsReqIdRef = useRef(0);
  const assignmentsReqIdRef = useRef(0);
  const submissionsReqIdRef = useRef(0);
  const saveEpochRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const selectedGroupIdRef = useRef<string | null>(null);
  const selectedStudentIdRef = useRef<string | null>(null);

  const displayName = profile?.full_name || user?.email || t('authenticatedUserFallback');

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

  const loadGroupAssignments = useCallback(async (groupId: string) => {
    const requestId = ++assignmentsReqIdRef.current;
    setAssignmentsLoading(true);
    setAssignmentsError(null);

    const res = await teacherPortalService.getTeacherAssignments(groupId);
    if (
      !mountedRef.current ||
      requestId !== assignmentsReqIdRef.current ||
      selectedGroupIdRef.current !== groupId
    ) {
      return;
    }

    setAssignmentsLoading(false);
    if (res.error || !res.data) {
      setAssignmentsError(res.error || 'Failed to load assignments.');
      return;
    }

    setAssignmentsList(res.data);
    setAssignmentPublishedPendingTitle(null);
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
      setAssignmentsList([]);
      setAssignmentPublishedPendingTitle(null);
      clearStudentSelection();
      void loadGroupAssignments(group.id);

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
    [clearStudentSelection, loadGroupAssignments]
  );

  const applyPortalContextResult = useCallback(
    (res: Awaited<ReturnType<typeof teacherPortalService.getTeacherPortalContext>>) => {
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
      setContextError(null);

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
    },
    [loadGroupRoster]
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

    applyPortalContextResult(res);
  }, [clearStudentSelection, applyPortalContextResult]);

  useEffect(() => {
    mountedRef.current = true;
    const contextReq = contextReqIdRef;
    const rosterReq = rosterReqIdRef;
    const recordsReq = recordsReqIdRef;
    const saveEpoch = saveEpochRef;
    const groupRef = selectedGroupIdRef;
    const studentRef = selectedStudentIdRef;

    const requestId = ++contextReq.current;
    rosterReq.current++;

    teacherPortalService.getTeacherPortalContext().then((res) => {
      if (!mountedRef.current || requestId !== contextReq.current) {
        return;
      }
      applyPortalContextResult(res);
    });

    return () => {
      mountedRef.current = false;
      contextReq.current++;
      rosterReq.current++;
      recordsReq.current++;
      saveEpoch.current++;
      groupRef.current = null;
      studentRef.current = null;
    };
  }, [user?.id, applyPortalContextResult]);

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

  const openAssignmentModal = () => {
    if (!selectedGroupId) return;
    setEditingAssignment(null);
    setEditConflictAssignment(null);
    setEditConflictConfirmed(false);
    setAssignmentTitle('');
    setAssignmentInstructions('');
    setAssignmentDueLocal('');
    setAssignmentPdfFile(null);
    if (assignmentPdfInputRef.current) {
      assignmentPdfInputRef.current.value = '';
    }
    setModalError(null);
    setActiveModal('assignment');
  };

  const openEditAssignmentModal = (assignment: AssignmentItem) => {
    if (!selectedGroupId) return;
    setEditingAssignment(assignment);
    setEditConflictAssignment(null);
    setEditConflictConfirmed(false);
    setAssignmentTitle(assignment.title);
    setAssignmentInstructions(assignment.instructions);
    setAssignmentDueLocal(isoToCairoDateTimeLocal(assignment.due_at));
    setAssignmentPdfFile(null);
    if (assignmentPdfInputRef.current) {
      assignmentPdfInputRef.current.value = '';
    }
    setModalError(null);
    setActiveModal('assignment');
  };

  const handleSelectAssignmentPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const validation = validateAssignmentPdfFile(file);
    if (!validation.valid) {
      if (validation.errorCode === 'TOO_LARGE') {
        setModalError(t('assignmentPdfTooLargeErr'));
      } else if (validation.errorCode === 'EMPTY_FILE') {
        setModalError(t('assignmentPdfEmptyErr'));
      } else {
        setModalError(t('assignmentPdfInvalidTypeErr'));
      }
      e.target.value = '';
      return;
    }
    setModalError(null);
    setAssignmentPdfFile(file);
  };

  const handleRemoveAssignmentPdf = () => {
    setAssignmentPdfFile(null);
    if (assignmentPdfInputRef.current) {
      assignmentPdfInputRef.current.value = '';
    }
  };

  const handleOpenTeacherAttachment = async (assignment: AssignmentItem) => {
    const att = assignment.attachment;
    if (!att || openingAttachmentId) return;
    setOpeningAttachmentId(att.id);
    setAttachmentErrorById((prev) => {
      const next = { ...prev };
      delete next[att.id];
      return next;
    });
    const res = await teacherPortalService.openAssignmentAttachment(att.id);
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

  const handleOpenTeacherSubmissionAttachment = async (attachmentId: string) => {
    if (!attachmentId || openingAttachmentId) return;
    setOpeningAttachmentId(attachmentId);
    setAttachmentErrorById((prev) => {
      const next = { ...prev };
      delete next[attachmentId];
      return next;
    });
    const res = await teacherPortalService.openSubmissionAttachment(attachmentId);
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

  const loadAssignmentSubmissions = useCallback(async (assignmentId: string, groupId?: string) => {
    const requestId = ++submissionsReqIdRef.current;
    setSubmissionsLoading(true);
    setSubmissionsError(null);

    const targetGroupId = groupId || submissionsAssignment?.group_id || selectedGroupId;
    const [subRes, rosterRes] = await Promise.all([
      teacherPortalService.getTeacherAssignmentSubmissions(assignmentId),
      targetGroupId
        ? teacherPortalService.getTeacherGroupStudents(targetGroupId)
        : Promise.resolve({ data: null, error: 'Group identifier is required.' }),
    ]);
    if (!mountedRef.current || requestId !== submissionsReqIdRef.current) {
      return;
    }

    setSubmissionsLoading(false);
    if (subRes.error || !subRes.data) {
      setSubmissionsError(subRes.error || 'Failed to load submissions.');
      return;
    }
    if (rosterRes.error || !rosterRes.data) {
      setSubmissionsError(rosterRes.error || 'Failed to load active students for follow-up roster.');
      return;
    }

    setSubmissionsCanGrade(subRes.data.canGrade);
    setSubmissionsDueAt(subRes.data.dueAt);
    setSubmissionsList(subRes.data.submissions);
    setSubmissionsTrackerStudents(rosterRes.data.students.filter((s) => s.status === 'active'));
    setSubmissionsRefreshPendingWarning(false);
  }, [selectedGroupId, submissionsAssignment?.group_id]);

  const openSubmissionsModal = (assignment: AssignmentItem) => {
    setSubmissionsAssignment(assignment);
    setSubmissionsList([]);
    setSubmissionsTrackerStudents([]);
    setTrackerFilter('all');
    setSubmissionsError(null);
    setSubmissionsRefreshPendingWarning(false);
    setGradingErrorById({});
    setConflictConfirmById({});
    setActiveModal('submissions');
    void loadAssignmentSubmissions(assignment.id, assignment.group_id);
  };

  const handleGradeSubmission = async (sub: TeacherAssignmentSubmission) => {
    if (gradingInFlightRef.current || gradingSubmissionId || !submissionsAssignment) return;

    const draft = submissionGradeDrafts[sub.id] ?? {
      score: sub.grade ? String(sub.grade.score) : '',
      maxScore: sub.grade ? String(sub.grade.max_score) : '20',
    };
    const parsedScore = Number(draft.score);
    const parsedMax = Number(draft.maxScore);
    if (
      draft.score.trim() === '' ||
      draft.maxScore.trim() === '' ||
      !Number.isFinite(parsedScore) ||
      !Number.isFinite(parsedMax) ||
      parsedMax <= 0 ||
      parsedMax >= 1000 ||
      parsedScore < 0 ||
      parsedScore > parsedMax
    ) {
      setGradingErrorById((prev) => ({ ...prev, [sub.id]: t('tpErrScoreRange') }));
      return;
    }

    const conflictState = conflictConfirmById[sub.id];
    if (conflictState?.required && !conflictState.confirmed) {
      return;
    }

    gradingInFlightRef.current = true;
    setGradingSubmissionId(sub.id);
    setGradingErrorById((prev) => {
      const next = { ...prev };
      delete next[sub.id];
      return next;
    });

    const saveRes = await teacherPortalService.gradeAssignmentSubmission({
      submissionId: sub.id,
      score: parsedScore,
      maxScore: parsedMax,
      expectedGradeVersion: sub.grade?.grade_version ?? null,
    });

    if (!mountedRef.current) {
      gradingInFlightRef.current = false;
      return;
    }

    if (saveRes.error || !saveRes.data) {
      gradingInFlightRef.current = false;
      setGradingSubmissionId(null);
      setGradingErrorById((prev) => ({
        ...prev,
        [sub.id]: saveRes.error || 'Failed to save grade.',
      }));
      return;
    }

    if (saveRes.data.conflict) {
      gradingInFlightRef.current = false;
      setGradingSubmissionId(null);
      const latestGrade = saveRes.data.grade;
      setSubmissionsList((prev) =>
        prev.map((item) => (item.id === sub.id ? { ...item, grade: latestGrade } : item))
      );
      if (latestGrade) {
        setSubmissionGradeDrafts((prev) => ({
          ...prev,
          [sub.id]: { score: String(latestGrade.score), maxScore: String(latestGrade.max_score) },
        }));
      }
      setGradingErrorById((prev) => ({
        ...prev,
        [sub.id]: t('assignmentGradeConflictErr'),
      }));
      setConflictConfirmById((prev) => ({
        ...prev,
        [sub.id]: { required: true, confirmed: false },
      }));
      return;
    }

    const reqId = ++submissionsReqIdRef.current;
    const refreshRes = await teacherPortalService.getTeacherAssignmentSubmissions(submissionsAssignment.id);
    if (!mountedRef.current || reqId !== submissionsReqIdRef.current) {
      gradingInFlightRef.current = false;
      return;
    }

    gradingInFlightRef.current = false;
    setGradingSubmissionId(null);

    if (refreshRes.error || !refreshRes.data) {
      setSubmissionsRefreshPendingWarning(true);
      setSubmissionsError(refreshRes.error || 'Failed to refresh submissions.');
      return;
    }

    setSubmissionsRefreshPendingWarning(false);
    setSubmissionsCanGrade(refreshRes.data.canGrade);
    setSubmissionsDueAt(refreshRes.data.dueAt);
    setSubmissionsList(refreshRes.data.submissions);
    setSubmissionGradeDrafts((prev) => {
      const next = { ...prev };
      delete next[sub.id];
      return next;
    });
    setConflictConfirmById((prev) => {
      const next = { ...prev };
      delete next[sub.id];
      return next;
    });

    if (selectedGroupId && selectedStudent && selectedStudent.id === sub.student_id) {
      void loadStudentRecords(selectedGroupId, selectedStudent);
    }
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRevalidatingRef.current) {
      setModalError(t('errRevalidatingBeforeSave'));
      return;
    }
    if (isSubmittingRef.current || !selectedGroupId) return;

    const trimmedTitle = assignmentTitle.trim();
    if (!trimmedTitle) {
      setModalError(t('assignmentTitleRequiredErr'));
      return;
    }

    const trimmedInstructions = assignmentInstructions.trim();
    if (!trimmedInstructions) {
      setModalError(t('assignmentInstructionsRequiredErr'));
      return;
    }

    const dueAtIso = cairoDateTimeLocalToIso(assignmentDueLocal);
    if (!dueAtIso || new Date(dueAtIso).getTime() <= Date.now()) {
      setModalError(t('assignmentDueFutureErr'));
      return;
    }

    const targetGroupId = selectedGroupId;
    const targetGroupName = selectedGroupMeta?.name || '';
    const epochAtStart = saveEpochRef.current;

    if (editingAssignment) {
      if (editConflictAssignment && !editConflictConfirmed) {
        setModalError(t('assignmentEditConflictErr'));
        return;
      }

      isSubmittingRef.current = true;
      setSubmitting(true);
      setModalError(null);

      const expectedVersion =
        editConflictAssignment?.assignment_version ?? editingAssignment.assignment_version ?? 1;

      const updateRes = await teacherPortalService.updateTeacherAssignment({
        assignmentId: editingAssignment.id,
        title: trimmedTitle,
        instructions: trimmedInstructions,
        dueAtIso,
        expectedVersion,
      });

      if (!mountedRef.current) {
        isSubmittingRef.current = false;
        return;
      }

      isSubmittingRef.current = false;
      setSubmitting(false);

      if (epochAtStart !== saveEpochRef.current || selectedGroupIdRef.current !== targetGroupId) {
        return;
      }

      if (updateRes.error || !updateRes.data) {
        const errMsg = updateRes.error || 'Failed to update assignment.';
        if (/access denied|not assigned|verified teacher/i.test(errMsg)) {
          setActiveModal(null);
          setActionBannerError(errMsg);
          void loadPortalContext();
          return;
        }
        setModalError(errMsg);
        return;
      }

      if (updateRes.data.conflict) {
        setEditConflictAssignment(updateRes.data.assignment);
        setEditingAssignment(updateRes.data.assignment);
        setEditConflictConfirmed(false);
        setModalError(t('assignmentEditConflictErr'));
        setAssignmentsList((prev) =>
          prev.map((item) =>
            item.id === updateRes.data!.assignment.id ? updateRes.data!.assignment : item
          )
        );
        return;
      }

      setActiveModal(null);
      setEditingAssignment(null);
      setEditConflictAssignment(null);
      setEditConflictConfirmed(false);
      setModalError(null);
      setAssignmentTitle('');
      setAssignmentInstructions('');
      setAssignmentDueLocal('');
      setSavedNotice(t('assignmentUpdatedNotice', { title: updateRes.data.assignment.title }));
      setAssignmentsList((prev) =>
        prev.map((item) =>
          item.id === updateRes.data!.assignment.id ? updateRes.data!.assignment : item
        )
      );
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    setModalError(null);

    const res = await teacherPortalService.createTeacherAssignment({
      groupId: targetGroupId,
      title: trimmedTitle,
      instructions: trimmedInstructions,
      dueAtIso,
      attachmentFile: assignmentPdfFile,
    });

    if (!mountedRef.current) {
      isSubmittingRef.current = false;
      return;
    }

    isSubmittingRef.current = false;
    setSubmitting(false);

    if (epochAtStart !== saveEpochRef.current || selectedGroupIdRef.current !== targetGroupId) {
      return;
    }

    if (res.error || !res.data) {
      const errMsg = res.error || 'Failed to publish assignment.';
      if (errMsg.startsWith('ATTACHMENT_UPLOAD_FAILED:')) {
        setModalError(t('assignmentUploadFailedErr'));
        return;
      }
      if (/access denied|not assigned|verified teacher/i.test(errMsg)) {
        setActiveModal(null);
        setActionBannerError(errMsg);
        void loadPortalContext();
        return;
      }
      setModalError(errMsg);
      return;
    }

    setActiveModal(null);
    setModalError(null);
    setAssignmentTitle('');
    setAssignmentInstructions('');
    setAssignmentDueLocal('');
    setAssignmentPdfFile(null);
    if (assignmentPdfInputRef.current) {
      assignmentPdfInputRef.current.value = '';
    }
    setSavedNotice(t('assignmentPublishedNotice', { title: res.data.title, group: targetGroupName }));

    setAssignmentsLoading(true);
    setAssignmentsError(null);
    const listRes = await teacherPortalService.getTeacherAssignments(targetGroupId);
    if (!mountedRef.current || selectedGroupIdRef.current !== targetGroupId) {
      return;
    }
    setAssignmentsLoading(false);
    if (listRes.error || !listRes.data) {
      setAssignmentPublishedPendingTitle(res.data.title);
      setAssignmentsError(listRes.error || 'Failed to refresh assignments.');
      return;
    }
    setAssignmentPublishedPendingTitle(null);
    setAssignmentsList(listRes.data);
  };

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRevalidatingRef.current) {
      setModalError(t('errRevalidatingBeforeSave'));
      return;
    }
    if (isSubmittingRef.current || !selectedGroupId || !selectedStudent) return;
    if (selectedStudent.status !== 'active') {
      setModalError(t('tpErrActiveOnlyGrades'));
      return;
    }

    const trimmedTitle = assessmentTitle.trim();
    if (!trimmedTitle) {
      setModalError(t('tpErrTitleRequired'));
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
      setModalError(t('tpErrScoreRange'));
      return;
    }

    const cairoToday = getCairoDateString();
    if (!assessmentDate || assessmentDate > cairoToday) {
      setModalError(t('tpErrDateCairo'));
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

    setActiveModal(null);
    setModalError(null);
    setAssessmentTitle('');
    setScore('');
    setGradeRemarks('');
    setSavedNotice(
      t('tpToastGradeSaved', {
        title: res.data.assessment_title,
        name: targetStudent.full_name,
        code: targetStudent.student_code,
        group: targetGroupName,
      })
    );

    await loadStudentRecords(targetGroupId, targetStudent);
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRevalidatingRef.current) {
      setModalError(t('errRevalidatingBeforeSave'));
      return;
    }
    if (isSubmittingRef.current || !selectedGroupId || !selectedStudent) return;
    if (selectedStudent.status !== 'active') {
      setModalError(t('tpErrActiveOnlyNotes'));
      return;
    }

    const trimmedNote = feedbackText.trim();
    if (!trimmedNote) {
      setModalError(t('tpErrFeedbackRequired'));
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
      t('tpToastNoteSaved', {
        visibility: res.data.is_parent_visible ? t('visibleToParentBadge') : t('internalOnlyBadge'),
        name: targetStudent.full_name,
        code: targetStudent.student_code,
        group: targetGroupName,
      })
    );

    await loadStudentRecords(targetGroupId, targetStudent);
  };

  return (
    <div
      data-testid="role-portal-teacher"
      className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 p-4 sm:p-8"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Identity Card */}
        <header className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl border bg-[#D8E8DC] border-[#A8BDA6]/50 text-[#174E50] dark:bg-teal-950/60 dark:border-teal-700/50 dark:text-teal-300 flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                <BrandMark className="w-4 h-4" />
                <span>{t('edutrackPortalBadge')}</span>
              </div>
              <h1 className="text-xl font-extrabold text-[#17213B] dark:text-white mt-0.5">
                {t('roleTeacherTitle')}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-slate-300">
                <span className="font-semibold text-[#17213B] dark:text-white" data-testid="portal-user-name">
                  {displayName}
                </span>
                <span
                  className="font-mono text-[11px] uppercase px-2 py-0.5 rounded bg-[#D8E8DC]/70 border border-[#A8BDA6]/50 text-[#174E50] dark:bg-teal-950/60 dark:border-teal-700/50 dark:text-teal-300"
                  data-testid="portal-user-role"
                >
                  {translateRole(language, profile?.role || 'teacher')}
                </span>
                {portalContext?.linked && portalContext.teacher?.subject && (
                  <span className="text-[#7B8794] dark:text-slate-400">
                    • {portalContext.teacher.subject}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
            <DisplayControls variant="compact" />
            <button
              type="button"
              onClick={() => void loadPortalContext()}
              disabled={contextLoading}
              className="px-3.5 py-2 rounded-xl bg-[#F8F7F2] hover:bg-[#E6E8E2]/60 dark:bg-slate-800 dark:hover:bg-slate-700 border border-[#E6E8E2] dark:border-slate-700 text-[#26334A] dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${contextLoading ? 'animate-spin' : ''}`} />
              <span>{t('refresh')}</span>
            </button>
            <button
              type="button"
              onClick={() => signOut()}
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
            data-testid="teacher-portal-revalidating-banner"
            role="status"
            className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-500/15 dark:border-amber-400/35 px-4 py-3 text-xs dark:text-amber-200 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>{t('teacherPortalRevalidating')}</span>
          </div>
        )}

        {/* Revocation / Action error alert */}
        {actionBannerError && (
          <div
            data-testid="teacher-action-revoked-banner"
            role="alert"
            className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-500/40 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{actionBannerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionBannerError(null)}
              className="text-rose-600 hover:text-rose-900 dark:text-rose-300 dark:hover:text-white cursor-pointer"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scope notice */}
        <div className="flex items-start gap-2.5 rounded-xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-3.5 text-xs text-[#64748B] dark:text-slate-300">
          <ShieldCheck className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0 mt-0.5" />
          <span>{t('teacherScopeNotice')}</span>
        </div>

        {/* State 1: Loading */}
        {contextLoading && (
          <div
            data-testid="teacher-context-loading"
            className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-10 text-center text-sm text-[#64748B] dark:text-slate-300 flex flex-col items-center gap-3"
          >
            <RefreshCw className="w-6 h-6 text-[#174E50] dark:text-teal-400 animate-spin" />
            <span>{t('loadingAssignedGroups')}</span>
          </div>
        )}

        {/* State 2: Context Error */}
        {!contextLoading && contextError && (
          <div
            data-testid="teacher-context-error"
            role="alert"
            className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/40 p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold text-rose-900 dark:text-white">
                  {t('unableLoadAssignedGroups')}
                </h2>
                <p className="text-xs text-rose-700 dark:text-rose-200 mt-1">{contextError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadPortalContext()}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-2 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('retry')}</span>
            </button>
          </div>
        )}

        {/* State 3: Unlinked */}
        {!contextLoading && !contextError && portalContext && !portalContext.linked && (
          <div
            data-testid="teacher-unlinked-state"
            className="rounded-2xl bg-white dark:bg-[#131E2B] border border-amber-200 dark:border-amber-500/35 p-8 text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/35 text-amber-600 dark:text-amber-300 flex items-center justify-center mx-auto">
              <Link2Off className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-[#17213B] dark:text-white">
                {t('teacherNotLinkedTitle')}
              </h2>
              <p className="text-xs text-[#64748B] dark:text-slate-300 leading-relaxed">
                {t('teacherNotLinkedDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadPortalContext()}
              className="px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 dark:border-amber-400/40 dark:text-amber-200 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('retry')}</span>
            </button>
          </div>
        )}

        {/* State 4: Zero Assigned Groups */}
        {!contextLoading &&
          !contextError &&
          portalContext?.linked &&
          portalContext.groups.length === 0 && (
            <div
              data-testid="teacher-no-groups-state"
              className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-8 text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-xl bg-[#F8F7F2] dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#174E50] dark:text-teal-300 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h2 className="text-lg font-bold text-[#17213B] dark:text-white">
                  {t('noAssignedGroupsTitle')}
                </h2>
                <p className="text-xs text-[#64748B] dark:text-slate-300 leading-relaxed">
                  {t('noAssignedGroupsDesc', {
                    name: portalContext.teacher?.full_name || displayName,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadPortalContext()}
                className="px-4 py-2 rounded-xl bg-[#F8F7F2] hover:bg-[#E6E8E2]/60 dark:bg-slate-800 dark:hover:bg-slate-700 border border-[#E6E8E2] dark:border-slate-700 text-[#26334A] dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t('refreshGroupsBtn')}</span>
              </button>
            </div>
          )}

        {/* State 5: Assigned Groups */}
        {!contextLoading &&
          !contextError &&
          portalContext?.linked &&
          portalContext.groups.length > 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Assigned Groups Sidebar */}
                <section
                  aria-label={t('assignedGroupsHeading')}
                  className="lg:col-span-4 rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-5 space-y-3 h-fit shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#17213B] dark:text-white">
                      {t('assignedGroupsHeading')}
                    </h2>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#F8F7F2] dark:bg-slate-800 text-[#64748B] dark:text-slate-300 border border-[#E6E8E2] dark:border-slate-700">
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
                          className={`w-full text-start p-3.5 rounded-xl border transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#D8E8DC]/60 border-[#174E50] text-[#17213B] dark:bg-teal-950/60 dark:border-teal-400/60 dark:text-white'
                              : 'bg-[#F8F7F2] border-[#E6E8E2] text-[#26334A] hover:border-[#174E50]/40 dark:bg-[#0D1520] dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="font-semibold text-sm">{grp.name}</div>
                          <div className="text-xs text-[#64748B] dark:text-slate-400 mt-1 flex items-center justify-between">
                            <span>{grp.grade_level}</span>
                            <span>{t('studentsCountLabel', { count: grp.student_count })}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Selected Group Student Roster */}
                <section
                  aria-label="Selected Group Students"
                  className="lg:col-span-8 rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 space-y-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8E2] dark:border-slate-800 pb-4">
                    <div>
                      <h2 className="text-lg font-extrabold text-[#17213B] dark:text-white" data-testid="selected-group-title">
                        {selectedGroupMeta?.name || t('groupStudentsFallbackTitle')}
                      </h2>
                      {selectedGroupMeta?.grade_level && (
                        <p className="text-xs text-[#64748B] dark:text-slate-400 mt-0.5" data-testid="selected-group-grade">
                          {t('studentRosterSuffix', { grade: selectedGroupMeta.grade_level })}
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
                        className="px-3 py-1.5 rounded-xl bg-[#F8F7F2] hover:bg-[#E6E8E2]/60 dark:bg-slate-800 dark:hover:bg-slate-700 border border-[#E6E8E2] dark:border-slate-700 text-xs font-semibold text-[#26334A] dark:text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${rosterLoading ? 'animate-spin' : ''}`} />
                        <span>{t('reloadRosterBtn')}</span>
                      </button>
                    )}
                  </div>

                  {rosterLoading && (
                    <div
                      data-testid="teacher-students-loading"
                      className="py-10 text-center text-xs text-[#64748B] dark:text-slate-300 flex flex-col items-center gap-2.5"
                    >
                      <RefreshCw className="w-5 h-5 text-[#174E50] dark:text-teal-400 animate-spin" />
                      <span>
                        {t('loadingStudentsInGroup', {
                          group: selectedGroupMeta?.name || t('selectedClassFallback'),
                        })}
                      </span>
                    </div>
                  )}

                  {!rosterLoading && rosterError && (
                    <div
                      data-testid="teacher-students-error"
                      role="alert"
                      className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/40 p-5 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-rose-900 dark:text-white">
                            {t('unableLoadGroupStudents')}
                          </p>
                          <p className="text-xs text-rose-700 dark:text-rose-200 mt-0.5">{rosterError}</p>
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
                            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t('retry')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void loadPortalContext()}
                          className="px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-[#E6E8E2] dark:border-slate-700 text-[#26334A] dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>{t('refreshGroupsBtn')}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {!rosterLoading && !rosterError && rosterStudents.length === 0 && (
                    <div
                      data-testid="teacher-empty-group-state"
                      className="py-10 text-center space-y-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800"
                    >
                      <GraduationCap className="w-7 h-7 text-[#7B8794] dark:text-slate-400 mx-auto" />
                      <p className="text-sm font-semibold text-[#17213B] dark:text-white">
                        {t('noStudentsEnrolledGroupTitle')}
                      </p>
                      <p className="text-xs text-[#64748B] dark:text-slate-400">
                        {t('noStudentsEnrolledGroupDesc', {
                          group: selectedGroupMeta?.name || '',
                        })}
                      </p>
                    </div>
                  )}

                  {!rosterLoading && !rosterError && rosterStudents.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[440px] text-start text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[#E6E8E2] dark:border-slate-800 text-[#7B8794] dark:text-slate-400 uppercase tracking-wider text-[11px] whitespace-nowrap">
                            <th className="py-2.5 pe-4">{t('thStudentName')}</th>
                            <th className="py-2.5 pe-4">{t('thStudentCode')}</th>
                            <th className="py-2.5 pe-4">{t('thStatus')}</th>
                            <th className="py-2.5 text-end">{t('thRecords')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                          {rosterStudents.map((stu) => {
                            const isSelectedStudent = selectedStudent?.id === stu.id;
                            return (
                              <tr
                                key={stu.id}
                                data-testid={`teacher-student-row-${stu.id}`}
                                className={
                                  isSelectedStudent
                                    ? 'bg-[#D8E8DC]/40 dark:bg-teal-950/40'
                                    : undefined
                                }
                              >
                                <td className="py-3 pe-4 font-semibold text-[#17213B] dark:text-white whitespace-nowrap">
                                  {stu.full_name}
                                </td>
                                <td className="py-3 pe-4 font-mono text-[#64748B] dark:text-slate-300 whitespace-nowrap">
                                  {stu.student_code}
                                </td>
                                <td className="py-3 pe-4 whitespace-nowrap">
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold capitalize ${
                                      STATUS_BADGE_STYLES[stu.status] || STATUS_BADGE_STYLES.unknown
                                    }`}
                                  >
                                    {translateStudentStatus(language, stu.status)}
                                  </span>
                                </td>
                                <td className="py-3 text-end">
                                  <button
                                    type="button"
                                    data-testid={`select-student-${stu.id}`}
                                    onClick={() => {
                                      setSavedNotice(null);
                                      void loadStudentRecords(stu.group_id, stu);
                                    }}
                                    className={`px-3 py-1 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                                      isSelectedStudent
                                        ? 'bg-[#174E50] border-[#174E50] text-white dark:bg-teal-600 dark:border-teal-500'
                                        : 'bg-[#F8F7F2] border-[#E6E8E2] text-[#26334A] hover:bg-[#D8E8DC]/50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                  >
                                    {isSelectedStudent ? t('selectedBtn') : t('openRecordsBtn')}
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

              {/* Group Assignments Section */}
              {selectedGroupId && rosterGroupHeader && (
                <section
                  data-testid="teacher-assignments-section"
                  className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 space-y-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8E2] dark:border-slate-800 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-[#174E50] dark:text-teal-300" />
                        <h3 className="text-base font-extrabold text-[#17213B] dark:text-white">
                          {t('assignmentsHeading')}
                        </h3>
                        <span className="text-xs font-semibold text-[#64748B] dark:text-slate-400">
                          — {rosterGroupHeader.name}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="open-publish-assignment-btn"
                      onClick={openAssignmentModal}
                      disabled={isRevalidating}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t('publishAssignmentBtn')}</span>
                    </button>
                  </div>

                  {assignmentsLoading && (
                    <div
                      data-testid="teacher-assignments-loading"
                      className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-5 text-center text-xs text-[#64748B] dark:text-slate-400 flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4 animate-spin text-[#174E50] dark:text-teal-300" />
                      <span>{t('loadingAssignmentsNotice')}</span>
                    </div>
                  )}

                  {!assignmentsLoading && assignmentsError && (
                    <div
                      role="alert"
                      data-testid="teacher-assignments-error"
                      className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 p-4 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="flex items-start gap-2.5 text-rose-800 dark:text-rose-200">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                        <div>
                          <p className="font-bold">
                            {assignmentPublishedPendingTitle
                              ? t('assignmentPublishedRefreshFailed', {
                                  title: assignmentPublishedPendingTitle,
                                })
                              : t('unableLoadAssignments')}
                          </p>
                          <p className="mt-0.5">{assignmentsError}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="retry-load-assignments-btn"
                        onClick={() => void loadGroupAssignments(selectedGroupId)}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
                      >
                        {t('retryLoadAssignmentsBtn')}
                      </button>
                    </div>
                  )}

                  {!assignmentsLoading && !assignmentsError && assignmentsList.length === 0 && (
                    <div
                      data-testid="teacher-assignments-empty"
                      className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#7B8794] dark:text-slate-400"
                    >
                      {t('noTeacherAssignments')}
                    </div>
                  )}

                  {!assignmentsLoading && !assignmentsError && assignmentsList.length > 0 && (
                    <div className="space-y-3">
                      {assignmentsList.map((a) => (
                        <article
                          key={a.id}
                          data-testid={`teacher-assignment-card-${a.id}`}
                          className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="text-sm font-bold text-[#17213B] dark:text-white">{a.title}</h4>
                            <span
                              dir="ltr"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[11px] font-mono font-semibold text-[#174E50] dark:text-teal-300"
                            >
                              <Clock className="w-3 h-3" />
                              {formatCairoDateTime(a.due_at)}
                            </span>
                          </div>
                          <p className="text-xs text-[#26334A] dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                            {a.instructions}
                          </p>
                          {a.attachment && (
                            <div className="rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0" />
                                <span
                                  data-testid={`teacher-attachment-name-${a.id}`}
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
                                data-testid={`teacher-open-attachment-${a.id}`}
                                disabled={openingAttachmentId === a.attachment.id}
                                onClick={() => void handleOpenTeacherAttachment(a)}
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
                          )}
                          {a.attachment && attachmentErrorById[a.attachment.id] && (
                            <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-300">
                              {attachmentErrorById[a.attachment.id]}
                            </p>
                          )}
                          <div className="pt-1 flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              data-testid={`edit-assignment-btn-${a.id}`}
                              disabled={isRevalidating}
                              onClick={() => openEditAssignmentModal(a)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#D8E8DC]/50 dark:hover:bg-slate-700 text-[11px] font-bold text-[#174E50] dark:text-teal-300 transition disabled:opacity-50 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>{t('editAssignmentBtn')}</span>
                            </button>
                            <button
                              type="button"
                              data-testid={`view-submissions-btn-${a.id}`}
                              onClick={() => openSubmissionsModal(a)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#D8E8DC]/50 dark:hover:bg-slate-700 text-[11px] font-bold text-[#174E50] dark:text-teal-300 transition cursor-pointer"
                            >
                              <Users className="w-3.5 h-3.5" />
                              <span>{t('viewSubmissionsBtn')}</span>
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Selected Group Discussion Chat */}
              {selectedGroupId && rosterGroupHeader && (
                <GroupDiscussionChat
                  groupId={selectedGroupId}
                  groupName={rosterGroupHeader.name}
                  userId={user?.id ?? null}
                  disabled={isRevalidating}
                  testIdPrefix="teacher-group-chat"
                />
              )}

              {/* Selected Student Grades & Notes Panel */}
              {selectedStudent && selectedGroupId && (
                <section
                  data-testid="teacher-student-records-panel"
                  className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 space-y-5 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6E8E2] dark:border-slate-800 pb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-extrabold text-[#17213B] dark:text-white" data-testid="selected-student-name">
                          {selectedStudent.full_name}
                        </h3>
                        <span
                          className="font-mono text-xs px-2 py-0.5 rounded bg-[#F8F7F2] dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#174E50] dark:text-teal-300"
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
                          {translateStudentStatus(language, selectedStudent.status)}
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1" data-testid="selected-student-group-label">
                        {t('selectedStudentGroupMeta', {
                          group: selectedGroupMeta?.name || '',
                          grade: selectedGroupMeta?.grade_level || '',
                        })}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadStudentRecords(selectedGroupId, selectedStudent)}
                        disabled={recordsLoading}
                        className="px-3 py-2 rounded-xl bg-[#F8F7F2] hover:bg-[#E6E8E2]/60 dark:bg-slate-800 dark:hover:bg-slate-700 border border-[#E6E8E2] dark:border-slate-700 text-xs font-semibold text-[#26334A] dark:text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${recordsLoading ? 'animate-spin' : ''}`} />
                        <span>{t('reloadRecordsBtn')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={openGradeModal}
                        disabled={!canWriteSelectedStudent || isRevalidating || submitting}
                        className="px-3.5 py-2 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t('addGradeBtn')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={openNoteModal}
                        disabled={!canWriteSelectedStudent || isRevalidating || submitting}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-violet-600 dark:hover:bg-violet-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{t('addNoteBtn')}</span>
                      </button>
                    </div>
                  </div>

                  {!canWriteSelectedStudent && (
                    <div
                      data-testid="inactive-student-write-notice"
                      className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/35 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>
                        {t('inactiveStudentWriteNotice', {
                          status: translateStudentStatus(language, selectedStudent.status),
                        })}
                      </span>
                    </div>
                  )}

                  {savedNotice && (
                    <div
                      data-testid="teacher-save-success-banner"
                      role="status"
                      className="rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/40 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
                        <span>{savedNotice}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSavedNotice(null)}
                        className="text-emerald-700 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-white cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {recordsLoading && (
                    <div
                      data-testid="teacher-records-loading"
                      className="py-8 text-center text-xs text-[#64748B] dark:text-slate-300 flex flex-col items-center gap-2"
                    >
                      <RefreshCw className="w-5 h-5 text-[#174E50] dark:text-teal-400 animate-spin" />
                      <span>
                        {t('loadingStudentRecordsNotice', { name: selectedStudent.full_name })}
                      </span>
                    </div>
                  )}

                  {!recordsLoading && recordsError && (
                    <div
                      data-testid="teacher-records-error"
                      role="alert"
                      className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/40 p-4 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                        <div className="text-xs">
                          <p className="font-semibold text-rose-900 dark:text-white">
                            {savedNotice ? t('savedButRefreshFailed') : t('unableLoadStudentRecords')}
                          </p>
                          <p className="text-rose-700 dark:text-rose-200 mt-0.5">{recordsError}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadStudentRecords(selectedGroupId, selectedStudent)}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>{t('retry')}</span>
                      </button>
                    </div>
                  )}

                  {!recordsLoading && !recordsError && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Grades column */}
                      <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-[#26334A] dark:text-slate-300 flex items-center gap-1.5">
                            <Award className="w-4 h-4 text-[#174E50] dark:text-teal-300" />
                            <span>{t('yourSavedGradesHeading')}</span>
                          </h4>
                          <span className="text-[11px] font-mono text-[#7B8794] dark:text-slate-400">
                            {studentGrades.length}
                          </span>
                        </div>
                        {studentGrades.length === 0 ? (
                          <p className="text-xs text-[#7B8794] dark:text-slate-400 py-3">
                            {t('noSavedGradesByYou')}
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {studentGrades.map((g) => (
                              <div
                                key={g.id}
                                data-testid={`saved-grade-item-${g.id}`}
                                className="rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-3 text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-[#17213B] dark:text-white">
                                    {g.assessment_title}
                                  </span>
                                  <span
                                    dir="ltr"
                                    className="inline-block font-mono font-bold text-[#174E50] dark:text-teal-300 tabular-nums"
                                  >
                                    {g.score} / {g.max_score}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#7B8794] dark:text-slate-400 flex flex-wrap gap-2">
                                  <span className="uppercase">{translateGradeType(language, g.grade_type)}</span>
                                  <span>•</span>
                                  <span>{g.assessment_date}</span>
                                  {g.author_name && (
                                    <>
                                      <span>•</span>
                                      <span>{g.author_name}</span>
                                    </>
                                  )}
                                </div>
                                {g.remarks && (
                                  <p className="text-[#26334A] dark:text-slate-300 pt-1">{g.remarks}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Notes column */}
                      <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-[#26334A] dark:text-slate-300 flex items-center gap-1.5">
                            <MessageSquare className="w-4 h-4 text-[#174E50] dark:text-violet-400" />
                            <span>{t('yourSavedNotesHeading')}</span>
                          </h4>
                          <span className="text-[11px] font-mono text-[#7B8794] dark:text-slate-400">
                            {studentNotes.length}
                          </span>
                        </div>
                        {studentNotes.length === 0 ? (
                          <p className="text-xs text-[#7B8794] dark:text-slate-400 py-3">
                            {t('noSavedNotesByYou')}
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {studentNotes.map((n) => (
                              <div
                                key={n.id}
                                data-testid={`saved-note-item-${n.id}`}
                                className="rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-3 text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                      n.is_parent_visible
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-400/35 dark:text-emerald-300'
                                        : 'bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-700/60 dark:border-slate-500/40 dark:text-slate-300'
                                    }`}
                                  >
                                    {n.is_parent_visible ? t('visibleToParentBadge') : t('internalOnlyBadge')}
                                  </span>
                                  <span className="text-[11px] text-[#7B8794] dark:text-slate-400">
                                    {n.note_date}
                                  </span>
                                </div>
                                <p className="text-[#26334A] dark:text-slate-200 whitespace-pre-wrap">
                                  {n.feedback_text}
                                </p>
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-grade-modal-title"
            className="bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 id="teacher-grade-modal-title" className="text-base font-bold text-[#17213B] dark:text-white">
                {t('addStudentGradeModalTitle')}
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <DisplayControls variant="compact" />
                <button
                  type="button"
                  onClick={() => !submitting && setActiveModal(null)}
                  disabled={submitting}
                  className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              data-testid="modal-student-context"
              className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3 space-y-1 text-[#26334A] dark:text-slate-300"
            >
              <div>
                <span className="text-[#7B8794] dark:text-slate-400">{t('studentColon')}</span>
                <strong className="text-[#17213B] dark:text-white">{selectedStudent.full_name}</strong>{' '}
                <span className="font-mono text-[#174E50] dark:text-teal-300">
                  ({selectedStudent.student_code})
                </span>
              </div>
              <div>
                <span className="text-[#7B8794] dark:text-slate-400">{t('groupColon')}</span>
                <span className="text-[#17213B] dark:text-white">{selectedGroupMeta.name}</span>
              </div>
            </div>

            {modalError && (
              <div
                data-testid="modal-error-banner"
                role="alert"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-rose-800 dark:text-rose-200 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveGrade} className="space-y-3">
              <div>
                <label className="block text-[#26334A] dark:text-slate-300 font-semibold mb-1" htmlFor="tpGradeTitle">
                  {t('assessmentTitleLabel')}
                </label>
                <input
                  id="tpGradeTitle"
                  type="text"
                  required
                  value={assessmentTitle}
                  onChange={(e) => setAssessmentTitle(e.target.value)}
                  disabled={submitting}
                  placeholder={t('assessmentTitlePlaceholder')}
                  className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#26334A] dark:text-slate-300 font-semibold mb-1" htmlFor="tpGradeType">
                    {t('categoryLabel')}
                  </label>
                  <select
                    id="tpGradeType"
                    value={gradeType}
                    onChange={(e) => setGradeType(e.target.value as TeacherGradeCategory)}
                    disabled={submitting}
                    className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  >
                    <option value="exam">{t('catExam')}</option>
                    <option value="quiz">{t('catQuiz')}</option>
                    <option value="assignment">{t('catAssignment')}</option>
                    <option value="participation">{t('catParticipation')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[#26334A] dark:text-slate-300 font-semibold mb-1" htmlFor="tpGradeDate">
                    {t('assessmentDateCairoLabel')}
                  </label>
                  <input
                    id="tpGradeDate"
                    type="date"
                    required
                    max={getCairoDateString()}
                    value={assessmentDate}
                    onChange={(e) => setAssessmentDate(e.target.value)}
                    disabled={submitting}
                    className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#26334A] dark:text-slate-300 font-semibold mb-1" htmlFor="tpGradeScore">
                    {t('scoreLabel')}
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
                    className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>

                <div>
                  <label className="block text-[#26334A] dark:text-slate-300 font-semibold mb-1" htmlFor="tpGradeMax">
                    {t('maxScoreLabel')}
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
                    className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#26334A] dark:text-slate-300 font-semibold mb-1" htmlFor="tpGradeRemarks">
                  {t('remarksOptionalLabel')}
                </label>
                <textarea
                  id="tpGradeRemarks"
                  rows={2}
                  value={gradeRemarks}
                  onChange={(e) => setGradeRemarks(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-[#64748B] dark:text-slate-300 hover:bg-[#F8F7F2] dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting || isRevalidating}
                  className="px-4 py-2 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {submitting ? t('savingGradeBtn') : t('saveGradeBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Teacher Note */}
      {activeModal === 'note' && selectedStudent && selectedGroupMeta && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-note-modal-title"
            className="bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 id="teacher-note-modal-title" className="text-base font-bold text-[#17213B] dark:text-white">
                {t('addStudentNoteModalTitle')}
              </h3>
              <button
                type="button"
                onClick={() => !submitting && setActiveModal(null)}
                disabled={submitting}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              data-testid="modal-student-context"
              className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3 space-y-1 text-[#26334A] dark:text-slate-300"
            >
              <div>
                <span className="text-[#7B8794] dark:text-slate-400">{t('studentColon')}</span>
                <strong className="text-[#17213B] dark:text-white">{selectedStudent.full_name}</strong>{' '}
                <span className="font-mono text-[#174E50] dark:text-teal-300">
                  ({selectedStudent.student_code})
                </span>
              </div>
              <div>
                <span className="text-[#7B8794] dark:text-slate-400">{t('groupColon')}</span>
                <span className="text-[#17213B] dark:text-white">{selectedGroupMeta.name}</span>
              </div>
            </div>

            {modalError && (
              <div
                data-testid="modal-error-banner"
                role="alert"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-rose-800 dark:text-rose-200 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveNote} className="space-y-3">
              <div>
                <label className="block text-[#26334A] dark:text-slate-300 font-semibold mb-1" htmlFor="tpNoteText">
                  {t('noteTextLabel')}
                </label>
                <textarea
                  id="tpNoteText"
                  rows={3}
                  required
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  disabled={submitting}
                  placeholder={t('noteTextPlaceholder')}
                  className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
              </div>

              <fieldset className="space-y-2">
                <legend className="text-[#26334A] dark:text-slate-300 font-semibold mb-1">
                  {t('visibilityLegend')}
                </legend>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 cursor-pointer">
                  <input
                    type="radio"
                    name="noteVisibility"
                    value="internal"
                    checked={!isParentVisible}
                    onChange={() => setIsParentVisible(false)}
                    disabled={submitting}
                  />
                  <span>{t('visibilityInternalOption')}</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 cursor-pointer">
                  <input
                    type="radio"
                    name="noteVisibility"
                    value="parent"
                    checked={isParentVisible}
                    onChange={() => setIsParentVisible(true)}
                    disabled={submitting}
                  />
                  <span>{t('visibilityParentOption')}</span>
                </label>
              </fieldset>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-[#64748B] dark:text-slate-300 hover:bg-[#F8F7F2] dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting || isRevalidating}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-violet-600 dark:hover:bg-violet-700 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {submitting ? t('savingNoteBtn') : t('saveNoteBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Publish Assignment Modal */}
      {activeModal === 'assignment' && selectedGroupId && rosterGroupHeader && (
        <div className="fixed inset-0 bg-[#17213B]/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-assignment-modal-title"
            className="bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <h3
                id="teacher-assignment-modal-title"
                className="text-base font-bold text-[#17213B] dark:text-white"
              >
                {editingAssignment ? t('editAssignmentModalTitle') : t('publishAssignmentModalTitle')}
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <DisplayControls variant="compact" />
                <button
                  type="button"
                  onClick={() => !submitting && setActiveModal(null)}
                  disabled={submitting}
                  className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              data-testid="assignment-modal-group-context"
              className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3 text-[#26334A] dark:text-slate-300"
            >
              <span className="text-[#7B8794] dark:text-slate-400">{t('publishingGroupPrefix')} </span>
              <strong className="text-[#17213B] dark:text-white">{rosterGroupHeader.name}</strong>{' '}
              <span className="text-[11px] text-[#64748B] dark:text-slate-400 whitespace-nowrap">
                ({rosterGroupHeader.grade_level})
              </span>
            </div>

            {modalError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-700 dark:text-rose-200 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveAssignment} className="space-y-3" noValidate>
              <div>
                <label
                  htmlFor="assignment-title-input"
                  className="block font-semibold text-[#17213B] dark:text-slate-200 mb-1"
                >
                  {t('assignmentTitleLabel')}
                </label>
                <input
                  id="assignment-title-input"
                  type="text"
                  value={assignmentTitle}
                  onChange={(e) => setAssignmentTitle(e.target.value)}
                  disabled={submitting}
                  placeholder={t('assignmentTitlePlaceholder')}
                  className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
              </div>

              <div>
                <label
                  htmlFor="assignment-instructions-input"
                  className="block font-semibold text-[#17213B] dark:text-slate-200 mb-1"
                >
                  {t('assignmentInstructionsLabel')}
                </label>
                <textarea
                  id="assignment-instructions-input"
                  rows={4}
                  value={assignmentInstructions}
                  onChange={(e) => setAssignmentInstructions(e.target.value)}
                  disabled={submitting}
                  placeholder={t('assignmentInstructionsPlaceholder')}
                  className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
              </div>

              <div>
                <label
                  htmlFor="assignment-due-input"
                  className="block font-semibold text-[#17213B] dark:text-slate-200 mb-1"
                >
                  {t('assignmentDueAtLabel')}
                </label>
                <input
                  id="assignment-due-input"
                  type="datetime-local"
                  dir="ltr"
                  value={assignmentDueLocal}
                  onChange={(e) => setAssignmentDueLocal(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
              </div>

              {editingAssignment ? (
                editingAssignment.attachment ? (
                  <div
                    data-testid="edit-assignment-preserved-pdf"
                    className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2 text-[11px] text-[#174E50] dark:text-teal-300 flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {t('assignmentEditAttachmentPreservedNote', {
                        fileName: editingAssignment.attachment.file_name,
                      })}
                    </span>
                  </div>
                ) : null
              ) : (
                <div>
                  <label
                    htmlFor="assignment-pdf-input"
                    className="block font-semibold text-[#17213B] dark:text-slate-200 mb-1"
                  >
                    {t('assignmentPdfLabel')}
                  </label>
                  <input
                    ref={assignmentPdfInputRef}
                    id="assignment-pdf-input"
                    data-testid="assignment-pdf-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={submitting}
                    onChange={handleSelectAssignmentPdf}
                    className="sr-only"
                  />
                  {!assignmentPdfFile ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-dashed border-[#CBD5E1] dark:border-slate-700 px-3 py-2.5">
                      <span className="text-[11px] text-[#64748B] dark:text-slate-400">
                        {t('assignmentPdfHint')}
                      </span>
                      <label
                        htmlFor="assignment-pdf-input"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#D8E8DC]/40 dark:hover:bg-slate-700 text-[11px] font-bold text-[#174E50] dark:text-teal-300 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{t('assignmentPdfChooseBtn')}</span>
                      </label>
                    </div>
                  ) : (
                    <div
                      data-testid="assignment-selected-pdf"
                      className="flex items-center justify-between gap-2 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-semibold text-[#17213B] dark:text-white truncate">
                            {assignmentPdfFile.name}
                          </p>
                          <p dir="ltr" className="text-[11px] font-mono text-[#64748B] dark:text-slate-400">
                            {formatAttachmentSize(assignmentPdfFile.size)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="remove-assignment-pdf-btn"
                        disabled={submitting}
                        onClick={handleRemoveAssignmentPdf}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[11px] font-bold hover:bg-rose-100 dark:hover:bg-rose-900/50 disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                        <span>{t('assignmentPdfRemoveBtn')}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {editConflictAssignment && (
                <div
                  data-testid="edit-assignment-conflict-box"
                  className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 p-3 space-y-2 text-[11px] text-amber-900 dark:text-amber-200"
                >
                  <div className="font-bold">{t('assignmentEditLatestSummaryLabel')}</div>
                  <div>
                    <span className="font-semibold">{editConflictAssignment.title}</span> —{' '}
                    <span dir="ltr" className="font-mono">
                      {formatCairoDateTime(editConflictAssignment.due_at)}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-amber-800 dark:text-amber-300">
                    {editConflictAssignment.instructions}
                  </div>
                  <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      data-testid="confirm-assignment-edit-overwrite"
                      checked={editConflictConfirmed}
                      onChange={(e) => setEditConflictConfirmed(e.target.checked)}
                      className="mt-0.5 rounded border-amber-400 text-[#174E50]"
                    />
                    <span className="font-semibold">{t('assignmentEditConfirmOverwriteLabel')}</span>
                  </label>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-[#64748B] dark:text-slate-300 hover:bg-[#F8F7F2] dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  data-testid="confirm-publish-assignment-btn"
                  disabled={
                    submitting ||
                    isRevalidating ||
                    Boolean(editConflictAssignment && !editConflictConfirmed)
                  }
                  className="px-4 py-2 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {editingAssignment
                    ? submitting
                      ? t('savingAssignmentEditBtn')
                      : t('confirmEditAssignmentBtn')
                    : submitting
                      ? t('publishingAssignmentBtn')
                      : t('confirmPublishAssignmentBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignment Submissions Modal */}
      {activeModal === 'submissions' && submissionsAssignment && (
        <div className="fixed inset-0 bg-[#17213B]/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-submissions-modal-title"
            className="bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3
                  id="teacher-submissions-modal-title"
                  className="text-base font-bold text-[#17213B] dark:text-white leading-snug"
                >
                  {t('assignmentSubmissionsModalTitle')}
                </h3>
                <p className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                  {submissionsAssignment.title}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <DisplayControls variant="compact" />
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {submissionsLoading && (
              <div
                data-testid="teacher-submissions-loading"
                className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#64748B] dark:text-slate-400 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4 animate-spin text-[#174E50] dark:text-teal-300" />
                <span>{t('loadingSubmissionsNotice')}</span>
              </div>
            )}

            {!submissionsLoading && submissionsError && (
              <div
                role="alert"
                data-testid="teacher-submissions-error"
                className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 p-4 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-start gap-2 text-rose-800 dark:text-rose-200">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">
                      {submissionsRefreshPendingWarning
                        ? t('assignmentGradeSavedRefreshFailed')
                        : t('unableLoadSubmissions')}
                    </p>
                    <p className="mt-0.5">{submissionsError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="retry-load-submissions-btn"
                  onClick={() => void loadAssignmentSubmissions(submissionsAssignment.id)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
                >
                  {t('retryLoadAssignmentsBtn')}
                </button>
              </div>
            )}

            {!submissionsLoading && !submissionsError && (() => {
              const subByStudentId = new Map(submissionsList.map((s) => [s.student_id, s]));
              const trackerRows = submissionsTrackerStudents.map((stu) => {
                const sub = subByStudentId.get(stu.id) ?? null;
                const status: 'not_submitted' | 'pending_grading' | 'graded' = !sub
                  ? 'not_submitted'
                  : sub.grade
                    ? 'graded'
                    : 'pending_grading';
                return { student: stu, submission: sub, status };
              });
              const notSubmittedCount = trackerRows.filter((r) => r.status === 'not_submitted').length;
              const pendingCount = trackerRows.filter((r) => r.status === 'pending_grading').length;
              const gradedCount = trackerRows.filter((r) => r.status === 'graded').length;
              const filteredRows =
                trackerFilter === 'all'
                  ? trackerRows
                  : trackerRows.filter((r) => r.status === trackerFilter);

              const filterOptions: Array<{
                key: 'all' | 'not_submitted' | 'pending_grading' | 'graded';
                label: string;
                count: number;
              }> = [
                { key: 'all', label: t('trackerFilterAll'), count: trackerRows.length },
                { key: 'not_submitted', label: t('trackerFilterNotSubmitted'), count: notSubmittedCount },
                { key: 'pending_grading', label: t('trackerFilterPendingGrading'), count: pendingCount },
                { key: 'graded', label: t('trackerFilterGraded'), count: gradedCount },
              ];

              return (
                <section
                  data-testid="submissions-follow-up-tracker"
                  className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3.5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-[#17213B] dark:text-white">
                      {t('submissionsTrackerHeading')}
                    </h4>
                    <span
                      dir="ltr"
                      data-testid="tracker-counts-summary"
                      className="text-[11px] font-mono text-[#64748B] dark:text-slate-400"
                    >
                      {notSubmittedCount} / {pendingCount} / {gradedCount}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {filterOptions.map((opt) => {
                      const active = trackerFilter === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          data-testid={`tracker-filter-${opt.key}`}
                          onClick={() => setTrackerFilter(opt.key)}
                          className={`px-2.5 py-1 rounded-full border text-[11px] font-bold transition cursor-pointer ${
                            active
                              ? 'bg-[#174E50] border-[#174E50] text-white dark:bg-teal-600 dark:border-teal-600'
                              : 'bg-white dark:bg-slate-800 border-[#E6E8E2] dark:border-slate-700 text-[#26334A] dark:text-slate-300 hover:border-[#174E50]/40'
                          }`}
                        >
                          {opt.label} ({opt.count})
                        </button>
                      );
                    })}
                  </div>

                  {trackerRows.length === 0 ? (
                    <p className="text-[11px] text-[#7B8794] dark:text-slate-400">
                      {t('trackerNoActiveStudents')}
                    </p>
                  ) : filteredRows.length === 0 ? (
                    <p
                      data-testid="tracker-empty-filter"
                      className="text-[11px] text-[#7B8794] dark:text-slate-400"
                    >
                      {t('trackerEmptyFilter')}
                    </p>
                  ) : (
                    <ul data-testid="submissions-tracker-list" className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                      {filteredRows.map(({ student: stu, status }) => {
                        const statusLabel =
                          status === 'graded'
                            ? t('submissionGradedBadge')
                            : status === 'pending_grading'
                              ? t('submissionPendingGrading')
                              : submissionsCanGrade
                                ? t('trackerStatusMissed')
                                : t('trackerFilterNotSubmitted');
                        const badgeClass =
                          status === 'graded'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200'
                            : status === 'pending_grading'
                              ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-200'
                              : 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300';

                        return (
                          <li
                            key={stu.id}
                            data-testid={`tracker-student-row-${stu.student_code}`}
                            className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-[#17213B] dark:text-white truncate">
                                {stu.full_name}
                              </span>
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#174E50] dark:text-teal-300">
                                {stu.student_code}
                              </span>
                            </div>
                            <span
                              data-testid={`tracker-student-status-${stu.student_code}`}
                              className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${badgeClass}`}
                            >
                              {statusLabel}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })()}

            {!submissionsLoading && !submissionsError && submissionsList.length === 0 && (
              <div
                data-testid="teacher-submissions-empty"
                className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#7B8794] dark:text-slate-400"
              >
                {t('noSubmissionsYet')}
              </div>
            )}

            {!submissionsLoading && !submissionsError && !submissionsCanGrade && (
              <div
                data-testid="teacher-submissions-pre-due-notice"
                className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 p-3 text-xs flex items-center gap-2"
              >
                <Clock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  {t('gradingAvailableAfterDue', {
                    dueAt: formatCairoDateTime(submissionsDueAt || submissionsAssignment.due_at),
                  })}
                </span>
              </div>
            )}

            {!submissionsLoading && !submissionsError && submissionsList.length > 0 && (
              <div className="space-y-3" data-testid="teacher-submissions-list">
                {submissionsList.map((sub) => {
                  const isGraded = Boolean(sub.grade);
                  const draft = submissionGradeDrafts[sub.id] ?? {
                    score: sub.grade ? String(sub.grade.score) : '',
                    maxScore: sub.grade ? String(sub.grade.max_score) : '20',
                  };
                  const isSavingThis = gradingSubmissionId === sub.id;
                  const subErr = gradingErrorById[sub.id];
                  const conflictState = conflictConfirmById[sub.id];
                  const isBlockedByConflictConfirm = Boolean(
                    conflictState?.required && !conflictState.confirmed
                  );

                  return (
                    <article
                      key={sub.id}
                      data-testid={`teacher-submission-item-${sub.student_code}`}
                      className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-[#17213B] dark:text-white">
                            {sub.student_name}
                          </span>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#174E50] dark:text-teal-300">
                            {sub.student_code}
                          </span>
                          <span
                            data-testid={`submission-status-badge-${sub.student_code}`}
                            className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${
                              isGraded
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200'
                                : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-200'
                            }`}
                          >
                            {isGraded ? t('submissionGradedBadge') : t('submissionPendingGrading')}
                          </span>
                        </div>
                        <span dir="ltr" className="font-mono text-[11px] text-[#64748B] dark:text-slate-400">
                          {formatCairoDateTime(sub.updated_at)}
                        </span>
                      </div>

                      {sub.answer_text && (
                        <p className="text-[#26334A] dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {sub.answer_text}
                        </p>
                      )}

                      {sub.attachment && (
                        <div className="space-y-1">
                          <div className="rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0" />
                              <span
                                data-testid={`teacher-submission-attachment-name-${sub.student_code}`}
                                className="text-xs font-semibold text-[#17213B] dark:text-white truncate"
                              >
                                {sub.attachment.file_name}
                              </span>
                              <span
                                dir="ltr"
                                className="text-[11px] font-mono text-[#64748B] dark:text-slate-400 shrink-0"
                              >
                                ({formatAttachmentSize(sub.attachment.size_bytes)})
                              </span>
                            </div>
                            <button
                              type="button"
                              data-testid={`teacher-open-submission-attachment-${sub.student_code}`}
                              disabled={openingAttachmentId === sub.attachment.id}
                              onClick={() => void handleOpenTeacherSubmissionAttachment(sub.attachment!.id)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-[11px] font-bold disabled:opacity-50 transition cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>
                                {openingAttachmentId === sub.attachment.id
                                  ? t('openingAttachmentBtn')
                                  : t('openAttachmentBtn')}
                              </span>
                            </button>
                          </div>
                          {attachmentErrorById[sub.attachment.id] && (
                            <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-300">
                              {attachmentErrorById[sub.attachment.id]}
                            </p>
                          )}
                        </div>
                      )}

                      {sub.grade && (
                        <div
                          data-testid={`submission-saved-grade-${sub.student_code}`}
                          className="flex items-center justify-between rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 px-3 py-2 text-xs"
                        >
                          <span className="font-semibold text-[#64748B] dark:text-slate-300">
                            {t('assignmentGradeResultLabel')}
                          </span>
                          <span
                            dir="ltr"
                            className="font-mono font-bold text-[#174E50] dark:text-teal-300 tabular-nums"
                          >
                            {sub.grade.score} / {sub.grade.max_score}
                          </span>
                        </div>
                      )}

                      {submissionsCanGrade && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleGradeSubmission(sub);
                          }}
                          className="pt-2 border-t border-[#E6E8E2] dark:border-slate-800 space-y-2"
                          noValidate
                        >
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="w-20">
                              <label className="block text-[11px] font-semibold text-[#64748B] dark:text-slate-400 mb-1">
                                {t('assignmentGradeScoreLabel')}
                              </label>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                dir="ltr"
                                data-testid={`grade-score-input-${sub.student_code}`}
                                value={draft.score}
                                onChange={(e) =>
                                  setSubmissionGradeDrafts((prev) => ({
                                    ...prev,
                                    [sub.id]: { ...draft, score: e.target.value },
                                  }))
                                }
                                disabled={isSavingThis}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 text-xs font-mono text-[#17213B] dark:text-white"
                              />
                            </div>
                            <div className="w-20">
                              <label className="block text-[11px] font-semibold text-[#64748B] dark:text-slate-400 mb-1">
                                {t('assignmentGradeMaxLabel')}
                              </label>
                              <input
                                type="number"
                                step="1"
                                min="1"
                                max="999"
                                dir="ltr"
                                data-testid={`grade-max-input-${sub.student_code}`}
                                value={draft.maxScore}
                                onChange={(e) =>
                                  setSubmissionGradeDrafts((prev) => ({
                                    ...prev,
                                    [sub.id]: { ...draft, maxScore: e.target.value },
                                  }))
                                }
                                disabled={isSavingThis}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 text-xs font-mono text-[#17213B] dark:text-white"
                              />
                            </div>
                            <button
                              type="submit"
                              data-testid={`save-submission-grade-btn-${sub.student_code}`}
                              disabled={isSavingThis || isBlockedByConflictConfirm}
                              className="px-3.5 py-1.5 rounded-lg bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {isSavingThis
                                ? t('savingAssignmentGradeBtn')
                                : isGraded
                                  ? t('updateAssignmentGradeBtn')
                                  : t('saveAssignmentGradeBtn')}
                            </button>
                          </div>

                          {conflictState?.required && (
                            <label
                              data-testid={`conflict-confirm-label-${sub.student_code}`}
                              className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 text-[11px] cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                data-testid={`confirm-grade-overwrite-${sub.student_code}`}
                                checked={conflictState.confirmed}
                                onChange={(e) =>
                                  setConflictConfirmById((prev) => ({
                                    ...prev,
                                    [sub.id]: { required: true, confirmed: e.target.checked },
                                  }))
                                }
                                className="mt-0.5"
                              />
                              <span className="font-semibold">{t('assignmentGradeConfirmOverwriteLabel')}</span>
                            </label>
                          )}

                          {subErr && (
                            <div
                              role="alert"
                              data-testid={`grade-submission-error-${sub.student_code}`}
                              className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-700 dark:text-rose-200 text-[11px] flex items-center gap-1.5"
                            >
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>{subErr}</span>
                            </div>
                          )}
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherPortal;
