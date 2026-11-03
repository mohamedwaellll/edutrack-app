import React, { useState, useEffect } from 'react';
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
  Filter,
  ExternalLink,
  ChevronRight,
  Database,
  RefreshCw,
  LogOut
} from 'lucide-react';
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
  AttendanceRecord, 
  RecentActivity, 
  WeeklyAttendancePoint,
  GroupClass,
  Teacher,
  Student
} from '../types/database';
import { isSupabaseConfigured } from '../lib/supabaseClient';

interface AdminDashboardProps {
  onSwitchToTeacher?: () => void;
  adminName?: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  onSwitchToTeacher,
  adminName = "Mohamed Wael"
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'teachers' | 'classes' | 'attendance' | 'reports' | 'messages' | 'settings'>('overview');
  const [loading, setLoading] = useState(false);
  const [supabaseConnected, setSupabaseConnected] = useState(false);

  // Overview Data
  const [stats, setStats] = useState({
    totalStudents: { value: '2,486', change: '+8.2% this month' },
    teachers: { value: '148', change: '+4 new' },
    activeClasses: { value: '64', change: '92% capacity' },
    attendanceToday: { value: '94.6%', change: '+2.4%' },
  });
  const [weeklyAttendance, setWeeklyAttendance] = useState<WeeklyAttendancePoint[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [studentAttendance, setStudentAttendance] = useState<AttendanceRecord[]>([]);

  // Detailed lists
  const [classesList, setClassesList] = useState<GroupClass[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentGrade, setNewStudentGrade] = useState('Grade 8A');
  const [newClassName, setNewClassName] = useState('');
  const [newClassSubject, setNewClassSubject] = useState('Science');

  const loadData = async () => {
    setLoading(true);
    setSupabaseConnected(isSupabaseConfigured());
    try {
      const overview = await adminService.getDashboardOverview();
      setStats(overview.stats);
      setWeeklyAttendance(overview.weeklyAttendance);
      setRecentActivities(overview.recentActivities);
      setStudentAttendance(overview.studentAttendance);

      const [cls, tch, std] = await Promise.all([
        adminService.getClasses(),
        adminService.getTeachers(),
        adminService.getStudents(),
      ]);
      setClassesList(cls);
      setTeachersList(tch);
      setStudentsList(std);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName) return;
    await adminService.addStudent({
      full_name: newStudentName,
      grade_level: newStudentGrade,
    });
    setStudentsList(prev => [
      {
        id: `s-${Date.now()}`,
        full_name: newStudentName,
        student_code: `ET-${Math.floor(1000 + Math.random() * 9000)}`,
        class_name: newStudentGrade,
        grade_level: newStudentGrade.split(' ')[0],
        status: 'active',
        created_at: new Date().toISOString(),
      },
      ...prev
    ]);
    setShowAddStudentModal(false);
    setNewStudentName('');
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName) return;
    await adminService.addClass({
      name: newClassName,
      subject: newClassSubject,
      grade_level: newClassName.includes('7') ? 'Grade 7' : 'Grade 8',
      room: 'Room 204',
      capacity: 30,
    });
    setClassesList(prev => [
      {
        id: `cls-${Date.now()}`,
        name: newClassName,
        grade_level: newClassName.includes('7') ? 'Grade 7' : 'Grade 8',
        teacher_name: 'Dr. Salma Farid',
        subject: newClassSubject,
        room: 'Room 204',
        capacity: 30,
        enrolled_count: 1,
        created_at: new Date().toISOString(),
      },
      ...prev
    ]);
    setShowAddClassModal(false);
    setNewClassName('');
  };

  const navItems = [
    { id: 'overview', label: 'Overview', icon: 'sparkle' },
    { id: 'students', label: 'Students', icon: 'circle' },
    { id: 'teachers', label: 'Teachers', icon: 'circle' },
    { id: 'classes', label: 'Classes', icon: 'circle' },
    { id: 'attendance', label: 'Attendance', icon: 'circle' },
    { id: 'reports', label: 'Reports', icon: 'circle' },
    { id: 'messages', label: 'Messages', icon: 'circle' },
    { id: 'settings', label: 'Settings', icon: 'circle' },
  ];

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

        {/* Bottom Help Center Card */}
        <div className="space-y-4">
          {onSwitchToTeacher && (
            <button
              onClick={onSwitchToTeacher}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-white border border-[#E6E8E2] text-xs font-semibold text-[#174E50] hover:bg-[#D8E8DC]/40 transition"
            >
              <span>Go to Teacher Dashboard</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          <div className="p-4 rounded-3xl bg-[#D8E8DC]/50 border border-[#A8BDA6]/30">
            <h4 className="text-sm font-semibold text-[#17213B]">Need a hand?</h4>
            <p className="text-xs text-[#7B8794] mt-1">Visit the help center</p>
          </div>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE */}
      <main className="flex-1 p-6 md:p-10 max-w-7xl mx-auto overflow-y-auto">
        {/* Top Bar / Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-[#17213B] tracking-tight">Admin dashboard</h1>
            <p className="text-[#7B8794] text-sm mt-1">A clear view of your learning community</p>
          </div>

          <div className="flex items-center gap-4">
            {/* Supabase Status Pill */}
            <div className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 border ${
              supabaseConnected 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              <Database className="w-3.5 h-3.5" />
              <span>{supabaseConnected ? 'Supabase Live' : 'Demo State'}</span>
            </div>

            <button 
              onClick={loadData}
              title="Refresh Data"
              className="p-2.5 rounded-full bg-white border border-[#E6E8E2] text-[#7B8794] hover:text-[#174E50] transition shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button className="p-2.5 rounded-full bg-white border border-[#E6E8E2] text-[#7B8794] hover:text-[#174E50] transition shadow-xs relative">
              <Bell className="w-4 h-4" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#174E50] rounded-full"></span>
            </button>

            {/* Profile Pill */}
            <div className="flex items-center gap-3 pl-2 pr-4 py-1.5 bg-white border border-[#E6E8E2] rounded-full shadow-xs">
              <div className="w-9 h-9 rounded-full bg-[#A8BDA6] text-[#174E50] font-bold text-xs flex items-center justify-center">
                MW
              </div>
              <div className="text-left text-xs">
                <p className="font-bold text-[#17213B]">{adminName}</p>
                <p className="text-[#7B8794] text-[11px]">Administrator</p>
              </div>
            </div>
          </div>
        </header>

        {/* TAB 1: OVERVIEW (The exact replica of the provided Admin mockup) */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* 4 Stat Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Card 1: Total Students */}
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs hover:border-[#A8BDA6] transition">
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
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs hover:border-[#A8BDA6] transition">
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
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs hover:border-[#A8BDA6] transition">
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
              <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs hover:border-[#A8BDA6] transition">
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
              {/* Attendance Overview Line Chart (7 cols) */}
              <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-[#17213B]">Attendance overview</h3>
                  <p className="text-xs text-[#7B8794] mt-0.5">Weekly attendance rate</p>
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
                        domain={[85, 100]} 
                        tickLine={false} 
                        axisLine={false} 
                        tick={{ fill: '#7B8794', fontSize: 11 }}
                        unit="%" 
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
                        formatter={(val: any) => [`${val}%`, 'Attendance']}
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

              {/* Recent Activity (5 cols) */}
              <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#17213B] mb-5">Recent activity</h3>
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
                </div>

                <div className="pt-4 border-t border-[#E6E8E2] mt-4 flex items-center justify-end">
                  <button 
                    onClick={() => setActiveTab('classes')}
                    className="text-xs text-[#174E50] font-semibold hover:underline flex items-center gap-1"
                  >
                    Manage activities <ChevronRight className="w-3.5 h-3.5" />
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
                  View report
                </button>
              </div>

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
            </div>
          </div>
        )}

        {/* TAB 2: STUDENTS */}
        {activeTab === 'students' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B]">Registered Students</h3>
                <p className="text-xs text-[#7B8794]">Manage student enrollment, QR codes, and assigned classes</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowAddStudentModal(true)}
                  className="px-4 py-2 bg-[#174E50] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs"
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

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider rounded-xl">
                    <th className="py-3 px-4 rounded-l-xl">NAME</th>
                    <th className="py-3 px-4">CODE</th>
                    <th className="py-3 px-4">CLASS</th>
                    <th className="py-3 px-4">PARENT NAME</th>
                    <th className="py-3 px-4">CONTACT</th>
                    <th className="py-3 px-4 rounded-r-xl">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8E2]">
                  {studentsList
                    .filter(s => s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || s.student_code?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((st) => (
                      <tr key={st.id} className="hover:bg-[#F8F7F2]/60">
                        <td className="py-3.5 px-4 font-bold text-[#17213B]">{st.full_name}</td>
                        <td className="py-3.5 px-4 font-mono text-[#7B8794]">{st.student_code}</td>
                        <td className="py-3.5 px-4 text-[#174E50] font-semibold">{st.class_name}</td>
                        <td className="py-3.5 px-4 text-[#7B8794]">{st.parent_name || 'N/A'}</td>
                        <td className="py-3.5 px-4 text-[#7B8794]">{st.parent_phone || 'N/A'}</td>
                        <td className="py-3.5 px-4">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">
                            {st.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: CLASSES / GROUPS (Week 2 Responsibility for Mohamed Wael) */}
        {activeTab === 'classes' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#17213B]">Academic Classes & Groups</h3>
                <p className="text-xs text-[#7B8794]">Week 2: Database tables for groups linked with Supabase</p>
              </div>
              <button
                onClick={() => setShowAddClassModal(true)}
                className="px-4 py-2 bg-[#174E50] text-white rounded-full text-xs font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Create Class Group
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {classesList.map((cls) => {
                const percentage = Math.round((cls.enrolled_count / cls.capacity) * 100);
                return (
                  <div key={cls.id} className="p-5 rounded-2xl border border-[#E6E8E2] bg-[#F8F7F2]/40 hover:border-[#174E50] transition">
                    <div className="flex items-center justify-between mb-3">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#D8E8DC] text-[#174E50]">
                        {cls.name}
                      </span>
                      <span className="text-xs text-[#7B8794]">{cls.room}</span>
                    </div>
                    <h4 className="text-sm font-bold text-[#17213B]">{cls.subject}</h4>
                    <p className="text-xs text-[#7B8794] mt-1">Instructor: {cls.teacher_name}</p>

                    <div className="mt-4 pt-3 border-t border-[#E6E8E2]">
                      <div className="flex justify-between text-xs text-[#7B8794] mb-1.5">
                        <span>Enrolled Students</span>
                        <span className="font-bold text-[#17213B]">{cls.enrolled_count} / {cls.capacity}</span>
                      </div>
                      <div className="w-full bg-[#E6E8E2] h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-[#174E50] h-full rounded-full transition-all" 
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: TEACHERS */}
        {activeTab === 'teachers' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#17213B]">Staff & Teachers</h3>
                <p className="text-xs text-[#7B8794]">Faculty directory and assigned subjects</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {teachersList.map((tch) => (
                <div key={tch.id} className="p-5 rounded-2xl border border-[#E6E8E2] bg-white flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-[#E6E1F5] text-[#553B8F] font-bold flex items-center justify-center text-sm">
                    {tch.avatar_initials || 'TR'}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#17213B]">{tch.full_name}</h4>
                    <p className="text-xs text-[#174E50] font-semibold">{tch.subject}</p>
                    <p className="text-[11px] text-[#7B8794] mt-0.5">{tch.email}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: ATTENDANCE AUDIT */}
        {activeTab === 'attendance' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#17213B]">Daily Attendance Records</h3>
                <p className="text-xs text-[#7B8794]">Linked with Abdelrahman Khodary's QR scanner</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => window.print()}
                  className="px-4 py-2 border border-[#E6E8E2] rounded-full text-xs font-semibold text-[#174E50] flex items-center gap-1.5 hover:bg-[#F8F7F2]"
                >
                  <Download className="w-3.5 h-3.5" /> Export PDF
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">STUDENT</th>
                    <th className="py-3 px-4">CLASS</th>
                    <th className="py-3 px-4">STATUS</th>
                    <th className="py-3 px-4">TIME</th>
                    <th className="py-3 px-4">METHOD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8E2]">
                  {studentAttendance.map((item) => (
                    <tr key={item.id} className="hover:bg-[#F8F7F2]">
                      <td className="py-3 px-4 font-bold text-[#17213B]">{item.student_name}</td>
                      <td className="py-3 px-4 text-[#7B8794]">{item.class_name}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          item.status === 'Present' ? 'bg-[#D8E8DC] text-[#174E50]' : 'bg-[#FCE8D3] text-[#A65E14]'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">{item.check_in_time}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-[#7B8794]">QR_BOM</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: SETTINGS & TEAM CREDITS */}
        {activeTab === 'settings' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-6">
            <div>
              <h3 className="text-xl font-bold text-[#17213B]">Project & Environment Configuration</h3>
              <p className="text-xs text-[#7B8794]">EduTrack Team Responsibilities Matrix</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2]">
                <h4 className="font-bold text-[#174E50] mb-2">محمد وائل (GitHub & Admin):</h4>
                <p className="text-[#26334A] leading-relaxed">
                  ✓ Repo & Branch Architecture<br/>
                  ✓ Admin Dashboard (`AdminDashboard.tsx`)<br/>
                  ✓ Teacher Dashboard (`TeacherDashboard.tsx`)<br/>
                  ✓ Supabase Schemas for Groups & Grades<br/>
                  ✓ PR Reviews & Final Branch Merging
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-[#F8F7F2] border border-[#E6E8E2]">
                <h4 className="font-bold text-[#553B8F] mb-2">Team Integrations:</h4>
                <p className="text-[#26334A] leading-relaxed">
                  • علي عبد القادر: Auth & Protected Routes<br/>
                  • عبد الرحمن خضري: QR Code & Attendance Scanner<br/>
                  • مينا أيمن: UI/UX & Leaderboard & Badges<br/>
                  • يوسف القاضي: Parent Dashboard & Realtime Notifications
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: ADD STUDENT */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl border border-[#E6E8E2]">
            <h3 className="text-lg font-bold text-[#17213B] mb-3">Add New Student</h3>
            <form onSubmit={handleCreateStudent} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Karim Tarek"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Class Group</label>
                <select
                  value={newStudentGrade}
                  onChange={(e) => setNewStudentGrade(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                >
                  <option value="Grade 8A">Grade 8A</option>
                  <option value="Grade 7B">Grade 7B</option>
                  <option value="Grade 9C">Grade 9C</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90"
                >
                  Save Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD CLASS */}
      {showAddClassModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl border border-[#E6E8E2]">
            <h3 className="text-lg font-bold text-[#17213B] mb-3">Create Academic Group</h3>
            <form onSubmit={handleCreateClass} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Class Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Grade 10A"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Subject</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Physics, Mathematics"
                  value={newClassSubject}
                  onChange={(e) => setNewClassSubject(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddClassModal(false)}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90"
                >
                  Save Group
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
