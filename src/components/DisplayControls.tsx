import React from 'react';
import { Languages, Moon, Sun } from 'lucide-react';
import { usePreferences } from '../contexts/preferencesState';

interface DisplayControlsProps {
  variant?: 'navbar' | 'surface' | 'compact';
  className?: string;
}

export const DisplayControls: React.FC<DisplayControlsProps> = ({
  variant = 'surface',
  className = '',
}) => {
  const { isDark, toggleLanguage, toggleTheme, t } = usePreferences();

  const btnBase =
    variant === 'navbar'
      ? 'inline-flex items-center gap-1.5 rounded-full border border-[#174E50]/25 bg-white px-3.5 py-1.5 text-xs font-bold text-[#174E50] hover:bg-[#D8E8DC]/45 dark:border-slate-600 dark:bg-slate-800/90 dark:text-teal-200 dark:hover:bg-slate-700 transition cursor-pointer'
      : variant === 'compact'
      ? 'inline-flex items-center gap-1 rounded-full border border-[#E6E8E2] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#26334A] hover:border-[#174E50]/40 hover:text-[#174E50] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-teal-500/60 dark:hover:text-teal-200 transition cursor-pointer'
      : 'inline-flex items-center gap-1.5 rounded-full border border-[#E6E8E2] bg-white px-3.5 py-2 text-xs font-bold text-[#26334A] hover:border-[#174E50]/40 hover:bg-[#F8F7F2] dark:border-slate-700 dark:bg-[#131E2B] dark:text-slate-100 dark:hover:border-teal-500/60 dark:hover:bg-slate-800 transition shadow-xs cursor-pointer';

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        data-testid="language-toggle"
        onClick={toggleLanguage}
        aria-label={t('langToggleAria')}
        title={t('langToggleAria')}
        className={btnBase}
      >
        <Languages className="w-3.5 h-3.5 text-[#174E50] dark:text-teal-300 shrink-0" />
        <span>{t('langToggleLabel')}</span>
      </button>

      <button
        type="button"
        data-testid="theme-toggle"
        onClick={toggleTheme}
        aria-pressed={isDark}
        aria-label={isDark ? t('themeToLightAria') : t('themeToDarkAria')}
        title={isDark ? t('themeToLightAria') : t('themeToDarkAria')}
        className={btnBase}
      >
        {isDark ? (
          <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        ) : (
          <Moon className="w-3.5 h-3.5 text-[#174E50] shrink-0" />
        )}
        <span>{isDark ? t('themeLightLabel') : t('themeDarkLabel')}</span>
      </button>
    </div>
  );
};
