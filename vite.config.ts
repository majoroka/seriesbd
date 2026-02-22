/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const DEV_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: https://image.tmdb.org https://via.placeholder.com",
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
  "frame-src https://www.youtube.com",
  "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

export default defineConfig(({ command }) => ({
  server: {
    headers: command === 'serve'
      ? {
          'Content-Security-Policy': DEV_CSP,
        }
      : undefined,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Ficheiros a serem incluídos no precache, além dos gerados pelo build.
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Stream App',
        short_name: 'StreamApp',
        description: 'A sua aplicação para seguir séries e filmes.',
        theme_color: '#1e1e1e',
        background_color: '#121212',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Cache de assets estáticos (JS, CSS, HTML, fontes, etc.)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Cache de imagens do TMDb com a estratégia "stale-while-revalidate"
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'tmdb-images-cache',
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 dias
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
  },
}));
