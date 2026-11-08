import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true exposes this to other devices on the same network (e.g. a
  // tablet opening the desk view), not just this laptop.
  server: { port: 5173, host: true },
});
