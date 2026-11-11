import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const { POSTUP_DEV_API_ORIGIN = 'http://127.0.0.1:8000' } = loadEnv(mode, process.cwd(), 'POSTUP_DEV_')
  const proxy = { '/api/': { target: POSTUP_DEV_API_ORIGIN, changeOrigin: false } }
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**', '**/.venv/**', '**/.qa/**'] },
      proxy,
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  }
})
