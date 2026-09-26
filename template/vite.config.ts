import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The build contract.
 *
 * The output names are fixed — `app.js` and `app.css`, no hashes, one file
 * each. The manifest an agent submits names them, and the embed page loads them
 * by those names, so they cannot vary per build. `scripts/assert-dist.mjs`
 * fails the build if they ever do.
 *
 * Everything is inlined: one JS file, one CSS file, and no separate assets.
 * The embed page's CSP allows `data:` images but no other subresource, so a
 * bundle that emitted a `.svg` next to itself would simply not load.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` proxies the studio client's relative /api calls, so they
    // reach the service without CORS: the local service by default, or preview
    // with `BDA_API_ORIGIN=https://preview.bicycle.ai npm run dev` (.env.example).
    proxy: {
      '/api': { target: process.env['BDA_API_ORIGIN'] ?? 'http://localhost:8099', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})
