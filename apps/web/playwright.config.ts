import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/mayochord/`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // 本地直接用已安装的 Chrome，免去下载 Playwright 浏览器；CI 里用 playwright install 的 chromium
      use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'chrome' }) },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/mayochord/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
