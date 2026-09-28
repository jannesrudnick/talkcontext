import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatClock } from "@/lib/format";
import type { ConsoleEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<ConsoleEntry["level"], string> = {
  error: "bg-destructive/5 text-destructive",
  warn: "bg-warning/10 text-foreground",
  info: "text-foreground",
  log: "text-foreground",
  debug: "text-muted-foreground",
};

export function ConsolePanel({
  entries,
  base,
  time,
  onSeek,
}: {
  entries: ConsoleEntry[];
  base: number;
  time: number;
  onSeek: (ms: number) => void;
}) {
  const [level, setLevel] = useState<"all" | "error" | "warn">("all");
  const filtered = useMemo(
    () => entries.filter((entry) => level === "all" || entry.level === level),
    [entries, level],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ToggleGroup
          value={[level]}
          onValueChange={(value) => setLevel((value[0] as typeof level | undefined) ?? "all")}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="all">Alle</ToggleGroupItem>
          <ToggleGroupItem value="error">Fehler</ToggleGroupItem>
          <ToggleGroupItem value="warn">Warnungen</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">Keine Konsolenausgaben.</p>
        ) : (
          <div className="divide-y font-mono text-xs">
            {filtered.map((entry) => {
              const t = Math.max(0, entry.ts - base);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSeek(t)}
                  className={cn(
                    "flex w-full gap-3 px-3 py-1.5 text-left hover:bg-muted/60",
                    LEVEL_STYLES[entry.level],
                    t > time && "opacity-50",
                  )}
                >
                  <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{formatClock(t)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="break-words whitespace-pre-wrap">{entry.message}</span>
                    {entry.source && <span className="block truncate text-muted-foreground">{entry.source}</span>}
                    {entry.stack && (
                      <details className="mt-1 text-muted-foreground" onClick={(event) => event.stopPropagation()}>
                        <summary className="cursor-pointer select-none">Stacktrace</summary>
                        <pre className="mt-1 whitespace-pre-wrap">{entry.stack}</pre>
                      </details>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
