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
  },
})
