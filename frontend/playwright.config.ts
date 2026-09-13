import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test"

const defaultOrigin = "http://127.0.0.1:17777"

export function createPlaywrightConfig(externalOrigin: string | undefined = process.env.FLOWSCOPE_E2E_ORIGIN): PlaywrightTestConfig {
  const origin = new URL(externalOrigin ?? defaultOrigin).origin
  const baseURL = `${origin}/app/`
  return defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    retries: 1,
    use: {
      ...devices["Desktop Chrome"],
      browserName: "chromium",
      baseURL,
      trace: "on-first-retry",
    },
    webServer: externalOrigin === undefined ? {
      command: "node scripts/start-e2e-server.mjs",
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    } : undefined,
  })
}

export default createPlaywrightConfig()
