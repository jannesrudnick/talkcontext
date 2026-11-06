import { useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, ClockIcon, FlagIcon, Loader2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { navigate } from "@/hooks/use-hash-route";
import { formatDuration, formatRelative, hostOf, pathOf } from "@/lib/format";
import { listTeamRecordings, openTeamRecording, watchTeamRecordings, type TeamRecording } from "@/lib/team";
import type { TeamConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Recordings the team shared - opening one downloads and imports it. */
export function TeamFolder({ team, query }: { team: TeamConfig; query: string }) {
  const [rows, setRows] = useState<TeamRecording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      void listTeamRecordings(team).then(
        (next) => {
          setRows(next);
          setError(null);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      );
    load();
    return watchTeamRecordings(team, load);
  }, [team]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((row) => [row.title, row.url, row.owner_name].join(" ").toLowerCase().includes(needle));
  }, [rows, query]);

  const open = async (row: TeamRecording) => {
    setOpening(row.id);
    try {
      navigate(`recordings/${await openTeamRecording(team, row)}`);
    } catch (err) {
      toast.error("Could not open recording", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpening(null);
    }
  };

  if (error) return <p className="rounded-2xl border border-destructive/30 px-5 py-6 text-sm text-destructive">Team folder: {error}</p>;
  if (rows === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Empty className="rounded-2xl border border-dashed py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing shared yet</EmptyTitle>
          <EmptyDescription>Open one of your recordings and click “Share with team”.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="grid grid-cols-[1fr_180px_110px_110px_110px] items-center gap-4 border-b bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground">
        <span>Recording</span>
        <span>Shared by</span>
        <span>Duration</span>
        <span>Activity</span>
        <span className="text-right">Shared</span>
      </div>
      {filtered.map((row) => (
        <button
          key={row.id}
          type="button"
          disabled={opening !== null}
          onClick={() => void open(row)}
          className="group grid w-full grid-cols-[1fr_180px_110px_110px_110px] items-center gap-4 border-b px-5 py-3.5 text-left transition last:border-b-0 hover:bg-muted/50 disabled:cursor-wait"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              {opening === row.id && <Loader2Icon className="size-3.5 shrink-0 animate-spin" />}
              <span className="truncate">{row.title}</span>
              {row.environment && (
                <Badge variant="outline" className="shrink-0">
                  {row.environment}
                </Badge>
              )}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {hostOf(row.url)}
              <span className="opacity-60">{pathOf(row.url)}</span>
            </p>
          </div>
          <span className="truncate text-xs text-muted-foreground">{row.owner_name}</span>
          <span className="flex items-center gap-1.5 text-sm tabular-nums">
            <ClockIcon className="size-3.5 text-muted-foreground" />
            {formatDuration(row.duration_ms)}
          </span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span className={cn("flex items-center gap-1", row.error_count > 0 && "text-destructive")} title="Errors">
              <AlertTriangleIcon className="size-3.5" />
              {row.error_count}
            </span>
            {row.feedback_count > 0 && (
              <span className="flex items-center gap-1 text-brand" title="Feedback points">
                <FlagIcon className="size-3.5" />
                {row.feedback_count}
              </span>
            )}
          </span>
          <span className="text-right text-xs text-muted-foreground">{formatRelative(new Date(row.shared_at).getTime())}</span>
        </button>
      ))}
      {filtered.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted-foreground">No matches.</p>}
    </div>
  );
}
