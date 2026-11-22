import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const reactMod = require('@vitejs/plugin-react');
const react = reactMod.default || reactMod;

const bridgeUrl = process.env.DEMO_BRIDGE_URL || 'http://127.0.0.1:54399';
const anonKey = process.env.DEMO_ANON_KEY || 'edutrack-local-demo-anon-key';
const webPort = Number(process.env.DEMO_WEB_PORT || 4179);

export default {
  root: repoRoot,
  envDir: path.join(__dirname, 'empty-env'),
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(bridgeUrl),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anonKey),
  },
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    open: false,
  },
};
