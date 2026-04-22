import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 * 默认仅跑 Chromium，降低本机安装浏览器体积；CI 可按需扩展 `projects`。
 *
 * 两种运行入口：
 * - `ng e2e demo`：由 Angular 的 `devServerTarget` 起 dev-server，再跑 Playwright。
 * - `npx playwright test` / `playwright test --ui`：使用下方 `webServer` 自己起 `ng serve demo`。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'github' : 'html',
  use: {
    baseURL: process.env['PLAYWRIGHT_TEST_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  /**
   * `reuseExistingServer: true` 让 `ng e2e demo` 起的 dev-server 可以被 Playwright 复用；
   * 如果你独立用 `npx playwright test`，本项也会自动拉起 `npm run start`。
   */
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
