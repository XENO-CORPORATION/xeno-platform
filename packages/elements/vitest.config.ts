import { defineConfig } from 'vitest/config'

// Unit tests for the contract package. No DOM, no framework — this package is pure data + one
// pure function, so tests run in the default node environment.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
