import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc' },
            remoteBindings: false,
            miniflare: {
              bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
            },
          })),
        ],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
          setupFiles: ['test/worker/setup.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['test/ui/**/*.test.{ts,tsx}'],
          setupFiles: ['test/ui/setup.ts'],
        },
      },
    ],
  },
});
