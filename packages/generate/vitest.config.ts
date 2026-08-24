import { defineConfig } from 'vitest/config'

// The renderer core is a pure function over declaration DATA — no DOM, no framework. Tests load the
// real declarations from the sibling `elements` package source and assert on the emitted SVG string.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@xenosystem/elements/schema': new URL('../elements/src/schema.ts', import.meta.url).pathname,
      '@xenosystem/elements': new URL('../elements/src/index.ts', import.meta.url).pathname,
    },
  },
})
