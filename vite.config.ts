import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'bus-mascot.svg', 'mrt_map.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'SG Bus Kaki - Singapore Transit',
        short_name: 'Bus Kaki',
        description: 'Singapore Real-Time Bus Arrivals, Active Alighting Wake-up Alarm & MRT Network',
        theme_color: '#0b132b',
        background_color: '#0b132b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/bus-mascot.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: 'module',
      }
    })
  ],
  server: {
    port: 5173,
    host: true,
  }
});
