import React from 'react';
import { BookOpen, GraduationCap, Users, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import { translateRole } from '../i18n/translations';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';

export type NonAdminPortalRole = 'teacher' | 'student' | 'parent';

export const RolePortalLanding: React.FC<{ role: NonAdminPortalRole }> = ({ role }) => {
  const { profile, user, signOut } = useAuth();
  const { language, t } = usePreferences();

  const meta =
    role === 'teacher'
      ? {
          title: t('roleTeacherTitle'),
          badge: t('roleTeacherBadge'),
          subtitle: t('roleTeacherSubtitle'),
          nextStageNote: t('roleTeacherNote'),
          icon: BookOpen,
          accentClasses:
            'bg-[#D8E8DC] border-[#A8BDA6]/60 text-[#174E50] dark:bg-teal-950/60 dark:border-teal-700/60 dark:text-teal-300',
        }
      : role === 'student'
      ? {
          title: t('roleStudentTitle'),
          badge: t('roleStudentBadge'),
          subtitle: t('roleStudentSubtitle'),
          nextStageNote: t('roleStudentNote'),
          icon: GraduationCap,
          accentClasses:
            'bg-[#E6E1F5] border-violet-300/60 text-[#4C3682] dark:bg-violet-950/50 dark:border-violet-700/50 dark:text-violet-300',
        }
      : {
          title: t('roleParentTitle'),
          badge: t('roleParentBadge'),
          subtitle: t('roleParentSubtitle'),
          nextStageNote: t('roleParentNote'),
          icon: Users,
          accentClasses:
            'bg-[#F2EBDD] border-amber-300/60 text-[#8F5212] dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-300',
        };

  const RoleIcon = meta.icon;
  const displayName = profile?.full_name || user?.email || t('authenticatedUserFallback');

  return (
    <div
      data-testid={`role-portal-${role}`}
      className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex flex-col items-center justify-center p-4 relative"
    >
      <div className="absolute top-5 end-5">
        <DisplayControls variant="surface" />
      </div>

      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-8 shadow-lg space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center ${meta.accentClasses}`}>
              <RoleIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                <BrandMark className="w-4 h-4" />
                <span>{t('edutrackPortalBadge')}</span>
              </div>
              <h1 className="text-xl font-extrabold text-[#17213B] dark:text-white mt-0.5">{meta.title}</h1>
            </div>
          </div>

          <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${meta.accentClasses}`}>
            {meta.badge}
          </span>
        </div>

        <p className="text-sm text-[#64748B] dark:text-slate-300">{meta.subtitle}</p>

        <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-4 space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#64748B] dark:text-slate-400">{t('fieldName')}</span>
            <span className="font-semibold text-[#17213B] dark:text-white text-end" data-testid="portal-user-name">
              {displayName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#64748B] dark:text-slate-400">{t('fieldVerifiedRole')}</span>
            <span
              className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#174E50] dark:text-teal-300"
              data-testid="portal-user-role"
            >
              {translateRole(language, profile?.role || role)}
            </span>
          </div>
          {(profile?.email || user?.email) && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#64748B] dark:text-slate-400">{t('fieldEmail')}</span>
              <span className="font-mono text-xs text-[#26334A] dark:text-slate-200 text-end">
                {profile?.email || user?.email}
              </span>
            </div>
          )}
          {user?.id && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#64748B] dark:text-slate-400">{t('fieldAccountId')}</span>
              <span className="font-mono text-[11px] text-[#7B8794] dark:text-slate-400 text-end">
                {user.id}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3.5 text-xs text-[#64748B] dark:text-slate-300">
          <ShieldCheck className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0 mt-0.5" />
          <span>{meta.nextStageNote}</span>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="w-full py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:border-rose-500/40 dark:text-rose-200 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>{t('signOut')}</span>
        </button>
      </div>
    </div>
  );
};
