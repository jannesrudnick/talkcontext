import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ClipboardCopyIcon,
  FileJsonIcon,
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  MusicIcon,
  PlayCircleIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import type { QaEvent } from "@shared/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/use-settings";
import { navigate } from "@/hooks/use-hash-route";
import { deleteRecording, updateRecording } from "@/lib/db";
import { formatDateTime, formatDuration } from "@/lib/format";
import { transcribeWithOpenAi, transcribeWithWhisper, type TranscriptionProgress } from "@/lib/transcription/transcribe";
import { ActivityPanel } from "./activity-panel";
import { ConsolePanel } from "./console-panel";
import { ElementInspector } from "./element-inspector";
import { eventMeta } from "./event-meta";
import { exportAudio, exportJson, exportMarkdown, exportReplay, recordingMarkdown } from "./export";
import { correlated, loadRecording, transcriptInReplayTime, type LoadedRecording } from "./load";
import { NetworkPanel } from "./network-panel";
import { ReplayPlayer, type PlayerHandle, type TimelineMarker } from "./player";
import { TranscriptPanel, type TranscriptionChoice } from "./transcript-panel";

export function RecordingDetailPage({ id }: { id: string }) {
  const [recording, setRecording] = useState<LoadedRecording | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setRecording(undefined);
    void loadRecording(id).then((value) => alive && setRecording(value));
    return () => {
      alive = false;
    };
  }, [id]);

  if (recording === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    );
  }
  if (recording === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Aufnahme nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate("recordings")}>
          Zur Übersicht
        </Button>
      </div>
    );
  }
  return <RecordingView recording={recording} onChange={setRecording} />;
}

function RecordingView({
  recording,
  onChange,
}: {
  recording: LoadedRecording;
  onChange: (recording: LoadedRecording) => void;
}) {
  const { settings, loaded: settingsLoaded } = useSettings();
  const playerRef = useRef<PlayerHandle>(null);
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState<QaEvent | null>(null);
  const [tab, setTab] = useState("activity");
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [choice, setChoice] = useState<TranscriptionChoice | null>(null);
  const autoStarted = useRef(false);
  const { meta } = recording;

  const effectiveChoice: TranscriptionChoice = choice ?? {
    engine: settings.transcription.engine === "openai" ? "openai" : "whisper",
    model: settings.transcription.whisperModel,
  };

  const audioUrl = useMemo(() => (recording.audio ? URL.createObjectURL(recording.audio) : null), [recording.audio]);
  useEffect(() => () => (audioUrl ? URL.revokeObjectURL(audioUrl) : undefined), [audioUrl]);

  const transcript = useMemo(() => transcriptInReplayTime(recording), [recording]);
  const { events, unmatched } = useMemo(() => correlated(recording), [recording]);

  const markers = useMemo<TimelineMarker[]>(() => {
    const list: TimelineMarker[] = [];
    for (const event of recording.events) {
      const category = eventMeta(event).category;
      if (event.type === "click" || event.type === "dblclick") list.push({ t: event.t, kind: "click", label: eventMeta(event).label });
      else if (category === "error") list.push({ t: event.t, kind: "error", label: eventMeta(event).label });
      else if (category === "note") list.push({ t: event.t, kind: "note", label: eventMeta(event).label });
      else if (event.type === "navigate") list.push({ t: event.t, kind: "navigate", label: eventMeta(event).label });
    }
    for (const segment of transcript) list.push({ t: segment.t, kind: "speech", label: segment.text });
    return list;
  }, [recording.events, transcript]);

  const currentUrl = useMemo(() => {
    let url = meta.initialUrl;
    for (const event of recording.events) {
      if (event.t > time) break;
      if (event.type === "navigate" && typeof event.detail?.to === "string") url = event.detail.to;
    }
    return url;
  }, [meta.initialUrl, recording.events, time]);

  const seek = useCallback((ms: number) => playerRef.current?.seek(ms), []);

  const transcribe = useCallback(async () => {
    if (!recording.audio || transcribing) return;
    setTranscribing(true);
    setTranscriptError(null);
    try {
      const segments =
        effectiveChoice.engine === "openai"
          ? await transcribeWithOpenAi(recording.audio, settings.transcription.openaiKey, settings.language)
          : await transcribeWithWhisper(recording.audio, effectiveChoice.model, settings.language, setProgress);
      const next = await updateRecording(meta.id, (current) => ({
        ...current,
        transcript: {
          source: effectiveChoice.engine,
          model: effectiveChoice.engine === "openai" ? "whisper-1" : effectiveChoice.model,
          segments,
          createdAt: Date.now(),
        },
      }));
      if (next) onChange({ ...recording, meta: next });
      toast.success(`Transkript fertig – ${segments.length} Abschnitte`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTranscriptError(
        message === "Failed to fetch"
          ? "Modell bzw. API nicht erreichbar – Netzwerkverbindung prüfen."
          : message,
      );
    } finally {
      setTranscribing(false);
      setProgress(null);
    }
  }, [effectiveChoice, meta.id, onChange, recording, settings, transcribing]);

  // Direkt nach dem Stoppen oeffnet sich diese Seite - dann gleich transkribieren.
  useEffect(() => {
    if (!settingsLoaded || autoStarted.current) return;
    autoStarted.current = true;
    const fresh = meta.endedAt && Date.now() - meta.endedAt < 5 * 60_000;
    if (settings.transcription.auto && settings.transcription.engine !== "none" && recording.audio && !meta.transcript && fresh) {
      void transcribe();
    }
  }, [meta.endedAt, meta.transcript, recording.audio, settings, settingsLoaded, transcribe]);

  const rename = async (title: string) => {
    const next = await updateRecording(meta.id, (current) => ({ ...current, title }));
    if (next) onChange({ ...recording, meta: next });
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(recordingMarkdown(recording));
    toast.success("Markdown kopiert", { description: "Direkt in den Prompt deines Coding-Agenten einfügen." });
  };

  const errorCount = recording.console.filter((entry) => entry.level === "error").length;
  const failedRequests = recording.network.filter((entry) => entry.status === 0 || entry.status >= 400).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Kopfzeile */}
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <Button size="icon" variant="ghost" onClick={() => navigate("recordings")} aria-label="Zurück">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <input
            defaultValue={meta.title}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== meta.title) void rename(value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
            className="w-full truncate rounded-md bg-transparent px-1 -mx-1 text-base font-semibold outline-none hover:bg-muted focus:bg-muted"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDateTime(meta.startedAt)}</span>
            <span>·</span>
            <span>{formatDuration(meta.durationMs)}</span>
            <span>·</span>
            <span>
              {meta.viewport.width}×{meta.viewport.height}
            </span>
            {meta.environment && (
              <Badge variant="outline" className="gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: meta.environment.color }} />
                {meta.environment.name}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => void copyMarkdown()}>
          <ClipboardCopyIcon />
          Für Agent kopieren
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Export
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => exportMarkdown(recording)}>
              <FileTextIcon />
              Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportJson(recording)}>
              <FileJsonIcon />
              Protokoll (qa-recording/1)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportReplay(recording)}>
              <PlayCircleIcon />
              Replay inkl. rrweb
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!recording.audio} onClick={() => exportAudio(recording)}>
              <MusicIcon />
              Tonspur (.webm)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog>
          <AlertDialogTrigger render={<Button size="icon" variant="ghost" aria-label="Löschen" />}>
            <Trash2Icon />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Aufnahme löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Replay, Protokoll und Tonspur werden endgültig aus dem Browser entfernt.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  await deleteRecording(meta.id);
                  toast.success("Aufnahme gelöscht");
                  navigate("recordings");
                }}
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>

      {/* Inhalt */}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col p-5">
          <div className="mb-3 flex h-8 items-center gap-2 rounded-lg border bg-muted/40 px-3 text-xs">
            <GlobeIcon className="size-3.5 text-muted-foreground" />
            <span className="truncate font-mono text-muted-foreground">{currentUrl}</span>
          </div>
          <div className="min-h-0 flex-1">
            <ReplayPlayer
              ref={playerRef}
              events={recording.rrweb}
              durationMs={recording.durationMs}
              markers={markers}
              audioUrl={audioUrl}
              audioOffsetMs={meta.audio ? meta.audio.startedAt - recording.base : 0}
              highlightSelector={selected?.target?.selector ?? null}
              onTime={setTime}
            />
          </div>
        </section>

        <aside className="flex w-[420px] shrink-0 flex-col border-l">
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="border-b px-3 pt-3 pb-2">
              <TabsList className="w-full">
                <TabsTrigger value="activity">Aktivität</TabsTrigger>
                <TabsTrigger value="console">
                  Konsole
                  {errorCount > 0 && <CountBadge tone="error">{errorCount}</CountBadge>}
                </TabsTrigger>
                <TabsTrigger value="network">
                  Netzwerk
                  {failedRequests > 0 && <CountBadge tone="error">{failedRequests}</CountBadge>}
                </TabsTrigger>
                <TabsTrigger value="transcript">
                  Sprache
                  {transcribing && <Loader2Icon className="size-3 animate-spin" />}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="activity" className="min-h-0 flex-1">
              <ActivityPanel
                events={events}
                unmatchedSpeech={unmatched}
                time={time}
                selectedId={selected?.id ?? null}
                onSelect={(item) => {
                  setSelected(item.event ?? null);
                  seek(Math.max(0, item.t - 300));
                }}
              />
            </TabsContent>
            <TabsContent value="console" className="min-h-0 flex-1">
              <ConsolePanel entries={recording.console} base={recording.base} time={time} onSeek={seek} />
            </TabsContent>
            <TabsContent value="network" className="min-h-0 flex-1">
              <NetworkPanel entries={recording.network} base={recording.base} time={time} onSeek={seek} />
            </TabsContent>
            <TabsContent value="transcript" className="min-h-0 flex-1">
              <TranscriptPanel
                meta={meta}
                segments={transcript}
                time={time}
                running={transcribing}
                progress={progress}
                error={transcriptError}
                choice={effectiveChoice}
                onChoice={setChoice}
                onTranscribe={() => void transcribe()}
                onSeek={seek}
              />
            </TabsContent>
          </Tabs>
          {selected && tab === "activity" && <ElementInspector event={selected} onClose={() => setSelected(null)} />}
        </aside>
      </div>
    </div>
  );
}

function CountBadge({ children, tone }: { children: React.ReactNode; tone: "error" }) {
  return (
    <span
      className={
        tone === "error"
          ? "rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive tabular-nums"
          : ""
      }
    >
      {children}
    </span>
  );
}
