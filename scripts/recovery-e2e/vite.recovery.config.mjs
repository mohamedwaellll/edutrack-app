import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertLocalUrl, VITE_HEALTH_PATH } from './recoveryHelpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const reactMod = require('@vitejs/plugin-react');
const react = reactMod.default || reactMod;

const localSupabaseUrl = assertLocalUrl(
  process.env.RECOVERY_E2E_SUPABASE_URL || 'http://127.0.0.1:54321',
  'RECOVERY_E2E_SUPABASE_URL'
);
const localAnonKey = (process.env.RECOVERY_E2E_SUPABASE_ANON_KEY || '').trim();
if (!localAnonKey) {
  throw new Error('RECOVERY_E2E_SUPABASE_ANON_KEY must be set by runLocalRecoveryE2E.mjs.');
}
const webPort = Number(process.env.RECOVERY_E2E_PORT || 3000);
const runId = (process.env.RECOVERY_E2E_RUN_ID || '').trim();

export default {
  root: repoRoot,
  envDir: path.join(__dirname, 'empty-env'),
  plugins: [
    react(),
    {
      name: 'recovery-e2e-health',
      configureServer(server) {
        server.middlewares.use(VITE_HEALTH_PATH, (_req, res) => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, runId }));
        });
      },
    },
  ],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(localSupabaseUrl),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(localAnonKey),
  },
  server: {
    host: 'localhost',
    port: webPort,
    strictPort: true,
    open: false,
  },
};
