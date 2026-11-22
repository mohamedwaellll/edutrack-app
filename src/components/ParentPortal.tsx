import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CalendarCheck,
  GraduationCap,
  Link2Off,
  LogOut,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  parentPortalService,
  ParentChildDetails,
  ParentChildSummary,
} from '../services/parentPortalService';

const ATTENDANCE_BADGE_STYLES: Record<string, string> = {
  Present: 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300',
  Late: 'bg-amber-500/15 border-amber-400/35 text-amber-300',
  Absent: 'bg-rose-500/15 border-rose-400/35 text-rose-300',
  Excused: 'bg-violet-500/15 border-violet-400/35 text-violet-300',
};

const GRADE_TYPE_LABELS: Record<string, string> = {
  exam: 'Exam',
  quiz: 'Quiz',
  assignment: 'Assignment',
  participation: 'Participation',
};

export const ParentPortal: React.FC = () => {
  const { user, profile, signOut, isRevalidating } = useAuth();

  const [childrenLoading, setChildrenLoading] = useState(true);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [children, setChildren] = useState<ParentChildSummary[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [linkRevokedNotice, setLinkRevokedNotice] = useState<string | null>(null);
  const [childDetails, setChildDetails] = useState<ParentChildDetails | null>(null);

  const mountedRef = useRef(true);
  const childrenReqIdRef = useRef(0);
  const detailsReqIdRef = useRef(0);
  const selectedChildIdRef = useRef<string | null>(null);

  const displayName = profile?.full_name || user?.email || 'Parent User';

  const loadChildDetails = useCallback(
    async (childId: string, onLinkRevoked?: (notice: string) => void) => {
      const reqId = ++detailsReqIdRef.current;
      setDetailsLoading(true);
      setDetailsError(null);
      setChildDetails(null);

      const res = await parentPortalService.getParentChildDetails(childId);

      if (
        !mountedRef.current ||
        reqId !== detailsReqIdRef.current ||
        selectedChildIdRef.current !== childId
      ) {
        return;
      }

      setDetailsLoading(false);

      if (res.error || !res.data) {
        setChildDetails(null);
        if (res.linkRevoked) {
          selectedChildIdRef.current = null;
          setSelectedChildId(null);
          setDetailsError(null);
          const notice = res.error || 'Access to the selected child was revoked.';
          setLinkRevokedNotice(notice);
          onLinkRevoked?.(notice);
          return;
        }
        setDetailsError(res.error || 'Failed to load child records.');
        return;
      }

      setDetailsError(null);
      setLinkRevokedNotice(null);
      setChildDetails(res.data);
    },
    []
  );

  const loadChildren = useCallback(
    async (preserveNotice = false) => {
      const reqId = ++childrenReqIdRef.current;
      detailsReqIdRef.current++;

      setChildrenLoading(true);
      setChildrenError(null);
      setChildDetails(null);
      setDetailsError(null);
      if (!preserveNotice) {
        setLinkRevokedNotice(null);
      }

      const res = await parentPortalService.getParentPortalChildren();

      if (!mountedRef.current || reqId !== childrenReqIdRef.current) {
        return;
      }

      setChildrenLoading(false);

      if (res.error || !res.data) {
        setChildren([]);
        selectedChildIdRef.current = null;
        setSelectedChildId(null);
        setChildrenError(res.error || 'Failed to load linked children.');
        return;
      }

      const nextChildren = res.data;
      setChildren(nextChildren);

      if (nextChildren.length === 0) {
        selectedChildIdRef.current = null;
        setSelectedChildId(null);
        setChildDetails(null);
        return;
      }

      const currentStillLinked =
        selectedChildIdRef.current !== null &&
        nextChildren.some((c) => c.id === selectedChildIdRef.current);

      const targetChildId = currentStillLinked
        ? (selectedChildIdRef.current as string)
        : nextChildren[0].id;

      selectedChildIdRef.current = targetChildId;
      setSelectedChildId(targetChildId);
      void loadChildDetails(targetChildId, () => {
        void loadChildren(true);
      });
    },
    [loadChildDetails]
  );

  useEffect(() => {
    mountedRef.current = true;
    selectedChildIdRef.current = null;
    void loadChildren(false);

    return () => {
      mountedRef.current = false;
      childrenReqIdRef.current++;
      detailsReqIdRef.current++;
      selectedChildIdRef.current = null;
    };
  }, [user?.id, loadChildren]);

  const handleSelectChild = (childId: string) => {
    if (childId === selectedChildIdRef.current && childDetails && !detailsError) {
      return;
    }
    selectedChildIdRef.current = childId;
    setSelectedChildId(childId);
    setChildDetails(null);
    setDetailsError(null);
    setLinkRevokedNotice(null);
    void loadChildDetails(childId, () => {
      void loadChildren(true);
    });
  };

  const handleRefresh = () => {
    setLinkRevokedNotice(null);
    if (selectedChildIdRef.current && children.length > 0) {
      void loadChildren(false);
    } else {
      void loadChildren(false);
    }
  };

  const handleSignOut = async () => {
    childrenReqIdRef.current++;
    detailsReqIdRef.current++;
    selectedChildIdRef.current = null;
    setChildren([]);
    setSelectedChildId(null);
    setChildDetails(null);
    setChildrenError(null);
    setDetailsError(null);
    setLinkRevokedNotice(null);
    await signOut();
  };

  return (
    <div
      data-testid="role-portal-parent"
      className="min-h-screen bg-[#0D1322] text-[#E6E6F2] p-4 sm:p-8"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Verified Parent Identity */}
        <header className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 shadow-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl border bg-amber-500/15 border-amber-400/40 text-amber-300 flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>EduTrack Portal</span>
              </div>
              <h1 className="text-xl font-bold text-white mt-0.5">Parent Portal</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-semibold text-white" data-testid="portal-user-name">
                  {displayName}
                </span>
                <span className="px-2 py-0.5 rounded-full border bg-amber-500/15 border-amber-400/40 text-amber-300 font-semibold uppercase tracking-wide text-[10px]">
                  <span data-testid="portal-user-role">{profile?.role || 'parent'}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-center">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={childrenLoading || detailsLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-[#324066] text-xs font-semibold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${childrenLoading || detailsLoading ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-[#324066] text-sm font-medium text-white transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {isRevalidating && (
          <div
            data-testid="parent-revalidating-banner"
            className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-200 flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Revalidating session access...</span>
          </div>
        )}

        {linkRevokedNotice && (
          <div
            data-testid="parent-link-revoked-banner"
            className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-200 flex items-center gap-2.5"
          >
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{linkRevokedNotice}</span>
          </div>
        )}

        {/* Loading Linked Children */}
        {childrenLoading && (
          <div
            data-testid="parent-children-loading"
            className="rounded-2xl bg-[#161F36]/75 border border-[#324066] p-10 text-center text-sm text-slate-300"
          >
            Loading your linked children...
          </div>
        )}

        {/* Error Loading Linked Children */}
        {!childrenLoading && childrenError && (
          <div
            data-testid="parent-children-error"
            className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-white">Unable to load linked children</h2>
                <p className="text-xs text-rose-200 mt-1">{childrenError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadChildren(false)}
              className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-xs font-semibold text-rose-100 cursor-pointer self-start sm:self-center"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty Linked Children State */}
        {!childrenLoading && !childrenError && children.length === 0 && (
          <div
            data-testid="parent-no-children"
            className="rounded-2xl bg-[#161F36]/80 border border-[#324066] p-8 text-center space-y-3"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-300 flex items-center justify-center mx-auto">
              <Link2Off className="w-6 h-6" />
            </div>
            <h2 className="text-base font-semibold text-white">No children linked to your account yet</h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              Your parent profile is active, but no student records are currently linked to it.
              Please contact an administrator to link your children under Account Linking.
            </p>
          </div>
        )}

        {/* Linked Children Selector & Details */}
        {!childrenLoading && !childrenError && children.length > 0 && (
          <>
            <section
              data-testid="parent-child-selector"
              className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-5 shadow-xl space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">Linked Children ({children.length})</h2>
                <span className="text-[11px] text-slate-400">
                  Identified by student name &amp; unique code
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {children.map((child) => {
                  const isSelected = selectedChildId === child.id;
                  return (
                    <button
                      key={child.id}
                      type="button"
                      data-testid={`parent-child-option-${child.student_code}`}
                      aria-pressed={isSelected}
                      onClick={() => handleSelectChild(child.id)}
                      className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-400/50 shadow-md'
                          : 'bg-[#0D1322]/60 border-[#324066] hover:border-amber-400/30 hover:bg-[#0D1322]/90'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white truncate">
                          {child.full_name}
                        </span>
                        <span
                          className={`text-[11px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                            isSelected
                              ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
                              : 'bg-slate-800 border-[#324066] text-slate-300'
                          }`}
                        >
                          {child.student_code}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs text-slate-400 flex items-center justify-between gap-2">
                        <span>{child.grade_level}</span>
                        <span className="truncate">
                          {child.group ? child.group.name : 'Unassigned'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Child Details Loading */}
            {detailsLoading && (
              <div
                data-testid="parent-details-loading"
                className="rounded-2xl bg-[#161F36]/75 border border-[#324066] p-10 text-center text-sm text-slate-300"
              >
                Loading selected child records...
              </div>
            )}

            {/* Child Details Read Error + Retry */}
            {!detailsLoading && detailsError && selectedChildId && (
              <div
                data-testid="parent-details-error"
                className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-sm font-semibold text-white">Unable to load child details</h2>
                    <p className="text-xs text-rose-200 mt-1">{detailsError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void loadChildDetails(selectedChildId, () => {
                      void loadChildren(true);
                    })
                  }
                  className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-xs font-semibold text-rose-100 cursor-pointer self-start sm:self-center"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Loaded Child Records */}
            {!detailsLoading && !detailsError && childDetails && (
              <>
                {/* Child Profile Card */}
                <section
                  data-testid="parent-child-card"
                  className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 shadow-xl"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300 mb-4">
                    <GraduationCap className="w-4 h-4" />
                    <span>Selected Child Overview</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl bg-[#0D1322]/70 border border-[#324066] p-4">
                      <div className="text-[11px] uppercase tracking-wider text-slate-400">Student Name</div>
                      <div className="text-sm font-semibold text-white mt-1" data-testid="parent-child-name">
                        {childDetails.child.full_name}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#0D1322]/70 border border-[#324066] p-4">
                      <div className="text-[11px] uppercase tracking-wider text-slate-400">Student Code</div>
                      <div
                        className="text-sm font-mono font-semibold text-amber-300 mt-1"
                        data-testid="parent-child-code"
                      >
                        {childDetails.child.student_code}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#0D1322]/70 border border-[#324066] p-4">
                      <div className="text-[11px] uppercase tracking-wider text-slate-400">Grade &amp; Status</div>
                      <div className="text-sm font-semibold text-white mt-1 flex items-center gap-2">
                        <span>{childDetails.child.grade_level}</span>
                        <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-slate-800 border border-[#324066] text-slate-300">
                          {childDetails.child.status}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#0D1322]/70 border border-[#324066] p-4">
                      <div className="text-[11px] uppercase tracking-wider text-slate-400">Current Group</div>
                      <div className="text-sm font-semibold text-white mt-1" data-testid="parent-child-group">
                        {childDetails.child.group ? childDetails.child.group.name : 'Unassigned'}
                      </div>
                      {childDetails.child.group && (
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {childDetails.child.group.grade_level}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Attendance & Grades Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Attendance History */}
                  <section
                    data-testid="parent-attendance-section"
                    className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 shadow-xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-emerald-400" />
                        <h2 className="text-sm font-semibold text-white">Attendance History</h2>
                      </div>
                      <span className="text-xs text-slate-400">
                        {childDetails.attendance.length}{' '}
                        {childDetails.attendance.length === 1 ? 'entry' : 'entries'}
                      </span>
                    </div>

                    {childDetails.attendance.length === 0 ? (
                      <div
                        data-testid="parent-attendance-empty"
                        className="rounded-xl bg-[#0D1322]/60 border border-[#324066] p-5 text-center text-xs text-slate-400"
                      >
                        No attendance records have been logged for this child yet.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {childDetails.attendance.map((item) => {
                          const badgeClass =
                            ATTENDANCE_BADGE_STYLES[item.status] || ATTENDANCE_BADGE_STYLES.Absent;
                          return (
                            <div
                              key={item.id}
                              data-testid="parent-attendance-row"
                              className="rounded-xl bg-[#0D1322]/70 border border-[#324066] px-4 py-3 flex items-center justify-between gap-3"
                            >
                              <div>
                                <div className="text-sm font-medium text-white">{item.date}</div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  {item.check_in_time
                                    ? `Check-in: ${item.check_in_time}`
                                    : 'No check-in time recorded'}
                                </div>
                              </div>
                              <span
                                className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${badgeClass}`}
                              >
                                {item.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* Grades History */}
                  <section
                    data-testid="parent-grades-section"
                    className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 shadow-xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-violet-400" />
                        <h2 className="text-sm font-semibold text-white">Grades &amp; Assessments</h2>
                      </div>
                      <span className="text-xs text-slate-400">
                        {childDetails.grades.length}{' '}
                        {childDetails.grades.length === 1 ? 'grade' : 'grades'}
                      </span>
                    </div>

                    {childDetails.grades.length === 0 ? (
                      <div
                        data-testid="parent-grades-empty"
                        className="rounded-xl bg-[#0D1322]/60 border border-[#324066] p-5 text-center text-xs text-slate-400"
                      >
                        No assessments or grades have been recorded for this child yet.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {childDetails.grades.map((grade) => (
                          <div
                            key={grade.id}
                            data-testid="parent-grade-row"
                            className="rounded-xl bg-[#0D1322]/70 border border-[#324066] px-4 py-3 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white truncate">
                                {grade.assessment_title}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                                <span>{GRADE_TYPE_LABELS[grade.grade_type] || grade.grade_type}</span>
                                <span>•</span>
                                <span>{grade.assessment_date}</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-bold text-amber-300">
                                {grade.score} / {grade.max_score}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* Parent-Visible Teacher Notes */}
                <section
                  data-testid="parent-notes-section"
                  className="rounded-2xl bg-[#161F36]/90 border border-[#324066] p-6 shadow-xl space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquareText className="w-4 h-4 text-sky-400" />
                      <h2 className="text-sm font-semibold text-white">Teacher Feedback Shared With Parents</h2>
                    </div>
                    <span className="text-xs text-slate-400">
                      {childDetails.notes.length}{' '}
                      {childDetails.notes.length === 1 ? 'note' : 'notes'}
                    </span>
                  </div>

                  {childDetails.notes.length === 0 ? (
                    <div
                      data-testid="parent-notes-empty"
                      className="rounded-xl bg-[#0D1322]/60 border border-[#324066] p-5 text-center text-xs text-slate-400"
                    >
                      No parent-visible teacher feedback has been shared for this child yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {childDetails.notes.map((note) => (
                        <article
                          key={note.id}
                          data-testid="parent-note-row"
                          className="rounded-xl bg-[#0D1322]/70 border border-[#324066] p-4 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                            <span className="font-semibold text-sky-300">{note.author_name}</span>
                            <span>{note.note_date}</span>
                          </div>
                          <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
                            {note.feedback_text}
                          </p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
