import { describe, it, expect } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { resolveAuthAccessDecision, AuthPortalStatus } from '../contexts/authState';
import { UserProfile } from '../types/database';

function makeSession(userId: string): Session {
  return {
    access_token: 'test-token',
    refresh_token: 'test-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email: 'user@edutrack.com' } as Session['user'],
  };
}

describe('Auth & Role Gatekeeper State Machine (Pure Unit Tests)', () => {
  it('marks unconfigured when environment variables are missing', () => {
    const res = resolveAuthAccessDecision({
      isConfigured: false,
      session: null,
      profile: null,
      profileError: null,
    });
    expect(res.status).toBe('unconfigured');
    expect(res.error).toBeNull();
  });

  it('marks unauthenticated when no session exists', () => {
    const res = resolveAuthAccessDecision({
      isConfigured: true,
      session: null,
      profile: null,
      profileError: null,
    });
    expect(res.status).toBe('unauthenticated');
    expect(res.error).toBeNull();
  });

  it('detects missing profile when user is authenticated in auth.users but has no row in public.profiles', () => {
    const res = resolveAuthAccessDecision({
      isConfigured: true,
      session: makeSession('11111111-1111-4111-8111-111111111111'),
      profile: null,
      profileError: null,
    });
    expect(res.status).toBe('missing_profile');
    expect(res.error).toContain('no profile record was found');
  });

  it('returns profile_error when database query fails or profile.id mismatches session.user.id', () => {
    const dbErr = resolveAuthAccessDecision({
      isConfigured: true,
      session: makeSession('11111111-1111-4111-8111-111111111111'),
      profile: null,
      profileError: 'timeout',
    });
    expect(dbErr.status).toBe('profile_error');
    expect(dbErr.error).toContain('timeout');

    const mismatch = resolveAuthAccessDecision({
      isConfigured: true,
      session: makeSession('11111111-1111-4111-8111-111111111111'),
      profile: {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'other@edutrack.com',
        full_name: 'Other User',
        role: 'admin',
        created_at: new Date().toISOString(),
      },
      profileError: null,
    });
    expect(mismatch.status).toBe('profile_error');
    expect(mismatch.error).toContain('mismatch');
  });

  it('routes every supported role explicitly without falling back to admin', () => {
    const cases: Array<{ role: UserProfile['role']; expected: AuthPortalStatus }> = [
      { role: 'admin', expected: 'authenticated_admin' },
      { role: 'teacher', expected: 'authenticated_teacher' },
      { role: 'student', expected: 'authenticated_student' },
      { role: 'parent', expected: 'authenticated_parent' },
    ];

    for (const { role, expected } of cases) {
      const userId = '11111111-1111-4111-8111-111111111111';
      const profile: UserProfile = {
        id: userId,
        email: `${role}@edutrack.com`,
        full_name: `Test ${role}`,
        role,
        created_at: new Date().toISOString(),
      };

      const res = resolveAuthAccessDecision({
        isConfigured: true,
        session: makeSession(userId),
        profile,
        profileError: null,
      });
      expect(res.status).toBe(expected);
      expect(res.error).toBeNull();
    }
  });

  it('returns unknown_role when profile role is unrecognized', () => {
    const userId = '99999999-9999-4999-8999-999999999999';
    const invalidProfile = {
      id: userId,
      email: 'guest@edutrack.com',
      full_name: 'Unknown Role',
      role: 'auditor' as unknown as UserProfile['role'],
      created_at: new Date().toISOString(),
    };

    const res = resolveAuthAccessDecision({
      isConfigured: true,
      session: makeSession(userId),
      profile: invalidProfile,
      profileError: null,
    });
    expect(res.status).toBe('unknown_role');
    expect(res.error).toContain('auditor');
  });
});
