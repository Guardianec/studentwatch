import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.venv/**', '**/.qa/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
