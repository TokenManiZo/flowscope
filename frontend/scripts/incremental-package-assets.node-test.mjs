import assert from "node:assert/strict"
import test from "node:test"

import {
  assertRestoredBuildCss,
  selectSecondBuildCss,
  surfaceVerificationAndRecoveryErrors,
} from "./incremental-package-assets.mjs"

test("rejects an ambiguous second-build indexed CSS collection", () => {
  const firstCss = "web/app/assets/index-first.css"
  const secondEntries = [
    "web/app/assets/index-second.css",
    "web/app/assets/index-duplicate.css",
  ]

  assert.throws(
    () => selectSecondBuildCss(firstCss, secondEntries, ["index-second.css"]),
    /exactly one indexed CSS asset/,
  )
})

test("rejects second-build classpath CSS that disagrees with the shaded JAR", () => {
  assert.throws(
    () => selectSecondBuildCss(
      "web/app/assets/index-first.css",
      ["web/app/assets/index-second.css"],
      ["index-other.css"],
    ),
    /disagrees with shaded JAR/,
  )
})

test("accepts only restored-source artifacts after recovery", () => {
  assert.doesNotThrow(() => assertRestoredBuildCss(
    "web/app/assets/index-restored.css",
    ["web/app/assets/index-mutated.css"],
    ["web/app/assets/index-restored.css"],
    ["index-restored.css"],
  ))
})

test("rejects mutated CSS retained in the recovery shaded JAR", () => {
  assert.throws(
    () => assertRestoredBuildCss(
      "web/app/assets/index-restored.css",
      ["web/app/assets/index-mutated.css"],
      ["web/app/assets/index-restored.css", "web/app/assets/index-mutated.css"],
      ["index-restored.css"],
    ),
    /Recovery shaded JAR must contain exactly one indexed CSS asset; found: web\/app\/assets\/index-restored\.css, web\/app\/assets\/index-mutated\.css/,
  )
})

test("rejects mutated CSS retained in the recovery classpath assets", () => {
  assert.throws(
    () => assertRestoredBuildCss(
      "web/app/assets/index-restored.css",
      ["web/app/assets/index-mutated.css"],
      ["web/app/assets/index-restored.css"],
      ["index-restored.css", "index-mutated.css"],
    ),
    /Recovery classpath assets must contain exactly one indexed CSS asset; found: index-restored\.css, index-mutated\.css/,
  )
})

test("rejects a recovery JAR whose only CSS is not the restored identity", () => {
  assert.throws(
    () => assertRestoredBuildCss(
      "web/app/assets/index-restored.css",
      ["web/app/assets/index-mutated.css"],
      ["web/app/assets/index-other.css"],
      ["index-other.css"],
    ),
    /Recovery shaded JAR does not contain restored CSS: web\/app\/assets\/index-other\.css !== web\/app\/assets\/index-restored\.css/,
  )
})

test("rejects recovery classpath CSS that disagrees with the restored JAR", () => {
  assert.throws(
    () => assertRestoredBuildCss(
      "web/app/assets/index-restored.css",
      ["web/app/assets/index-mutated.css"],
      ["web/app/assets/index-restored.css"],
      ["index-other.css"],
    ),
    /Recovery classpath CSS disagrees with restored shaded JAR: index-other\.css !== index-restored\.css/,
  )
})

test("preserves verification and recovery errors together", () => {
  const verificationError = new Error("verification failed")
  const recoveryError = new Error("recovery failed")

  assert.throws(
    () => surfaceVerificationAndRecoveryErrors(verificationError, recoveryError),
    (error) => error instanceof AggregateError
      && error.errors[0] === verificationError
      && error.errors[1] === recoveryError,
  )
})
