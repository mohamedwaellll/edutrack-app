import { useState } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { PreferencesProvider } from './contexts/PreferencesContext';
import { useAuth } from './contexts/authState';
import { usePreferences } from './contexts/preferencesState';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthPage } from './components/AuthPage';
import { AccessDenied } from './components/AccessDenied';
import { UnconfiguredNotice } from './components/UnconfiguredNotice';
import { TeacherPortal } from './components/TeacherPortal';
import { StudentPortal } from './components/StudentPortal';
import { ParentPortal } from './components/ParentPortal';
import { PasswordRecoveryPage } from './components/PasswordRecoveryPage';
import TeacherDashboard from './components/TeacherDashboard';
import ParentDashboard from './components/ParentDashboard';
import StudentCardsPrintPage from './components/StudentCardsPrintPage';
import { BrandMark } from './components/BrandMark';
import { DisplayControls } from './components/DisplayControls';
import { Loader2, Eye, ArrowLeft, LogOut, AlertTriangle, RefreshCw } from 'lucide-react';

function AppContent() {
  const { status, profile, user, error, signOut, sessionInstanceId = 0 } = useAuth();
  const { t } = usePreferences();
  // Isolated preview state scoped strictly to the current authenticated admin session
  const [isolatedPreview, setIsolatedPreview] = useState<{
    sessionKey: string;
    view: 'teacher' | 'parent' | 'qr';
  } | null>(null);

  const isVerifiedAdmin =
    status === 'authenticated_admin' &&
    Boolean(user && profile && profile.id === user.id && profile.role === 'admin');

  const activeSessionKey = isVerifiedAdmin && user ? `${sessionInstanceId}:${user.id}` : null;

  const activeIsolatedPreview =
    activeSessionKey && isolatedPreview?.sessionKey === activeSessionKey
      ? isolatedPreview.view
      : null;

  switch (status) {
    case 'unconfigured':
      return <UnconfiguredNotice />;

    case 'loading':
      return (
        <div className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
          <div className="flex items-center gap-2.5 mb-4">
            <BrandMark className="w-7 h-7" />
            <span className="text-2xl font-extrabold tracking-tight text-[#17213B] dark:text-white">
              {t('brandName')}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#64748B] dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin text-[#174E50] dark:text-teal-400" />
            <span>{t('restoringSession')}</span>
          </div>
        </div>
      );

    case 'unauthenticated':
      return <AuthPage />;

    case 'signing_out':
      return (
        <div
          data-testid="signing-out-screen"
          className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex flex-col items-center justify-center p-6 font-sans"
        >
          <div className="flex items-center gap-2.5 mb-4">
            <BrandMark className="w-7 h-7" />
            <span className="text-2xl font-extrabold tracking-tight text-[#17213B] dark:text-white">
              {t('brandName')}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#64748B] dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin text-[#174E50] dark:text-teal-400" />
            <span>{t('signingOutSafely')}</span>
          </div>
        </div>
      );

    case 'signout_error':
      return (
        <div
          data-testid="signout-error-screen"
          className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex flex-col items-center justify-center p-6 font-sans relative"
        >
          <div className="absolute top-5 end-5">
            <DisplayControls variant="surface" />
          </div>
          <div className="max-w-md w-full bg-white dark:bg-[#131E2B] border border-rose-200 dark:border-rose-700/60 rounded-2xl p-8 text-center shadow-lg space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-700/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#17213B] dark:text-white">
                {t('signOutFailedTitle')}
              </h2>
              <p className="text-xs text-[#64748B] dark:text-slate-300 mt-2 leading-relaxed">
                {error || t('signOutFailedFallback')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white flex items-center justify-center gap-2 transition shadow-sm cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <LogOut className="w-4 h-4" />
              <span>{t('retrySignOut')}</span>
            </button>
          </div>
        </div>
      );

    case 'missing_profile':
    case 'profile_error':
    case 'unknown_role':
      return <AccessDenied />;

    case 'recovery_verifying':
    case 'password_recovery':
    case 'recovery_invalid':
    case 'recovery_signout_error':
      return (
        <PasswordRecoveryPage
          key={status === 'password_recovery' ? `recovery-${sessionInstanceId}` : 'recovery-gate'}
        />
      );

    case 'authenticated_teacher':
      if (!user || !profile || profile.id !== user.id || profile.role !== 'teacher') {
        return <AccessDenied />;
      }
      return <TeacherPortal key={user.id} />;

    case 'authenticated_student':
      if (!user || !profile || profile.id !== user.id || profile.role !== 'student') {
        return <AccessDenied />;
      }
      return <StudentPortal key={user.id} />;

    case 'authenticated_parent':
      if (!user || !profile || profile.id !== user.id || profile.role !== 'parent') {
        return <AccessDenied />;
      }
      return <ParentPortal key={user.id} />;

    case 'authenticated_admin': {
      if (!isVerifiedAdmin || !user) {
        return <AccessDenied />;
      }

      if (activeIsolatedPreview === 'teacher') {
        return (
          <div className="relative">
            <div className="bg-amber-500 text-black px-4 py-1.5 text-xs font-bold flex items-center justify-between sticky top-0 z-50 shadow-sm">
              <span>{t('previewAdminGradesBanner')}</span>
              <button
                onClick={() => setIsolatedPreview(null)}
                className="flex items-center gap-1 underline text-xs font-bold cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" /> {t('returnToAdminPortal')}
              </button>
            </div>
            <TeacherDashboard onSwitchToAdmin={() => setIsolatedPreview(null)} />
          </div>
        );
      }

      if (activeIsolatedPreview === 'parent') {
        return (
          <div className="relative">
            <div className="bg-amber-500 text-black px-4 py-1.5 text-xs font-bold flex items-center justify-between sticky top-0 z-50 shadow-sm">
              <span>{t('previewParentBanner')}</span>
              <button
                onClick={() => setIsolatedPreview(null)}
                className="flex items-center gap-1 underline text-xs font-bold cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" /> {t('returnToAdminPortal')}
              </button>
            </div>
            <ParentDashboard />
          </div>
        );
      }

      if (activeIsolatedPreview === 'qr') {
        return (
          <div className="relative">
            <div className="bg-amber-500 text-black px-4 py-1.5 text-xs font-bold flex items-center justify-between sticky top-0 z-50 shadow-sm print:hidden">
              <span>{t('previewQrBanner')}</span>
              <button
                onClick={() => setIsolatedPreview(null)}
                className="flex items-center gap-1 underline text-xs font-bold cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" /> {t('returnToAdminPortal')}
              </button>
            </div>
            <StudentCardsPrintPage onBack={() => setIsolatedPreview(null)} />
          </div>
        );
      }

      return (
        <div className={`relative min-h-screen ${import.meta.env.DEV ? 'md:pb-16' : ''}`}>
          <AdminDashboard
            key={activeSessionKey || user.id}
            onSwitchToTeacher={() =>
              activeSessionKey && setIsolatedPreview({ sessionKey: activeSessionKey, view: 'teacher' })
            }
            onOpenStudentCards={() =>
              activeSessionKey && setIsolatedPreview({ sessionKey: activeSessionKey, view: 'qr' })
            }
          />

          {/* Dev preview drawer strictly scoped to verified admin sessions */}
          {import.meta.env.DEV && (
            <div className="fixed bottom-3 end-3 z-40 hidden md:flex items-center gap-2 bg-white/95 dark:bg-[#131E2B]/95 border border-[#E6E8E2] dark:border-slate-700 px-3 py-1.5 rounded-full text-[10px] text-[#64748B] dark:text-slate-300 backdrop-blur-md shadow-md">
              <Eye className="w-3 h-3 text-[#174E50] dark:text-teal-300" />
              <span className="font-semibold text-[#17213B] dark:text-slate-100">
                {t('previewTeammateUis')}
              </span>
              <button
                onClick={() =>
                  activeSessionKey && setIsolatedPreview({ sessionKey: activeSessionKey, view: 'parent' })
                }
                className="hover:text-[#174E50] dark:hover:text-white underline cursor-pointer"
              >
                {t('previewParentLink')}
              </button>
              <span>•</span>
              <button
                onClick={() =>
                  activeSessionKey && setIsolatedPreview({ sessionKey: activeSessionKey, view: 'qr' })
                }
                className="hover:text-[#174E50] dark:hover:text-white underline cursor-pointer"
              >
                {t('previewQrCardsLink')}
              </button>
            </div>
          )}
        </div>
      );
    }

    default:
      return <AccessDenied />;
  }
}

export function App() {
  return (
    <PreferencesProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </PreferencesProvider>
  );
}

export default App;
