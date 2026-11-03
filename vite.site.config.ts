// Builds the public website at foodtruckim.com: the landing page in site/,
// with the demo added at /demo by scripts/add-demo-to-site.mjs.
//   npm run build:site
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./site', import.meta.url)),
  plugins: [tailwindcss()],
  build: { outDir: '../dist-site', emptyOutDir: true },
})
