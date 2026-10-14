import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/web'],
    coverage: {
      provider: 'v8',
      // 覆盖率门槛只约束 core（规格第 14 节：90% 以上）
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/events.ts', '**/device-profile.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
