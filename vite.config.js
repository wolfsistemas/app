import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { imgbbUploadPlugin } from './src/lib/imgbbPlugin.js'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/app/' : '/',
  plugins: [react(), imgbbUploadPlugin()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['.monkeycode-ai.live']
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: ['.monkeycode-ai.live']
  }
})
