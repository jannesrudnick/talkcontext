/**
 * Session-Replay auf Basis von rrweb, mit eigener Steuerleiste im Stil von
 * PostHog/Sentry: Zeitleiste mit Markern, Tempo, Inaktivitaet ueberspringen,
 * synchron laufende Tonspur und Element-Hervorhebung.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Replayer, type eventWithTime } from "rrweb";
import "rrweb/dist/style.css";
import {
  FastForwardIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TimelineMarker {
  t: number;
  kind: "click" | "error" | "note" | "navigate" | "speech";
  label: string;
}

export interface PlayerHandle {
  seek(ms: number, options?: { play?: boolean }): void;
}

interface PlayerProps {
  events: eventWithTime[];
  durationMs: number;
  markers: TimelineMarker[];
  audioUrl: string | null;
  /** Replay-Zeit, zu der die Tonspur beginnt. */
  audioOffsetMs: number;
  highlightSelector: string | null;
  onTime: (ms: number) => void;
}

const SPEEDS = [1, 2, 4, 8];

const MARKER_COLORS: Record<TimelineMarker["kind"], string> = {
  click: "bg-brand",
  error: "bg-destructive",
  note: "bg-warning",
  navigate: "bg-info",
  speech: "bg-success",
};

export const ReplayPlayer = forwardRef<PlayerHandle, PlayerProps>(function ReplayPlayer(
  { events, durationMs, markers, audioUrl, audioOffsetMs, highlightSelector, onTime },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const frameRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [skipInactive, setSkipInactive] = useState(true);
  const [muted, setMuted] = useState(false);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const total = Math.max(durationMs, 1);

  /* ------------------------------------------------------ Replayer anlegen */

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || events.length < 2) return;
    mount.innerHTML = "";
    const replayer = new Replayer(events, {
      root: mount,
      skipInactive: true,
      showWarning: false,
      mouseTail: { strokeStyle: "rgba(124, 92, 255, 0.55)", lineWidth: 2, duration: 600 },
      speed: 1,
      triggerFocus: false,
    });
    replayerRef.current = replayer;
    replayer.on("resize", (payload) => {
      const size = payload as { width: number; height: number };
      setViewport({ width: size.width, height: size.height });
    });
    replayer.on("finish", () => setPlaying(false));
    const meta = events.find((event) => event.type === 4) as { data?: { width: number; height: number } } | undefined;
    if (meta?.data) setViewport({ width: meta.data.width, height: meta.data.height });
    replayer.pause(0);
    return () => {
      cancelAnimationFrame(frameRef.current);
      replayer.destroy();
      replayerRef.current = null;
    };
  }, [events]);

  /* ------------------------------------------------------- Skalierung */

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !viewport) return;
    const update = () => {
      const padding = 32;
      const next = Math.min(
        (stage.clientWidth - padding) / viewport.width,
        (stage.clientHeight - padding) / viewport.height,
        1,
      );
      setScale(Math.max(0.1, next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [viewport]);

  /* -------------------------------------------------------- Tonspur */

  const syncAudio = useCallback(
    (replayTime: number, isPlaying: boolean) => {
      const audio = audioRef.current;
      if (!audio || !audioUrl) return;
      const target = (replayTime - audioOffsetMs) / 1000;
      const inRange = target >= 0 && (Number.isNaN(audio.duration) || target < audio.duration);
      if (!isPlaying || !inRange) {
        if (!audio.paused) audio.pause();
        return;
      }
      const drift = Math.abs(audio.currentTime - target);
      // Beim Ueberspringen von Inaktivitaet laeuft das Replay schneller - dann
      // springt die Tonspur mit, statt vorzuspulen.
      if (drift > 0.35) audio.currentTime = target;
      audio.playbackRate = Math.min(speed, 4);
      if (audio.paused) void audio.play().catch(() => undefined);
    },
    [audioOffsetMs, audioUrl, speed],
  );

  /* ----------------------------------------------------- Zeit-Schleife */

  const tick = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    const current = Math.min(replayer.getCurrentTime(), total);
    setTime(current);
    onTime(current);
    syncAudio(current, true);
    frameRef.current = requestAnimationFrame(tick);
  }, [onTime, syncAudio, total]);

  const play = useCallback(
    (from?: number) => {
      const replayer = replayerRef.current;
      if (!replayer) return;
      const start = from ?? (time >= total - 50 ? 0 : time);
      replayer.play(start);
      setPlaying(true);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(tick);
    },
    [tick, time, total],
  );

  const pause = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    replayer.pause();
    cancelAnimationFrame(frameRef.current);
    setPlaying(false);
    syncAudio(replayer.getCurrentTime(), false);
  }, [syncAudio]);

  const seek = useCallback(
    (ms: number, options: { play?: boolean } = {}) => {
      const replayer = replayerRef.current;
      if (!replayer) return;
      const target = Math.max(0, Math.min(ms, total));
      const shouldPlay = options.play ?? playing;
      if (shouldPlay) {
        play(target);
      } else {
        replayer.pause(target);
        setTime(target);
        onTime(target);
        syncAudio(target, false);
      }
    },
    [onTime, play, playing, syncAudio, total],
  );

  useImperativeHandle(ref, () => ({ seek }), [seek]);

  useEffect(() => {
    replayerRef.current?.setConfig({ speed, skipInactive });
  }, [speed, skipInactive]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  /* ---------------------------------------------------- Hervorhebung */

  useEffect(() => {
    if (!highlightSelector) {
      setBox(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const doc = replayerRef.current?.iframe.contentDocument;
      if (!doc) return;
      let el: Element | null = null;
      try {
        el = doc.querySelector(highlightSelector);
      } catch {
        el = null;
      }
      if (!el) {
        setBox(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setBox({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    }, 80);
    return () => window.clearTimeout(timer);
    // Nicht jeden Frame neu messen - sonst feuert der Timer waehrend der Wiedergabe nie.
  }, [highlightSelector, Math.floor(time / 250)]);

  /* -------------------------------------------------------- Tastatur */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === " ") {
        event.preventDefault();
        if (playing) pause();
        else play();
      } else if (event.key === "ArrowRight") {
        seek(time + 5000);
      } else if (event.key === "ArrowLeft") {
        seek(time - 5000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pause, play, playing, seek, time]);

  const scaledSize = viewport ? { width: viewport.width * scale, height: viewport.height * scale } : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:16px_16px]"
        onDoubleClick={() => stageRef.current?.requestFullscreen?.()}
      >
        {events.length < 2 ? (
          <p className="text-sm text-muted-foreground">Für diese Aufnahme gibt es kein Replay.</p>
        ) : (
          <div
            className="relative overflow-hidden rounded-md bg-white shadow-2xl ring-1 ring-black/10"
            style={scaledSize ?? undefined}
          >
            <div
              ref={mountRef}
              className="qey-replay absolute top-0 left-0 origin-top-left"
              style={{ transform: `scale(${scale})`, width: viewport?.width, height: viewport?.height }}
            />
            {box && (
              <div
                className="pointer-events-none absolute z-10 rounded-[3px] border-2 border-brand bg-brand/10 shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_20%,transparent)] transition-all"
                style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
              />
            )}
          </div>
        )}
        {!playing && events.length >= 2 && (
          <button
            type="button"
            onClick={() => play()}
            className="absolute inset-0 flex items-center justify-center bg-black/0 transition hover:bg-black/5"
            aria-label="Abspielen"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-foreground/85 text-background shadow-xl backdrop-blur">
              <PlayIcon className="ml-0.5 size-6 fill-current" />
            </span>
          </button>
        )}
      </div>

      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" />}

      <Scrubber time={time} total={total} markers={markers} onSeek={(ms) => seek(ms)} />

      <div className="flex items-center gap-1.5 pt-2">
        <Button size="icon" variant="ghost" onClick={() => (playing ? pause() : play())} aria-label="Abspielen/Pause">
          {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={() => seek(0)} aria-label="Zum Anfang">
          <RotateCcwIcon />
        </Button>
        <span className="px-1 font-mono text-xs tabular-nums text-muted-foreground">
          <span className="text-foreground">{formatClock(time)}</span> / {formatClock(total)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {audioUrl && (
            <Button size="icon" variant="ghost" onClick={() => setMuted((m) => !m)} aria-label="Ton">
              {muted ? <VolumeXIcon /> : <Volume2Icon />}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant={skipInactive ? "secondary" : "ghost"}
                  onClick={() => setSkipInactive((value) => !value)}
                />
              }
            >
              <FastForwardIcon />
              Inaktivität überspringen
            </TooltipTrigger>
            <TooltipContent>Pausen ohne Interaktion im Zeitraffer abspielen</TooltipContent>
          </Tooltip>
          <div className="flex items-center rounded-lg border p-0.5">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSpeed(value)}
                className={cn(
                  "h-6 rounded-md px-2 font-mono text-xs text-muted-foreground transition",
                  speed === value && "bg-secondary text-foreground",
                )}
              >
                {value}×
              </button>
            ))}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => stageRef.current?.requestFullscreen?.()}
            aria-label="Vollbild"
          >
            <MaximizeIcon />
          </Button>
        </div>
      </div>
    </div>
  );
});

function Scrubber({
  time,
  total,
  markers,
  onSeek,
}: {
  time: number;
  total: number;
  markers: TimelineMarker[];
  onSeek: (ms: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  const msAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * total;
  };

  const visibleMarkers = useMemo(() => markers.filter((marker) => marker.kind !== "speech"), [markers]);
  const speech = useMemo(() => markers.filter((marker) => marker.kind === "speech"), [markers]);

  return (
    <div className="pt-3">
      <div
        ref={trackRef}
        className="group relative h-6 cursor-pointer"
        onPointerDown={(event) => {
          dragging.current = true;
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          onSeek(msAt(event.clientX));
        }}
        onPointerMove={(event) => {
          setHover(msAt(event.clientX));
          if (dragging.current) onSeek(msAt(event.clientX));
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* Sprach-Abschnitte als dezente Baender */}
        <div className="absolute inset-x-0 top-[9px] h-1.5 overflow-hidden rounded-full bg-muted">
          {speech.map((marker, index) => (
            <span
              key={index}
              className="absolute h-full bg-success/35"
              style={{ left: `${(marker.t / total) * 100}%`, width: "0.8%" }}
            />
          ))}
          <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/80" style={{ width: `${(time / total) * 100}%` }} />
        </div>
        {visibleMarkers.map((marker, index) => (
          <span
            key={index}
            title={`${formatClock(marker.t)} · ${marker.label}`}
            className={cn(
              "absolute top-[3px] h-[18px] w-[3px] -translate-x-1/2 rounded-full ring-2 ring-background",
              MARKER_COLORS[marker.kind],
            )}
            style={{ left: `${(marker.t / total) * 100}%` }}
          />
        ))}
        <span
          className="absolute top-[4px] size-4 -translate-x-1/2 rounded-full border-2 border-background bg-foreground shadow transition-transform group-hover:scale-110"
          style={{ left: `${(time / total) * 100}%` }}
        />
        {hover != null && (
          <span
            className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background"
            style={{ left: `${(hover / total) * 100}%` }}
          >
            {formatClock(hover)}
          </span>
        )}
      </div>
    </div>
  );
}
