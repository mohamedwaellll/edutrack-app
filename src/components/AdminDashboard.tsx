import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Circle,
  Users,
  GraduationCap,
  BookOpen,
  CheckCircle2,
  Search,
  Plus,
  ChevronRight,
  Database,
  RefreshCw,
  LogOut,
  AlertCircle,
  Loader2,
  CheckCircle,
  X,
  QrCode,
  Edit2,
  Download,
} from 'lucide-react';
import { AttendanceQRScanner } from './AttendanceQRScanner';
import { AccountLinkingPanel } from './AccountLinkingPanel';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { adminService } from '../services/adminService';
import { downloadAttendanceCsv } from '../services/attendanceExport';
import {
  attendanceService,
  AttendanceRosterItem,
  getCairoDateString,
} from '../services/attendanceService';
import {
  AttendanceRecord,
  AttendanceStatus,
  RecentActivity,
  WeeklyAttendancePoint,
  GroupClass,
  Teacher,
  Student,
} from '../types/database';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import {
  translateAttendanceMethod,
  translateAttendanceStatus,
  translateFallbackLabel,
  translateOverviewChange,
  translateRole,
  translateStudentStatus,
} from '../i18n/translations';

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

type AdminTab = 'overview' | 'students' | 'teachers' | 'classes' | 'attendance' | 'linking' | 'settings';
const STUDENTS_PER_PAGE = 25;

interface AdminDashboardProps {
  onSwitchToTeacher?: () => void;
  onOpenStudentCards?: () => void;
  adminName?: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onSwitchToTeacher,
  onOpenStudentCards,
  adminName,
}) => {
  const { user, profile, signOut, isRevalidating } = useAuth();
  const { language, isDark, t } = usePreferences();
  const isSessionRevalidating = Boolean(isRevalidating);
  const displayName = adminName || profile?.full_name || user?.email?.split('@')[0] || t('adminDefaultName');
  const displayInitials = displayName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [attendanceToastStatus, setAttendanceToastStatus] = useState<AttendanceStatus | null>(null);

  const [stats, setStats] = useState({
    totalStudents: { value: '0', change: 'Loading...' },
    teachers: { value: '0', change: 'Loading...' },
    activeClasses: { value: '0', change: 'Loading...' },
    attendanceToday: { value: '0.0%', change: 'Loading...' },
  });
  const [weeklyAttendance, setWeeklyAttendance] = useState<WeeklyAttendancePoint[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [studentAttendance, setStudentAttendance] = useState<AttendanceRecord[]>([]);

  const [classesList, setClassesList] = useState<GroupClass[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [studentPage, setStudentPage] = useState(1);

  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentCode, setNewStudentCode] = useState('');
  const [newStudentGroupId, setNewStudentGroupId] = useState('');
  const [newStudentParentName, setNewStudentParentName] = useState('');
  const [newStudentParentPhone, setNewStudentParentPhone] = useState('');

  const [newClassName, setNewClassName] = useState('');
  const [newClassGrade, setNewClassGrade] = useState('Grade 8');
  const [newClassSubject, setNewClassSubject] = useState('Science');
  const [newClassRoom, setNewClassRoom] = useState('Room 204');
  const [newClassCapacity, setNewClassCapacity] = useState(30);
  const [newClassTeacherId, setNewClassTeacherId] = useState('');

  const [showAddTeacherModal, setShowAddTeacherModal] = useState(false);
  const [teacherSubmitting, setTeacherSubmitting] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherSubject, setNewTeacherSubject] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherPhone, setNewTeacherPhone] = useState('');

  const [editingGroupForTeacher, setEditingGroupForTeacher] = useState<GroupClass | null>(null);
  const [selectedTeacherForGroup, setSelectedTeacherForGroup] = useState('');
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [editingClass, setEditingClass] = useState<GroupClass | null>(null);
  const [editClassName, setEditClassName] = useState('');
  const [editClassGrade, setEditClassGrade] = useState('');
  const [editClassSubject, setEditClassSubject] = useState('');
  const [editClassRoom, setEditClassRoom] = useState('');
  const [editClassCapacity, setEditClassCapacity] = useState('30');
  const [editClassSchedule, setEditClassSchedule] = useState('');
  const [editClassSubmitting, setEditClassSubmitting] = useState(false);
  const [editClassError, setEditClassError] = useState<string | null>(null);

  const isTeacherSubmittingRef = useRef(false);
  const isGroupAssignSubmittingRef = useRef(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    studentId: string;
    studentName: string;
    expectedStatus: Student['status'] | null;
    nextStatus: Student['status'];
  } | null>(null);
  const [statusUpdatingStudentId, setStatusUpdatingStudentId] = useState<string | null>(null);
  const [studentStatusError, setStudentStatusError] = useState<string | null>(null);
  const isStatusUpdatingRef = useRef(false);
  const statusMutationSeqRef = useRef(0);
  const isEditClassSubmittingRef = useRef(false);

  const [teachersLoadError, setTeachersLoadError] = useState<string | null>(null);
  const [classesLoadError, setClassesLoadError] = useState<string | null>(null);
  const [teachersLoading, setTeachersLoading] = useState(false);

  const [selectedAttendanceGroupId, setSelectedAttendanceGroupId] = useState('');
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState(() => getCairoDateString());
  const [rosterList, setRosterList] = useState<AttendanceRosterItem[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [attendanceSubTab, setAttendanceSubTab] = useState<'roster' | 'scanner'>('roster');

  const mountedRef = useRef(true);
  const dataReqIdRef = useRef(0);
  const rosterReqIdRef = useRef(0);

  const loadAttendanceRoster = useCallback(async (groupId: string, date: string) => {
    const reqId = ++rosterReqIdRef.current;
    if (!groupId) {
      setRosterList([]);
      return;
    }
    setRosterLoading(true);
    setRosterError(null);
    try {
      const res = await attendanceService.getGroupRosterAttendance(groupId, date);
      if (!mountedRef.current || reqId !== rosterReqIdRef.current) return;
      if (res.error) {
        setRosterError(res.error);
      } else {
        setRosterList(res.data || []);
      }
    } catch (err: unknown) {
      if (!mountedRef.current || reqId !== rosterReqIdRef.current) return;
      setRosterError(getErrorMessage(err, 'Failed to load attendance roster'));
    } finally {
      if (mountedRef.current && reqId === rosterReqIdRef.current) {
        setRosterLoading(false);
      }
    }
  }, []);

  const handleUpdateStatus = async (studentId: string, status: AttendanceStatus) => {
    if (isSessionRevalidating) {
      setRosterError(t('errRevalidatingAttendance'));
      return;
    }
    if (savingStudentId) return;
    setSavingStudentId(studentId);
    setRosterError(null);

    try {
      const res = await attendanceService.saveStudentAttendance({
        student_id: studentId,
        group_id: selectedAttendanceGroupId,
        date: selectedAttendanceDate,
        status,
      });

      if (res.error) {
        setRosterError(res.error);
      } else {
        setSuccessToast(null);
        setAttendanceToastStatus(status);
        setRosterList((prev) =>
          prev.map((item) =>
            item.student_id === studentId &&
            item.group_id === selectedAttendanceGroupId &&
            item.date === selectedAttendanceDate
              ? {
                  ...item,
                  status,
                  attendance_id: res.data?.id || item.attendance_id,
                  check_in_time: res.data?.check_in_time || null,
                }
              : item
          )
        );
        adminService.getDashboardOverview().then((overviewRes) => {
          if (overviewRes.data) {
            setStats(overviewRes.data.stats);
            setWeeklyAttendance(overviewRes.data.weeklyAttendance);
            setStudentAttendance(overviewRes.data.studentAttendance);
          }
        });
      }
    } catch (err: unknown) {
      setRosterError(getErrorMessage(err, t('errSaveAttendanceFailed')));
    } finally {
      setSavingStudentId(null);
    }
  };

  const reloadTeachers = useCallback(async () => {
    setTeachersLoading(true);
    try {
      const res = await adminService.getTeachers();
      if (res.error) {
        setTeachersLoadError(res.error);
        return false;
      }
      if (res.data) {
        setTeachersList(res.data);
        setTeachersLoadError(null);
        return true;
      }
      setTeachersLoadError('Failed to load teachers directory');
      return false;
    } catch (err: unknown) {
      setTeachersLoadError(getErrorMessage(err, 'Failed to load teachers directory'));
      return false;
    } finally {
      setTeachersLoading(false);
    }
  }, []);

  const fetchDashboardSettled = useCallback(async () => {
    const [overviewSettled, classesSettled, teachersSettled, studentsSettled] = await Promise.all([
      adminService
        .getDashboardOverview()
        .then((res) => ({ ok: !res.error && !!res.data, data: res.data, error: res.error }))
        .catch((err: unknown) => ({
          ok: false,
          data: null,
          error: getErrorMessage(err, 'Failed to load dashboard overview'),
        })),

      adminService
        .getClasses()
        .then((res) => ({ ok: !res.error && !!res.data, data: res.data, error: res.error }))
        .catch((err: unknown) => ({
          ok: false,
          data: null,
          error: getErrorMessage(err, 'Failed to load classes and groups'),
        })),

      adminService
        .getTeachers()
        .then((res) => ({ ok: !res.error && !!res.data, data: res.data, error: res.error }))
        .catch((err: unknown) => ({
          ok: false,
          data: null,
          error: getErrorMessage(err, 'Failed to load teachers directory'),
        })),

      adminService
        .getStudents()
        .then((res) => ({ ok: !res.error && !!res.data, data: res.data, error: res.error }))
        .catch((err: unknown) => ({
          ok: false,
          data: null,
          error: getErrorMessage(err, 'Failed to load students directory'),
        })),
    ]);

    return { overviewSettled, classesSettled, teachersSettled, studentsSettled };
  }, []);

  const applyDashboardSettled = useCallback(
    ({
      overviewSettled,
      classesSettled,
      teachersSettled,
      studentsSettled,
    }: Awaited<ReturnType<typeof fetchDashboardSettled>>) => {
      const errors: string[] = [];

      if (overviewSettled.ok && overviewSettled.data) {
        setStats(overviewSettled.data.stats);
        setWeeklyAttendance(overviewSettled.data.weeklyAttendance);
        setRecentActivities(overviewSettled.data.recentActivities);
        setStudentAttendance(overviewSettled.data.studentAttendance);
      } else if (overviewSettled.error) {
        errors.push(`Overview: ${overviewSettled.error}`);
      }

      if (classesSettled.ok && classesSettled.data) {
        setClassesLoadError(null);
        setClassesList(classesSettled.data);
        if (classesSettled.data.length > 0) {
          const firstClassId = classesSettled.data[0].id;
          setNewStudentGroupId((prev) => prev || firstClassId);
          setSelectedAttendanceGroupId((prev) => prev || firstClassId);
        }
      } else {
        const clsErr = classesSettled.error || 'Failed to load classes';
        setClassesLoadError(clsErr);
        errors.push(`Classes: ${clsErr}`);
      }

      if (teachersSettled.ok && teachersSettled.data) {
        setTeachersLoadError(null);
        setTeachersList(teachersSettled.data);
      } else {
        const tchErr = teachersSettled.error || 'Failed to load teachers';
        setTeachersLoadError(tchErr);
        errors.push(`Teachers: ${tchErr}`);
      }

      if (studentsSettled.ok && studentsSettled.data) {
        setStudentsList(studentsSettled.data);
      } else if (studentsSettled.error) {
        errors.push(`Students: ${studentsSettled.error}`);
      }

      setLoading(false);

      if (errors.length > 0) {
        setErrorMessage(errors.join(' | '));
        return false;
      } else {
        setErrorMessage(null);
        return true;
      }
    },
    []
  );

  const loadData = useCallback(async () => {
    const reqId = ++dataReqIdRef.current;
    setLoading(true);
    setErrorMessage(null);
    const settled = await fetchDashboardSettled();
    if (!mountedRef.current || reqId !== dataReqIdRef.current) {
      return true;
    }
    return applyDashboardSettled(settled);
  }, [fetchDashboardSettled, applyDashboardSettled]);

  useEffect(() => {
    if (activeTab !== 'attendance' || !selectedAttendanceGroupId || !selectedAttendanceDate) {
      return;
    }

    let cancelled = false;
    const reqId = ++rosterReqIdRef.current;
    const promise = attendanceService.getGroupRosterAttendance(
      selectedAttendanceGroupId,
      selectedAttendanceDate
    );

    Promise.resolve().then(() => {
      if (!cancelled && mountedRef.current && reqId === rosterReqIdRef.current) {
        setRosterLoading(true);
        setRosterError(null);
      }
    });

    promise
      .then((res) => {
        if (cancelled || !mountedRef.current || reqId !== rosterReqIdRef.current) return;
        if (res.error) {
          setRosterError(res.error);
        } else {
          setRosterList(res.data || []);
        }
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current || reqId !== rosterReqIdRef.current) return;
        setRosterError(getErrorMessage(err, 'Failed to load attendance roster'));
      })
      .finally(() => {
        if (!cancelled && mountedRef.current && reqId === rosterReqIdRef.current) {
          setRosterLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedAttendanceGroupId, selectedAttendanceDate]);

  useEffect(() => {
    mountedRef.current = true;
    const dataReq = dataReqIdRef;
    const rosterReq = rosterReqIdRef;
    const statusMutationSeq = statusMutationSeqRef;
    const reqId = ++dataReq.current;

    fetchDashboardSettled().then((settled) => {
      if (!mountedRef.current || reqId !== dataReq.current) return;
      applyDashboardSettled(settled);
    });

    return () => {
      mountedRef.current = false;
      dataReq.current++;
      rosterReq.current++;
      statusMutationSeq.current++;
    };
  }, [fetchDashboardSettled, applyDashboardSettled]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionRevalidating) {
      setModalError(t('errRevalidatingBeforeSave'));
      return;
    }
    setModalError(null);

    const trimmedName = newStudentName.trim();
    if (!trimmedName) {
      setModalError(t('errStudentNameRequired'));
      return;
    }

    if (!newStudentGroupId) {
      setModalError(t('errStudentGroupRequired'));
      return;
    }

    const selectedGroup = classesList.find((c) => c.id === newStudentGroupId);
    const gradeLevel = selectedGroup?.grade_level || 'Grade 8';

    setModalSubmitting(true);
    const result = await adminService.addStudent({
      full_name: trimmedName,
      student_code: newStudentCode.trim() || undefined,
      group_id: newStudentGroupId,
      grade_level: gradeLevel,
      parent_name: newStudentParentName.trim() || null,
      parent_phone: newStudentParentPhone.trim() || null,
      status: 'active',
    });
    setModalSubmitting(false);

    if (result.error) {
      setModalError(result.error);
      return;
    }

    setShowAddStudentModal(false);
    setNewStudentName('');
    setNewStudentCode('');
    setNewStudentParentName('');
    setNewStudentParentPhone('');

    setSuccessToast(
      t('toastStudentEnrolled', {
        name: result.data?.full_name || '',
        group: selectedGroup?.name || 'group',
      })
    );
    setTimeout(() => setSuccessToast(null), 5000);

    await loadData();
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionRevalidating) {
      setModalError(t('errRevalidatingBeforeSave'));
      return;
    }
    setModalError(null);

    const trimmedName = newClassName.trim();
    if (!trimmedName) {
      setModalError(t('errClassNameRequired'));
      return;
    }

    setModalSubmitting(true);
    const result = await adminService.addClass({
      name: trimmedName,
      grade_level: newClassGrade,
      subject: newClassSubject,
      room: newClassRoom,
      capacity: Number(newClassCapacity) || 30,
      teacher_id: newClassTeacherId || null,
    });
    setModalSubmitting(false);

    if (result.error) {
      setModalError(result.error);
      return;
    }

    setShowAddClassModal(false);
    setNewClassName('');
    setNewClassTeacherId('');
    setSuccessToast(t('toastClassCreated', { name: result.data?.name || '' }));
    setTimeout(() => setSuccessToast(null), 5000);

    await loadData();
  };

  const openEditClassModal = (cls: GroupClass) => {
    setEditingClass(cls);
    setEditClassName(cls.name || '');
    setEditClassGrade(cls.grade_level || '');
    setEditClassSubject(cls.subject || '');
    setEditClassRoom(cls.room || '');
    setEditClassCapacity(String(cls.capacity ?? 30));
    setEditClassSchedule(cls.schedule || '');
    setEditClassError(null);
    isEditClassSubmittingRef.current = false;
    setEditClassSubmitting(false);
  };

  const handleUpdateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionRevalidating) {
      setEditClassError(t('errRevalidatingBeforeSave'));
      return;
    }
    if (!editingClass) return;
    if (isEditClassSubmittingRef.current) return;

    const trimmedName = editClassName.trim();
    if (!trimmedName) {
      setEditClassError(t('errClassNameRequired'));
      return;
    }

    const trimmedGrade = editClassGrade.trim();
    if (!trimmedGrade) {
      setEditClassError(t('errClassGradeRequired'));
      return;
    }

    const parsedCapacity = Number(editClassCapacity.trim());
    if (!editClassCapacity.trim() || !Number.isInteger(parsedCapacity) || parsedCapacity <= 0) {
      setEditClassError(t('errClassCapacityInvalid'));
      return;
    }

    isEditClassSubmittingRef.current = true;
    setEditClassSubmitting(true);
    setEditClassError(null);

    let result;
    try {
      result = await adminService.updateClass({
        id: editingClass.id,
        name: trimmedName,
        grade_level: trimmedGrade,
        subject: editClassSubject,
        room: editClassRoom,
        capacity: parsedCapacity,
        schedule: editClassSchedule,
      });
    } catch (err: unknown) {
      result = { data: null, error: getErrorMessage(err, 'Failed to update class group') };
    }

    if (result.error || !result.data) {
      setEditClassError(result.error || 'Failed to update class group');
      setEditClassSubmitting(false);
      isEditClassSubmittingRef.current = false;
      return;
    }

    const confirmedGroup = result.data;
    setClassesList((prev) => prev.map((c) => (c.id === confirmedGroup.id ? confirmedGroup : c)));
    setEditingClass(null);
    setEditClassSubmitting(false);
    isEditClassSubmittingRef.current = false;

    setSuccessToast(t('toastClassUpdated', { name: confirmedGroup.name }));
    setTimeout(() => setSuccessToast(null), 5000);

    await loadData();
  };

  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionRevalidating) {
      setTeacherError(t('errRevalidatingBeforeSave'));
      return;
    }
    if (isTeacherSubmittingRef.current) return;
    isTeacherSubmittingRef.current = true;
    setTeacherError(null);

    const trimmedName = newTeacherName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setTeacherError(t('errTeacherNameMin'));
      isTeacherSubmittingRef.current = false;
      return;
    }

    const trimmedSubject = newTeacherSubject.trim();
    if (!trimmedSubject) {
      setTeacherError(t('errTeacherSubjectRequired'));
      isTeacherSubmittingRef.current = false;
      return;
    }

    const trimmedEmail = newTeacherEmail.trim().toLowerCase();
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setTeacherError(t('errTeacherEmailInvalid'));
      isTeacherSubmittingRef.current = false;
      return;
    }

    setTeacherSubmitting(true);
    let result;
    try {
      result = await adminService.createTeacher({
        full_name: trimmedName,
        subject: trimmedSubject,
        email: trimmedEmail,
        phone: newTeacherPhone.trim() || undefined,
      });
    } catch (err: unknown) {
      result = { data: null, error: getErrorMessage(err, 'Failed to create teacher') };
    }

    if (result.error || !result.data) {
      setTeacherError(result.error || t('errSaveTeacherFailed'));
      setTeacherSubmitting(false);
      isTeacherSubmittingRef.current = false;
      return;
    }

    setShowAddTeacherModal(false);
    const createdName = result.data.full_name;
    setNewTeacherName('');
    setNewTeacherSubject('');
    setNewTeacherEmail('');
    setNewTeacherPhone('');
    setTeacherSubmitting(false);
    isTeacherSubmittingRef.current = false;

    try {
      const refreshed = await loadData();
      if (refreshed === false) {
        setSuccessToast(t('toastTeacherSavedRefreshFailed', { name: createdName }));
      } else {
        setSuccessToast(t('toastTeacherAdded', { name: createdName }));
      }
      setTimeout(() => setSuccessToast(null), 5000);
    } catch {
      setSuccessToast(t('toastTeacherSavedRefreshFailed', { name: createdName }));
      setTimeout(() => setSuccessToast(null), 5000);
    }
  };

  const handleUpdateGroupTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionRevalidating) {
      setAssignError(t('errRevalidatingBeforeSave'));
      return;
    }
    if (!editingGroupForTeacher) return;
    if (isGroupAssignSubmittingRef.current) return;
    isGroupAssignSubmittingRef.current = true;
    setAssignError(null);

    setAssignSubmitting(true);
    let result;
    try {
      result = await adminService.updateGroupTeacher(
        editingGroupForTeacher.id,
        selectedTeacherForGroup || null
      );
    } catch (err: unknown) {
      result = { data: null, error: getErrorMessage(err, 'Failed to update group teacher') };
    }

    if (result.error || !result.data) {
      setAssignError(result.error || t('errUpdateGroupInstructor'));
      setAssignSubmitting(false);
      isGroupAssignSubmittingRef.current = false;
      return;
    }

    const assignedName = result.data.teacher_name || translateFallbackLabel(language, 'Unassigned');
    const groupName = editingGroupForTeacher.name;
    setEditingGroupForTeacher(null);
    setAssignSubmitting(false);
    isGroupAssignSubmittingRef.current = false;

    try {
      const refreshed = await loadData();
      if (refreshed === false) {
        setSuccessToast(t('toastGroupUpdatedRefreshFailed', { group: groupName }));
      } else {
        setSuccessToast(t('toastGroupInstructorSet', { group: groupName, teacher: assignedName }));
      }
      setTimeout(() => setSuccessToast(null), 5000);
    } catch {
      setSuccessToast(t('toastGroupUpdatedRefreshFailed', { group: groupName }));
      setTimeout(() => setSuccessToast(null), 5000);
    }
  };

  const handleRequestStatusChange = (student: Student, nextStatus: Student['status']) => {
    if (isSessionRevalidating || isStatusUpdatingRef.current || nextStatus === student.status) {
      return;
    }
    setStudentStatusError(null);
    setPendingStatusChange({
      studentId: student.id,
      studentName: student.full_name,
      expectedStatus: student.status ?? null,
      nextStatus,
    });
  };

  const handleConfirmStatusChange = async () => {
    if (!pendingStatusChange || isSessionRevalidating || isStatusUpdatingRef.current) {
      return;
    }
    isStatusUpdatingRef.current = true;
    const reqSeq = ++statusMutationSeqRef.current;
    const target = pendingStatusChange;
    setStatusUpdatingStudentId(target.studentId);
    setStudentStatusError(null);

    try {
      const res = await adminService.updateStudentStatus(
        target.studentId,
        target.nextStatus,
        target.expectedStatus
      );
      if (!mountedRef.current || reqSeq !== statusMutationSeqRef.current) {
        return;
      }

      if (res.error || !res.data) {
        const isConflict = res.code === '40001' || /conflict/i.test(res.error || '');
        if (isConflict) {
          setPendingStatusChange(null);
          setStudentStatusError(t('errStudentStatusConflict'));
          await loadData();
        } else {
          setStudentStatusError(res.error || t('errStudentStatusUpdateFailed'));
        }
        return;
      }

      const confirmed = res.data;
      setStudentsList((prev) =>
        prev.map((s) => (s.id === confirmed.id ? { ...s, status: confirmed.status } : s))
      );
      setPendingStatusChange(null);
      setSuccessToast(
        t('toastStudentStatusUpdated', {
          name: target.studentName,
          status: translateStudentStatus(language, confirmed.status),
        })
      );
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err: unknown) {
      if (!mountedRef.current || reqSeq !== statusMutationSeqRef.current) {
        return;
      }
      setStudentStatusError(getErrorMessage(err, t('errStudentStatusUpdateFailed')));
    } finally {
      isStatusUpdatingRef.current = false;
      if (mountedRef.current) {
        setStatusUpdatingStudentId(null);
      }
    }
  };

  const navItems: { id: AdminTab; label: string; icon: string }[] = [
    { id: 'overview', label: t('navAdminOverview'), icon: 'sparkle' },
    { id: 'students', label: t('navAdminStudents'), icon: 'circle' },
    { id: 'classes', label: t('navAdminClasses'), icon: 'circle' },
    { id: 'teachers', label: t('navAdminTeachers'), icon: 'circle' },
    { id: 'attendance', label: t('navAdminAttendance'), icon: 'circle' },
    { id: 'linking', label: t('navAdminLinking'), icon: 'circle' },
    { id: 'settings', label: t('navAdminSettings'), icon: 'circle' },
  ];

  const filteredStudents = studentsList.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.student_code.toLowerCase().includes(q) ||
      (s.class_name && s.class_name.toLowerCase().includes(q))
    );
  });
  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PER_PAGE));
  const visibleStudentPage = Math.min(studentPage, totalStudentPages);
  const studentPageStart = (visibleStudentPage - 1) * STUDENTS_PER_PAGE;
  const visibleStudents = filteredStudents.slice(studentPageStart, studentPageStart + STUDENTS_PER_PAGE);

  const inputBaseClass =
    'w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400';

  const exportGroup = classesList.find((group) => group.id === selectedAttendanceGroupId);
  const canExportRoster =
    Boolean(exportGroup) &&
    Boolean(selectedAttendanceDate) &&
    !rosterLoading &&
    !rosterError &&
    !savingStudentId &&
    !isSessionRevalidating &&
    rosterList.length > 0 &&
    rosterList.every(
      (item) => item.group_id === selectedAttendanceGroupId && item.date === selectedAttendanceDate
    );

  return (
    <div className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex font-sans selection:bg-[#D8E8DC] dark:selection:bg-teal-900">
      {/* 1. SIDEBAR */}
      <aside className="w-64 border-e border-[#E6E8E2] dark:border-slate-800 bg-[#F8F7F2] dark:bg-[#0E1621] p-6 flex-col justify-between hidden md:flex md:sticky md:top-0 md:h-screen md:overflow-y-auto shrink-0">
        <div>
          <div className="flex items-center gap-2.5 mb-10 text-[#174E50] dark:text-teal-300">
            <BrandMark className="w-6 h-6 shrink-0" />
            <span className="text-xl font-extrabold tracking-tight text-[#17213B] dark:text-white">
              {t('brandName')}
            </span>
          </div>

          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#D8E8DC] dark:bg-teal-950/80 text-[#174E50] dark:text-teal-200 font-semibold shadow-xs'
                      : 'text-[#7B8794] dark:text-slate-400 hover:text-[#26334A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {item.icon === 'sparkle' ? (
                    <Sparkles className={`w-3.5 h-3.5 ${isActive ? 'fill-current' : 'text-current'}`} />
                  ) : (
                    <Circle
                      className={`w-2 h-2 ${
                        isActive ? 'fill-current' : 'text-[#A8BDA6] dark:text-slate-600'
                      }`}
                    />
                  )}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-4">
          {onSwitchToTeacher && (
            <button
              onClick={onSwitchToTeacher}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 text-xs font-semibold text-[#174E50] dark:text-teal-300 hover:bg-[#D8E8DC]/40 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <span>{t('navGradesFeedback')}</span>
              <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </button>
          )}

          {onOpenStudentCards && (
            <button
              onClick={onOpenStudentCards}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 text-xs font-semibold text-indigo-700 dark:text-teal-200 hover:bg-indigo-50/50 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-indigo-600 dark:text-teal-300" />
                <span>{t('navStudentIdCards')}</span>
              </div>
              <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </button>
          )}

          <div className="p-4 rounded-3xl bg-[#D8E8DC]/50 dark:bg-teal-950/40 border border-[#A8BDA6]/30 dark:border-teal-800/40">
            <h4 className="text-sm font-semibold text-[#17213B] dark:text-white">
              {t('adminBrandSubtitle')}
            </h4>
            <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-1">
              {t('adminAuthModeSubtitle')}
            </p>
          </div>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE */}
      <main className="flex-1 p-4 sm:p-6 md:p-10 max-w-7xl mx-auto overflow-y-auto min-w-0">
        {/* Top Header Bar */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 md:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
              {t('adminHeaderTitle')}
            </h1>
            <p className="text-[#7B8794] dark:text-slate-400 text-sm mt-1">
              {t('adminHeaderSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <DisplayControls variant="surface" />

            <div className="px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60">
              <Database className="w-3.5 h-3.5" />
              <span>{t('supabaseLivePill')}</span>
            </div>

            <button
              onClick={loadData}
              disabled={loading}
              title={t('refreshTooltip')}
              className="p-2.5 rounded-full bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 hover:text-[#174E50] dark:hover:text-teal-300 transition shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <div className="flex items-center gap-2.5 ps-2 pe-3 py-1.5 bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 rounded-full shadow-xs">
              <div className="w-8 h-8 rounded-full bg-[#A8BDA6] dark:bg-teal-900 text-[#174E50] dark:text-teal-100 font-bold text-xs flex items-center justify-center">
                {displayInitials}
              </div>
              <div className="text-start text-xs hidden sm:block">
                <p className="font-bold text-[#17213B] dark:text-white max-w-[120px] truncate">
                  {displayName}
                </p>
                <p className="text-[#7B8794] dark:text-slate-400 text-[10px]">
                  {t('adminRoleLabel')}
                </p>
              </div>
              <button
                onClick={() => signOut()}
                title={t('signOut')}
                className="ms-1 p-1.5 rounded-full text-[#7B8794] dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Section Switcher (< md) */}
        <div className="md:hidden mb-5">
          <select
            aria-label={t('adminHeaderTitle')}
            value={activeTab}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__teacher__') {
                onSwitchToTeacher?.();
              } else if (val === '__cards__') {
                onOpenStudentCards?.();
              } else {
                setActiveTab(val as AdminTab);
              }
            }}
            className="w-full px-4 py-2.5 rounded-2xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#131E2B] text-xs font-bold text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
          >
            {navItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            {onSwitchToTeacher && <option value="__teacher__">{t('navGradesFeedback')}</option>}
            {onOpenStudentCards && <option value="__cards__">{t('navStudentIdCards')}</option>}
          </select>
        </div>

        {/* Session Revalidation Notice */}
        {isSessionRevalidating && (
          <div
            data-testid="session-revalidating-banner"
            className="mb-6 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2.5 shadow-xs"
          >
            <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
            <span className="font-semibold">{t('adminRevalidatingNotice')}</span>
          </div>
        )}

        {/* Success Toast */}
        {(attendanceToastStatus || successToast) && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-200 text-xs flex items-center justify-between shadow-xs animate-in fade-in duration-300">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-semibold">
                {attendanceToastStatus
                  ? t('errAttendanceSavedToast', {
                      status: translateAttendanceStatus(language, attendanceToastStatus),
                    })
                  : successToast}
              </span>
            </div>
            <button
              onClick={() => {
                setSuccessToast(null);
                setAttendanceToastStatus(null);
              }}
              className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={loadData}
              className="px-3 py-1 bg-rose-100 dark:bg-rose-900/60 hover:bg-rose-200 dark:hover:bg-rose-800 text-rose-800 dark:text-rose-100 rounded-lg font-semibold transition cursor-pointer"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* 4 Stat Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#D8E8DC] dark:bg-teal-950/70 flex items-center justify-center text-[#174E50] dark:text-teal-300">
                    <Users className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794] dark:text-slate-400">
                    {t('statTotalStudents')}
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
                  {stats.totalStudents.value}
                </div>
                <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-1 font-medium">
                  {translateOverviewChange(language, stats.totalStudents.change)}
                </p>
              </div>

              <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#E6E1F5] dark:bg-violet-950/60 flex items-center justify-center text-[#553B8F] dark:text-violet-300">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794] dark:text-slate-400">
                    {t('statTeachers')}
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
                  {stats.teachers.value}
                </div>
                <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-1 font-medium">
                  {translateOverviewChange(language, stats.teachers.change)}
                </p>
              </div>

              <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#DCF2F7] dark:bg-cyan-950/60 flex items-center justify-center text-[#174E50] dark:text-cyan-300">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794] dark:text-slate-400">
                    {t('statActiveClasses')}
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
                  {stats.activeClasses.value}
                </div>
                <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-1 font-medium">
                  {translateOverviewChange(language, stats.activeClasses.change)}
                </p>
              </div>

              <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#F2EBDD] dark:bg-amber-950/60 flex items-center justify-center text-[#A65E14] dark:text-amber-300">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794] dark:text-slate-400">
                    {t('statAttendanceToday')}
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
                  {stats.attendanceToday.value}
                </div>
                <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-1 font-medium">
                  {translateOverviewChange(language, stats.attendanceToday.change)}
                </p>
              </div>
            </div>

            {/* Chart + Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-[#17213B] dark:text-white">
                    {t('overviewChartTitle')}
                  </h3>
                  <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-0.5">
                    {t('overviewChartSubtitle')}
                  </p>
                </div>

                <div className="h-64 w-full pt-4" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyAttendance} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={isDark ? '#1E293B' : '#E6E8E2'}
                      />
                      <XAxis
                        dataKey="day"
                        tickLine={false}
                        axisLine={{ stroke: isDark ? '#334155' : '#E6E8E2' }}
                        tick={{ fill: isDark ? '#94A3B8' : '#7B8794', fontSize: 11 }}
                      />
                      <YAxis
                        domain={[0, 'auto']}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: isDark ? '#94A3B8' : '#7B8794', fontSize: 11 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                          borderRadius: '12px',
                          border: isDark ? '1px solid #334155' : '1px solid #E6E8E2',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                          fontSize: '12px',
                          color: isDark ? '#F8FAFC' : '#26334A',
                        }}
                        formatter={(val) => [
                          `${val ?? 0} ${t('chartAttendeesSuffix')}`,
                          t('chartPresentPlusLate'),
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        stroke={isDark ? '#2DD4BF' : '#174E50'}
                        strokeWidth={2.5}
                        dot={{
                          fill: isDark ? '#2DD4BF' : '#174E50',
                          r: 4,
                          strokeWidth: 2,
                          stroke: isDark ? '#131E2B' : '#FFFFFF',
                        }}
                        activeDot={{ r: 6, fill: isDark ? '#2DD4BF' : '#174E50' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="lg:col-span-5 bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#17213B] dark:text-white mb-5">
                    {t('recentActivityTitle')}
                  </h3>
                  {recentActivities.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#7B8794] dark:text-slate-400">
                      {t('recentActivityEmpty')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {recentActivities.map((act) => (
                        <div key={act.id} className="flex items-start justify-between gap-3 text-xs">
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-[#174E50] dark:bg-teal-400 mt-1.5 shrink-0" />
                            <div>
                              <p className="font-semibold text-[#17213B] dark:text-white">{act.title}</p>
                              <p className="text-[#7B8794] dark:text-slate-400 text-[11px] mt-0.5">
                                {act.description}
                              </p>
                            </div>
                          </div>
                          <span className="text-[#9AA39C] dark:text-slate-500 text-[11px] shrink-0">
                            {act.timestamp}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-[#E6E8E2] dark:border-slate-800 mt-4 flex items-center justify-between">
                  <span className="text-xs text-[#7B8794] dark:text-slate-400">
                    {t('databaseLiveFeed')}
                  </span>
                  <button
                    onClick={() => setActiveTab('students')}
                    className="text-xs text-[#174E50] dark:text-teal-300 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {t('viewAllStudents')} <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Section: Student Attendance Table */}
            <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-[#17213B] dark:text-white">
                  {t('studentAttendanceTitle')}
                </h3>
                <button
                  onClick={() => setActiveTab('attendance')}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-xs font-semibold text-[#174E50] dark:text-teal-300 hover:bg-[#D8E8DC]/40 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('viewLog')}
                </button>
              </div>

              {studentAttendance.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#7B8794] dark:text-slate-400">
                  {t('noAttendanceToday')}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-xs">
                    <thead>
                      <tr className="bg-[#D8E8DC]/30 dark:bg-slate-800/70 text-[#7B8794] dark:text-slate-300 font-semibold uppercase tracking-wider rounded-xl">
                        <th className="py-3 px-4 rounded-s-xl">{t('colStudent')}</th>
                        <th className="py-3 px-4">{t('colClass')}</th>
                        <th className="py-3 px-4">{t('colStatus')}</th>
                        <th className="py-3 px-4 rounded-e-xl">{t('colCheckIn')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E8E2]/60 dark:divide-slate-800">
                      {studentAttendance.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F8F7F2]/60 dark:hover:bg-slate-800/40 transition">
                          <td className="py-3.5 px-4 font-semibold text-[#17213B] dark:text-white">
                            {item.student_name}
                          </td>
                          <td className="py-3.5 px-4 text-[#7B8794] dark:text-slate-300">
                            {item.class_name}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-block px-3 py-1 rounded-full text-[11px] font-semibold ${
                                item.status === 'Present'
                                  ? 'bg-[#D8E8DC] text-[#174E50] dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : item.status === 'Late'
                                  ? 'bg-[#FCE8D3] text-[#A65E14] dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}
                            >
                              {translateAttendanceStatus(language, item.status)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-[#7B8794] dark:text-slate-400 font-mono text-[11px]">
                            {item.check_in_time}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: STUDENTS */}
        {activeTab === 'students' && (
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B] dark:text-white">
                  {t('enrolledStudentsTitle')}
                </h3>
                <p className="text-xs text-[#7B8794] dark:text-slate-400">
                  {t('enrolledStudentsSubtitle')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setModalError(null);
                    setShowAddStudentModal(true);
                  }}
                  className="px-4 py-2.5 bg-[#174E50] dark:bg-[#147477] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> {t('addStudentBtn')}
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute start-3.5 top-3 text-[#7B8794] dark:text-slate-400" />
              <input
                type="text"
                placeholder={t('searchStudentsPlaceholder')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setStudentPage(1);
                }}
                className="w-full ps-10 pe-4 py-2.5 rounded-full border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
              />
            </div>

            {studentStatusError && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs font-medium text-rose-700 dark:text-rose-300"
              >
                {studentStatusError}
              </div>
            )}

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-xs text-[#7B8794] dark:text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
                <span>{t('loadingStudents')}</span>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="py-12 text-center border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl p-8 space-y-2">
                <Users className="w-8 h-8 text-[#A8BDA6] dark:text-slate-500 mx-auto" />
                <p className="text-sm font-semibold text-[#17213B] dark:text-white">
                  {t('noStudentsFound')}
                </p>
                <p className="text-xs text-[#7B8794] dark:text-slate-400">
                  {studentsList.length === 0 ? t('noStudentsDbEmpty') : t('noStudentsMatchSearch')}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead>
                    <tr className="bg-[#D8E8DC]/30 dark:bg-slate-800/70 text-[#7B8794] dark:text-slate-300 font-semibold uppercase tracking-wider rounded-xl">
                      <th className="py-3 px-4 rounded-s-xl">{t('colName')}</th>
                      <th className="py-3 px-4">{t('colCode')}</th>
                      <th className="py-3 px-4">{t('colClassGroup')}</th>
                      <th className="py-3 px-4">{t('colGrade')}</th>
                      <th className="py-3 px-4">{t('colParentName')}</th>
                      <th className="py-3 px-4">{t('colContact')}</th>
                      <th className="py-3 px-4 rounded-e-xl">{t('colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                    {visibleStudents.map((st) => (
                      <tr key={st.id} className="hover:bg-[#F8F7F2]/60 dark:hover:bg-slate-800/40 transition">
                        <td className="py-3.5 px-4 font-bold text-[#17213B] dark:text-white">
                          {st.full_name}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[#7B8794] dark:text-slate-300">
                          {st.student_code}
                        </td>
                        <td className="py-3.5 px-4 text-[#174E50] dark:text-teal-300 font-semibold">
                          {st.class_name || t('unassigned')}
                        </td>
                        <td className="py-3.5 px-4 text-[#7B8794] dark:text-slate-300">
                          {st.grade_level}
                        </td>
                        <td className="py-3.5 px-4 text-[#7B8794] dark:text-slate-300">
                          {st.parent_name || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-[#7B8794] dark:text-slate-300">
                          {st.parent_phone || '—'}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                                  st.status === 'active'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    : st.status === 'suspended'
                                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                    : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                                }`}
                              >
                                {st.status ? translateStudentStatus(language, st.status) : '—'}
                              </span>
                              <select
                                aria-label={t('studentStatusSelectAria', { name: st.full_name })}
                                value={
                                  pendingStatusChange?.studentId === st.id
                                    ? pendingStatusChange.nextStatus
                                    : st.status ?? ''
                                }
                                disabled={isSessionRevalidating || Boolean(statusUpdatingStudentId)}
                                onChange={(e) => {
                                  const next = e.target.value as Student['status'];
                                  if (next === st.status) {
                                    if (pendingStatusChange?.studentId === st.id) {
                                      setPendingStatusChange(null);
                                    }
                                    return;
                                  }
                                  handleRequestStatusChange(st, next);
                                }}
                                className="rounded-lg border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] px-2 py-1 text-[11px] font-medium text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 disabled:opacity-50"
                              >
                                {!st.status && <option value="" disabled>—</option>}
                                <option value="active">{translateStudentStatus(language, 'active')}</option>
                                <option value="suspended">{translateStudentStatus(language, 'suspended')}</option>
                                <option value="graduated">{translateStudentStatus(language, 'graduated')}</option>
                              </select>
                            </div>
                            {pendingStatusChange?.studentId === st.id && (
                              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-[#F8F7F2] dark:bg-slate-800/70 px-2.5 py-1.5 text-[11px]">
                                <span className="text-[#17213B] dark:text-slate-200 font-medium">
                                  {t('confirmStatusChangePrompt', {
                                    name: st.full_name,
                                    status: translateStudentStatus(language, pendingStatusChange.nextStatus),
                                  })}
                                </span>
                                <button
                                  type="button"
                                  disabled={isSessionRevalidating || statusUpdatingStudentId === st.id}
                                  onClick={handleConfirmStatusChange}
                                  className="px-2.5 py-1 rounded-lg bg-[#174E50] dark:bg-[#147477] text-white font-semibold hover:bg-[#174E50]/90 disabled:opacity-50 cursor-pointer"
                                >
                                  {statusUpdatingStudentId === st.id
                                    ? t('savingStatusBtn')
                                    : t('confirmStatusBtn')}
                                </button>
                                <button
                                  type="button"
                                  disabled={statusUpdatingStudentId === st.id}
                                  onClick={() => setPendingStatusChange(null)}
                                  className="px-2 py-1 rounded-lg border border-[#E6E8E2] dark:border-slate-600 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                                >
                                  {t('cancelStatusBtn')}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && totalStudentPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <span role="status" className="text-[#7B8794] dark:text-slate-300">
                  {t('studentPageSummary', { page: visibleStudentPage, total: totalStudentPages })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={visibleStudentPage <= 1}
                    onClick={() => setStudentPage(visibleStudentPage - 1)}
                    className="rounded-xl border border-[#E6E8E2] px-3 py-2 font-semibold text-[#174E50] disabled:opacity-50 dark:border-slate-700 dark:text-teal-300"
                  >
                    {t('previousStudentPage')}
                  </button>
                  <button
                    type="button"
                    disabled={visibleStudentPage >= totalStudentPages}
                    onClick={() => setStudentPage(visibleStudentPage + 1)}
                    className="rounded-xl border border-[#E6E8E2] px-3 py-2 font-semibold text-[#174E50] disabled:opacity-50 dark:border-slate-700 dark:text-teal-300"
                  >
                    {t('nextStudentPage')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CLASSES & GROUPS */}
        {activeTab === 'classes' && (
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B] dark:text-white">
                  {t('classesTitle')}
                </h3>
                <p className="text-xs text-[#7B8794] dark:text-slate-400">{t('classesSubtitle')}</p>
              </div>
              <button
                onClick={() => {
                  setModalError(null);
                  setShowAddClassModal(true);
                }}
                className="px-4 py-2.5 bg-[#174E50] dark:bg-[#147477] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" /> {t('createClassGroupBtn')}
              </button>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-xs text-[#7B8794] dark:text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
                <span>{t('loadingClasses')}</span>
              </div>
            ) : classesLoadError && classesList.length === 0 ? (
              <div className="py-8 px-6 text-center border-2 border-rose-200 dark:border-rose-700/50 bg-rose-50/50 dark:bg-rose-950/40 rounded-2xl space-y-3">
                <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
                <p className="text-sm font-semibold text-rose-900 dark:text-white">
                  {t('failedLoadClasses')}
                </p>
                <p className="text-xs text-rose-700 dark:text-rose-200">{classesLoadError}</p>
                <button
                  type="button"
                  onClick={loadData}
                  className="px-4 py-2 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition cursor-pointer"
                >
                  {t('retryLoadingClasses')}
                </button>
              </div>
            ) : (
              <>
                {classesLoadError && classesList.length > 0 && (
                  <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-700/50 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-rose-900 dark:text-white">
                          {t('classesRefreshFailed')}
                        </p>
                        <p className="text-xs text-rose-700 dark:text-rose-200">
                          {classesLoadError} {t('staleRecordsSuffix')}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={loadData}
                      className="px-3 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition shrink-0 cursor-pointer"
                    >
                      {t('retryLoadingClasses')}
                    </button>
                  </div>
                )}

                {classesList.length === 0 ? (
                  <div className="py-12 text-center border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl p-8 space-y-2">
                    <BookOpen className="w-8 h-8 text-[#A8BDA6] dark:text-slate-500 mx-auto" />
                    <p className="text-sm font-semibold text-[#17213B] dark:text-white">
                      {t('noClassGroupsFound')}
                    </p>
                    <p className="text-xs text-[#7B8794] dark:text-slate-400">
                      {t('noClassGroupsHint')}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {classesList.map((cls) => {
                      const percentage = cls.capacity > 0 ? Math.round((cls.enrolled_count / cls.capacity) * 100) : 0;
                      return (
                        <div
                          key={cls.id}
                          className="p-5 rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-[#F8F7F2]/40 dark:bg-[#0D1520] hover:border-[#174E50] dark:hover:border-teal-500 transition"
                        >
                          <div className="flex items-center justify-between mb-3 gap-2">
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#D8E8DC] dark:bg-teal-950/70 text-[#174E50] dark:text-teal-200">
                              {cls.name}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[#7B8794] dark:text-slate-400">
                                {translateFallbackLabel(language, cls.room || 'Room 204')}
                              </span>
                              <button
                                type="button"
                                onClick={() => openEditClassModal(cls)}
                                aria-label={`${t('editClassBtn')} ${cls.name}`}
                                className="px-2.5 py-1 rounded-lg border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-[#174E50] dark:text-teal-300 hover:bg-[#D8E8DC]/50 dark:hover:bg-slate-700 transition shrink-0 cursor-pointer flex items-center gap-1"
                              >
                                <Edit2 className="w-3 h-3" />
                                <span>{t('editClassBtn')}</span>
                              </button>
                            </div>
                          </div>
                          <h4 className="text-sm font-bold text-[#17213B] dark:text-white">
                            {translateFallbackLabel(language, cls.subject || 'General')}
                          </h4>
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <p className="text-xs text-[#7B8794] dark:text-slate-400 truncate">
                              {t('instructorPrefix')}{' '}
                              <span className="font-semibold text-[#17213B] dark:text-white">
                                {translateFallbackLabel(language, cls.teacher_name || 'Unassigned')}
                              </span>
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingGroupForTeacher(cls);
                                setSelectedTeacherForGroup(cls.teacher_id || '');
                                setAssignError(null);
                                isGroupAssignSubmittingRef.current = false;
                                setAssignSubmitting(false);
                              }}
                              className="px-2.5 py-1 rounded-lg border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-[#174E50] dark:text-teal-300 hover:bg-[#D8E8DC]/50 dark:hover:bg-slate-700 transition shrink-0 cursor-pointer"
                            >
                              {t('assignOrChangeBtn')}
                            </button>
                          </div>

                          <div className="mt-4 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                            <div className="flex justify-between text-xs text-[#7B8794] dark:text-slate-400 mb-1.5">
                              <span>{t('enrolledStudentsCountLabel')}</span>
                              <span className="font-bold text-[#17213B] dark:text-white">
                                {cls.enrolled_count} / {cls.capacity}
                              </span>
                            </div>
                            <div className="w-full bg-[#E6E8E2] dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-[#174E50] dark:bg-teal-400 h-full rounded-full transition-all"
                                style={{ width: `${Math.min(percentage, 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 4: TEACHERS */}
        {activeTab === 'teachers' && (
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B] dark:text-white">
                  {t('teachersTabTitle')}
                </h3>
                <p className="text-xs text-[#7B8794] dark:text-slate-400">{t('teachersTabSubtitle')}</p>
              </div>
              <button
                onClick={() => {
                  setTeacherError(null);
                  setShowAddTeacherModal(true);
                }}
                className="px-4 py-2.5 bg-[#174E50] dark:bg-[#147477] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs shrink-0 self-start sm:self-auto cursor-pointer"
              >
                <Plus className="w-4 h-4" /> {t('addTeacherBtn')}
              </button>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center text-xs text-[#7B8794] dark:text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
              </div>
            ) : teachersLoadError && teachersList.length === 0 ? (
              <div className="py-8 px-6 text-center border-2 border-rose-200 dark:border-rose-700/50 bg-rose-50/50 dark:bg-rose-950/40 rounded-2xl space-y-3">
                <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
                <p className="text-sm font-semibold text-rose-900 dark:text-white">
                  {t('failedLoadTeachers')}
                </p>
                <p className="text-xs text-rose-700 dark:text-rose-200">{teachersLoadError}</p>
                <button
                  type="button"
                  onClick={reloadTeachers}
                  disabled={teachersLoading}
                  className="px-4 py-2 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition flex items-center gap-1.5 mx-auto cursor-pointer"
                >
                  {teachersLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{t('retryLoadingTeachers')}</span>
                </button>
              </div>
            ) : (
              <>
                {teachersLoadError && teachersList.length > 0 && (
                  <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-700/50 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-rose-900 dark:text-white">
                          {t('facultyRefreshFailed')}
                        </p>
                        <p className="text-xs text-rose-700 dark:text-rose-200">
                          {teachersLoadError} {t('staleRecordsSuffix')}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={reloadTeachers}
                      disabled={teachersLoading}
                      className="px-3 py-1.5 rounded-full bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {teachersLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{t('retryLoadingTeachers')}</span>
                    </button>
                  </div>
                )}

                {teachersList.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
                    {t('noTeachersDb')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {teachersList.map((tch) => (
                      <div
                        key={tch.id}
                        className="p-5 rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#0D1520] flex flex-col justify-between gap-4 hover:border-[#174E50] dark:hover:border-teal-500 transition shadow-xs"
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-full bg-[#E6E1F5] dark:bg-violet-950/60 text-[#553B8F] dark:text-violet-300 font-bold flex items-center justify-center text-sm shrink-0">
                            {tch.avatar_initials || 'TR'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-bold text-[#17213B] dark:text-white truncate">
                              {tch.full_name}
                            </h4>
                            <p className="text-xs text-[#174E50] dark:text-teal-300 font-semibold truncate">
                              {tch.subject}
                            </p>
                            <p className="text-[11px] text-[#7B8794] dark:text-slate-400 mt-0.5 truncate">
                              {tch.email}
                            </p>
                            {tch.phone && (
                              <p className="text-[10px] text-[#7B8794] dark:text-slate-500 font-mono mt-0.5">
                                {tch.phone}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#7B8794] dark:text-slate-400 block mb-1.5">
                            {t('assignedClassesHeading')}
                          </span>
                          {tch.assigned_classes && tch.assigned_classes.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {tch.assigned_classes.map((className, idx) => (
                                <span
                                  key={idx}
                                  className="px-2.5 py-0.5 rounded-full bg-[#D8E8DC] dark:bg-teal-950/70 text-[#174E50] dark:text-teal-200 text-[11px] font-semibold"
                                >
                                  {className}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-[#7B8794] dark:text-slate-500 italic">
                              {t('unassignedNoGroups')}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 5: ATTENDANCE */}
        {activeTab === 'attendance' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-[#131E2B] rounded-2xl p-2.5 border border-[#E6E8E2] dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAttendanceSubTab('roster')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                    attendanceSubTab === 'roster'
                      ? 'bg-[#174E50] dark:bg-[#147477] text-white shadow-xs'
                      : 'bg-[#F8F7F2] dark:bg-[#0D1520] text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  {t('manualRosterTab')}
                </button>
                <button
                  onClick={() => setAttendanceSubTab('scanner')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                    attendanceSubTab === 'scanner'
                      ? 'bg-[#174E50] dark:bg-[#147477] text-white shadow-xs'
                      : 'bg-[#F8F7F2] dark:bg-[#0D1520] text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  {t('qrScannerTab')}
                </button>
              </div>

              {onOpenStudentCards && (
                <button
                  onClick={onOpenStudentCards}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 dark:bg-teal-950/60 border border-indigo-200 dark:border-teal-800 text-indigo-700 dark:text-teal-200 hover:bg-indigo-100 dark:hover:bg-teal-900/60 text-xs font-bold transition cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  {t('printStudentCardsBtn')}
                </button>
              )}
            </div>

            {attendanceSubTab === 'scanner' ? (
              <AttendanceQRScanner
                classesList={classesList}
                selectedGroupId={selectedAttendanceGroupId}
                onSelectGroupId={(id) => setSelectedAttendanceGroupId(id)}
                mutationsDisabled={isSessionRevalidating}
                onAttendanceRecorded={() => {
                  if (selectedAttendanceGroupId && selectedAttendanceDate) {
                    loadAttendanceRoster(selectedAttendanceGroupId, selectedAttendanceDate);
                  }
                  adminService.getDashboardOverview().then((overviewRes) => {
                    if (overviewRes.data) {
                      setStats(overviewRes.data.stats);
                      setWeeklyAttendance(overviewRes.data.weeklyAttendance);
                      setStudentAttendance(overviewRes.data.studentAttendance);
                    }
                  });
                }}
              />
            ) : (
              <>
                <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-[#17213B] dark:text-white">
                        {t('manualAttendanceTitle')}
                      </h3>
                      <p className="text-xs text-[#7B8794] dark:text-slate-400">
                        {t('manualAttendanceSubtitle')}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!canExportRoster}
                        onClick={() => {
                          if (canExportRoster && exportGroup) {
                            downloadAttendanceCsv(
                              rosterList,
                              exportGroup.name,
                              selectedAttendanceDate,
                              language
                            );
                          }
                        }}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-xs font-semibold text-[#17213B] dark:text-slate-200 hover:bg-[#F8F7F2] dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {t('exportAttendanceCsv')}
                      </button>
                      <button
                        onClick={() =>
                          loadAttendanceRoster(selectedAttendanceGroupId, selectedAttendanceDate)
                        }
                        disabled={rosterLoading || !selectedAttendanceGroupId}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-xs font-semibold text-[#17213B] dark:text-slate-200 hover:bg-[#F8F7F2] dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${rosterLoading ? 'animate-spin' : ''}`} />
                        {t('refresh')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                    <div>
                      <label className="block text-xs font-bold text-[#17213B] dark:text-slate-200 mb-1.5">
                        {t('selectClassGroupLabel')}
                      </label>
                      <select
                        value={selectedAttendanceGroupId}
                        onChange={(e) => setSelectedAttendanceGroupId(e.target.value)}
                        className="w-full h-[42px] px-3.5 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-xs font-medium text-[#17213B] dark:text-white bg-white dark:bg-[#0D1520] focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 truncate"
                      >
                        {classesList.length === 0 ? (
                          <option value="">{t('noClassesFoundOption')}</option>
                        ) : (
                          classesList.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.grade_level})
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#17213B] dark:text-slate-200 mb-1.5">
                        {t('dateCairoLabel')}
                      </label>
                      <input
                        type="date"
                        value={selectedAttendanceDate}
                        onChange={(e) => setSelectedAttendanceDate(e.target.value)}
                        className="w-full h-[42px] px-3.5 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-xs font-medium text-[#17213B] dark:text-white bg-white dark:bg-[#0D1520] focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                      />
                    </div>

                    <div className="sm:col-span-2 lg:col-span-1 flex flex-col justify-end">
                      <div className="bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 rounded-xl p-2.5 flex items-center justify-around text-center text-xs">
                        <div>
                          <div className="font-bold text-[#174E50] dark:text-emerald-400">
                            {rosterList.filter((r) => r.status === 'Present').length}
                          </div>
                          <div className="text-[10px] text-[#7B8794] dark:text-slate-400">
                            {t('statusPresent')}
                          </div>
                        </div>
                        <div className="h-6 w-px bg-[#E6E8E2] dark:bg-slate-800" />
                        <div>
                          <div className="font-bold text-[#A65E14] dark:text-amber-400">
                            {rosterList.filter((r) => r.status === 'Late').length}
                          </div>
                          <div className="text-[10px] text-[#7B8794] dark:text-slate-400">
                            {t('statusLate')}
                          </div>
                        </div>
                        <div className="h-6 w-px bg-[#E6E8E2] dark:bg-slate-800" />
                        <div>
                          <div className="font-bold text-rose-600 dark:text-rose-400">
                            {rosterList.filter((r) => r.status === 'Absent').length}
                          </div>
                          <div className="text-[10px] text-[#7B8794] dark:text-slate-400">
                            {t('statusAbsent')}
                          </div>
                        </div>
                        <div className="h-6 w-px bg-[#E6E8E2] dark:bg-slate-800" />
                        <div>
                          <div className="font-bold text-purple-600 dark:text-purple-400">
                            {rosterList.filter((r) => r.status === 'Excused').length}
                          </div>
                          <div className="text-[10px] text-[#7B8794] dark:text-slate-400">
                            {t('statusExcused')}
                          </div>
                        </div>
                        <div className="h-6 w-px bg-[#E6E8E2] dark:bg-slate-800" />
                        <div>
                          <div className="font-bold text-slate-500 dark:text-slate-400">
                            {rosterList.filter((r) => r.status === 'Not marked').length}
                          </div>
                          <div className="text-[10px] text-[#7B8794] dark:text-slate-400">
                            {t('statusUnmarked')}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {rosterError && (
                    <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between">
                      <span>{rosterError}</span>
                      <button
                        onClick={() =>
                          loadAttendanceRoster(selectedAttendanceGroupId, selectedAttendanceDate)
                        }
                        className="underline font-bold ms-2 text-rose-900 dark:text-rose-100 cursor-pointer"
                      >
                        {t('retry')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Roster Table Card */}
                <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-base font-bold text-[#17213B] dark:text-white">
                        {t('studentRosterFor', {
                          name:
                            classesList.find((c) => c.id === selectedAttendanceGroupId)?.name ||
                            t('selectedClassFallback'),
                        })}
                      </h4>
                      <p className="text-xs text-[#7B8794] dark:text-slate-400">
                        {t('rosterInstruction')}
                      </p>
                    </div>
                  </div>

                  {classesList.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
                      {t('noClassesForAttendance')}
                    </div>
                  ) : rosterLoading ? (
                    <div className="py-16 text-center text-xs text-[#7B8794] dark:text-slate-400 flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
                      <span>{t('loadingRoster')}</span>
                    </div>
                  ) : rosterList.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
                      {t('noStudentsInGroup')}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-start text-xs">
                        <thead>
                          <tr className="bg-[#D8E8DC]/30 dark:bg-slate-800/70 text-[#7B8794] dark:text-slate-300 font-semibold uppercase tracking-wider">
                            <th className="py-3 px-4">{t('colStudentUpper')}</th>
                            <th className="py-3 px-4">{t('colCodeUpper')}</th>
                            <th className="py-3 px-4">{t('colCurrentStatus')}</th>
                            <th className="py-3 px-4">{t('colCheckInTime')}</th>
                            <th className="py-3 px-4 text-end">{t('colMarkAttendance')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                          {rosterList.map((item) => {
                            const isSavingThis = savingStudentId === item.student_id;
                            return (
                              <tr
                                key={item.student_id}
                                className="hover:bg-[#F8F7F2] dark:hover:bg-slate-800/40 transition-colors"
                              >
                                <td className="py-3 px-4 font-bold text-[#17213B] dark:text-white whitespace-nowrap">
                                  {item.student_name}
                                </td>
                                <td className="py-3 px-4 font-mono text-[#7B8794] dark:text-slate-300 whitespace-nowrap">
                                  {item.student_code}
                                </td>
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                      item.status === 'Present'
                                        ? 'bg-[#D8E8DC] text-[#174E50] dark:bg-emerald-950/60 dark:text-emerald-300'
                                        : item.status === 'Late'
                                        ? 'bg-[#FCE8D3] text-[#A65E14] dark:bg-amber-950/60 dark:text-amber-300'
                                        : item.status === 'Absent'
                                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                        : item.status === 'Excused'
                                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                                        : 'bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                    }`}
                                  >
                                    {translateAttendanceStatus(language, item.status)}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-mono text-xs text-[#7B8794] dark:text-slate-400 whitespace-nowrap">
                                  {item.check_in_time ? item.check_in_time.slice(0, 5) : '—'}
                                </td>
                                <td className="py-3 px-4 text-end">
                                  <div className="inline-flex items-center gap-1.5 justify-end">
                                    {(['Present', 'Late', 'Absent', 'Excused'] as AttendanceStatus[]).map((st) => {
                                      const isActive = item.status === st;
                                      return (
                                        <button
                                          key={st}
                                          onClick={() => handleUpdateStatus(item.student_id, st)}
                                          disabled={Boolean(savingStudentId) || isSessionRevalidating}
                                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer ${
                                            isActive
                                              ? st === 'Present'
                                                ? 'bg-[#174E50] dark:bg-emerald-600 text-white shadow-xs'
                                                : st === 'Late'
                                                ? 'bg-[#A65E14] dark:bg-amber-600 text-white shadow-xs'
                                                : st === 'Absent'
                                                ? 'bg-rose-600 text-white shadow-xs'
                                                : 'bg-purple-700 text-white shadow-xs'
                                              : 'bg-[#F8F7F2] dark:bg-[#0D1520] text-[#7B8794] dark:text-slate-300 hover:text-[#17213B] dark:hover:text-white hover:bg-[#E6E8E2] dark:hover:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700'
                                          }`}
                                        >
                                          {isSavingThis && isActive ? (
                                            <Loader2 className="w-3 h-3 animate-spin inline" />
                                          ) : (
                                            translateAttendanceStatus(language, st)
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Synchronized Logs Card */}
                <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-base font-bold text-[#17213B] dark:text-white">
                        {t('recentSyncLogsTitle')}
                      </h4>
                      <p className="text-xs text-[#7B8794] dark:text-slate-400">
                        {t('recentSyncLogsSubtitle')}
                      </p>
                    </div>
                  </div>

                  {studentAttendance.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#7B8794] dark:text-slate-400 border-2 border-dashed border-[#E6E8E2] dark:border-slate-800 rounded-2xl">
                      {t('noAttendanceLogsDb')}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-start text-xs">
                        <thead>
                          <tr className="bg-[#D8E8DC]/30 dark:bg-slate-800/70 text-[#7B8794] dark:text-slate-300 font-semibold uppercase tracking-wider">
                            <th className="py-2.5 px-4">{t('colStudentUpper')}</th>
                            <th className="py-2.5 px-4">{t('colClass')}</th>
                            <th className="py-2.5 px-4">{t('colStatus')}</th>
                            <th className="py-2.5 px-4">{t('colDateUpper')}</th>
                            <th className="py-2.5 px-4">{t('colTimeUpper')}</th>
                            <th className="py-2.5 px-4">{t('colMethodUpper')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                          {studentAttendance.map((item) => (
                            <tr key={item.id} className="hover:bg-[#F8F7F2] dark:hover:bg-slate-800/40">
                              <td className="py-2.5 px-4 font-bold text-[#17213B] dark:text-white">
                                {item.student_name}
                              </td>
                              <td className="py-2.5 px-4 text-[#7B8794] dark:text-slate-300">
                                {item.class_name}
                              </td>
                              <td className="py-2.5 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    item.status === 'Present'
                                      ? 'bg-[#D8E8DC] text-[#174E50] dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : item.status === 'Late'
                                      ? 'bg-[#FCE8D3] text-[#A65E14] dark:bg-amber-950/60 dark:text-amber-300'
                                      : item.status === 'Absent'
                                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                      : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                                  }`}
                                >
                                  {translateAttendanceStatus(language, item.status)}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 font-mono text-[11px]">{item.date}</td>
                              <td className="py-2.5 px-4 font-mono text-[11px]">{item.check_in_time}</td>
                              <td className="py-2.5 px-4 font-mono text-[11px] text-[#7B8794] dark:text-slate-400">
                                {translateAttendanceMethod(language, item.method)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 5B: ACCOUNT LINKING */}
        {activeTab === 'linking' && (
          <AccountLinkingPanel
            onTeachersSynced={setTeachersList}
            onStudentsSynced={setStudentsList}
            mutationsDisabled={isSessionRevalidating}
          />
        )}

        {/* TAB 6: SETTINGS & DB INFO */}
        {activeTab === 'settings' && (
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-6">
            <div>
              <h3 className="text-xl font-bold text-[#17213B] dark:text-white">
                {t('settingsTitle')}
              </h3>
              <p className="text-xs text-[#7B8794] dark:text-slate-400">{t('settingsSubtitle')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-5 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 space-y-2">
                <h4 className="font-bold text-[#174E50] dark:text-teal-300">
                  {t('authSessionCardTitle')}
                </h4>
                <p>
                  <strong>{t('settingsEmail')}</strong> {user?.email}
                </p>
                <p>
                  <strong>{t('settingsUserId')}</strong>{' '}
                  <span className="font-mono text-[11px]">{user?.id}</span>
                </p>
                <p>
                  <strong>{t('settingsVerifiedRole')}</strong>{' '}
                  <span className="font-bold text-emerald-700 dark:text-emerald-300">
                    {translateRole(language, profile?.role || 'admin')}
                  </span>
                </p>
                <p>
                  <strong>{t('settingsRlsPolicy')}</strong> {t('settingsRlsDetail')}{' '}
                  <code className="font-mono bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                    public.is_admin()
                  </code>
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 space-y-2">
                <h4 className="font-bold text-[#553B8F] dark:text-violet-300">
                  {t('dbStatusCardTitle')}
                </h4>
                <p>{t('dbStatusGroups', { count: classesList.length })}</p>
                <p>{t('dbStatusStudents', { count: studentsList.length })}</p>
                <p>{t('dbStatusTeachers', { count: teachersList.length })}</p>
                <p>{t('dbStatusAttendance', { count: studentAttendance.length })}</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: ADD STUDENT */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2] dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B] dark:text-white">
                {t('enrollNewStudentTitle')}
              </h3>
              <button
                onClick={() => setShowAddStudentModal(false)}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateStudent} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold" htmlFor="studentName">
                  {t('fullNameRequiredLabel')} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="studentName"
                  type="text"
                  required
                  placeholder={t('studentNamePlaceholder')}
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  disabled={modalSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                  htmlFor="studentGroupSelect"
                >
                  {t('assignedGroupLabel')} <span className="text-rose-500">*</span>
                </label>
                {classesList.length === 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200 dark:border-amber-700/50">
                    {t('noGroupsForStudentWarn')}
                  </p>
                ) : (
                  <select
                    id="studentGroupSelect"
                    value={newStudentGroupId}
                    onChange={(e) => setNewStudentGroupId(e.target.value)}
                    disabled={modalSubmitting}
                    className={inputBaseClass}
                  >
                    {classesList.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name} ({cls.grade_level})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                  htmlFor="studentCodeInput"
                >
                  {t('studentCodeLabel')}{' '}
                  <span className="text-[10px] text-[#7B8794] dark:text-slate-400">
                    {t('studentCodeHint')}
                  </span>
                </label>
                <input
                  id="studentCodeInput"
                  type="text"
                  placeholder={t('studentCodePlaceholder')}
                  value={newStudentCode}
                  onChange={(e) => setNewStudentCode(e.target.value)}
                  disabled={modalSubmitting}
                  className={`${inputBaseClass} font-mono`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="parentNameInput"
                  >
                    {t('parentNameLabel')}
                  </label>
                  <input
                    id="parentNameInput"
                    type="text"
                    placeholder={t('parentNamePlaceholder')}
                    value={newStudentParentName}
                    onChange={(e) => setNewStudentParentName(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="parentPhoneInput"
                  >
                    {t('parentPhoneLabel')}
                  </label>
                  <input
                    id="parentPhoneInput"
                    type="tel"
                    placeholder={t('parentPhonePlaceholder')}
                    value={newStudentParentPhone}
                    onChange={(e) => setNewStudentParentPhone(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  disabled={modalSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting || classesList.length === 0 || isSessionRevalidating}
                  className="px-5 py-2 rounded-full bg-[#174E50] dark:bg-[#147477] text-white font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {modalSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('savingToSupabase')}</span>
                    </>
                  ) : (
                    <span>{t('saveStudentBtn')}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD CLASS */}
      {showAddClassModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2] dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B] dark:text-white">
                {t('createClassModalTitle')}
              </h3>
              <button
                onClick={() => setShowAddClassModal(false)}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateClass} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold" htmlFor="classNameInput">
                  {t('classGroupNameLabel')} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="classNameInput"
                  type="text"
                  required
                  placeholder={t('classGroupNamePlaceholder')}
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  disabled={modalSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="gradeLevelInput"
                  >
                    {t('gradeLevelLabel')}
                  </label>
                  <input
                    id="gradeLevelInput"
                    type="text"
                    required
                    placeholder={t('gradeLevelPlaceholder')}
                    value={newClassGrade}
                    onChange={(e) => setNewClassGrade(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="subjectInput"
                  >
                    {t('subjectLabel')}
                  </label>
                  <input
                    id="subjectInput"
                    type="text"
                    placeholder={t('subjectPlaceholder')}
                    value={newClassSubject}
                    onChange={(e) => setNewClassSubject(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold" htmlFor="roomInput">
                    {t('roomLabel')}
                  </label>
                  <input
                    id="roomInput"
                    type="text"
                    placeholder={t('roomPlaceholder')}
                    value={newClassRoom}
                    onChange={(e) => setNewClassRoom(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="capacityInput"
                  >
                    {t('capacityLabel')}
                  </label>
                  <input
                    id="capacityInput"
                    type="number"
                    min="1"
                    value={newClassCapacity}
                    onChange={(e) => setNewClassCapacity(Number(e.target.value))}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                  />
                </div>
              </div>

              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                  htmlFor="classTeacherSelect"
                >
                  {t('assignInstructorLabel')}{' '}
                  <span className="text-[10px] text-[#7B8794] dark:text-slate-400 font-normal">
                    {t('optionalLabel')}
                  </span>
                </label>
                {teachersLoadError && (
                  <div className="mb-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="text-[11px]">
                        {t('facultyUnavailableGroupWarn', { error: teachersLoadError })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={reloadTeachers}
                      disabled={teachersLoading}
                      className="px-2.5 py-1 rounded-full bg-amber-700 text-white text-[10px] font-semibold hover:bg-amber-800 transition flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      {teachersLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                      <span>{t('retry')}</span>
                    </button>
                  </div>
                )}
                <select
                  id="classTeacherSelect"
                  value={newClassTeacherId}
                  onChange={(e) => setNewClassTeacherId(e.target.value)}
                  disabled={modalSubmitting || (!!teachersLoadError && teachersList.length === 0)}
                  className={`${inputBaseClass} font-medium disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-500`}
                >
                  <option value="">{t('unassigned')}</option>
                  {teachersList.map((tch) => (
                    <option key={tch.id} value={tch.id}>
                      {tch.full_name} ({tch.subject})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddClassModal(false)}
                  disabled={modalSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting || isSessionRevalidating}
                  className="px-5 py-2 rounded-full bg-[#174E50] dark:bg-[#147477] text-white font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {modalSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('savingToSupabase')}</span>
                    </>
                  ) : (
                    <span>{t('saveGroupBtn')}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT CLASS */}
      {editingClass && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2] dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B] dark:text-white">
                {t('editClassModalTitle')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!editClassSubmitting) {
                    setEditingClass(null);
                    setEditClassError(null);
                  }
                }}
                disabled={editClassSubmitting}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editClassError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{editClassError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateClass} className="space-y-4 text-xs" noValidate>
              <div>
                <label className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold" htmlFor="editClassNameInput">
                  {t('classGroupNameLabel')} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="editClassNameInput"
                  type="text"
                  required
                  placeholder={t('classGroupNamePlaceholder')}
                  value={editClassName}
                  onChange={(e) => setEditClassName(e.target.value)}
                  disabled={editClassSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="editGradeLevelInput"
                  >
                    {t('gradeLevelLabel')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="editGradeLevelInput"
                    type="text"
                    required
                    placeholder={t('gradeLevelPlaceholder')}
                    value={editClassGrade}
                    onChange={(e) => setEditClassGrade(e.target.value)}
                    disabled={editClassSubmitting}
                    className={inputBaseClass}
                  />
                </div>
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="editSubjectInput"
                  >
                    {t('subjectLabel')}
                  </label>
                  <input
                    id="editSubjectInput"
                    type="text"
                    placeholder={t('subjectPlaceholder')}
                    value={editClassSubject}
                    onChange={(e) => setEditClassSubject(e.target.value)}
                    disabled={editClassSubmitting}
                    className={inputBaseClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold" htmlFor="editRoomInput">
                    {t('roomLabel')}
                  </label>
                  <input
                    id="editRoomInput"
                    type="text"
                    placeholder={t('roomPlaceholder')}
                    value={editClassRoom}
                    onChange={(e) => setEditClassRoom(e.target.value)}
                    disabled={editClassSubmitting}
                    className={inputBaseClass}
                  />
                </div>
                <div>
                  <label
                    className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                    htmlFor="editCapacityInput"
                  >
                    {t('capacityLabel')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="editCapacityInput"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={editClassCapacity}
                    onChange={(e) => setEditClassCapacity(e.target.value)}
                    disabled={editClassSubmitting}
                    className={inputBaseClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold" htmlFor="editScheduleInput">
                  {t('scheduleLabel')}
                </label>
                <input
                  id="editScheduleInput"
                  type="text"
                  placeholder={t('schedulePlaceholder')}
                  value={editClassSchedule}
                  onChange={(e) => setEditClassSchedule(e.target.value)}
                  disabled={editClassSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditingClass(null);
                    setEditClassError(null);
                  }}
                  disabled={editClassSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={editClassSubmitting || isSessionRevalidating}
                  className="px-5 py-2 rounded-full bg-[#174E50] dark:bg-[#147477] text-white font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {editClassSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('savingToSupabase')}</span>
                    </>
                  ) : (
                    <span>{t('saveClassChangesBtn')}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD TEACHER */}
      {showAddTeacherModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2] dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B] dark:text-white">
                {t('addTeacherModalTitle')}
              </h3>
              <button
                onClick={() => setShowAddTeacherModal(false)}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {teacherError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{teacherError}</span>
              </div>
            )}

            <form onSubmit={handleCreateTeacher} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold" htmlFor="teacherNameInput">
                  {t('fullNameRequiredLabel')} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="teacherNameInput"
                  type="text"
                  required
                  placeholder={t('teacherNamePlaceholder')}
                  value={newTeacherName}
                  onChange={(e) => setNewTeacherName(e.target.value)}
                  disabled={teacherSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                  htmlFor="teacherSubjectInput"
                >
                  {t('subjectSpecLabel')} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="teacherSubjectInput"
                  type="text"
                  required
                  placeholder={t('teacherSubjectPlaceholder')}
                  value={newTeacherSubject}
                  onChange={(e) => setNewTeacherSubject(e.target.value)}
                  disabled={teacherSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                  htmlFor="teacherEmailInput"
                >
                  {t('emailAddressRequiredLabel')} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="teacherEmailInput"
                  type="email"
                  required
                  placeholder={t('teacherEmailPlaceholder')}
                  value={newTeacherEmail}
                  onChange={(e) => setNewTeacherEmail(e.target.value)}
                  disabled={teacherSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                  htmlFor="teacherPhoneInput"
                >
                  {t('phoneNumberLabel')}{' '}
                  <span className="text-[10px] text-[#7B8794] dark:text-slate-400 font-normal">
                    {t('optionalLabel')}
                  </span>
                </label>
                <input
                  id="teacherPhoneInput"
                  type="tel"
                  placeholder={t('teacherPhonePlaceholder')}
                  value={newTeacherPhone}
                  onChange={(e) => setNewTeacherPhone(e.target.value)}
                  disabled={teacherSubmitting}
                  className={inputBaseClass}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddTeacherModal(false)}
                  disabled={teacherSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={teacherSubmitting || isSessionRevalidating}
                  className="px-5 py-2 rounded-full bg-[#174E50] dark:bg-[#147477] text-white font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {teacherSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('savingTeacherBtn')}</span>
                    </>
                  ) : (
                    <span>{t('saveTeacherBtn')}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ASSIGN / CHANGE TEACHER */}
      {editingGroupForTeacher && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2] dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-[#17213B] dark:text-white">
                  {t('assignGroupInstructorTitle')}
                </h3>
                <p className="text-xs text-[#7B8794] dark:text-slate-400">
                  {t('classGroupColon')}{' '}
                  <span className="font-semibold text-[#174E50] dark:text-teal-300">
                    {editingGroupForTeacher.name}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setEditingGroupForTeacher(null)}
                className="text-[#7B8794] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white p-1 rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-3 p-3 rounded-xl bg-slate-50 dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 text-xs flex items-center justify-between">
              <span className="text-[#7B8794] dark:text-slate-400">{t('currentAssignedInstructor')}</span>
              <span className="font-semibold text-[#17213B] dark:text-white">
                {editingGroupForTeacher.teacher_name
                  ? translateFallbackLabel(language, editingGroupForTeacher.teacher_name)
                  : editingGroupForTeacher.teacher_id
                  ? t('assignedInstructorFallback')
                  : t('unassigned')}
              </span>
            </div>

            {teachersLoadError && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 text-xs flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-900 dark:text-amber-100">
                      {t('facultyDirectoryUnavailableTitle')}
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">{teachersLoadError}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-amber-200/60 dark:border-amber-700/40">
                  <span className="text-[11px] text-amber-800 dark:text-amber-300">
                    {t('assignmentLockedHint')}
                  </span>
                  <button
                    type="button"
                    onClick={reloadTeachers}
                    disabled={teachersLoading}
                    className="px-3 py-1 rounded-full bg-amber-700 text-white text-[11px] font-semibold hover:bg-amber-800 transition flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    {teachersLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{t('retryDirectoryBtn')}</span>
                  </button>
                </div>
              </div>
            )}

            {assignError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{assignError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateGroupTeacher} className="space-y-4 text-xs">
              <div>
                <label
                  className="block text-[#7B8794] dark:text-slate-300 mb-1 font-semibold"
                  htmlFor="assignTeacherSelect"
                >
                  {t('assignedTeacherSelectLabel')}
                </label>
                <select
                  id="assignTeacherSelect"
                  value={selectedTeacherForGroup}
                  onChange={(e) => setSelectedTeacherForGroup(e.target.value)}
                  disabled={assignSubmitting || !!teachersLoadError || teachersLoading}
                  className={`${inputBaseClass} font-medium disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-500 disabled:cursor-not-allowed`}
                >
                  {editingGroupForTeacher.teacher_id &&
                    !teachersList.some((tRow) => tRow.id === editingGroupForTeacher.teacher_id) && (
                      <option value={editingGroupForTeacher.teacher_id}>
                        {editingGroupForTeacher.teacher_name || t('assignedInstructorFallback')}{' '}
                        {t('currentOptionSuffix')}
                      </option>
                    )}
                  <option value="">{t('unassignedNoInstructorOption')}</option>
                  {teachersList.map((tch) => (
                    <option key={tch.id} value={tch.id}>
                      {tch.full_name} ({tch.subject})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#7B8794] dark:text-slate-400 mt-1.5">
                  {t('unassignHelpNote')}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingGroupForTeacher(null)}
                  disabled={assignSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] dark:border-slate-700 text-[#7B8794] dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={assignSubmitting || !!teachersLoadError || teachersLoading || isSessionRevalidating}
                  className="px-5 py-2 rounded-full bg-[#174E50] dark:bg-[#147477] text-white font-semibold hover:bg-[#174E50]/90 dark:hover:bg-[#106063] transition flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {assignSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('updatingAssignmentBtn')}</span>
                    </>
                  ) : (
                    <span>{t('saveAssignmentBtn')}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
