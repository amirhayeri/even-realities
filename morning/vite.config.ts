import { defineConfig } from 'vite';

// Shares app/.env (VITE_HUD_ENDPOINT, VITE_HUD_TOKEN) with Bio HUD: one token, one place.
export default defineConfig({
  base: './',
  envDir: '../app',
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
