import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath, URL } from 'node:url';

/** A path inside the sibling `xeno-elements-foundations` monorepo's `packages/`. */
const XENO_PACKAGES = fileURLToPath(new URL('../xeno-elements-foundations/packages/', import.meta.url));
const xeno = (p: string) => path.join(XENO_PACKAGES, p);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),

      // ── XENO Elements ──────────────────────────────────────────────────────────────
      // Resolved to SOURCE in the sibling repo, not to a built package. The library and this app are
      // developed together right now, so a build step between them would mean every change to a
      // control needs a rebuild before it can be seen here. This is a DEVELOPMENT arrangement: the
      // real dependency becomes a versioned package from a registry once the library settles.
      //
      // Order matters — the deeper specifiers must come before the bare one, or `@xenosystem/elements`
      // would swallow `@xenosystem/elements/tokens`. The same trap catches the stylesheet: without the
      // entry below, `@xenosystem/elements-react/xeno-elements.css` resolves to the bare alias and then
      // has `/xeno-elements.css` appended to it, giving `.../src/index.ts/xeno-elements.css`.
      '@xenosystem/elements-react/xeno-elements.css': xeno('elements-react/src/xeno-elements.css'),
      '@xenosystem/elements/schema': xeno('elements/src/schema.ts'),
      '@xenosystem/elements/tokens': xeno('elements/src/tokens/index.ts'),
      '@xenosystem/elements/elements': xeno('elements/src/elements'),
      '@xenosystem/elements': xeno('elements/src/index.ts'),
      '@xenosystem/generate': xeno('generate/src/index.ts'),
      '@xenosystem/elements-react': xeno('elements-react/src/index.ts'),
    },
    // Two copies of React is the classic failure of linking a package from outside the tree: the
    // library would resolve its own, hooks would break, and the error ("Invalid hook call") points at
    // the library rather than at the wiring. The library keeps React as a peer dependency only; this
    // is the other half of that contract.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'axios', 'lucide-react'],
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
  server: {
    host: true, // Accept connections from any host
    // The elements library is a sibling repo, outside this project root — Vite will not serve files
    // from there unless the directory is explicitly allowed.
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), XENO_PACKAGES] },
    allowedHosts: ['.trycloudflare.com', 'localhost', '127.0.0.1'],
    port: 5183,
    strictPort: false,
    hmr: true,
    // Completely disable host checking by removing allowedHosts restriction
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**'],
    },
    proxy: {
      // Put more specific proxies first
      // Proxy for Piston Runtimes API V2 (Try removing rewrite)
      '/api/piston/runtimes': {
        target: 'https://emkc.org', // Target base domain
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/piston\/runtimes/, '/api/v2/piston/runtimes'), // Rewrite to correct path
        secure: false,
      },
      // Proxy for Piston Execute API V2
      '/api/piston/execute': {
        target: 'https://emkc.org/api/v2/piston',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/piston\/execute/, '/execute'), // More specific rewrite
        secure: false,
      },
      // General /api proxy - points to our backend server
      // Note: File uploads bypass this proxy and go directly to backend due to Vite's 1MB body limit
      '/api': {
        target: process.env.DOCKER_ENV ? 'http://backend:8080' : (process.env.NODE_ENV === 'production' ? 'http://backend:8080' : 'https://xenostudio.ai'),
        changeOrigin: true,
        secure: false,
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      }
    }
  },
});
