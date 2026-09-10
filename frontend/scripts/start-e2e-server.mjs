import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { createServer } from "node:net"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const frontendDirectory = dirname(scriptDirectory)
const projectDirectory = dirname(frontendDirectory)
const targetDirectory = join(projectDirectory, "target")
const jars = readdirSync(targetDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^flowscope-.*\.jar$/.test(entry.name))
  .map((entry) => join(targetDirectory, entry.name))

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(17777, "127.0.0.1", () => probe.close(resolve))
  })
}

if (jars.length !== 1) {
  console.error(`Expected exactly one ../target/flowscope-*.jar, found ${jars.length}.`)
  process.exitCode = 1
} else {
  try {
    await assertPortAvailable()
  } catch {
    console.error("Port 17777 must be free for the packaged standalone server.")
    process.exitCode = 1
  }
}

if (!process.exitCode) {
  const projectWorkspace = mkdtempSync(join(tmpdir(), "flowscope-e2e-projects-"))
  const child = spawn(process.env.JAVA_BIN || "java", [
    "-Djava.awt.headless=true",
    "-Dflowscope.web.port=17777",
    `-Dflowscope.projects.dir=${projectWorkspace}`,
    "-cp",
    jars[0],
    "io.flowscope.Standalone",
  ], { cwd: projectDirectory, shell: false, stdio: "inherit", windowsHide: true })

  let stopping = false
  const stop = () => {
    if (!stopping && child.exitCode === null && !child.killed) {
      stopping = true
      child.kill()
    }
  }
  const cleanWorkspace = () => rmSync(projectWorkspace, { recursive: true, force: true })

  child.once("error", (error) => {
    console.error(`Unable to start standalone server: ${error.message}`)
    process.exitCode = 1
  })
  child.once("exit", (code, signal) => {
    cleanWorkspace()
    if (!stopping) {
      console.error(`Standalone server exited before Playwright completed (${signal ?? code ?? "unknown"}).`)
      process.exitCode = code ?? 1
    }
  })
  process.once("SIGINT", () => { stop(); process.exit(130) })
  process.once("SIGTERM", () => { stop(); process.exit(143) })
  process.once("exit", () => { stop(); cleanWorkspace() })
}
