/**
 * Empfangsstelle fuer die Extension: POST /sessions mit dem Handoff als JSON.
 *
 * Lauscht nur auf 127.0.0.1. Browser-Seiten koennen zwar Requests an localhost
 * schicken, aber `content-type: application/json` erzwingt einen CORS-Preflight,
 * den wir nie beantworten - und Origins ausser der Extension werden abgelehnt.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { ROOT, saveSession, type HandoffManifest, type IncomingFile } from "./store.js";

const MAX_BODY = 200 * 1024 * 1024;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body zu groß"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function allowedOrigin(origin: string | undefined) {
  return !origin || origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
}

export function startHttp(port: number, version: string, log: (message: string) => void): Promise<Server | null> {
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (!allowedOrigin(request.headers.origin)) return send(403, { error: "Origin nicht erlaubt" });

    if (request.method === "GET" && request.url === "/health") {
      return send(200, { ok: true, version, dir: ROOT });
    }
    if (request.method === "POST" && request.url === "/sessions") {
      if (!String(request.headers["content-type"] ?? "").includes("application/json")) {
        return send(415, { error: "application/json erwartet" });
      }
      try {
        const payload = JSON.parse(await readBody(request)) as { manifest: HandoffManifest; files: IncomingFile[] };
        if (!payload.manifest?.id || !Array.isArray(payload.files)) return send(400, { error: "manifest und files erwartet" });
        const dir = await saveSession(payload.manifest, payload.files);
        log(`Aufnahme empfangen: ${payload.manifest.title} (${payload.manifest.items.length} Feedback-Punkte) → ${dir}`);
        return send(200, { ok: true, path: dir });
      } catch (error) {
        return send(400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return send(404, { error: "Nicht gefunden" });
  });

  return new Promise((resolve) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      // Eine andere Claude-Code-Sitzung haelt den Port schon - die schreibt in denselben Ordner.
      if (error.code === "EADDRINUSE") log(`Port ${port} belegt – eine andere qey-MCP-Instanz empfängt bereits.`);
      else log(`HTTP-Server nicht gestartet: ${error.message}`);
      resolve(null);
    });
    server.listen(port, "127.0.0.1", () => {
      log(`Empfange Aufnahmen auf http://127.0.0.1:${port} → ${ROOT}`);
      resolve(server);
    });
  });
}
