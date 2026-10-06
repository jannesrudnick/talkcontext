import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLinesIcon, LocateFixedIcon } from "lucide-react";
import type { QaEvent, TranscriptSegment } from "@/lib/qa/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { eventMeta, type EventCategory } from "./event-meta";

type Filter = "all" | "interaction" | "error" | "note" | "speech";

type Item =
  | { kind: "event"; t: number; event: QaEvent & { spokenContext?: string[] } }
  | { kind: "speech"; t: number; segment: TranscriptSegment };

export function ActivityPanel({
  events,
  unmatchedSpeech,
  time,
  selectedId,
  onSelect,
}: {
  events: Array<QaEvent & { spokenContext?: string[] }>;
  unmatchedSpeech: TranscriptSegment[];
  time: number;
  selectedId: string | null;
  onSelect: (item: { t: number; event?: QaEvent }) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = events
      // Hover ends and short hovers are noise in the list.
      .filter((event) => !(event.type === "hover" && event.detail?.phase === "end"))
      .map((event) => ({ kind: "event" as const, t: event.t, event }));
    for (const segment of unmatchedSpeech) list.push({ kind: "speech", t: segment.t, segment });
    list.sort((a, b) => a.t - b.t);
    return list.filter((item) => {
      if (filter === "all") return true;
      if (filter === "speech") return item.kind === "speech" || Boolean(item.event.spokenContext?.length);
      if (item.kind === "speech") return false;
      const category: EventCategory = eventMeta(item.event).category;
      return filter === "interaction" ? category === "interaction" || category === "navigation" : category === filter;
    });
  }, [events, unmatchedSpeech, filter]);

  const activeIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.t <= time) index = i;
      else break;
    }
    return index;
  }, [items, time]);

  useEffect(() => {
    if (!follow || activeIndex < 0) return;
    const node = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, follow]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ToggleGroup
          value={[filter]}
          onValueChange={(value) => setFilter((value[0] as Filter | undefined) ?? "all")}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="interaction">Actions</ToggleGroupItem>
          <ToggleGroupItem value="error">Errors</ToggleGroupItem>
          <ToggleGroupItem value="note">Notes</ToggleGroupItem>
          <ToggleGroupItem value="speech">Speech</ToggleGroupItem>
        </ToggleGroup>
        <Button
          size="icon-sm"
          variant={follow ? "secondary" : "ghost"}
          className="ml-auto"
          title="Follow playback"
          onClick={() => setFollow((value) => !value)}
        >
          <LocateFixedIcon />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div ref={listRef} className="p-1.5">
          {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing in this view.</p>}
          {items.map((item, index) => {
            const past = index <= activeIndex;
            const current = index === activeIndex;
            if (item.kind === "speech") {
              return (
                <button
                  key={`s${index}`}
                  data-index={index}
                  type="button"
                  onClick={() => onSelect({ t: item.t })}
                  className={cn(
                    "flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-muted",
                    current && "bg-muted",
                    !past && "opacity-60",
                  )}
                >
                  <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {formatClock(item.t)}
                  </span>
                  <AudioLinesIcon className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="text-sm italic text-foreground/90">“{item.segment.text}”</span>
                </button>
              );
            }
            const { event } = item;
            const meta = eventMeta(event);
            const Icon = meta.icon;
            return (
              <button
                key={event.id}
                data-index={index}
                type="button"
                onClick={() => onSelect({ t: item.t, event })}
                className={cn(
                  "flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-muted",
                  current && "bg-muted",
                  selectedId === event.id && "bg-brand/10 ring-1 ring-brand/30",
                  !past && "opacity-60",
                  meta.category === "note" && "bg-warning/5",
                )}
              >
                <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {formatClock(item.t)}
                </span>
                <Icon className={cn("mt-0.5 size-4 shrink-0", meta.tone)} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "line-clamp-2 text-sm break-words",
                      meta.category === "error" && "font-mono text-xs text-destructive",
                      meta.category === "note" && "font-medium",
                    )}
                  >
                    {meta.label}
                  </span>
                  {event.target?.selector && meta.category !== "error" && (
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {event.target.selector}
                    </span>
                  )}
                  {event.spokenContext?.length ? (
                    <span className="mt-1 flex gap-1.5 text-xs text-muted-foreground italic">
                      <AudioLinesIcon className="mt-0.5 size-3 shrink-0 text-success" />“{event.spokenContext.join(" ")}”
                    </span>
                  ) : null}
                  {event.effect && (event.effect.dialogOpened || event.effect.alert || event.effect.urlChanged) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {event.effect.dialogOpened && <EffectChip>Dialog opened</EffectChip>}
                      {event.effect.alert && <EffectChip>Alert: {event.effect.alert}</EffectChip>}
                      {event.effect.urlChanged && <EffectChip>URL changed</EffectChip>}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function EffectChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="max-w-full truncate rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}
