import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Rutas relativas: funciona igual servido desde la raíz de un dominio propio
  // que desde una subruta de GitHub Pages (usuario.github.io/castillon/).
  base: './',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Vitest stubs CSS imports to an empty string by default, `?raw` included, which makes a
    // stylesheet unreadable from a test. `brand.test.ts` has to read the real thing to check that
    // the wordmark's keyframes still match the cascade ramp, so CSS gets processed.
    css: true,
  },
})
