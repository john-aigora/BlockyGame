import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  // Bounded parallelism (plan 017): game-driving specs race the live
  // simulation, and at the default worker count (cpus/2 = 5 here) headless
  // software-GL rendering plus always-on trace/video capture starves frames
  // enough that scripted scenes die mid-test (learnings.md load-flake trap).
  // 4 workers keeps the full suite ~4 min while restoring frame headroom.
  workers: 4,
  // Failure artifacts only (plan 017): green runs stay lean; a red run leaves
  // a trace + screenshot + video under test-results/ for diagnosis.
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI
  }
});
