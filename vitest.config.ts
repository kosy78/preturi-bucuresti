import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['collector/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
  },
});
