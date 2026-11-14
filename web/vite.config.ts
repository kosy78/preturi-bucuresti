import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server sends no-cache, so a preload there downloads the 9 MB listings twice; only the build gets it.
const preloadListings = {
  name: 'preload-listings',
  apply: 'build' as const,
  transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'preload', as: 'fetch', crossorigin: '', href: '/data/listings.json' }, injectTo: 'head-prepend' as const }],
};

export default defineConfig({
  plugins: [react(), preloadListings],
  // Pre-bundling moves maplibre-gl away from its worker file, which it finds relative to itself.
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
