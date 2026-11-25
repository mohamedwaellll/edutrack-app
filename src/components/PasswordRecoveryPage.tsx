import React, { useRef, useState } from 'react';
import {
  Lock,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  LogOut,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';

export const PasswordRecoveryPage: React.FC = () => {
  const {
    status,
    user,
    session,
    loading,
    error,
    updateRecoveryPassword,
    completeRecoverySignOut,
    exitRecoveryToAuth,
  } = useAuth();
  const { t } = usePreferences();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const hasVerifiedRecoverySession =
    status === 'password_recovery' && Boolean(user && session && user.id);

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || loading || submittingRef.current || !hasVerifiedRecoverySession) {
      return;
    }

    setLocalError(null);

    if (!newPassword) {
      setLocalError(t('errEnterNewPassword'));
      return;
    }
    if (newPassword.length < 6) {
      setLocalError(t('errPasswordLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError(t('errPasswordMismatch'));
      return;
    }

    if (!updateRecoveryPassword) {
      setLocalError(t('errPasswordHandlerUnavailable'));
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await updateRecoveryPassword(newPassword);
      if (!result.success && result.error) {
        setLocalError(result.error);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleRetrySignOut = async () => {
    if (submitting || loading || submittingRef.current || !completeRecoverySignOut) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await completeRecoverySignOut();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex flex-col justify-between font-sans">
      <header className="bg-white/95 dark:bg-[#0E1621]/95 border-b border-[#E6E8E2] dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BrandMark className="w-7 h-7" />
            <span className="text-xl font-extrabold tracking-tight text-[#17213B] dark:text-white">
              {t('brandName')}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-[#174E50] dark:text-teal-300 bg-[#D8E8DC]/60 dark:bg-teal-950/60 border border-[#A8BDA6]/40 dark:border-teal-800/60 px-3.5 py-1.5 rounded-full">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t('recoveryBadge')}</span>
            </div>
            <DisplayControls variant="navbar" />
          </div>
        </div>
      </header>

      <main className="max-w-md w-full mx-auto px-4 sm:px-6 py-10 my-auto">
        {status === 'recovery_verifying' ? (
          <div
            data-testid="recovery-verifying-screen"
            className="bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 rounded-2xl p-8 text-center shadow-lg space-y-5"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#D8E8DC]/70 dark:bg-teal-950/70 border border-[#A8BDA6]/40 dark:border-teal-800 text-[#174E50] dark:text-teal-300 flex items-center justify-center mx-auto">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-[#17213B] dark:text-white">
                {t('recoveryVerifyingTitle')}
              </h2>
              <p className="text-xs text-[#64748B] dark:text-slate-400 leading-relaxed">
                {t('recoveryVerifyingBody')}
              </p>
            </div>
          </div>
        ) : status === 'recovery_signout_error' ? (
          <div
            data-testid="recovery-signout-error-screen"
            className="bg-white dark:bg-[#131E2B] border border-rose-200 dark:border-rose-700/60 rounded-2xl p-8 text-center shadow-lg space-y-5"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-700/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-[#17213B] dark:text-white">
                {t('recoverySignoutTitle')}
              </h2>
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                {t('recoverySignoutSuccess')}
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
                {error || t('recoverySignoutFallbackErr')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRetrySignOut}
              disabled={submitting || loading}
              className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white flex items-center justify-center gap-2 transition shadow-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <LogOut className="w-4 h-4" />
              <span>{t('retrySignOut')}</span>
            </button>
          </div>
        ) : status === 'recovery_invalid' || !hasVerifiedRecoverySession ? (
          <div
            data-testid="recovery-invalid-screen"
            className="bg-white dark:bg-[#131E2B] border border-amber-200 dark:border-amber-700/60 rounded-2xl p-8 text-center shadow-lg space-y-5"
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-700/60 text-amber-700 dark:text-amber-300 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-[#17213B] dark:text-white">
                {t('recoveryInvalidTitle')}
              </h2>
              <p className="text-xs text-[#64748B] dark:text-slate-400 leading-relaxed">
                {error || t('recoveryInvalidFallback')}
              </p>
            </div>
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => exitRecoveryToAuth?.('forgot_password')}
                className="w-full py-3 px-4 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
              >
                <span>{t('requestNewResetLink')}</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => exitRecoveryToAuth?.('sign_in')}
                className="w-full py-2.5 px-4 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 hover:bg-[#E6E8E2]/40 dark:hover:bg-slate-800 text-xs font-semibold text-[#26334A] dark:text-slate-200 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
                <span>{t('backToSignIn')}</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            data-testid="password-recovery-form-card"
            className="bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-lg"
          >
            <div className="mb-6">
              <h2 className="text-2xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
                {t('recoverySetTitle')}
              </h2>
              <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1.5 leading-relaxed">
                {t('recoverySetSubtitle')}
                {user?.email ? t('recoverySetForEmail', { email: user.email }) : ''}
                {t('recoverySetInstruction')}
              </p>
            </div>

            {(localError || error) && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/50 dark:border-rose-700/50 dark:text-rose-200 text-xs flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <span className="leading-relaxed">{localError || error}</span>
              </div>
            )}

            <form onSubmit={handleUpdateSubmit} noValidate className="space-y-4">
              <div>
                <label
                  className="block text-xs font-bold text-[#26334A] dark:text-slate-200 mb-1.5"
                  htmlFor="newPasswordInput"
                >
                  {t('newPasswordLabel')}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute start-3.5 top-3.5 text-[#7B8794] dark:text-slate-400" />
                  <input
                    id="newPasswordInput"
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder={t('newPasswordPlaceholder')}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={submitting || loading}
                    className="w-full ps-10 pe-4 py-3 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white placeholder-[#9AA39C] dark:placeholder-slate-500 text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 focus:ring-1 focus:ring-[#174E50] dark:focus:ring-teal-400 transition"
                  />
                </div>
              </div>

              <div>
                <label
                  className="block text-xs font-bold text-[#26334A] dark:text-slate-200 mb-1.5"
                  htmlFor="confirmPasswordInput"
                >
                  {t('confirmNewPasswordLabel')}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute start-3.5 top-3.5 text-[#7B8794] dark:text-slate-400" />
                  <input
                    id="confirmPasswordInput"
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder={t('confirmNewPasswordPlaceholder')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={submitting || loading}
                    className="w-full ps-10 pe-4 py-3 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white placeholder-[#9AA39C] dark:placeholder-slate-500 text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 focus:ring-1 focus:ring-[#174E50] dark:focus:ring-teal-400 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                data-testid="update-password-submit"
                disabled={submitting || loading}
                className="w-full mt-2 py-3.5 px-4 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('updatingPassword')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('updatePassword')}</span>
                    <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-[#E6E8E2] dark:border-slate-800">
              <button
                type="button"
                onClick={() => exitRecoveryToAuth?.('sign_in')}
                disabled={submitting || loading}
                className="w-full py-2 text-xs font-medium text-[#64748B] hover:text-[#174E50] dark:text-slate-300 dark:hover:text-teal-300 flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
                <span>{t('cancelAndBackToSignIn')}</span>
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#0E1621] py-5 px-4 text-center text-xs text-[#64748B] dark:text-slate-400">
        {t('recoveryFooterText')}
      </footer>
    </div>
  );
};

export default PasswordRecoveryPage;
