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
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "onnxruntime-web", "dist");
const target = path.join(root, "public", "ort");

const NEEDED = /^ort-wasm-simd-threaded.*\.(mjs|wasm)$/;

async function main() {
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
