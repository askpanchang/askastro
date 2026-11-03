import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Workers AI has no local emulator: the AI binding always calls Cloudflare and
// needs `wrangler login` (or CLOUDFLARE_API_TOKEN). Set CF_REMOTE_BINDINGS=false
// (`npm run dev:local`) to run fully offline; AI calls then fail, everything else works.
const remoteBindings = process.env.CF_REMOTE_BINDINGS !== 'false';

export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings }), tailwindcss()],
});
