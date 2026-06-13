import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://cuervino.github.io/cyclo-guess-versailles/ on GitHub Pages.
  // base must match the repo name (with leading + trailing slash) so asset URLs resolve.
  base: '/cyclo-guess-versailles/',
  plugins: [react()],
})
