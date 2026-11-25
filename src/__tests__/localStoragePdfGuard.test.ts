import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import {
  createLoopbackNoRedirectFetch,
  downloadSignedPdfWithLoopbackGuard,
  resolveLocalSupabaseStorageEnv,
} from '../../scripts/assignments/verifyLocalStoragePdf.mjs';

describe('Local Supabase Storage PDF Smoke Guards', () => {
  it('preserves the signed query when following a loopback redirect', async () => {
    const initialUrl = 'http://127.0.0.1:54321/storage/v1/object/sign/test.pdf?token=first';
    const redirectedUrl = 'http://127.0.0.1:54321/storage/v1/object/sign/test.pdf?token=second';
    const fetchedUrls: string[] = [];
    const fetchSignedFile = async (url: string) => {
      fetchedUrls.push(url);
      if (url === initialUrl) {
        return new Response(null, {
          status: 302,
          headers: { location: '?token=second' },
        });
      }
      return new Response('%PDF-1.4');
    };

    const bytes = await downloadSignedPdfWithLoopbackGuard(initialUrl, fetchSignedFile);

    expect(fetchedUrls).toEqual([initialUrl, redirectedUrl]);
    expect(bytes.toString()).toBe('%PDF-1.4');
  });

  it('accepts loopback env overrides and rejects non-loopback targets', () => {
    const resolved = resolveLocalSupabaseStorageEnv({
      LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321',
      LOCAL_SUPABASE_ANON_KEY: 'anon-placeholder',
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder',
    });
    expect(resolved.supabaseUrl).toBe('http://127.0.0.1:54321');

    expect(() =>
      resolveLocalSupabaseStorageEnv({
        LOCAL_SUPABASE_URL: 'https://remote.supabase.co',
        LOCAL_SUPABASE_ANON_KEY: 'anon-placeholder',
        LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder',
      })
    ).toThrow(/REFUSING NON-LOCAL TARGET/i);
  });

  it('rejects signed download URLs or redirects off loopback', async () => {
    await expect(
      downloadSignedPdfWithLoopbackGuard('https://evil.example.com/object.pdf')
    ).rejects.toThrow(/REFUSING NON-LOCAL TARGET/i);

    const redirectFetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example.com/leaked.pdf' },
      });

    await expect(
      downloadSignedPdfWithLoopbackGuard(
        'http://127.0.0.1:54321/storage/v1/object/sign/assignment-attachments/a.pdf?token=abc',
        redirectFetch
      )
    ).rejects.toThrow(/REFUSING NON-LOCAL TARGET/i);
  });

  it('aborts the CLI runner immediately when passed a non-local Supabase URL override', () => {
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts/assignments/verifyLocalStoragePdf.mjs'
    );
    let stderrOutput = '';
    let exitStatus = 0;

    try {
      execFileSync(process.execPath, [scriptPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LOCAL_SUPABASE_URL: 'https://remote.supabase.co',
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

  it('configures SDK fetch to reject redirects, non-loopback URLs, and hung requests', async () => {
    let seenRedirectMode: RequestRedirect | undefined;
    const sdkFetch = createLoopbackNoRedirectFetch({
      timeoutMs: 25,
      fetchImpl: async (_input, init) => {
        seenRedirectMode = init?.redirect;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    const okRes = await sdkFetch('http://127.0.0.1:54321/rest/v1/teachers');
    expect(okRes.status).toBe(200);
    expect(seenRedirectMode).toBe('error');

    await expect(sdkFetch('https://evil.example.com/rest/v1/teachers')).rejects.toThrow(
      /REFUSING NON-LOCAL TARGET/i
    );

    const slowFetch = createLoopbackNoRedirectFetch({
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason ?? new Error('aborted'));
          });
        }),
    });

    await expect(slowFetch('http://127.0.0.1:54321/rest/v1/teachers')).rejects.toThrow(
      /timed out/i
    );
  });

  it('enforces bounded request timeouts on signed PDF downloads', async () => {
    const slowSignedFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('aborted'));
        });
      });

    await expect(
      downloadSignedPdfWithLoopbackGuard(
        'http://127.0.0.1:54321/storage/v1/object/sign/assignment-attachments/a.pdf?token=abc',
        slowSignedFetch,
        20
      )
    ).rejects.toThrow(/timed out/i);
  });

  it('provisions admin, links accounts via admin RPCs, and gates PASS on cleanup', () => {
    const scriptSource = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/assignments/verifyLocalStoragePdf.mjs'),
      'utf8'
    );

    expect(scriptSource).toContain("rpc('provision_admin'");
    expect(scriptSource).toContain("'link_teacher_account'");
    expect(scriptSource).toContain("'link_student_account'");
    expect(scriptSource).toContain("'link_parent_student'");
    expect(scriptSource).not.toMatch(/\.from\('teachers'\)\s*\.insert\(\{[^}]*user_id:/s);
    expect(scriptSource).not.toMatch(/\.from\('students'\)\s*\.insert\(\{[^}]*user_id:/s);
    expect(scriptSource).toContain('Smoke cleanup failed');
    const finallyIdx = scriptSource.lastIndexOf('} finally {');
    const passIdx = scriptSource.indexOf('PASS: Local Storage PDF smoke test succeeded');
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(passIdx).toBeGreaterThan(finallyIdx);
  });
});
