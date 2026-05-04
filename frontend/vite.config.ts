import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

/** Parallel dev with `09_Blinds` (API :8000): use a port that is not already LISTENING; Windows often has other bind failures too — override via `VITE_DEV_API_ORIGIN`. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiOrigin = env.VITE_DEV_API_ORIGIN || 'http://127.0.0.1:8810'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': srcDir },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
        '/uploads': {
          target: apiOrigin,
          changeOrigin: true,
        },
      },
    },
  }
})
