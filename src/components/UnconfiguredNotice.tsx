import React from 'react';
import { Database, AlertTriangle, Key, ExternalLink, Terminal, Copy, Check } from 'lucide-react';
import { getSupabaseConfigStatus } from '../lib/supabaseClient';

export const UnconfiguredNotice: React.FC = () => {
  const status = getSupabaseConfigStatus();
  const [copied, setCopied] = React.useState(false);

  const envSample = `# EduTrack Supabase Credentials
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`;

  const copyEnv = () => {
    navigator.clipboard.writeText(envSample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-[#26334A] flex items-center justify-center p-6 font-sans">
      <div className="max-w-2xl w-full bg-white border border-[#E6E8E2] rounded-3xl p-8 sm:p-10 shadow-lg space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#17213B] tracking-tight">Supabase Setup Required</h1>
            <p className="text-xs text-[#7B8794] mt-0.5">{status.message}</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-200/60 text-xs text-amber-900 space-y-2">
          <p className="font-semibold">EduTrack is running in live authentication & persistence mode.</p>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            In accordance with system security requirements, mock fallbacks and simulated writes are disabled. The application requires a configured Supabase project with real database authorization.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-bold text-[#17213B] uppercase tracking-wider">Quick Setup Steps:</h2>
          <ol className="list-decimal list-inside text-xs text-[#26334A] space-y-2 leading-relaxed">
            <li>
              Create a project at <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-[#174E50] font-semibold underline inline-flex items-center gap-1">supabase.com <ExternalLink className="w-3 h-3" /></a>.
            </li>
            <li>
              In the Supabase dashboard, open <strong>SQL Editor</strong> and run the schema migration:
              <br />
              <code className="text-[11px] font-mono bg-[#F8F7F2] px-2 py-0.5 rounded border border-[#E6E8E2] text-[#174E50] mt-1 inline-block">
                supabase/migrations/20261103_edutrack_schema.sql
              </code>
            </li>
            <li>
              Go to <strong>Project Settings &gt; API</strong> and copy your <strong>Project URL</strong> and <strong>anon public API key</strong>.
            </li>
            <li>
              Create a <code className="font-mono bg-[#F8F7F2] px-1 py-0.5 rounded border border-[#E6E8E2]">.env</code> file in <code className="font-mono text-[11px]">edutrack-portal/</code> with your credentials:
            </li>
          </ol>
        </div>

        <div className="relative rounded-2xl bg-[#0B1024] p-4 font-mono text-xs text-emerald-400">
          <button
            onClick={copyEnv}
            className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-[#20294A] hover:bg-[#35425F] text-white text-[11px] flex items-center gap-1.5 transition"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy Template'}</span>
          </button>
          <pre className="text-[11px] leading-relaxed whitespace-pre overflow-x-auto pr-20">{envSample}</pre>
        </div>

        <div className="pt-2 border-t border-[#E6E8E2] flex items-center justify-between text-xs text-[#7B8794]">
          <span>After creating .env, restart the dev server: <code className="font-mono font-semibold text-[#17213B]">npm run dev</code></span>
        </div>
      </div>
    </div>
  );
};

export default UnconfiguredNotice;
