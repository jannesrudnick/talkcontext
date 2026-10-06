import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatClock, hostOf, pathOf } from "@/lib/format";
import type { NetworkEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

function statusTone(status: number) {
  if (status === 0 || status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  if (status >= 300) return "text-info";
  return "text-success";
}

export function NetworkPanel({
  entries,
  base,
  time,
  onSeek,
}: {
  entries: NetworkEntry[];
  base: number;
  time: number;
  onSeek: (ms: number) => void;
}) {
  const [filter, setFilter] = useState<"all" | "failed">("all");
  const filtered = useMemo(
    () => entries.filter((entry) => filter === "all" || entry.status === 0 || entry.status >= 400),
    [entries, filter],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ToggleGroup
          value={[filter]}
          onValueChange={(value) => setFilter((value[0] as typeof filter | undefined) ?? "all")}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="failed">Failed</ToggleGroupItem>
        </ToggleGroup>
        <span className="ml-auto text-xs text-muted-foreground">fetch &amp; XHR</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No requests.</p>
        ) : (
          <div className="divide-y text-xs">
            {filtered.map((entry) => {
              const t = Math.max(0, entry.ts - base);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSeek(t)}
                  title={entry.url}
                  className={cn("flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-muted/60", t > time && "opacity-50")}
                >
                  <span className="w-10 shrink-0 font-mono text-muted-foreground tabular-nums">{formatClock(t)}</span>
                  <span className="w-12 shrink-0 font-mono font-medium">{entry.method}</span>
                  <span className={cn("w-9 shrink-0 font-mono font-semibold tabular-nums", statusTone(entry.status))}>
                    {entry.status || "ERR"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{pathOf(entry.url)}</span>
                    <span className="block truncate text-muted-foreground">
                      {hostOf(entry.url)}
                      {entry.error ? ` · ${entry.error}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{entry.durationMs} ms</span>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
