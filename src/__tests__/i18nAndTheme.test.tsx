// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Session, Subscription, User } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';
import { LANGUAGE_STORAGE_KEY, THEME_STORAGE_KEY } from '../contexts/preferencesState';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function makeTestSession(id: string, email: string, accessToken: string): Session {
  return {
    user: { id, email } as User,
    access_token: accessToken,
  } as Session;
}

function makeMockSubscription(): Subscription {
  return { unsubscribe: vi.fn() } as unknown as Subscription;
}

function installTestLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  return store;
}

function resetDocumentPreferences() {
  if (typeof window.localStorage?.removeItem === 'function') {
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  }
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  document.documentElement.classList.remove('dark');
}

function mockSupabaseForRole(role: 'admin' | 'teacher' | 'student' | 'parent', fullName: string) {
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: makeTestSession(`u-${role}`, `${role}@edutrack.com`, `tok-${role}`) },
    error: null,
  });

  vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_col: string, uid: string) => ({
            maybeSingle: async () => ({
              data: { id: uid, email: `${role}@edutrack.com`, role, full_name: fullName },
              error: null,
            }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
        gte: () => ({
          lte: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
    };
  }) as unknown as typeof supabase.from);

  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: { linked: false, groups: [], children: [] },
    error: null,
  } as never);
}

describe('Educational Center Login Redesign, Arabic/English i18n (RTL/LTR), and Dark Mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installTestLocalStorage();
    resetDocumentPreferences();
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation(() => ({
      data: { subscription: makeMockSubscription() },
    }));
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null,
    });
  });

  afterEach(() => {
    resetDocumentPreferences();
    vi.restoreAllMocks();
  });

  it('1. Loads redesigned Login in English LTR + Light mode by default with immediate Sign In card', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });

    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(screen.getByLabelText(/Email address/i)).toBeDefined();
    expect(screen.getByLabelText(/^Password$/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Forgot password\?/i })).toBeDefined();
  });

  it('2. Switches seamlessly between Arabic (RTL) and English (LTR) with 1 click and persists preference', async () => {
    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('language-toggle')).toBeDefined();
    });

    // Switch EN -> AR
    fireEvent.click(screen.getByTestId('language-toggle'));

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
    });
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
    expect(screen.getByText('دخول إلى المنصة')).toBeDefined();
    expect(screen.getByText('أهلًا بك في إيديوتراك')).toBeDefined();
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeDefined();
    expect(screen.getByLabelText('كلمة المرور')).toBeDefined();

    // Verify Forgot Password view works cleanly in Arabic too
    fireEvent.click(screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }));
    await waitFor(() => {
      expect(screen.getByText('استعادة كلمة المرور')).toBeDefined();
      expect(screen.getByTestId('send-reset-link-button').textContent).toContain('إرسال رابط الاستعادة');
    });

    // Verify persistence across unmount / remount
    unmount();
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(screen.getByText('دخول إلى المنصة')).toBeDefined();
    });

    // Switch AR -> EN
    fireEvent.click(screen.getByTestId('language-toggle'));
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    });
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
  });

  it('3. Toggles Light / Dark mode with 1 click, updates html.dark class, and persists across remounts', async () => {
    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('theme-toggle')).toBeDefined();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(screen.getByTestId('theme-toggle'));
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    unmount();
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    fireEvent.click(screen.getByTestId('theme-toggle'));
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('4. Propagates Arabic RTL and Dark Mode across Admin, Teacher, Student, and Parent portals', async () => {
    // Admin Dashboard toggle
    mockSupabaseForRole('admin', 'Mohamed Admin');
    const adminView = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Admin dashboard')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('language-toggle'));
    fireEvent.click(screen.getByTestId('theme-toggle'));

    await waitFor(() => {
      expect(screen.getByText('لوحة إدارة السنتر')).toBeDefined();
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
    expect(screen.getAllByText('الطلاب').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ربط الحسابات').length).toBeGreaterThan(0);
    adminView.unmount();

    // Non-admin portals honor persisted Arabic RTL & Dark Mode on mount
    const nonAdminCases: Array<{
      role: 'teacher' | 'student' | 'parent';
      fullName: string;
      expectedArabicHeading: string;
    }> = [
      { role: 'teacher', fullName: 'Tariq Teacher', expectedArabicHeading: 'بوابة المدرس' },
      { role: 'student', fullName: 'Salma Student', expectedArabicHeading: 'بوابة الطالب' },
      { role: 'parent', fullName: 'Nadia Parent', expectedArabicHeading: 'بوابة وليّ الأمر' },
    ];

    for (const tc of nonAdminCases) {
      mockSupabaseForRole(tc.role, tc.fullName);
      const { unmount } = render(<App />);
      await waitFor(() => {
        expect(screen.getByText(tc.expectedArabicHeading)).toBeDefined();
      });
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(screen.getByTestId('language-toggle')).toBeDefined();
      expect(screen.getByTestId('theme-toggle')).toBeDefined();
      unmount();
    }
  });

  it('5. Re-translates visible validation errors immediately in both directions while preserving typed input on Sign In and Forgot Password', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
    });

    const emailInput = screen.getByLabelText(/Email address/i) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In to EduTrack/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Please enter a valid email address.');
    });

    // Switch EN -> AR while error is visible
    fireEvent.click(screen.getByTestId('language-toggle'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('من فضلك أدخل بريدًا إلكترونيًا صحيحًا.');
    });
    expect((screen.getByLabelText(/البريد الإلكتروني/i) as HTMLInputElement).value).toBe('invalid-email');

    // Switch AR -> EN while error is visible
    fireEvent.click(screen.getByTestId('language-toggle'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Please enter a valid email address.');
    });
    expect((screen.getByLabelText(/Email address/i) as HTMLInputElement).value).toBe('invalid-email');

    // Open Forgot Password, verify value carried over, submit invalid email, and switch EN <-> AR
    fireEvent.click(screen.getByRole('button', { name: /Forgot password\?/i }));
    await waitFor(() => {
      expect(screen.getByTestId('send-reset-link-button')).toBeDefined();
    });
    expect((screen.getByLabelText(/Email address/i) as HTMLInputElement).value).toBe('invalid-email');

    fireEvent.click(screen.getByTestId('send-reset-link-button'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Please enter a valid email address.');
    });

    fireEvent.click(screen.getByTestId('language-toggle'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('من فضلك أدخل بريدًا إلكترونيًا صحيحًا.');
    });
    expect((screen.getByLabelText(/البريد الإلكتروني/i) as HTMLInputElement).value).toBe('invalid-email');

    fireEvent.click(screen.getByTestId('language-toggle'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Please enter a valid email address.');
    });
    expect((screen.getByLabelText(/Email address/i) as HTMLInputElement).value).toBe('invalid-email');
  });
});
