import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Browser script that runs in the target page - not part of the app build.
    "public/qa-recorder.js",
    // ONNX runtime copied from node_modules, see scripts/copy-ort-runtime.mjs.
    "public/ort/**",
    // Separate package with its own build (WXT), see extension/README.md.
    "extension/**",
    // Separate package (qey MCP server), see mcp/README.md.
    "mcp/**",
  ]),
]);

export default eslintConfig;
