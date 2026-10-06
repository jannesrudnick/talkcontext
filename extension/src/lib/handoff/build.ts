/**
 * Handoff to the coding agent.
 *
 * Instead of a timeline with every hover, the front shows what the tester
 * explicitly marked as a finding - each point with statement, element,
 * component, screenshots, steps before, errors in its time window, styles and
 * DOM snippet. The detailed timeline stays as an appendix.
 *
 * The result is a file tree that is downloaded as a ZIP, sent to the local
 * qey MCP server or (Markdown only) copied to the clipboard:
 *
 *   feedback.md        Handoff for reading
 *   handoff.json       Structured, separate Markdown per point (for MCP tools)
 *   session.json       Full log (qa-recording/1) plus console/network
 *   screenshots/*.jpg  With timestamp in the name
 *   dom/f<n>.html      DOM snippet, target marked with data-qey-target
 */
import { buildJson, describeElement, eventHeadline, formatDuration, formatTimecode } from "@/lib/qa/export";
import type { QaEvent } from "@/lib/qa/types";
import {
  speechByFeedback,
  toQaSession,
  transcriptEpoch,
  type LoadedRecording,
} from "@/features/recordings/load";
import type { ConsoleEntry, FeedbackItem, NetworkEntry, Screenshot } from "@/lib/types";

export const HANDOFF_VERSION = "qey-handoff/1";

export interface HandoffFile {
  path: string;
  data: Uint8Array | string;
}

export interface HandoffItem {
  key: string;
  title: string;
  markdown: string;
  screenshots: string[];
  dom?: string;
}

export interface HandoffManifest {
  version: typeof HANDOFF_VERSION;
  id: string;
  title: string;
  url: string;
  startedAt: string;
  durationMs: number;
  environment?: string;
  items: HandoffItem[];
  errors: { console: number; network: number };
}

export interface Handoff {
  markdown: string;
  manifest: HandoffManifest;
  files: HandoffFile[];
}

const REPRO_TYPES = new Set<QaEvent["type"]>(["click", "dblclick", "input", "change", "submit", "navigate", "key"]);

function pad(ms: number) {
  return formatTimecode(ms).replace(":", "-").replace(".", "-");
}

function pathOf(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function quote(text: string) {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function isFailed(entry: NetworkEntry) {
  return entry.status === 0 || entry.status >= 400;
}

function networkLine(entry: NetworkEntry, start: number) {
  const lines = [
    `- [${formatTimecode(entry.ts - start)}] ${entry.method} ${entry.url} → **${entry.status || "Network error"}**${entry.error ? ` (${entry.error})` : ""} · ${entry.durationMs} ms`,
  ];
  if (entry.requestBody) lines.push(`  - Request: \`${entry.requestBody.replace(/`/g, "'")}\``);
  if (entry.responseBody) lines.push(`  - Response: \`${entry.responseBody.replace(/`/g, "'").replace(/\n/g, " ")}\``);
  return lines.join("\n");
}

function consoleLine(entry: ConsoleEntry, start: number) {
  const lines = [`- [${formatTimecode(entry.ts - start)}] console.${entry.level}: ${entry.message}`];
  if (entry.source) lines.push(`  - Source: ${entry.source}`);
  if (entry.stack) lines.push(`  - Stack: \`${entry.stack.split("\n").slice(0, 4).join(" ⏎ ").replace(/`/g, "'")}\``);
  return lines.join("\n");
}

function short(value: unknown, max = 60) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function element(event: QaEvent) {
  const ref = event.target;
  if (!ref) return "";
  const name = ref.name ?? ref.text;
  return name ? `${ref.role ?? ref.tag} "${short(name, 50)}"` : `\`${ref.selector}\``;
}

/** Short, human-readable step for reproduction and flow. */
function stepLine(event: QaEvent) {
  const detail = event.detail ?? {};
  switch (event.type) {
    case "click":
      return `Click on ${element(event)}`;
    case "dblclick":
      return `Double-click on ${element(event)}`;
    case "input":
      return `Input in ${element(event)}: "${short(detail.value)}"`;
    case "change":
      return `Selection in ${element(event)}: "${short(detail.label ?? detail.value)}"`;
    case "submit":
      return `Form submitted (${String(detail.method ?? "GET")} ${short(detail.action, 80)})`;
    case "key":
      return `Key ${String(detail.key ?? "")}${event.target ? ` in ${element(event)}` : ""}`;
    case "navigate":
      return detail.kind === "load" || detail.kind === "start" ? `Page loaded: ${String(detail.to ?? "")}` : `Navigation to ${String(detail.to ?? "")}`;
    case "note":
    case "marker":
      return `Feedback ${short(detail.text, 100)}`;
    default:
      return eventHeadline(event);
  }
}

const isStep = (event: QaEvent) =>
  REPRO_TYPES.has(event.type) && (event.type !== "key" || String(event.detail?.key ?? "").endsWith("Enter"));

/**
 * Each error belongs to at most one point - the closest one in time
 * whose window (8 s before to 3 s after) contains it.
 */
export function assignErrors<T extends { id: string; ts: number }>(entries: T[], items: FeedbackItem[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const entry of entries) {
    let best: FeedbackItem | null = null;
    let bestDistance = Infinity;
    for (const item of items) {
      const from = item.activeFrom;
      const to = item.activeTo ?? from;
      if (entry.ts < from - 8000 || entry.ts > to + 3000) continue;
      const distance = entry.ts < from ? from - entry.ts : entry.ts > to ? entry.ts - to : 0;
      if (distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    if (best) result.set(best.id, [...(result.get(best.id) ?? []), entry]);
  }
  return result;
}

async function toBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildHandoff(recording: LoadedRecording): Promise<Handoff> {
  const { meta } = recording;
  const start = meta.startedAt;
  const end = meta.endedAt ?? start + meta.durationMs;
  const speech = speechByFeedback(recording);
  const files: HandoffFile[] = [];

  /* ---------------------------------------------------------- Screenshots */

  const shotPath = new Map<string, string>();
  const shotsByItem = new Map<string, Screenshot[]>();
  for (const shot of recording.screenshots) {
    const item = recording.feedback.find((entry) => entry.id === shot.feedbackId);
    const list = item ? (shotsByItem.get(item.id) ?? []) : [];
    const name = item
      ? `f${item.index}-${list.length + 1}-${pad(shot.ts - start)}.jpg`
      : `${shot.reason}-${pad(shot.ts - start)}.jpg`;
    const path = `screenshots/${name}`;
    shotPath.set(shot.id, path);
    if (item) shotsByItem.set(item.id, [...list, shot]);
    files.push({ path, data: await toBytes(shot.blob) });
  }

  const failedRequests = recording.network.filter(isFailed);
  const consoleErrors = recording.console.filter((entry) => entry.level === "error");
  const claimedErrors = new Set<string>();
  const requestsByItem = assignErrors(failedRequests, recording.feedback);
  const consoleByItem = assignErrors(consoleErrors, recording.feedback);

  /* ------------------------------------------------------ Feedback points */

  const items: HandoffItem[] = [];
  let previousEnd = start;
  for (const item of recording.feedback) {
    const key = `F${item.index}`;
    const said = speech.get(item.id) ?? [];
    const statement = [said.join(" ").trim(), item.text.trim()].filter(Boolean);
    const from = item.activeFrom;
    const to = item.activeTo ?? from;
    const target = item.target;
    const title = `${key} · [${formatTimecode(from - start)}] ${target ? describeElement(target) : "no element"} – ${pathOf(item.url)}`;

    const lines: string[] = [`## ${title}`, ""];
    lines.push(statement.length ? quote(statement.map((text) => `"${text}"`).join("\n")) : "> _(no statement – see screenshot)_");
    lines.push("");

    if (target) {
      lines.push(`- **Element:** \`${target.selector}\`${target.role ? ` · role \`${target.role}\`` : ""}${target.name ? ` · name "${target.name}"` : ""}`);
      if (target.rect) lines.push(`- **Position:** ${target.rect.x},${target.rect.y} · ${target.rect.w}×${target.rect.h} px`);
    }
    if (item.component) {
      lines.push(
        `- **Component (${item.component.framework}):** \`${item.component.chain.join(" › ")}\`${item.component.file ? ` – \`${item.component.file}\`` : ""}`,
      );
    }
    lines.push(`- **Page:** ${item.url}${item.pageTitle ? ` ("${item.pageTitle}")` : ""}`);
    lines.push(`- **Captured via:** ${{ contextmenu: "right-click", pen: "pen marking", note: "note", marker: "bug marker" }[item.source]}`);

    const shots = (shotsByItem.get(item.id) ?? []).map((shot) => shotPath.get(shot.id)!);
    if (shots.length) {
      lines.push("", "**Screenshots**", "");
      for (const [index, path] of shots.entries()) {
        const shot = shotsByItem.get(item.id)![index]!;
        lines.push(`![${key} · ${formatTimecode(shot.ts - start)}${shot.reason === "stroke" ? " · with marking" : ""}](${path})`);
      }
    }

    const steps = recording.events.filter((event) => isStep(event) && event.ts >= previousEnd && event.ts <= from).slice(-12);
    if (steps.length) {
      lines.push("", "**Steps before**", "");
      steps.forEach((event, index) => lines.push(`${index + 1}. ${stepLine(event)}`));
    }

    const nearRequests = requestsByItem.get(item.id) ?? [];
    const nearConsole = consoleByItem.get(item.id) ?? [];
    if (nearRequests.length || nearConsole.length) {
      lines.push("", "**Errors in this window**", "");
      for (const entry of nearRequests) {
        claimedErrors.add(entry.id);
        lines.push(networkLine(entry, start));
      }
      for (const entry of nearConsole) {
        claimedErrors.add(entry.id);
        lines.push(consoleLine(entry, start));
      }
    }

    if (item.styles && Object.keys(item.styles).length) {
      lines.push(
        "",
        "**Computed styles**",
        "",
        "```css",
        Object.entries(item.styles)
          .map(([prop, value]) => `${prop}: ${value};`)
          .join("\n"),
        "```",
      );
    }

    let domPath: string | undefined;
    if (item.dom) {
      domPath = `dom/f${item.index}.html`;
      files.push({ path: domPath, data: item.dom });
      lines.push("", `**DOM snippet:** \`${domPath}\` (target marked with \`data-qey-target\`)`);
    }

    items.push({ key, title, markdown: lines.join("\n"), screenshots: shots, dom: domPath });
    previousEnd = to;
  }

  /* ------------------------------------------------------------- Markdown */

  const env = meta.environment;
  const out: string[] = [];
  out.push(`# QA feedback: ${meta.title}`, "");
  out.push(
    quote(
      [
        "Recorded with qey. The feedback points (F1, F2, …) are explicit findings by the tester:",
        "made by right-clicking an element, marking with the pen or as a note. Whatever was said meanwhile",
        "is attached directly to the point. Screenshots are in `screenshots/`, DOM snippets in `dom/`.",
      ].join("\n"),
    ),
    "",
  );
  out.push("## Context", "");
  out.push(`- Application: ${meta.initialUrl}`);
  if (env) out.push(`- Environment: **${env.name}**`);
  out.push(`- Recorded: ${new Date(start).toISOString()} · Duration ${formatDuration(meta.durationMs)}`);
  out.push(`- Viewport: ${meta.viewport.width}×${meta.viewport.height} @${meta.viewport.dpr}x`);
  out.push(`- Browser: ${meta.userAgent}`);
  out.push(
    `- Scope: ${items.length} feedback points, ${consoleErrors.length} console errors, ${failedRequests.length} failed requests, ${recording.screenshots.length} screenshots`,
  );
  out.push("");

  if (env && (env.notes || env.variables.length)) {
    out.push(`## Environment: ${env.name}`, "");
    if (env.notes) out.push(env.notes, "");
    for (const variable of env.variables) out.push(`- \`${variable.key}\` = \`${variable.value}\``);
    if (env.variables.length) out.push("");
  }

  if (items.length) {
    out.push("## Overview", "", "| # | Time | Element | Statement |", "| --- | --- | --- | --- |");
    for (const item of recording.feedback) {
      const said = [...(speech.get(item.id) ?? []), item.text].join(" ").trim().replace(/\|/g, "/");
      out.push(
        `| F${item.index} | ${formatTimecode(item.activeFrom - start)} | ${item.target ? `\`${item.target.selector.replace(/\|/g, "/")}\`` : "–"} | ${said.length > 90 ? `${said.slice(0, 90)}…` : said || "–"} |`,
      );
    }
    out.push("");
    for (const item of items) out.push(item.markdown, "");
  } else {
    out.push("## Feedback points", "", "_No explicit feedback points – see flow and transcript._", "");
  }

  const otherRequests = failedRequests.filter((entry) => !claimedErrors.has(entry.id));
  const otherConsole = consoleErrors.filter((entry) => !claimedErrors.has(entry.id));
  if (otherRequests.length || otherConsole.length) {
    out.push("## Other errors not tied to feedback", "");
    for (const entry of otherRequests) out.push(networkLine(entry, start));
    for (const entry of otherConsole) out.push(consoleLine(entry, start));
    out.push("");
  }

  const otherShots = recording.screenshots.filter((shot) => !shot.feedbackId || !recording.feedback.some((item) => item.id === shot.feedbackId));
  if (otherShots.length) {
    out.push("## Other screenshots", "");
    for (const shot of otherShots) {
      out.push(`![${shot.reason === "error" ? "On error" : "Screenshot"} · ${formatTimecode(shot.ts - start)}](${shotPath.get(shot.id)})`);
    }
    out.push("");
  }

  const flow = recording.events.filter((event) => isStep(event) || event.type === "note" || event.type === "marker");
  if (flow.length) {
    out.push("## Flow (compact)", "");
    for (const event of flow) {
      const selector = event.target?.selector && event.type !== "navigate" ? ` – \`${event.target.selector}\`` : "";
      out.push(`- [${formatTimecode(event.ts - start)}] ${stepLine(event)}${selector}`);
    }
    out.push("");
  }

  const transcript = transcriptEpoch(recording);
  if (transcript.length) {
    out.push("## Transcript", "");
    for (const segment of transcript) out.push(`- [${formatTimecode(segment.start - start)}] ${segment.text}`);
    out.push("");
  }

  const markdown = out.join("\n");

  /* ----------------------------------------------------------- File tree */

  const manifest: HandoffManifest = {
    version: HANDOFF_VERSION,
    id: meta.id,
    title: meta.title,
    url: meta.initialUrl,
    startedAt: new Date(start).toISOString(),
    durationMs: meta.durationMs,
    environment: env?.name,
    items,
    errors: { console: consoleErrors.length, network: failedRequests.length },
  };

  const session = JSON.parse(buildJson(toQaSession(recording))) as Record<string, unknown>;
  files.unshift(
    { path: "feedback.md", data: markdown },
    { path: "handoff.json", data: JSON.stringify(manifest, null, 2) },
    {
      path: "session.json",
      data: JSON.stringify(
        {
          ...session,
          feedback: recording.feedback.map((item: FeedbackItem) => ({ ...item, speech: speech.get(item.id) ?? item.speech })),
          console: recording.console,
          network: recording.network,
          endedAt: end,
        },
        null,
        2,
      ),
    },
  );

  return { markdown, manifest, files };
}
