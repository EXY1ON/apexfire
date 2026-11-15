/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// MKFFIS WMS is HTTP-only without CORS; the browser reaches it as same-origin /mkffis/* (local dev and preview only).
const mkffis = { '/mkffis/wms': { target: 'http://mkffis1.cuk.gov.mk:8080', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/mkffis/, '/geoserver') } };

// Absolute site address for link previews in index.html; set VITE_SITE_URL (environment or .env) for another domain.
const siteUrl = (url: string) => ({ name: 'site-url', transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', url.replace(/\/$/, '')) });

export default defineConfig(({ mode }) => ({
  plugins: [react(), siteUrl(loadEnv(mode, '.', 'VITE_').VITE_SITE_URL || 'https://apexfire.web.app')],
  server: { proxy: mkffis },
  preview: { proxy: mkffis },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
