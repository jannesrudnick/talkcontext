import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "wxt";

/**
 * Chrome rejects content scripts that contain Unicode noncharacters (U+FFFE, U+FFFF,
 * U+FDD0-FDEF) literally ("isn't UTF-8 encoded"). postcss - bundled via rrweb -
 * compares against a literal U+FFFE. As an escape it is harmless.
 */
function escapeNoncharacters(): Plugin {
  const pattern = /[\uFDD0-\uFDEF\uFFFE\uFFFF]/g;
  return {
    name: "qey:escape-noncharacters",
    enforce: "post",
    // Only after minification - it would otherwise resolve the escapes again.
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        file.code = file.code.replace(pattern, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
      }
    },
  };
}

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss(), escapeNoncharacters()],
    worker: { format: "es" },
    optimizeDeps: { exclude: ["onnxruntime-web"] },
  }),
  manifest: {
    name: "qey – QA Recorder",
    short_name: "qey",
    description:
      "Records manual QA sessions as session replay plus DOM log and voice – no script needed in the target app.",
    permissions: ["storage", "unlimitedStorage", "offscreen", "scripting", "tabs", "contextMenus"],
    host_permissions: ["<all_urls>"],
    action: { default_title: "qey – Show/hide overlay" },
    commands: {
      "toggle-overlay": {
        suggested_key: { default: "Alt+Shift+Q" },
        description: "Show/hide overlay",
      },
      "toggle-recording": {
        suggested_key: { default: "Alt+Shift+R" },
        description: "Start/stop recording",
      },
    },
    content_security_policy: {
      // Whisper runs locally as WASM (onnxruntime-web).
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [
      {
        resources: ["main-world.js"],
        matches: ["<all_urls>"],
      },
    ],
  },
});
