import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowserSession } from './cdpBrowser.mjs';
import {
  assertIsolatedLocalConfig,
  assertPortFree,
  cleanupTestUser,
  EXPECTED_RECOVERY_REDIRECT_URL,
  generateUniqueRecoveryEmail,
  pollLocalMailboxForRecoveryLink,
  provisionTeacherAccount,
  redactSensitive,
  VITE_HEALTH_PATH,
  waitForOwnedViteServer,
} from './recoveryHelpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const APP_ORIGIN = 'http://localhost:3000';
const APP_PORT = 3000;
const ARTIFACTS_DIR = path.join(repoRoot, '.tmp', 'recovery-e2e-artifacts');

function resolveLocalSupabaseEnv() {
  const overrideUrl = (process.env.LOCAL_SUPABASE_URL || '').trim();
  const overrideAnon = (process.env.LOCAL_SUPABASE_ANON_KEY || '').trim();
  const overrideService = (process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const overrideMailbox = (process.env.LOCAL_MAILBOX_URL || '').trim();

  if (overrideUrl && overrideAnon && overrideService) {
    return {
      supabaseUrl: overrideUrl,
      anonKey: overrideAnon,
      serviceRoleKey: overrideService,
      mailboxUrl: overrideMailbox || 'http://127.0.0.1:54324',
    };
  }

  let statusRaw = '';
  const commands = process.platform === 'win32'
    ? ['supabase.cmd status -o json', 'npx.cmd supabase status -o json']
    : ['supabase status -o json', 'npx supabase status -o json'];

  for (const cmd of commands) {
    try {
      statusRaw = execSync(cmd, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (statusRaw && statusRaw.trim().startsWith('{')) break;
    } catch {
      // Try next CLI command
    }
  }

  if (!statusRaw || !statusRaw.trim().startsWith('{')) {
    throw new Error(
      'Official local Supabase CLI status is unavailable. Start Docker and run "supabase start" (or "npx supabase start") inside edutrack-portal first.'
    );
  }

  const statusJson = JSON.parse(statusRaw);
  const supabaseUrl = statusJson.API_URL || statusJson.api_url || 'http://127.0.0.1:54321';
  const anonKey = statusJson.ANON_KEY || statusJson.anon_key || '';
  const serviceRoleKey = statusJson.SERVICE_ROLE_KEY || statusJson.service_role_key || '';
  const mailboxUrl =
    overrideMailbox ||
    statusJson.MAILPIT_URL ||
    statusJson.INBUCKET_URL ||
    statusJson.inbucket_url ||
    'http://127.0.0.1:54324';

  if (!anonKey || !serviceRoleKey) {
    throw new Error('Local Supabase status did not return ANON_KEY and SERVICE_ROLE_KEY.');
  }

  return { supabaseUrl, anonKey, serviceRoleKey, mailboxUrl };
}

async function waitForHttp(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Retry until ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Service did not become ready in time: ${url}`);
}

async function main() {
  const { supabaseUrl, anonKey, serviceRoleKey, mailboxUrl } = resolveLocalSupabaseEnv();
  const safeConfig = assertIsolatedLocalConfig({
    supabaseUrl,
    mailboxUrl,
    redirectUrl: EXPECTED_RECOVERY_REDIRECT_URL,
  });

  await waitForHttp(`${safeConfig.supabaseUrl}/auth/v1/health`, 15000);

  // Verify port 3000 is free BEFORE creating any test account; leave any existing service untouched
  await assertPortFree(APP_PORT, '127.0.0.1');

  const runId = crypto.randomBytes(6).toString('hex');
  const testEmail = generateUniqueRecoveryEmail('recovery.teacher', runId);
  const oldPassword = `OldPass-${crypto.randomBytes(6).toString('hex')}!1`;
  const newPassword = `NewPass-${crypto.randomBytes(6).toString('hex')}!2`;
  const secrets = [oldPassword, newPassword, anonKey, serviceRoleKey];

  let viteProc = null;
  let browser = null;
  let userId = null;

  const steps = [];
  const logStep = (name, detail) => {
    const cleanDetail = redactSensitive(detail, secrets);
    steps.push({ step: name, status: 'PASSED', detail: cleanDetail });
    console.log(`[PASS] ${name}: ${cleanDetail}`);
  };

  try {
    await provisionTeacherAccount({
      supabaseUrl: safeConfig.supabaseUrl,
      serviceRoleKey,
      email: testEmail,
      initialPassword: oldPassword,
      onUserCreated: (createdId) => {
        userId = createdId;
      },
    });
    logStep(
      '1. Provision Known-Role Local Account',
      `Created unique verified teacher account on ${safeConfig.supabaseUrl}`
    );

    const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const viteConfig = path.join(__dirname, 'vite.recovery.config.mjs');
    viteProc = spawn(process.execPath, [viteCli, '--config', viteConfig], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECOVERY_E2E_SUPABASE_URL: safeConfig.supabaseUrl,
        RECOVERY_E2E_SUPABASE_ANON_KEY: anonKey,
        RECOVERY_E2E_PORT: String(APP_PORT),
        RECOVERY_E2E_RUN_ID: runId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForOwnedViteServer({
      viteProc,
      healthUrl: `${APP_ORIGIN}${VITE_HEALTH_PATH}`,
      expectedRunId: runId,
      timeoutMs: 25000,
    });
    logStep('2. Isolated Vite App Started', `Owned Vite server running at ${APP_ORIGIN} independent of .env`);

    browser = await launchBrowserSession();

    // Step 3: Request password recovery from Forgot password?
    const requestTimeMs = Date.now();
    const tab1 = await browser.openTab(`${APP_ORIGIN}/`);
    await tab1.waitForText('Sign In to EduTrack');
    await tab1.clickButtonByText('Forgot password?');
    await tab1.waitForSelector('#resetEmailInput');
    await tab1.fillInput('#resetEmailInput', testEmail);
    await tab1.clickSelector('[data-testid="send-reset-link-button"]');
    await tab1.waitForSelector('[data-testid="reset-request-sent-banner"]');
    await tab1.captureRedactedScreenshot(path.join(ARTIFACTS_DIR, '01-reset-requested.png'));
    logStep('3. Forgot Password Request Sent', 'Generic confirmation rendered in Tab 1');

    // Step 4: Poll local Mailpit/Inbucket mailbox specifically for this run's unique email
    const mailResult = await pollLocalMailboxForRecoveryLink({
      mailboxUrl: safeConfig.mailboxUrl,
      recipientEmail: testEmail,
      minCreatedAtMs: requestTimeMs,
    });
    const parsedMailLink = new URL(mailResult.link);
    logStep(
      '4. Recovery Email Received in Local Mailbox',
      `Received via ${mailResult.provider}; target path=${parsedMailLink.pathname} (token redacted)`
    );

    // Step 5: Open real recovery link in a NEW tab -> update password -> sign out to login
    const tab2 = await browser.openTab(mailResult.link);
    await tab2.waitForSelector('[data-testid="password-recovery-form-card"]');
    await tab2.captureRedactedScreenshot(path.join(ARTIFACTS_DIR, '02-recovery-form-tab2.png'));
    await tab2.fillInput('#newPasswordInput', newPassword);
    await tab2.fillInput('#confirmPasswordInput', newPassword);
    await tab2.clickSelector('[data-testid="update-password-submit"]');
    await tab2.waitForSelector('[data-testid="auth-notice-banner"]');
    logStep('5. Password Updated in New Tab', 'Returned cleanly to Sign In with update confirmation notice');

    // Step 6: Verify OLD password is rejected
    await tab2.fillInput('#emailInput', testEmail);
    await tab2.fillInput('#passwordInput', oldPassword);
    await tab2.clickButtonByText('Sign In to EduTrack');
    await tab2.waitForFunction(
      `return Boolean(document.body.innerText.match(/Invalid login credentials|Invalid email or password/i));`
    );
    await tab2.captureRedactedScreenshot(path.join(ARTIFACTS_DIR, '03-old-password-rejected.png'));
    logStep('6. Old Password Rejected', 'Login with previous password rejected as expected');

    // Step 7: Sign in with NEW password -> verify known role portal (Teacher Portal)
    await tab2.fillInput('#passwordInput', newPassword);
    await tab2.clickButtonByText('Sign In to EduTrack');
    await tab2.waitForSelector('[data-testid="role-portal-teacher"]');
    const roleText = await tab2.evaluate(
      `document.querySelector('[data-testid="portal-user-role"]')?.textContent?.trim() || ''`
    );
    if (roleText !== 'teacher') {
      throw new Error(`Expected role badge "teacher", got "${roleText}"`);
    }
    await tab2.captureRedactedScreenshot(path.join(ARTIFACTS_DIR, '04-teacher-portal-login.png'));
    logStep('7. Login Succeeded with New Password', 'Teacher Portal rendered with verified role "teacher"');

    // Sign out before verifying reused link in Tab 3
    await tab2.clickButtonByText('Sign Out');
    await tab2.waitForText('Sign In to EduTrack');

    // Step 8: Re-open the exact same used recovery link in a fresh Tab 3
    const tab3 = await browser.openTab(mailResult.link);
    await tab3.waitForSelector('[data-testid="recovery-invalid-screen"]');
    await tab3.captureRedactedScreenshot(path.join(ARTIFACTS_DIR, '05-reused-link-rejected.png'));
    logStep('8. Reused Recovery Link Rejected', 'Re-opening consumed recovery link displayed Reset Link Invalid or Expired');

    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'report.json'),
      JSON.stringify({ passed: true, redirectUrl: safeConfig.redirectUrl, steps }, null, 2)
    );
    console.log('\nALL LOCAL SUPABASE PASSWORD RECOVERY E2E STEPS PASSED.');
  } finally {
    if (browser) {
      await browser.close();
    }
    if (viteProc && !viteProc.killed) {
      viteProc.kill('SIGTERM');
    }
    await cleanupTestUser({
      supabaseUrl: safeConfig.supabaseUrl,
      serviceRoleKey,
      userId,
    });
  }
}

main().catch((err) => {
  console.error(redactSensitive(`\n[LOCAL RECOVERY E2E FAILED] ${err?.message || err}`));
  process.exit(1);
});
