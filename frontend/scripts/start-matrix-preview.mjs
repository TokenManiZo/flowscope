import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const version = readFileSync(join(root, "pom.xml"), "utf8").match(/<artifactId>flowscope<\/artifactId>\s*<version>([^<]+)<\/version>/)?.[1]
const jar = join(root, "target", `flowscope-${version}.jar`)
if (!existsSync(jar)) throw new Error("먼저 프로젝트 루트에서 mvn -DskipTests package를 실행하세요.")

// Standalone starts with SampleProject: two users, one admin and synthetic request/response evidence.
const child = spawn(process.env.JAVA_BIN || "java", [
  "-Djava.awt.headless=true",
  "-Dflowscope.web.port=17778",
  `-Dflowscope.projects.dir=${join(root, ".local", "matrix-preview-projects")}`,
  "-cp", jar, "io.flowscope.Standalone",
], { cwd: root, stdio: "inherit", shell: false })
child.on("error", error => { console.error(error.message); process.exitCode = 1 })
child.on("exit", code => { process.exitCode = code ?? 0 })
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
console.log("판정 UI 확인용 합성 트래픽 · http://127.0.0.1:17778/#matrix")
