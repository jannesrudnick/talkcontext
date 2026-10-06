/**
 * Copies the onnxruntime-web WASM runtime to public/ort/.
 *
 * Otherwise transformers.js loads these files from a CDN at runtime. That
 * would be an external dependency for a tool that explicitly works locally
 * - and simply broken in environments without open network access.
 * The files are large and generated, so they are not in the repo
 * but copied from node_modules on install/dev/build.
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "public", "ort");

// require.resolve instead of a hardcoded node_modules path: pnpm doesn't hoist
// onnxruntime-web (transitive dependency of @huggingface/transformers)
// into node_modules/, only into the .pnpm store.
const require = createRequire(import.meta.url);
let source;
try {
  // "package.json" is not exposed in onnxruntime-web's exports field,
  // so resolve via the main entry instead of require.resolve("onnxruntime-web/package.json").
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
    console.warn("[ort] onnxruntime-web not found - skipped.");
    return;
  }

  let entries;
  try {
    entries = await readdir(source);
  } catch {
    console.warn("[ort] onnxruntime-web not found - skipped.");
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
  console.log(`[ort] Copied ${copied} file(s) to public/ort.`);
}

await main();
