"use client";

import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Baseline,
  Crosshair,
  Flag,
  Keyboard,
  MousePointerClick,
  MoveVertical,
  Navigation,
  Radio,
  SendHorizontal,
  TextCursorInput,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { eventHeadline, formatTimecode } from "@/lib/qa/export";
import type { QaEvent, QaEventType } from "@/lib/qa/types";

const ICONS: Record<QaEventType, React.ComponentType<{ className?: string }>> = {
  click: MousePointerClick,
  dblclick: MousePointerClick,
  contextmenu: MousePointerClick,
  hover: Crosshair,
  input: TextCursorInput,
  change: TextCursorInput,
  key: Keyboard,
  scroll: MoveVertical,
  navigate: Navigation,
  resize: ArrowRightLeft,
  select: Baseline,
  console: AlertTriangle,
  network: Radio,
  submit: SendHorizontal,
  note: Flag,
  marker: Flag,
};

const TONE: Partial<Record<QaEventType, string>> = {
  click: "text-sky-500",
  dblclick: "text-sky-500",
  contextmenu: "text-sky-500",
  hover: "text-muted-foreground",
  input: "text-emerald-500",
  change: "text-emerald-500",
  submit: "text-emerald-500",
  navigate: "text-violet-500",
  console: "text-red-500",
  network: "text-red-500",
  note: "text-amber-500",
  marker: "text-amber-500",
};

interface EventListProps {
  events: QaEvent[];
  autoScroll: boolean;
  onHighlight?: (selector: string | null) => void;
  emptyHint: string;
}

export function EventList({ events, autoScroll, onHighlight, emptyHint }: EventListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length, autoScroll]);

  if (!events.length) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyHint}</p>;
  }

  // Don't render very long sessions in full - the export contains everything.
  const visible = events.length > 400 ? events.slice(events.length - 400) : events;

  return (
    <ul className="space-y-px p-1">
      {events.length > visible.length && (
        <li className="px-2 py-1 text-[11px] text-muted-foreground">
          … {events.length - visible.length} older events hidden (included in the export)
        </li>
      )}
      {visible.map((event) => {
        const Icon = ICONS[event.type] ?? Crosshair;
        const isHoverEnd = event.type === "hover" && event.detail?.phase === "end";
        return (
          <li key={event.id}>
            <button
              type="button"
              onMouseEnter={() => onHighlight?.(event.target?.selector ?? null)}
              onMouseLeave={() => onHighlight?.(null)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                isHoverEnd && "opacity-60",
              )}
            >
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", TONE[event.type] ?? "text-muted-foreground")} />
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {formatTimecode(event.t)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{eventHeadline(event)}</span>
                {event.target?.selector && (
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {event.target.selector}
                  </span>
                )}
                {event.effect?.urlChanged && (
                  <span className="block truncate text-[10px] text-violet-500">
                    → {event.effect.urlChanged.to}
                  </span>
                )}
                {event.effect?.dialogOpened && (
                  <span className="block text-[10px] text-amber-500">→ Dialog opened</span>
                )}
                {event.effect?.alert && (
                  <span className="block truncate text-[10px] text-amber-500">→ {event.effect.alert}</span>
                )}
                {event.spokenContext?.length && (
                  <span className="block truncate text-[10px] text-foreground/70 italic">
                    &ldquo;{event.spokenContext.join(" ")}&rdquo;
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
      <div ref={bottomRef} />
    </ul>
  );
}
