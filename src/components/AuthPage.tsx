import React, { useRef, useState } from 'react';
import {
  Lock,
  Mail,
  AlertCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Info,
  QrCode,
  ShieldCheck,
  Clock,
  Users,
  BookOpen,
  ClipboardCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import type { TranslationKey } from '../i18n/translations';
import { BrandMark } from './BrandMark';
import { DisplayControls } from './DisplayControls';
import centerHeroImg from '../assets/center-hero.jpg';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthFeedback = { key: TranslationKey } | { raw: string } | null;

export const AuthPage: React.FC = () => {
  const {
    signIn,
    requestPasswordReset,
    clearAuthFeedback,
    authNotice,
    authInitialView = 'sign_in',
    isLocalDemoMode = false,
    loading,
    error: authError,
  } = useAuth();
  const { t, language } = usePreferences();

  const [view, setView] = useState<'sign_in' | 'forgot_password'>(() => authInitialView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<AuthFeedback>(null);
  const [submitting, setSubmitting] = useState(false);

  const [resetSuccessMessage, setResetSuccessMessage] = useState<AuthFeedback>(null);
  const [resetError, setResetError] = useState<AuthFeedback>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const resetInFlightRef = useRef(false);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const resetEmailInputRef = useRef<HTMLInputElement | null>(null);

  const localizeAuthError = (rawError: string | null): string | null => {
    if (!rawError || language !== 'ar') return rawError;
    const normalized = rawError.trim().toLowerCase();
    if (normalized === 'invalid login credentials') {
      return t('errInvalidCredentials');
    }
    if (
      normalized.includes('pglite') ||
      normalized.includes('password reset is not supported in local') ||
      normalized.includes('local demo bridge')
    ) {
      return t('errLocalDemoResetUnavailable');
    }
    if (normalized === 'failed to authenticate') {
      return t('errFailedAuth');
    }
    if (normalized.includes('failed to fetch') || normalized.includes('networkerror')) {
      return t('errNetworkFetch');
    }
    return rawError;
  };

  const resolveFeedback = (feedback: AuthFeedback): string | null => {
    if (!feedback) return null;
    if ('key' in feedback) return t(feedback.key);
    return localizeAuthError(feedback.raw);
  };

  const focusAuthCard = () => {
    const target = view === 'forgot_password' ? resetEmailInputRef.current : emailInputRef.current;
    if (target) {
      target.focus();
      target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleOpenForgotPassword = () => {
    setLocalError(null);
    setResetError(null);
    setResetSuccessMessage(null);
    clearAuthFeedback?.();
    setView('forgot_password');
  };

  const handleBackToSignIn = () => {
    setResetError(null);
    setResetSuccessMessage(null);
    setLocalError(null);
    clearAuthFeedback?.();
    setView('sign_in');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setLocalError({ key: 'errEnterEmail' });
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setLocalError({ key: 'errInvalidEmail' });
      return;
    }
    if (!password) {
      setLocalError({ key: 'errEnterPassword' });
      return;
    }

    setSubmitting(true);
    const result = await signIn(trimmedEmail, password);
    setSubmitting(false);

    if (!result.success) {
      setLocalError(result.error ? { raw: result.error } : { key: 'errFailedAuth' });
    }
  };

  const handleRequestResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetSubmitting || resetInFlightRef.current || loading) {
      return;
    }

    setResetError(null);
    setResetSuccessMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setResetError({ key: 'errEnterEmail' });
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setResetError({ key: 'errInvalidEmail' });
      return;
    }

    if (!requestPasswordReset) {
      setResetError({ key: 'resetServiceUnavailable' });
      return;
    }

    resetInFlightRef.current = true;
    setResetSubmitting(true);
    try {
      const result = await requestPasswordReset(trimmedEmail);
      if (result.success) {
        setResetSuccessMessage({ key: 'resetGenericSuccess' });
      } else {
        setResetError(result.error ? { raw: result.error } : { key: 'resetGenericError' });
      }
    } finally {
      resetInFlightRef.current = false;
      setResetSubmitting(false);
    }
  };

  const activeError = resolveFeedback(localError) || localizeAuthError(authError);
  const localizedResetError = resolveFeedback(resetError);
  const localizedResetSuccessMessage = resolveFeedback(resetSuccessMessage);

  const workflowCards = [
    {
      id: 'portals',
      icon: Users,
      title: t('workflowCardAdminTitle'),
      desc: t('workflowCardAdminDesc'),
      accent: 'bg-[#D8E8DC] text-[#174E50] dark:bg-teal-950/70 dark:text-teal-300',
    },
    {
      id: 'attendance-qr',
      icon: QrCode,
      title: t('workflowCardQrTitle'),
      desc: t('workflowCardQrDesc'),
      accent: 'bg-[#E6E1F5] text-[#4C3682] dark:bg-slate-800 dark:text-teal-300',
    },
    {
      id: undefined,
      icon: BookOpen,
      title: t('workflowCardTeacherTitle'),
      desc: t('workflowCardTeacherDesc'),
      accent: 'bg-[#F2EBDD] text-[#8F5212] dark:bg-amber-950/50 dark:text-amber-300',
    },
    {
      id: undefined,
      icon: ClipboardCheck,
      title: t('workflowCardFamilyTitle'),
      desc: t('workflowCardFamilyDesc'),
      accent: 'bg-[#DCF2F7] text-[#174E50] dark:bg-cyan-950/50 dark:text-cyan-300',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F7F2] text-[#26334A] dark:bg-[#0B121B] dark:text-slate-100 font-sans">
      {/* Crisp Top Navigation Bar matching editorial reference layout */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#0E1621]/95 border-b border-[#E6E8E2] dark:border-slate-800 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark className="w-8 h-8 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg sm:text-xl font-extrabold tracking-tight text-[#17213B] dark:text-white truncate">
                  {t('brandName')}
                </span>
                <span className="hidden sm:inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#D8E8DC]/70 text-[#174E50] dark:bg-teal-950/80 dark:text-teal-300">
                  {t('brandTagline')}
                </span>
              </div>
            </div>
          </div>

          <nav
            aria-label="Primary"
            className="hidden lg:flex items-center gap-7 text-xs font-bold text-[#475569] dark:text-slate-300"
          >
            <a
              href="#overview"
              className="text-[#174E50] dark:text-teal-300 hover:opacity-80 transition"
            >
              {t('navOverview')}
            </a>
            <a
              href="#portals"
              className="hover:text-[#174E50] dark:hover:text-teal-300 transition"
            >
              {t('navPortals')}
            </a>
            <a
              href="#attendance-qr"
              className="hover:text-[#174E50] dark:hover:text-teal-300 transition"
            >
              {t('navQrCheckIn')}
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <DisplayControls variant="navbar" />
            <button
              type="button"
              onClick={focusAuthCard}
              className="hidden sm:inline-flex items-center justify-center rounded-full bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white px-4 py-1.5 text-xs font-bold transition shadow-xs cursor-pointer"
            >
              {t('navSignInAction')}
            </button>
          </div>
        </div>
      </header>

      {/* Full-Bleed Darkened Real Center Photography Hero + Immediate Auth Card */}
      <section id="overview" className="relative isolate overflow-hidden bg-[#0E171D]">
        <img
          src={centerHeroImg}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center scale-[1.03] brightness-[0.82]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-[#091217]/90 via-[#0C171E]/80 to-[#081016]/90 dark:from-[#050A0E]/95 dark:via-[#081016]/85 dark:to-[#050A0E]/95"
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 py-12 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Editorial Center Value Side */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/25 bg-black/35 backdrop-blur-sm text-xs font-semibold text-teal-100">
              <span className="w-2 h-2 rounded-full bg-teal-400 shrink-0" />
              <span>{t('heroKicker')}</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[46px] font-extrabold text-white leading-[1.22] tracking-tight max-w-2xl">
              {t('heroTitle')}
            </h1>

            <p className="text-sm sm:text-base text-slate-200/95 max-w-xl leading-relaxed">
              {t('heroSubtitle')}
            </p>

            {/* Reference-inspired dual pill CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={focusAuthCard}
                className="rounded-full bg-[#0F766E] hover:bg-[#0D635C] text-white px-6 py-2.5 text-xs sm:text-sm font-bold shadow-sm transition cursor-pointer"
              >
                {t('heroPrimaryCta')}
              </button>
              <a
                href="#portals"
                className="rounded-full border border-white/60 bg-black/30 hover:bg-white/10 text-white px-6 py-2.5 text-xs sm:text-sm font-bold backdrop-blur-sm transition"
              >
                {t('heroSecondaryCta')}
              </a>
            </div>

            {/* Quiet operational highlights strip */}
            <div className="pt-4 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-100 max-w-2xl">
              <div className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/15 px-3 py-2 backdrop-blur-sm">
                <span className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0 text-teal-300">
                  <QrCode className="w-3.5 h-3.5" />
                </span>
                <span className="font-medium">{t('heroHighlightQr')}</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/15 px-3 py-2 backdrop-blur-sm">
                <span className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0 text-teal-300">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </span>
                <span className="font-medium">{t('heroHighlightRoles')}</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/15 px-3 py-2 backdrop-blur-sm">
                <span className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0 text-teal-300">
                  <Clock className="w-3.5 h-3.5" />
                </span>
                <span className="font-medium">{t('heroHighlightSync')}</span>
              </div>
            </div>
          </div>

          {/* Grounded Tactile Auth Card */}
          <div className="lg:col-span-5 w-full">
            <div className="bg-white dark:bg-[#131E2B] text-[#26334A] dark:text-slate-100 border border-[#E6E8E2] dark:border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl">
              {view === 'forgot_password' ? (
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
                      {t('resetTitle')}
                    </h2>
                    <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1.5 leading-relaxed">
                      {t('resetSubtitle')}
                    </p>
                  </div>

                  {isLocalDemoMode && (
                    <div
                      data-testid="demo-reset-notice"
                      className="mb-5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-950/50 dark:border-amber-700/50 dark:text-amber-200 text-xs flex items-start gap-2.5"
                    >
                      <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <span className="leading-relaxed">{t('demoResetNotice')}</span>
                    </div>
                  )}

                  {localizedResetError && (
                    <div
                      role="alert"
                      className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/50 dark:border-rose-700/50 dark:text-rose-200 text-xs flex items-start gap-2.5"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                      <span className="leading-relaxed">{localizedResetError}</span>
                    </div>
                  )}

                  {localizedResetSuccessMessage && (
                    <div
                      role="status"
                      data-testid="reset-request-sent-banner"
                      className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200 text-xs flex items-start gap-2.5"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                      <span className="leading-relaxed">{localizedResetSuccessMessage}</span>
                    </div>
                  )}

                  <form onSubmit={handleRequestResetSubmit} noValidate className="space-y-4">
                    <div>
                      <label
                        className="block text-xs font-bold text-[#26334A] dark:text-slate-200 mb-1.5"
                        htmlFor="resetEmailInput"
                      >
                        {t('emailLabel')}
                      </label>
                      <div dir="ltr" className="relative">
                        <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-[#7B8794] dark:text-slate-400 pointer-events-none" />
                        <input
                          ref={resetEmailInputRef}
                          id="resetEmailInput"
                          type="email"
                          dir="ltr"
                          autoComplete="email"
                          required
                          placeholder={t('emailPlaceholder')}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={resetSubmitting || loading}
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white placeholder-[#9AA39C] dark:placeholder-slate-500 text-xs text-left focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 focus:ring-1 focus:ring-[#174E50] dark:focus:ring-teal-400 transition"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      data-testid="send-reset-link-button"
                      disabled={resetSubmitting || loading}
                      className="w-full mt-2 py-3.5 px-4 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {resetSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>{t('sendingResetLink')}</span>
                        </>
                      ) : (
                        <>
                          <span>{resetError ? t('retrySendResetLink') : t('sendResetLink')}</span>
                          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                        </>
                      )}
                    </button>
                  </form>

                  <div className="mt-6 pt-5 border-t border-[#E6E8E2] dark:border-slate-800">
                    <button
                      type="button"
                      onClick={handleBackToSignIn}
                      disabled={resetSubmitting}
                      className="w-full py-2 text-xs font-semibold text-[#64748B] hover:text-[#174E50] dark:text-slate-300 dark:hover:text-teal-300 flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
                      <span>{t('backToSignIn')}</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
                      {t('signInWelcomeTitle')}
                    </h2>
                    <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1.5">
                      {t('signInWelcomeSubtitle')}
                    </p>
                  </div>

                  {authNotice && (
                    <div
                      role="status"
                      data-testid="auth-notice-banner"
                      className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-200 text-xs flex items-start gap-2.5"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                      <span className="leading-relaxed">{authNotice}</span>
                    </div>
                  )}

                  {activeError && (
                    <div
                      role="alert"
                      className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/50 dark:border-rose-700/50 dark:text-rose-200 text-xs flex items-start gap-2.5"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                      <span className="leading-relaxed">{activeError}</span>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} noValidate className="space-y-4">
                    <div>
                      <label
                        className="block text-xs font-bold text-[#26334A] dark:text-slate-200 mb-1.5"
                        htmlFor="emailInput"
                      >
                        {t('emailLabel')}
                      </label>
                      <div dir="ltr" className="relative">
                        <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-[#7B8794] dark:text-slate-400 pointer-events-none" />
                        <input
                          ref={emailInputRef}
                          id="emailInput"
                          type="email"
                          dir="ltr"
                          autoComplete="email"
                          required
                          placeholder={t('emailPlaceholder')}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={submitting || loading}
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white placeholder-[#9AA39C] dark:placeholder-slate-500 text-xs text-left focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 focus:ring-1 focus:ring-[#174E50] dark:focus:ring-teal-400 transition"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label
                          className="block text-xs font-bold text-[#26334A] dark:text-slate-200"
                          htmlFor="passwordInput"
                        >
                          {t('passwordLabel')}
                        </label>
                        <button
                          type="button"
                          onClick={handleOpenForgotPassword}
                          disabled={submitting || loading}
                          className="text-[11px] font-bold text-[#174E50] hover:underline dark:text-teal-300 transition disabled:opacity-50 cursor-pointer"
                        >
                          {t('forgotPasswordLink')}
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="w-4 h-4 absolute start-3.5 top-3.5 text-[#7B8794] dark:text-slate-400 pointer-events-none" />
                        <input
                          id="passwordInput"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          required
                          placeholder="••••••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={submitting || loading}
                          className="w-full ps-10 pe-11 py-3 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-white placeholder-[#9AA39C] dark:placeholder-slate-500 text-xs focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 focus:ring-1 focus:ring-[#174E50] dark:focus:ring-teal-400 transition"
                        />
                        <button
                          type="button"
                          data-testid="toggle-password-visibility"
                          aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                          aria-pressed={showPassword}
                          onClick={() => setShowPassword((prev) => !prev)}
                          disabled={submitting || loading}
                          className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#64748B] hover:text-[#17213B] dark:text-slate-400 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#174E50] dark:focus-visible:ring-teal-400 transition disabled:opacity-50 cursor-pointer"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || loading}
                      className="w-full mt-2 py-3.5 px-4 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>{t('signingInButton')}</span>
                        </>
                      ) : (
                        <>
                          <span>{t('signInButton')}</span>
                          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                        </>
                      )}
                    </button>
                  </form>

                  <div className="mt-6 pt-5 border-t border-[#E6E8E2] dark:border-slate-800 text-center text-[11px] text-[#64748B] dark:text-slate-400 leading-relaxed">
                    <span>{t('signInFooterNote')}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Center Workflows Strip */}
      <section className="flex-1 bg-[#F8F7F2] dark:bg-[#0B121B] py-12 px-4 sm:px-8 border-t border-[#E6E8E2] dark:border-slate-800/80">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-extrabold uppercase tracking-wider text-[#174E50] dark:text-teal-300">
              {t('workflowsSectionKicker')}
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
              {t('workflowsSectionTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-[#64748B] dark:text-slate-400 leading-relaxed">
              {t('workflowsSectionDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {workflowCards.map((card) => {
              const Icon = card.icon;
              return (
                <article
                  key={card.title}
                  id={card.id}
                  className="bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 rounded-2xl p-5 space-y-3 shadow-xs"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${card.accent}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-extrabold text-[#17213B] dark:text-white">
                    {card.title}
                  </h3>
                  <p className="text-xs text-[#64748B] dark:text-slate-400 leading-relaxed">
                    {card.desc}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Grounded Footer */}
      <footer className="border-t border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#0E1621] py-5 px-4 text-center text-xs text-[#64748B] dark:text-slate-400">
        {t('loginFooterText')}
      </footer>
    </div>
  );
};

export default AuthPage;
