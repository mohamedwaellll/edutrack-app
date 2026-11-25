import crypto from 'node:crypto';
import net from 'node:net';

const LOCAL_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const EXPECTED_RECOVERY_REDIRECT_URL = 'http://localhost:3000/reset-password';
export const VITE_HEALTH_PATH = '/__recovery_e2e_health';

export function generateUniqueRecoveryEmail(prefix = 'recovery.teacher', runId = '') {
  const token = runId || `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  return `${prefix}.${token}@edutrack.local`.toLowerCase();
}

function probeTcpPort(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (inUse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function tryBindPort(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err) => {
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
        resolve(false);
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export async function assertPortFree(port, host = '127.0.0.1') {
  const hostsToProbe = Array.from(new Set([host, '127.0.0.1', '::1']));
  for (const h of hostsToProbe) {
    const active = await probeTcpPort(port, h);
    if (active) {
      throw new Error(
        `Port ${port} is already in use on ${h}. Stop the existing service or free port ${port} before running test:recovery:local; existing service was left untouched.`
      );
    }
  }
  const canBind = await tryBindPort(port, host);
  if (!canBind) {
    throw new Error(
      `Port ${port} is already in use on ${host}. Stop the existing service or free port ${port} before running test:recovery:local; existing service was left untouched.`
    );
  }
}

export function assertLocalUrl(rawUrl, label = 'URL') {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(`Missing required ${label}. Only local loopback Supabase URLs are allowed.`);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid ${label}: refused to run integration test.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol for ${label} (${parsed.protocol}). Refusing to run.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!LOCAL_LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      `REFUSING NON-LOCAL TARGET for ${label} ("${hostname}"). ` +
        'Local recovery E2E must only connect to official local Supabase (127.0.0.1 / localhost / ::1), never hosted Supabase.'
    );
  }
  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
}

export function assertIsolatedLocalConfig({ supabaseUrl, mailboxUrl, redirectUrl }) {
  const safeSupabaseUrl = assertLocalUrl(supabaseUrl, 'Local Supabase URL');
  const safeMailboxUrl = assertLocalUrl(mailboxUrl, 'Local Mailbox URL');
  if (redirectUrl !== EXPECTED_RECOVERY_REDIRECT_URL) {
    throw new Error(
      `Unexpected redirect URL "${redirectUrl}". Expected "${EXPECTED_RECOVERY_REDIRECT_URL}".`
    );
  }
  return {
    supabaseUrl: safeSupabaseUrl,
    mailboxUrl: safeMailboxUrl,
    redirectUrl,
  };
}

export function redactSensitive(input, extraSecrets = []) {
  let out = String(input ?? '');
  for (const secret of extraSecrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  out = out
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]')
    .replace(
      /(https?:\/\/[^\s"'<>]*?(?:\/auth\/v1\/verify|\/reset-password)[^\s"'<>]*)/gi,
      '[REDACTED_RECOVERY_URL]'
    )
    .replace(
      /([?#&](?:access_token|refresh_token|token|token_hash|code|apikey|password)=)[^&#\s"']+/gi,
      '$1[REDACTED]'
    );
  return out;
}

export function decodeHtmlEntities(str) {
  return String(str ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&#x3D;|&#61;/gi, '=')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function extractRecoveryLinkFromEmail({ html = '', text = '' }) {
  const candidates = [decodeHtmlEntities(html), decodeHtmlEntities(text)];
  const pattern = /https?:\/\/[^\s"'<>()]+/gi;

  for (const body of candidates) {
    if (!body) continue;
    const matches = body.match(pattern) || [];
    for (const rawCandidate of matches) {
      const candidate = rawCandidate.replace(/[.,;!?]+$/, '');
      try {
        const u = new URL(candidate);
        const searchParams = u.searchParams;
        const hashParams = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);
        const isVerifyRecovery =
          u.pathname.includes('/auth/v1/verify') &&
          (searchParams.get('type') === 'recovery' || searchParams.has('token'));
        const isDirectResetRoute =
          u.pathname.includes('/reset-password') &&
          (searchParams.get('type') === 'recovery' ||
            hashParams.get('type') === 'recovery' ||
            searchParams.has('code') ||
            hashParams.has('access_token'));
        if (isVerifyRecovery || isDirectResetRoute) {
          return u.toString();
        }
      } catch {
        // Ignore malformed URL fragments in text
      }
    }
  }
  return null;
}

export async function provisionTeacherAccount({
  supabaseUrl,
  serviceRoleKey,
  email,
  initialPassword,
  onUserCreated,
}) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Local Recovery Teacher' },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to provision local test user: ${createRes.status} ${errText}`);
  }
  const created = await createRes.json();
  const userId = created?.id || created?.user?.id;
  if (!userId) {
    throw new Error('Local Admin API did not return created user id.');
  }

  // Record userId immediately so caller always cleans up this run's account even if profile setup fails
  onUserCreated?.(userId);

  const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: userId,
      email,
      full_name: 'Local Recovery Teacher',
      role: 'teacher',
    }),
  });
  if (!profileRes.ok) {
    const errText = await profileRes.text();
    throw new Error(`Failed to assign known role "teacher" in profiles: ${errText}`);
  }

  return userId;
}

export async function cleanupTestUser({ supabaseUrl, serviceRoleKey, userId }) {
  if (!userId) return false;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForOwnedViteServer({
  viteProc,
  healthUrl,
  expectedRunId,
  timeoutMs = 25000,
}) {
  if (!viteProc) {
    throw new Error('Vite process was not started.');
  }
  if (viteProc.exitCode !== null || viteProc.signalCode !== null) {
    throw new Error(
      `Isolated Vite server exited early before readiness (code=${viteProc.exitCode}, signal=${viteProc.signalCode}).`
    );
  }

  let exitedError = null;
  let stderrTail = '';
  const onStderr = (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-1000);
  };
  const onExit = (code, signal) => {
    exitedError = new Error(
      `Isolated Vite server exited before becoming ready (code=${code}, signal=${signal})${
        stderrTail ? `: ${stderrTail.trim()}` : ''
      }`
    );
  };
  const onProcError = (err) => {
    exitedError = new Error(`Failed to spawn isolated Vite server: ${err?.message || err}`);
  };

  viteProc.stderr?.on('data', onStderr);
  viteProc.once('exit', onExit);
  viteProc.once('error', onProcError);

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (exitedError) throw exitedError;
      if (viteProc.exitCode !== null || viteProc.signalCode !== null) {
        throw new Error(
          `Isolated Vite server exited before becoming ready (code=${viteProc.exitCode}).`
        );
      }

      try {
        const res = await fetch(healthUrl);
        if (res.ok) {
          const data = await res.json();
          if (data?.ok === true && data?.runId === expectedRunId) {
            return;
          }
        }
      } catch {
        // Retry until owned Vite server responds
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    if (exitedError) throw exitedError;
    throw new Error(
      `Timed out waiting for this run's isolated Vite server (${healthUrl}, runId=${expectedRunId}).`
    );
  } finally {
    viteProc.stderr?.off('data', onStderr);
    viteProc.off('exit', onExit);
    viteProc.off('error', onProcError);
  }
}

export async function pollLocalMailboxForRecoveryLink({
  mailboxUrl,
  recipientEmail,
  minCreatedAtMs = 0,
  timeoutMs = 20000,
  pollIntervalMs = 500,
}) {
  const safeMailBase = assertLocalUrl(mailboxUrl, 'Local Mailbox URL');
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  const localPart = normalizedRecipient.split('@')[0];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // 1) Mailpit API (used by modern Supabase CLI on port 54324)
    try {
      const listRes = await fetch(`${safeMailBase}/api/v1/messages`);
      if (listRes.ok) {
        const listJson = await listRes.json();
        const messages = Array.isArray(listJson?.messages) ? listJson.messages : [];
        const matching = messages.filter((msg) => {
          const toList = Array.isArray(msg?.To) ? msg.To : [];
          const hasRecipient = toList.some(
            (entry) => String(entry?.Address || '').trim().toLowerCase() === normalizedRecipient
          );
          if (!hasRecipient) return false;
          const createdMs = msg?.Created ? Date.parse(msg.Created) : NaN;
          if (Number.isFinite(createdMs) && minCreatedAtMs > 0 && createdMs + 5000 < minCreatedAtMs) {
            return false;
          }
          return true;
        });

        matching.sort((a, b) => Date.parse(b?.Created || '') - Date.parse(a?.Created || ''));
        for (const msg of matching) {
          const detailRes = await fetch(`${safeMailBase}/api/v1/message/${encodeURIComponent(msg.ID)}`);
          if (!detailRes.ok) continue;
          const detail = await detailRes.json();
          const link = extractRecoveryLinkFromEmail({
            html: detail?.HTML || '',
            text: detail?.Text || '',
          });
          if (link) {
            return { provider: 'mailpit', messageId: String(msg.ID), link };
          }
        }
      }
    } catch {
      // Fallback to Inbucket endpoint check
    }

    // 2) Legacy Inbucket API fallback (/api/v1/mailbox/<localPart>)
    try {
      const boxRes = await fetch(
        `${safeMailBase}/api/v1/mailbox/${encodeURIComponent(localPart)}`
      );
      if (boxRes.ok) {
        const items = await boxRes.json();
        if (Array.isArray(items)) {
          const sorted = [...items].sort(
            (a, b) => Date.parse(b?.date || '') - Date.parse(a?.date || '')
          );
          for (const item of sorted) {
            const msgDateMs = item?.date ? Date.parse(item.date) : NaN;
            if (Number.isFinite(msgDateMs) && minCreatedAtMs > 0 && msgDateMs + 5000 < minCreatedAtMs) {
              continue;
            }
            const msgRes = await fetch(
              `${safeMailBase}/api/v1/mailbox/${encodeURIComponent(localPart)}/${encodeURIComponent(item.id)}`
            );
            if (!msgRes.ok) continue;
            const detail = await msgRes.json();
            const link = extractRecoveryLinkFromEmail({
              html: detail?.body?.html || '',
              text: detail?.body?.text || '',
            });
            if (link) {
              return { provider: 'inbucket', messageId: String(item.id), link };
            }
          }
        }
      }
    } catch {
      // Retry until timeout
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for password recovery email in local mailbox (${safeMailBase}).`
  );
}
