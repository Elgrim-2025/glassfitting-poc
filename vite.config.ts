import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages project sites are served from /<repo>/; CI sets BASE_PATH for the deploy build.
  base: process.env.BASE_PATH ?? '/',
  server: {
    port: 5173,
    // Camera access needs a secure context; localhost is treated as secure.
    // For LAN device testing run `npm run dev -- --https` with a local cert.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
