#!/usr/bin/env node
/**
 * TalkContext MCP: gives Claude Code access to the QA recordings of the TalkContext extension.
 *
 *   claude mcp add talkcontext -- node /path/to/talkcontext/mcp/dist/index.js
 *
 * Two jobs in one process:
 *  1. MCP server over stdio - tools for reading feedback, screenshots, logs
 *  2. HTTP receiver on 127.0.0.1:4777 - the extension sends recordings here
 *
 * stdout belongs to the MCP protocol; everything human-readable goes to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { startHttp } from "./http.js";
import { getSession, listSessions, readSessionFile, type SessionSummary } from "./store.js";

const VERSION = "0.1.0";
const PORT = Number(process.env.TALKCONTEXT_PORT ?? 4777);
const log = (message: string) => process.stderr.write(`[talkcontext-mcp] ${message}\n`);

const server = new McpServer(
  { name: "talkcontext", version: VERSION },
  {
    instructions:
      "TalkContext delivers QA feedback from the browser: feedback points (F1, F2, …) with the tester's statement, " +
      "element selector, component chain, screenshots, DOM snippet and errors. Start with " +
      "talkcontext_get_session, then get details and screenshots per point with talkcontext_get_feedback.",
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
  .describe('Recording ID, or "latest" (default) for the most recently received one');

server.registerTool(
  "talkcontext_list_sessions",
  {
    title: "List TalkContext recordings",
    description: "Lists the QA recordings most recently received from the TalkContext extension.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Number of recordings, default 10") },
  },
  async ({ limit }) => {
    const sessions = (await listSessions()).slice(0, limit ?? 10);
    if (!sessions.length) return { content: [text("No recordings received yet.")] };
    const lines = sessions.map(({ id, manifest, receivedAt }) =>
      [
        `- ${id}`,
        manifest.title,
        manifest.url,
        manifest.environment ? `Environment ${manifest.environment}` : null,
        `${manifest.items.length} feedback points`,
        `${manifest.errors.console} console / ${manifest.errors.network} network errors`,
        `received ${new Date(receivedAt).toLocaleString("en-US")}`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    return { content: [text(lines.join("\n"))] };
  },
);

server.registerTool(
  "talkcontext_get_session",
  {
    title: "Read TalkContext handoff",
    description:
      "Returns the full handoff of a QA recording as Markdown: context, environment, all feedback points with statement, element, component, steps and errors, plus flow and transcript. Screenshots are referenced as paths – use talkcontext_get_feedback for the images.",
    inputSchema: { session: sessionArg },
  },
  async ({ session }) => {
    try {
      const found = await getSession(session);
      const markdown = (await readSessionFile(found, "feedback.md")).toString("utf8");
      return { content: [text(`Recording ${found.id} (folder: ${found.dir})\n\n${markdown}`)] };
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "talkcontext_get_feedback",
  {
    title: "TalkContext feedback point with screenshots",
    description:
      "Details for one feedback point (e.g. F3): statement, element, component, errors, styles, DOM snippet and the screenshots as images. Without `item`, all points.",
    inputSchema: {
      session: sessionArg,
      item: z.string().optional().describe('Feedback point, e.g. "F3"'),
      screenshots: z.boolean().optional().describe("Include screenshots (default: true)"),
    },
  },
  async ({ session, item, screenshots }) => {
    try {
      const found = await getSession(session);
      const items = item
        ? found.manifest.items.filter((entry) => entry.key.toLowerCase() === item.trim().toLowerCase())
        : found.manifest.items;
      if (!items.length) {
        return fail(`Point ${item} not found. Available: ${found.manifest.items.map((entry) => entry.key).join(", ") || "none"}`);
      }
      const content: Content[] = [];
      for (const entry of items) {
        content.push(text(entry.markdown));
        if (entry.dom) {
          const dom = (await readSessionFile(found, entry.dom)).toString("utf8");
          content.push(text(`DOM snippet ${entry.key} (${entry.dom}):\n\`\`\`html\n${dom.slice(0, 8000)}\n\`\`\``));
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
  "talkcontext_get_screenshot",
  {
    title: "TalkContext screenshot",
    description: "A single screenshot of a recording, path as in the handoff (e.g. screenshots/f1-1-00-12-3.jpg).",
    inputSchema: { session: sessionArg, path: z.string().describe("Path relative to the recording") },
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
  "talkcontext_get_logs",
  {
    title: "TalkContext console & network",
    description: "Console output or requests of a recording, errors only by default – including request/response bodies of failed requests.",
    inputSchema: {
      session: sessionArg,
      kind: z.enum(["console", "network"]).describe("console or network"),
      errors_only: z.boolean().optional().describe("Errors only (default: true)"),
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
      return { content: [text(entries.length ? JSON.stringify(entries, null, 2) : "No entries.")] };
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerPrompt(
  "fix_feedback",
  {
    title: "Fix TalkContext feedback",
    description: "Works through the QA feedback of the latest (or a specific) TalkContext recording in the current project.",
    argsSchema: { session: z.string().optional().describe('Recording ID or "latest"') },
  },
  ({ session }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Work through the QA feedback from TalkContext (recording: ${session ?? "latest"}).`,
            "",
            "1. Read the handoff with talkcontext_get_session.",
            "2. For each feedback point, get the screenshots and the DOM snippet with talkcontext_get_feedback.",
            "3. Find the code via the component chain/source file, otherwise via selector, data-testid and texts.",
            "4. Fix the points one by one and state per point (F1, F2, …) what you changed.",
            "5. For failed requests, check the bodies with talkcontext_get_logs before guessing.",
            "Ask when a statement is ambiguous instead of guessing.",
          ].join("\n"),
        },
      },
    ],
  }),
);

await startHttp(PORT, VERSION, log);
await server.connect(new StdioServerTransport());
log(`ready (v${VERSION})`);
