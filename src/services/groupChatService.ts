import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { ServiceResult } from './adminService';
import { parseRpcPayload } from './portalPayloadValidation';

export const GROUP_CHAT_MAX_LENGTH = 1000;
export const GROUP_CHAT_MESSAGE_LIMIT = 50;

export type GroupChatSenderRole = 'teacher' | 'student';

export interface GroupChatMessage {
  id: string;
  group_id: string;
  sender_display_name: string;
  sender_role: GroupChatSenderRole;
  body: string;
  created_at: string;
}

export interface GroupChatMessagesResult {
  group_id: string;
  messages: GroupChatMessage[];
}

export function isLocalDemoMode(): boolean {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim() === 'edutrack-local-demo-anon-key';
}

export function canUseLiveRealtime(): boolean {
  if (import.meta.env.MODE === 'test' || import.meta.env.VITEST) return false;
  if (!isSupabaseConfigured() || isLocalDemoMode()) return false;
  const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().toLowerCase();
  if (!rawUrl) return false;
  if (rawUrl.includes('placeholder') || rawUrl.includes('your-project') || rawUrl.includes('unconfigured')) {
    return false;
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateChatMessage(raw: unknown): ServiceResult<GroupChatMessage> {
  if (!raw || typeof raw !== 'object') {
    return { data: null, error: 'Invalid group chat message payload.' };
  }
  const item = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(item.id) ||
    !isNonEmptyString(item.group_id) ||
    !isNonEmptyString(item.sender_display_name) ||
    !isNonEmptyString(item.body) ||
    !isNonEmptyString(item.created_at)
  ) {
    return { data: null, error: 'Incomplete group chat message payload.' };
  }
  if (item.sender_role !== 'teacher' && item.sender_role !== 'student') {
    return { data: null, error: 'Invalid sender role in group chat message.' };
  }
  return {
    data: {
      id: item.id,
      group_id: item.group_id,
      sender_display_name: item.sender_display_name,
      sender_role: item.sender_role,
      body: item.body,
      created_at: item.created_at,
    },
    error: null,
  };
}

export const groupChatService = {
  async getGroupChatMessages(groupId: string): Promise<ServiceResult<GroupChatMessagesResult>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }
    if (!isNonEmptyString(groupId)) {
      return { data: null, error: 'Group ID is required.' };
    }

    try {
      const { data, error } = await supabase.rpc('get_group_chat_messages', {
        p_group_id: groupId,
      });
      if (error) {
        return { data: null, error: error.message || 'Failed to load group discussion.', code: error.code };
      }

      const payload = parseRpcPayload(data);
      if (!payload || payload.group_id !== groupId || !Array.isArray(payload.messages)) {
        return { data: null, error: 'Unexpected group discussion response from database.' };
      }

      const messages: GroupChatMessage[] = [];
      for (const rawMsg of payload.messages) {
        const parsed = validateChatMessage(rawMsg);
        if (parsed.error || parsed.data?.group_id !== groupId) {
          return { data: null, error: parsed.error || 'Invalid message in group discussion.' };
        }
        messages.push(parsed.data);
      }

      return {
        data: {
          group_id: payload.group_id,
          messages,
        },
        error: null,
      };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Failed to load group discussion.',
      };
    }
  },

  async sendGroupChatMessage(groupId: string, rawBody: string): Promise<ServiceResult<GroupChatMessage>> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured.' };
    }
    if (!isNonEmptyString(groupId)) {
      return { data: null, error: 'Group ID is required.' };
    }

    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      return { data: null, error: 'Message cannot be empty.' };
    }
    if (trimmed.length > GROUP_CHAT_MAX_LENGTH) {
      return {
        data: null,
        error: `Message exceeds maximum length of ${GROUP_CHAT_MAX_LENGTH} characters.`,
      };
    }

    try {
      const { data, error } = await supabase.rpc('send_group_chat_message', {
        p_group_id: groupId,
        p_body: trimmed,
      });
      if (error) {
        return { data: null, error: error.message || 'Failed to send message.', code: error.code };
      }

      const payload = parseRpcPayload(data);
      const parsed = validateChatMessage(payload);
      if (parsed.error || parsed.data?.group_id !== groupId) {
        return { data: null, error: parsed.error || 'Unexpected send message response from database.' };
      }

      return { data: parsed.data, error: null };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Failed to send message.',
      };
    }
  },
};
