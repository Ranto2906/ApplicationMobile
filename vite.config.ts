import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://192.168.0.46:8091',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Séparer Ionic du bundle principal
          'ionic': [
            '@ionic/react',
            '@ionic/react-router',
            'ionicons',
          ],
          // Séparer React/ReactDOM
          'vendor': [
            'react',
            'react-dom',
            'react-router',
            'react-router-dom',
          ],
        },
      },
    },
  },
})
