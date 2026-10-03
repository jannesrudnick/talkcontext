/**
 * Wege, einen Handoff zum Agenten zu bringen: ZIP-Download oder direkt an den
 * lokalen qey-MCP-Server (siehe mcp/), den Claude Code als Werkzeug nutzt.
 */
import { strToU8, zipSync } from "fflate";
import type { Handoff } from "./build";

const bytes = (data: Uint8Array | string) => (typeof data === "string" ? strToU8(data) : data);

export function zipHandoff(handoff: Handoff): Blob {
  const tree: Record<string, Uint8Array> = {};
  for (const file of handoff.files) tree[file.path] = bytes(file.data);
  // Bilder sind schon komprimiert - nur Text packen.
  const zipped = zipSync(tree, { level: 6 });
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}

function toBase64(data: Uint8Array) {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface EndpointHealth {
  ok: boolean;
  version?: string;
  dir?: string;
  error?: string;
}

export async function checkEndpoint(endpoint: string): Promise<EndpointHealth> {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { ok: false, error: `Status ${response.status}` };
    return { ok: true, ...((await response.json()) as { version?: string; dir?: string }) };
  } catch {
    return { ok: false, error: "nicht erreichbar" };
  }
}

export async function sendHandoff(endpoint: string, handoff: Handoff): Promise<{ path?: string }> {
  const payload = {
    manifest: handoff.manifest,
    files: handoff.files.map((file) =>
      typeof file.data === "string"
        ? { path: file.path, encoding: "utf8", content: file.data }
        : { path: file.path, encoding: "base64", content: toBase64(file.data) },
    ),
  };
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/$/, "")}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("qey-MCP-Server nicht erreichbar – läuft Claude Code mit dem qey-Server? (Einstellungen → Claude Code)");
  }
  if (!response.ok) throw new Error(`qey-MCP-Server antwortete mit ${response.status}: ${await response.text()}`);
  return (await response.json()) as { path?: string };
}
