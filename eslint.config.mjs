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
    // Browser-Skript, das in der Zielseite laeuft - kein Teil des App-Builds.
    "public/qa-recorder.js",
    // Aus node_modules kopierte ONNX-Runtime, siehe scripts/copy-ort-runtime.mjs.
    "public/ort/**",
    // Eigenes Paket mit eigenem Build (WXT), siehe extension/README.md.
    "extension/**",
    // Eigenes Paket (qey-MCP-Server), siehe mcp/README.md.
    "mcp/**",
  ]),
]);

export default eslintConfig;
