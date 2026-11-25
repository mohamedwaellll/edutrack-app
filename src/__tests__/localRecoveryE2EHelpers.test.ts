import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import {
  assertIsolatedLocalConfig,
  assertLocalUrl,
  assertPortFree,
  EXPECTED_RECOVERY_REDIRECT_URL,
  extractRecoveryLinkFromEmail,
  generateUniqueRecoveryEmail,
  pollLocalMailboxForRecoveryLink,
  redactSensitive,
  waitForOwnedViteServer,
} from '../../scripts/recovery-e2e/recoveryHelpers.mjs';

const execFileAsync = promisify(execFile);

describe('Local Supabase Recovery E2E Runner Guards & Helpers', () => {
  it('allows loopback local URLs and rejects any non-local Supabase or mailbox URLs', () => {
    expect(assertLocalUrl('http://127.0.0.1:54321', 'Supabase')).toBe('http://127.0.0.1:54321');
    expect(assertLocalUrl('http://localhost:54324', 'Mailbox')).toBe('http://localhost:54324');

    expect(() =>
      assertLocalUrl('https://ujkmmuwimaorcpjchtox.supabase.co', 'Local Supabase URL')
    ).toThrow(/REFUSING NON-LOCAL TARGET/i);
    expect(() =>
      assertLocalUrl('https://example.supabase.co', 'Local Supabase URL')
    ).toThrow(/REFUSING NON-LOCAL TARGET/i);
    expect(() =>
      assertLocalUrl('http://192.168.1.25:54321', 'Local Supabase URL')
    ).toThrow(/REFUSING NON-LOCAL TARGET/i);
    expect(() =>
      assertIsolatedLocalConfig({
        supabaseUrl: 'http://127.0.0.1:54321',
        mailboxUrl: 'http://127.0.0.1:54324',
        redirectUrl: 'https://evil.example.com/reset-password',
      })
    ).toThrow(/Unexpected redirect URL/i);

    expect(
      assertIsolatedLocalConfig({
        supabaseUrl: 'http://127.0.0.1:54321',
        mailboxUrl: 'http://127.0.0.1:54324',
        redirectUrl: EXPECTED_RECOVERY_REDIRECT_URL,
      })
    ).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      mailboxUrl: 'http://127.0.0.1:54324',
      redirectUrl: 'http://localhost:3000/reset-password',
    });
  });

  it('aborts the CLI runner immediately when passed a non-local Supabase URL override', () => {
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts/recovery-e2e/runLocalRecoveryE2E.mjs'
    );
    let stderrOutput = '';
    let exitStatus = 0;

    try {
      execFileSync(process.execPath, [scriptPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LOCAL_SUPABASE_URL: 'https://ujkmmuwimaorcpjchtox.supabase.co',
          LOCAL_SUPABASE_ANON_KEY: 'dummy-anon-key',
          LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-key',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      exitStatus = e.status ?? 1;
      stderrOutput = e.stderr ?? '';
    }

    expect(exitStatus).not.toBe(0);
    expect(stderrOutput).toMatch(/REFUSING NON-LOCAL TARGET/i);
  });

  it('generates unique per-run test emails and verifies extract/redaction helpers', () => {
    const emailA = generateUniqueRecoveryEmail();
    const emailB = generateUniqueRecoveryEmail();
    expect(emailA).not.toBe(emailB);
    expect(emailA).toMatch(/^recovery\.teacher\.[a-z0-9-]+@edutrack\.local$/);

    const link = extractRecoveryLinkFromEmail({
      html: `<p><a href="http://127.0.0.1:54321/auth/v1/verify?token=pkce_abc123&amp;type=recovery&amp;redirect_to=http%3A%2F%2Flocalhost%3A3000%2Freset-password">Reset Password</a></p>`,
      text: '',
    });

    expect(link).toBe(
      'http://127.0.0.1:54321/auth/v1/verify?token=pkce_abc123&type=recovery&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Freset-password'
    );

    const sample =
      'Link=http://127.0.0.1:54321/auth/v1/verify?token=secretTok&type=recovery ' +
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.sig123456 ' +
      'pass=SuperSecret#99';

    const redacted = redactSensitive(sample, ['SuperSecret#99']);
    expect(redacted).not.toContain('secretTok');
    expect(redacted).not.toContain('eyJhbGci');
    expect(redacted).not.toContain('SuperSecret#99');
    expect(redacted).toContain('[REDACTED_RECOVERY_URL]');
    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('[REDACTED]');
  });

  it('polls local Mailpit and Inbucket HTTP APIs and refuses non-local mailbox endpoints', async () => {
    await expect(
      pollLocalMailboxForRecoveryLink({
        mailboxUrl: 'https://mail.remote.example.com',
        recipientEmail: 'teacher@edutrack.local',
        timeoutMs: 200,
      })
    ).rejects.toThrow(/REFUSING NON-LOCAL TARGET/i);

    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/v1/messages') {
        res.end(
          JSON.stringify({
            messages: [
              {
                ID: 'mail-rec-1',
                Created: new Date().toISOString(),
                To: [{ Address: 'recovery.teacher.e2e@edutrack.local' }],
              },
            ],
          })
        );
        return;
      }
      if (req.url === '/api/v1/message/mail-rec-1') {
        res.end(
          JSON.stringify({
            HTML: '<a href="http://127.0.0.1:54321/auth/v1/verify?token=t123&amp;type=recovery&amp;redirect_to=http%3A%2F%2Flocalhost%3A3000%2Freset-password">Confirm</a>',
            Text: '',
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      const addr = server.address() as { port: number };
      const res = await pollLocalMailboxForRecoveryLink({
        mailboxUrl: `http://127.0.0.1:${addr.port}`,
        recipientEmail: 'recovery.teacher.e2e@edutrack.local',
        timeoutMs: 3000,
        pollIntervalMs: 50,
      });
      expect(res.provider).toBe('mailpit');
      expect(res.messageId).toBe('mail-rec-1');
      expect(res.link).toBe(
        'http://127.0.0.1:54321/auth/v1/verify?token=t123&type=recovery&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Freset-password'
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('aborts cleanly before creating any account when port 3000 is already in use, leaving the existing service alive', async () => {
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts/recovery-e2e/runLocalRecoveryE2E.mjs'
    );

    const existingPort3000Service = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end('existing-service-ok');
    });

    let boundPort3000 = false;
    try {
      await new Promise<void>((resolve, reject) => {
        existingPort3000Service.once('error', reject);
        existingPort3000Service.listen(3000, '127.0.0.1', () => {
          boundPort3000 = true;
          resolve();
        });
      });
    } catch {
      // Port 3000 already occupied by another local service; assertPortFree should still reject
    }

    const adminRequests: string[] = [];
    const mockSupabase = http.createServer((req, res) => {
      adminRequests.push(`${req.method} ${req.url}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/auth/v1/health') {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.statusCode = 500;
      res.end('{}');
    });
    await new Promise<void>((resolve) => mockSupabase.listen(0, '127.0.0.1', () => resolve()));

    try {
      await expect(assertPortFree(3000, '127.0.0.1')).rejects.toThrow(/Port 3000 is already in use/i);

      const supaAddr = mockSupabase.address() as { port: number };
      let exitCode = 0;
      let stderrOutput = '';
      try {
        await execFileAsync(process.execPath, [scriptPath], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            LOCAL_SUPABASE_URL: `http://127.0.0.1:${supaAddr.port}`,
            LOCAL_SUPABASE_ANON_KEY: 'dummy-anon',
            LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'dummy-service',
            LOCAL_MAILBOX_URL: 'http://127.0.0.1:54324',
          },
        });
      } catch (err) {
        const e = err as { code?: number; stderr?: string };
        exitCode = e.code ?? 1;
        stderrOutput = e.stderr ?? '';
      }

      expect(exitCode).not.toBe(0);
      expect(stderrOutput).toMatch(/Port 3000 is already in use/i);
      expect(adminRequests).toEqual(['GET /auth/v1/health']);

      if (boundPort3000) {
        const checkAlive = await fetch('http://127.0.0.1:3000/');
        expect(checkAlive.status).toBe(200);
        expect(await checkAlive.text()).toBe('existing-service-ok');
      }
    } finally {
      await new Promise<void>((resolve) => mockSupabase.close(() => resolve()));
      if (boundPort3000) {
        await new Promise<void>((resolve) => existingPort3000Service.close(() => resolve()));
      }
    }
  });

  it('cleans up the created auth user when profile provisioning fails and never lists or deletes prior users', async () => {
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts/recovery-e2e/runLocalRecoveryE2E.mjs'
    );

    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const deletedUserIds: string[] = [];
    let createdEmail = '';

    const mockSupabase = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        requests.push({ method: req.method || 'GET', url: req.url || '', body });
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'GET' && req.url === '/auth/v1/health') {
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        if (req.method === 'POST' && req.url === '/auth/v1/admin/users') {
          const parsed = JSON.parse(body || '{}') as { email?: string };
          createdEmail = parsed.email || '';
          res.statusCode = 200;
          res.end(JSON.stringify({ id: 'created-run-user-999' }));
          return;
        }
        if (req.method === 'POST' && req.url === '/rest/v1/profiles') {
          res.statusCode = 500;
          res.end(JSON.stringify({ message: 'Simulated profile insert failure' }));
          return;
        }
        if (req.method === 'DELETE' && req.url === '/auth/v1/admin/users/created-run-user-999') {
          deletedUserIds.push('created-run-user-999');
          res.statusCode = 200;
          res.end('{}');
          return;
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });

    await new Promise<void>((resolve) => mockSupabase.listen(0, '127.0.0.1', () => resolve()));

    try {
      const supaAddr = mockSupabase.address() as { port: number };
      let exitCode = 0;
      let stderrOutput = '';
      try {
        await execFileAsync(process.execPath, [scriptPath], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            LOCAL_SUPABASE_URL: `http://127.0.0.1:${supaAddr.port}`,
            LOCAL_SUPABASE_ANON_KEY: 'dummy-anon',
            LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'dummy-service',
            LOCAL_MAILBOX_URL: 'http://127.0.0.1:54324',
          },
        });
      } catch (err) {
        const e = err as { code?: number; stderr?: string };
        exitCode = e.code ?? 1;
        stderrOutput = e.stderr ?? '';
      }

      expect(exitCode).not.toBe(0);
      expect(stderrOutput).toMatch(/Failed to assign known role "teacher" in profiles/i);
      expect(createdEmail).toMatch(/^recovery\.teacher\.[a-f0-9]+@edutrack\.local$/);
      expect(requests.some((r) => r.method === 'GET' && r.url.startsWith('/auth/v1/admin/users'))).toBe(
        false
      );
      expect(deletedUserIds).toEqual(['created-run-user-999']);
    } finally {
      await new Promise<void>((resolve) => mockSupabase.close(() => resolve()));
    }
  });

  it('fails early if the spawned Vite process exits and verifies runId ownership of the responding server', async () => {
    // 1) Early Vite exit rejects before Chrome opens
    const fakeProc = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as string | null,
      stderr: new EventEmitter(),
    });
    const earlyExitPromise = waitForOwnedViteServer({
      viteProc: fakeProc,
      healthUrl: 'http://127.0.0.1:65500/__recovery_e2e_health',
      expectedRunId: 'run-123',
      timeoutMs: 3000,
    });
    fakeProc.exitCode = 1;
    fakeProc.emit('exit', 1, null);
    await expect(earlyExitPromise).rejects.toThrow(/exited before becoming ready/i);

    // 2) Wrong runId is rejected; matching runId succeeds
    let servedRunId = 'other-run';
    const healthServer = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, runId: servedRunId }));
    });
    await new Promise<void>((resolve) => healthServer.listen(0, '127.0.0.1', () => resolve()));

    try {
      const addr = healthServer.address() as { port: number };
      const liveProc = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as string | null,
        stderr: new EventEmitter(),
      });

      await expect(
        waitForOwnedViteServer({
          viteProc: liveProc,
          healthUrl: `http://127.0.0.1:${addr.port}/__recovery_e2e_health`,
          expectedRunId: 'my-run-id',
          timeoutMs: 600,
        })
      ).rejects.toThrow(/Timed out waiting for this run's isolated Vite server/i);

      servedRunId = 'my-run-id';
      await expect(
        waitForOwnedViteServer({
          viteProc: liveProc,
          healthUrl: `http://127.0.0.1:${addr.port}/__recovery_e2e_health`,
          expectedRunId: 'my-run-id',
          timeoutMs: 2000,
        })
      ).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    }
  });
});
