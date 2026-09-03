import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  collectFrontendNoticeEntries,
  renderFrontendNotices,
  validateLicenseIdentifiers,
} from "./generate-notices.mjs"

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const frontendDirectory = path.resolve(scriptsDirectory, "..")

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function writePackage(root, packagePath, packageJson, licenseText) {
  const directory = path.join(root, "node_modules", packagePath)
  await mkdir(directory, { recursive: true })
  await writeJson(path.join(directory, "package.json"), packageJson)
  await writeFile(path.join(directory, "LICENSE"), licenseText, "utf8")
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "flowscope-notices-"))
  const packageLock = {
    name: "fixture-frontend",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "fixture-frontend",
        version: "1.0.0",
        private: true,
        dependencies: {
          cytoscape: "3.34.2",
          "duplicate-parent-a": "1.0.0",
          "duplicate-parent-b": "1.0.0",
          react: "19.2.8",
        },
        devDependencies: {
          "@playwright/test": "1.62.1",
          vitest: "4.1.11",
        },
      },
      "node_modules/cytoscape": { version: "3.34.2" },
      "node_modules/duplicate-parent-a": { version: "1.0.0" },
      "node_modules/duplicate-parent-b": { version: "1.0.0" },
      "node_modules/react": { version: "19.2.8" },
      "node_modules/shared-license": { version: "2.0.0" },
      "node_modules/@playwright/test": { version: "1.62.1", dev: true },
      "node_modules/vitest": { version: "4.1.11", dev: true },
    },
  }
  await writeJson(path.join(root, "package.json"), packageLock.packages[""])
  await writeJson(path.join(root, "package-lock.json"), packageLock)

  const mitText = "MIT License\r\n\r\nCopyright (c) 2026 Fixture Authors\r\n\r\nPermission is hereby granted.\r\n"
  await writePackage(root, "react", {
    name: "react", version: "19.2.8", license: "MIT",
    repository: "https://example.test/react",
  }, mitText)
  await writePackage(root, "cytoscape", {
    name: "cytoscape", version: "3.34.2", license: "MIT",
    repository: "https://example.test/cytoscape",
  }, mitText)
  await writePackage(root, "duplicate-parent-a", {
    name: "duplicate-parent-a", version: "1.0.0", license: "MIT",
    repository: "https://example.test/a", dependencies: { "shared-license": "2.0.0" },
  }, mitText)
  await writePackage(root, "duplicate-parent-b", {
    name: "duplicate-parent-b", version: "1.0.0", license: "MIT",
    repository: "https://example.test/b", dependencies: { "shared-license": "2.0.0" },
  }, mitText)
  await writePackage(root, "shared-license", {
    name: "shared-license", version: "2.0.0", license: "MIT",
    repository: "https://example.test/shared",
  }, mitText)
  await writePackage(root, "@playwright/test", {
    name: "@playwright/test", version: "1.62.1", license: "Apache-2.0",
    repository: "https://example.test/playwright",
  }, "Apache License\r\nVersion 2.0\r\n")
  await writePackage(root, "vitest", {
    name: "vitest", version: "4.1.11", license: "MIT",
    repository: "https://example.test/vitest",
  }, mitText)
  return root
}

test("generates deterministic production-only notices from local dependency metadata", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture, { recursive: true, force: true }))

  const entries = await collectFrontendNoticeEntries(fixture)
  const report = renderFrontendNotices(entries)
  const packageIds = entries.map((entry) => `${entry.name}@${entry.version}`)

  assert.deepEqual(packageIds, [...packageIds].sort())
  assert.deepEqual(packageIds, [
    "cytoscape@3.34.2",
    "duplicate-parent-a@1.0.0",
    "duplicate-parent-b@1.0.0",
    "react@19.2.8",
    "shared-license@2.0.0",
  ])
  assert.equal(packageIds.filter((id) => id === "shared-license@2.0.0").length, 1)
  assert.doesNotMatch(report, /@playwright\/test@1\.62\.1|vitest@4\.1\.11/)
  assert.match(report, /react 19\.2\.8/)
  assert.match(report, /cytoscape 3\.34\.2/)
  assert.match(report, /License: MIT/)
  assert.match(report, /Repository: https:\/\/example\.test\/react/)
  assert.match(report, /Copyright: Copyright \(c\) 2026 Fixture Authors/)
  assert.match(report, /Permission is hereby granted\./)
  assert.doesNotMatch(report, /\r|flowscope-notices-|node_modules\\|node_modules\//)
})

test("rejects every missing, blank, unknown, or unlicensed license identifier", () => {
  for (const license of [
    undefined,
    null,
    "",
    "UNKNOWN",
    "UNLICENSED",
    "MIT OR UNKNOWN",
    ["MIT", "UNKNOWN"],
    ["MIT", "UNLICENSED"],
    ["MIT", ""],
    ["MIT", undefined],
    { type: "MIT", name: "UNKNOWN" },
    { type: "MIT", name: "UNLICENSED" },
    { type: "MIT", name: undefined },
    { type: "UNLICENSED" },
    { name: "" },
    {},
  ]) {
    assert.throws(
      () => validateLicenseIdentifiers(license, "fixture@1.0.0"),
      /Production package fixture@1\.0\.0 has no detectable license identifier/,
    )
  }
})

test("rejects empty, missing, and unreadable local production license text", async (t) => {
  const emptyFixture = await createFixture()
  const missingFixture = await createFixture()
  const unreadableFixture = await createFixture()
  t.after(() => Promise.all([
    rm(emptyFixture, { recursive: true, force: true }),
    rm(missingFixture, { recursive: true, force: true }),
    rm(unreadableFixture, { recursive: true, force: true }),
  ]))

  await writeFile(path.join(emptyFixture, "node_modules", "react", "LICENSE"), "", "utf8")
  await rm(path.join(missingFixture, "node_modules", "react", "LICENSE"))
  const unreadableLicensePath = path.join(unreadableFixture, "node_modules", "react", "LICENSE")
  await rm(unreadableLicensePath)
  await mkdir(unreadableLicensePath)

  await assert.rejects(
    () => collectFrontendNoticeEntries(emptyFixture),
    /Production package react@19\.2\.8 has no readable local license file/,
  )
  await assert.rejects(
    () => collectFrontendNoticeEntries(missingFixture),
    /Production package react@19\.2\.8 has no readable local license file/,
  )
  await assert.rejects(
    () => collectFrontendNoticeEntries(unreadableFixture),
    /Production package react@19\.2\.8 has no readable local license file/,
  )
})

test("wraps actual license reads separately from missing license metadata", async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "flowscope-notice-read-error-"))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const licenseDirectory = path.join(fixture, "node_modules", "react", "LICENSE")
  await mkdir(licenseDirectory, { recursive: true })
  const metadata = {
    licenses: "MIT",
    repository: "https://example.test/react",
    licenseFile: licenseDirectory,
  }
  const packageCollector = async () => ({ "react@19.2.8": metadata })

  await assert.rejects(
    () => collectFrontendNoticeEntries(fixture, { packageCollector }),
    (error) => {
      assert.match(error.message, /Production package react@19\.2\.8 has no readable local license file/)
      assert.ok(error.cause instanceof Error)
      return true
    },
  )
  await assert.rejects(
    () => collectFrontendNoticeEntries(fixture, {
      packageCollector: async () => ({ "react@19.2.8": { ...metadata, licenseFile: undefined } }),
    }),
    (error) => {
      assert.match(error.message, /Production package react@19\.2\.8 has no readable local license file/)
      assert.equal(error.cause, undefined)
      return true
    },
  )
})

test("reports the installed production graph without frontend test tools", async () => {
  const entries = await collectFrontendNoticeEntries(frontendDirectory)
  const report = renderFrontendNotices(entries)

  assert.match(report, /react 19\.2\.8/)
  assert.match(report, /cytoscape 3\.34\.2/)
  assert.doesNotMatch(report, /@playwright\/test 1\.62\.1|vitest 4\.1\.11/)
  assert.ok(entries.every((entry) => entry.license))
  assert.ok(entries.every((entry) => entry.repository))
  assert.ok(entries.every((entry) => entry.licenseText.length > 0))

  const packageJson = JSON.parse(await readFile(path.join(frontendDirectory, "package.json"), "utf8"))
  assert.ok(packageJson.dependencies.react)
})
