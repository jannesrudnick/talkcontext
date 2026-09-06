/**
 * Kopiert die WASM-Runtime von onnxruntime-web nach public/ort/.
 *
 * transformers.js laedt diese Dateien sonst zur Laufzeit von einem CDN. Das
 * waere eine externe Abhaengigkeit fuer ein Werkzeug, das ausdruecklich lokal
 * arbeitet - und in Umgebungen ohne freien Netzzugang schlicht kaputt.
 * Die Dateien sind gross und generiert, deshalb liegen sie nicht im Repo,
 * sondern werden bei install/dev/build aus node_modules kopiert.
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "public", "ort");

// require.resolve statt fest verdrahtetem node_modules-Pfad: pnpm hoisted
// onnxruntime-web (transitive Dependency von @huggingface/transformers) nicht
// nach node_modules/, sondern nur in den .pnpm-Store.
const require = createRequire(import.meta.url);
let source;
try {
  // "package.json" ist im exports-Feld von onnxruntime-web nicht freigegeben,
  // deshalb ueber den Haupteinstieg aufloesen statt ueber require.resolve("onnxruntime-web/package.json").
  const entry = require.resolve("onnxruntime-web");
  const marker = `${path.sep}onnxruntime-web${path.sep}`;
  const cut = entry.lastIndexOf(marker);
  source = cut === -1 ? null : entry.slice(0, cut + marker.length - 1);
} catch {
  source = null;
}
source = source ? path.join(source, "dist") : null;

const NEEDED = /^ort-wasm-simd-threaded.*\.(mjs|wasm)$/;

async function main() {
  if (!source) {
    console.warn("[ort] onnxruntime-web nicht gefunden - uebersprungen.");
    return;
  }

  let entries;
  try {
    entries = await readdir(source);
  } catch {
    console.warn("[ort] onnxruntime-web nicht gefunden - uebersprungen.");
    return;
  }

  await mkdir(target, { recursive: true });
  let copied = 0;
  for (const entry of entries.filter((name) => NEEDED.test(name))) {
    const from = path.join(source, entry);
    const to = path.join(target, entry);
    const [fromStat, toStat] = await Promise.all([stat(from), stat(to).catch(() => null)]);
    if (toStat && toStat.size === fromStat.size) continue;
    await copyFile(from, to);
    copied += 1;
  }
  console.log(`[ort] ${copied} Datei(en) nach public/ort kopiert.`);
}

await main();
