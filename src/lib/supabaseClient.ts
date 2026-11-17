import { createClient } from '@supabase/supabase-js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export interface SupabaseConfigStatus {
  isConfigured: boolean;
  missingUrl: boolean;
  missingKey: boolean;
  isPlaceholder: boolean;
  message: string;
}

export const getSupabaseConfigStatus = (): SupabaseConfigStatus => {
  const missingUrl = !rawUrl;
  const missingKey = !rawKey;
  const isPlaceholder =
    rawUrl.includes('placeholder') ||
    rawUrl.includes('your-project') ||
    rawKey.includes('placeholder') ||
    rawKey.includes('your-anon-key') ||
    rawKey.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');

  const isConfigured = !missingUrl && !missingKey && !isPlaceholder;

  let message = 'Supabase credentials configured.';
  if (missingUrl && missingKey) {
    message = 'Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env file.';
  } else if (missingUrl) {
    message = 'Missing VITE_SUPABASE_URL in .env file.';
  } else if (missingKey) {
    message = 'Missing VITE_SUPABASE_ANON_KEY in .env file.';
  } else if (isPlaceholder) {
    message = 'Supabase environment variables contain placeholder values. Please provide real credentials in .env.';
  }

  return {
    isConfigured,
    missingUrl,
    missingKey,
    isPlaceholder,
    message,
  };
};

export const isSupabaseConfigured = (): boolean => {
  return getSupabaseConfigStatus().isConfigured;
};

// Safe fallback URL for client initialization without throwing at load time
const clientUrl = isSupabaseConfigured() ? rawUrl : 'https://unconfigured-edutrack.supabase.co';
const clientKey = isSupabaseConfigured() ? rawKey : 'unconfigured-anon-key';

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
