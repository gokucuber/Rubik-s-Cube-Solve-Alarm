import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths so the build works from any GitHub Pages subdirectory.
  base: "./",
  build: { target: "es2020" },
});
