import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Pre-bundling moves maplibre-gl away from its worker file, which it finds relative to itself.
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
