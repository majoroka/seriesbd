/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    proxy: {
      // Redireciona pedidos de /api/tmdb para a função tmdb
      '/api/tmdb': {
        target: 'http://localhost:8888/.netlify/functions/tmdb',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tmdb/, ''),
      },
      // Redireciona pedidos de /api/trakt para a função trakt
      '/api/trakt': {
        target: 'http://localhost:8888/.netlify/functions/trakt',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trakt/, ''),
      },
    },
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
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
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
});