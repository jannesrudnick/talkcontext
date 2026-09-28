/**
 * Darstellung semantischer Events in der Oberflaeche: Icon, Farbe, Kurztext.
 */
import {
  AlertTriangleIcon,
  CompassIcon,
  FlagIcon,
  FormInputIcon,
  KeyboardIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MonitorIcon,
  MouseIcon,
  MousePointerClickIcon,
  ScrollIcon,
  SendIcon,
  TextCursorIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import type { ElementRef, QaEvent } from "@shared/types";

export type EventCategory = "interaction" | "error" | "note" | "navigation" | "other";

interface EventMeta {
  icon: LucideIcon;
  label: string;
  category: EventCategory;
  tone: string;
}

export function describeTarget(ref: ElementRef | undefined): string {
  if (!ref) return "";
  const name = ref.name ?? ref.text;
  return name ? `${ref.role ?? ref.tag} „${name}“` : (ref.role ?? ref.tag);
}

export function eventMeta(event: QaEvent): EventMeta {
  const detail = event.detail ?? {};
  const target = describeTarget(event.target);
  switch (event.type) {
    case "click":
      return { icon: MousePointerClickIcon, label: `Klick auf ${target}`, category: "interaction", tone: "text-brand" };
    case "dblclick":
      return { icon: MousePointerClickIcon, label: `Doppelklick auf ${target}`, category: "interaction", tone: "text-brand" };
    case "contextmenu":
      return { icon: MouseIcon, label: `Rechtsklick auf ${target}`, category: "interaction", tone: "text-brand" };
    case "hover":
      return {
        icon: MouseIcon,
        label:
          detail.phase === "end"
            ? `Hover beendet (${(Number(detail.durationMs ?? 0) / 1000).toFixed(1)}s)`
            : `Hover über ${target}`,
        category: "other",
        tone: "text-muted-foreground",
      };
    case "input":
      return {
        icon: TextCursorIcon,
        label: `Eingabe in ${target}${detail.value !== undefined ? `: „${String(detail.value)}“` : ""}`,
        category: "interaction",
        tone: "text-foreground",
      };
    case "change":
      return {
        icon: ListChecksIcon,
        label: `Auswahl in ${target}: „${String(detail.label ?? detail.value ?? "")}“`,
        category: "interaction",
        tone: "text-foreground",
      };
    case "key":
      return { icon: KeyboardIcon, label: `Taste ${String(detail.key ?? "")}`, category: "interaction", tone: "text-foreground" };
    case "submit":
      return {
        icon: SendIcon,
        label: `Formular abgeschickt (${String(detail.method ?? "GET")})`,
        category: "interaction",
        tone: "text-foreground",
      };
    case "scroll":
      return {
        icon: ScrollIcon,
        label: detail.scope === "page" ? `Scroll auf ${String(detail.percent ?? 0)} %` : `Scroll in ${target}`,
        category: "other",
        tone: "text-muted-foreground",
      };
    case "navigate":
      return {
        icon: CompassIcon,
        label: `${detail.kind === "load" ? "Seite geladen" : "Navigation"}: ${String(detail.to ?? "")}`,
        category: "navigation",
        tone: "text-info",
      };
    case "resize":
      return {
        icon: MonitorIcon,
        label: `Viewport ${String(detail.width)}×${String(detail.height)}`,
        category: "other",
        tone: "text-muted-foreground",
      };
    case "select":
      return { icon: FormInputIcon, label: `Text markiert: „${String(detail.text ?? "")}“`, category: "other", tone: "text-foreground" };
    case "console":
      return { icon: AlertTriangleIcon, label: String(detail.message ?? "Fehler"), category: "error", tone: "text-destructive" };
    case "network":
      return {
        icon: WifiOffIcon,
        label: `${String(detail.method ?? "GET")} ${String(detail.url ?? "")} → ${String(detail.status || "fehlgeschlagen")}`,
        category: "error",
        tone: "text-destructive",
      };
    case "note":
      return { icon: MessageSquareIcon, label: String(detail.text ?? ""), category: "note", tone: "text-warning" };
    case "marker":
      return { icon: FlagIcon, label: String(detail.text ?? "Bug"), category: "note", tone: "text-destructive" };
    default:
      return { icon: MouseIcon, label: event.type, category: "other", tone: "text-muted-foreground" };
  }
}
