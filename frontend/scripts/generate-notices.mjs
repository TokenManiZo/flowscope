import { readFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { init } from "license-checker-rseidelsohn"

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const frontendDirectory = path.resolve(scriptsDirectory, "..")
const repositoryDirectory = path.resolve(frontendDirectory, "..")
const generatedNoticePath = path.join(
  repositoryDirectory,
  "target",
  "generated-resources",
  "frontend-notices",
  "META-INF",
  "NOTICE-frontend.txt",
)

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, "\n")
}

function packageNameAndVersion(packageId) {
  const versionSeparator = packageId.lastIndexOf("@")
  if (versionSeparator <= 0 || versionSeparator === packageId.length - 1) {
    throw new Error(`License checker returned an invalid package identifier: ${packageId}`)
  }
  return {
    name: packageId.slice(0, versionSeparator),
    version: packageId.slice(versionSeparator + 1),
  }
}

function checkedLicenseIdentifier(value, packageId) {
  if (typeof value !== "string" || !value.trim() || /\b(?:UNKNOWN|UNLICENSED)\b/i.test(value)) {
    throw new Error(`Production package ${packageId} has no detectable license identifier`)
  }
  return value.trim()
}

function structuredLicenseIdentifiers(license, packageId) {
  const identifierFields = ["type", "name", "license"]
    .filter((field) => Object.hasOwn(license, field))
  if (identifierFields.length === 0) {
    throw new Error(`Production package ${packageId} has no detectable license identifier`)
  }
  return identifierFields.map((field) => validateLicenseIdentifiers(license[field], packageId))
}

export function validateLicenseIdentifiers(license, packageId) {
  if (Array.isArray(license)) {
    if (license.length === 0) {
      throw new Error(`Production package ${packageId} has no detectable license identifier`)
    }
    return license.map((identifier) => validateLicenseIdentifiers(identifier, packageId)).join(" OR ")
  }
  if (license && typeof license === "object") {
    const identifiers = structuredLicenseIdentifiers(license, packageId)
    return identifiers[0]
  }
  return checkedLicenseIdentifier(license, packageId)
}

function repositoryUrl(repository, packageId) {
  if (typeof repository !== "string" || !repository.trim()) {
    throw new Error(`Production package ${packageId} has no repository metadata`)
  }
  return repository.trim()
}

function checkedOutputPath(outputPath) {
  const relativePath = path.relative(repositoryDirectory, outputPath)
  const expectedPath = path.join("target", "generated-resources", "frontend-notices", "META-INF", "NOTICE-frontend.txt")
  if (path.isAbsolute(relativePath) || relativePath !== expectedPath) {
    throw new Error("Refusing to write frontend notices outside the generated NOTICE resource")
  }
  return outputPath
}

function checkedLicensePath(frontendRoot, licenseFile, packageId) {
  if (typeof licenseFile !== "string" || !licenseFile) {
    throw new Error(`Production package ${packageId} has no readable local license file`)
  }
  const nodeModulesDirectory = path.resolve(frontendRoot, "node_modules")
  const absoluteLicensePath = path.resolve(licenseFile)
  const relativePath = path.relative(nodeModulesDirectory, absoluteLicensePath)
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith(`..${path.sep}`) || relativePath === "..") {
    throw new Error(`Production package ${packageId} license file is outside node_modules`)
  }
  return absoluteLicensePath
}

function checkPackages(frontendRoot) {
  return new Promise((resolve, reject) => {
    init({
      start: frontendRoot,
      production: true,
      excludePrivatePackages: true,
      customFormat: {
        licenses: true,
        repository: true,
        licenseFile: true,
        licenseText: true,
        copyright: true,
      },
    }, (error, packages) => {
      if (error) {
        reject(error)
        return
      }
      resolve(packages)
    })
  })
}

export async function collectFrontendNoticeEntries(frontendRoot = frontendDirectory, { packageCollector = checkPackages } = {}) {
  const packages = await packageCollector(frontendRoot)
  const entries = await Promise.all(Object.entries(packages).map(async ([packageId, metadata]) => {
    const { name, version } = packageNameAndVersion(packageId)
    const licensePath = checkedLicensePath(frontendRoot, metadata.licenseFile, packageId)
    let licenseText
    try {
      licenseText = normalizeNewlines(await readFile(licensePath, "utf8"))
    } catch (error) {
      throw new Error(`Production package ${packageId} has no readable local license file`, { cause: error })
    }
    if (!licenseText.trim()) {
      throw new Error(`Production package ${packageId} has no readable local license file`)
    }
    return {
      name,
      version,
      license: validateLicenseIdentifiers(metadata.licenses, packageId),
      repository: repositoryUrl(metadata.repository, packageId),
      copyright: typeof metadata.copyright === "string" && metadata.copyright.trim()
        ? normalizeNewlines(metadata.copyright).trim()
        : null,
      licenseText,
    }
  }))
  return entries.sort((left, right) => {
    const leftKey = `${left.name}\u0000${left.version}`
    const rightKey = `${right.name}\u0000${right.version}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
}

export function renderFrontendNotices(entries) {
  const sections = entries.map((entry) => {
    const lines = [
      `${entry.name} ${entry.version}`,
      `License: ${entry.license}`,
      `Repository: ${entry.repository}`,
    ]
    if (entry.copyright) {
      lines.push(`Copyright: ${entry.copyright}`)
    }
    lines.push("License text:", entry.licenseText)
    return lines.join("\n")
  })
  return normalizeNewlines([
    "FlowScope frontend third-party notices",
    "",
    "This file is generated from installed production frontend dependencies.",
    "Do not edit this generated file; run npm run notices from frontend/.",
    "",
    ...sections.flatMap((section, index) => index === 0 ? [section] : ["", "--------------------------------------------------------------------", section]),
    "",
  ].join("\n"))
}

export async function generateFrontendNotices() {
  const entries = await collectFrontendNoticeEntries(frontendDirectory)
  const outputPath = checkedOutputPath(generatedNoticePath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, renderFrontendNotices(entries), "utf8")
  return outputPath
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = await generateFrontendNotices()
  process.stdout.write(`Generated ${path.relative(repositoryDirectory, outputPath)}\n`)
}
