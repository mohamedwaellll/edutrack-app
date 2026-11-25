// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import type { Session, Subscription } from '@supabase/supabase-js';
import App from '../App';
import { PreferencesProvider } from '../contexts/PreferencesContext';
import { GroupDiscussionChat } from '../components/GroupDiscussionChat';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';
import * as groupChatServiceModule from '../services/groupChatService';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

type RpcReturn = ReturnType<typeof supabase.rpc>;
const rpcResolve = (data: unknown, error: { message: string } | null = null): RpcReturn =>
  Promise.resolve({ data, error }) as unknown as RpcReturn;

function setupPortalAuth(userId: string, fullName: string, role: 'teacher' | 'student') {
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: {
      session: {
        user: { id: userId, email: `${role}@edutrack.com` },
        access_token: `tok-${userId}`,
      } as unknown as Session,
    },
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
      }),
    };
  }) as unknown as typeof supabase.from);
}

const GRP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const GRP_B = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

describe('GroupDiscussionChat Component & Portal Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation(
      () => ({
        data: { subscription: { unsubscribe: vi.fn() } as unknown as Subscription },
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('catches up when Realtime connects, refreshes on group markers, and removes the subscription', async () => {
    vi.spyOn(groupChatServiceModule, 'canUseLiveRealtime').mockReturnValue(true);
    const channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    vi.spyOn(supabase, 'channel').mockReturnValue(channel as unknown as ReturnType<typeof supabase.channel>);
    const removeChannel = vi.spyOn(supabase, 'removeChannel').mockResolvedValue('ok');
    const rpc = vi.spyOn(supabase, 'rpc').mockImplementation(() =>
      rpcResolve({ group_id: GRP_A, messages: [] })
    );

    const { unmount } = render(
      <PreferencesProvider>
        <GroupDiscussionChat userId="user-a" groupId={GRP_A} />
      </PreferencesProvider>
    );
    await screen.findByTestId('group-chat-empty');
    const bindings = channel.on.mock.calls;
    const markerBindings = bindings.filter(([type]) => type === 'postgres_changes');
    expect(markerBindings.map(([, config]) => [config.event, config.filter])).toEqual([
      ['INSERT', `group_id=eq.${GRP_A}`],
      ['UPDATE', `group_id=eq.${GRP_A}`],
    ]);
    const onSystemEvent = bindings.find(([type]) => type === 'system')![2];
    const onInsertMarker = markerBindings.find(([, config]) => config.event === 'INSERT')![2];
    expect(rpc).toHaveBeenCalledTimes(1);

    const copyFromServer = (body: string) => {
      rpc.mockImplementation(() => rpcResolve({
        group_id: GRP_A,
        messages: [{
          id: 'm1', group_id: GRP_A, sender_display_name: 'Rami', sender_role: 'teacher',
          body, created_at: '2026-11-24T10:00:00Z',
        }],
      }));
    };
    act(() => channel.subscribe.mock.calls[0][0]('SUBSCRIBED'));
    expect(screen.getByTestId('group-chat-realtime-status').textContent).toMatch(/manual refresh/i);
    expect(rpc).toHaveBeenCalledTimes(1);
    copyFromServer('Sent before Postgres Changes was ready');
    act(() => onSystemEvent({ extension: 'postgres_changes', status: 'ok' }));
    await screen.findByText('Sent before Postgres Changes was ready');
    expect(screen.getByTestId('group-chat-realtime-status').textContent).toMatch(/live updates active/i);

    copyFromServer('A new message');
    act(() => onInsertMarker());
    await screen.findByText('A new message');

    act(() => channel.subscribe.mock.calls[0][0]('CHANNEL_ERROR'));
    expect(screen.getByTestId('group-chat-realtime-status').textContent).toMatch(/manual refresh/i);
    copyFromServer('Sent during disconnect');
    act(() => channel.subscribe.mock.calls[0][0]('SUBSCRIBED'));
    expect(screen.queryByText('Sent during disconnect')).toBeNull();
    act(() => onSystemEvent({ extension: 'postgres_changes', status: 'ok' }));
    await screen.findByText('Sent during disconnect');

    unmount();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it('renders GroupDiscussionChat inside TeacherPortal for the selected group', async () => {
    setupPortalAuth('teacher-uid-1', 'Mr. Rami', 'teacher');
    vi.spyOn(supabase, 'rpc').mockImplementation((fn: string) => {
      if (fn === 'get_teacher_portal_context') {
        return rpcResolve({
          linked: true,
          teacher: { id: 't-1', full_name: 'Mr. Rami', subject: 'Physics' },
          groups: [{ id: GRP_A, name: 'Physics A', grade_level: 'Grade 10', student_count: 1 }],
        });
      }
      if (fn === 'get_teacher_group_students') {
        return rpcResolve({
          group: { id: GRP_A, name: 'Physics A', grade_level: 'Grade 10' },
          students: [],
        });
      }
      if (fn === 'get_teacher_assignments') {
        return rpcResolve({ group_id: GRP_A, assignments: [] });
      }
      if (fn === 'get_group_chat_messages') {
        return rpcResolve({
          group_id: GRP_A,
          messages: [
            {
              id: 'm-1',
              group_id: GRP_A,
              sender_display_name: 'Mr. Rami',
              sender_role: 'teacher',
              body: 'Exam is on Sunday',
              created_at: '2026-11-24T10:00:00Z',
            },
          ],
        });
      }
      return rpcResolve(null);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('teacher-group-chat-section')).toBeTruthy();
      expect(screen.getByText('Exam is on Sunday')).toBeTruthy();
    });
  });

  it('renders GroupDiscussionChat inside StudentPortal for active student current group', async () => {
    setupPortalAuth('student-uid-1', 'Youssef Tariq', 'student');
    vi.spyOn(supabase, 'rpc').mockImplementation((fn: string) => {
      if (fn === 'get_student_portal_data') {
        return rpcResolve({
          linked: true,
          student: {
            id: 's-1',
            full_name: 'Youssef Tariq',
            student_code: 'ET-1001',
            grade_level: 'Grade 10',
            status: 'active',
            group: { id: GRP_A, name: 'Physics A', grade_level: 'Grade 10' },
          },
          attendance: [],
          grades: [],
        });
      }
      if (fn === 'get_student_assignments') {
        return rpcResolve({ assignments: [] });
      }
      if (fn === 'get_group_chat_messages') {
        return rpcResolve({
          group_id: GRP_A,
          messages: [
            {
              id: 'm-2',
              group_id: GRP_A,
              sender_display_name: 'Youssef Tariq',
              sender_role: 'student',
              body: 'Ready for class',
              created_at: '2026-11-24T10:05:00Z',
            },
          ],
        });
      }
      return rpcResolve(null);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('student-group-chat-section')).toBeTruthy();
      expect(screen.getByText('Ready for class')).toBeTruthy();
    });
  });

  it('preserves draft on send error and supports explicit refresh + local demo fallback without fake realtime', async () => {
    vi.spyOn(groupChatServiceModule, 'isLocalDemoMode').mockReturnValue(true);

    let readCount = 0;
    vi.spyOn(supabase, 'rpc').mockImplementation((fn: string) => {
      if (fn === 'get_group_chat_messages') {
        readCount += 1;
        return rpcResolve({
          group_id: GRP_A,
          messages:
            readCount > 1
              ? [
                  {
                    id: 'm-refreshed',
                    group_id: GRP_A,
                    sender_display_name: 'Mr. Rami',
                    sender_role: 'teacher',
                    body: 'Refreshed message',
                    created_at: '2026-11-24T10:10:00Z',
                  },
                ]
              : [],
        });
      }
      if (fn === 'send_group_chat_message') {
        return rpcResolve(null, { message: 'Access denied: Temporary failure' });
      }
      return rpcResolve(null);
    });

    render(
      <PreferencesProvider>
        <GroupDiscussionChat groupId={GRP_A} groupName="Physics A" userId="u-1" />
      </PreferencesProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('group-chat-realtime-status').textContent).toMatch(/local demo/i);
    });

    const input = screen.getByTestId('group-chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByTestId('group-chat-send-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('group-chat-send-error').textContent).toContain('Temporary failure');
    });
    expect(input.value).toBe('Keep this draft');

    fireEvent.click(screen.getByTestId('group-chat-refresh-btn'));
    await waitFor(() => {
      expect(screen.getByText('Refreshed message')).toBeTruthy();
    });
  });

  it('ignores stale replies when group or account changes', async () => {
    let resolveGroupA!: (val: RpcReturn) => void;
    const pendingGroupA = new Promise<RpcReturn>((resolve) => {
      resolveGroupA = resolve;
    });

    vi.spyOn(supabase, 'rpc').mockImplementation((fn: string, params?: unknown) => {
      if (fn === 'get_group_chat_messages') {
        const gid = (params as { p_group_id?: string })?.p_group_id;
        if (gid === GRP_A) {
          return pendingGroupA as unknown as RpcReturn;
        }
        return rpcResolve({
          group_id: GRP_B,
          messages: [
            {
              id: 'm-b',
              group_id: GRP_B,
              sender_display_name: 'Ms. Salma',
              sender_role: 'teacher',
              body: 'Math B only',
              created_at: '2026-11-24T11:00:00Z',
            },
          ],
        });
      }
      return rpcResolve(null);
    });

    const { rerender } = render(
      <PreferencesProvider>
        <GroupDiscussionChat groupId={GRP_A} groupName="Physics A" userId="u-1" />
      </PreferencesProvider>
    );

    rerender(
      <PreferencesProvider>
        <GroupDiscussionChat groupId={GRP_B} groupName="Math B" userId="u-1" />
      </PreferencesProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Math B only')).toBeTruthy();
    });

    await act(async () => {
      resolveGroupA(
        rpcResolve({
          group_id: GRP_A,
          messages: [
            {
              id: 'm-a-stale',
              group_id: GRP_A,
              sender_display_name: 'Mr. Rami',
              sender_role: 'teacher',
              body: 'Stale Physics A reply',
              created_at: '2026-11-24T10:00:00Z',
            },
          ],
        })
      );
    });

    expect(screen.queryByText('Stale Physics A reply')).toBeNull();
    expect(screen.getByText('Math B only')).toBeTruthy();
  });
});
