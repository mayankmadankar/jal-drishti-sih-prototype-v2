import {defineConfig} from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  // Keep local development convenient; production uses VITE_API_URL.
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8001",
      "/uploads": "http://127.0.0.1:8001",
    },
  },
})
