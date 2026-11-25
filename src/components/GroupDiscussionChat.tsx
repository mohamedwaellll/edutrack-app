import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { usePreferences } from '../contexts/preferencesState';
import { translateRole } from '../i18n/translations';
import { supabase } from '../lib/supabaseClient';
import {
  GROUP_CHAT_MAX_LENGTH,
  canUseLiveRealtime,
  groupChatService,
  isLocalDemoMode,
  type GroupChatMessage,
} from '../services/groupChatService';
import { formatCairoDateTime } from '../services/portalPayloadValidation';

interface GroupDiscussionChatProps {
  groupId: string;
  groupName?: string;
  userId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  testIdPrefix?: string;
}

type RealtimeConnectionState = 'live' | 'local-demo' | 'manual';

export function GroupDiscussionChat(props: GroupDiscussionChatProps) {
  return <ScopedGroupDiscussionChat key={`${props.userId ?? 'anon'}:${props.groupId}`} {...props} />;
}

const ScopedGroupDiscussionChat: React.FC<GroupDiscussionChatProps> = ({
  groupId,
  groupName,
  disabled = false,
  disabledReason,
  testIdPrefix = 'group-chat',
}) => {
  const { language, t } = usePreferences();

  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [realtimeState, setRealtimeState] = useState<RealtimeConnectionState>(() =>
    isLocalDemoMode() ? 'local-demo' : 'manual'
  );

  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const sendInFlight = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadMessages = useCallback(
    async (options?: { background?: boolean }) => {
      const seq = ++loadSeqRef.current;

      if (options?.background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);

      const res = await groupChatService.getGroupChatMessages(groupId);
      if (!mountedRef.current || loadSeqRef.current !== seq) return;

      setLoading(false);
      setRefreshing(false);

      if (res.error || !res.data) {
        if (res.code === '42501') setMessages([]);
        setLoadError(res.error || 'Failed to load group discussion.');
        return;
      }

      setMessages(res.data.messages);
    },
    [groupId]
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadMessages();
    });
    return () => {
      active = false;
    };
  }, [loadMessages]);

  // Subscribe to group-scoped marker table when live Supabase Realtime is available
  useEffect(() => {
    if (!canUseLiveRealtime() || typeof supabase.channel !== 'function') return;
    let active = true;
    const marker = {
      schema: 'public',
      table: 'group_chat_markers',
      filter: `group_id=eq.${groupId}`,
    };
    const refreshOnMarker = () => {
      if (active && mountedRef.current) void loadMessages({ background: true });
    };
    const channel = supabase
      .channel(`group-chat-marker-${groupId}`)
      .on('system', {}, (payload: { extension?: string; status?: string }) => {
        if (!active || !mountedRef.current || payload.extension !== 'postgres_changes') return;
        if (payload.status === 'ok') {
          setRealtimeState('live');
          refreshOnMarker();
        } else if (payload.status === 'error' || payload.status === 'timeout') {
          setRealtimeState('manual');
        }
      })
      .on('postgres_changes', { ...marker, event: 'INSERT' }, refreshOnMarker)
      .on('postgres_changes', { ...marker, event: 'UPDATE' }, refreshOnMarker)
      .subscribe((status) => {
        if (!active || !mountedRef.current) return;
        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setRealtimeState('manual');
        }
      });

    return () => {
      active = false;
      if (typeof supabase.removeChannel === 'function') {
        void supabase.removeChannel(channel);
      }
    };
  }, [groupId, loadMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || sendInFlight.current) return;

    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setSendError(t('groupChatEmptyValidation'));
      return;
    }
    if (trimmed.length > GROUP_CHAT_MAX_LENGTH) {
      setSendError(t('groupChatTooLongValidation'));
      return;
    }

    sendInFlight.current = true;
    setSending(true);
    setSendError(null);

    const res = await groupChatService.sendGroupChatMessage(groupId, trimmed);
    if (!mountedRef.current) return;

    sendInFlight.current = false;
    setSending(false);
    if (res.error || !res.data) {
      if (res.code === '42501') setMessages([]);
      // Preserve draft on error
      setSendError(res.error || t('groupChatSendError'));
      return;
    }

    setDraft('');
    void loadMessages({ background: true });
  };

  const trimmedLength = draft.trim().length;
  const statusLabel =
    realtimeState === 'live'
      ? t('groupChatLiveStatus')
      : realtimeState === 'local-demo'
        ? t('groupChatLocalDemoStatus')
        : t('groupChatManualStatus');

  const statusBadgeClass =
    realtimeState === 'live'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-400/35 dark:text-emerald-300'
      : 'bg-[#F8F7F2] border-[#E6E8E2] text-[#64748B] dark:bg-[#0D1520] dark:border-slate-700 dark:text-slate-300';

  return (
    <section
      data-testid={`${testIdPrefix}-section`}
      className="rounded-2xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-6 space-y-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8E2] dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#174E50] dark:text-teal-300" />
            <h3 className="text-base font-extrabold text-[#17213B] dark:text-white">
              {t('groupChatHeading')}
            </h3>
            {groupName && (
              <span className="text-xs font-semibold text-[#64748B] dark:text-slate-400">
                — {groupName}
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B] dark:text-slate-400">
            {t('groupChatSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid={`${testIdPrefix}-realtime-status`}
            className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-semibold ${statusBadgeClass}`}
          >
            {statusLabel}
          </span>
          <button
            type="button"
            data-testid={`${testIdPrefix}-refresh-btn`}
            onClick={() => void loadMessages({ background: true })}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-[#F8F7F2] dark:bg-[#0D1520] hover:bg-[#D8E8DC]/50 dark:hover:bg-slate-800 text-xs font-bold text-[#174E50] dark:text-teal-300 transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? t('groupChatRefreshingBtn') : t('groupChatRefreshBtn')}</span>
          </button>
        </div>
      </div>

      {disabled && (
        <div
          data-testid={`${testIdPrefix}-disabled-notice`}
          className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          {disabledReason || t('groupChatDisabledDefault')}
        </div>
      )}

      {loading && (
        <div
          data-testid={`${testIdPrefix}-loading`}
          className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-5 text-center text-xs text-[#64748B] dark:text-slate-400 flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4 animate-spin text-[#174E50] dark:text-teal-300" />
          <span>{t('groupChatLoading')}</span>
        </div>
      )}

      {!loading && loadError && (
        <div
          aria-live="polite"
          data-testid={`${testIdPrefix}-load-error`}
          className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 p-4 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-rose-800 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="font-bold">{t('groupChatLoadError')}</p>
              <p className="mt-0.5">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid={`${testIdPrefix}-retry-btn`}
            onClick={() => void loadMessages()}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
          >
            {t('groupChatRefreshBtn')}
          </button>
        </div>
      )}

      {!loading && !loadError && messages.length === 0 && (
        <div
          data-testid={`${testIdPrefix}-empty`}
          className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-6 text-center text-xs text-[#7B8794] dark:text-slate-400"
        >
          {t('groupChatEmpty')}
        </div>
      )}

      {!loading && !loadError && messages.length > 0 && (
        <div
          data-testid={`${testIdPrefix}-messages`}
          className="space-y-2.5 max-h-80 overflow-y-auto pr-1"
        >
          {messages.map((msg) => (
            <article
              key={msg.id}
              data-testid={`${testIdPrefix}-message-${msg.id}`}
              className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3.5 space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[#17213B] dark:text-white">
                    {msg.sender_display_name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${
                      msg.sender_role === 'teacher'
                        ? 'bg-[#D8E8DC] border-[#174E50]/25 text-[#174E50] dark:bg-teal-500/20 dark:border-teal-400/35 dark:text-teal-300'
                        : 'bg-white border-[#E6E8E2] text-[#475569] dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {translateRole(language, msg.sender_role)}
                  </span>
                </div>
                <span
                  dir="ltr"
                  className="text-[11px] font-mono text-[#64748B] dark:text-slate-400"
                >
                  {formatCairoDateTime(msg.created_at)}
                </span>
              </div>
              <p className="text-xs text-[#26334A] dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                {msg.body}
              </p>
            </article>
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="space-y-2 pt-2 border-t border-[#E6E8E2] dark:border-slate-800">
        {sendError && (
          <div
            role="alert"
            data-testid={`${testIdPrefix}-send-error`}
            className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 p-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <span>{sendError}</span>
          </div>
        )}

        <textarea
          data-testid={`${testIdPrefix}-input`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (sendError) setSendError(null);
          }}
          disabled={disabled || sending}
          rows={2}
          placeholder={t('groupChatPlaceholder')}
          className="w-full rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-[#F8F7F2] dark:bg-[#0D1520] px-3.5 py-2.5 text-xs text-[#17213B] dark:text-white placeholder-[#7B8794] dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#174E50]/40 dark:focus:ring-teal-500/40 disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            dir="ltr"
            data-testid={`${testIdPrefix}-char-count`}
            className={`text-[11px] font-mono ${
              trimmedLength > GROUP_CHAT_MAX_LENGTH
                ? 'text-rose-600 dark:text-rose-400 font-bold'
                : 'text-[#64748B] dark:text-slate-400'
            }`}
          >
            {trimmedLength}/{GROUP_CHAT_MAX_LENGTH}
          </span>

          <button
            type="submit"
            data-testid={`${testIdPrefix}-send-btn`}
            disabled={disabled || sending || trimmedLength === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sending ? t('groupChatSendingBtn') : t('groupChatSendBtn')}</span>
          </button>
        </div>
      </form>
    </section>
  );
};
