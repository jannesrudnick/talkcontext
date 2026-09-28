import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "wxt";

/**
 * Chrome verweigert Content-Scripts, die Unicode-Nichtzeichen (U+FFFE, U+FFFF,
 * U+FDD0-FDEF) literal enthalten ("isn't UTF-8 encoded"). postcss - via rrweb
 * gebuendelt - vergleicht gegen ein literales U+FFFE. Als Escape ist es harmlos.
 */
function escapeNoncharacters(): Plugin {
  const pattern = /[\uFDD0-\uFDEF\uFFFE\uFFFF]/g;
  return {
    name: "qey:escape-noncharacters",
    enforce: "post",
    // Erst nach der Minifizierung - die wuerde Escapes sonst wieder aufloesen.
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
  alias: {
    // Datenmodell, Korrelation und Markdown-Export teilt sich die Extension mit
    // der Next-App - eine Quelle, damit beide dasselbe Artefakt erzeugen.
    "@shared": path.resolve(__dirname, "../src/lib/qa"),
  },
  vite: () => ({
    plugins: [tailwindcss(), escapeNoncharacters()],
    worker: { format: "es" },
    optimizeDeps: { exclude: ["onnxruntime-web"] },
  }),
  manifest: {
    name: "qey – QA Recorder",
    short_name: "qey",
    description:
      "Nimmt manuelle QA-Sessions als Session-Replay plus DOM-Protokoll und Sprache auf – ohne Skript in der Zielanwendung.",
    permissions: ["storage", "unlimitedStorage", "offscreen", "scripting", "tabs", "contextMenus"],
    host_permissions: ["<all_urls>"],
    action: { default_title: "qey – Overlay ein-/ausblenden" },
    commands: {
      "toggle-overlay": {
        suggested_key: { default: "Alt+Shift+Q" },
        description: "Overlay ein-/ausblenden",
      },
      "toggle-recording": {
        suggested_key: { default: "Alt+Shift+R" },
        description: "Aufnahme starten/stoppen",
      },
    },
    content_security_policy: {
      // Whisper laeuft lokal als WASM (onnxruntime-web).
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
