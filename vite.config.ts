/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const DEV_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: https:",
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https://*.supabase.co wss://*.supabase.co https://image.tmdb.org https://walter.trakt.tv https://*.trakt.tv https://covers.openlibrary.org https://books.google.com https://*.googleusercontent.com https://books.googleusercontent.com https://*.gstatic.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
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
            // Cache genérico para imagens externas usadas por notícias RSS
            urlPattern: /^https:\/\/.+\.(?:png|gif|jpe?g|webp|avif)(?:\?.*)?$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'remote-news-images-cache',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 14, // 14 dias
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
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
          {
            // Cache de imagens da Trakt (posters sazonais, quando disponíveis)
            urlPattern: /^https:\/\/([a-z0-9-]+\.)?trakt\.tv\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'trakt-images-cache',
              expiration: {
                maxEntries: 150,
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
