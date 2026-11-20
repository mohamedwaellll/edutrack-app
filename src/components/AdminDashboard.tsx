import React, { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles, 
  Circle, 
  Bell, 
  Users, 
  GraduationCap, 
  BookOpen, 
  CheckCircle2, 
  Search, 
  Plus, 
  Download, 
  ChevronRight, 
  Database, 
  RefreshCw, 
  LogOut,
  AlertCircle,
  Loader2,
  CheckCircle,
  Calendar,
  Check,
  X,
  QrCode
} from 'lucide-react';
import { AttendanceQRScanner } from './AttendanceQRScanner';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid 
} from 'recharts';
import { adminService } from '../services/adminService';
import { 
  attendanceService, 
  AttendanceRosterItem, 
  getCairoDateString 
} from '../services/attendanceService';
import { 
  AttendanceRecord, 
  AttendanceStatus,
  RecentActivity, 
  WeeklyAttendancePoint, 
  GroupClass, 
  Teacher, 
  Student 
} from '../types/database';
import { useAuth } from '../contexts/AuthContext';

interface AdminDashboardProps {
  onSwitchToTeacher?: () => void;
  onOpenStudentCards?: () => void;
  adminName?: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  onSwitchToTeacher,
  onOpenStudentCards,
  adminName
}) => {
  const { user, profile, signOut } = useAuth();
  const displayName = adminName || profile?.full_name || user?.email?.split('@')[0] || 'Administrator';
  const displayInitials = displayName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'teachers' | 'classes' | 'attendance' | 'settings'>('overview');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Overview Data
  const [stats, setStats] = useState({
    totalStudents: { value: '0', change: 'Loading...' },
    teachers: { value: '0', change: 'Loading...' },
    activeClasses: { value: '0', change: 'Loading...' },
    attendanceToday: { value: '0.0%', change: 'Loading...' },
  });
  const [weeklyAttendance, setWeeklyAttendance] = useState<WeeklyAttendancePoint[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [studentAttendance, setStudentAttendance] = useState<AttendanceRecord[]>([]);

  // Detailed lists
  const [classesList, setClassesList] = useState<GroupClass[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & form state
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Student form fields
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentCode, setNewStudentCode] = useState('');
  const [newStudentGroupId, setNewStudentGroupId] = useState('');
  const [newStudentParentName, setNewStudentParentName] = useState('');
  const [newStudentParentPhone, setNewStudentParentPhone] = useState('');

  // Class form fields
  const [newClassName, setNewClassName] = useState('');
  const [newClassGrade, setNewClassGrade] = useState('Grade 8');
  const [newClassSubject, setNewClassSubject] = useState('Science');
  const [newClassRoom, setNewClassRoom] = useState('Room 204');
  const [newClassCapacity, setNewClassCapacity] = useState(30);
  const [newClassTeacherId, setNewClassTeacherId] = useState('');

  // Teacher form fields & modal
  const [showAddTeacherModal, setShowAddTeacherModal] = useState(false);
  const [teacherSubmitting, setTeacherSubmitting] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherSubject, setNewTeacherSubject] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherPhone, setNewTeacherPhone] = useState('');

  // Group Teacher Assignment modal & state
  const [editingGroupForTeacher, setEditingGroupForTeacher] = useState<GroupClass | null>(null);
  const [selectedTeacherForGroup, setSelectedTeacherForGroup] = useState('');
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Manual Attendance state (Milestone 2)
  const [selectedAttendanceGroupId, setSelectedAttendanceGroupId] = useState('');
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState(() => getCairoDateString());
  const [rosterList, setRosterList] = useState<AttendanceRosterItem[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [attendanceSubTab, setAttendanceSubTab] = useState<'roster' | 'scanner'>('roster');

  const loadAttendanceRoster = useCallback(async (groupId: string, date: string) => {
    if (!groupId) {
      setRosterList([]);
      return;
    }
    setRosterLoading(true);
    setRosterError(null);
    try {
      const res = await attendanceService.getGroupRosterAttendance(groupId, date);
      if (res.error) {
        setRosterError(res.error);
      } else {
        setRosterList(res.data || []);
      }
    } catch (err: any) {
      setRosterError(err.message || 'Failed to load attendance roster');
    } finally {
      setRosterLoading(false);
    }
  }, []);

  const handleUpdateStatus = async (studentId: string, status: AttendanceStatus) => {
    if (savingStudentId) return; // Prevent repeated submissions while saving
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
        setSuccessToast(`Attendance saved: marked as ${status}`);
        // Refresh local roster immediately
        setRosterList((prev) =>
          prev.map((item) =>
            item.student_id === studentId
              ? {
                  ...item,
                  status,
                  attendance_id: res.data?.id || item.attendance_id,
                  check_in_time: res.data?.check_in_time || null,
                }
              : item
          )
        );
        // Refresh overview stats and synchronized logs in background
        adminService.getDashboardOverview().then((overviewRes) => {
          if (overviewRes.data) {
            setStats(overviewRes.data.stats);
            setWeeklyAttendance(overviewRes.data.weeklyAttendance);
            setStudentAttendance(overviewRes.data.studentAttendance);
          }
        });
      }
    } catch (err: any) {
      setRosterError(err.message || 'Failed to save attendance');
    } finally {
      setSavingStudentId(null);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const [overviewRes, classesRes, teachersRes, studentsRes] = await Promise.all([
        adminService.getDashboardOverview(),
        adminService.getClasses(),
        adminService.getTeachers(),
        adminService.getStudents(),
      ]);

      if (overviewRes.error) {
        setErrorMessage(overviewRes.error);
      } else if (overviewRes.data) {
        setStats(overviewRes.data.stats);
        setWeeklyAttendance(overviewRes.data.weeklyAttendance);
        setRecentActivities(overviewRes.data.recentActivities);
        setStudentAttendance(overviewRes.data.studentAttendance);
      }

      if (classesRes.data) {
        setClassesList(classesRes.data);
        if (classesRes.data.length > 0) {
          const firstClassId = classesRes.data[0].id;
          if (!newStudentGroupId) {
            setNewStudentGroupId(firstClassId);
          }
          setSelectedAttendanceGroupId((prev) => prev || firstClassId);
        }
      }

      if (teachersRes.data) {
        setTeachersList(teachersRes.data);
      }

      if (studentsRes.data) {
        setStudentsList(studentsRes.data);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load database records.');
    } finally {
      setLoading(false);
    }
  }, [newStudentGroupId]);

  useEffect(() => {
    if (activeTab === 'attendance' && selectedAttendanceGroupId && selectedAttendanceDate) {
      loadAttendanceRoster(selectedAttendanceGroupId, selectedAttendanceDate);
    }
  }, [activeTab, selectedAttendanceGroupId, selectedAttendanceDate, loadAttendanceRoster]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle student creation
  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const trimmedName = newStudentName.trim();
    if (!trimmedName) {
      setModalError('Student full name is required.');
      return;
    }

    if (!newStudentGroupId) {
      setModalError('Please select a group for this student. (Create a group first if none exist).');
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

    // Success: confirmed DB write
    setShowAddStudentModal(false);
    setNewStudentName('');
    setNewStudentCode('');
    setNewStudentParentName('');
    setNewStudentParentPhone('');

    setSuccessToast(`Student "${result.data?.full_name}" was successfully enrolled in ${selectedGroup?.name || 'group'}!`);
    setTimeout(() => setSuccessToast(null), 5000);

    // Refresh real records from database
    await loadData();
  };

  // Handle class group creation
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const trimmedName = newClassName.trim();
    if (!trimmedName) {
      setModalError('Class group name is required (e.g. "Grade 8A").');
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
    setSuccessToast(`Academic class group "${result.data?.name}" created successfully!`);
    setTimeout(() => setSuccessToast(null), 5000);

    await loadData();
  };

  // Handle teacher creation
  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeacherError(null);

    const trimmedName = newTeacherName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setTeacherError('Teacher full name is required (minimum 2 characters).');
      return;
    }

    const trimmedSubject = newTeacherSubject.trim();
    if (!trimmedSubject) {
      setTeacherError('Teaching subject is required.');
      return;
    }

    const trimmedEmail = newTeacherEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setTeacherError('A valid email address is required.');
      return;
    }

    setTeacherSubmitting(true);
    const result = await adminService.createTeacher({
      full_name: trimmedName,
      subject: trimmedSubject,
      email: trimmedEmail,
      phone: newTeacherPhone.trim() || undefined,
    });
    setTeacherSubmitting(false);

    if (result.error) {
      // Retain entered form values so admin can correct email or details
      setTeacherError(result.error);
      return;
    }

    // Success
    setShowAddTeacherModal(false);
    setNewTeacherName('');
    setNewTeacherSubject('');
    setNewTeacherEmail('');
    setNewTeacherPhone('');
    setSuccessToast(`Teacher "${result.data?.full_name}" added to staff directory successfully!`);
    setTimeout(() => setSuccessToast(null), 5000);

    await loadData();
  };

  // Handle assigning / updating group teacher
  const handleUpdateGroupTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroupForTeacher) return;
    setAssignError(null);

    setAssignSubmitting(true);
    const result = await adminService.updateGroupTeacher(
      editingGroupForTeacher.id,
      selectedTeacherForGroup || null
    );
    setAssignSubmitting(false);

    if (result.error) {
      setAssignError(result.error);
      return;
    }

    const assignedName = result.data?.teacher_name || 'Unassigned';
    setSuccessToast(`Group "${editingGroupForTeacher.name}" instructor set to ${assignedName}.`);
    setTimeout(() => setSuccessToast(null), 5000);
    setEditingGroupForTeacher(null);

    await loadData();
  };

  const navItems = [
    { id: 'overview', label: 'Overview', icon: 'sparkle' },
    { id: 'students', label: 'Students', icon: 'circle' },
    { id: 'classes', label: 'Classes & Groups', icon: 'circle' },
    { id: 'teachers', label: 'Teachers', icon: 'circle' },
    { id: 'attendance', label: 'Attendance', icon: 'circle' },
    { id: 'settings', label: 'Settings & DB', icon: 'circle' },
  ];

  const filteredStudents = studentsList.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.student_code.toLowerCase().includes(q) ||
      (s.class_name && s.class_name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-[#26334A] flex font-sans selection:bg-[#D8E8DC]">
      {/* 1. LEFT SIDEBAR */}
      <aside className="w-64 border-r border-[#E6E8E2] bg-[#F8F7F2] p-6 flex flex-col justify-between hidden md:flex shrink-0">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-2 mb-10 text-[#174E50]">
            <Sparkles className="w-5 h-5 fill-current text-[#174E50]" />
            <span className="text-xl font-bold tracking-tight text-[#17213B]">EduTrack</span>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-[#D8E8DC] text-[#174E50] font-semibold shadow-xs'
                      : 'text-[#7B8794] hover:text-[#26334A] hover:bg-white/60'
                  }`}
                >
                  {item.icon === 'sparkle' ? (
                    <Sparkles className={`w-3.5 h-3.5 ${isActive ? 'fill-[#174E50]' : 'text-current'}`} />
                  ) : (
                    <Circle className={`w-2 h-2 ${isActive ? 'fill-[#174E50]' : 'text-[#A8BDA6]'}`} />
                  )}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Card & Switcher (Isolated demo link) */}
        <div className="space-y-4">
          {onSwitchToTeacher && (
            <button
              onClick={onSwitchToTeacher}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-white border border-[#E6E8E2] text-xs font-semibold text-[#174E50] hover:bg-[#D8E8DC]/40 transition"
            >
              <span>Grades &amp; Feedback</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {onOpenStudentCards && (
            <button
              onClick={onOpenStudentCards}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-white border border-[#E6E8E2] text-xs font-semibold text-indigo-700 hover:bg-indigo-50/50 transition"
            >
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-indigo-600" />
                <span>Student ID Cards</span>
              </div>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          <div className="p-4 rounded-3xl bg-[#D8E8DC]/50 border border-[#A8BDA6]/30">
            <h4 className="text-sm font-semibold text-[#17213B]">EduTrack Admin</h4>
            <p className="text-xs text-[#7B8794] mt-1">Authenticated Supabase Mode</p>
          </div>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE */}
      <main className="flex-1 p-6 md:p-10 max-w-7xl mx-auto overflow-y-auto">
        {/* Top Header Bar */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-[#17213B] tracking-tight">Admin dashboard</h1>
            <p className="text-[#7B8794] text-sm mt-1">A clear view of your learning community</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Supabase Status Pill */}
            <div className="px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 border bg-emerald-50 text-emerald-700 border-emerald-200">
              <Database className="w-3.5 h-3.5" />
              <span>Supabase Live</span>
            </div>

            <button 
              onClick={loadData}
              disabled={loading}
              title="Refresh Data from Supabase"
              className="p-2.5 rounded-full bg-white border border-[#E6E8E2] text-[#7B8794] hover:text-[#174E50] transition shadow-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Profile & Sign Out */}
            <div className="flex items-center gap-3 pl-2 pr-3 py-1.5 bg-white border border-[#E6E8E2] rounded-full shadow-xs">
              <div className="w-8 h-8 rounded-full bg-[#A8BDA6] text-[#174E50] font-bold text-xs flex items-center justify-center">
                {displayInitials}
              </div>
              <div className="text-left text-xs hidden sm:block">
                <p className="font-bold text-[#17213B] max-w-[120px] truncate">{displayName}</p>
                <p className="text-[#7B8794] text-[10px]">Administrator</p>
              </div>
              <button
                onClick={() => signOut()}
                title="Sign Out"
                className="ml-1 p-1.5 rounded-full text-[#7B8794] hover:text-rose-600 hover:bg-rose-50 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Success Toast */}
        {successToast && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between shadow-xs animate-in fade-in duration-300">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-semibold">{successToast}</span>
            </div>
            <button onClick={() => setSuccessToast(null)} className="text-emerald-700 hover:text-emerald-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={loadData}
              className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg font-semibold transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* 4 Stat Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Card 1: Total Students */}
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#D8E8DC] flex items-center justify-center text-[#174E50]">
                    <Users className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794]">Total students</span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] tracking-tight">{stats.totalStudents.value}</div>
                <p className="text-xs text-[#7B8794] mt-1 font-medium">{stats.totalStudents.change}</p>
              </div>

              {/* Card 2: Teachers */}
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#E6E1F5] flex items-center justify-center text-[#553B8F]">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794]">Teachers</span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] tracking-tight">{stats.teachers.value}</div>
                <p className="text-xs text-[#7B8794] mt-1 font-medium">{stats.teachers.change}</p>
              </div>

              {/* Card 3: Active Classes */}
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#DCF2F7] flex items-center justify-center text-[#174E50]">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794]">Active classes</span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] tracking-tight">{stats.activeClasses.value}</div>
                <p className="text-xs text-[#7B8794] mt-1 font-medium">{stats.activeClasses.change}</p>
              </div>

              {/* Card 4: Attendance Today */}
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-[#F2EBDD] flex items-center justify-center text-[#A65E14]">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#7B8794]">Attendance today</span>
                </div>
                <div className="text-3xl font-extrabold text-[#17213B] tracking-tight">{stats.attendanceToday.value}</div>
                <p className="text-xs text-[#7B8794] mt-1 font-medium">{stats.attendanceToday.change}</p>
              </div>
            </div>

            {/* Middle Section: Chart + Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Attendance Chart */}
              <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-[#17213B]">Attendance overview</h3>
                  <p className="text-xs text-[#7B8794] mt-0.5">Real daily attendee counts (Present + Late) — Africa/Cairo</p>
                </div>
                
                <div className="h-64 w-full pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyAttendance} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E6E8E2" />
                      <XAxis 
                        dataKey="day" 
                        tickLine={false} 
                        axisLine={{ stroke: '#E6E8E2' }} 
                        tick={{ fill: '#7B8794', fontSize: 11 }} 
                      />
                      <YAxis 
                        domain={[0, 'auto']} 
                        allowDecimals={false}
                        tickLine={false} 
                        axisLine={false} 
                        tick={{ fill: '#7B8794', fontSize: 11 }}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#FFFFFF', 
                          borderRadius: '12px', 
                          border: '1px solid #E6E8E2',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                          fontSize: '12px',
                          color: '#26334A'
                        }} 
                        formatter={(val: any) => [`${val} attendees`, 'Present + Late']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="rate" 
                        stroke="#174E50" 
                        strokeWidth={2.5}
                        dot={{ fill: '#174E50', r: 4, strokeWidth: 2, stroke: '#FFFFFF' }}
                        activeDot={{ r: 6, fill: '#174E50' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#17213B] mb-5">Recent activity</h3>
                  {recentActivities.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#7B8794]">
                      No recent activities logged in database.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {recentActivities.map((act) => (
                        <div key={act.id} className="flex items-start justify-between gap-3 text-xs">
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-[#174E50] mt-1.5 shrink-0" />
                            <div>
                              <p className="font-semibold text-[#17213B]">{act.title}</p>
                              <p className="text-[#7B8794] text-[11px] mt-0.5">{act.description}</p>
                            </div>
                          </div>
                          <span className="text-[#9AA39C] text-[11px] shrink-0">{act.timestamp}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-[#E6E8E2] mt-4 flex items-center justify-between">
                  <span className="text-xs text-[#7B8794]">Database Live Feed</span>
                  <button 
                    onClick={() => setActiveTab('students')}
                    className="text-xs text-[#174E50] font-semibold hover:underline flex items-center gap-1"
                  >
                    View all students <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Section: Student Attendance Table */}
            <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-[#17213B]">Student attendance</h3>
                <button 
                  onClick={() => setActiveTab('attendance')}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-xs font-semibold text-[#174E50] hover:bg-[#D8E8DC]/40 transition"
                >
                  View log
                </button>
              </div>

              {studentAttendance.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#7B8794]">
                  No attendance records logged for today yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider rounded-xl">
                        <th className="py-3 px-4 rounded-l-xl">STUDENT</th>
                        <th className="py-3 px-4">CLASS</th>
                        <th className="py-3 px-4">STATUS</th>
                        <th className="py-3 px-4 rounded-r-xl">CHECK-IN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E8E2]/60">
                      {studentAttendance.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F8F7F2]/60 transition">
                          <td className="py-3.5 px-4 font-semibold text-[#17213B]">{item.student_name}</td>
                          <td className="py-3.5 px-4 text-[#7B8794]">{item.class_name}</td>
                          <td className="py-3.5 px-4">
                            <span className={`inline-block px-3 py-1 rounded-full text-[11px] font-semibold ${
                              item.status === 'Present' 
                                ? 'bg-[#D8E8DC] text-[#174E50]' 
                                : item.status === 'Late'
                                ? 'bg-[#FCE8D3] text-[#A65E14]'
                                : 'bg-rose-50 text-rose-700'
                            }`}>
                              {item.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-[#7B8794] font-mono text-[11px]">{item.check_in_time}</td>
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
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B]">Enrolled Students</h3>
                <p className="text-xs text-[#7B8794]">Direct Supabase table with real group persistence</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setModalError(null);
                    setShowAddStudentModal(true);
                  }}
                  className="px-4 py-2.5 bg-[#174E50] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs"
                >
                  <Plus className="w-4 h-4" /> Add Student
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-[#7B8794]" />
              <input
                type="text"
                placeholder="Search students by name, code, or class..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-full border border-[#E6E8E2] text-xs focus:outline-none focus:border-[#174E50]"
              />
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-xs text-[#7B8794]">
                <Loader2 className="w-6 h-6 animate-spin text-[#174E50]" />
                <span>Loading students from Supabase...</span>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="py-12 text-center border-2 border-dashed border-[#E6E8E2] rounded-2xl p-8 space-y-2">
                <Users className="w-8 h-8 text-[#A8BDA6] mx-auto" />
                <p className="text-sm font-semibold text-[#17213B]">No students found</p>
                <p className="text-xs text-[#7B8794]">
                  {studentsList.length === 0
                    ? 'No students enrolled in the database yet. Click "Add Student" to create one.'
                    : 'No students match your search criteria.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider rounded-xl">
                      <th className="py-3 px-4 rounded-l-xl">NAME</th>
                      <th className="py-3 px-4">CODE</th>
                      <th className="py-3 px-4">CLASS / GROUP</th>
                      <th className="py-3 px-4">GRADE</th>
                      <th className="py-3 px-4">PARENT NAME</th>
                      <th className="py-3 px-4">CONTACT</th>
                      <th className="py-3 px-4 rounded-r-xl">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E8E2]">
                    {filteredStudents.map((st) => (
                      <tr key={st.id} className="hover:bg-[#F8F7F2]/60 transition">
                        <td className="py-3.5 px-4 font-bold text-[#17213B]">{st.full_name}</td>
                        <td className="py-3.5 px-4 font-mono text-[#7B8794]">{st.student_code}</td>
                        <td className="py-3.5 px-4 text-[#174E50] font-semibold">{st.class_name || 'Unassigned'}</td>
                        <td className="py-3.5 px-4 text-[#7B8794]">{st.grade_level}</td>
                        <td className="py-3.5 px-4 text-[#7B8794]">{st.parent_name || '—'}</td>
                        <td className="py-3.5 px-4 text-[#7B8794]">{st.parent_phone || '—'}</td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            st.status === 'active' 
                              ? 'bg-emerald-50 text-emerald-700' 
                              : st.status === 'suspended'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-blue-50 text-blue-700'
                          }`}>
                            {st.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CLASSES & GROUPS */}
        {activeTab === 'classes' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B]">Academic Classes & Groups</h3>
                <p className="text-xs text-[#7B8794]">Live Supabase groups table</p>
              </div>
              <button
                onClick={() => {
                  setModalError(null);
                  setShowAddClassModal(true);
                }}
                className="px-4 py-2.5 bg-[#174E50] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-4 h-4" /> Create Class Group
              </button>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-xs text-[#7B8794]">
                <Loader2 className="w-6 h-6 animate-spin text-[#174E50]" />
                <span>Loading classes from Supabase...</span>
              </div>
            ) : classesList.length === 0 ? (
              <div className="py-12 text-center border-2 border-dashed border-[#E6E8E2] rounded-2xl p-8 space-y-2">
                <BookOpen className="w-8 h-8 text-[#A8BDA6] mx-auto" />
                <p className="text-sm font-semibold text-[#17213B]">No class groups found</p>
                <p className="text-xs text-[#7B8794]">Create your first academic group to begin enrolling students.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {classesList.map((cls) => {
                  const percentage = cls.capacity > 0 ? Math.round((cls.enrolled_count / cls.capacity) * 100) : 0;
                  return (
                    <div key={cls.id} className="p-5 rounded-2xl border border-[#E6E8E2] bg-[#F8F7F2]/40 hover:border-[#174E50] transition">
                      <div className="flex items-center justify-between mb-3">
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#D8E8DC] text-[#174E50]">
                          {cls.name}
                        </span>
                        <span className="text-xs text-[#7B8794]">{cls.room || 'Room 204'}</span>
                      </div>
                      <h4 className="text-sm font-bold text-[#17213B]">{cls.subject || 'General'}</h4>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-[#7B8794]">
                          Instructor: <span className="font-semibold text-[#17213B]">{cls.teacher_name || 'Unassigned'}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroupForTeacher(cls);
                            setSelectedTeacherForGroup(cls.teacher_id || '');
                            setAssignError(null);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-[#E6E8E2] bg-white text-[11px] font-semibold text-[#174E50] hover:bg-[#D8E8DC]/50 transition"
                        >
                          Assign / Change
                        </button>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#E6E8E2]">
                        <div className="flex justify-between text-xs text-[#7B8794] mb-1.5">
                          <span>Enrolled Students</span>
                          <span className="font-bold text-[#17213B]">{cls.enrolled_count} / {cls.capacity}</span>
                        </div>
                        <div className="w-full bg-[#E6E8E2] h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-[#174E50] h-full rounded-full transition-all" 
                            style={{ width: `${Math.min(percentage, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TEACHERS */}
        {activeTab === 'teachers' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B]">Staff & Teachers Directory</h3>
                <p className="text-xs text-[#7B8794]">Faculty directory loaded from Supabase</p>
              </div>
              <button
                onClick={() => {
                  setTeacherError(null);
                  setShowAddTeacherModal(true);
                }}
                className="px-4 py-2.5 bg-[#174E50] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs shrink-0 self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" /> Add Teacher
              </button>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center text-xs text-[#7B8794]">
                <Loader2 className="w-6 h-6 animate-spin text-[#174E50]" />
              </div>
            ) : teachersList.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
                No teachers recorded in database yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {teachersList.map((tch) => (
                  <div key={tch.id} className="p-5 rounded-2xl border border-[#E6E8E2] bg-white flex flex-col justify-between gap-4 hover:border-[#174E50] transition shadow-xs">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-full bg-[#E6E1F5] text-[#553B8F] font-bold flex items-center justify-center text-sm shrink-0">
                        {tch.avatar_initials || 'TR'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-[#17213B] truncate">{tch.full_name}</h4>
                        <p className="text-xs text-[#174E50] font-semibold truncate">{tch.subject}</p>
                        <p className="text-[11px] text-[#7B8794] mt-0.5 truncate">{tch.email}</p>
                        {tch.phone && (
                          <p className="text-[10px] text-[#7B8794] font-mono mt-0.5">{tch.phone}</p>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[#E6E8E2]">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#7B8794] block mb-1.5">
                        Assigned Classes
                      </span>
                      {tch.assigned_classes && tch.assigned_classes.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {tch.assigned_classes.map((className, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-0.5 rounded-full bg-[#D8E8DC] text-[#174E50] text-[11px] font-semibold"
                            >
                              {className}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#7B8794] italic">Unassigned (No active groups)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: MANUAL ATTENDANCE & AUDIT */}
        {activeTab === 'attendance' && (
          <div className="space-y-6">
            {/* Attendance Sub-navigation Bar */}
            <div className="bg-white rounded-2xl p-2.5 border border-[#E6E8E2] shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAttendanceSubTab('roster')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
                    attendanceSubTab === 'roster'
                      ? 'bg-[#174E50] text-white shadow-xs'
                      : 'bg-[#F8F7F2] text-[#7B8794] hover:text-[#17213B]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Manual Roster
                </button>
                <button
                  onClick={() => setAttendanceSubTab('scanner')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
                    attendanceSubTab === 'scanner'
                      ? 'bg-[#174E50] text-white shadow-xs'
                      : 'bg-[#F8F7F2] text-[#7B8794] hover:text-[#17213B]'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  QR Attendance Scanner
                </button>
              </div>

              {onOpenStudentCards && (
                <button
                  onClick={onOpenStudentCards}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-bold transition"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  Print Student ID Cards
                </button>
              )}
            </div>

            {attendanceSubTab === 'scanner' ? (
              <AttendanceQRScanner
                classesList={classesList}
                selectedGroupId={selectedAttendanceGroupId}
                onSelectGroupId={(id) => setSelectedAttendanceGroupId(id)}
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
                {/* Header & Controls Card */}
                <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-[#17213B]">Manual Attendance Management</h3>
                  <p className="text-xs text-[#7B8794]">Record and correct student daily attendance in real-time (Africa/Cairo)</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadAttendanceRoster(selectedAttendanceGroupId, selectedAttendanceDate)}
                    disabled={rosterLoading || !selectedAttendanceGroupId}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E8E2] text-xs font-semibold text-[#17213B] hover:bg-[#F8F7F2] disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${rosterLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Filter controls: Group & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-[#17213B] mb-1.5">Select Class Group</label>
                  <select
                    value={selectedAttendanceGroupId}
                    onChange={(e) => setSelectedAttendanceGroupId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E8E2] text-xs font-medium text-[#17213B] bg-white focus:outline-none focus:border-[#174E50]"
                  >
                    {classesList.length === 0 ? (
                      <option value="">No classes found</option>
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
                  <label className="block text-xs font-bold text-[#17213B] mb-1.5">Date (Africa/Cairo)</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={selectedAttendanceDate}
                      onChange={(e) => setSelectedAttendanceDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E8E2] text-xs font-medium text-[#17213B] bg-white focus:outline-none focus:border-[#174E50]"
                    />
                  </div>
                </div>

                {/* Status summary pill */}
                <div className="sm:col-span-2 lg:col-span-1 flex flex-col justify-end">
                  <div className="bg-[#F8F7F2] border border-[#E6E8E2] rounded-xl p-2.5 flex items-center justify-around text-center text-xs">
                    <div>
                      <div className="font-bold text-[#174E50]">{rosterList.filter(r => r.status === 'Present').length}</div>
                      <div className="text-[10px] text-[#7B8794]">Present</div>
                    </div>
                    <div className="h-6 w-px bg-[#E6E8E2]" />
                    <div>
                      <div className="font-bold text-[#A65E14]">{rosterList.filter(r => r.status === 'Late').length}</div>
                      <div className="text-[10px] text-[#7B8794]">Late</div>
                    </div>
                    <div className="h-6 w-px bg-[#E6E8E2]" />
                    <div>
                      <div className="font-bold text-rose-600">{rosterList.filter(r => r.status === 'Absent').length}</div>
                      <div className="text-[10px] text-[#7B8794]">Absent</div>
                    </div>
                    <div className="h-6 w-px bg-[#E6E8E2]" />
                    <div>
                      <div className="font-bold text-purple-600">{rosterList.filter(r => r.status === 'Excused').length}</div>
                      <div className="text-[10px] text-[#7B8794]">Excused</div>
                    </div>
                    <div className="h-6 w-px bg-[#E6E8E2]" />
                    <div>
                      <div className="font-bold text-slate-500">{rosterList.filter(r => r.status === 'Not marked').length}</div>
                      <div className="text-[10px] text-[#7B8794]">Unmarked</div>
                    </div>
                  </div>
                </div>
              </div>

              {rosterError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
                  <span>{rosterError}</span>
                  <button
                    onClick={() => loadAttendanceRoster(selectedAttendanceGroupId, selectedAttendanceDate)}
                    className="underline font-bold ml-2 text-rose-900"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>

            {/* Roster Table Card */}
            <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-[#17213B]">
                    Student Roster for {classesList.find(c => c.id === selectedAttendanceGroupId)?.name || 'Selected Class'}
                  </h4>
                  <p className="text-xs text-[#7B8794]">
                    Select a status button to record or correct student attendance.
                  </p>
                </div>
              </div>

              {classesList.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
                  No classes available. Create a class from the Classes tab to record attendance.
                </div>
              ) : rosterLoading ? (
                <div className="py-16 text-center text-xs text-[#7B8794] flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-[#174E50]" />
                  <span>Loading attendance roster...</span>
                </div>
              ) : rosterList.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
                  No students assigned to this group yet. Add students from the Students tab.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4">STUDENT</th>
                        <th className="py-3 px-4">CODE</th>
                        <th className="py-3 px-4">CURRENT STATUS</th>
                        <th className="py-3 px-4">CHECK-IN TIME</th>
                        <th className="py-3 px-4 text-right">MARK ATTENDANCE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E8E2]">
                      {rosterList.map((item) => {
                        const isSavingThis = savingStudentId === item.student_id;
                        return (
                          <tr key={item.student_id} className="hover:bg-[#F8F7F2] transition-colors">
                            <td className="py-3 px-4 font-bold text-[#17213B]">{item.student_name}</td>
                            <td className="py-3 px-4 font-mono text-[#7B8794]">{item.student_code}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                  item.status === 'Present'
                                    ? 'bg-[#D8E8DC] text-[#174E50]'
                                    : item.status === 'Late'
                                    ? 'bg-[#FCE8D3] text-[#A65E14]'
                                    : item.status === 'Absent'
                                    ? 'bg-rose-100 text-rose-800'
                                    : item.status === 'Excused'
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-[#7B8794]">
                              {item.check_in_time ? item.check_in_time.slice(0, 5) : '—'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                {(['Present', 'Late', 'Absent', 'Excused'] as AttendanceStatus[]).map((st) => {
                                  const isActive = item.status === st;
                                  return (
                                    <button
                                      key={st}
                                      onClick={() => handleUpdateStatus(item.student_id, st)}
                                      disabled={Boolean(savingStudentId)}
                                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 ${
                                        isActive
                                          ? st === 'Present'
                                            ? 'bg-[#174E50] text-white shadow-xs'
                                            : st === 'Late'
                                            ? 'bg-[#A65E14] text-white shadow-xs'
                                            : st === 'Absent'
                                            ? 'bg-rose-600 text-white shadow-xs'
                                            : 'bg-purple-700 text-white shadow-xs'
                                          : 'bg-[#F8F7F2] text-[#7B8794] hover:text-[#17213B] hover:bg-[#E6E8E2] border border-[#E6E8E2]'
                                      }`}
                                    >
                                      {isSavingThis && isActive ? (
                                        <Loader2 className="w-3 h-3 animate-spin inline" />
                                      ) : (
                                        st
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

            {/* Synchronized Logs Card (Audit Trail) */}
            <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-[#17213B]">Recent Synchronized Database Logs</h4>
                  <p className="text-xs text-[#7B8794]">Global attendance activity log across all classes</p>
                </div>
              </div>

              {studentAttendance.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#7B8794] border-2 border-dashed border-[#E6E8E2] rounded-2xl">
                  No attendance logs found in database.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-4">STUDENT</th>
                        <th className="py-2.5 px-4">CLASS</th>
                        <th className="py-2.5 px-4">STATUS</th>
                        <th className="py-2.5 px-4">DATE</th>
                        <th className="py-2.5 px-4">TIME</th>
                        <th className="py-2.5 px-4">METHOD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E8E2]">
                      {studentAttendance.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F8F7F2]">
                          <td className="py-2.5 px-4 font-bold text-[#17213B]">{item.student_name}</td>
                          <td className="py-2.5 px-4 text-[#7B8794]">{item.class_name}</td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                item.status === 'Present'
                                  ? 'bg-[#D8E8DC] text-[#174E50]'
                                  : item.status === 'Late'
                                  ? 'bg-[#FCE8D3] text-[#A65E14]'
                                  : item.status === 'Absent'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-purple-100 text-purple-800'
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[11px]">{item.date}</td>
                          <td className="py-2.5 px-4 font-mono text-[11px]">{item.check_in_time}</td>
                          <td className="py-2.5 px-4 font-mono text-[11px] text-[#7B8794]">{item.method || 'manual'}</td>
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

        {/* TAB 6: SETTINGS & DB INFO */}
        {activeTab === 'settings' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div>
              <h3 className="text-xl font-bold text-[#17213B]">Environment & Access Diagnostics</h3>
              <p className="text-xs text-[#7B8794]">Live authenticated session details</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-5 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2] space-y-2">
                <h4 className="font-bold text-[#174E50]">Authenticated Admin Session:</h4>
                <p><strong>Email:</strong> {user?.email}</p>
                <p><strong>User ID:</strong> <span className="font-mono text-[11px]">{user?.id}</span></p>
                <p><strong>Verified Role:</strong> <span className="font-bold text-emerald-700">{profile?.role}</span></p>
                <p><strong>RLS Policy:</strong> Database-enforced via <code className="font-mono bg-white px-1.5 py-0.5 rounded text-[11px]">public.is_admin()</code></p>
              </div>

              <div className="p-5 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2] space-y-2">
                <h4 className="font-bold text-[#553B8F]">Database Tables Status:</h4>
                <p>• Groups: <strong>{classesList.length}</strong> loaded from Supabase</p>
                <p>• Students: <strong>{studentsList.length}</strong> loaded from Supabase</p>
                <p>• Teachers: <strong>{teachersList.length}</strong> loaded from Supabase</p>
                <p>• Attendance: <strong>{studentAttendance.length}</strong> loaded from Supabase</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: ADD STUDENT */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B]">Enroll New Student</h3>
              <button 
                onClick={() => setShowAddStudentModal(false)}
                className="text-[#7B8794] hover:text-[#17213B] p-1 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateStudent} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="studentName">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="studentName"
                  type="text"
                  required
                  placeholder="e.g. Karim Tarek"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  disabled={modalSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="studentGroupSelect">
                  Assigned Group / Class <span className="text-rose-500">*</span>
                </label>
                {classesList.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                    No groups found in database. Please create a class group first!
                  </p>
                ) : (
                  <select
                    id="studentGroupSelect"
                    value={newStudentGroupId}
                    onChange={(e) => setNewStudentGroupId(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50] bg-white"
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
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="studentCodeInput">
                  Student Code <span className="text-[10px] text-[#7B8794]">(Leave empty to auto-generate)</span>
                </label>
                <input
                  id="studentCodeInput"
                  type="text"
                  placeholder="e.g. ET-2048"
                  value={newStudentCode}
                  onChange={(e) => setNewStudentCode(e.target.value)}
                  disabled={modalSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50] font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="parentNameInput">Parent Name</label>
                  <input
                    id="parentNameInput"
                    type="text"
                    placeholder="e.g. Tarek Mahmoud"
                    value={newStudentParentName}
                    onChange={(e) => setNewStudentParentName(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="parentPhoneInput">Parent Phone</label>
                  <input
                    id="parentPhoneInput"
                    type="tel"
                    placeholder="+20 100 123 4567"
                    value={newStudentParentPhone}
                    onChange={(e) => setNewStudentParentPhone(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2]">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  disabled={modalSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting || classesList.length === 0}
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                >
                  {modalSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to Supabase...</span>
                    </>
                  ) : (
                    <span>Save Student</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD CLASS */}
      {showAddClassModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B]">Create Class Group</h3>
              <button 
                onClick={() => setShowAddClassModal(false)}
                className="text-[#7B8794] hover:text-[#17213B] p-1 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateClass} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="classNameInput">
                  Class Group Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="classNameInput"
                  type="text"
                  required
                  placeholder="e.g. Grade 8A"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  disabled={modalSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="gradeLevelInput">Grade Level</label>
                  <input
                    id="gradeLevelInput"
                    type="text"
                    required
                    placeholder="e.g. Grade 8"
                    value={newClassGrade}
                    onChange={(e) => setNewClassGrade(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="subjectInput">Subject</label>
                  <input
                    id="subjectInput"
                    type="text"
                    placeholder="e.g. Science"
                    value={newClassSubject}
                    onChange={(e) => setNewClassSubject(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="roomInput">Room</label>
                  <input
                    id="roomInput"
                    type="text"
                    placeholder="e.g. Room 204"
                    value={newClassRoom}
                    onChange={(e) => setNewClassRoom(e.target.value)}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="capacityInput">Capacity</label>
                  <input
                    id="capacityInput"
                    type="number"
                    min="1"
                    value={newClassCapacity}
                    onChange={(e) => setNewClassCapacity(Number(e.target.value))}
                    disabled={modalSubmitting}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="classTeacherSelect">
                  Assign Instructor <span className="text-[10px] text-[#7B8794] font-normal">(Optional)</span>
                </label>
                <select
                  id="classTeacherSelect"
                  value={newClassTeacherId}
                  onChange={(e) => setNewClassTeacherId(e.target.value)}
                  disabled={modalSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50] bg-white"
                >
                  <option value="">Unassigned</option>
                  {teachersList.map((tch) => (
                    <option key={tch.id} value={tch.id}>
                      {tch.full_name} ({tch.subject})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2]">
                <button
                  type="button"
                  onClick={() => setShowAddClassModal(false)}
                  disabled={modalSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting}
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                >
                  {modalSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to Supabase...</span>
                    </>
                  ) : (
                    <span>Save Group</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD TEACHER */}
      {showAddTeacherModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#17213B]">Add New Teacher</h3>
              <button 
                onClick={() => setShowAddTeacherModal(false)}
                className="text-[#7B8794] hover:text-[#17213B] p-1 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {teacherError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{teacherError}</span>
              </div>
            )}

            <form onSubmit={handleCreateTeacher} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="teacherNameInput">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="teacherNameInput"
                  type="text"
                  required
                  placeholder="e.g. Dr. Youssef Nabil"
                  value={newTeacherName}
                  onChange={(e) => setNewTeacherName(e.target.value)}
                  disabled={teacherSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="teacherSubjectInput">
                  Subject / Specialization <span className="text-rose-500">*</span>
                </label>
                <input
                  id="teacherSubjectInput"
                  type="text"
                  required
                  placeholder="e.g. Mathematics"
                  value={newTeacherSubject}
                  onChange={(e) => setNewTeacherSubject(e.target.value)}
                  disabled={teacherSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="teacherEmailInput">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  id="teacherEmailInput"
                  type="email"
                  required
                  placeholder="e.g. y.nabil@edutrack.edu"
                  value={newTeacherEmail}
                  onChange={(e) => setNewTeacherEmail(e.target.value)}
                  disabled={teacherSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="teacherPhoneInput">
                  Phone Number <span className="text-[10px] text-[#7B8794] font-normal">(Optional)</span>
                </label>
                <input
                  id="teacherPhoneInput"
                  type="tel"
                  placeholder="+20 100 987 6543"
                  value={newTeacherPhone}
                  onChange={(e) => setNewTeacherPhone(e.target.value)}
                  disabled={teacherSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2]">
                <button
                  type="button"
                  onClick={() => setShowAddTeacherModal(false)}
                  disabled={teacherSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={teacherSubmitting}
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                >
                  {teacherSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Teacher...</span>
                    </>
                  ) : (
                    <span>Save Teacher</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ASSIGN / CHANGE TEACHER */}
      {editingGroupForTeacher && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E6E8E2]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-[#17213B]">Assign Group Instructor</h3>
                <p className="text-xs text-[#7B8794]">Class Group: <span className="font-semibold text-[#174E50]">{editingGroupForTeacher.name}</span></p>
              </div>
              <button 
                onClick={() => setEditingGroupForTeacher(null)}
                className="text-[#7B8794] hover:text-[#17213B] p-1 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {assignError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{assignError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateGroupTeacher} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold" htmlFor="assignTeacherSelect">
                  Assigned Teacher
                </label>
                <select
                  id="assignTeacherSelect"
                  value={selectedTeacherForGroup}
                  onChange={(e) => setSelectedTeacherForGroup(e.target.value)}
                  disabled={assignSubmitting}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50] bg-white font-medium"
                >
                  <option value="">Unassigned (No Instructor)</option>
                  {teachersList.map((tch) => (
                    <option key={tch.id} value={tch.id}>
                      {tch.full_name} ({tch.subject})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#7B8794] mt-1.5">
                  Selecting &quot;Unassigned&quot; will clear the group&apos;s instructor without affecting student enrollment or past attendance.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E8E2]">
                <button
                  type="button"
                  onClick={() => setEditingGroupForTeacher(null)}
                  disabled={assignSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignSubmitting}
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                >
                  {assignSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Updating Assignment...</span>
                    </>
                  ) : (
                    <span>Save Assignment</span>
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
