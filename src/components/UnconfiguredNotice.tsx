import React from 'react';
import { AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react';
import { getSupabaseConfigStatus } from '../lib/supabaseClient';
import { usePreferences } from '../contexts/preferencesState';
import { DisplayControls } from './DisplayControls';

export const UnconfiguredNotice: React.FC = () => {
  const status = getSupabaseConfigStatus();
  const [copied, setCopied] = React.useState(false);
  const { t } = usePreferences();

  const envSample = `# EduTrack Supabase Credentials
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`;

  const copyEnv = () => {
    navigator.clipboard.writeText(envSample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] text-[#26334A] dark:text-slate-100 flex items-center justify-center p-6 font-sans relative">
      <div className="absolute top-5 end-5">
        <DisplayControls variant="surface" />
      </div>

      <div className="max-w-2xl w-full bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 rounded-2xl p-8 sm:p-10 shadow-lg space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-700/50 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-[#17213B] dark:text-white tracking-tight">
              {t('unconfiguredTitle')}
            </h1>
            <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-0.5">{status.message}</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-700/40 text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <p className="font-semibold">{t('unconfiguredModeNote')}</p>
          <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
            {t('unconfiguredSecurityDetail')}
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-bold text-[#17213B] dark:text-white uppercase tracking-wider">
            {t('unconfiguredStepsTitle')}
          </h2>
          <ol className="list-decimal list-inside text-xs text-[#26334A] dark:text-slate-300 space-y-2 leading-relaxed">
            <li>
              {t('unconfiguredStep1Prefix')}
              <a
                href="https://supabase.com"
                target="_blank"
                rel="noreferrer"
                className="text-[#174E50] dark:text-teal-300 font-semibold underline inline-flex items-center gap-1"
              >
                supabase.com <ExternalLink className="w-3 h-3" />
              </a>
              .
            </li>
            <li>
              {t('unconfiguredStep2Prefix')}
              <strong>{t('unconfiguredStep2Strong')}</strong>
              {t('unconfiguredStep2Mid')}
              <br />
              <code
                dir="ltr"
                className="text-[11px] font-mono bg-[#F8F7F2] dark:bg-slate-800 px-2 py-0.5 rounded border border-[#E6E8E2] dark:border-slate-700 text-[#174E50] dark:text-teal-300 mt-1 inline-block"
              >
                supabase/migrations/20261103_edutrack_schema.sql
              </code>
            </li>
            <li>{t('unconfiguredStep3')}</li>
            <li>
              {t('unconfiguredStep4Prefix')}
              <code className="font-mono bg-[#F8F7F2] dark:bg-slate-800 px-1 py-0.5 rounded border border-[#E6E8E2] dark:border-slate-700">
                .env
              </code>
              {t('unconfiguredStep4Mid')}
              <code className="font-mono text-[11px]">edutrack-portal/</code>
              {t('unconfiguredStep4Suffix')}
            </li>
          </ol>
        </div>

        <div dir="ltr" className="relative rounded-2xl bg-[#0E171D] p-4 font-mono text-xs text-emerald-400">
          <button
            onClick={copyEnv}
            className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] flex items-center gap-1.5 transition cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? t('copied') : t('copyTemplate')}</span>
          </button>
          <pre className="text-[11px] leading-relaxed whitespace-pre overflow-x-auto pr-20">{envSample}</pre>
        </div>

        <div className="pt-2 border-t border-[#E6E8E2] dark:border-slate-800 flex items-center justify-between text-xs text-[#7B8794] dark:text-slate-400">
          <span>
            {t('unconfiguredRestartNote')}{' '}
            <code className="font-mono font-semibold text-[#17213B] dark:text-white">npm run dev</code>
          </span>
        </div>
      </div>
    </div>
  );
};

export default UnconfiguredNotice;
