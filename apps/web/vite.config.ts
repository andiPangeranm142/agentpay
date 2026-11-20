import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the static dist/ works when hosted under any sub-path
// (e.g. GitHub Pages: https://<user>.github.io/<repo>/).
export default defineConfig({
  plugins: [react()],
  base: './',
});
