import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // The SDK depends only on the runtime's Web Crypto + fetch globals,
  // so there are no third-party deps to bundle or externalize.
  treeshake: true,
});
