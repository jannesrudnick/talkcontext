/**
 * Export der Aufnahme in agentenfreundliche Formate.
 *
 * JSON = vollstaendige Daten, Markdown = lesbare Timeline, in der Sprache und
 * DOM-Interaktion verschraenkt sind. Beides kommt ohne Screenshot aus.
 */
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

/** Kurzbeschreibung eines Elements fuer die Timeline. */
export function describeElement(ref: ElementRef | undefined): string {
  if (!ref) return "(kein Element)";
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

/** Menschen- und agentenlesbare Zeile fuer ein einzelnes Event. */
export function eventHeadline(event: QaEvent): string {
  const target = describeElement(event.target);
  const detail = event.detail ?? {};

  switch (event.type) {
    case "click":
      return `KLICK auf ${target}`;
    case "dblclick":
      return `DOPPELKLICK auf ${target}`;
    case "contextmenu":
      return `RECHTSKLICK auf ${target}`;
    case "hover": {
      const duration = typeof detail.durationMs === "number" ? ` (${(detail.durationMs / 1000).toFixed(1)}s)` : "";
      return detail.phase === "end" ? `HOVER-ENDE ${target}${duration}` : `HOVER auf ${target}`;
    }
    case "input":
      return `EINGABE in ${target}: "${String(detail.value ?? "")}"`;
    case "change":
      return `AUSWAHL in ${target}: "${String(detail.label ?? detail.value ?? "")}"`;
    case "key":
      return `TASTE ${String(detail.key ?? "")}${event.target ? ` in ${target}` : ""}`;
    case "submit":
      return `FORMULAR abgeschickt (${String(detail.method ?? "GET")} ${String(detail.action ?? "")})`;
    case "scroll":
      return detail.scope === "page"
        ? `SCROLL Seite auf ${String(detail.percent ?? 0)}%`
        : `SCROLL in ${target} auf ${String(detail.top ?? 0)}px`;
    case "navigate":
      return detail.kind === "start"
        ? `START auf ${String(detail.to ?? "")}`
        : `NAVIGATION ${String(detail.from ?? "")} -> ${String(detail.to ?? "")}`;
    case "resize":
      return `VIEWPORT ${String(detail.width ?? "")}x${String(detail.height ?? "")}`;
    case "select":
      return `TEXT MARKIERT: "${String(detail.text ?? "")}"`;
    case "console":
      return `KONSOLE ${String(detail.level ?? "log").toUpperCase()}: ${String(detail.message ?? "")}`;
    case "network":
      return `REQUEST ${String(detail.method ?? "GET")} ${String(detail.url ?? "")} -> ${String(detail.status ?? 0)}`;
    case "note":
      return `NOTIZ: ${String(detail.text ?? "")}`;
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
  if (effect.dialogOpened) parts.push("Dialog geoeffnet");
  if (effect.alert) parts.push(`Meldung: "${effect.alert}"`);
  if (effect.newText) parts.push(`Neuer Text: "${effect.newText}"`);
  if (effect.added || effect.removed) {
    parts.push(`DOM: +${effect.added ?? 0} / -${effect.removed ?? 0} Knoten`);
  }
  if (effect.attrChanges?.length) {
    parts.push(
      `Attribute: ${effect.attrChanges
        .map((change) => `${change.selector}[${change.attr}=${change.value ?? "null"}]`)
        .join(", ")}`,
    );
  }
  return parts.length ? [`  - Wirkung: ${parts.join("; ")}`] : [];
}

type TimelineItem =
  | { t: number; kind: "event"; event: QaEvent }
  | { t: number; kind: "speech"; text: string };

/** Sprache und Interaktion in eine gemeinsame, sortierte Timeline mischen. */
function buildTimeline(session: QaSession): TimelineItem[] {
  const items: TimelineItem[] = session.events
    .filter((event) => !(event.type === "hover" && event.detail?.phase === "end" && Number(event.detail?.durationMs ?? 0) < 1000))
    .map((event) => ({ t: event.t, kind: "event" as const, event }));

  for (const segment of session.transcript) {
    if (!segment.final || !segment.text.trim()) continue;
    items.push({ t: segment.t, kind: "speech", text: segment.text.trim() });
  }

  return items.sort((a, b) => a.t - b.t);
}

export function buildMarkdown(session: QaSession): string {
  const summary = summarize(session);
  const lines: string[] = [];

  lines.push(`# QA-Aufnahme: ${session.meta.title}`);
  lines.push("");
  lines.push(
    "> Maschinenlesbares Protokoll einer manuellen QA-Session. Statt eines Videos enthaelt es",
    "> die DOM-Elemente, auf denen die Maus stand bzw. geklickt wurde, samt gesprochener Erklaerung.",
  );
  lines.push("");
  lines.push("## Kontext");
  lines.push("");
  lines.push(`- Ziel: ${session.meta.initialUrl}`);
  lines.push(`- Start: ${session.meta.startedAt}`);
  lines.push(`- Dauer: ${formatDuration(session.meta.durationMs)}`);
  lines.push(`- Viewport: ${session.meta.viewport.width}x${session.meta.viewport.height} @${session.meta.viewport.dpr}x`);
  lines.push(`- Aufnahmemodus: ${session.meta.mode}`);
  lines.push(
    `- Umfang: ${summary.clicks} Klicks, ${summary.hovers} Hovers, ${summary.inputs} Eingaben, ` +
      `${summary.navigations} Navigationen, ${summary.errors} Fehler, ${summary.notes} Notizen`,
  );
  lines.push("");

  const notes = session.events.filter((event) => event.type === "note");
  if (notes.length) {
    lines.push("## Markierte Befunde");
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
      lines.push(`- **[${formatTimecode(item.t)}]** GESPROCHEN: "${item.text}"`);
      continue;
    }
    const { event } = item;
    lines.push(`- **[${formatTimecode(event.t)}]** ${eventHeadline(event)}`);
    if (event.target?.selector) {
      lines.push(`  - Selektor: \`${event.target.selector}\``);
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
    lines.push("## Beruehrte Elemente");
    lines.push("");
    for (const ref of elements.values()) {
      lines.push(`### \`${ref.selector}\``);
      lines.push("");
      lines.push(`- Tag: \`${ref.tag}\`${ref.role ? ` / Rolle: \`${ref.role}\`` : ""}`);
      if (ref.name) lines.push(`- Name: "${ref.name}"`);
      if (ref.path?.length) lines.push(`- Pfad: ${ref.path.join(" > ")}`);
      lines.push(`- XPath: \`${ref.xpath}\``);
      if (ref.attrs && Object.keys(ref.attrs).length) {
        lines.push(
          `- Attribute: ${Object.entries(ref.attrs)
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
    lines.push("## Transkript am Stueck");
    lines.push("");
    lines.push(fullTranscript);
    lines.push("");
  }

  return lines.join("\n");
}

export function buildJson(session: QaSession): string {
  return JSON.stringify(session, null, 2);
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
