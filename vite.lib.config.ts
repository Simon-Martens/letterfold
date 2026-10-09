import { defineConfig } from "vite";
export default defineConfig({
  build: {
    copyPublicDir: false,
    outDir: "dist/lib",
    emptyOutDir: true,
    lib: {
      entry: {
        index: "src/index.ts",
        three: "src/three.ts",
        experimental: "src/physics.ts",
      },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: (id) => id === "three" || id.startsWith("three/"),
    },
  },
});
