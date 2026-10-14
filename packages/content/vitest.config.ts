import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'content',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
