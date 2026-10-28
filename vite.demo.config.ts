// Builds the demo: the real app with a pretend server inside the page and
// made up sample data. No service worker, one page, no outside connections.
//   npm run build:demo
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/demo/pwaStub.ts', import.meta.url)),
    },
  },
  define: {
    'import.meta.env.VITE_DEMO': JSON.stringify('1'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://demo.truckstock.invalid'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('demo'),
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-demo',
    rollupOptions: { input: 'demo.html', output: { inlineDynamicImports: true } },
  },
})
