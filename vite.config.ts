import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import swPlugin from './scripts/vite-sw-plugin.mjs'

export default defineConfig({
  plugins: [react(), tailwindcss(), swPlugin()],
  build: { outDir: 'dist' },
})
