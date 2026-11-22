import React from 'react';
import { ShieldAlert, LogOut, UserX, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const AccessDenied: React.FC = () => {
  const { user, profile, role, status, error, signOut, refreshProfile, loading } = useAuth();

  const isMissingProfile = status === 'missing_profile';
  const isProfileError = status === 'profile_error';
  const isUnknownRole = status === 'unknown_role';

  return (
    <div className="min-h-screen bg-[#0B1024] text-white flex items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-rose-600/10 blur-[130px] pointer-events-none" />

      <div className="max-w-md w-full bg-[#171638]/90 border border-rose-500/30 rounded-3xl p-8 text-center shadow-2xl relative z-10">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-5">
          {isProfileError ? (
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          ) : isMissingProfile ? (
            <UserX className="w-8 h-8" />
          ) : (
            <ShieldAlert className="w-8 h-8" />
          )}
        </div>

        <h2 className="text-2xl font-black text-white tracking-tight mb-2">
          {isProfileError
            ? 'Profile Verification Error'
            : isMissingProfile
            ? 'Profile Record Missing'
            : isUnknownRole
            ? 'Unrecognized Account Role'
            : 'Access Restricted'}
        </h2>

        <p className="text-xs text-[#C7B8ED] leading-relaxed mb-6">
          {isProfileError ? (
            <>
              {error || 'Unable to verify your account permissions due to a network or database failure. Protected screens have been locked. Please retry or sign out.'}
            </>
          ) : isMissingProfile ? (
            <>
              Your account (<span className="text-white font-mono">{user?.email}</span>) is authenticated, but no matching record exists in <code className="bg-[#20294A] px-1.5 py-0.5 rounded text-[#70C9DC]">public.profiles</code>. Please ask an administrator to assign your profile record.
            </>
          ) : isUnknownRole ? (
            <>
              {error || (
                <>
                  Your account (<span className="text-white font-semibold">{profile?.full_name || user?.email}</span>) has an unrecognized role <span className="uppercase font-bold text-[#E5C47A] bg-[#20294A] px-2 py-0.5 rounded text-[11px]">{role || 'unknown'}</span>. Please ask an administrator to assign a supported role.
                </>
              )}
            </>
          ) : (
            <>
              {error || (
                <>
                  You are signed in as <span className="text-white font-semibold">{profile?.full_name || user?.email}</span>, but access could not be granted for role <span className="uppercase font-bold text-[#E5C47A] bg-[#20294A] px-2 py-0.5 rounded text-[11px]">{role || 'none'}</span>.
                </>
              )}
            </>
          )}
        </p>

        <div className="p-3.5 rounded-2xl bg-[#20294A]/60 border border-[#48547B]/40 text-left text-xs text-[#7B8794] space-y-1 mb-6">
          <div className="flex justify-between">
            <span>User ID:</span>
            <span className="font-mono text-slate-300 text-[11px] truncate max-w-[200px]">{user?.id}</span>
          </div>
          <div className="flex justify-between">
            <span>Email:</span>
            <span className="text-slate-300">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span>Assigned Role:</span>
            <span className="text-[#E5C47A] font-semibold">{role || 'None'}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => refreshProfile()}
            disabled={loading}
            className="flex-1 py-3 px-4 rounded-xl border border-[#48547B] bg-[#20294A]/60 hover:bg-[#20294A] text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recheck Access</span>
          </button>

          <button
            onClick={() => signOut()}
            className="flex-1 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white flex items-center justify-center gap-2 transition shadow-lg shadow-rose-900/30"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccessDenied;
