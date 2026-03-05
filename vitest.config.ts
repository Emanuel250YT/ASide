import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // arka-cdn package.json exports reference `.mjs` files that don't exist
      // on disk (beta packaging bug) — alias to the actual JS file.
      'arka-cdn': path.resolve(__dirname, 'node_modules/arka-cdn/dist/index.js'),
    },
  },
  test: {
    environment: 'node',
  },
})
