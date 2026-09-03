import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(scriptsDirectory, "../..")
const targetDirectory = path.resolve(repositoryDirectory, "target")

function exactTargetPath(...segments) {
  const outputDirectory = path.resolve(targetDirectory, ...segments)
  const relativePath = path.relative(targetDirectory, outputDirectory)
  const expectedPath = path.join(...segments)
  if (
    path.basename(targetDirectory) !== "target" ||
    path.dirname(targetDirectory) !== repositoryDirectory ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath !== expectedPath
  ) {
    throw new Error("Refusing to clean an unexpected React output path")
  }
  return outputDirectory
}

await Promise.all([
  rm(exactTargetPath("generated-resources", "react-web"), { recursive: true, force: true }),
  rm(exactTargetPath("classes", "web", "app"), { recursive: true, force: true }),
])
