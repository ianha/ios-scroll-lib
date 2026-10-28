import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/physics.ts"],
  format: ["esm", "cjs"],
  target: "es2020",
  sourcemap: true,
  clean: true,
  // Each entry is standalone, so the physics import never pulls in DOM code.
  splitting: false,
  treeshake: true,
  dts: true,
});
