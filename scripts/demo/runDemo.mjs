import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const HOST = '127.0.0.1';
const BRIDGE_PORT = Number(process.env.DEMO_BRIDGE_PORT || 54399);
const WEB_PORT = Number(process.env.DEMO_WEB_PORT || 4179);
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || 'demo-password';
const BRIDGE_URL = `http://${HOST}:${BRIDGE_PORT}`;
const WEB_URL = `http://${HOST}:${WEB_PORT}`;

const bridgeScript = path.join(__dirname, 'demoBridge.mjs');
const viteConfig = path.join(__dirname, 'vite.demo.config.mjs');
const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const cardPath = path.join(__dirname, 'et-f-101-card.png');

if (!fs.existsSync(viteCli)) {
  console.error(`Error: Vite CLI not found at ${viteCli}. Run npm install first.`);
  process.exit(1);
}

let bridgeProc = null;
let viteProc = null;
let shuttingDown = false;

function killProcessTree(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore cleanup failures
    }
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killProcessTree(viteProc);
  killProcessTree(bridgeProc);
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  console.log('\nStopping EduTrack local demo services...');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));
process.on('SIGBREAK', () => shutdown(0));

function httpGetStatus(targetUrl) {
  return new Promise((resolve) => {
    const req = http.get(targetUrl, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function waitForService(name, checkUrl, proc, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`${name} exited prematurely with code ${proc.exitCode}`);
    }
    const status = await httpGetStatus(checkUrl);
    if (status >= 200 && status < 400) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${name} at ${checkUrl}`);
}

console.log('Starting EduTrack local demo (isolated in-memory PGlite + Vite on 127.0.0.1)...');

bridgeProc = spawn(process.execPath, [bridgeScript], {
  cwd: repoRoot,
  env: {
    ...process.env,
    DEMO_BRIDGE_PORT: String(BRIDGE_PORT),
    DEMO_USER_PASSWORD: DEMO_PASSWORD,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

bridgeProc.stderr.on('data', (chunk) => {
  process.stderr.write(`[demo-bridge] ${chunk}`);
});

bridgeProc.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`\nError: PGlite bridge stopped unexpectedly (exit code ${code ?? 'unknown'}). Stopping demo.`);
    shutdown(1);
  }
});

try {
  await waitForService('PGlite Bridge', `${BRIDGE_URL}/health`, bridgeProc, 25000);
} catch (err) {
  console.error(`\nFailed to start PGlite Bridge: ${err.message}`);
  shutdown(1);
}

viteProc = spawn(process.execPath, [viteCli, '--config', viteConfig], {
  cwd: repoRoot,
  env: {
    ...process.env,
    DEMO_BRIDGE_URL: BRIDGE_URL,
    DEMO_ANON_KEY: 'edutrack-local-demo-anon-key',
    DEMO_WEB_PORT: String(WEB_PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

viteProc.stderr.on('data', (chunk) => {
  process.stderr.write(`[demo-vite] ${chunk}`);
});

viteProc.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`\nError: Vite dev server stopped unexpectedly (exit code ${code ?? 'unknown'}). Stopping demo.`);
    shutdown(1);
  }
});

try {
  await waitForService('Vite Dev Server', `${WEB_URL}/`, viteProc, 25000);
} catch (err) {
  console.error(`\nFailed to start Vite Dev Server: ${err.message}`);
  shutdown(1);
}

console.log('');
console.log('========================================================================');
console.log('  EDUTRACK LOCAL DEMO READY (Fresh Seeded Session)');
console.log('========================================================================');
console.log(`  Open Browser URL : ${WEB_URL}`);
console.log(`  PGlite Bridge    : ${BRIDGE_URL}`);
console.log(`  Seeded Group     : Physics Group F1 (Teacher: Mr. Rami Physics)`);
console.log(`  Seeded Student   : Youssef Tariq (Code: ET-F-101 | QR: QR-STAGEF-101)`);
console.log(`  QR Card Image    : ${cardPath}`);
console.log('------------------------------------------------------------------------');
console.log('  Demo Accounts (Password for all 4 roles: ' + DEMO_PASSWORD + ')');
console.log('    1. Admin   : admin.demo@edutrack.local');
console.log('    2. Teacher : teacher.demo@edutrack.local');
console.log('    3. Student : student.demo@edutrack.local');
console.log('    4. Parent  : parent.demo@edutrack.local');
console.log('------------------------------------------------------------------------');
console.log('  Ready to enter live during demo: Today Attendance, 18/20 Grade, 2 Notes');
console.log('  Note: If switching browsers or restarting demo, Sign Out first.');
console.log('  Press Ctrl+C to stop both services (next start resets to clean state).');
console.log('========================================================================');
console.log('');
