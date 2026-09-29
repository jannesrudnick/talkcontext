#!/usr/bin/env node
/**
 * qey-MCP: gibt Claude Code Zugriff auf die QA-Aufnahmen der qey-Extension.
 *
 *   claude mcp add qey -- node /pfad/zu/qey/mcp/dist/index.js
 *
 * Zwei Aufgaben in einem Prozess:
 *  1. MCP-Server ueber stdio - Werkzeuge zum Lesen von Feedback, Screenshots, Logs
 *  2. HTTP-Empfang auf 127.0.0.1:4777 - die Extension schickt Aufnahmen hierher
 *
 * stdout gehoert dem MCP-Protokoll; alles Menschliche geht nach stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { startHttp } from "./http.js";
import { getSession, listSessions, readSessionFile, type SessionSummary } from "./store.js";

const VERSION = "0.1.0";
const PORT = Number(process.env.QEY_PORT ?? 4777);
const log = (message: string) => process.stderr.write(`[qey-mcp] ${message}\n`);

const server = new McpServer(
  { name: "qey", version: VERSION },
  {
    instructions:
      "qey liefert QA-Feedback aus dem Browser: Feedback-Punkte (F1, F2, …) mit Aussage des Testers, " +
      "Element-Selektor, Komponentenkette, Screenshots, DOM-Ausschnitt und Fehlern. Starte mit " +
      "qey_get_session, hol dir Details und Screenshots pro Punkt mit qey_get_feedback.",
  },
);

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const text = (value: string): Content => ({ type: "text", text: value });

async function image(session: SessionSummary, relative: string): Promise<Content> {
  const data = await readSessionFile(session, relative);
  return { type: "image", data: data.toString("base64"), mimeType: relative.endsWith(".png") ? "image/png" : "image/jpeg" };
}

const fail = (error: unknown) => ({
  content: [text(error instanceof Error ? error.message : String(error))],
  isError: true,
});

const sessionArg = z
  .string()
  .optional()
  .describe('ID der Aufnahme oder "latest" (Standard) für die zuletzt empfangene');

server.registerTool(
  "qey_list_sessions",
  {
    title: "qey-Aufnahmen auflisten",
    description: "Listet die zuletzt aus der qey-Extension empfangenen QA-Aufnahmen.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Anzahl, Standard 10") },
  },
  async ({ limit }) => {
    const sessions = (await listSessions()).slice(0, limit ?? 10);
    if (!sessions.length) return { content: [text("Noch keine Aufnahmen empfangen.")] };
    const lines = sessions.map(({ id, manifest, receivedAt }) =>
      [
        `- ${id}`,
        manifest.title,
        manifest.url,
        manifest.environment ? `Umgebung ${manifest.environment}` : null,
        `${manifest.items.length} Feedback-Punkte`,
        `${manifest.errors.console} Konsolen-/${manifest.errors.network} Netzwerkfehler`,
        `empfangen ${new Date(receivedAt).toLocaleString("de-DE")}`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    return { content: [text(lines.join("\n"))] };
  },
);

server.registerTool(
  "qey_get_session",
  {
    title: "qey-Handoff lesen",
    description:
      "Liefert den vollständigen Handoff einer QA-Aufnahme als Markdown: Kontext, Umgebung, alle Feedback-Punkte mit Aussage, Element, Komponente, Schritten und Fehlern, dazu Ablauf und Transkript. Screenshots sind als Pfade referenziert – für die Bilder qey_get_feedback nutzen.",
    inputSchema: { session: sessionArg },
  },
  async ({ session }) => {
    try {
      const found = await getSession(session);
      const markdown = (await readSessionFile(found, "feedback.md")).toString("utf8");
      return { content: [text(`Aufnahme ${found.id} (Ordner: ${found.dir})\n\n${markdown}`)] };
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "qey_get_feedback",
  {
    title: "qey-Feedback-Punkt mit Screenshots",
    description:
      "Details zu einem Feedback-Punkt (z.B. F3): Aussage, Element, Komponente, Fehler, Styles, DOM-Ausschnitt und die Screenshots als Bilder. Ohne `item` alle Punkte.",
    inputSchema: {
      session: sessionArg,
      item: z.string().optional().describe('Feedback-Punkt, z.B. "F3"'),
      screenshots: z.boolean().optional().describe("Screenshots mitliefern (Standard: ja)"),
    },
  },
  async ({ session, item, screenshots }) => {
    try {
      const found = await getSession(session);
      const items = item
        ? found.manifest.items.filter((entry) => entry.key.toLowerCase() === item.trim().toLowerCase())
        : found.manifest.items;
      if (!items.length) {
        return fail(`Punkt ${item} nicht gefunden. Vorhanden: ${found.manifest.items.map((entry) => entry.key).join(", ") || "keine"}`);
      }
      const content: Content[] = [];
      for (const entry of items) {
        content.push(text(entry.markdown));
        if (entry.dom) {
          const dom = (await readSessionFile(found, entry.dom)).toString("utf8");
          content.push(text(`DOM-Ausschnitt ${entry.key} (${entry.dom}):\n\`\`\`html\n${dom.slice(0, 8000)}\n\`\`\``));
        }
        if (screenshots !== false) {
          for (const shot of entry.screenshots) {
            content.push(text(`Screenshot ${entry.key}: ${shot}`));
            content.push(await image(found, shot));
          }
        }
      }
      return { content };
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "qey_get_screenshot",
  {
    title: "qey-Screenshot",
    description: "Einzelner Screenshot einer Aufnahme, Pfad wie im Handoff (z.B. screenshots/f1-1-00-12-3.jpg).",
    inputSchema: { session: sessionArg, path: z.string().describe("Pfad relativ zur Aufnahme") },
  },
  async ({ session, path }) => {
    try {
      const found = await getSession(session);
      return { content: [await image(found, path)] };
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "qey_get_logs",
  {
    title: "qey-Konsole & Netzwerk",
    description: "Konsolenausgaben oder Requests einer Aufnahme, standardmäßig nur Fehler – inkl. Request-/Response-Bodies fehlgeschlagener Requests.",
    inputSchema: {
      session: sessionArg,
      kind: z.enum(["console", "network"]).describe("console oder network"),
      errors_only: z.boolean().optional().describe("Nur Fehler (Standard: ja)"),
    },
  },
  async ({ session, kind, errors_only }) => {
    try {
      const found = await getSession(session);
      const data = JSON.parse((await readSessionFile(found, "session.json")).toString("utf8")) as {
        console?: Array<{ level: string }>;
        network?: Array<{ status: number }>;
      };
      const onlyErrors = errors_only !== false;
      const entries =
        kind === "console"
          ? (data.console ?? []).filter((entry) => !onlyErrors || entry.level === "error" || entry.level === "warn")
          : (data.network ?? []).filter((entry) => !onlyErrors || entry.status === 0 || entry.status >= 400);
      return { content: [text(entries.length ? JSON.stringify(entries, null, 2) : "Keine Einträge.")] };
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerPrompt(
  "fix_feedback",
  {
    title: "qey-Feedback fixen",
    description: "Arbeitet das QA-Feedback der letzten (oder einer bestimmten) qey-Aufnahme im aktuellen Projekt ab.",
    argsSchema: { session: z.string().optional().describe('Aufnahme-ID oder "latest"') },
  },
  ({ session }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Arbeite das QA-Feedback aus qey ab (Aufnahme: ${session ?? "latest"}).`,
            "",
            "1. Lies den Handoff mit qey_get_session.",
            "2. Hol dir für jeden Feedback-Punkt mit qey_get_feedback die Screenshots und den DOM-Ausschnitt.",
            "3. Finde den Code über Komponentenkette/Quelldatei, sonst über Selektor, data-testid und Texte.",
            "4. Behebe die Punkte einzeln und nenne pro Punkt (F1, F2, …), was du geändert hast.",
            "5. Bei fehlgeschlagenen Requests die Bodies mit qey_get_logs prüfen, bevor du rätst.",
            "Frag nach, wenn eine Aussage mehrdeutig ist, statt zu raten.",
          ].join("\n"),
        },
      },
    ],
  }),
);

await startHttp(PORT, VERSION, log);
await server.connect(new StdioServerTransport());
log(`bereit (v${VERSION})`);
