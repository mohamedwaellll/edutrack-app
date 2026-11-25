import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findBrowserExecutable() {
  const fromEnv = (process.env.CHROME_PATH || process.env.BROWSER_PATH || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'No Chromium/Chrome executable found. Install Google Chrome/Chromium or set CHROME_PATH.'
  );
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(`CDP error (${msg.error.code}): ${msg.error.message}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON CDP notifications
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 20000);
      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

export async function launchBrowserSession() {
  const executable = findBrowserExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edutrack-recovery-e2e-'));
  const proc = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  const wsUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome DevTools WebSocket timed out')), 15000);
    let stderrBuf = '';
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const m = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s]+)/i);
      if (m) {
        clearTimeout(timeout);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Browser exited early with code ${code}: ${stderrBuf.slice(-300)}`));
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (err) => reject(err), { once: true });
  });

  const cdp = new CdpSession(ws);

  async function openTab(url) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);

    const tab = {
      targetId,
      sessionId,
      async evaluate(expression) {
        const res = await cdp.send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId
        );
        if (res?.exceptionDetails) {
          throw new Error(
            res.exceptionDetails.text ||
              res.exceptionDetails.exception?.description ||
              'Browser evaluation error'
          );
        }
        return res?.result?.value;
      },
      async waitForFunction(fnBody, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const val = await tab.evaluate(`(() => { ${fnBody} })()`);
          if (val) return val;
          await sleep(150);
        }
        throw new Error(`Timed out waiting for condition in tab: ${fnBody.slice(0, 120)}`);
      },
      async waitForSelector(selector, timeoutMs = 15000) {
        return tab.waitForFunction(
          `return Boolean(document.querySelector(${JSON.stringify(selector)}));`,
          timeoutMs
        );
      },
      async waitForText(substr, timeoutMs = 15000) {
        return tab.waitForFunction(
          `const t = document.body?.innerText || ''; return t.includes(${JSON.stringify(substr)});`,
          timeoutMs
        );
      },
      async fillInput(selector, value) {
        const ok = await tab.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          desc.set.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        if (!ok) throw new Error(`Input not found: ${selector}`);
      },
      async clickSelector(selector) {
        const ok = await tab.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el || el.disabled) return false;
          el.click();
          return true;
        })()`);
        if (!ok) throw new Error(`Clickable element not found or disabled: ${selector}`);
      },
      async clickButtonByText(buttonText) {
        const ok = await tab.evaluate(`(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const match = btns.find((b) => !b.disabled && (b.innerText || '').trim().includes(${JSON.stringify(buttonText)}));
          if (!match) return false;
          match.click();
          return true;
        })()`);
        if (!ok) throw new Error(`Button containing "${buttonText}" not found or disabled`);
      },
      async captureRedactedScreenshot(filePath) {
        // Mask any visible email inputs before screenshot capture so zero PII/secrets appear in PNGs
        await tab.evaluate(`(() => {
          document.querySelectorAll('input').forEach((inp) => {
            if (inp.type !== 'password' && inp.value && inp.value.includes('@')) {
              inp.dataset.origValue = inp.value;
              inp.value = '***@***.local';
            }
          });
        })()`);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
        await tab.evaluate(`(() => {
          document.querySelectorAll('input[data-orig-value]').forEach((inp) => {
            inp.value = inp.dataset.origValue;
            delete inp.dataset.origValue;
          });
        })()`);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
      },
      async close() {
        await cdp.send('Target.closeTarget', { targetId });
      },
    };

    await tab.waitForFunction('return document.readyState === "complete";', 15000);
    return tab;
  }

  async function close() {
    try {
      ws.close();
    } catch {
      // Ignore close errors
    }
    try {
      proc.kill('SIGTERM');
    } catch {
      // Ignore kill errors
    }
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup contention on Windows
    }
  }

  return { openTab, close };
}
