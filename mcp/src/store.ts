/**
 * Ablage der Handoffs auf der Platte: ~/.qey/sessions/<id>/...
 *
 * Die Extension schickt jede Aufnahme als Dateibaum (feedback.md, handoff.json,
 * session.json, screenshots/, dom/). Mehrere Claude-Code-Sitzungen teilen sich
 * denselben Ordner - wer den HTTP-Port gerade haelt, schreibt, alle lesen.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const ROOT = path.resolve(process.env.QEY_DIR ?? path.join(homedir(), ".qey"));
export const SESSIONS = path.join(ROOT, "sessions");

export interface HandoffItem {
  key: string;
  title: string;
  markdown: string;
  screenshots: string[];
  dom?: string;
}

export interface HandoffManifest {
  version: string;
  id: string;
  title: string;
  url: string;
  startedAt: string;
  durationMs: number;
  environment?: string;
  items: HandoffItem[];
  errors: { console: number; network: number };
}

export interface IncomingFile {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Pfad innerhalb des Session-Ordners - alles andere wird abgelehnt. */
function resolveInside(dir: string, relative: string): string {
  const target = path.resolve(dir, relative);
  if (target !== dir && !target.startsWith(dir + path.sep)) throw new Error(`Ungültiger Pfad: ${relative}`);
  return target;
}

export async function saveSession(manifest: HandoffManifest, files: IncomingFile[]): Promise<string> {
  if (!SAFE_ID.test(manifest.id)) throw new Error("Ungültige Session-ID");
  const dir = path.join(SESSIONS, manifest.id);
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    const target = resolveInside(dir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content);
  }
  await writeFile(path.join(dir, "received.json"), JSON.stringify({ receivedAt: new Date().toISOString() }));
  return dir;
}

export interface SessionSummary {
  id: string;
  dir: string;
  receivedAt: number;
  manifest: HandoffManifest;
}

export async function listSessions(): Promise<SessionSummary[]> {
  let ids: string[];
  try {
    ids = await readdir(SESSIONS);
  } catch {
    return [];
  }
  const sessions: SessionSummary[] = [];
  for (const id of ids) {
    const dir = path.join(SESSIONS, id);
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, "handoff.json"), "utf8")) as HandoffManifest;
      const receivedAt = (await stat(path.join(dir, "received.json")).catch(() => stat(dir))).mtimeMs;
      sessions.push({ id, dir, receivedAt, manifest });
    } catch {
      /* unvollstaendiger Ordner - ueberspringen */
    }
  }
  return sessions.sort((a, b) => b.receivedAt - a.receivedAt);
}

export async function getSession(ref: string | undefined): Promise<SessionSummary> {
  const sessions = await listSessions();
  if (!sessions.length) {
    throw new Error(
      "Noch keine qey-Aufnahmen empfangen. In der Extension eine Aufnahme öffnen und „An Claude senden“ klicken (der qey-MCP-Server muss dabei laufen).",
    );
  }
  if (!ref || ref === "latest") return sessions[0]!;
  const match = sessions.find((session) => session.id === ref || session.manifest.title === ref);
  if (!match) throw new Error(`Aufnahme „${ref}“ nicht gefunden. Verfügbar: ${sessions.map((s) => s.id).join(", ")}`);
  return match;
}

export async function readSessionFile(session: SessionSummary, relative: string): Promise<Buffer> {
  return readFile(resolveInside(session.dir, relative));
}
