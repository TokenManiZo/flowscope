import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: false,
    outDir: "../target/generated-resources/react-web",
  },
  // Vite keeps cssMinify enabled; avoid Tailwind's duplicate native optimizer on Node 24/Windows.
  plugins: [react(), tailwindcss({ optimize: false })],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    css: true,
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
    setupFiles: ["./src/test/setup.ts"],
    // Render-heavy tests pass alone but exceed the 5s default when the full suite runs in parallel on a slower
    // CI runner. A wrong test still fails; it only gets more time to finish.
    testTimeout: 15_000,
  },
})
