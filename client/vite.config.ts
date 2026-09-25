import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In development the website (5173) forwards /api calls to the Express API (4000).
    // To the browser everything comes from one address, so the login cookie just works.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
