import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base means the same build works at a domain root,
  // in a GitHub Pages subpath, or opened from the file system.
  base: "./",
  plugins: [react()],
});
