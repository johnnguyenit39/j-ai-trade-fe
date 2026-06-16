import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'J AI Trade',
        short_name: 'J AI Trade',
        description: 'AI trading advisor cho XAUUSDT — chat hỏi nên mua hay bán.',
        lang: 'vi',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Don't precache the giant Firebase chunk; let it cache at runtime.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
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
