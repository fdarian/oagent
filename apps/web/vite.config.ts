import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/rpc': {
        target: process.env.ENGINE_URL ?? 'http://localhost:17777',
        changeOrigin: true,
      },
      '/jobs': {
        target: process.env.ENGINE_URL ?? 'http://localhost:17777',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
