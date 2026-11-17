import React, { useState } from 'react';
import { Sparkles, Lock, Mail, AlertCircle, Loader2, Rocket, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const AuthPage: React.FC = () => {
  const { signIn, loading, error: authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setLocalError('Please enter your email address.');
      return;
    }
    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    const result = await signIn(trimmedEmail, password);
    setSubmitting(false);

    if (!result.success) {
      setLocalError(result.error || 'Failed to authenticate');
    }
  };

  const activeError = localError || authError;

  return (
    <div className="min-h-screen bg-[#0B1024] text-white flex flex-col justify-between relative overflow-hidden font-sans selection:bg-[#547FE8] selection:text-white">
      {/* Cosmic background circles & ambient lighting */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-[#553B8F]/30 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-5%] w-[700px] h-[700px] rounded-full bg-[#547FE8]/20 blur-[150px] pointer-events-none" />
      <div className="absolute top-[40%] right-[20%] w-[400px] h-[400px] rounded-full bg-[#70C9DC]/10 blur-[100px] pointer-events-none" />

      {/* Top Header / Logo */}
      <header className="p-6 md:p-10 z-10 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5 text-[#70C9DC]">
          <Sparkles className="w-6 h-6 fill-current text-[#70C9DC]" />
          <span className="text-2xl font-black tracking-tight text-white">EduTrack</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-[#C7B8ED] bg-[#171638]/70 border border-[#8562C5]/30 px-3.5 py-1.5 rounded-full backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-[#70C9DC] animate-pulse"></span>
          <span>Admin Authentication Portal</span>
        </div>
      </header>

      {/* Main Content: Split layout matching design mockup (UI-UX/01_Login.png) */}
      <main className="z-10 max-w-7xl mx-auto w-full px-6 md:px-10 py-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center my-auto">
        {/* Left Hero side */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#553B8F]/50 border border-[#8562C5]/40 text-[#C7B8ED]">
            <Rocket className="w-3.5 h-3.5 text-[#70C9DC]" />
            <span>Center & School Administration System</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-tight tracking-tight">
            A universe of <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#8562C5] via-[#547FE8] to-[#70C9DC]">
              possibilities.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-[#C7B8ED]/90 max-w-xl leading-relaxed">
            Manage groups, enroll students, coordinate schedules, and sync academic performance in real time with Supabase.
          </p>

          <div className="pt-2 flex flex-wrap gap-4 text-xs text-[#7B8794]">
            <div className="flex items-center gap-2 bg-[#171638]/60 border border-[#48547B]/40 px-3.5 py-2 rounded-xl text-slate-300">
              <span className="text-[#70C9DC] font-bold">✓</span> Database-enforced RLS
            </div>
            <div className="flex items-center gap-2 bg-[#171638]/60 border border-[#48547B]/40 px-3.5 py-2 rounded-xl text-slate-300">
              <span className="text-[#70C9DC] font-bold">✓</span> Direct group assignment
            </div>
            <div className="flex items-center gap-2 bg-[#171638]/60 border border-[#48547B]/40 px-3.5 py-2 rounded-xl text-slate-300">
              <span className="text-[#70C9DC] font-bold">✓</span> Realtime persistence
            </div>
          </div>
        </div>

        {/* Right Form side */}
        <div className="lg:col-span-5 w-full">
          <div className="bg-[#171638]/80 border border-[#48547B]/60 rounded-3xl p-7 sm:p-9 shadow-2xl backdrop-blur-xl relative">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white tracking-tight">Welcome back</h2>
              <p className="text-xs text-[#C7B8ED] mt-1">Sign in with your administrator credentials</p>
            </div>

            {/* Error banner */}
            {activeError && (
              <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span className="leading-relaxed">{activeError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#C7B8ED] mb-1.5" htmlFor="emailInput">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-[#7B8794]" />
                  <input
                    id="emailInput"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="admin@edutrack.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting || loading}
                    className="w-full pl-10 pr-4 py-3 rounded-2xl bg-[#20294A]/70 border border-[#48547B]/60 text-white placeholder-[#7B8794] text-xs focus:outline-none focus:border-[#547FE8] focus:ring-1 focus:ring-[#547FE8] transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#C7B8ED] mb-1.5" htmlFor="passwordInput">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-[#7B8794]" />
                  <input
                    id="passwordInput"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting || loading}
                    className="w-full pl-10 pr-4 py-3 rounded-2xl bg-[#20294A]/70 border border-[#48547B]/60 text-white placeholder-[#7B8794] text-xs focus:outline-none focus:border-[#547FE8] focus:ring-1 focus:ring-[#547FE8] transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || loading}
                className="w-full mt-2 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#547FE8] to-[#8562C5] hover:from-[#547FE8]/90 hover:to-[#8562C5]/90 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#547FE8]/25 transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to Admin Portal</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-[#48547B]/40 text-center text-[11px] text-[#7B8794]">
              <span>Admin access only. User roles are validated through Supabase profiles.</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 md:p-8 z-10 max-w-7xl mx-auto w-full text-center text-xs text-[#7B8794]">
        EduTrack Cosmic Learning Platform • Authenticated Admin Flow
      </footer>
    </div>
  );
};

export default AuthPage;
