import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Makes the site an installable PWA (spec 5.1, 5.3).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'KurumanMarketPlace',
        short_name: 'Kuruman Market',
        description: 'Buy from Kuruman’s small businesses. Collect or get it delivered.',
        lang: 'en-ZA',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1E6B5A',
        background_color: '#FFFCF7',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The service worker keeps ONLY the app itself (HTML, JS, CSS, icons) and the fonts,
        // so the app opens without signal. It never stores API answers: the public catalogue
        // is saved by our own code (src/lib/catalogueCache.ts) with a timestamp, and private
        // data - orders, addresses, payments - is never saved on the phone (spec 5.3, 5.4).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // In development the website (5173) forwards /api calls to the Express API (4000).
    // To the browser everything comes from one address, so the login cookie just works.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  preview: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
