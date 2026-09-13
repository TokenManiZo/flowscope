import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  assertRestoredBuildCss,
  indexedJarCss,
  selectSecondBuildCss,
  surfaceVerificationAndRecoveryErrors,
} from "./incremental-package-assets.mjs"

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(scriptsDirectory, "../..")
const targetDirectory = path.resolve(repositoryDirectory, "target")

function exactProjectPath(...segments) {
  const resolved = path.resolve(repositoryDirectory, ...segments)
  const relative = path.relative(repositoryDirectory, resolved)
  const expected = path.join(...segments)
  if (!relative || path.isAbsolute(relative) || relative !== expected) {
    throw new Error(`Refusing unexpected project path: ${segments.join("/")}`)
  }
  return resolved
}

function exactTargetPath(...segments) {
  const resolved = path.resolve(targetDirectory, ...segments)
  const relative = path.relative(targetDirectory, resolved)
  const expected = path.join(...segments)
  if (
    path.basename(targetDirectory) !== "target" ||
    path.dirname(targetDirectory) !== repositoryDirectory ||
    !relative ||
    path.isAbsolute(relative) ||
    relative !== expected
  ) {
    throw new Error(`Refusing unexpected target path: ${segments.join("/")}`)
  }
  return resolved
}

function executable(environmentName, fallback) {
  return process.env[environmentName] || fallback
}

function run(executablePath, argumentsList, capture = false) {
  const batchFile = process.platform === "win32" && /\.(cmd|bat)$/i.test(executablePath)
  if (batchFile && executablePath.includes('"')) throw new Error("Maven batch path must not contain a quote")
  const command = batchFile ? (process.env.ComSpec || "cmd.exe") : executablePath
  const commandArguments = batchFile
    ? ["/d", "/s", "/c", `call "${executablePath}" ${argumentsList.join(" ")}`]
    : argumentsList
  const result = spawnSync(command, commandArguments, {
    cwd: repositoryDirectory,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsVerbatimArguments: batchFile,
  })
  if (result.error) throw new Error(`Could not run ${executablePath}: ${result.error.message}`)
  if (result.status !== 0) {
    const details = capture ? `\n${result.stderr || result.stdout}` : ""
    throw new Error(`${executablePath} ${argumentsList.join(" ")} failed with exit ${result.status}.${details}`)
  }
  return capture ? result.stdout : ""
}

function jarEntries(jarExecutable, jarPath) {
  return run(jarExecutable, ["tf", jarPath], true).split(/\r?\n/).filter(Boolean)
}

const mavenExecutable = executable("FLOWSCOPE_MAVEN", process.platform === "win32" ? "mvn.cmd" : "mvn")
const jarExecutable = executable(
  "FLOWSCOPE_JAR",
  process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "jar.exe" : "jar") : "jar",
)
const fixturePath = exactProjectPath("frontend", "src", "index.css")
const packageVersion = JSON.parse(readFileSync(exactProjectPath("frontend", "package.json"), "utf8")).version
const shadedJar = exactTargetPath(`flowscope-${packageVersion}.jar`)
const classpathAssets = exactTargetPath("classes", "web", "app", "assets")
const originalFixture = readFileSync(fixturePath)
const originalToken = Buffer.from("--radius: 0.625rem;")
const changedToken = Buffer.from("--radius: 0.626rem;")
const firstToken = originalFixture.indexOf(originalToken)

if (firstToken < 0 || originalFixture.indexOf(originalToken, firstToken + originalToken.length) >= 0) {
  throw new Error("Expected exactly one CSS radius fixture token")
}

const changedFixture = Buffer.concat([
  originalFixture.subarray(0, firstToken),
  changedToken,
  originalFixture.subarray(firstToken + originalToken.length),
])

let firstCss
let secondCss
let mutatedCssEntries = []
let mutationStarted = false
let verificationError

try {
  // Start from a known classpath state without invoking Maven's clean lifecycle.
  await rm(exactTargetPath("classes", "web", "app"), { recursive: true, force: true })
  run(mavenExecutable, ["-DskipTests", "package"])
  if (!existsSync(shadedJar)) throw new Error(`Missing shaded JAR: ${shadedJar}`)
  const firstCssEntries = indexedJarCss(jarEntries(jarExecutable, shadedJar))
  if (firstCssEntries.length !== 1) {
    throw new Error(`Expected one first-build indexed CSS asset, got: ${firstCssEntries.join(", ")}`)
  }
  firstCss = firstCssEntries[0]

  mutationStarted = true
  writeFileSync(fixturePath, changedFixture)
  run(mavenExecutable, ["-DskipTests", "package"])
  const secondEntries = jarEntries(jarExecutable, shadedJar)
  const classpathEntries = readdirSync(classpathAssets)
  mutatedCssEntries = indexedJarCss(secondEntries).filter((entry) => entry !== firstCss)
  secondCss = selectSecondBuildCss(firstCss, secondEntries, classpathEntries)

  console.log(`INCREMENTAL_PACKAGE_ASSET_SECOND_BUILD_OK old=${firstCss} new=${secondCss}`)
} catch (error) {
  verificationError = error
}

let recoveryError
if (mutationStarted) {
  try {
    writeFileSync(fixturePath, originalFixture)
    if (!readFileSync(fixturePath).equals(originalFixture)) {
      throw new Error(`Could not restore fixture bytes: ${fixturePath}`)
    }
    run(mavenExecutable, ["-DskipTests", "package"])
    const recoveryJarEntries = jarEntries(jarExecutable, shadedJar)
    const recoveryClasspathEntries = readdirSync(classpathAssets)
    assertRestoredBuildCss(firstCss, mutatedCssEntries, recoveryJarEntries, recoveryClasspathEntries)
    console.log(`INCREMENTAL_PACKAGE_ASSET_RECOVERY_OK restored=${firstCss} removed=${mutatedCssEntries.join(",")}`)
  } catch (error) {
    recoveryError = error
  }
}

surfaceVerificationAndRecoveryErrors(verificationError, recoveryError)
