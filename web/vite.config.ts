import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages has no SPA fallback: an unknown path serves 404.html, so 404.html is the app too.
const pagesFallback = (): Plugin => ({
  name: 'pages-fallback',
  apply: 'build',
  closeBundle() {
    const out = resolve(__dirname, 'dist');
    copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
  },
});

// Scripts and styles come from this site only; the one other address the page may call is the API.
const contentPolicy = (apiOrigin: string): Plugin => ({
  name: 'content-policy',
  transformIndexHtml(html) {
    const connect = ["'self'", apiOrigin].filter(Boolean).join(' ');
    const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src ${connect}; base-uri 'self'; form-action 'self'`;
    return html.replace('%CONTENT_POLICY%', policy);
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const apiOrigin = (env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
  return {
    base: '/Asanaka/',
    plugins: [react(), contentPolicy(apiOrigin), pagesFallback()],
    build: { target: 'es2022' },
  };
});
