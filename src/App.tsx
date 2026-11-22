import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthPage } from './components/AuthPage';
import { AccessDenied } from './components/AccessDenied';
import { UnconfiguredNotice } from './components/UnconfiguredNotice';
import { RolePortalLanding } from './components/RolePortalLanding';
import { TeacherPortal } from './components/TeacherPortal';
import { StudentPortal } from './components/StudentPortal';
import { ParentPortal } from './components/ParentPortal';
import TeacherDashboard from './components/TeacherDashboard';
import ParentDashboard from './components/ParentDashboard';
import StudentCardsPrintPage from './components/StudentCardsPrintPage';
import { Loader2, Sparkles, Eye, ArrowLeft, LogOut, AlertTriangle, RefreshCw } from 'lucide-react';

function AppContent() {
  const { status, profile, user, error, signOut } = useAuth();
  // Isolated preview state for admin-only inspection of preserved components
  const [isolatedPreview, setIsolatedPreview] = useState<'teacher' | 'parent' | 'qr' | null>(null);

  const isVerifiedAdmin =
    status === 'authenticated_admin' &&
    Boolean(user && profile && profile.id === user.id && profile.role === 'admin');

  // Immediately drop any active admin preview whenever the session identity or auth status changes
  useEffect(() => {
    setIsolatedPreview(null);
  }, [user?.id, status]);

  switch (status) {
    case 'unconfigured':
      return <UnconfiguredNotice />;

    case 'loading':
      return (
        <div className="min-h-screen bg-[#0B1024] text-white flex flex-col items-center justify-center p-6 font-sans">
          <div className="flex items-center gap-2.5 text-[#70C9DC] mb-4">
            <Sparkles className="w-6 h-6 fill-current text-[#70C9DC]" />
            <span className="text-2xl font-black tracking-tight text-white">EduTrack</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#C7B8ED]">
            <Loader2 className="w-4 h-4 animate-spin text-[#547FE8]" />
            <span>Restoring authenticated session...</span>
          </div>
        </div>
      );

    case 'unauthenticated':
      return <AuthPage />;

    case 'signing_out':
      return (
        <div
          data-testid="signing-out-screen"
          className="min-h-screen bg-[#0B1024] text-white flex flex-col items-center justify-center p-6 font-sans"
        >
          <div className="flex items-center gap-2.5 text-[#70C9DC] mb-4">
            <Sparkles className="w-6 h-6 fill-current text-[#70C9DC]" />
            <span className="text-2xl font-black tracking-tight text-white">EduTrack</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#C7B8ED]">
            <Loader2 className="w-4 h-4 animate-spin text-[#547FE8]" />
            <span>Signing out safely...</span>
          </div>
        </div>
      );

    case 'signout_error':
      return (
        <div
          data-testid="signout-error-screen"
          className="min-h-screen bg-[#0B1024] text-white flex items-center justify-center p-6 font-sans"
        >
          <div className="max-w-md w-full bg-[#171638]/95 border border-rose-500/35 rounded-3xl p-8 text-center shadow-2xl space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Sign Out Failed</h2>
              <p className="text-xs text-[#C7B8ED] mt-2 leading-relaxed">
                {error || 'Unable to confirm session termination with Supabase. Protected screens remain locked.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white flex items-center justify-center gap-2 transition shadow-lg shadow-rose-900/30"
            >
              <RefreshCw className="w-4 h-4" />
              <LogOut className="w-4 h-4" />
              <span>Retry Sign Out</span>
            </button>
          </div>
        </div>
      );

    case 'missing_profile':
    case 'profile_error':
    case 'unknown_role':
      return <AccessDenied />;

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

      if (isolatedPreview === 'teacher') {
        return (
          <div className="relative">
            <div className="bg-amber-500 text-black px-4 py-1.5 text-xs font-bold flex items-center justify-between sticky top-0 z-50 shadow-sm">
              <span>Admin Portal: Grades &amp; Feedback</span>
              <button
                onClick={() => setIsolatedPreview(null)}
                className="flex items-center gap-1 underline text-xs font-bold"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Return to Authenticated Admin Portal
              </button>
            </div>
            <TeacherDashboard onSwitchToAdmin={() => setIsolatedPreview(null)} />
          </div>
        );
      }

      if (isolatedPreview === 'parent') {
        return (
          <div className="relative">
            <div className="bg-amber-500 text-black px-4 py-1.5 text-xs font-bold flex items-center justify-between sticky top-0 z-50 shadow-sm">
              <span>[ISOLATED PREVIEW] Viewing Teammate Component: ParentDashboard</span>
              <button
                onClick={() => setIsolatedPreview(null)}
                className="flex items-center gap-1 underline text-xs font-bold"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Return to Authenticated Admin Portal
              </button>
            </div>
            <ParentDashboard />
          </div>
        );
      }

      if (isolatedPreview === 'qr') {
        return (
          <div className="relative">
            <div className="bg-amber-500 text-black px-4 py-1.5 text-xs font-bold flex items-center justify-between sticky top-0 z-50 shadow-sm print:hidden">
              <span>[ISOLATED PREVIEW] Viewing Teammate Component: StudentCardsPrintPage</span>
              <button
                onClick={() => setIsolatedPreview(null)}
                className="flex items-center gap-1 underline text-xs font-bold"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Return to Authenticated Admin Portal
              </button>
            </div>
            <StudentCardsPrintPage onBack={() => setIsolatedPreview(null)} />
          </div>
        );
      }

      return (
        <div className="relative min-h-screen">
          <AdminDashboard
            key={user.id}
            onSwitchToTeacher={() => setIsolatedPreview('teacher')}
            onOpenStudentCards={() => setIsolatedPreview('qr')}
          />

          {/* Dev preview drawer strictly scoped to verified admin sessions */}
          {import.meta.env.DEV && (
            <div className="fixed bottom-3 left-3 z-40 hidden md:flex items-center gap-2 bg-[#17213B]/90 border border-[#48547B]/50 px-3 py-1.5 rounded-full text-[10px] text-slate-300 backdrop-blur-md">
              <Eye className="w-3 h-3 text-[#A8BDA6]" />
              <span className="font-semibold text-slate-200">Preview Teammate UIs:</span>
              <button
                onClick={() => setIsolatedPreview('parent')}
                className="hover:text-white underline"
              >
                Parent
              </button>
              <span>•</span>
              <button
                onClick={() => setIsolatedPreview('qr')}
                className="hover:text-white underline"
              >
                QR Cards
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
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
