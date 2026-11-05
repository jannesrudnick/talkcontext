/**
 * Receiving endpoint for the extension: POST /sessions with the handoff as JSON,
 * POST /update to pull and rebuild the local checkout (see update.ts).
 *
 * Listens on 127.0.0.1 only. Web pages can send requests to localhost, but
 * `content-type: application/json` forces a CORS preflight that we never
 * answer - and origins other than the extension are rejected.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { ROOT, saveSession, type HandoffManifest, type IncomingFile } from "./store.js";
import { updateCheckout } from "./update.js";

const MAX_BODY = 200 * 1024 * 1024;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

const isExtension = (origin: string | undefined) =>
  Boolean(origin?.startsWith("chrome-extension://") || origin?.startsWith("moz-extension://"));

function allowedOrigin(origin: string | undefined) {
  return !origin || isExtension(origin);
}

export function startHttp(port: number, version: string, log: (message: string) => void): Promise<Server | null> {
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (!allowedOrigin(request.headers.origin)) return send(403, { error: "Origin not allowed" });

    if (request.method === "GET" && request.url === "/health") {
      return send(200, { ok: true, version, dir: ROOT });
    }
    if (request.method === "POST" && request.url === "/sessions") {
      if (!String(request.headers["content-type"] ?? "").includes("application/json")) {
        return send(415, { error: "application/json expected" });
      }
      try {
        const payload = JSON.parse(await readBody(request)) as { manifest: HandoffManifest; files: IncomingFile[] };
        if (!payload.manifest?.id || !Array.isArray(payload.files)) return send(400, { error: "manifest and files expected" });
        const dir = await saveSession(payload.manifest, payload.files);
        log(`Recording received: ${payload.manifest.title} (${payload.manifest.items.length} feedback points) → ${dir}`);
        return send(200, { ok: true, path: dir });
      } catch (error) {
        return send(400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (request.method === "POST" && request.url === "/update") {
      // Runs git + build: only from an extension page, never without an Origin.
      if (!isExtension(request.headers.origin)) return send(403, { error: "Only the extension may trigger an update" });
      if (!String(request.headers["content-type"] ?? "").includes("application/json")) {
        return send(415, { error: "application/json expected" });
      }
      try {
        return send(200, { ok: true, ...(await updateCheckout(log)) });
      } catch (error) {
        log(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
        return send(500, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return send(404, { error: "Not found" });
  });

  return new Promise((resolve) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      // Another Claude Code session already holds the port - it writes to the same folder.
      if (error.code === "EADDRINUSE") log(`Port ${port} in use – another TalkContext MCP instance is already receiving.`);
      else log(`HTTP server not started: ${error.message}`);
      resolve(null);
    });
    server.listen(port, "127.0.0.1", () => {
      log(`Receiving recordings on http://127.0.0.1:${port} → ${ROOT}`);
      resolve(server);
    });
  });
}
