import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Link2,
  Unlink,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Users,
  GraduationCap,
  UserCheck,
  X,
  ShieldAlert,
} from 'lucide-react';
import { adminService } from '../services/adminService';
import {
  accountLinkingService,
  ParentStudentLink,
} from '../services/accountLinkingService';
import { usePreferences } from '../contexts/preferencesState';
import { Teacher, Student, UserProfile } from '../types/database';

type LinkingPathway = 'teachers' | 'students' | 'parents';

interface PendingLinkTarget {
  type: 'teacher' | 'student';
  recordId: string;
  recordName: string;
  recordMeta: string;
}

type PendingUnlinkTarget =
  | {
      type: 'teacher';
      recordId: string;
      recordName: string;
      recordMeta: string;
      expectedUserId: string;
      linkedAccountName: string;
      linkedAccountEmail: string;
    }
  | {
      type: 'student';
      recordId: string;
      recordName: string;
      recordMeta: string;
      expectedUserId: string;
      linkedAccountName: string;
      linkedAccountEmail: string;
    }
  | {
      type: 'parent';
      parentId: string;
      parentName: string;
      parentEmail: string;
      studentId: string;
      studentName: string;
      studentCode: string;
    };

interface PathwayConflictState {
  message: string;
  refreshing: boolean;
  refreshFailed: boolean;
  refreshCompleted: boolean;
}

interface PathwaySaveRefreshWarning {
  savedMessage: string;
  refreshError: string;
}

export interface AccountLinkingPanelProps {
  onTeachersSynced?: (teachers: Teacher[]) => void;
  onStudentsSynced?: (students: Student[]) => void;
  mutationsDisabled?: boolean;
}

function filterModalAccounts(
  type: 'teacher' | 'student' | undefined,
  teacherProfiles: UserProfile[],
  studentProfiles: UserProfile[],
  linkedTeacherUserIds: Set<string>,
  linkedStudentUserIds: Set<string>,
  searchText: string
): UserProfile[] {
  const base =
    type === 'teacher'
      ? teacherProfiles.filter((p) => !linkedTeacherUserIds.has(p.id))
      : type === 'student'
      ? studentProfiles.filter((p) => !linkedStudentUserIds.has(p.id))
      : [];

  const q = searchText.trim().toLowerCase();
  if (!q) return base;
  return base.filter(
    (p) =>
      (p.full_name || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
  );
}

function filterParents(parentProfiles: UserProfile[], searchText: string): UserProfile[] {
  const q = searchText.trim().toLowerCase();
  if (!q) return parentProfiles;
  return parentProfiles.filter(
    (p) =>
      (p.full_name || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
  );
}

function filterAvailableChildren(
  students: Student[],
  linkedChildIds: Set<string>,
  searchText: string
): Student[] {
  const unlinkedForParent = students.filter((s) => !linkedChildIds.has(s.id));
  const q = searchText.trim().toLowerCase();
  if (!q) return unlinkedForParent;
  return unlinkedForParent.filter(
    (s) =>
      s.full_name.toLowerCase().includes(q) ||
      s.student_code.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
  );
}

export const AccountLinkingPanel: React.FC<AccountLinkingPanelProps> = ({
  onTeachersSynced,
  onStudentsSynced,
  mutationsDisabled = false,
}) => {
  const { language, t } = usePreferences();
  const onTeachersSyncedRef = useRef(onTeachersSynced);
  const onStudentsSyncedRef = useRef(onStudentsSynced);
  useEffect(() => {
    onTeachersSyncedRef.current = onTeachersSynced;
  }, [onTeachersSynced]);
  useEffect(() => {
    onStudentsSyncedRef.current = onStudentsSynced;
  }, [onStudentsSynced]);

  const [pathway, setPathway] = useState<LinkingPathway>('teachers');

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teacherProfiles, setTeacherProfiles] = useState<UserProfile[]>([]);
  const [studentProfiles, setStudentProfiles] = useState<UserProfile[]>([]);
  const [parentProfiles, setParentProfiles] = useState<UserProfile[]>([]);
  const [parentLinks, setParentLinks] = useState<ParentStudentLink[]>([]);

  const [loading, setLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [teacherProfilesError, setTeacherProfilesError] = useState<string | null>(null);
  const [studentProfilesError, setStudentProfilesError] = useState<string | null>(null);
  const [parentProfilesError, setParentProfilesError] = useState<string | null>(null);
  const [parentLinksError, setParentLinksError] = useState<string | null>(null);

  const [teacherSearch, setTeacherSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [parentSearch, setParentSearch] = useState('');
  const [childStudentSearch, setChildStudentSearch] = useState('');
  const [modalAccountSearch, setModalAccountSearch] = useState('');

  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedStudentForParentId, setSelectedStudentForParentId] = useState('');
  const [pendingLink, setPendingLink] = useState<PendingLinkTarget | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [pendingUnlink, setPendingUnlink] = useState<PendingUnlinkTarget | null>(null);

  const [mutating, setMutating] = useState(false);
  const isMutatingRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccessByPathway, setActionSuccessByPathway] = useState<
    Partial<Record<LinkingPathway, string>>
  >({});
  const [conflictByPathway, setConflictByPathway] = useState<
    Partial<Record<LinkingPathway, PathwayConflictState>>
  >({});
  const [saveRefreshWarningByPathway, setSaveRefreshWarningByPathway] = useState<
    Partial<Record<LinkingPathway, PathwaySaveRefreshWarning>>
  >({});

  const mountedRef = useRef(true);
  const loadReqIdRef = useRef(0);
  const pendingLinkRef = useRef(pendingLink);
  const modalAccountSearchRef = useRef(modalAccountSearch);
  const parentSearchRef = useRef(parentSearch);
  const childStudentSearchRef = useRef(childStudentSearch);
  useEffect(() => {
    pendingLinkRef.current = pendingLink;
    modalAccountSearchRef.current = modalAccountSearch;
    parentSearchRef.current = parentSearch;
    childStudentSearchRef.current = childStudentSearch;
  }, [pendingLink, modalAccountSearch, parentSearch, childStudentSearch]);

  const fetchLinkingSettled = useCallback(async () => {
    const getErr = (err: unknown, fallback: string) =>
      err instanceof Error && err.message ? err.message : fallback;

    const [
      teachersRes,
      studentsRes,
      tProfilesRes,
      sProfilesRes,
      pProfilesRes,
      linksRes,
    ] = await Promise.all([
      adminService
        .getTeachers()
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: unknown) => ({ data: null, error: getErr(err, 'Failed to load teachers') })),
      adminService
        .getStudents()
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: unknown) => ({ data: null, error: getErr(err, 'Failed to load students') })),
      accountLinkingService
        .getProfilesByRole('teacher')
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: unknown) => ({ data: null, error: getErr(err, 'Failed to load teacher accounts') })),
      accountLinkingService
        .getProfilesByRole('student')
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: unknown) => ({ data: null, error: getErr(err, 'Failed to load student accounts') })),
      accountLinkingService
        .getProfilesByRole('parent')
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: unknown) => ({ data: null, error: getErr(err, 'Failed to load parent accounts') })),
      accountLinkingService
        .getParentStudentLinks()
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: unknown) => ({ data: null, error: getErr(err, 'Failed to load parent-student links') })),
    ]);

    return { teachersRes, studentsRes, tProfilesRes, sProfilesRes, pProfilesRes, linksRes };
  }, []);

  const applyLinkingSettled = useCallback(
    ({
      teachersRes,
      studentsRes,
      tProfilesRes,
      sProfilesRes,
      pProfilesRes,
      linksRes,
    }: Awaited<ReturnType<typeof fetchLinkingSettled>>): {
      pathwayOk: Record<LinkingPathway, boolean>;
      pathwayErrors: Record<LinkingPathway, string[]>;
    } => {
      let tErr: string | null = null;
      let sErr: string | null = null;
      let tpErr: string | null = null;
      let spErr: string | null = null;
      let ppErr: string | null = null;
      let plErr: string | null = null;

      if (!teachersRes.error && teachersRes.data) {
        setTeachers(teachersRes.data);
        setTeachersError(null);
        onTeachersSyncedRef.current?.(teachersRes.data);
      } else {
        tErr = teachersRes.error || 'Failed to load teachers';
        setTeachersError(tErr);
      }

      if (!studentsRes.error && studentsRes.data) {
        setStudents(studentsRes.data);
        setStudentsError(null);
        onStudentsSyncedRef.current?.(studentsRes.data);
      } else {
        sErr = studentsRes.error || 'Failed to load students';
        setStudentsError(sErr);
      }

      if (!tProfilesRes.error && tProfilesRes.data) {
        setTeacherProfiles(tProfilesRes.data);
        setTeacherProfilesError(null);
      } else {
        tpErr = tProfilesRes.error || 'Failed to load teacher accounts';
        setTeacherProfilesError(tpErr);
      }

      if (!sProfilesRes.error && sProfilesRes.data) {
        setStudentProfiles(sProfilesRes.data);
        setStudentProfilesError(null);
      } else {
        spErr = sProfilesRes.error || 'Failed to load student accounts';
        setStudentProfilesError(spErr);
      }

      if (!pProfilesRes.error && pProfilesRes.data) {
        setParentProfiles(pProfilesRes.data);
        setParentProfilesError(null);
      } else {
        ppErr = pProfilesRes.error || 'Failed to load parent accounts';
        setParentProfilesError(ppErr);
      }

      if (!linksRes.error && linksRes.data) {
        setParentLinks(linksRes.data);
        setParentLinksError(null);
      } else {
        plErr = linksRes.error || 'Failed to load parent-student links';
        setParentLinksError(plErr);
      }

      const nextTeachersList = !teachersRes.error && teachersRes.data ? teachersRes.data : [];
      const nextStudentsList = !studentsRes.error && studentsRes.data ? studentsRes.data : [];
      const nextTeacherAccs = !tProfilesRes.error && tProfilesRes.data ? tProfilesRes.data : [];
      const nextStudentAccs = !sProfilesRes.error && sProfilesRes.data ? sProfilesRes.data : [];
      const nextParentAccs = !pProfilesRes.error && pProfilesRes.data ? pProfilesRes.data : [];
      const nextLinks = !linksRes.error && linksRes.data ? linksRes.data : [];

      const nextLinkedT = new Set(nextTeachersList.map((tRow) => tRow.user_id).filter(Boolean) as string[]);
      const nextLinkedS = new Set(nextStudentsList.map((sRow) => sRow.user_id).filter(Boolean) as string[]);
      const nextAvailableModalAccs = filterModalAccounts(
        pendingLinkRef.current?.type,
        nextTeacherAccs,
        nextStudentAccs,
        nextLinkedT,
        nextLinkedS,
        modalAccountSearchRef.current
      );
      setSelectedAccountId((prev) =>
        prev && nextAvailableModalAccs.some((acc) => acc.id === prev) ? prev : ''
      );

      const nextParentsFiltered = filterParents(nextParentAccs, parentSearchRef.current);
      setSelectedParentId((prevParent) => {
        const parentStillValid = Boolean(prevParent && nextParentsFiltered.some((p) => p.id === prevParent));
        if (!parentStillValid) {
          setSelectedStudentForParentId('');
          return '';
        }
        const nextLinkedChildren = new Set(
          nextLinks.filter((l) => l.parent_id === prevParent).map((l) => l.student_id)
        );
        const nextChildrenFiltered = filterAvailableChildren(
          nextStudentsList,
          nextLinkedChildren,
          childStudentSearchRef.current
        );
        setSelectedStudentForParentId((prevChild) =>
          prevChild && nextChildrenFiltered.some((s) => s.id === prevChild) ? prevChild : ''
        );
        return prevParent;
      });

      setLoading(false);

      const teachersPathErrors = [tErr && `Teachers: ${tErr}`, tpErr && `Teacher accounts: ${tpErr}`].filter(Boolean) as string[];
      const studentsPathErrors = [sErr && `Students: ${sErr}`, spErr && `Student accounts: ${spErr}`].filter(Boolean) as string[];
      const parentsPathErrors = [
        ppErr && `Parent accounts: ${ppErr}`,
        plErr && `Parent-student links: ${plErr}`,
        sErr && `Students directory: ${sErr}`,
      ].filter(Boolean) as string[];

      const pathwayOk: Record<LinkingPathway, boolean> = {
        teachers: teachersPathErrors.length === 0,
        students: studentsPathErrors.length === 0,
        parents: parentsPathErrors.length === 0,
      };

      const pathwayErrors: Record<LinkingPathway, string[]> = {
        teachers: teachersPathErrors,
        students: studentsPathErrors,
        parents: parentsPathErrors,
      };

      setSaveRefreshWarningByPathway((prev) => {
        const next = { ...prev };
        (['teachers', 'students', 'parents'] as LinkingPathway[]).forEach((p) => {
          if (pathwayOk[p]) delete next[p];
        });
        return next;
      });

      setConflictByPathway((prev) => {
        const next = { ...prev };
        (['teachers', 'students', 'parents'] as LinkingPathway[]).forEach((p) => {
          if (next[p] && next[p]!.refreshFailed && pathwayOk[p]) {
            next[p] = {
              ...next[p]!,
              refreshing: false,
              refreshFailed: false,
              refreshCompleted: true,
            };
          }
        });
        return next;
      });

      return { pathwayOk, pathwayErrors };
    },
    []
  );

  const loadAllData = useCallback(async () => {
    const reqId = ++loadReqIdRef.current;
    setLoading(true);
    const settled = await fetchLinkingSettled();
    if (!mountedRef.current || reqId !== loadReqIdRef.current) {
      return {
        pathwayOk: { teachers: false, students: false, parents: false },
        pathwayErrors: { teachers: [], students: [], parents: [] },
      };
    }
    return applyLinkingSettled(settled);
  }, [fetchLinkingSettled, applyLinkingSettled]);

  useEffect(() => {
    mountedRef.current = true;
    const reqRef = loadReqIdRef;
    const reqId = ++reqRef.current;

    fetchLinkingSettled().then((settled) => {
      if (!mountedRef.current || reqId !== reqRef.current) return;
      applyLinkingSettled(settled);
    });

    return () => {
      mountedRef.current = false;
      reqRef.current++;
    };
  }, [fetchLinkingSettled, applyLinkingSettled]);

  const linkedTeacherUserIds = useMemo(
    () => new Set(teachers.map((tRow) => tRow.user_id).filter(Boolean) as string[]),
    [teachers]
  );
  const linkedStudentUserIds = useMemo(
    () => new Set(students.map((sRow) => sRow.user_id).filter(Boolean) as string[]),
    [students]
  );

  const availableAccountsForModal = useMemo(
    () =>
      filterModalAccounts(
        pendingLink?.type,
        teacherProfiles,
        studentProfiles,
        linkedTeacherUserIds,
        linkedStudentUserIds,
        modalAccountSearch
      ),
    [
      pendingLink?.type,
      teacherProfiles,
      studentProfiles,
      linkedTeacherUserIds,
      linkedStudentUserIds,
      modalAccountSearch,
    ]
  );

  const filteredParentProfiles = useMemo(
    () => filterParents(parentProfiles, parentSearch),
    [parentProfiles, parentSearch]
  );

  const visibleParentId = filteredParentProfiles.some((p) => p.id === selectedParentId)
    ? selectedParentId
    : '';

  const selectedParentProfile =
    filteredParentProfiles.find((p) => p.id === visibleParentId) || null;
  const selectedParentLinks = useMemo(
    () => parentLinks.filter((l) => l.parent_id === visibleParentId),
    [parentLinks, visibleParentId]
  );
  const linkedChildIdsForSelectedParent = useMemo(
    () => new Set(selectedParentLinks.map((l) => l.student_id)),
    [selectedParentLinks]
  );

  const availableStudentsForParent = useMemo(
    () =>
      visibleParentId
        ? filterAvailableChildren(students, linkedChildIdsForSelectedParent, childStudentSearch)
        : [],
    [visibleParentId, students, linkedChildIdsForSelectedParent, childStudentSearch]
  );

  const visibleSelectedAccountId = availableAccountsForModal.some(
    (acc) => acc.id === selectedAccountId
  )
    ? selectedAccountId
    : '';

  const visibleStudentForParentId =
    visibleParentId && availableStudentsForParent.some((s) => s.id === selectedStudentForParentId)
      ? selectedStudentForParentId
      : '';

  const runMutation = async <T,>(
    targetPathway: LinkingPathway,
    operation: () => Promise<{ data: T | null; error: string | null; code?: string }>,
    successSummary: string,
    closeModals: () => void
  ) => {
    const pathwayConflict = conflictByPathway[targetPathway];
    const pathwaySaveWarn = saveRefreshWarningByPathway[targetPathway];
    if (
      mutationsDisabled ||
      isMutatingRef.current ||
      loading ||
      pathwayConflict?.refreshing ||
      pathwayConflict?.refreshFailed ||
      !!pathwaySaveWarn
    ) {
      if (mutationsDisabled) {
        setActionError(t('errLinkingRevalidating'));
      }
      return;
    }

    isMutatingRef.current = true;
    setMutating(true);
    setActionError(null);
    setActionSuccessByPathway((prev) => {
      const next = { ...prev };
      delete next[targetPathway];
      return next;
    });
    setConflictByPathway((prev) => {
      const next = { ...prev };
      delete next[targetPathway];
      return next;
    });

    let result: { data: T | null; error: string | null; code?: string };
    try {
      result = await operation();
    } catch (err: unknown) {
      result = {
        data: null,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unexpected error during account linking operation',
        code: 'NETWORK_ERROR',
      };
    }

    if (result.error && (result.code === 'CONFLICT' || result.code === 'ALREADY_LINKED')) {
      closeModals();
      setConflictByPathway((prev) => ({
        ...prev,
        [targetPathway]: {
          message: result.error!,
          refreshing: true,
          refreshFailed: false,
          refreshCompleted: false,
        },
      }));

      const refresh = await loadAllData();
      setConflictByPathway((prev) => ({
        ...prev,
        [targetPathway]: {
          message: result.error!,
          refreshing: false,
          refreshFailed: !refresh.pathwayOk[targetPathway],
          refreshCompleted: refresh.pathwayOk[targetPathway],
        },
      }));

      setMutating(false);
      isMutatingRef.current = false;
      return;
    }

    if (result.error || !result.data) {
      setActionError(result.error || 'Failed to complete operation.');
      setMutating(false);
      isMutatingRef.current = false;
      return;
    }

    closeModals();
    if (targetPathway === 'parents') {
      setSelectedStudentForParentId('');
    }

    const refresh = await loadAllData();
    if (!refresh.pathwayOk[targetPathway]) {
      setSaveRefreshWarningByPathway((prev) => ({
        ...prev,
        [targetPathway]: {
          savedMessage: successSummary,
          refreshError: refresh.pathwayErrors[targetPathway].join(' | '),
        },
      }));
    } else {
      setActionSuccessByPathway((prev) => ({
        ...prev,
        [targetPathway]: successSummary,
      }));
    }

    setMutating(false);
    isMutatingRef.current = false;
  };

  const handleManualReload = async () => {
    if (loading || mutating) return;
    setActionError(null);
    await loadAllData();
  };

  const teachersReady = !loading && !teachersError && !teacherProfilesError;
  const studentsReady = !loading && !studentsError && !studentProfilesError;
  const parentsReady = !loading && !parentProfilesError && !parentLinksError && !studentsError;

  const isPathwayLocked = (p: LinkingPathway): boolean => {
    const conflict = conflictByPathway[p];
    const saveWarn = saveRefreshWarningByPathway[p];
    const ready = p === 'teachers' ? teachersReady : p === 'students' ? studentsReady : parentsReady;
    return (
      mutationsDisabled ||
      mutating ||
      loading ||
      !ready ||
      !!saveWarn ||
      !!conflict?.refreshing ||
      !!conflict?.refreshFailed
    );
  };

  const teachersLocked = isPathwayLocked('teachers');
  const studentsLocked = isPathwayLocked('students');
  const parentsLocked = isPathwayLocked('parents');

  const filteredTeachers = teachers.filter((tch) => {
    const q = teacherSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      tch.full_name.toLowerCase().includes(q) ||
      tch.email.toLowerCase().includes(q) ||
      tch.subject.toLowerCase().includes(q)
    );
  });

  const filteredStudents = students.filter((s) => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.student_code.toLowerCase().includes(q) ||
      (s.class_name || '').toLowerCase().includes(q)
    );
  });

  const handleModalAccountSearchChange = (value: string) => {
    setModalAccountSearch(value);
    const nextAccounts = filterModalAccounts(
      pendingLink?.type,
      teacherProfiles,
      studentProfiles,
      linkedTeacherUserIds,
      linkedStudentUserIds,
      value
    );
    if (selectedAccountId && !nextAccounts.some((acc) => acc.id === selectedAccountId)) {
      setSelectedAccountId('');
    }
  };

  const handleParentSearchChange = (value: string) => {
    setParentSearch(value);
    const nextParents = filterParents(parentProfiles, value);
    if (selectedParentId && !nextParents.some((p) => p.id === selectedParentId)) {
      setSelectedParentId('');
      setSelectedStudentForParentId('');
    }
  };

  const handleChildStudentSearchChange = (value: string) => {
    setChildStudentSearch(value);
    const nextChildren = filterAvailableChildren(students, linkedChildIdsForSelectedParent, value);
    if (selectedStudentForParentId && !nextChildren.some((s) => s.id === selectedStudentForParentId)) {
      setSelectedStudentForParentId('');
    }
  };

  const handleConfirmLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingLink || !selectedAccountId) return;

    const targetPathway: LinkingPathway = pendingLink.type === 'teacher' ? 'teachers' : 'students';
    if (isPathwayLocked(targetPathway)) return;

    const chosenAccount = availableAccountsForModal.find((p) => p.id === selectedAccountId);
    const targetStillEligible =
      pendingLink.type === 'teacher'
        ? teachers.some((tch) => tch.id === pendingLink.recordId && !tch.user_id)
        : students.some((s) => s.id === pendingLink.recordId && !s.user_id);

    if (!chosenAccount || !targetStillEligible) {
      setSelectedAccountId('');
      return;
    }

    if (pendingLink.type === 'teacher') {
      await runMutation(
        'teachers',
        () => accountLinkingService.linkTeacherAccount(pendingLink.recordId, chosenAccount.id),
        t('toastLinkedTeacher', {
          teacher: pendingLink.recordName,
          email: chosenAccount.email,
        }),
        () => {
          setPendingLink(null);
          setSelectedAccountId('');
          setModalAccountSearch('');
        }
      );
    } else {
      await runMutation(
        'students',
        () => accountLinkingService.linkStudentAccount(pendingLink.recordId, chosenAccount.id),
        t('toastLinkedStudent', {
          student: pendingLink.recordName,
          code: pendingLink.recordMeta,
          email: chosenAccount.email,
        }),
        () => {
          setPendingLink(null);
          setSelectedAccountId('');
          setModalAccountSearch('');
        }
      );
    }
  };

  const handleConfirmUnlink = async () => {
    if (!pendingUnlink) return;
    const targetPathway: LinkingPathway =
      pendingUnlink.type === 'teacher'
        ? 'teachers'
        : pendingUnlink.type === 'student'
        ? 'students'
        : 'parents';

    if (isPathwayLocked(targetPathway)) return;

    if (pendingUnlink.type === 'teacher') {
      await runMutation(
        'teachers',
        () =>
          accountLinkingService.unlinkTeacherAccount(
            pendingUnlink.recordId,
            pendingUnlink.expectedUserId
          ),
        t('toastUnlinkedTeacher', {
          email: pendingUnlink.linkedAccountEmail || pendingUnlink.expectedUserId,
          teacher: pendingUnlink.recordName,
        }),
        () => setPendingUnlink(null)
      );
    } else if (pendingUnlink.type === 'student') {
      await runMutation(
        'students',
        () =>
          accountLinkingService.unlinkStudentAccount(
            pendingUnlink.recordId,
            pendingUnlink.expectedUserId
          ),
        t('toastUnlinkedStudent', {
          email: pendingUnlink.linkedAccountEmail || pendingUnlink.expectedUserId,
          student: pendingUnlink.recordName,
        }),
        () => setPendingUnlink(null)
      );
    } else {
      await runMutation(
        'parents',
        () =>
          accountLinkingService.unlinkParentStudent(
            pendingUnlink.parentId,
            pendingUnlink.studentId
          ),
        t('toastRemovedParentLink', {
          parent: pendingUnlink.parentName,
          student: pendingUnlink.studentName,
          code: pendingUnlink.studentCode,
        }),
        () => setPendingUnlink(null)
      );
    }
  };

  const handleLinkParentStudent = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (parentsLocked || !selectedParentId || !selectedStudentForParentId) return;

    const parentObj = filteredParentProfiles.find((p) => p.id === selectedParentId);
    if (!parentObj) {
      setSelectedParentId('');
      setSelectedStudentForParentId('');
      return;
    }

    const studentObj = availableStudentsForParent.find((s) => s.id === selectedStudentForParentId);
    if (!studentObj) {
      setSelectedStudentForParentId('');
      return;
    }

    await runMutation(
      'parents',
      () => accountLinkingService.linkParentStudent(parentObj.id, studentObj.id),
      t('toastLinkedParentStudent', {
        parent: parentObj.full_name,
        student: studentObj.full_name,
        code: studentObj.student_code,
      }),
      () => {}
    );
  };

  const activeSuccess = actionSuccessByPathway[pathway] || null;
  const activeConflict = conflictByPathway[pathway] || null;
  const activeSaveWarn = saveRefreshWarningByPathway[pathway] || null;

  const pathwayHasAttention = (p: LinkingPathway): boolean => {
    if (p === 'teachers') return !!teachersError || !!teacherProfilesError || !!saveRefreshWarningByPathway.teachers;
    if (p === 'students') return !!studentsError || !!studentProfilesError || !!saveRefreshWarningByPathway.students;
    return !!parentProfilesError || !!parentLinksError || !!studentsError || !!saveRefreshWarningByPathway.parents;
  };

  return (
    <div className="space-y-6">
      {/* Header & Global Refresh */}
      <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-[#17213B] dark:text-white">{t('accountLinkingTitle')}</h3>
          <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-1">
            {t('accountLinkingSubtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleManualReload}
          disabled={loading || mutating}
          className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#17213B] dark:text-slate-200 hover:bg-[#F8F7F2] dark:hover:bg-slate-700 transition flex items-center gap-2 self-start md:self-auto disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? t('loadingPlaceholder') : t('refreshDirectoryBtn')}</span>
        </button>
      </div>

      {/* Pathway Tabs */}
      <div className="bg-white dark:bg-[#131E2B] rounded-2xl p-2 border border-[#E6E8E2] dark:border-slate-800 shadow-xs flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPathway('teachers');
            setActionError(null);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            pathway === 'teachers'
              ? 'bg-[#174E50] dark:bg-[#147477] text-white shadow-xs'
              : 'bg-[#F8F7F2] dark:bg-[#0D1520] text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>{t('pathwayTeachersLabel', { count: teachers.length })}</span>
          {pathwayHasAttention('teachers') && (
            <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="Teachers pathway has error" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setPathway('students');
            setActionError(null);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            pathway === 'students'
              ? 'bg-[#174E50] dark:bg-[#147477] text-white shadow-xs'
              : 'bg-[#F8F7F2] dark:bg-[#0D1520] text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>{t('pathwayStudentsLabel', { count: students.length })}</span>
          {pathwayHasAttention('students') && (
            <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="Students pathway has error" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setPathway('parents');
            setActionError(null);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            pathway === 'parents'
              ? 'bg-[#174E50] dark:bg-[#147477] text-white shadow-xs'
              : 'bg-[#F8F7F2] dark:bg-[#0D1520] text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>{t('pathwayParentsLabel', { count: parentProfiles.length })}</span>
          {pathwayHasAttention('parents') && (
            <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="Parents pathway has error" />
          )}
        </button>
      </div>

      {/* Save Warning */}
      {activeSaveWarn && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold">{t('saveWarnTitle')}</p>
              <p>{activeSaveWarn.savedMessage}</p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                {t('refreshErrorPrefix', { error: activeSaveWarn.refreshError })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManualReload}
            disabled={loading}
            className="px-4 py-2 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 transition flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('reloadListBtn')}</span>
          </button>
        </div>
      )}

      {/* Conflict Notice */}
      {activeConflict && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-950 dark:text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">{t('conflictDetectedTitle')}</p>
              <p>{activeConflict.message}</p>
              {activeConflict.refreshing ? (
                <p className="text-[11px] text-amber-800 dark:text-amber-300 font-semibold mt-1">
                  {t('conflictRefreshing')}
                </p>
              ) : activeConflict.refreshFailed ? (
                <p className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold mt-1">
                  {t('conflictRefreshFailed')}
                </p>
              ) : (
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold mt-1">
                  {t('conflictRefreshDone')}
                </p>
              )}
            </div>
          </div>
          {activeConflict.refreshFailed ? (
            <button
              type="button"
              onClick={handleManualReload}
              disabled={loading}
              className="px-4 py-2 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 transition shrink-0 cursor-pointer"
            >
              {t('reloadListBtn')}
            </button>
          ) : !activeConflict.refreshing ? (
            <button
              type="button"
              onClick={() =>
                setConflictByPathway((prev) => {
                  const next = { ...prev };
                  delete next[pathway];
                  return next;
                })
              }
              className="text-amber-800 dark:text-amber-300 hover:text-amber-950 dark:hover:text-white p-1 self-start cursor-pointer"
              aria-label="Dismiss conflict notice"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      )}

      {/* Action Success Banner */}
      {activeSuccess && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/50 text-emerald-900 dark:text-emerald-200 text-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span className="font-medium">{activeSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() =>
              setActionSuccessByPathway((prev) => {
                const next = { ...prev };
                delete next[pathway];
                return next;
              })
            }
            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white p-1 cursor-pointer"
            aria-label="Dismiss success notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Inline Action Error */}
      {actionError && !pendingLink && !pendingUnlink && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-white p-1 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* PATHWAY 1: TEACHERS */}
      {pathway === 'teachers' && (
        <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-[#17213B] dark:text-white">
                {t('teacherLinkingHeading')}
              </h4>
              <p className="text-xs text-[#7B8794] dark:text-slate-400">
                {t('teacherLinkingDescPrefix')}
                <code className="font-mono bg-[#F8F7F2] dark:bg-slate-800 px-1 rounded">teacher</code>.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-[#7B8794] dark:text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label={t('teacherSearchAria')}
                placeholder={t('teacherSearchPlaceholder')}
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                className="w-full ps-9 pe-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
              />
            </div>
          </div>

          {(teachersError || teacherProfilesError) && (
            <div
              role="alert"
              className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 text-rose-900 dark:text-rose-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{t('teacherDataFailedTitle')}</p>
                  {teachersError && <p>{t('teachersListPrefix')} {teachersError}</p>}
                  {teacherProfilesError && <p>{t('teacherAccountsPrefix')} {teacherProfilesError}</p>}
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">
                    {t('teacherLinkingDisabledNote')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleManualReload}
                disabled={loading}
                className="px-4 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition shrink-0 cursor-pointer"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#7B8794] dark:text-slate-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
              <span>{t('loadingTeachersAndAccounts')}</span>
            </div>
          ) : teachersError ? (
            <div className="py-10 text-center text-xs text-rose-700 dark:text-rose-300 border border-dashed border-rose-200 dark:border-rose-700/50 rounded-2xl">
              {t('teachersDirectoryUnavailable')}
            </div>
          ) : filteredTeachers.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
              {teachers.length === 0 ? t('noTeacherRecordsFound') : t('noTeachersMatchFilter')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="bg-[#D8E8DC]/30 dark:bg-slate-800/70 text-[#7B8794] dark:text-slate-300 font-semibold uppercase tracking-wider">
                    <th className="py-2.5 px-4">{t('colTeacherRecord')}</th>
                    <th className="py-2.5 px-4">{t('colLinkedAuthAccount')}</th>
                    <th className="py-2.5 px-4">{t('colStatusTitle')}</th>
                    <th className="py-2.5 px-4 text-end">{t('colActionTitle')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                  {filteredTeachers.map((teacher) => {
                    const linkedProfile = teacher.user_id
                      ? teacherProfiles.find((p) => p.id === teacher.user_id) || null
                      : null;

                    return (
                      <tr key={teacher.id} className="hover:bg-[#F8F7F2] dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#17213B] dark:text-white">{teacher.full_name}</div>
                          <div className="text-[11px] text-[#7B8794] dark:text-slate-400">
                            {teacher.email} • {teacher.subject}
                          </div>
                          <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500 mt-0.5">
                            ID: {teacher.id}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {teacher.user_id ? (
                            <div>
                              <div className="font-semibold text-[#174E50] dark:text-teal-300">
                                {linkedProfile?.full_name || t('linkedUserProfileFallback')}
                              </div>
                              {linkedProfile?.email && (
                                <div className="text-[11px] text-[#7B8794] dark:text-slate-400">
                                  {linkedProfile.email}
                                </div>
                              )}
                              <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                                UUID: {teacher.user_id}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[#7B8794] dark:text-slate-500 italic">
                              {t('noLinkedAccount')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {teacher.user_id ? (
                            <span className="px-2.5 py-1 rounded-full bg-[#D8E8DC] dark:bg-teal-950/70 text-[#174E50] dark:text-teal-300 text-[10px] font-semibold">
                              {t('badgeLinked')}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-semibold">
                              {t('badgeUnlinked')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-end">
                          {teacher.user_id ? (
                            <button
                              type="button"
                              disabled={teachersLocked}
                              onClick={() => {
                                setActionError(null);
                                setPendingUnlink({
                                  type: 'teacher',
                                  recordId: teacher.id,
                                  recordName: teacher.full_name,
                                  recordMeta: teacher.email,
                                  expectedUserId: teacher.user_id!,
                                  linkedAccountName: linkedProfile?.full_name || t('linkedUserProfileFallback'),
                                  linkedAccountEmail: linkedProfile?.email || teacher.user_id!,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-rose-200 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Unlink className="w-3 h-3" />
                              <span>{t('unlinkAccountBtn')}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={teachersLocked}
                              onClick={() => {
                                setActionError(null);
                                setSelectedAccountId('');
                                setModalAccountSearch('');
                                setPendingLink({
                                  type: 'teacher',
                                  recordId: teacher.id,
                                  recordName: teacher.full_name,
                                  recordMeta: teacher.email,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#174E50] dark:bg-[#147477] text-white hover:bg-[#174E50]/90 dark:hover:bg-[#106063] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>{t('linkAccountBtn')}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PATHWAY 2: STUDENTS */}
      {pathway === 'students' && (
        <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-[#17213B] dark:text-white">
                {t('studentLinkingHeading')}
              </h4>
              <p className="text-xs text-[#7B8794] dark:text-slate-400">
                {t('studentLinkingDescPre')}
                <code className="font-mono bg-[#F8F7F2] dark:bg-slate-800 px-1 rounded">student_code</code>
                {t('studentLinkingDescPost')}
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-[#7B8794] dark:text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label={t('studentSearchAria')}
                placeholder={t('studentSearchPlaceholder')}
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="w-full ps-9 pe-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
              />
            </div>
          </div>

          {(studentsError || studentProfilesError) && (
            <div
              role="alert"
              className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 text-rose-900 dark:text-rose-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{t('studentDataFailedTitle')}</p>
                  {studentsError && <p>{t('studentsListPrefix')} {studentsError}</p>}
                  {studentProfilesError && <p>{t('studentAccountsPrefix')} {studentProfilesError}</p>}
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">
                    {t('studentLinkingDisabledNote')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleManualReload}
                disabled={loading}
                className="px-4 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition shrink-0 cursor-pointer"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#7B8794] dark:text-slate-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
              <span>{t('loadingStudentsAndAccounts')}</span>
            </div>
          ) : studentsError ? (
            <div className="py-10 text-center text-xs text-rose-700 dark:text-rose-300 border border-dashed border-rose-200 dark:border-rose-700/50 rounded-2xl">
              {t('studentsDirectoryUnavailable')}
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
              {students.length === 0 ? t('noStudentRecordsFound') : t('noStudentsMatchFilter')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="bg-[#D8E8DC]/30 dark:bg-slate-800/70 text-[#7B8794] dark:text-slate-300 font-semibold uppercase tracking-wider">
                    <th className="py-2.5 px-4">{t('colStudentRecord')}</th>
                    <th className="py-2.5 px-4">{t('colCodeAndClass')}</th>
                    <th className="py-2.5 px-4">{t('colLinkedAuthAccount')}</th>
                    <th className="py-2.5 px-4 text-end">{t('colActionTitle')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                  {filteredStudents.map((student) => {
                    const linkedProfile = student.user_id
                      ? studentProfiles.find((p) => p.id === student.user_id) || null
                      : null;

                    return (
                      <tr key={student.id} className="hover:bg-[#F8F7F2] dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#17213B] dark:text-white">{student.full_name}</div>
                          <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500 mt-0.5">
                            ID: {student.id}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-teal-950/60 text-indigo-800 dark:text-teal-200 border border-indigo-200 dark:border-teal-800 font-mono text-[11px] font-bold">
                            {student.student_code}
                          </span>
                          <div className="text-[11px] text-[#7B8794] dark:text-slate-400 mt-1">
                            {student.class_name || student.grade_level}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {student.user_id ? (
                            <div>
                              <div className="font-semibold text-[#174E50] dark:text-teal-300">
                                {linkedProfile?.full_name || t('linkedStudentAccountFallback')}
                              </div>
                              {linkedProfile?.email && (
                                <div className="text-[11px] text-[#7B8794] dark:text-slate-400">
                                  {linkedProfile.email}
                                </div>
                              )}
                              <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                                UUID: {student.user_id}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[#7B8794] dark:text-slate-500 italic">
                              {t('noLinkedAccount')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-end">
                          {student.user_id ? (
                            <button
                              type="button"
                              disabled={studentsLocked}
                              onClick={() => {
                                setActionError(null);
                                setPendingUnlink({
                                  type: 'student',
                                  recordId: student.id,
                                  recordName: student.full_name,
                                  recordMeta: student.student_code,
                                  expectedUserId: student.user_id!,
                                  linkedAccountName: linkedProfile?.full_name || t('linkedStudentAccountFallback'),
                                  linkedAccountEmail: linkedProfile?.email || student.user_id!,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-rose-200 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Unlink className="w-3 h-3" />
                              <span>{t('unlinkAccountBtn')}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={studentsLocked}
                              onClick={() => {
                                setActionError(null);
                                setSelectedAccountId('');
                                setModalAccountSearch('');
                                setPendingLink({
                                  type: 'student',
                                  recordId: student.id,
                                  recordName: student.full_name,
                                  recordMeta: student.student_code,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#174E50] dark:bg-[#147477] text-white hover:bg-[#174E50]/90 dark:hover:bg-[#106063] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>{t('linkAccountBtn')}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PATHWAY 3: PARENTS & CHILDREN */}
      {pathway === 'parents' && (
        <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-6">
          <div>
            <h4 className="text-base font-bold text-[#17213B] dark:text-white">
              {t('parentLinkingHeading')}
            </h4>
            <p className="text-xs text-[#7B8794] dark:text-slate-400">
              {t('parentLinkingDescPre')}
              <code className="font-mono bg-[#F8F7F2] dark:bg-slate-800 px-1 rounded">parent</code>
              {t('parentLinkingDescPost')}
            </p>
          </div>

          {(parentProfilesError || parentLinksError || studentsError) && (
            <div
              role="alert"
              className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 text-rose-900 dark:text-rose-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{t('parentDataFailedTitle')}</p>
                  {parentProfilesError && <p>{t('parentAccountsPrefix')} {parentProfilesError}</p>}
                  {parentLinksError && <p>{t('parentLinksPrefix')} {parentLinksError}</p>}
                  {studentsError && <p>{t('studentsDirPrefix')} {studentsError}</p>}
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">
                    {t('parentLinkingDisabledNote')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleManualReload}
                disabled={loading}
                className="px-4 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition shrink-0 cursor-pointer"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#7B8794] dark:text-slate-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
              <span>{t('loadingParentsStudentsLinks')}</span>
            </div>
          ) : parentProfilesError ? (
            <div className="py-10 text-center text-xs text-rose-700 dark:text-rose-300 border border-dashed border-rose-200 dark:border-rose-700/50 rounded-2xl">
              {t('parentAccountsUnavailable')}
            </div>
          ) : parentProfiles.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
              {t('noParentAccountsFound')}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Parent Selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800">
                <div>
                  <label
                    className="block text-xs font-bold text-[#17213B] dark:text-slate-200 mb-1.5"
                    htmlFor="parentSearchInput"
                  >
                    {t('filterParentAccountsLabel')}
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#7B8794] dark:text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="parentSearchInput"
                      type="text"
                      placeholder={t('filterParentAccountsPlaceholder')}
                      value={parentSearch}
                      onChange={(e) => handleParentSearchChange(e.target.value)}
                      className="w-full ps-9 pe-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#131E2B] text-[#17213B] dark:text-white text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                    />
                  </div>
                </div>

                <div>
                  <label
                    className="block text-xs font-bold text-[#17213B] dark:text-slate-200 mb-1.5"
                    htmlFor="selectParentAccount"
                  >
                    {t('selectParentAccountLabel')}
                  </label>
                  <select
                    id="selectParentAccount"
                    value={visibleParentId}
                    onChange={(e) => {
                      setSelectedParentId(e.target.value);
                      setSelectedStudentForParentId('');
                      setActionError(null);
                    }}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#131E2B] text-xs font-medium text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  >
                    <option value="">{t('selectParentOption')}</option>
                    {filteredParentProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} — {p.email} ({p.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedParentProfile && (
                <div className="space-y-5">
                  {/* Selected Parent Summary */}
                  <div className="p-4 rounded-2xl bg-[#D8E8DC]/30 dark:bg-teal-950/40 border border-[#A8BDA6]/40 dark:border-teal-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-bold text-[#17213B] dark:text-white">
                        {selectedParentProfile.full_name}
                      </div>
                      <div className="text-[#7B8794] dark:text-slate-300">
                        {selectedParentProfile.email}
                      </div>
                      <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-400">
                        UUID: {selectedParentProfile.id}
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#174E50] dark:text-teal-300 font-semibold self-start sm:self-center">
                      {parentLinksError
                        ? t('linksUnavailable')
                        : t('linkedStudentsCount', { count: selectedParentLinks.length })}
                    </span>
                  </div>

                  {/* Linked Children Table */}
                  <div>
                    <h5 className="text-xs font-bold text-[#17213B] dark:text-white uppercase tracking-wider mb-3">
                      {t('linkedChildrenHeading')}
                    </h5>
                    {parentLinksError ? (
                      <div className="py-6 text-center text-xs text-rose-700 dark:text-rose-300 border border-dashed border-rose-200 dark:border-rose-700/50 rounded-2xl">
                        {t('parentLinksLoadError')}
                      </div>
                    ) : selectedParentLinks.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
                        {t('noStudentsLinkedParentYet')}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-start text-xs">
                          <thead>
                            <tr className="bg-[#D8E8DC]/30 dark:bg-slate-800/70 text-[#7B8794] dark:text-slate-300 font-semibold uppercase tracking-wider">
                              <th className="py-2 px-4">{t('colStudentName')}</th>
                              <th className="py-2 px-4">{t('colStudentCode')}</th>
                              <th className="py-2 px-4">{t('colClassOrGrade')}</th>
                              <th className="py-2 px-4 text-end">{t('colActionTitle')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                            {selectedParentLinks.map((link) => {
                              const studentObj = students.find((s) => s.id === link.student_id);
                              const childName =
                                studentObj?.full_name || link.student_name || t('studentRecordFallback');
                              const childCode = studentObj?.student_code || link.student_code || '—';

                              return (
                                <tr key={link.id} className="hover:bg-[#F8F7F2] dark:hover:bg-slate-800/40">
                                  <td className="py-2.5 px-4">
                                    <div className="font-bold text-[#17213B] dark:text-white">{childName}</div>
                                    <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                                      ID: {link.student_id}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-4">
                                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-teal-950/60 text-indigo-800 dark:text-teal-200 border border-indigo-200 dark:border-teal-800 font-mono text-[11px] font-bold">
                                      {childCode}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-[#7B8794] dark:text-slate-400">
                                    {studentObj?.class_name || studentObj?.grade_level || '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-end">
                                    <button
                                      type="button"
                                      disabled={parentsLocked}
                                      onClick={() => {
                                        setActionError(null);
                                        setPendingUnlink({
                                          type: 'parent',
                                          parentId: selectedParentProfile.id,
                                          parentName: selectedParentProfile.full_name,
                                          parentEmail: selectedParentProfile.email,
                                          studentId: link.student_id,
                                          studentName: childName,
                                          studentCode: childCode,
                                        });
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-200 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                    >
                                      <Unlink className="w-3 h-3" />
                                      <span>{t('removeLinkBtn')}</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Add Child Link Section */}
                  <form
                    onSubmit={handleLinkParentStudent}
                    className="p-4 rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-[#F8F7F2] dark:bg-[#0D1520] space-y-3"
                  >
                    <h5 className="text-xs font-bold text-[#17213B] dark:text-white">
                      {t('linkAnotherChildHeading')}
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                      <div>
                        <label
                          className="block text-[11px] text-[#7B8794] dark:text-slate-400 font-semibold mb-1"
                          htmlFor="searchChildStudent"
                        >
                          {t('filterChildStudentLabel')}
                        </label>
                        <input
                          id="searchChildStudent"
                          type="text"
                          placeholder={t('filterChildStudentPlaceholder')}
                          value={childStudentSearch}
                          onChange={(e) => handleChildStudentSearchChange(e.target.value)}
                          disabled={parentsLocked}
                          className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#131E2B] text-[#17213B] dark:text-white text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 disabled:bg-slate-100 dark:disabled:bg-slate-900"
                        />
                      </div>

                      <div>
                        <label
                          className="block text-[11px] text-[#7B8794] dark:text-slate-400 font-semibold mb-1"
                          htmlFor="selectChildStudent"
                        >
                          {t('selectChildStudentLabel')}
                        </label>
                        <select
                          id="selectChildStudent"
                          value={visibleStudentForParentId}
                          onChange={(e) => setSelectedStudentForParentId(e.target.value)}
                          disabled={parentsLocked}
                          className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#131E2B] text-xs font-medium text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 disabled:bg-slate-100 dark:disabled:bg-slate-900"
                        >
                          <option value="">{t('selectStudentOption')}</option>
                          {availableStudentsForParent.map((s) => {
                            const existingParentCount = parentLinks.filter(
                              (l) => l.student_id === s.id
                            ).length;
                            return (
                              <option key={s.id} value={s.id}>
                                {s.full_name} — {s.student_code}
                                {existingParentCount > 0
                                  ? t('parentLinkCountSuffix', { count: existingParentCount })
                                  : ''}{' '}
                                — ({s.id})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div>
                        <button
                          type="submit"
                          disabled={parentsLocked || !visibleParentId || !visibleStudentForParentId}
                          className="w-full px-4 py-2 rounded-full bg-[#174E50] dark:bg-[#147477] text-white text-xs font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {mutating ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>{t('linkingBtn')}</span>
                            </>
                          ) : (
                            <>
                              <Link2 className="w-3.5 h-3.5" />
                              <span>{t('linkChildBtn')}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MODAL: EXPLICIT LINK TEACHER / STUDENT ACCOUNT */}
      {pendingLink && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-[#E6E8E2] dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B] dark:text-white">
                {pendingLink.type === 'teacher'
                  ? t('linkTeacherModalTitle')
                  : t('linkStudentModalTitle')}
              </h3>
              <button
                type="button"
                disabled={mutating}
                onClick={() => {
                  setPendingLink(null);
                  setSelectedAccountId('');
                  setModalAccountSearch('');
                  setActionError(null);
                }}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 rounded-full cursor-pointer"
                aria-label="Close link modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4 p-3.5 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 text-xs space-y-1">
              <div className="text-[11px] font-semibold text-[#7B8794] dark:text-slate-400 uppercase">
                {pendingLink.type === 'teacher'
                  ? t('targetTeacherRecord')
                  : t('targetStudentRecord')}
              </div>
              <div className="font-bold text-[#17213B] dark:text-white">{pendingLink.recordName}</div>
              <div className="text-[#7B8794] dark:text-slate-400 font-mono">
                {pendingLink.type === 'student'
                  ? language === 'ar'
                    ? `الكود: ${pendingLink.recordMeta}`
                    : `Code: ${pendingLink.recordMeta}`
                  : pendingLink.recordMeta}
              </div>
              <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                UUID: {pendingLink.recordId}
              </div>
            </div>

            {actionError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmLinkSubmit} className="space-y-4 text-xs">
              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 font-semibold mb-1"
                  htmlFor="modalAccountSearch"
                >
                  {pendingLink.type === 'teacher'
                    ? t('searchAvailableTeacherAccounts')
                    : t('searchAvailableStudentAccounts')}
                </label>
                <input
                  id="modalAccountSearch"
                  type="text"
                  placeholder={t('filterAccountPlaceholder')}
                  value={modalAccountSearch}
                  onChange={(e) => handleModalAccountSearchChange(e.target.value)}
                  disabled={mutating}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
              </div>

              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 font-semibold mb-1"
                  htmlFor="explicitAccountSelect"
                >
                  {t('selectAccountByUuidLabel')} <span className="text-rose-500">*</span>
                </label>
                <select
                  id="explicitAccountSelect"
                  value={visibleSelectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  disabled={mutating}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white font-medium focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                >
                  <option value="">{t('selectUnlinkedAccountOption')}</option>
                  {availableAccountsForModal.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.full_name} — {acc.email} ({acc.id})
                    </option>
                  ))}
                </select>
                {availableAccountsForModal.length === 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">
                    {t('noUnlinkedAccountsMatch', { type: pendingLink.type })}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  disabled={mutating}
                  onClick={() => {
                    setPendingLink(null);
                    setSelectedAccountId('');
                    setModalAccountSearch('');
                    setActionError(null);
                  }}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={
                    !visibleSelectedAccountId ||
                    isPathwayLocked(pendingLink.type === 'teacher' ? 'teachers' : 'students')
                  }
                  className="px-5 py-2 rounded-full bg-[#174E50] dark:bg-[#147477] text-white font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {mutating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('linkingBtn')}</span>
                    </>
                  ) : (
                    <span>{t('confirmLinkBtn')}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXPLICIT TWO-SIDED UNLINK CONFIRMATION */}
      {pendingUnlink && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2] dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B] dark:text-white">
                {t('confirmUnlinkModalTitle')}
              </h3>
              <button
                type="button"
                disabled={mutating}
                onClick={() => {
                  setPendingUnlink(null);
                  setActionError(null);
                }}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 rounded-full cursor-pointer"
                aria-label="Close unlink confirmation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#7B8794] dark:text-slate-400 mb-4">
              {t('confirmUnlinkPrompt')}
            </p>

            <div className="space-y-3 mb-5 text-xs">
              {pendingUnlink.type === 'parent' ? (
                <>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794] dark:text-slate-400">
                      {t('unlinkCardParentAccount')}
                    </div>
                    <div className="font-bold text-[#17213B] dark:text-white mt-0.5">
                      {pendingUnlink.parentName}
                    </div>
                    <div className="text-[#7B8794] dark:text-slate-400">{pendingUnlink.parentEmail}</div>
                    <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                      UUID: {pendingUnlink.parentId}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794] dark:text-slate-400">
                      {t('unlinkCardLinkedChild')}
                    </div>
                    <div className="font-bold text-[#17213B] dark:text-white mt-0.5">
                      {pendingUnlink.studentName}
                    </div>
                    <div className="font-mono text-[#174E50] dark:text-teal-300">
                      {language === 'ar' ? `الكود: ${pendingUnlink.studentCode}` : `Code: ${pendingUnlink.studentCode}`}
                    </div>
                    <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                      UUID: {pendingUnlink.studentId}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794] dark:text-slate-400">
                      {pendingUnlink.type === 'teacher'
                        ? t('unlinkCardTeacherRecord')
                        : t('unlinkCardStudentRecord')}
                    </div>
                    <div className="font-bold text-[#17213B] dark:text-white mt-0.5">
                      {pendingUnlink.recordName}
                    </div>
                    <div className="font-mono text-[#7B8794] dark:text-slate-400">
                      {pendingUnlink.type === 'student'
                        ? language === 'ar'
                          ? `الكود: ${pendingUnlink.recordMeta}`
                          : `Code: ${pendingUnlink.recordMeta}`
                        : pendingUnlink.recordMeta}
                    </div>
                    <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                      UUID: {pendingUnlink.recordId}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794] dark:text-slate-400">
                      {t('unlinkCardLinkedUser')}
                    </div>
                    <div className="font-bold text-[#17213B] dark:text-white mt-0.5">
                      {pendingUnlink.linkedAccountName}
                    </div>
                    <div className="text-[#7B8794] dark:text-slate-400">
                      {pendingUnlink.linkedAccountEmail}
                    </div>
                    <div className="text-[10px] font-mono text-[#7B8794] dark:text-slate-500">
                      UUID: {pendingUnlink.expectedUserId}
                    </div>
                  </div>
                </>
              )}
            </div>

            {actionError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
              <button
                type="button"
                disabled={mutating}
                onClick={() => {
                  setPendingUnlink(null);
                  setActionError(null);
                }}
                className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={isPathwayLocked(
                  pendingUnlink.type === 'teacher'
                    ? 'teachers'
                    : pendingUnlink.type === 'student'
                    ? 'students'
                    : 'parents'
                )}
                onClick={handleConfirmUnlink}
                className="px-5 py-2 rounded-full bg-rose-600 text-white font-semibold hover:bg-rose-700 transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {mutating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('unlinkingBtn')}</span>
                  </>
                ) : (
                  <span>{t('confirmUnlinkBtn')}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountLinkingPanel;
