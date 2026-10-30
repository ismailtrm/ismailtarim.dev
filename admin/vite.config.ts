import { fileURLToPath } from 'node:url'
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// Built into public/admin, which the Worker serves as static assets behind Cloudflare Access.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/admin/',
  plugins: [preact()],
  build: {
    outDir: '../public/admin',
    emptyOutDir: true,
    target: 'es2022',
    // One bundle carries the Shiki grammars; it is only loaded by the owner, behind Access.
    chunkSizeWarningLimit: 2500,
  },
})
