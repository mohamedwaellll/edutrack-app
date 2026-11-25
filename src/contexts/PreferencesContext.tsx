import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Language, TranslationKey, translate } from '../i18n/translations';
import {
  LANGUAGE_STORAGE_KEY,
  PreferencesContext,
  PreferencesContextValue,
  THEME_STORAGE_KEY,
  ThemeMode,
  persistPreference,
  readStoredLanguage,
  readStoredTheme,
} from './preferencesState';

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);

  const isRtl = language === 'ar';
  const isDark = theme === 'dark';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.lang = language;
    root.dir = isRtl ? 'rtl' : 'ltr';
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    document.title = translate(language, 'appTitle');
  }, [language, isRtl, isDark]);

  const setLanguage = useCallback((nextLang: Language) => {
    persistPreference(LANGUAGE_STORAGE_KEY, nextLang);
    setLanguageState(nextLang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next: Language = prev === 'en' ? 'ar' : 'en';
      persistPreference(LANGUAGE_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    persistPreference(THEME_STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      persistPreference(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(language, key, vars),
    [language]
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      language,
      isRtl,
      theme,
      isDark,
      setLanguage,
      toggleLanguage,
      setTheme,
      toggleTheme,
      t,
    }),
    [language, isRtl, theme, isDark, setLanguage, toggleLanguage, setTheme, toggleTheme, t]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};
