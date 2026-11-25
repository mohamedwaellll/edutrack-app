import { createContext, useContext } from 'react';
import {
  Language,
  TranslationKey,
  translate,
  translations,
} from '../i18n/translations';

export type ThemeMode = 'light' | 'dark';

export const LANGUAGE_STORAGE_KEY = 'edutrack:language';
export const THEME_STORAGE_KEY = 'edutrack:theme';

export interface PreferencesContextValue {
  language: Language;
  isRtl: boolean;
  theme: ThemeMode;
  isDark: boolean;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

export function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    if (typeof window.localStorage?.getItem !== 'function') return 'en';
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return raw === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    if (typeof window.localStorage?.getItem !== 'function') return 'light';
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function persistPreference(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof window.localStorage?.setItem !== 'function') return;
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in restricted contexts
  }
}

const DEFAULT_PREFERENCES: PreferencesContextValue = {
  language: 'en',
  isRtl: false,
  theme: 'light',
  isDark: false,
  setLanguage: () => {},
  toggleLanguage: () => {},
  setTheme: () => {},
  toggleTheme: () => {},
  t: (key: TranslationKey, vars?: Record<string, string | number>) =>
    translate('en', key, vars),
};

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    return DEFAULT_PREFERENCES;
  }
  return ctx;
}

export { translations };
