import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CalendarCheck,
  GraduationCap,
  Link2Off,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { studentPortalService, StudentPortalData } from '../services/studentPortalService';

const ATTENDANCE_BADGE_STYLES: Record<string, string> = {
  Present: 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300',
  Late: 'bg-amber-500/15 border-amber-400/35 text-amber-300',
  Absent: 'bg-rose-500/15 border-rose-400/35 text-rose-300',
  Excused: 'bg-violet-500/15 border-violet-400/35 text-violet-300',
};

export const StudentPortal: React.FC = () => {
  const { user, profile, signOut, isRevalidating } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalData, setPortalData] = useState<StudentPortalData | null>(null);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const displayName =
    portalData?.linked && portalData.student?.full_name
      ? portalData.student.full_name
      : profile?.full_name || user?.email || 'Student User';

  const loadStudentPortal = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const res = await studentPortalService.getStudentPortalData();

    if (!mountedRef.current || requestId !== requestIdRef.current) {
      return;
    }

    setLoading(false);

    if (res.error || !res.data) {
      setPortalData(null);
      setError(res.error || 'Failed to load your student records.');
      return;
    }

    setPortalData(res.data);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadStudentPortal();

    return () => {
      mountedRef.current = false;
      requestIdRef.current++;
    };
  }, [user?.id, loadStudentPortal]);

  const handleSignOut = async () => {
    requestIdRef.current++;
    setPortalData(null);
    setError(null);
    await signOut();
  };

  return (
    <div
      data-testid="role-portal-student"
      className="min-h-screen bg-[#0D1322] text-[#E6E6F2] p-4 sm:p-8"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Verified Identity */}
        <header className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 shadow-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl border bg-violet-500/15 border-violet-400/40 text-violet-300 flex items-center justify-center shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                <span>EduTrack Portal</span>
              </div>
              <h1 className="text-xl font-bold text-white mt-0.5">Student Portal</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-semibold text-white" data-testid="portal-user-name">
                  {displayName}
                </span>
                <span
                  className="font-mono text-[11px] uppercase px-2 py-0.5 rounded bg-violet-500/15 border border-violet-400/35 text-violet-200"
                  data-testid="portal-user-role"
                >
                  {profile?.role || 'student'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-center">
            <button
              type="button"
              onClick={() => void loadStudentPortal()}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/60 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
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
            data-testid="student-portal-revalidating-banner"
            role="status"
            className="rounded-xl bg-amber-500/15 border border-amber-400/35 px-4 py-3 text-xs text-amber-200 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>Re-verifying student session permissions...</span>
          </div>
        )}

        {/* Read-only scope notice */}
        <div className="flex items-start gap-2.5 rounded-xl bg-slate-900/70 border border-slate-700/70 p-3.5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
          <span>
            Read-only personal student view (Stage D): shows only your linked profile card, recorded attendance, and saved grades.
          </span>
        </div>

        {/* State 1: Loading */}
        {loading && (
          <div
            data-testid="student-portal-loading"
            className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-10 text-center text-sm text-[#C7B8ED] flex flex-col items-center gap-3"
          >
            <RefreshCw className="w-6 h-6 text-violet-400 animate-spin" />
            <span>Loading your student records...</span>
          </div>
        )}

        {/* State 2: Load / Network / Permission Error */}
        {!loading && error && (
          <div
            data-testid="student-portal-error"
            role="alert"
            className="rounded-2xl bg-rose-950/40 border border-rose-500/40 p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold text-white">Unable to Load Student Records</h2>
                <p className="text-xs text-rose-200 mt-1">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadStudentPortal()}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-2 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* State 3: Unlinked Student Account */}
        {!loading && !error && portalData && !portalData.linked && (
          <div
            data-testid="student-unlinked-state"
            className="rounded-2xl bg-[#161F36]/90 border border-amber-500/35 p-8 text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-400/35 text-amber-300 flex items-center justify-center mx-auto">
              <Link2Off className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-white">Student Account Not Linked Yet</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your login is verified as a student account, but it is not currently linked to an enrolled student profile. Please ask an administrator to link your account.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadStudentPortal()}
              className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-xs font-semibold inline-flex items-center gap-1.5 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* State 4: Linked Student Content */}
        {!loading && !error && portalData?.linked && portalData.student && (
          <div className="space-y-6">
            {/* Student Card */}
            <section
              data-testid="student-card"
              aria-label="Student Profile Card"
              className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs"
            >
              <div className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-4 space-y-1">
                <span className="text-slate-400">Student Name</span>
                <p className="text-sm font-bold text-white" data-testid="student-card-name">
                  {portalData.student.full_name}
                </p>
              </div>
              <div className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-4 space-y-1">
                <span className="text-slate-400">Student Code</span>
                <p className="text-sm font-mono font-bold text-violet-300" data-testid="student-card-code">
                  {portalData.student.student_code}
                </p>
              </div>
              <div className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-4 space-y-1">
                <span className="text-slate-400">Grade Level</span>
                <p className="text-sm font-semibold text-white" data-testid="student-card-grade">
                  {portalData.student.grade_level}
                </p>
              </div>
              <div className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-4 space-y-1">
                <span className="text-slate-400">Current Group</span>
                {portalData.student.group ? (
                  <p className="text-sm font-semibold text-white" data-testid="student-card-group">
                    {portalData.student.group.name}
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5" data-testid="student-no-group-state">
                    <Users className="w-3.5 h-3.5" />
                    <span>No Group Assigned</span>
                  </p>
                )}
              </div>
            </section>

            {/* Attendance & Grades Columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recorded Attendance */}
              <section
                data-testid="student-attendance-section"
                aria-label="Attendance History"
                className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 space-y-4"
              >
                <div className="flex items-center justify-between gap-2 border-b border-[#2C395D] pb-3">
                  <div className="flex items-center gap-2">
                    <CalendarCheck className="w-4 h-4 text-violet-400" />
                    <h2 className="text-base font-bold text-white">Attendance History</h2>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {portalData.attendance.length}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  Only recorded entries are displayed (newest first). Days without a record do not count as absent.
                </p>

                {portalData.attendance.length === 0 ? (
                  <div
                    data-testid="student-empty-attendance"
                    className="rounded-xl bg-[#0D1322]/60 border border-[#2C395D] p-6 text-center text-xs text-slate-400"
                  >
                    No attendance records have been logged yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#2C395D] text-slate-400 uppercase tracking-wider text-[11px]">
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2">Arrival Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#2C395D]/70">
                        {portalData.attendance.map((att) => (
                          <tr key={att.id} data-testid={`student-attendance-row-${att.id}`}>
                            <td className="py-2.5 pr-3 font-mono text-white">{att.date}</td>
                            <td className="py-2.5 pr-3">
                              <span
                                className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                                  ATTENDANCE_BADGE_STYLES[att.status] || ATTENDANCE_BADGE_STYLES.Absent
                                }`}
                              >
                                {att.status}
                              </span>
                            </td>
                            <td className="py-2.5 font-mono text-slate-300">
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
                aria-label="Saved Grades"
                className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 space-y-4"
              >
                <div className="flex items-center justify-between gap-2 border-b border-[#2C395D] pb-3">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-cyan-400" />
                    <h2 className="text-base font-bold text-white">Grades Ledger</h2>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {portalData.grades.length}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  Saved assessment scores remain visible across group transfers or instructor changes.
                </p>

                {portalData.grades.length === 0 ? (
                  <div
                    data-testid="student-empty-grades"
                    className="rounded-xl bg-[#0D1322]/60 border border-[#2C395D] p-6 text-center text-xs text-slate-400"
                  >
                    No grades have been recorded yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {portalData.grades.map((gr) => (
                      <div
                        key={gr.id}
                        data-testid={`student-grade-row-${gr.id}`}
                        className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-3.5 text-xs flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-white">{gr.assessment_title}</div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2">
                            <span className="uppercase font-medium text-slate-300">{gr.grade_type}</span>
                            <span>•</span>
                            <span className="font-mono">{gr.assessment_date}</span>
                          </div>
                        </div>
                        <div className="font-mono font-bold text-sm text-cyan-300 shrink-0">
                          {gr.score} / {gr.max_score}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentPortal;
