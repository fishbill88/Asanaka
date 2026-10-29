import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages has no SPA fallback: an unknown path serves 404.html, so 404.html is the app too.
const pagesFallback = (): Plugin => ({
  name: 'pages-fallback',
  apply: 'build',
  closeBundle() {
    const out = resolve(import.meta.dirname, 'dist');
    copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
  },
});

// Scripts and styles come from this site only; the one other address the page may call is the API.
// Build only: the dev server's React refresh needs an inline script.
const contentPolicy = (apiOrigin: string): Plugin => ({
  name: 'content-policy',
  apply: 'build',
  transformIndexHtml(html) {
    const connect = ["'self'", apiOrigin].filter(Boolean).join(' ');
    const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src ${connect}; base-uri 'self'; form-action 'self'`;
    return html.replace('%CONTENT_POLICY%', policy);
  },
});

// In development the site calls its own origin and Vite passes /api on: to the local API from
// `npm run dev:api` by default, or to any other API named in ASANAKA_DEV_API. The browser never makes a
// cross-site call, so the API's one allowed origin stays the Pages site.
const devProxy = (target: string) => ({
  target,
  changeOrigin: true,
  configure: (proxy: { on(event: 'proxyReq', fn: (req: { removeHeader(name: string): void }) => void): void }) => {
    proxy.on('proxyReq', (req) => req.removeHeader('origin'));
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const apiOrigin = (env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
  const devApi = process.env.ASANAKA_DEV_API || 'http://127.0.0.1:7361';
  return {
    base: '/Asanaka/',
    plugins: [react(), contentPolicy(apiOrigin), pagesFallback()],
    server: { proxy: { '/api': devProxy(devApi), '/healthz': devProxy(devApi) } },
    build: { target: 'es2022' },
  };
});
