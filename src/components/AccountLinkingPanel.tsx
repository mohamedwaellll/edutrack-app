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
  const onTeachersSyncedRef = useRef(onTeachersSynced);
  const onStudentsSyncedRef = useRef(onStudentsSynced);
  useEffect(() => {
    onTeachersSyncedRef.current = onTeachersSynced;
  }, [onTeachersSynced]);
  useEffect(() => {
    onStudentsSyncedRef.current = onStudentsSynced;
  }, [onStudentsSynced]);

  const [pathway, setPathway] = useState<LinkingPathway>('teachers');

  // Datasets
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teacherProfiles, setTeacherProfiles] = useState<UserProfile[]>([]);
  const [studentProfiles, setStudentProfiles] = useState<UserProfile[]>([]);
  const [parentProfiles, setParentProfiles] = useState<UserProfile[]>([]);
  const [parentLinks, setParentLinks] = useState<ParentStudentLink[]>([]);

  // Per-resource loading & error states
  const [loading, setLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [teacherProfilesError, setTeacherProfilesError] = useState<string | null>(null);
  const [studentProfilesError, setStudentProfilesError] = useState<string | null>(null);
  const [parentProfilesError, setParentProfilesError] = useState<string | null>(null);
  const [parentLinksError, setParentLinksError] = useState<string | null>(null);

  // Search filters
  const [teacherSearch, setTeacherSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [parentSearch, setParentSearch] = useState('');
  const [childStudentSearch, setChildStudentSearch] = useState('');
  const [modalAccountSearch, setModalAccountSearch] = useState('');

  // Explicit UUID selections
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedStudentForParentId, setSelectedStudentForParentId] = useState('');
  const [pendingLink, setPendingLink] = useState<PendingLinkTarget | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [pendingUnlink, setPendingUnlink] = useState<PendingUnlinkTarget | null>(null);

  // Mutation & pathway-scoped recovery states
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

  const loadAllData = useCallback(async () => {
    setLoading(true);

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
        .catch((err: any) => ({ data: null, error: err?.message || 'Failed to load teachers' })),
      adminService
        .getStudents()
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: any) => ({ data: null, error: err?.message || 'Failed to load students' })),
      accountLinkingService
        .getProfilesByRole('teacher')
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: any) => ({ data: null, error: err?.message || 'Failed to load teacher accounts' })),
      accountLinkingService
        .getProfilesByRole('student')
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: any) => ({ data: null, error: err?.message || 'Failed to load student accounts' })),
      accountLinkingService
        .getProfilesByRole('parent')
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: any) => ({ data: null, error: err?.message || 'Failed to load parent accounts' })),
      accountLinkingService
        .getParentStudentLinks()
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err: any) => ({ data: null, error: err?.message || 'Failed to load parent-student links' })),
    ]);

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

    // Clear post-save warnings and finalize conflict refresh states per pathway independently
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
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Derived eligible options & lookups
  const linkedTeacherUserIds = useMemo(
    () => new Set(teachers.map((t) => t.user_id).filter(Boolean) as string[]),
    [teachers]
  );
  const linkedStudentUserIds = useMemo(
    () => new Set(students.map((s) => s.user_id).filter(Boolean) as string[]),
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

  // Sync visible vs stored parent ID immediately so render & submit never see a hidden parent
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

  // Visible selections enforced synchronously during render
  const visibleSelectedAccountId = availableAccountsForModal.some(
    (acc) => acc.id === selectedAccountId
  )
    ? selectedAccountId
    : '';

  const visibleStudentForParentId =
    visibleParentId && availableStudentsForParent.some((s) => s.id === selectedStudentForParentId)
      ? selectedStudentForParentId
      : '';

  // Clear state selections when filtering or reload removes the chosen option
  useEffect(() => {
    if (selectedAccountId && !availableAccountsForModal.some((acc) => acc.id === selectedAccountId)) {
      setSelectedAccountId('');
    }
  }, [selectedAccountId, availableAccountsForModal]);

  useEffect(() => {
    if (selectedParentId && !filteredParentProfiles.some((p) => p.id === selectedParentId)) {
      setSelectedParentId('');
      setSelectedStudentForParentId('');
    }
  }, [selectedParentId, filteredParentProfiles]);

  useEffect(() => {
    if (
      selectedStudentForParentId &&
      (!visibleParentId || !availableStudentsForParent.some((s) => s.id === selectedStudentForParentId))
    ) {
      setSelectedStudentForParentId('');
    }
  }, [visibleParentId, selectedStudentForParentId, availableStudentsForParent]);

  // Unified pathway-scoped mutation runner
  const runMutation = async (
    targetPathway: LinkingPathway,
    operation: () => Promise<{ data: any; error: string | null; code?: string }>,
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
        setActionError('Verifying session permissions. Please wait before saving changes.');
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

    let result: { data: any; error: string | null; code?: string };
    try {
      result = await operation();
    } catch (err: any) {
      result = {
        data: null,
        error: err?.message || 'Unexpected error during account linking operation',
        code: 'NETWORK_ERROR',
      };
    }

    // Case 1: Conflict or Already Linked -> close stale dialog, refresh, and report completion/failure scoped to targetPathway
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

    // Case 2: Non-conflict error -> keep dialog open for correction
    if (result.error || !result.data) {
      setActionError(result.error || 'Failed to complete operation.');
      setMutating(false);
      isMutatingRef.current = false;
      return;
    }

    // Case 3: Save succeeded -> close modal immediately so save cannot re-run, then refresh
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

  // Manual reload handler (NEVER re-submits save!)
  const handleManualReload = async () => {
    if (loading || mutating) return;
    setActionError(null);
    await loadAllData();
  };

  // Per-pathway readiness & lock checks
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

  // Table search filtering
  const filteredTeachers = teachers.filter((t) => {
    const q = teacherSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      t.full_name.toLowerCase().includes(q) ||
      t.email.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q)
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

  // Search change handlers that eagerly clear hidden selections
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

  // Action submit handlers with strict synchronous visible-option verification
  const handleConfirmLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingLink || !selectedAccountId) return;

    const targetPathway: LinkingPathway = pendingLink.type === 'teacher' ? 'teachers' : 'students';
    if (isPathwayLocked(targetPathway)) return;

    // Verify submitted UUID is still present among visible eligible modal accounts & record is unlinked
    const chosenAccount = availableAccountsForModal.find((p) => p.id === selectedAccountId);
    const targetStillEligible =
      pendingLink.type === 'teacher'
        ? teachers.some((t) => t.id === pendingLink.recordId && !t.user_id)
        : students.some((s) => s.id === pendingLink.recordId && !s.user_id);

    if (!chosenAccount || !targetStillEligible) {
      setSelectedAccountId('');
      return;
    }

    if (pendingLink.type === 'teacher') {
      await runMutation(
        'teachers',
        () => accountLinkingService.linkTeacherAccount(pendingLink.recordId, chosenAccount.id),
        `Linked teacher "${pendingLink.recordName}" to account "${chosenAccount.email}".`,
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
        `Linked student "${pendingLink.recordName}" (${pendingLink.recordMeta}) to account "${chosenAccount.email}".`,
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
        `Unlinked account "${pendingUnlink.linkedAccountEmail || pendingUnlink.expectedUserId}" from teacher "${pendingUnlink.recordName}".`,
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
        `Unlinked account "${pendingUnlink.linkedAccountEmail || pendingUnlink.expectedUserId}" from student "${pendingUnlink.recordName}".`,
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
        `Removed parent-child link between "${pendingUnlink.parentName}" and student "${pendingUnlink.studentName}" (${pendingUnlink.studentCode}).`,
        () => setPendingUnlink(null)
      );
    }
  };

  const handleLinkParentStudent = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (parentsLocked || !selectedParentId || !selectedStudentForParentId) return;

    // Verify BOTH parent and student UUIDs are still visible and eligible before calling RPC
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
      `Linked parent "${parentObj.full_name}" to student "${studentObj.full_name}" (${studentObj.student_code}).`,
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
      <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-[#17213B]">Account Linking</h3>
          <p className="text-xs text-[#7B8794] mt-1">
            Explicitly link existing authentication accounts (by UUID) to teachers, students, and parent-child relationships.
          </p>
        </div>

        <button
          type="button"
          onClick={handleManualReload}
          disabled={loading || mutating}
          className="px-4 py-2 rounded-full border border-[#E6E8E2] bg-white text-xs font-semibold text-[#17213B] hover:bg-[#F8F7F2] transition flex items-center gap-2 self-start md:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Loading...' : 'Refresh Directory'}</span>
        </button>
      </div>

      {/* Pathway Tabs */}
      <div className="bg-white rounded-2xl p-2 border border-[#E6E8E2] shadow-xs flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPathway('teachers');
            setActionError(null);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            pathway === 'teachers'
              ? 'bg-[#174E50] text-white shadow-xs'
              : 'bg-[#F8F7F2] text-[#7B8794] hover:text-[#17213B]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Teachers ({teachers.length})</span>
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
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            pathway === 'students'
              ? 'bg-[#174E50] text-white shadow-xs'
              : 'bg-[#F8F7F2] text-[#7B8794] hover:text-[#17213B]'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>Students ({students.length})</span>
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
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            pathway === 'parents'
              ? 'bg-[#174E50] text-white shadow-xs'
              : 'bg-[#F8F7F2] text-[#7B8794] hover:text-[#17213B]'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>Parents &amp; Children ({parentProfiles.length})</span>
          {pathwayHasAttention('parents') && (
            <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="Parents pathway has error" />
          )}
        </button>
      </div>

      {/* Pathway-Scoped Post-Save Refresh Failure Banner (NEVER re-saves) */}
      {activeSaveWarn && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold">Save succeeded, but list reload failed</p>
              <p>{activeSaveWarn.savedMessage}</p>
              <p className="text-[11px] text-amber-800">
                Refresh error: {activeSaveWarn.refreshError}. Do not re-submit the action — reload the directory below.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManualReload}
            disabled={loading}
            className="px-4 py-2 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Reload List</span>
          </button>
        </div>
      )}

      {/* Pathway-Scoped Conflict Notice Banner */}
      {activeConflict && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Link conflict detected</p>
              <p>{activeConflict.message}</p>
              {activeConflict.refreshing ? (
                <p className="text-[11px] text-amber-800 font-semibold mt-1">
                  Refreshing directory with the latest state...
                </p>
              ) : activeConflict.refreshFailed ? (
                <p className="text-[11px] text-rose-700 font-semibold mt-1">
                  Automatic directory refresh failed. Actions for this section are locked until you reload the latest state.
                </p>
              ) : (
                <p className="text-[11px] text-emerald-800 font-semibold mt-1">
                  Refresh completed — showing the latest saved state. You may now make a new attempt.
                </p>
              )}
            </div>
          </div>
          {activeConflict.refreshFailed ? (
            <button
              type="button"
              onClick={handleManualReload}
              disabled={loading}
              className="px-4 py-2 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 transition shrink-0"
            >
              Reload List
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
              className="text-amber-800 hover:text-amber-950 p-1 self-start"
              aria-label="Dismiss conflict notice"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      )}

      {/* Pathway-Scoped Action Success Banner */}
      {activeSuccess && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
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
            className="text-emerald-700 hover:text-emerald-950 p-1"
            aria-label="Dismiss success notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Inline Action Error (when not inside a modal) */}
      {actionError && !pendingLink && !pendingUnlink && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-900 p-1"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* PATHWAY 1: TEACHERS */}
      {pathway === 'teachers' && (
        <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-[#17213B]">Teacher Account Linking</h4>
              <p className="text-xs text-[#7B8794]">
                Link a teacher record explicitly to an existing account with role <code className="font-mono bg-[#F8F7F2] px-1 rounded">teacher</code>.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-[#7B8794] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search teachers"
                placeholder="Search teachers by name, email, or subject..."
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E8E2] text-xs focus:outline-none focus:border-[#174E50]"
              />
            </div>
          </div>

          {(teachersError || teacherProfilesError) && (
            <div
              role="alert"
              className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Required teacher data failed to load</p>
                  {teachersError && <p>Teachers list: {teachersError}</p>}
                  {teacherProfilesError && <p>Teacher accounts: {teacherProfilesError}</p>}
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    Teacher linking and unlinking actions are disabled until loading succeeds.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleManualReload}
                disabled={loading}
                className="px-4 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#7B8794] flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#174E50]" />
              <span>Loading teachers and teacher accounts...</span>
            </div>
          ) : teachersError ? (
            <div className="py-10 text-center text-xs text-rose-700 border border-dashed border-rose-200 rounded-2xl">
              Teachers directory unavailable. Use Retry above to load teachers.
            </div>
          ) : filteredTeachers.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
              {teachers.length === 0
                ? 'No teacher records found in the directory.'
                : 'No teachers match your search filter.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider">
                    <th className="py-2.5 px-4">Teacher Record</th>
                    <th className="py-2.5 px-4">Linked Auth Account</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8E2]">
                  {filteredTeachers.map((teacher) => {
                    const linkedProfile = teacher.user_id
                      ? teacherProfiles.find((p) => p.id === teacher.user_id) || null
                      : null;

                    return (
                      <tr key={teacher.id} className="hover:bg-[#F8F7F2]">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#17213B]">{teacher.full_name}</div>
                          <div className="text-[11px] text-[#7B8794]">
                            {teacher.email} • {teacher.subject}
                          </div>
                          <div className="text-[10px] font-mono text-[#7B8794] mt-0.5">
                            ID: {teacher.id}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {teacher.user_id ? (
                            <div>
                              <div className="font-semibold text-[#174E50]">
                                {linkedProfile?.full_name || 'Linked User Profile'}
                              </div>
                              {linkedProfile?.email && (
                                <div className="text-[11px] text-[#7B8794]">{linkedProfile.email}</div>
                              )}
                              <div className="text-[10px] font-mono text-[#7B8794]">
                                UUID: {teacher.user_id}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[#7B8794] italic">No linked account</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {teacher.user_id ? (
                            <span className="px-2.5 py-1 rounded-full bg-[#D8E8DC] text-[#174E50] text-[10px] font-semibold">
                              Linked
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">
                              Unlinked
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
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
                                  linkedAccountName: linkedProfile?.full_name || 'Linked Teacher Account',
                                  linkedAccountEmail: linkedProfile?.email || teacher.user_id!,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Unlink className="w-3 h-3" />
                              <span>Unlink Account</span>
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
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#174E50] text-white hover:bg-[#174E50]/90 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>Link Account</span>
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
        <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-[#17213B]">Student Account Linking</h4>
              <p className="text-xs text-[#7B8794]">
                Use each student&apos;s unique <code className="font-mono bg-[#F8F7F2] px-1 rounded">student_code</code> and UUID to distinguish similar names.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-[#7B8794] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search students"
                placeholder="Search students by name, code, or class..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E8E2] text-xs focus:outline-none focus:border-[#174E50]"
              />
            </div>
          </div>

          {(studentsError || studentProfilesError) && (
            <div
              role="alert"
              className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Required student data failed to load</p>
                  {studentsError && <p>Students list: {studentsError}</p>}
                  {studentProfilesError && <p>Student accounts: {studentProfilesError}</p>}
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    Student linking and unlinking actions are disabled until loading succeeds.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleManualReload}
                disabled={loading}
                className="px-4 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#7B8794] flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#174E50]" />
              <span>Loading students and student accounts...</span>
            </div>
          ) : studentsError ? (
            <div className="py-10 text-center text-xs text-rose-700 border border-dashed border-rose-200 rounded-2xl">
              Students directory unavailable. Use Retry above to load students.
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
              {students.length === 0
                ? 'No student records found in the directory.'
                : 'No students match your search filter.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider">
                    <th className="py-2.5 px-4">Student Record</th>
                    <th className="py-2.5 px-4">Code &amp; Class</th>
                    <th className="py-2.5 px-4">Linked Auth Account</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8E2]">
                  {filteredStudents.map((student) => {
                    const linkedProfile = student.user_id
                      ? studentProfiles.find((p) => p.id === student.user_id) || null
                      : null;

                    return (
                      <tr key={student.id} className="hover:bg-[#F8F7F2]">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#17213B]">{student.full_name}</div>
                          <div className="text-[10px] font-mono text-[#7B8794] mt-0.5">
                            ID: {student.id}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 font-mono text-[11px] font-bold">
                            {student.student_code}
                          </span>
                          <div className="text-[11px] text-[#7B8794] mt-1">
                            {student.class_name || student.grade_level}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {student.user_id ? (
                            <div>
                              <div className="font-semibold text-[#174E50]">
                                {linkedProfile?.full_name || 'Linked Student Account'}
                              </div>
                              {linkedProfile?.email && (
                                <div className="text-[11px] text-[#7B8794]">{linkedProfile.email}</div>
                              )}
                              <div className="text-[10px] font-mono text-[#7B8794]">
                                UUID: {student.user_id}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[#7B8794] italic">No linked account</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
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
                                  linkedAccountName: linkedProfile?.full_name || 'Linked Student Account',
                                  linkedAccountEmail: linkedProfile?.email || student.user_id!,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Unlink className="w-3 h-3" />
                              <span>Unlink Account</span>
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
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#174E50] text-white hover:bg-[#174E50]/90 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>Link Account</span>
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
        <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
          <div>
            <h4 className="text-base font-bold text-[#17213B]">Parent-Child Relationship Linking</h4>
            <p className="text-xs text-[#7B8794]">
              Select a <code className="font-mono bg-[#F8F7F2] px-1 rounded">parent</code> account explicitly by UUID to manage linked children. Supports multiple children per parent and multiple parents per student.
            </p>
          </div>

          {(parentProfilesError || parentLinksError || studentsError) && (
            <div
              role="alert"
              className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Required parent linking data failed to load</p>
                  {parentProfilesError && <p>Parent accounts: {parentProfilesError}</p>}
                  {parentLinksError && <p>Parent-student links: {parentLinksError}</p>}
                  {studentsError && <p>Students directory: {studentsError}</p>}
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    Parent-child mutations are disabled until all required directories succeed.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleManualReload}
                disabled={loading}
                className="px-4 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#7B8794] flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#174E50]" />
              <span>Loading parent accounts, students, and links...</span>
            </div>
          ) : parentProfilesError ? (
            <div className="py-10 text-center text-xs text-rose-700 border border-dashed border-rose-200 rounded-2xl">
              Parent accounts directory unavailable. Use Retry above to reload.
            </div>
          ) : parentProfiles.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
              No parent accounts found in user profiles.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Parent Selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2]">
                <div>
                  <label className="block text-xs font-bold text-[#17213B] mb-1.5" htmlFor="parentSearchInput">
                    Filter Parent Accounts
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#7B8794] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="parentSearchInput"
                      type="text"
                      placeholder="Search parent by name or email..."
                      value={parentSearch}
                      onChange={(e) => handleParentSearchChange(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E8E2] bg-white text-xs focus:outline-none focus:border-[#174E50]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#17213B] mb-1.5" htmlFor="selectParentAccount">
                    Select Parent Account (Explicit UUID)
                  </label>
                  <select
                    id="selectParentAccount"
                    value={visibleParentId}
                    onChange={(e) => {
                      setSelectedParentId(e.target.value);
                      setSelectedStudentForParentId('');
                      setActionError(null);
                    }}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E6E8E2] bg-white text-xs font-medium text-[#17213B] focus:outline-none focus:border-[#174E50]"
                  >
                    <option value="">-- Select a parent account --</option>
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
                  <div className="p-4 rounded-2xl bg-[#D8E8DC]/30 border border-[#A8BDA6]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-bold text-[#17213B]">{selectedParentProfile.full_name}</div>
                      <div className="text-[#7B8794]">{selectedParentProfile.email}</div>
                      <div className="text-[10px] font-mono text-[#7B8794]">UUID: {selectedParentProfile.id}</div>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-white border border-[#E6E8E2] text-[#174E50] font-semibold self-start sm:self-center">
                      {parentLinksError ? 'Links unavailable' : `${selectedParentLinks.length} linked student(s)`}
                    </span>
                  </div>

                  {/* Linked Children Table */}
                  <div>
                    <h5 className="text-xs font-bold text-[#17213B] uppercase tracking-wider mb-3">
                      Linked Children
                    </h5>
                    {parentLinksError ? (
                      <div className="py-6 text-center text-xs text-rose-700 border border-dashed border-rose-200 rounded-2xl">
                        Parent-student links could not be loaded. Click Retry above.
                      </div>
                    ) : selectedParentLinks.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
                        No students linked to this parent yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider">
                              <th className="py-2 px-4">Student</th>
                              <th className="py-2 px-4">Student Code</th>
                              <th className="py-2 px-4">Class / Grade</th>
                              <th className="py-2 px-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E6E8E2]">
                            {selectedParentLinks.map((link) => {
                              const studentObj = students.find((s) => s.id === link.student_id);
                              const childName = studentObj?.full_name || link.student_name || 'Student Record';
                              const childCode = studentObj?.student_code || link.student_code || '—';

                              return (
                                <tr key={link.id} className="hover:bg-[#F8F7F2]">
                                  <td className="py-2.5 px-4">
                                    <div className="font-bold text-[#17213B]">{childName}</div>
                                    <div className="text-[10px] font-mono text-[#7B8794]">
                                      ID: {link.student_id}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-4">
                                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 font-mono text-[11px] font-bold">
                                      {childCode}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-[#7B8794]">
                                    {studentObj?.class_name || studentObj?.grade_level || '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right">
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
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <Unlink className="w-3 h-3" />
                                      <span>Remove Link</span>
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
                    className="p-4 rounded-2xl border border-[#E6E8E2] bg-[#F8F7F2] space-y-3"
                  >
                    <h5 className="text-xs font-bold text-[#17213B]">Link Another Child to Selected Parent</h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="block text-[11px] text-[#7B8794] font-semibold mb-1" htmlFor="searchChildStudent">
                          Filter Students by Name or Code
                        </label>
                        <input
                          id="searchChildStudent"
                          type="text"
                          placeholder="e.g. Omar or ET-2048"
                          value={childStudentSearch}
                          onChange={(e) => handleChildStudentSearchChange(e.target.value)}
                          disabled={parentsLocked}
                          className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] bg-white text-xs focus:outline-none focus:border-[#174E50] disabled:bg-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#7B8794] font-semibold mb-1" htmlFor="selectChildStudent">
                          Select Student (Explicit Code &amp; UUID)
                        </label>
                        <select
                          id="selectChildStudent"
                          value={visibleStudentForParentId}
                          onChange={(e) => setSelectedStudentForParentId(e.target.value)}
                          disabled={parentsLocked}
                          className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] bg-white text-xs font-medium text-[#17213B] focus:outline-none focus:border-[#174E50] disabled:bg-slate-100"
                        >
                          <option value="">-- Select a student --</option>
                          {availableStudentsForParent.map((s) => {
                            const existingParentCount = parentLinks.filter((l) => l.student_id === s.id).length;
                            return (
                              <option key={s.id} value={s.id}>
                                {s.full_name} — Code: {s.student_code}
                                {existingParentCount > 0 ? ` (${existingParentCount} parent link)` : ''} — ({s.id})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div>
                        <button
                          type="submit"
                          disabled={parentsLocked || !visibleParentId || !visibleStudentForParentId}
                          className="w-full px-4 py-2 rounded-full bg-[#174E50] text-white text-xs font-semibold hover:bg-[#174E50]/90 transition flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {mutating ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Linking...</span>
                            </>
                          ) : (
                            <>
                              <Link2 className="w-3.5 h-3.5" />
                              <span>Link Child</span>
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-[#E6E8E2]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B]">
                {pendingLink.type === 'teacher' ? 'Link Teacher Account' : 'Link Student Account'}
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
                className="text-[#7B8794] hover:text-[#17213B] p-1 rounded-full"
                aria-label="Close link modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Record Review Box */}
            <div className="mb-4 p-3.5 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2] text-xs space-y-1">
              <div className="text-[11px] font-semibold text-[#7B8794] uppercase">
                Target {pendingLink.type === 'teacher' ? 'Teacher' : 'Student'} Record
              </div>
              <div className="font-bold text-[#17213B]">{pendingLink.recordName}</div>
              <div className="text-[#7B8794] font-mono">
                {pendingLink.type === 'student' ? `Code: ${pendingLink.recordMeta}` : pendingLink.recordMeta}
              </div>
              <div className="text-[10px] font-mono text-[#7B8794]">UUID: {pendingLink.recordId}</div>
            </div>

            {actionError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmLinkSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] font-semibold mb-1" htmlFor="modalAccountSearch">
                  Search Available {pendingLink.type === 'teacher' ? 'Teacher' : 'Student'} Accounts
                </label>
                <input
                  id="modalAccountSearch"
                  type="text"
                  placeholder="Filter by account name, email, or UUID..."
                  value={modalAccountSearch}
                  onChange={(e) => handleModalAccountSearchChange(e.target.value)}
                  disabled={mutating}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div>
                <label className="block text-[#7B8794] font-semibold mb-1" htmlFor="explicitAccountSelect">
                  Select Account by UUID <span className="text-rose-500">*</span>
                </label>
                <select
                  id="explicitAccountSelect"
                  value={visibleSelectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  disabled={mutating}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E8E2] bg-white font-medium focus:outline-none focus:border-[#174E50]"
                >
                  <option value="">-- Select an unlinked account (no auto-match) --</option>
                  {availableAccountsForModal.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.full_name} — {acc.email} ({acc.id})
                    </option>
                  ))}
                </select>
                {availableAccountsForModal.length === 0 && (
                  <p className="text-[11px] text-amber-700 mt-1.5">
                    No unlinked accounts with role &quot;{pendingLink.type}&quot; match your filter.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2]">
                <button
                  type="button"
                  disabled={mutating}
                  onClick={() => {
                    setPendingLink(null);
                    setSelectedAccountId('');
                    setModalAccountSearch('');
                    setActionError(null);
                  }}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !visibleSelectedAccountId ||
                    isPathwayLocked(pendingLink.type === 'teacher' ? 'teachers' : 'students')
                  }
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {mutating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Linking...</span>
                    </>
                  ) : (
                    <span>Confirm Link</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXPLICIT TWO-SIDED UNLINK CONFIRMATION */}
      {pendingUnlink && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B]">Confirm Account Unlink</h3>
              <button
                type="button"
                disabled={mutating}
                onClick={() => {
                  setPendingUnlink(null);
                  setActionError(null);
                }}
                className="text-[#7B8794] hover:text-[#17213B] p-1 rounded-full"
                aria-label="Close unlink confirmation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#7B8794] mb-4">
              Verify both linked parties before removing this link:
            </p>

            <div className="space-y-3 mb-5 text-xs">
              {pendingUnlink.type === 'parent' ? (
                <>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2]">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794]">Parent Account</div>
                    <div className="font-bold text-[#17213B] mt-0.5">{pendingUnlink.parentName}</div>
                    <div className="text-[#7B8794]">{pendingUnlink.parentEmail}</div>
                    <div className="text-[10px] font-mono text-[#7B8794]">UUID: {pendingUnlink.parentId}</div>
                  </div>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2]">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794]">Linked Child Student</div>
                    <div className="font-bold text-[#17213B] mt-0.5">{pendingUnlink.studentName}</div>
                    <div className="font-mono text-indigo-800">Code: {pendingUnlink.studentCode}</div>
                    <div className="text-[10px] font-mono text-[#7B8794]">UUID: {pendingUnlink.studentId}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2]">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794]">
                      {pendingUnlink.type === 'teacher' ? 'Teacher Record' : 'Student Record'}
                    </div>
                    <div className="font-bold text-[#17213B] mt-0.5">{pendingUnlink.recordName}</div>
                    <div className="font-mono text-[#7B8794]">
                      {pendingUnlink.type === 'student' ? `Code: ${pendingUnlink.recordMeta}` : pendingUnlink.recordMeta}
                    </div>
                    <div className="text-[10px] font-mono text-[#7B8794]">UUID: {pendingUnlink.recordId}</div>
                  </div>
                  <div className="p-3 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2]">
                    <div className="text-[10px] font-bold uppercase text-[#7B8794]">Linked User Account</div>
                    <div className="font-bold text-[#17213B] mt-0.5">{pendingUnlink.linkedAccountName}</div>
                    <div className="text-[#7B8794]">{pendingUnlink.linkedAccountEmail}</div>
                    <div className="text-[10px] font-mono text-[#7B8794]">
                      UUID: {pendingUnlink.expectedUserId}
                    </div>
                  </div>
                </>
              )}
            </div>

            {actionError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2]">
              <button
                type="button"
                disabled={mutating}
                onClick={() => {
                  setPendingUnlink(null);
                  setActionError(null);
                }}
                className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold hover:bg-slate-50 transition"
              >
                Cancel
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
                className="px-5 py-2 rounded-full bg-rose-600 text-white font-semibold hover:bg-rose-700 transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mutating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Unlinking...</span>
                  </>
                ) : (
                  <span>Confirm Unlink</span>
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
