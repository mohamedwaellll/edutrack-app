import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthPage } from './components/AuthPage';
import { AccessDenied } from './components/AccessDenied';
import { UnconfiguredNotice } from './components/UnconfiguredNotice';
import TeacherDashboard from './components/TeacherDashboard';
import ParentDashboard from './components/ParentDashboard';
import StudentCardsPrintPage from './components/StudentCardsPrintPage';
import { Loader2, Sparkles, Eye, ArrowLeft } from 'lucide-react';

function AppContent() {
  const { status, profile, user } = useAuth();
  // Isolated preview state for teammate components (strictly decoupled from real auth flow)
  const [isolatedPreview, setIsolatedPreview] = useState<'teacher' | 'parent' | 'qr' | null>(null);

  // 1. Unconfigured Supabase environment
  if (status === 'unconfigured') {
    return <UnconfiguredNotice />;
  }

  // 2. Global loading state while restoring session or fetching profile
  if (status === 'loading') {
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
  }

  // 3. Unauthenticated: Show login page
  if (status === 'unauthenticated') {
    return <AuthPage />;
  }

  // 4. Missing profile, non-admin account, or profile verification error: show clear access state (never admin fallback)
  if (status === 'missing_profile' || status === 'authenticated_non_admin' || status === 'profile_error') {
    return <AccessDenied />;
  }

  // Grades and feedback are a live admin-managed flow; other roles remain gated.
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

  // 7. Authenticated Admin flow
  return (
    <div className="relative min-h-screen">
      <AdminDashboard 
        onSwitchToTeacher={() => setIsolatedPreview('teacher')} 
        onOpenStudentCards={() => setIsolatedPreview('qr')}
      />
      
      {/* Dev preview drawer for preserved teammate components */}
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

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
