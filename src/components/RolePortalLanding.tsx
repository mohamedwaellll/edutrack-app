import React from 'react';
import { BookOpen, GraduationCap, Users, LogOut, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export type NonAdminPortalRole = 'teacher' | 'student' | 'parent';

interface RolePortalLandingProps {
  role: NonAdminPortalRole;
}

const ROLE_METADATA: Record<
  NonAdminPortalRole,
  {
    title: string;
    badge: string;
    subtitle: string;
    nextStageNote: string;
    icon: React.ComponentType<{ className?: string }>;
    accentClasses: string;
  }
> = {
  teacher: {
    title: 'Teacher Portal',
    badge: 'Teacher Account',
    subtitle: 'Your verified teacher session is active.',
    nextStageNote: 'Class groups, attendance sheets, and grading tools open in Stage C.',
    icon: BookOpen,
    accentClasses: 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300',
  },
  student: {
    title: 'Student Portal',
    badge: 'Student Account',
    subtitle: 'Your verified student session is active.',
    nextStageNote: 'Personal attendance records, schedule, and grades open in Stage D.',
    icon: GraduationCap,
    accentClasses: 'bg-violet-500/15 border-violet-400/40 text-violet-300',
  },
  parent: {
    title: 'Parent Portal',
    badge: 'Parent Account',
    subtitle: 'Your verified parent session is active.',
    nextStageNote: 'Linked children summaries, attendance, and grade reports open in Stage E.',
    icon: Users,
    accentClasses: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300',
  },
};

export const RolePortalLanding: React.FC<RolePortalLandingProps> = ({ role }) => {
  const { profile, user, signOut } = useAuth();
  const meta = ROLE_METADATA[role];
  const RoleIcon = meta.icon;
  const displayName = profile?.full_name || user?.email || 'Authenticated User';

  return (
    <div
      data-testid={`role-portal-${role}`}
      className="min-h-screen bg-[#0D1322] text-[#E6E6F2] flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-[#161F36]/90 border border-[#324066] p-8 shadow-2xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center ${meta.accentClasses}`}>
              <RoleIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>EduTrack Portal</span>
              </div>
              <h1 className="text-xl font-bold text-white mt-0.5">{meta.title}</h1>
            </div>
          </div>

          <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${meta.accentClasses}`}>
            {meta.badge}
          </span>
        </div>

        <p className="text-sm text-[#C7B8ED]">{meta.subtitle}</p>

        <div className="rounded-xl bg-[#0D1322]/70 border border-[#2C395D] p-4 space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Name</span>
            <span className="font-semibold text-white text-right" data-testid="portal-user-name">
              {displayName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Verified Role</span>
            <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-200" data-testid="portal-user-role">
              {profile?.role || role}
            </span>
          </div>
          {(profile?.email || user?.email) && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Email</span>
              <span className="font-mono text-xs text-slate-200 text-right">{profile?.email || user?.email}</span>
            </div>
          )}
          {user?.id && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Account ID</span>
              <span className="font-mono text-[11px] text-slate-400 text-right">{user.id}</span>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl bg-slate-900/60 border border-slate-700/60 p-3.5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>{meta.nextStageNote}</span>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="w-full py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
};
