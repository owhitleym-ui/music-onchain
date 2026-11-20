import { defineConfig } from 'vite';

// Only the consumer app is built. The old standalone deployment helper is not an entry point.
export default defineConfig({
  server: { host: 'localhost', port: 3000, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
  preview: { host: 'localhost', port: 3000, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      onLog(level, log, handler) {
        // React libraries include these Next.js directives; this is a client-only app.
        if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log);
      },
    },
  },
});
