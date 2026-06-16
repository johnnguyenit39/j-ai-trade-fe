import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev proxy: forwards browser calls from `/api/deepseek/*` to the real
    // DeepSeek endpoint. This avoids CORS issues in local development and keeps
    // the request origin clean. Each provider can register its own proxy here.
    proxy: {
      '/api/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deepseek/, ''),
      },
      // Binance USDT-M Futures public REST (klines, ticker, …). Binance sends
      // no CORS header, so browser calls must go through this proxy in dev.
      '/api/binance': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/binance/, ''),
      },
    },
  },
})
