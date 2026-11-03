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
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://demo.foodtruckim.invalid'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('demo'),
    // Where "Sign up your business" goes when the demo is on the public site.
    'import.meta.env.VITE_SIGNUP_URL': JSON.stringify(process.env.VITE_SIGNUP_URL ?? 'https://app.foodtruckim.com/signup'),
    'import.meta.env.VITE_DEMO_HOME': JSON.stringify('../index.html'),
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-demo',
    rollupOptions: { input: 'demo.html', output: { inlineDynamicImports: true } },
  },
})
