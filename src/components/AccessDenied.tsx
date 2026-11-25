import React from 'react';
import { ShieldAlert, LogOut, UserX, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import { translateRole } from '../i18n/translations';
import { DisplayControls } from './DisplayControls';

export const AccessDenied: React.FC = () => {
  const { user, profile, role, status, error, signOut, refreshProfile, loading } = useAuth();
  const { language, t } = usePreferences();

  const isMissingProfile = status === 'missing_profile';
  const isProfileError = status === 'profile_error';
  const isUnknownRole = status === 'unknown_role';

  return (
    <div className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-5 end-5 z-20">
        <DisplayControls variant="surface" />
      </div>

      <div className="max-w-md w-full bg-white dark:bg-[#131E2B] border border-rose-200 dark:border-rose-700/50 rounded-2xl p-8 text-center shadow-lg relative z-10">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-5">
          {isProfileError ? (
            <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          ) : isMissingProfile ? (
            <UserX className="w-8 h-8" />
          ) : (
            <ShieldAlert className="w-8 h-8" />
          )}
        </div>

        <h2 className="text-2xl font-extrabold text-[#17213B] dark:text-white tracking-tight mb-2">
          {isProfileError
            ? t('accessProfileErrorTitle')
            : isMissingProfile
            ? t('accessMissingProfileTitle')
            : isUnknownRole
            ? t('accessUnknownRoleTitle')
            : t('accessRestrictedTitle')}
        </h2>

        <p className="text-xs text-[#64748B] dark:text-slate-300 leading-relaxed mb-6">
          {isProfileError ? (
            <>{error || t('accessProfileErrorFallback')}</>
          ) : isMissingProfile ? (
            <>
              {t('accessMissingProfilePrefix')}
              <span className="text-[#17213B] dark:text-white font-mono">{user?.email}</span>
              {t('accessMissingProfileMid')}
              <code className="bg-[#F8F7F2] dark:bg-slate-800 px-1.5 py-0.5 rounded text-[#174E50] dark:text-teal-300 border border-[#E6E8E2] dark:border-slate-700">
                public.profiles
              </code>
              {t('accessMissingProfileSuffix')}
            </>
          ) : isUnknownRole ? (
            <>
              {error || (
                <>
                  {t('accessUnknownRolePrefix')}
                  <span className="text-[#17213B] dark:text-white font-semibold">
                    {profile?.full_name || user?.email}
                  </span>
                  {t('accessUnknownRoleMid')}
                  <span className="uppercase font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-700/50 px-2 py-0.5 rounded text-[11px]">
                    {role || t('accessUnknown')}
                  </span>
                  {t('accessUnknownRoleSuffix')}
                </>
              )}
            </>
          ) : (
            <>
              {error || (
                <>
                  {t('accessDeniedPrefix')}
                  <span className="text-[#17213B] dark:text-white font-semibold">
                    {profile?.full_name || user?.email}
                  </span>
                  {t('accessDeniedMid')}
                  <span className="uppercase font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-700/50 px-2 py-0.5 rounded text-[11px]">
                    {role ? translateRole(language, role) : t('accessNone')}
                  </span>
                  {t('accessDeniedSuffix')}
                </>
              )}
            </>
          )}
        </p>

        <div className="p-3.5 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 text-start text-xs text-[#64748B] dark:text-slate-400 space-y-1.5 mb-6">
          <div className="flex justify-between gap-2">
            <span>{t('accessUserId')}</span>
            <span className="font-mono text-[#17213B] dark:text-slate-200 text-[11px] truncate max-w-[200px]">
              {user?.id}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>{t('accessEmail')}</span>
            <span className="text-[#17213B] dark:text-slate-200">{user?.email}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>{t('accessAssignedRole')}</span>
            <span className="text-[#174E50] dark:text-teal-300 font-semibold">
              {role ? translateRole(language, role) : t('accessNone')}
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => refreshProfile()}
            disabled={loading}
            className="flex-1 py-3 px-4 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-[#F8F7F2] dark:bg-slate-800 hover:bg-[#E6E8E2]/60 dark:hover:bg-slate-700 text-xs font-semibold text-[#17213B] dark:text-slate-200 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('recheckAccess')}</span>
          </button>

          <button
            onClick={() => signOut()}
            className="flex-1 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white flex items-center justify-center gap-2 transition shadow-sm cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('signOut')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccessDenied;
