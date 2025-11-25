import { defineConfig } from 'vitest/config';

const isDogfood = process.env.DOGFOOD === 'true';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    reporters: isDogfood ? [['./src/index.ts', { dryRun: false, dsn: 'https://0f83c297b5334b5c19f0d46b20559dc8@o386323.ingest.us.sentry.io/4509983571902464' }]] : ['default'],
  },
});


