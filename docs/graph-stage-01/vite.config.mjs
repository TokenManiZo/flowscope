import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'

const root = resolve(import.meta.dirname, '../..')
export default defineConfig({
  root,
  cacheDir: resolve(root, '.local/graph-stage01-vite'),
  plugins: [react(), tailwindcss({ optimize: false })],
  resolve: { alias: { '@': resolve(root, 'frontend/src') } },
  server: { host: '127.0.0.1', port: 18847, strictPort: true, fs: { allow: [root, realpathSync(resolve(root, 'node_modules'))] } },
})
