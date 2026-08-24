import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev playground. Resolve every @xenosystem/* package to its SOURCE so editing a declaration, the
// interpreter, or the renderer reflects instantly with no build step.
const src = (p: string) => new URL(p, import.meta.url).pathname

export default defineConfig({
  plugins: [react()],
  server: { port: 5251 },
  resolve: {
    alias: {
      '@xenosystem/elements/schema': src('../elements/src/schema.ts'),
      '@xenosystem/elements/tokens': src('../elements/src/tokens/index.ts'),
      '@xenosystem/elements/elements': src('../elements/src/elements'),
      '@xenosystem/elements': src('../elements/src/index.ts'),
      '@xenosystem/generate': src('../generate/src/index.ts'),
      '@xenosystem/elements-react': src('../elements-react/src/index.ts'),
    },
  },
})
