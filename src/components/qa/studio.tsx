"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Circle,
  Cloud,
  Component,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Flag,
  HardDriveDownload,
  Languages,
  List,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  RotateCcw,
  Settings,
  Smartphone,
  Square,
  Tablet,
  Unplug,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ElementInspector } from "@/components/qa/element-inspector";
import { EventList } from "@/components/qa/event-list";
import { ThemeToggle } from "@/components/qa/theme-toggle";
import { correlate } from "@/lib/qa/correlate";
import { useNarration } from "@/hooks/use-narration";
import { useOpenAiKey } from "@/hooks/use-openai-key";
import { OPENAI_WHISPER_USD_PER_MINUTE, useOpenAiTranscription } from "@/hooks/use-openai-transcription";
import { useRecorder } from "@/hooks/use-recorder";
import { WHISPER_MODELS, useTranscription } from "@/hooks/use-transcription";
import {
  buildJson,
  buildMarkdown,
  downloadFile,
  formatDuration,
  formatTimecode,
  sessionFileBase,
  summarize,
} from "@/lib/qa/export";
import { normalizeTargetUrl, toProxyPath } from "@/lib/qa/proxy-url";
import type { QaMode, QaSession } from "@/lib/qa/types";
import type { WhisperModelId } from "@/lib/qa/whisper.worker";
import { cn } from "@/lib/utils";

const VIEWPORTS = [
  { id: "full", label: "Voll", width: null, icon: Monitor },
  { id: "desktop", label: "1280", width: 1280, icon: Monitor },
  { id: "tablet", label: "834", width: 834, icon: Tablet },
  { id: "mobile", label: "390", width: 390, icon: Smartphone },
] as const;

type ViewportId = (typeof VIEWPORTS)[number]["id"];

const subscribeToNothing = () => () => {};

const TARGET_QUERY = "url";

/** Liest die persistierte Ziel-URL aus der Tool-Addressleiste. */
function readTargetQuery(): string | null {
  const raw = new URLSearchParams(window.location.search).get(TARGET_QUERY);
  return raw ? normalizeTargetUrl(raw) : null;
}

/** Schreibt die Ziel-URL in `?url=` ohne History-Eintrag. */
function persistTargetQuery(targetUrl: string) {
  const next = new URL(window.location.href);
  if (next.searchParams.get(TARGET_QUERY) === targetUrl) return;
  next.searchParams.set(TARGET_QUERY, targetUrl);
  window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}${next.hash}`);
}

/** Origin erst nach dem Mount lesen - sonst weicht das Markup vom Server ab. */
function useOrigin(): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "",
  );
}

interface ProbeResult {
  reachable: boolean;
  embeddable?: boolean;
  recommendedMode?: QaMode;
  status?: number;
  error?: string;
}

export function QaStudio() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [urlInput, setUrlInput] = useState("");
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<QaMode>("proxy");
  const [viewport, setViewport] = useState<ViewportId>("full");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [language, setLanguage] = useState("de-DE");
  const [sessionId, setSessionId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [connectionHint, setConnectionHint] = useState(false);
  const [whisperModel, setWhisperModel] = useState<WhisperModelId>("onnx-community/whisper-base");
  const [transcriptSource, setTranscriptSource] = useState<"webspeech" | "whisper" | "openai" | "none">("none");

  const origin = useOrigin();
  const recorder = useRecorder({ frameRef, mode });
  const narration = useNarration(language);
  const transcription = useTranscription();
  const openaiKey = useOpenAiKey();
  const openaiTranscription = useOpenAiTranscription();
  const recording = recorder.status === "recording";

  const iframeSrc = useMemo(() => {
    if (!loadedUrl) return null;
    return mode === "proxy" ? toProxyPath(loadedUrl) : loadedUrl;
  }, [loadedUrl, mode]);

  const correlatedEvents = useMemo(
    () =>
      correlate({
        events: recorder.events,
        transcript: narration.transcript,
        meta: { durationMs: recorder.elapsed },
      }).events,
    [recorder.events, narration.transcript, recorder.elapsed],
  );

  const summary = useMemo(
    () =>
      summarize({
        version: "qa-recording/1",
        meta: {
          id: "",
          title: "",
          startedAt: "",
          durationMs: 0,
          mode,
          initialUrl: loadedUrl ?? "",
          viewport: { width: 0, height: 0, dpr: 1 },
          userAgent: "",
          language,
        },
        events: recorder.events,
        cursor: [],
        transcript: [],
      }),
    [recorder.events, mode, loadedUrl, language],
  );

  /* --------------------------------------------------------------- Laden */

  const loadTarget = useCallback(
    async (raw: string) => {
      const normalized = normalizeTargetUrl(raw);
      if (!normalized) {
        toast.error("Bitte eine gueltige URL eingeben, z.B. localhost:3000");
        return;
      }
      setUrlInput(normalized);
      persistTargetQuery(normalized);
      setProbing(true);
      setProbe(null);
      try {
        const response = await fetch(`/api/qa/probe?url=${encodeURIComponent(normalized)}`);
        const result = (await response.json()) as ProbeResult;
        setProbe(result);
        if (!result.reachable) {
          toast.error(`Ziel nicht erreichbar: ${result.error ?? "unbekannter Fehler"}`);
        }
      } catch {
        setProbe({ reachable: false, error: "Probe fehlgeschlagen" });
      } finally {
        setProbing(false);
      }
      recorder.reset();
      recorder.markFrameDisconnected();
      setConnectionHint(false);
      setLoadedUrl(normalized);
      setFrameKey((key) => key + 1);
      if (!title) setTitle(new URL(normalized).host);
    },
    [recorder, title],
  );

  const load = useCallback(() => loadTarget(urlInput), [loadTarget, urlInput]);

  const loadTargetRef = useRef(loadTarget);
  loadTargetRef.current = loadTarget;

  useEffect(() => {
    const fromQuery = readTargetQuery();
    if (!fromQuery) return;
    void loadTargetRef.current(fromQuery);
  }, []);

  const reloadFrame = useCallback(() => {
    recorder.markFrameDisconnected();
    setConnectionHint(false);
    setFrameKey((key) => key + 1);
  }, [recorder]);

  /* ----------------------------------------------------------- Aufnahme */

  const start = useCallback(async () => {
    if (!loadedUrl) {
      toast.error("Erst eine Seite laden.");
      return;
    }
    setSessionId(crypto.randomUUID());
    const startedAt = recorder.start();
    setTranscriptSource("none");
    if (micEnabled) {
      const ok = await narration.start(startedAt);
      if (!ok) toast.warning("Aufnahme laeuft ohne Ton - Mikrofonzugriff fehlt.");
      else if (narration.supported.speech) setTranscriptSource("webspeech");
    }
    toast.success("Aufnahme laeuft");
  }, [loadedUrl, micEnabled, narration, recorder]);

  const stop = useCallback(() => {
    recorder.stop();
    narration.stop();
    toast.success("Aufnahme beendet - Artefakt kann exportiert werden.");
  }, [narration, recorder]);

  const addNote = useCallback(() => {
    const text = note.trim();
    if (!text) return;
    recorder.addNote(text);
    setNote("");
    toast.success("Notiz gesetzt");
  }, [note, recorder]);

  // Nach dem Laden kurz warten und dann sagen, wenn sich der Recorder nicht
  // gemeldet hat - Funkstille ohne Erklaerung ist der schlimmste Zustand.
  useEffect(() => {
    if (!iframeSrc) return;
    const timer = window.setTimeout(() => setConnectionHint(true), 3000);
    return () => window.clearTimeout(timer);
  }, [iframeSrc, frameKey]);

  useEffect(() => {
    if (!recording) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);

  const runWhisper = useCallback(async () => {
    if (!narration.audioBlob) return;
    const segments = await transcription.transcribe(narration.audioBlob, whisperModel, language);
    if (!segments) {
      toast.error(transcription.error ?? "Transkription fehlgeschlagen");
      return;
    }
    narration.replaceTranscript(segments);
    setTranscriptSource("whisper");
    toast.success(`Transkript erzeugt - ${segments.length} Abschnitte`);
  }, [language, narration, transcription, whisperModel]);

  const runOpenAiTranscription = useCallback(async () => {
    if (!narration.audioBlob) return;
    const key = openaiKey.key.trim();
    if (!key) {
      toast.error("Erst den OpenAI API-Key eintragen.");
      return;
    }
    const segments = await openaiTranscription.transcribe(narration.audioBlob, key, language);
    if (!segments) {
      toast.error(openaiTranscription.error ?? "Transkription fehlgeschlagen");
      return;
    }
    narration.replaceTranscript(segments);
    setTranscriptSource("openai");
    toast.success(`Transkript erzeugt - ${segments.length} Abschnitte`);
  }, [language, narration, openaiKey.key, openaiTranscription]);

  /* ------------------------------------------------------------- Export */

  const buildSession = useCallback((): QaSession => {
    const startedAtMs = recorder.startedAtMs ?? Date.now();
    const frame = frameRef.current;
    return {
      version: "qa-recording/1",
      meta: {
        id: sessionId || crypto.randomUUID(),
        title: title || loadedUrl || "QA-Aufnahme",
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: new Date(startedAtMs + recorder.elapsed).toISOString(),
        durationMs: recorder.elapsed,
        mode,
        initialUrl: loadedUrl ?? "",
        viewport: {
          width: frame?.clientWidth ?? 0,
          height: frame?.clientHeight ?? 0,
          dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio,
        },
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        language,
        transcriptSource,
        transcriptModel:
          transcriptSource === "whisper" ? whisperModel : transcriptSource === "openai" ? "whisper-1" : undefined,
      },
      events: recorder.events,
      cursor: recorder.cursor,
      transcript: narration.transcript,
      audio: narration.audioBlob
        ? {
            mimeType: narration.audioBlob.type,
            durationMs: recorder.elapsed,
            fileName: `${sessionFileBase({
              version: "qa-recording/1",
              meta: {
                id: sessionId,
                title,
                startedAt: new Date(startedAtMs).toISOString(),
                durationMs: recorder.elapsed,
                mode,
                initialUrl: loadedUrl ?? "",
                viewport: { width: 0, height: 0, dpr: 1 },
                userAgent: "",
                language,
              },
              events: [],
              cursor: [],
              transcript: [],
            })}.webm`,
          }
        : undefined,
    };
  }, [
    language,
    loadedUrl,
    mode,
    narration.audioBlob,
    narration.transcript,
    recorder,
    sessionId,
    title,
    transcriptSource,
    whisperModel,
  ]);

  const hasRecording = recorder.events.length > 0 || narration.transcript.length > 0;

  const exportJson = useCallback(() => {
    const session = buildSession();
    downloadFile(`${sessionFileBase(session)}.json`, buildJson(session), "application/json");
  }, [buildSession]);

  const exportMarkdown = useCallback(() => {
    const session = buildSession();
    downloadFile(`${sessionFileBase(session)}.md`, buildMarkdown(session), "text/markdown");
  }, [buildSession]);

  const exportAudio = useCallback(() => {
    if (!narration.audioBlob) return;
    const session = buildSession();
    downloadFile(`${sessionFileBase(session)}.webm`, narration.audioBlob, narration.audioBlob.type);
  }, [buildSession, narration.audioBlob]);

  const copyMarkdown = useCallback(async () => {
    await navigator.clipboard.writeText(buildMarkdown(buildSession()));
    toast.success("Markdown in der Zwischenablage - direkt an den Agenten uebergebbar.");
  }, [buildSession]);

  const saveToServer = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/qa/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: buildJson(buildSession()),
      });
      const result = (await response.json()) as { json?: string; markdown?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Speichern fehlgeschlagen");
      toast.success("Gespeichert", { description: result.markdown });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }, [buildSession]);

  const bridgeSnippet = `<script src="${origin}/qa-recorder.js" data-qa-mode="bridge"></script>`;

  const frameWidth = VIEWPORTS.find((entry) => entry.id === viewport)?.width ?? null;

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex h-dvh flex-col bg-background">
      {/* ------------------------------------------------------- Kopfzeile */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="flex items-center gap-2 pr-3">
          <span className="grid size-[22px] shrink-0 place-items-center rounded-md border-[1.5px] border-primary">
            <span className="size-[7px] rounded-full bg-primary" />
          </span>
          <span className="font-heading text-[13px] font-medium tracking-tight">QA-Recorder</span>
        </div>

        <form
          className="flex min-w-64 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <Input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="localhost:3000 oder https://staging.example.com"
            className="h-8 font-mono text-xs"
            spellCheck={false}
          />
          <Select value={mode} onValueChange={(value) => setMode(value as QaMode)}>
            <SelectTrigger size="sm" className="w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="proxy">Proxy-Modus</SelectItem>
              <SelectItem value="bridge">Bridge-Modus</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={probing}>
            {probing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Laden
          </Button>
        </form>

        <div className="flex items-center gap-0.5 border-l pl-3">
          {VIEWPORTS.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              size="sm"
              variant={viewport === entry.id ? "default" : "ghost"}
              className="h-8 px-2 text-[11px]"
              onClick={() => setViewport(entry.id)}
            >
              <entry.icon className="size-3.5" />
              {entry.label}
            </Button>
          ))}
          <Separator orientation="vertical" className="mx-1 h-4.5" />
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={reloadFrame} disabled={!loadedUrl}>
            <RotateCcw className="size-3.5" />
          </Button>
          {loadedUrl && (
            <Button asChild type="button" size="sm" variant="ghost" className="h-8 px-2">
              <a href={loadedUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
          <Separator orientation="vertical" className="mx-1 h-4.5" />
          <ThemeToggle />
        </div>
      </header>

      {/* --------------------------------------------------- Aufnahmeleiste */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-card px-4 py-2.5">
        {recording ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="rounded-full border-destructive/60 pl-2.5"
            onClick={stop}
          >
            <Square className="size-3.5 fill-current" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full border-destructive/60 pl-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void start()}
            disabled={!loadedUrl}
          >
            <Circle className="size-3.5 fill-current" />
            Aufnahme
          </Button>
        )}

        <span
          className={cn(
            "font-mono text-xl font-semibold tabular-nums tracking-tight",
            recording && "text-destructive",
          )}
        >
          {formatTimecode(recorder.elapsed)}
        </span>

        {loadedUrl && (
          <span
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            title={
              recorder.frameConnected
                ? "Der Recorder laeuft in der Zielseite."
                : "Der Recorder hat sich aus dem Frame noch nicht gemeldet."
            }
          >
            <span
              className={cn(
                "size-[7px] rounded-full",
                recorder.frameConnected ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            {recorder.frameConnected ? "Recorder aktiv" : "kein Recorder"}
          </span>
        )}

        <Separator orientation="vertical" className="h-5" />

        <Button
          type="button"
          size="icon-sm"
          variant={micEnabled ? "default" : "ghost"}
          onClick={() => setMicEnabled((value) => !value)}
          disabled={recording}
          title={micEnabled ? "Mikrofon an" : "Mikrofon aus"}
        >
          {micEnabled ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
        </Button>

        <div role="radiogroup" aria-label="Sprache" className="inline-flex overflow-hidden rounded-md border">
          {(
            [
              { value: "de-DE", label: "DE" },
              { value: "en-US", label: "EN" },
            ] as const
          ).map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={language === option.value}
              disabled={recording}
              onClick={() => setLanguage(option.value)}
              className={cn(
                "px-2.5 py-1 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
                index > 0 && "border-l",
                language === option.value
                  ? "text-primary shadow-[inset_0_0_0_1px_var(--primary)]"
                  : "text-foreground/70 hover:bg-foreground/7",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" disabled={!recording} aria-label="Befund notieren">
                  <Flag className="size-3.5" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Befund notieren</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-80 space-y-2">
            <p className="text-xs font-medium">Befund notieren</p>
            <p className="text-[11px] text-muted-foreground">Haengt am zuletzt anvisierten Element.</p>
            <div className="flex items-center gap-2">
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addNote();
                  }
                }}
                placeholder="z.B. Button reagiert nicht"
                className="h-8 text-xs"
                disabled={!recording}
                autoFocus
              />
              <Button type="button" size="sm" onClick={addNote} disabled={!recording || !note.trim()}>
                Notiz
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="h-5" />

        <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
          <Badge variant="outline" className="rounded-full border-primary font-mono text-primary">
            {summary.clicks} Klicks
          </Badge>
          <Badge variant="outline" className="rounded-full border-primary font-mono text-primary">
            {summary.hovers} Hovers
          </Badge>
          <Badge variant="outline" className="rounded-full border-primary font-mono text-primary">
            {summary.elements} Elemente
          </Badge>
          {summary.errors > 0 && (
            <Badge variant="outline" className="rounded-full border-destructive font-mono text-destructive">
              {summary.errors} Fehler
            </Badge>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- Arbeitsflaeche */}
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 items-stretch justify-center overflow-auto bg-muted/30 p-3">
          {iframeSrc ? (
            <div
              className="relative flex w-full justify-center"
              style={frameWidth ? { maxWidth: frameWidth } : undefined}
            >
              <iframe
                key={`${frameKey}-${iframeSrc}`}
                ref={frameRef}
                src={iframeSrc}
                title="QA-Ziel"
                className="size-full rounded-lg border bg-white shadow-sm"
                allow="clipboard-read; clipboard-write; microphone"
                sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
              />
              {recording && (
                <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-destructive/70" />
              )}
              {connectionHint && !recorder.frameConnected && (
                <ConnectionHint mode={mode} snippet={bridgeSnippet} onSwitchMode={() => setMode("bridge")} />
              )}
            </div>
          ) : (
            <EmptyState bridgeSnippet={bridgeSnippet} />
          )}
        </main>

        {/* ------------------------------------------------------- Seitenleiste */}
        <aside className="flex w-[360px] shrink-0 border-l bg-card">
          <Tabs defaultValue="timeline" orientation="vertical" className="flex min-h-0 flex-1 !flex-row gap-0">
            <TabsList
              variant="rail"
              className="flex h-auto w-[46px] shrink-0 flex-col border-r"
            >
              {[
                { value: "timeline", label: "Timeline", icon: List },
                { value: "element", label: "Element", icon: Component },
                { value: "speech", label: "Sprache", icon: Languages },
                { value: "setup", label: "Setup", icon: Settings },
              ].map((tab) => (
                <Tooltip key={tab.value}>
                  <TooltipTrigger asChild>
                    <TabsTrigger value={tab.value} aria-label={tab.label}>
                      <tab.icon className="size-[15px]" />
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="left">{tab.label}</TooltipContent>
                </Tooltip>
              ))}
            </TabsList>

            <TabsContent value="timeline" className="flex min-h-0 flex-1 flex-col">
              <TabPaneHeader label="Timeline" />
              <ScrollArea className="min-h-0 flex-1">
                <EventList
                  events={correlatedEvents}
                  autoScroll={recording}
                  onHighlight={recorder.highlight}
                  emptyHint={
                    recording
                      ? "Bewege die Maus im Frame - Hovers und Klicks landen hier."
                      : "Noch keine Aufnahme. Seite laden, Aufnahme starten, durchklicken."
                  }
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="element" className="flex min-h-0 flex-1 flex-col">
              <TabPaneHeader label="Element" />
              <ScrollArea className="min-h-0 flex-1">
                <ElementInspector element={recorder.lastTarget} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="speech" className="flex min-h-0 flex-1 flex-col">
              <TabPaneHeader label="Sprache" />
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-2 p-3 text-xs">
                  <div className="space-y-2 rounded-lg border bg-card p-2.5">
                    <div className="flex items-center gap-1.5">
                      <WandSparkles className="size-3.5 text-violet-500" />
                      <p className="text-xs font-medium">Lokal transkribieren</p>
                    </div>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      Whisper laeuft komplett im Browser (WebGPU, sonst WASM). Kein Upload, kein
                      API-Key, echte Zeitstempel - und es funktioniert auch in Firefox und Safari.
                      Das Modell wird einmalig geladen und danach vom Browser gecacht.
                    </p>
                    <div className="flex items-center gap-2">
                      <Select
                        value={whisperModel}
                        onValueChange={(value) => setWhisperModel(value as WhisperModelId)}
                        disabled={transcription.running}
                      >
                        <SelectTrigger size="sm" className="flex-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WHISPER_MODELS.map((entry) => (
                            <SelectItem key={entry.id} value={entry.id}>
                              {entry.label} ({entry.size})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void runWhisper()}
                        disabled={!narration.audioBlob || transcription.running}
                      >
                        {transcription.running ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <WandSparkles className="size-3.5" />
                        )}
                        Starten
                      </Button>
                    </div>
                    {!narration.audioBlob && !transcription.running && (
                      <p className="text-[10px] text-muted-foreground">
                        Erst mit Mikrofon aufnehmen und stoppen - dann steht die Tonspur bereit.
                      </p>
                    )}
                    {transcription.progress && (
                      <div className="space-y-1">
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-violet-500 transition-all"
                            style={{ width: `${Math.round(transcription.progress.ratio * 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {transcription.progress.label}
                          {transcription.device ? ` - ${transcription.device.toUpperCase()}` : ""}
                        </p>
                      </div>
                    )}
                    {transcription.error && (
                      <p className="text-[10px] text-red-500">{transcription.error}</p>
                    )}
                    {transcriptSource === "whisper" && !transcription.running && (
                      <p className="text-[10px] text-emerald-500">
                        Transkript stammt aus Whisper ({whisperModel.split("/")[1]}).
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 rounded-lg border bg-card p-2.5">
                    <div className="flex items-center gap-1.5">
                      <Cloud className="size-3.5 text-sky-500" />
                      <p className="text-xs font-medium">Mit OpenAI transkribieren</p>
                    </div>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      Schickt die Tonspur einmalig an OpenAI (whisper-1), meist genauer als das lokale
                      Modell. Der Key bleibt in deinem Browser gespeichert und geht nur fuer diesen
                      einen Request durch unseren Server - wir legen ihn nirgends ab.
                    </p>
                    <Input
                      type="password"
                      value={openaiKey.key}
                      onChange={(event) => openaiKey.setKey(event.target.value)}
                      placeholder="sk-..."
                      className="h-8 text-xs"
                      autoComplete="off"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-muted-foreground">
                        ~{formatDuration(recorder.elapsed)} Audio ≈ $
                        {((recorder.elapsed / 60000) * OPENAI_WHISPER_USD_PER_MINUTE).toFixed(3)}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void runOpenAiTranscription()}
                        disabled={!narration.audioBlob || openaiTranscription.running}
                      >
                        {openaiTranscription.running ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Cloud className="size-3.5" />
                        )}
                        Starten
                      </Button>
                    </div>
                    {openaiTranscription.error && (
                      <p className="text-[10px] text-red-500">{openaiTranscription.error}</p>
                    )}
                    {transcriptSource === "openai" && !openaiTranscription.running && (
                      <p className="text-[10px] text-emerald-500">Transkript stammt aus OpenAI (whisper-1).</p>
                    )}
                  </div>

                  {!narration.supported.speech && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">
                      Das <em>Live</em>-Transkript braucht die Web Speech API (Chrome/Edge). Der Ton
                      wird trotzdem aufgezeichnet - transkribiere ihn danach einfach lokal mit
                      Whisper.
                    </p>
                  )}
                  {narration.error && (
                    <p className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-[11px]">
                      {narration.error}
                    </p>
                  )}
                  {narration.transcript.map((segment, index) => (
                    <p key={`${segment.t}-${index}`} className="leading-relaxed">
                      <span className="mr-2 font-mono text-[10px] text-muted-foreground">
                        {formatTimecode(segment.t)}
                      </span>
                      {segment.text}
                    </p>
                  ))}
                  {narration.interim && <p className="italic text-muted-foreground">{narration.interim}</p>}
                  {!narration.transcript.length && !narration.interim && (
                    <p className="py-6 text-center text-muted-foreground">
                      Noch nichts gesprochen. Waehrend der Aufnahme einfach erklaeren, was du tust.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="setup" className="flex min-h-0 flex-1 flex-col">
              <TabPaneHeader label="Setup" />
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="qa-title" className="text-xs">
                      Titel der Aufnahme
                    </Label>
                    <Input
                      id="qa-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="z.B. Checkout-Flow Bug"
                      className="h-8 text-xs"
                    />
                  </div>

                  <Separator />

                  <div className="space-y-2.5">
                    <ConfigSwitch
                      id="highlight"
                      label="Element hervorheben"
                      hint="Zeichnet einen Rahmen um das anvisierte Element."
                      checked={recorder.config.highlight}
                      onChange={(checked) => recorder.setConfig({ highlight: checked })}
                    />
                    <ConfigSwitch
                      id="html"
                      label="HTML mitschneiden"
                      hint="Speichert das gekuerzte outerHTML des Ziels."
                      checked={recorder.config.captureHtml}
                      onChange={(checked) => recorder.setConfig({ captureHtml: checked })}
                    />
                    <ConfigSwitch
                      id="values"
                      label="Eingabewerte mitschneiden"
                      hint="Passwortfelder bleiben immer maskiert."
                      checked={recorder.config.captureInputValues}
                      onChange={(checked) => recorder.setConfig({ captureInputValues: checked })}
                    />
                    <ConfigSwitch
                      id="console"
                      label="Konsolenfehler mitschneiden"
                      hint="console.error/warn und unbehandelte Fehler."
                      checked={recorder.config.captureConsole}
                      onChange={(checked) => recorder.setConfig({ captureConsole: checked })}
                    />
                    <ConfigSwitch
                      id="network"
                      label="Fehlgeschlagene Requests"
                      hint="Requests mit Status >= 400 oder Netzwerkfehler."
                      checked={recorder.config.captureNetwork}
                      onChange={(checked) => recorder.setConfig({ captureNetwork: checked })}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium">Status</p>
                    <StatusRow label="Modus" value={mode === "proxy" ? "Proxy (injiziert)" : "Bridge (Snippet)"} />
                    <StatusRow
                      label="Recorder"
                      value={recorder.frameConnected ? "verbunden" : "nicht verbunden"}
                      tone={recorder.frameConnected ? "ok" : "warn"}
                    />
                    <StatusRow label="Frame-URL" value={recorder.frameUrl ?? "-"} mono />
                    {probe && (
                      <StatusRow
                        label="Einbettbar"
                        value={probe.reachable ? (probe.embeddable ? "ja" : "nein (Proxy noetig)") : "nicht erreichbar"}
                        tone={probe.reachable && probe.embeddable ? "ok" : "warn"}
                      />
                    )}
                  </div>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="w-full">
                        Bridge-Snippet anzeigen
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Bridge-Modus einrichten</DialogTitle>
                        <DialogDescription>
                          Fuer eigene Projekte die exakteste Variante: Das Skript laeuft direkt in deiner App,
                          ohne dass der Proxy HTML umschreiben muss.
                        </DialogDescription>
                      </DialogHeader>
                      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px]">
                        {bridgeSnippet}
                      </pre>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void navigator.clipboard.writeText(bridgeSnippet);
                          toast.success("Snippet kopiert");
                        }}
                      >
                        <Copy className="size-3.5" />
                        Kopieren
                      </Button>
                    </DialogContent>
                  </Dialog>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {/* ------------------------------------------------------------- Export */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          Artefakt · {recorder.events.length} Events · {formatDuration(recorder.elapsed)}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={exportMarkdown} disabled={!hasRecording}>
            <FileText className="size-3.5" />
            Markdown
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={exportJson} disabled={!hasRecording}>
            <FileJson className="size-3.5" />
            JSON
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={copyMarkdown} disabled={!hasRecording}>
            <Copy className="size-3.5" />
            Kopieren
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={exportAudio} disabled={!narration.audioBlob}>
            <Download className="size-3.5" />
            Audio
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void saveToServer()}
            disabled={!hasRecording || saving}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <HardDriveDownload className="size-3.5" />}
            In ./qa-sessions ablegen
          </Button>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

function TabPaneHeader({ label }: { label: string }) {
  return (
    <h6 className="shrink-0 border-b px-3 py-2.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
      {label}
    </h6>
  );
}

function ConfigSwitch({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right",
          mono && "font-mono",
          tone === "ok" && "text-emerald-500",
          tone === "warn" && "text-amber-500",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState({ bridgeSnippet }: { bridgeSnippet: string }) {
  return (
    <div className="grid w-full place-items-center">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold">Loom fuer Agenten</h1>
        <p className="text-sm text-muted-foreground">
          URL oben eingeben und laden. Danach Aufnahme starten und die Seite im Frame durchklicken,
          waehrend du erklaerst, was du tust. Das Ergebnis ist kein Video, sondern ein Protokoll aus
          DOM-Elementen, Interaktionen und Transkript - lesbar fuer einen Coding-Agenten.
        </p>
        <div className="rounded-lg border bg-card p-3 text-left">
          <p className="mb-2 text-xs font-medium">Zwei Modi</p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Proxy</span> - ohne Eingriff ins Zielprojekt.
              Die Seite wird ueber diese App ausgeliefert und der Recorder injiziert.
            </li>
            <li>
              <span className="font-medium text-foreground">Bridge</span> - exakter, dafuer ein Snippet im
              eigenen Dev-Build:
              <code className="mt-1 block break-all rounded bg-muted p-1.5 font-mono text-[10px]">
                {bridgeSnippet}
              </code>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Wenn sich der Recorder nicht meldet, ist der haeufigste Grund modusabhaengig -
 * also sagen wir konkret, was zu tun ist, statt den Frame stumm stehen zu lassen.
 */
function ConnectionHint({
  mode,
  snippet,
  onSwitchMode,
}: {
  mode: QaMode;
  snippet: string;
  onSwitchMode: () => void;
}) {
  return (
    <div className="absolute inset-x-3 bottom-3 rounded-lg border border-amber-500/40 bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start gap-2">
        <Unplug className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium">Der Recorder meldet sich nicht aus dem Frame</p>
          {mode === "bridge" ? (
            <>
              <p className="text-[11px] text-muted-foreground">
                Im Bridge-Modus muss das Snippet in der Zielseite eingebunden sein. Ohne das Skript
                sieht das Studio nichts - weder Hover noch Klicks.
              </p>
              <code className="block break-all rounded bg-muted p-1.5 font-mono text-[10px]">
                {snippet}
              </code>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(snippet);
                    toast.success("Snippet kopiert");
                  }}
                >
                  <Copy className="size-3.5" />
                  Snippet kopieren
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">
                Die Seite laedt im Proxy, aber das injizierte Skript laeuft nicht. Meist blockiert
                die Zielseite fremde Skripte oder haengt beim Rendern. Fuer eigene Projekte ist der
                Bridge-Modus der zuverlaessigere Weg.
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={onSwitchMode}>
                Zu Bridge wechseln
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
