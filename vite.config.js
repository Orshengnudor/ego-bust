import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // ✅ Prevent Vite from trying to bundle these libraries
      external: [
        '@privy-io/react-auth',
        '@monad/game-id-sdk' // change to the actual Monad Game ID SDK package name if different
      ]
    }
  }
})
