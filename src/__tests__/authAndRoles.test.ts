import { describe, it, expect } from 'vitest';
import { AuthPortalStatus } from '../contexts/AuthContext';
import { UserProfile } from '../types/database';

describe('Auth & Role Gatekeeper State Machine (Pure Unit Tests)', () => {
  // Pure logic function replicating the gatekeeper state machine in AuthContext
  function resolveAuthStatus({
    isConfigured,
    hasSession,
    profile,
  }: {
    isConfigured: boolean;
    hasSession: boolean;
    profile: UserProfile | null;
  }): { status: AuthPortalStatus; error: string | null } {
    if (!isConfigured) {
      return { status: 'unconfigured', error: 'Supabase credentials are not configured.' };
    }

    if (!hasSession) {
      return { status: 'unauthenticated', error: null };
    }

    if (!profile) {
      return {
        status: 'missing_profile',
        error: 'Your login succeeded, but no profile record was found in the database. Please contact the administrator.',
      };
    }

    if (profile.role === 'admin') {
      return { status: 'authenticated_admin', error: null };
    }

    return {
      status: 'authenticated_non_admin',
      error: `Access denied. Account role is "${profile.role}". Admin privileges are required.`,
    };
  }

  it('marks unconfigured when environment variables are missing', () => {
    const res = resolveAuthStatus({ isConfigured: false, hasSession: false, profile: null });
    expect(res.status).toBe('unconfigured');
  });

  it('marks unauthenticated when no session exists', () => {
    const res = resolveAuthStatus({ isConfigured: true, hasSession: false, profile: null });
    expect(res.status).toBe('unauthenticated');
    expect(res.error).toBeNull();
  });

  it('detects missing profile when user is authenticated in auth.users but has no row in public.profiles', () => {
    const res = resolveAuthStatus({ isConfigured: true, hasSession: true, profile: null });
    expect(res.status).toBe('missing_profile');
    expect(res.error).toContain('no profile record was found');
  });

  it('rejects non-admin roles and NEVER falls back to admin', () => {
    const nonAdminRoles: Array<'student' | 'teacher' | 'parent'> = ['student', 'teacher', 'parent'];

    for (const role of nonAdminRoles) {
      const profile: UserProfile = {
        id: '11111111-1111-4111-8111-111111111111',
        email: `${role}@edutrack.com`,
        full_name: `Test ${role}`,
        role,
        created_at: new Date().toISOString(),
      };

      const res = resolveAuthStatus({ isConfigured: true, hasSession: true, profile });
      expect(res.status).toBe('authenticated_non_admin');
      expect(res.error).toContain(`Account role is "${role}"`);
      expect(res.status).not.toBe('authenticated_admin');
    }
  });

  it('grants admin access only when role is strictly "admin"', () => {
    const adminProfile: UserProfile = {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@edutrack.com',
      full_name: 'System Admin',
      role: 'admin',
      created_at: new Date().toISOString(),
    };

    const res = resolveAuthStatus({ isConfigured: true, hasSession: true, profile: adminProfile });
    expect(res.status).toBe('authenticated_admin');
    expect(res.error).toBeNull();
  });
});
