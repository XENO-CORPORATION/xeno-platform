import { defineConfig } from 'vitest/config'

// SSR tests: render declarations with react-dom/server and assert the markup matches the reference
// serializer. Node environment (no DOM needed for renderToStaticMarkup). esbuild handles the JSX with
// the automatic runtime, and the sibling packages resolve to SOURCE so tests need no prior build.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@xenosystem/elements/schema': new URL('../elements/src/schema.ts', import.meta.url).pathname,
      '@xenosystem/elements/tokens': new URL('../elements/src/tokens/index.ts', import.meta.url).pathname,
      // Per-element glyph subpath -> source dir (prefix alias; must precede the bare package alias).
      '@xenosystem/elements/elements': new URL('../elements/src/elements', import.meta.url).pathname,
      '@xenosystem/elements': new URL('../elements/src/index.ts', import.meta.url).pathname,
      '@xenosystem/generate': new URL('../generate/src/index.ts', import.meta.url).pathname,
    },
  },
})
