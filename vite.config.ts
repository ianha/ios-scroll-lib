import { defineConfig } from "vite";
export default defineConfig({
  root: "example",
  base: "./",
  build: {
    outDir: "../dist-example",
    emptyOutDir: true,
    rollupOptions: {
      input: { main: "example/index.html", checks: "example/checks.html" },
    },
  },
});
