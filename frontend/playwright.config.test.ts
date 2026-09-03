import { expect, it } from "vitest"

import { createPlaywrightConfig } from "./playwright.config"

it("normalizes an external FLOWSCOPE_E2E_ORIGIN to its URL origin and omits the local launcher", () => {
  const config = createPlaywrightConfig("http://127.0.0.1:19123/app/?capability=ignored")

  expect(config.use?.baseURL).toBe("http://127.0.0.1:19123/app/")
  expect(config.webServer).toBeUndefined()
})

it("uses the matching default origin for both baseURL and the local launcher", () => {
  const config = createPlaywrightConfig(undefined)

  expect(config.use?.baseURL).toBe("http://127.0.0.1:17777/app/")
  expect(config.webServer).toMatchObject({ url: "http://127.0.0.1:17777/app/" })
})
