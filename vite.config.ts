import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    host: true, // Accept connections from any host
    port: 4040,
    strictPort: false,
    hmr: {
      port: 4040,
    },
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
        target: process.env.DOCKER_ENV ? 'http://backend:8080' : (process.env.NODE_ENV === 'production' ? 'http://backend:8080' : 'http://localhost:8081'),
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
