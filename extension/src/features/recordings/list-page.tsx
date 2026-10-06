import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  AudioLinesIcon,
  BotIcon,
  CircleDotIcon,
  ClockIcon,
  FlagIcon,
  MicIcon,
  MousePointerClickIcon,
  SearchIcon,
  VideoIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { navigate } from "@/hooks/use-hash-route";
import { listRecordings } from "@/lib/db";
import { formatDuration, formatRelative, hostOf, pathOf } from "@/lib/format";
import type { RecordingMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

export function RecordingsListPage() {
  const [recordings, setRecordings] = useState<RecordingMeta[] | null>(null);
  const [query, setQuery] = useState("");
  const [env, setEnv] = useState("all");

  useEffect(() => {
    const load = () => void listRecordings().then(setRecordings);
    load();
    // New recordings show up as soon as they are saved.
    const timer = window.setInterval(load, 3000);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  const environments = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const recording of recordings ?? []) {
      if (recording.environment) map.set(recording.environment.name, recording.environment);
    }
    return [...map.values()];
  }, [recordings]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (recordings ?? []).filter((recording) => {
      if (env !== "all" && recording.environment?.name !== env) return false;
      if (!needle) return true;
      return [recording.title, recording.initialUrl, recording.lastUrl, recording.pageTitle]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [recordings, query, env]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recordings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every QA session as a replay, with clicks, console, network and your explanation on one timeline.
          </p>
        </div>
        <InputGroup className="w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search …" value={query} onChange={(event) => setQuery(event.target.value)} />
        </InputGroup>
      </div>

      {environments.length > 0 && (
        <ToggleGroup value={[env]} onValueChange={(value) => setEnv((value[0] as string | undefined) ?? "all")} size="sm" variant="outline">
          <ToggleGroupItem value="all">All environments</ToggleGroupItem>
          {environments.map((environment) => (
            <ToggleGroupItem key={environment.name} value={environment.name}>
              <span className="size-1.5 rounded-full" style={{ background: environment.color }} />
              {environment.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {recordings === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : recordings.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <VideoIcon />
            </EmptyMedia>
            <EmptyTitle>No recordings yet</EmptyTitle>
            <EmptyDescription>
              Open the app you want to test, click the TalkContext icon in the toolbar or press{" "}
              <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>Q</Kbd> – then “Start recording”.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <p className="text-xs text-muted-foreground">
              No script needed in the target app – the extension records right in the tab.
            </p>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="grid grid-cols-[1fr_140px_110px_150px_110px] items-center gap-4 border-b bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground">
            <span>Recording</span>
            <span>Environment</span>
            <span>Duration</span>
            <span>Activity</span>
            <span className="text-right">When</span>
          </div>
          {filtered.map((recording) => (
            <RecordingRow key={recording.id} recording={recording} />
          ))}
          {filtered.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted-foreground">No matches.</p>}
        </div>
      )}
    </div>
  );
}

function RecordingRow({ recording }: { recording: RecordingMeta }) {
  const live = recording.status === "recording";
  return (
    <button
      type="button"
      onClick={() => !live && navigate(`recordings/${recording.id}`)}
      className={cn(
        "group grid w-full grid-cols-[1fr_140px_110px_150px_110px] items-center gap-4 border-b px-5 py-3.5 text-left transition last:border-b-0 hover:bg-muted/50",
        live && "cursor-default",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand/15 to-fuchsia-500/10 text-brand">
          {live ? <CircleDotIcon className="size-4 animate-pulse text-recording" /> : <VideoIcon className="size-4" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium group-hover:text-foreground">{recording.title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {hostOf(recording.initialUrl)}
            <span className="opacity-60">{pathOf(recording.initialUrl)}</span>
          </p>
        </div>
      </div>
      <div>
        {recording.environment ? (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full" style={{ background: recording.environment.color }} />
            {recording.environment.name}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">–</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-sm tabular-nums">
        <ClockIcon className="size-3.5 text-muted-foreground" />
        {live ? <span className="text-recording">live</span> : formatDuration(recording.durationMs)}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1" title="Clicks">
          <MousePointerClickIcon className="size-3.5" />
          {recording.counts.clicks}
        </span>
        <span className={cn("flex items-center gap-1", recording.counts.errors > 0 && "text-destructive")} title="Errors">
          <AlertTriangleIcon className="size-3.5" />
          {recording.counts.errors}
        </span>
        {(recording.counts.feedback ?? recording.counts.notes) > 0 && (
          <span className="flex items-center gap-1 text-brand" title="Feedback points">
            <FlagIcon className="size-3.5" />
            {recording.counts.feedback ?? recording.counts.notes}
          </span>
        )}
        {recording.sentAt && <BotIcon className="size-3.5 text-success" aria-label="Sent to Claude" />}
        {recording.audio &&
          (recording.transcript ? (
            <AudioLinesIcon className="size-3.5 text-success" aria-label="Transcribed" />
          ) : (
            <MicIcon className="size-3.5" aria-label="With audio" />
          ))}
      </div>
      <span className="text-right text-xs text-muted-foreground">{formatRelative(recording.startedAt)}</span>
    </button>
  );
}
