import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CalendarCheck,
  ClipboardList,
  Clock,
  GraduationCap,
  Link2Off,
  LogOut,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import {
  translateAttendanceStatus,
  translateFallbackLabel,
  translateGradeType,
  translateRole,
  translateStudentStatus,
} from '../i18n/translations';
import { formatCairoDateTime } from '../services/portalPayloadValidation';
import {
  parentPortalService,
  ParentChildAssignmentItem,
  ParentChildDetails,
  ParentChildSummary,
} from '../services/parentPortalService';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';
import { AssignmentDueCalendar } from './AssignmentDueCalendar';
import { AssignmentDeadlineNotice } from './AssignmentDeadlineNotice';

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

export const ParentPortal: React.FC = () => {
  const { user, profile, signOut, isRevalidating } = useAuth();
  const { language, t } = usePreferences();

  const [childrenLoading, setChildrenLoading] = useState(true);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [children, setChildren] = useState<ParentChildSummary[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [linkRevokedNotice, setLinkRevokedNotice] = useState<string | null>(null);
  const [childDetails, setChildDetails] = useState<ParentChildDetails | null>(null);
  const [childAssignmentsLoading, setChildAssignmentsLoading] = useState(false);
  const [childAssignmentsError, setChildAssignmentsError] = useState<string | null>(null);
  const [childAssignments, setChildAssignments] = useState<ParentChildAssignmentItem[]>([]);

  const mountedRef = useRef(true);
  const childrenReqIdRef = useRef(0);
  const detailsReqIdRef = useRef(0);
  const assignmentsReqIdRef = useRef(0);
  const selectedChildIdRef = useRef<string | null>(null);
  const reloadChildrenRef = useRef<(preserveNotice?: boolean) => Promise<void>>(async () => {});

  const displayName = profile?.full_name || user?.email || t('parentUserFallback');

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

  const loadChildAssignments = useCallback(
    async (childId: string, onLinkRevoked?: (notice: string) => void) => {
      const reqId = ++assignmentsReqIdRef.current;
      setChildAssignmentsLoading(true);
      setChildAssignmentsError(null);
      setChildAssignments([]);

      const res = await parentPortalService.getParentChildAssignments(childId);

      if (
        !mountedRef.current ||
        reqId !== assignmentsReqIdRef.current ||
        selectedChildIdRef.current !== childId
      ) {
        return;
      }

      setChildAssignmentsLoading(false);

      if (res.error || !res.data) {
        setChildAssignments([]);
        if (res.linkRevoked) {
          selectedChildIdRef.current = null;
          setSelectedChildId(null);
          setChildDetails(null);
          setChildAssignmentsError(null);
          const notice = res.error || 'Access to the selected child was revoked.';
          setLinkRevokedNotice(notice);
          onLinkRevoked?.(notice);
          return;
        }
        setChildAssignmentsError(res.error || 'Failed to load child assignments.');
        return;
      }

      setChildAssignmentsError(null);
      setChildAssignments(res.data);
    },
    []
  );

  const applyChildrenResult = useCallback(
    (res: Awaited<ReturnType<typeof parentPortalService.getParentPortalChildren>>) => {
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
      setChildrenError(null);

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
      const onRevoked = () => {
        void reloadChildrenRef.current(true);
      };
      void loadChildDetails(targetChildId, onRevoked);
      void loadChildAssignments(targetChildId, onRevoked);
    },
    [loadChildDetails, loadChildAssignments]
  );

  const loadChildren = useCallback(
    async (preserveNotice = false) => {
      const reqId = ++childrenReqIdRef.current;
      detailsReqIdRef.current++;
      assignmentsReqIdRef.current++;

      setChildrenLoading(true);
      setChildrenError(null);
      setChildDetails(null);
      setDetailsError(null);
      setChildAssignments([]);
      setChildAssignmentsError(null);
      if (!preserveNotice) {
        setLinkRevokedNotice(null);
      }

      const res = await parentPortalService.getParentPortalChildren();

      if (!mountedRef.current || reqId !== childrenReqIdRef.current) {
        return;
      }

      applyChildrenResult(res);
    },
    [applyChildrenResult]
  );

  useEffect(() => {
    reloadChildrenRef.current = loadChildren;
  }, [loadChildren]);

  useEffect(() => {
    mountedRef.current = true;
    selectedChildIdRef.current = null;
    const childrenReq = childrenReqIdRef;
    const detailsReq = detailsReqIdRef;
    const selectedChildRef = selectedChildIdRef;
    const reqId = ++childrenReq.current;

    parentPortalService.getParentPortalChildren().then((res) => {
      if (!mountedRef.current || reqId !== childrenReq.current) {
        return;
      }
      applyChildrenResult(res);
    });

    return () => {
      mountedRef.current = false;
      childrenReq.current++;
      detailsReq.current++;
      selectedChildRef.current = null;
    };
  }, [user?.id, applyChildrenResult]);

  const handleSelectChild = (childId: string) => {
    if (childId === selectedChildIdRef.current && childDetails && !detailsError && !childAssignmentsError) {
      return;
    }
    selectedChildIdRef.current = childId;
    setSelectedChildId(childId);
    setChildDetails(null);
    setDetailsError(null);
    setChildAssignments([]);
    setChildAssignmentsError(null);
    setLinkRevokedNotice(null);
    const onRevoked = () => {
      void loadChildren(true);
    };
    void loadChildDetails(childId, onRevoked);
    void loadChildAssignments(childId, onRevoked);
  };

  const handleRefresh = () => {
    setLinkRevokedNotice(null);
    void loadChildren(false);
  };

  const handleSignOut = async () => {
    childrenReqIdRef.current++;
    detailsReqIdRef.current++;
    assignmentsReqIdRef.current++;
    selectedChildIdRef.current = null;
    setChildren([]);
    setSelectedChildId(null);
    setChildDetails(null);
    setChildAssignments([]);
    setChildrenError(null);
    setDetailsError(null);
    setChildAssignmentsError(null);
    setLinkRevokedNotice(null);
    await signOut();
  };

  return (
    <div
      data-testid="role-portal-parent"
      className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 p-4 sm:p-8"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Verified Parent Identity */}
        <header className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl border bg-[#F2EBDD] border-amber-300/60 text-[#8F5212] dark:bg-amber-950/50 dark:border-amber-600/40 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                <BrandMark className="w-4 h-4" />
                <span>{t('edutrackPortalBadge')}</span>
              </div>
              <h1 className="text-xl font-extrabold text-[#17213B] dark:text-white mt-0.5">
                {t('roleParentTitle')}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-slate-300">
                <span className="font-semibold text-[#17213B] dark:text-white" data-testid="portal-user-name">
                  {displayName}
                </span>
                <span className="px-2 py-0.5 rounded-full border bg-[#F2EBDD] border-amber-300/60 text-[#8F5212] dark:bg-amber-500/15 dark:border-amber-400/40 dark:text-amber-300 font-semibold uppercase tracking-wide text-[10px]">
                  <span data-testid="portal-user-role">
                    {translateRole(language, profile?.role || 'parent')}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
            <DisplayControls variant="compact" />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={childrenLoading || detailsLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F8F7F2] hover:bg-[#E6E8E2]/60 dark:bg-slate-800 dark:hover:bg-slate-700 border border-[#E6E8E2] dark:border-slate-700 text-xs font-semibold text-[#26334A] dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${childrenLoading || detailsLoading ? 'animate-spin' : ''}`}
              />
              <span>{t('refresh')}</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:border-rose-500/40 dark:text-rose-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('signOut')}</span>
            </button>
          </div>
        </header>

        {isRevalidating && (
          <div
            data-testid="parent-revalidating-banner"
            className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 px-4 py-3 text-xs dark:text-amber-200 flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>{t('parentRevalidatingBanner')}</span>
          </div>
        )}

        {linkRevokedNotice && (
          <div
            data-testid="parent-link-revoked-banner"
            className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 px-4 py-3 text-xs dark:text-amber-200 flex items-center gap-2.5"
          >
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>{linkRevokedNotice}</span>
          </div>
        )}

        {/* Loading Linked Children */}
        {childrenLoading && (
          <div
            data-testid="parent-children-loading"
            className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-10 text-center text-sm text-[#64748B] dark:text-slate-300"
          >
            {t('loadingLinkedChildren')}
          </div>
        )}

        {/* Error Loading Linked Children */}
        {!childrenLoading && childrenError && (
          <div
            data-testid="parent-children-error"
            className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-rose-900 dark:text-white">
                  {t('unableLoadLinkedChildren')}
                </h2>
                <p className="text-xs text-rose-700 dark:text-rose-200 mt-1">{childrenError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadChildren(false)}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white cursor-pointer self-start sm:self-center"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {/* Empty Linked Children State */}
        {!childrenLoading && !childrenError && children.length === 0 && (
          <div
            data-testid="parent-no-children"
            className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-8 text-center space-y-3"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/30 text-amber-600 dark:text-amber-300 flex items-center justify-center mx-auto">
              <Link2Off className="w-6 h-6" />
            </div>
            <h2 className="text-base font-semibold text-[#17213B] dark:text-white">
              {t('noChildrenLinkedTitle')}
            </h2>
            <p className="text-xs text-[#64748B] dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              {t('noChildrenLinkedDesc')}
            </p>
          </div>
        )}

        {/* Linked Children Selector & Details */}
        {!childrenLoading && !childrenError && children.length > 0 && (
          <>
            <section
              data-testid="parent-child-selector"
              className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-5 shadow-xs space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#17213B] dark:text-white">
                  {t('parentPortalChildrenHeading', { count: children.length })}
                </h2>
                <span className="text-[11px] text-[#7B8794] dark:text-slate-400">
                  {t('linkedChildrenHint')}
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
                      className={`text-start rounded-xl border p-3.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#D8E8DC]/50 border-[#174E50] dark:bg-teal-950/60 dark:border-teal-400/60 shadow-sm'
                          : 'bg-[#F8F7F2] border-[#E6E8E2] hover:border-[#174E50]/40 dark:bg-[#0D1520] dark:border-slate-800 dark:hover:border-teal-500/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#17213B] dark:text-white truncate">
                          {child.full_name}
                        </span>
                        <span
                          className={`text-[11px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                            isSelected
                              ? 'bg-white border-[#174E50]/40 text-[#174E50] dark:bg-teal-900/50 dark:border-teal-400/40 dark:text-teal-200'
                              : 'bg-white border-[#E6E8E2] text-[#64748B] dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {child.student_code}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs text-[#64748B] dark:text-slate-400 flex items-center justify-between gap-2">
                        <span>{child.grade_level}</span>
                        <span className="truncate">
                          {child.group ? child.group.name : t('unassigned')}
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
                className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-10 text-center text-sm text-[#64748B] dark:text-slate-300"
              >
                {t('loadingChildRecords')}
              </div>
            )}

            {/* Child Details Read Error + Retry */}
            {!detailsLoading && detailsError && selectedChildId && (
              <div
                data-testid="parent-details-error"
                className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-sm font-semibold text-rose-900 dark:text-white">
                      {t('unableLoadChildDetails')}
                    </h2>
                    <p className="text-xs text-rose-700 dark:text-rose-200 mt-1">{detailsError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void loadChildDetails(selectedChildId, () => {
                      void loadChildren(true);
                    })
                  }
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white cursor-pointer self-start sm:self-center"
                >
                  {t('retry')}
                </button>
              </div>
            )}

            {/* Loaded Child Records */}
            {!detailsLoading && !detailsError && childDetails && (
              <>
                {/* Child Profile Card */}
                <section
                  data-testid="parent-child-card"
                  className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-xs"
                >
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#174E50] dark:text-teal-300 mb-4">
                    <GraduationCap className="w-4 h-4" />
                    <span>{t('selectedChildOverviewHeading')}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4">
                      <div className="text-[11px] uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                        {t('studentNameCardLabel')}
                      </div>
                      <div
                        className="text-sm font-semibold text-[#17213B] dark:text-white mt-1"
                        data-testid="parent-child-name"
                      >
                        {childDetails.child.full_name}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4">
                      <div className="text-[11px] uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                        {t('studentCodeCardLabel')}
                      </div>
                      <div
                        className="text-sm font-mono font-semibold text-[#174E50] dark:text-teal-300 mt-1"
                        data-testid="parent-child-code"
                      >
                        {childDetails.child.student_code}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4">
                      <div className="text-[11px] uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                        {t('gradeAndStatusLabel')}
                      </div>
                      <div className="text-sm font-semibold text-[#17213B] dark:text-white mt-1 flex items-center gap-2">
                        <span>{childDetails.child.grade_level}</span>
                        <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#26334A] dark:text-slate-300">
                          {translateStudentStatus(language, childDetails.child.status)}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4">
                      <div className="text-[11px] uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                        {t('currentGroupCardLabel')}
                      </div>
                      <div
                        className="text-sm font-semibold text-[#17213B] dark:text-white mt-1"
                        data-testid="parent-child-group"
                      >
                        {childDetails.child.group
                          ? childDetails.child.group.name
                          : translateFallbackLabel(language, 'Unassigned')}
                      </div>
                      {childDetails.child.group && (
                        <div className="text-[11px] text-[#7B8794] dark:text-slate-400 mt-0.5">
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
                    className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-xs space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-[#174E50] dark:text-emerald-400" />
                        <h2 className="text-sm font-bold text-[#17213B] dark:text-white">
                          {t('attendanceHistoryHeading')}
                        </h2>
                      </div>
                      <span className="text-xs text-[#64748B] dark:text-slate-400">
                        {childDetails.attendance.length}{' '}
                        {childDetails.attendance.length === 1 ? t('entrySingular') : t('entryPlural')}
                      </span>
                    </div>

                    {childDetails.attendance.length === 0 ? (
                      <div
                        data-testid="parent-attendance-empty"
                        className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-5 text-center text-xs text-[#7B8794] dark:text-slate-400"
                      >
                        {t('noAttendanceForChild')}
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
                              className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 px-4 py-3 flex items-center justify-between gap-3"
                            >
                              <div>
                                <div className="text-sm font-medium text-[#17213B] dark:text-white">
                                  {item.date}
                                </div>
                                <div className="text-[11px] text-[#7B8794] dark:text-slate-400 mt-0.5">
                                  {item.check_in_time
                                    ? t('checkInPrefix', { time: item.check_in_time })
                                    : t('noCheckInRecorded')}
                                </div>
                              </div>
                              <span
                                className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${badgeClass}`}
                              >
                                {translateAttendanceStatus(language, item.status)}
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
                    className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-xs space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-[#174E50] dark:text-teal-300" />
                        <h2 className="text-sm font-bold text-[#17213B] dark:text-white">
                          {t('gradesAndAssessmentsHeading')}
                        </h2>
                      </div>
                      <span className="text-xs text-[#64748B] dark:text-slate-400">
                        {childDetails.grades.length}{' '}
                        {childDetails.grades.length === 1 ? t('gradeSingular') : t('gradePlural')}
                      </span>
                    </div>

                    {childDetails.grades.length === 0 ? (
                      <div
                        data-testid="parent-grades-empty"
                        className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-5 text-center text-xs text-[#7B8794] dark:text-slate-400"
                      >
                        {t('noGradesForChild')}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {childDetails.grades.map((grade) => (
                          <div
                            key={grade.id}
                            data-testid="parent-grade-row"
                            className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 px-4 py-3 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-[#17213B] dark:text-white truncate">
                                {grade.assessment_title}
                              </div>
                              <div className="text-[11px] text-[#7B8794] dark:text-slate-400 mt-0.5 flex items-center gap-2">
                                <span>{translateGradeType(language, grade.grade_type)}</span>
                                <span>•</span>
                                <span>{grade.assessment_date}</span>
                              </div>
                            </div>
                            <div className="text-end shrink-0">
                              <div
                                dir="ltr"
                                className="inline-block text-sm font-bold text-[#174E50] dark:text-amber-300 tabular-nums"
                              >
                                {grade.score} / {grade.max_score}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* Child Assignments Follow-up */}
                <section
                  data-testid="parent-assignments-section"
                  className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-xs space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-[#174E50] dark:text-sky-400" />
                      <h2 className="text-sm font-bold text-[#17213B] dark:text-white">
                        {t('parentAssignmentsHeading')}
                      </h2>
                    </div>
                    {!childAssignmentsLoading && !childAssignmentsError && (
                      <span className="text-xs text-[#64748B] dark:text-slate-400">
                        {childAssignments.length === 1
                          ? t('assignmentCountSingular')
                          : t('assignmentCountPlural', { count: childAssignments.length })}
                      </span>
                    )}
                  </div>

                  {childAssignmentsLoading && (
                    <div
                      data-testid="parent-assignments-loading"
                      className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-5 text-center text-xs text-[#64748B] dark:text-slate-400 flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4 animate-spin text-[#174E50] dark:text-sky-400" />
                      <span>{t('loadingParentAssignments')}</span>
                    </div>
                  )}

                  {!childAssignmentsLoading && childAssignmentsError && (
                    <div
                      role="alert"
                      data-testid="parent-assignments-error"
                      className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 p-4 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="flex items-start gap-2 text-rose-800 dark:text-rose-200">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">{t('unableLoadParentAssignments')}</p>
                          <p className="mt-0.5">{childAssignmentsError}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="retry-parent-assignments-btn"
                        onClick={() =>
                          selectedChildId &&
                          void loadChildAssignments(selectedChildId, () => {
                            void loadChildren(true);
                          })
                        }
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
                      >
                        {t('retry')}
                      </button>
                    </div>
                  )}

                  {!childAssignmentsLoading && !childAssignmentsError && (
                    <AssignmentDeadlineNotice assignments={childAssignments.filter((item) => item.status === 'not_submitted' && !item.is_past_due)} />
                  )}

                  {!childAssignmentsLoading && !childAssignmentsError && (
                    <AssignmentDueCalendar
                      key={selectedChildId ?? 'none'}
                      testIdPrefix="parent"
                      assignments={childAssignments.map((item) => ({
                        id: item.id,
                        title: item.title,
                        due_at: item.due_at,
                        statusLabel:
                          item.status === 'graded'
                            ? t('parentAssignmentGraded')
                            : item.status === 'pending_grading'
                              ? t('parentAssignmentPending')
                              : item.status === 'missed'
                                ? t('parentAssignmentMissed')
                                : t('parentAssignmentNotSubmitted'),
                        statusStyle:
                          item.status === 'graded'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200'
                            : item.status === 'pending_grading'
                              ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-200'
                              : item.status === 'missed'
                                ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/50 dark:border-rose-700/50 dark:text-rose-200'
                                : 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300',
                      }))}
                    />
                  )}

                  {!childAssignmentsLoading && !childAssignmentsError && childAssignments.length === 0 && (
                    <div
                      data-testid="parent-assignments-empty"
                      className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-5 text-center text-xs text-[#7B8794] dark:text-slate-400"
                    >
                      {t('noParentAssignments')}
                    </div>
                  )}

                  {!childAssignmentsLoading && !childAssignmentsError && childAssignments.length > 0 && (
                    <div className="space-y-2.5">
                      {childAssignments.map((item) => {
                        const statusLabel =
                          item.status === 'graded'
                            ? t('parentAssignmentGraded')
                            : item.status === 'pending_grading'
                              ? t('parentAssignmentPending')
                              : item.status === 'missed'
                                ? t('parentAssignmentMissed')
                                : t('parentAssignmentNotSubmitted');
                        const statusStyle =
                          item.status === 'graded'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200'
                            : item.status === 'pending_grading'
                              ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-200'
                              : item.status === 'missed'
                                ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/50 dark:border-rose-700/50 dark:text-rose-200'
                                : 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300';

                        return (
                          <div
                            key={item.id}
                            data-testid={`parent-assignment-row-${item.id}`}
                            className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="text-sm font-semibold text-[#17213B] dark:text-white break-words">
                                {item.title}
                              </div>
                              <div
                                dir="ltr"
                                className="inline-flex items-center gap-1 text-[11px] font-mono text-[#64748B] dark:text-slate-400"
                              >
                                <Clock className="w-3 h-3 shrink-0" />
                                <span>{formatCairoDateTime(item.due_at)}</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <span
                                data-testid={`parent-assignment-status-${item.id}`}
                                className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${statusStyle}`}
                              >
                                {statusLabel}
                              </span>
                              {item.grade && (
                                <span
                                  dir="ltr"
                                  data-testid={`parent-assignment-grade-${item.id}`}
                                  className="font-mono text-xs font-extrabold text-[#174E50] dark:text-amber-300 tabular-nums"
                                >
                                  {item.grade.score} / {item.grade.max_score}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Parent-Visible Teacher Notes */}
                <section
                  data-testid="parent-notes-section"
                  className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 shadow-xs space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquareText className="w-4 h-4 text-[#174E50] dark:text-sky-400" />
                      <h2 className="text-sm font-bold text-[#17213B] dark:text-white">
                        {t('teacherFeedbackParentsHeading')}
                      </h2>
                    </div>
                    <span className="text-xs text-[#64748B] dark:text-slate-400">
                      {childDetails.notes.length}{' '}
                      {childDetails.notes.length === 1 ? t('noteSingular') : t('notePlural')}
                    </span>
                  </div>

                  {childDetails.notes.length === 0 ? (
                    <div
                      data-testid="parent-notes-empty"
                      className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-5 text-center text-xs text-[#7B8794] dark:text-slate-400"
                    >
                      {t('noParentVisibleNotes')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {childDetails.notes.map((note) => (
                        <article
                          key={note.id}
                          data-testid="parent-note-row"
                          className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B] dark:text-slate-400">
                            <span className="font-semibold text-[#174E50] dark:text-sky-300">
                              {note.author_name}
                            </span>
                            <span>{note.note_date}</span>
                          </div>
                          <p className="text-sm text-[#26334A] dark:text-slate-100 leading-relaxed whitespace-pre-wrap">
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
