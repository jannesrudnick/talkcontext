/**
 * Export of the recording in agent-friendly formats.
 *
 * JSON = complete data, Markdown = readable timeline in which speech and
 * DOM interaction are interleaved. Neither needs a screenshot.
 */
import { correlate, type CorrelatedEvent } from "./correlate";
import type { ElementRef, QaEvent, QaSession } from "./types";

export function formatTimecode(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Short description of an element for the timeline. */
export function describeElement(ref: ElementRef | undefined): string {
  if (!ref) return "(no element)";
  const role = ref.role ?? ref.tag;
  const name = ref.name ?? ref.text;
  return name ? `${role} "${name}"` : `${role} \`${ref.selector}\``;
}

export interface SessionSummary {
  clicks: number;
  hovers: number;
  inputs: number;
  navigations: number;
  errors: number;
  notes: number;
  elements: number;
}

export function summarize(session: QaSession): SessionSummary {
  const elements = new Set<string>();
  let clicks = 0;
  let hovers = 0;
  let inputs = 0;
  let navigations = 0;
  let errors = 0;
  let notes = 0;

  for (const event of session.events) {
    if (event.target?.selector) elements.add(event.target.selector);
    switch (event.type) {
      case "click":
      case "dblclick":
        clicks += 1;
        break;
      case "hover":
        if (event.detail?.phase === "start") hovers += 1;
        break;
      case "input":
      case "change":
        inputs += 1;
        break;
      case "navigate":
        navigations += 1;
        break;
      case "console":
      case "network":
        errors += 1;
        break;
      case "note":
        notes += 1;
        break;
      default:
        break;
    }
  }

  return { clicks, hovers, inputs, navigations, errors, notes, elements: elements.size };
}

/** Human- and agent-readable line for a single event. */
export function eventHeadline(event: QaEvent): string {
  const target = describeElement(event.target);
  const detail = event.detail ?? {};

  switch (event.type) {
    case "click":
      return `CLICK on ${target}`;
    case "dblclick":
      return `DOUBLE-CLICK on ${target}`;
    case "contextmenu":
      return `RIGHT-CLICK on ${target}`;
    case "hover": {
      const duration = typeof detail.durationMs === "number" ? ` (${(detail.durationMs / 1000).toFixed(1)}s)` : "";
      return detail.phase === "end" ? `HOVER END ${target}${duration}` : `HOVER on ${target}`;
    }
    case "input":
      return `INPUT in ${target}: "${String(detail.value ?? "")}"`;
    case "change":
      return `SELECTION in ${target}: "${String(detail.label ?? detail.value ?? "")}"`;
    case "key":
      return `KEY ${String(detail.key ?? "")}${event.target ? ` in ${target}` : ""}`;
    case "submit":
      return `FORM submitted (${String(detail.method ?? "GET")} ${String(detail.action ?? "")})`;
    case "scroll":
      return detail.scope === "page"
        ? `SCROLL page to ${String(detail.percent ?? 0)}%`
        : `SCROLL in ${target} to ${String(detail.top ?? 0)}px`;
    case "navigate":
      if (detail.kind === "start") return `START on ${String(detail.to ?? "")}`;
      // The extension reports every full page load with kind "load".
      if (detail.kind === "load") return `PAGE LOADED ${String(detail.to ?? "")}`;
      return `NAVIGATION ${String(detail.from ?? "")} -> ${String(detail.to ?? "")}`;
    case "resize":
      return `VIEWPORT ${String(detail.width ?? "")}x${String(detail.height ?? "")}`;
    case "select":
      return `TEXT SELECTED: "${String(detail.text ?? "")}"`;
    case "console":
      return `CONSOLE ${String(detail.level ?? "log").toUpperCase()}: ${String(detail.message ?? "")}`;
    case "network":
      return `REQUEST ${String(detail.method ?? "GET")} ${String(detail.url ?? "")} -> ${String(detail.status ?? 0)}`;
    case "note":
      return `NOTE: ${String(detail.text ?? "")}`;
    case "marker":
      return `MARKER: ${String(detail.text ?? "")}`;
    default:
      return event.type;
  }
}

function effectLines(event: QaEvent): string[] {
  const effect = event.effect;
  if (!effect) return [];
  const parts: string[] = [];
  if (effect.urlChanged) parts.push(`URL: ${effect.urlChanged.from} -> ${effect.urlChanged.to}`);
  if (effect.dialogOpened) parts.push("Dialog opened");
  if (effect.alert) parts.push(`Message: "${effect.alert}"`);
  if (effect.newText) parts.push(`New text: "${effect.newText}"`);
  if (effect.added || effect.removed) {
    parts.push(`DOM: +${effect.added ?? 0} / -${effect.removed ?? 0} nodes`);
  }
  if (effect.attrChanges?.length) {
    parts.push(
      `Attributes: ${effect.attrChanges
        .map((change) => `${change.selector}[${change.attr}=${change.value ?? "null"}]`)
        .join(", ")}`,
    );
  }
  return parts.length ? [`  - Effect: ${parts.join("; ")}`] : [];
}

type TimelineItem =
  | { t: number; kind: "event"; event: CorrelatedEvent }
  | { t: number; kind: "speech"; text: string };

/**
 * Merge speech and interaction into one shared, sorted timeline.
 * Speech that could be assigned to an event already hangs off its
 * `spokenContext` (see correlate.ts) and is not listed separately again here -
 * only what is left over (pauses, thinking aloud) is mixed in as a line
 * of its own.
 */
function buildTimeline(session: QaSession): TimelineItem[] {
  const { events, unmatched } = correlate(session);

  const items: TimelineItem[] = events
    .filter((event) => !(event.type === "hover" && event.detail?.phase === "end" && Number(event.detail?.durationMs ?? 0) < 1000))
    .map((event) => ({ t: event.t, kind: "event" as const, event }));

  for (const segment of unmatched) {
    items.push({ t: segment.t, kind: "speech", text: segment.text.trim() });
  }

  return items.sort((a, b) => a.t - b.t);
}

export function buildMarkdown(session: QaSession): string {
  const summary = summarize(session);
  const lines: string[] = [];

  lines.push(`# QA recording: ${session.meta.title}`);
  lines.push("");
  lines.push(
    "> Machine-readable log of a manual QA session. Instead of a video it contains",
    "> the DOM elements the mouse was on or clicked, together with the spoken explanation.",
  );
  lines.push("");
  lines.push("## Context");
  lines.push("");
  lines.push(`- Target: ${session.meta.initialUrl}`);
  lines.push(`- Start: ${session.meta.startedAt}`);
  lines.push(`- Duration: ${formatDuration(session.meta.durationMs)}`);
  lines.push(`- Viewport: ${session.meta.viewport.width}x${session.meta.viewport.height} @${session.meta.viewport.dpr}x`);
  lines.push(`- Recording mode: ${session.meta.mode}`);
  if (session.meta.environment) lines.push(`- Environment: ${session.meta.environment.name}`);
  lines.push(
    `- Scope: ${summary.clicks} clicks, ${summary.hovers} hovers, ${summary.inputs} inputs, ` +
      `${summary.navigations} navigations, ${summary.errors} errors, ${summary.notes} notes`,
  );
  lines.push("");

  const environment = session.meta.environment;
  if (environment && (environment.notes || environment.variables?.length)) {
    lines.push(`## Environment: ${environment.name}`);
    lines.push("");
    if (environment.notes) {
      lines.push(environment.notes);
      lines.push("");
    }
    for (const variable of environment.variables ?? []) {
      lines.push(`- \`${variable.key}\` = \`${variable.value}\``);
    }
    if (environment.variables?.length) lines.push("");
  }

  const notes = session.events.filter((event) => event.type === "note" || event.type === "marker");
  if (notes.length) {
    lines.push("## Marked findings");
    lines.push("");
    for (const note of notes) {
      lines.push(`- **[${formatTimecode(note.t)}]** ${String(note.detail?.text ?? "")}`);
      if (note.target) lines.push(`  - Element: \`${note.target.selector}\` (${describeElement(note.target)})`);
    }
    lines.push("");
  }

  lines.push("## Timeline");
  lines.push("");
  for (const item of buildTimeline(session)) {
    if (item.kind === "speech") {
      lines.push(`- **[${formatTimecode(item.t)}]** SPOKEN: "${item.text}"`);
      continue;
    }
    const { event } = item;
    lines.push(`- **[${formatTimecode(event.t)}]** ${eventHeadline(event)}`);
    if (event.target?.selector) {
      lines.push(`  - Selector: \`${event.target.selector}\``);
    }
    if (event.spokenContext?.length) {
      lines.push(`  - Said: "${event.spokenContext.join(" ")}"`);
    }
    lines.push(...effectLines(event));
  }
  lines.push("");

  const elements = new Map<string, ElementRef>();
  for (const event of session.events) {
    if (event.target?.selector && !elements.has(event.target.selector)) {
      elements.set(event.target.selector, event.target);
    }
  }
  if (elements.size) {
    lines.push("## Touched elements");
    lines.push("");
    for (const ref of elements.values()) {
      lines.push(`### \`${ref.selector}\``);
      lines.push("");
      lines.push(`- Tag: \`${ref.tag}\`${ref.role ? ` / Role: \`${ref.role}\`` : ""}`);
      if (ref.name) lines.push(`- Name: "${ref.name}"`);
      if (ref.path?.length) lines.push(`- Path: ${ref.path.join(" > ")}`);
      lines.push(`- XPath: \`${ref.xpath}\``);
      if (ref.attrs && Object.keys(ref.attrs).length) {
        lines.push(
          `- Attributes: ${Object.entries(ref.attrs)
            .map(([key, value]) => `\`${key}="${value}"\``)
            .join(", ")}`,
        );
      }
      if (ref.html) {
        lines.push("");
        lines.push("```html");
        lines.push(ref.html);
        lines.push("```");
      }
      lines.push("");
    }
  }

  const fullTranscript = session.transcript
    .filter((segment) => segment.final)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  if (fullTranscript) {
    lines.push("## Full transcript");
    lines.push("");
    lines.push(fullTranscript);
    lines.push("");
  }

  return lines.join("\n");
}

export function buildJson(session: QaSession): string {
  const { events } = correlate(session);
  return JSON.stringify({ ...session, events }, null, 2);
}

export function downloadFile(fileName: string, content: BlobPart, mimeType: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sessionFileBase(session: QaSession): string {
  const host = (() => {
    try {
      return new URL(session.meta.initialUrl).hostname.replace(/[^a-z0-9.-]/gi, "");
    } catch {
      return "session";
    }
  })();
  const stamp = session.meta.startedAt.replace(/[:.]/g, "-").slice(0, 19);
  return `qa-${host}-${stamp}`;
}
