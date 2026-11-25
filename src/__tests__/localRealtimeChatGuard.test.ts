import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { redactSensitive } from '../../scripts/recovery-e2e/recoveryHelpers.mjs';

describe('Local Supabase Realtime Chat Verification Guards', () => {
  it('aborts the CLI runner immediately when passed a non-local Supabase URL override', () => {
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts/chat/verifyLocalRealtimeChat.mjs'
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

  it('redacts credentials and message secrets from error text', () => {
    const output = redactSensitive(
      'Failed with password SecretPass!1 and message RT-MSG-1-abc and token Bearer abcdef123456',
      ['SecretPass!1', 'RT-MSG-1-abc']
    );
    expect(output).not.toContain('SecretPass!1');
    expect(output).not.toContain('RT-MSG-1-abc');
    expect(output).not.toContain('abcdef123456');
  });
});
