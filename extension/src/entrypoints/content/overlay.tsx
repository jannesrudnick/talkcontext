import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  CameraIcon,
  CheckIcon,
  CrosshairIcon,
  GripVerticalIcon,
  ListVideoIcon,
  Loader2Icon,
  MicIcon,
  MicOffIcon,
  MousePointerClickIcon,
  PenLineIcon,
  SettingsIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { newId } from "@/lib/settings";
import type { FeedbackItem, Stroke } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { RecordingController, TargetInfo } from "./controller";
import { feedbackStore, type FeedbackState } from "./feedback";
import { overlayStore, useOverlay, useStore } from "./store";

const useFeedback = <T,>(selector: (state: FeedbackState) => T) => useStore(feedbackStore, selector);

const PEN_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

export function Overlay({ controller }: { controller: RecordingController }) {
  const tab = useOverlay((s) => s.tab);
  const savedId = useOverlay((s) => s.savedId);
  const active = useFeedback((s) => s.active);
  const pen = useFeedback((s) => s.pen);

  if (!tab) return null;
  const visible = tab.overlayVisible || Boolean(tab.recording) || Boolean(savedId);
  if (!visible) return null;
  const recording = Boolean(tab.recording && !tab.recording.stopping);

  return (
    <div className="talkcontext-root dark">
      {recording && !active && !pen && (
        <TargetHighlight controller={controller} enabled={tab.settings.recorder.highlight} />
      )}
      {recording && <StrokeLayer controller={controller} />}
      {recording && active && <PinnedTarget item={active} />}
      {recording && active && <FeedbackBubble controller={controller} item={active} />}
      <Dock controller={controller} />
    </div>
  );
}

/* ------------------------------------------------------------------ Dock */

function Dock({ controller }: { controller: RecordingController }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const capturing = useFeedback((s) => s.capturing);

  const onPointerDown = (event: ReactPointerEvent) => {
    drag.current = { startX: event.clientX, startY: event.clientY, baseX: offset.x, baseY: offset.y };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.baseX + event.clientX - drag.current.startX,
      y: drag.current.baseY + event.clientY - drag.current.startY,
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[3] flex justify-center"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, visibility: capturing ? "hidden" : "visible" }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <Panels controller={controller} />
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-zinc-950/92 p-1.5 pl-1 text-zinc-100 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.55),0_0_0_1px_rgb(0_0_0/0.4)] backdrop-blur-xl">
          <button
            type="button"
            title="Move"
            className="flex h-8 w-5 cursor-grab items-center justify-center text-zinc-500 hover:text-zinc-300 active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
          <DockContent controller={controller} />
        </div>
      </div>
    </div>
  );
}

function DockContent({ controller }: { controller: RecordingController }) {
  const tab = useOverlay((s) => s.tab)!;
  const busy = useOverlay((s) => s.busy);
  const actions = useOverlay((s) => s.actions);

  if (tab.recording) return <RecordingControls controller={controller} />;

  return (
    <>
      <Logo />
      <button
        type="button"
        disabled={busy || tab.busyElsewhere}
        onClick={() => void actions.start()}
        title={tab.busyElsewhere ? "A recording is already running in another tab" : "Start recording (Alt+Shift+R)"}
        className="ml-1 inline-flex h-8 items-center gap-2 rounded-full bg-[var(--recording)] px-3.5 text-[13px] font-medium text-white shadow-sm transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <span className="size-2.5 rounded-full bg-white" />}
        Start recording
      </button>
      <Divider />
      <DockButton title="Recordings" onClick={() => actions.open("recordings")}>
        <ListVideoIcon />
      </DockButton>
      <DockButton title="Settings" onClick={() => actions.open("settings")}>
        <SettingsIcon />
      </DockButton>
      <DockButton title="Hide (Alt+Shift+Q)" onClick={actions.hide}>
        <XIcon />
      </DockButton>
    </>
  );
}

function RecordingControls({ controller }: { controller: RecordingController }) {
  const tab = useOverlay((s) => s.tab)!;
  const recording = tab.recording!;
  const actions = useOverlay((s) => s.actions);
  const pen = useFeedback((s) => s.pen);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (recording.stopping) {
    return (
      <div className="flex h-8 items-center gap-2 px-3 text-[13px] text-zinc-300">
        <Loader2Icon className="size-3.5 animate-spin" />
        Saving recording …
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 pr-1 pl-1.5">
        <span className="talkcontext-pulse size-2.5 rounded-full bg-[var(--recording)] shadow-[0_0_0_4px_color-mix(in_oklch,var(--recording)_25%,transparent)]" />
        <Timer since={recording.startedAt} />
      </div>
      <AudioIndicator />
      <LiveBadge />
      <Divider />
      <DockButton title="Pen – mark up the page (Esc to exit)" active={pen} onClick={() => controller.feedback?.togglePen()}>
        <PenLineIcon />
      </DockButton>
      <HighlightToggle />
      <Divider />
      {confirmDiscard ? (
        <div className="flex items-center gap-1">
          <span className="px-1 text-xs text-zinc-400">Discard?</span>
          <button
            type="button"
            className="h-7 rounded-full bg-red-500/15 px-2.5 text-xs font-medium text-red-300 hover:bg-red-500/25"
            onClick={() => void actions.discard()}
          >
            Yes, delete
          </button>
          <DockButton title="Cancel" onClick={() => setConfirmDiscard(false)}>
            <XIcon />
          </DockButton>
        </div>
      ) : (
        <>
          <DockButton title="Discard recording" onClick={() => setConfirmDiscard(true)}>
            <Trash2Icon />
          </DockButton>
          <button
            type="button"
            title="Stop recording (Alt+Shift+R)"
            onClick={() => void actions.stop()}
            className="ml-0.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-medium text-zinc-950 transition hover:bg-zinc-200 active:scale-[0.98]"
          >
            <SquareIcon className="size-3 fill-current" />
            Stop
          </button>
        </>
      )}
    </>
  );
}

function LiveBadge() {
  const live = useOverlay((s) => s.tab?.recording?.live ?? "off");
  const error = useOverlay((s) => s.tab?.recording?.liveError);
  if (live === "off") return null;
  const tone =
    live === "on"
      ? "border-emerald-400/30 text-emerald-300"
      : live === "connecting"
        ? "border-white/10 text-zinc-400"
        : "border-red-400/30 text-red-300";
  return (
    <span
      title={live === "error" ? `Live transcript: ${error ?? "Error"}` : "Live transcript via OpenAI"}
      className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold tracking-wide", tone)}
    >
      {live === "connecting" ? <Loader2Icon className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
      LIVE
    </span>
  );
}

/* ---------------------------------------------------------------- Panels */

function Panels({ controller }: { controller: RecordingController }) {
  const tab = useOverlay((s) => s.tab);
  const savedId = useOverlay((s) => s.savedId);
  const error = useOverlay((s) => s.error);
  const actions = useOverlay((s) => s.actions);
  const pen = useFeedback((s) => s.pen);

  // The "Saved" card dismisses itself after a few seconds.
  useEffect(() => {
    if (!savedId) return;
    const timer = window.setTimeout(() => overlayStore.setState({ savedId: null }), 8000);
    return () => window.clearTimeout(timer);
  }, [savedId]);

  const recording = tab?.recording && !tab.recording.stopping;

  return (
    <>
      {recording && <CaptionBar />}
      {recording && pen && <PenPanel controller={controller} />}
      {recording && (tab.recording!.audio === "denied" || tab.recording!.audio === "error") && (
        <Card>
          <div className="flex items-center gap-3">
            <MicOffIcon className="size-4 shrink-0 text-amber-400" />
            <p className="text-xs text-zinc-300">
              {tab.recording!.audio === "denied"
                ? "Microphone not allowed – recording without audio."
                : `Microphone error: ${tab.recording!.audioError ?? "unknown"}`}
            </p>
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-[var(--brand)] hover:underline"
              onClick={() => actions.open("settings")}
            >
              Allow
            </button>
          </div>
        </Card>
      )}
      {savedId && !tab?.recording && (
        <Card>
          <div className="flex items-center gap-3">
            <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckIcon className="size-3.5" />
            </span>
            <p className="text-[13px] text-zinc-200">Recording saved</p>
            <button
              type="button"
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/15"
              onClick={() => actions.open("recordings", savedId)}
            >
              View
            </button>
          </div>
        </Card>
      )}
      {error && (
        <Card>
          <p className="max-w-sm text-xs text-red-300">{error}</p>
        </Card>
      )}
    </>
  );
}

/** Live captions - shows what is being heard right now and where it goes. */
function CaptionBar() {
  const active = useFeedback((s) => s.active);
  const partial = useFeedback((s) => s.partial);
  const captions = useFeedback((s) => s.captions);
  const live = useOverlay((s) => s.tab?.recording?.live ?? "off");
  const contextMenu = useOverlay((s) => s.tab?.settings.feedback.contextMenu ?? true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // While a point is open, speech goes into its bubble.
  if (active) return null;
  const recent = captions.filter((caption) => now - caption.at < 7000);
  if (!partial && !recent.length) {
    if (!contextMenu || live === "off") return null;
    return (
      <Card className="py-2">
        <p className="flex items-center gap-2 text-[11px] text-zinc-400">
          <MousePointerClickIcon className="size-3.5" />
          Right-click an element to attach what you said to it
        </p>
      </Card>
    );
  }
  const last = recent.at(-1);
  return (
    <Card className="max-w-[560px] py-2">
      <p className="text-[13px] leading-snug text-zinc-100">
        {partial ? <span className="text-zinc-400 italic">{partial}</span> : <>“{last?.text}”</>}
      </p>
      <p className="mt-1 text-[10px] tracking-wide text-zinc-500 uppercase">
        {!partial && last?.feedback ? `→ ${last.feedback}` : "→ general · right-click an element to assign"}
      </p>
    </Card>
  );
}

function PenPanel({ controller }: { controller: RecordingController }) {
  const color = useFeedback((s) => s.penColor);
  const active = useFeedback((s) => s.active);
  return (
    <Card className="py-2">
      <div className="flex items-center gap-3">
        <PenLineIcon className="size-3.5 text-zinc-400" />
        <span className="text-xs text-zinc-300">
          {active ? `Drawing for F${active.index}` : "Mark up the page – the circled element becomes a feedback point"}
        </span>
        <div className="flex gap-1">
          {PEN_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Color ${value}`}
              onClick={() => controller.feedback?.setPenColor(value)}
              className={cn("size-4 rounded-full ring-offset-2 ring-offset-zinc-950", color === value && "ring-2 ring-white/70")}
              style={{ background: value }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => controller.feedback?.togglePen(false)}
          className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white hover:bg-white/15"
        >
          Done
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ Feedback points */

function useElementRect(selector: string | undefined) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let frame = 0;
    let last = "";
    const tick = () => {
      let el: Element | null = null;
      try {
        el = document.querySelector(selector);
      } catch {
        el = null;
      }
      const next = el?.getBoundingClientRect() ?? null;
      const key = next ? `${next.left},${next.top},${next.width},${next.height}` : "";
      if (key !== last) {
        last = key;
        setRect(next);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [selector]);
  return rect;
}

function PinnedTarget({ item }: { item: FeedbackItem }) {
  const rect = useElementRect(item.target?.selector);
  if (!rect || (!rect.width && !rect.height)) return null;
  return (
    <div
      className="pointer-events-none fixed z-[1] rounded-[5px] border-2 border-[var(--brand)] shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_22%,transparent)]"
      style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6 }}
    >
      <span className="absolute -top-[22px] -left-[2px] rounded-[4px] bg-[var(--brand)] px-1.5 font-mono text-[11px] leading-[18px] font-semibold text-white">
        F{item.index}
      </span>
    </div>
  );
}

function FeedbackBubble({ controller, item }: { controller: RecordingController; item: FeedbackItem }) {
  const rect = useElementRect(item.target?.selector);
  const partial = useFeedback((s) => s.partial);
  const capturing = useFeedback((s) => s.capturing);
  const live = useOverlay((s) => s.tab?.recording?.live ?? "off");
  const [text, setText] = useState(item.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(item.text);
    // Only sync when the point changes, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    if (item.source === "note") inputRef.current?.focus();
  }, [item.id, item.source]);

  const width = 340;
  const margin = 12;
  let left = window.innerWidth / 2 - width / 2;
  let top = window.innerHeight / 3;
  if (rect) {
    left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const below = rect.bottom + 14;
    top = below + 220 < window.innerHeight ? below : Math.max(margin, rect.top - 240);
  }

  const label = item.target ? (item.target.name ?? item.target.text ?? item.target.selector) : "no element";

  return (
    <div
      className="fixed z-[2] rounded-2xl border border-white/10 bg-zinc-950/95 p-3 text-zinc-100 shadow-[0_16px_48px_-8px_rgb(0_0_0/0.6)] backdrop-blur-xl"
      style={{ left, top, width, visibility: capturing ? "hidden" : "visible" }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-[var(--brand)] px-1.5 font-mono text-[11px] leading-[18px] font-semibold text-white">
          F{item.index}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
          {item.target?.role ?? item.target?.tag} “{label}”
        </span>
        <span className="flex items-center gap-1 text-[11px] text-zinc-500" title="Screenshots">
          <CameraIcon className="size-3" />
          {item.screenshotIds.length}
        </span>
      </div>
      {item.component && (
        <p className="mb-2 truncate font-mono text-[10px] text-zinc-500" title={item.component.file}>
          {item.component.chain.slice(-3).join(" › ")}
        </p>
      )}

      <div className="mb-2 max-h-36 min-h-10 overflow-auto rounded-lg bg-white/5 px-2.5 py-2 text-[13px] leading-snug">
        {item.speech.length === 0 && !partial ? (
          <p className="text-zinc-500">
            {live === "on" || live === "connecting"
              ? "Just talk – everything goes to this point."
              : "Live transcript off – speech is assigned after recording."}
          </p>
        ) : (
          <p>
            {item.speech.join(" ")} {partial && <span className="text-zinc-400 italic">{partial}</span>}
          </p>
        )}
      </div>

      <textarea
        ref={inputRef}
        value={text}
        rows={2}
        placeholder="Type to add …"
        onChange={(event) => {
          setText(event.target.value);
          controller.feedback?.setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            controller.feedback?.close();
          }
          if (event.key === "Escape") controller.feedback?.close();
        }}
        className="w-full resize-none rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[var(--brand)]"
      />

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-zinc-500">Enter/Esc to close</span>
        <button
          type="button"
          onClick={() => controller.feedback?.discard()}
          className="ml-auto rounded-full px-2.5 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => controller.feedback?.close()}
          className="rounded-full bg-[var(--brand)] px-3 py-1 text-xs font-medium text-white hover:brightness-110"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Pen */

function useScroll() {
  const [scroll, setScroll] = useState({ x: window.scrollX, y: window.scrollY });
  useEffect(() => {
    const update = () => setScroll({ x: window.scrollX, y: window.scrollY });
    window.addEventListener("scroll", update, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", update, { capture: true });
  }, []);
  return scroll;
}

function strokePath(points: Array<[number, number]>, dx = 0, dy = 0) {
  if (!points.length) return "";
  return points.map(([x, y], index) => `${index ? "L" : "M"}${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}`).join(" ");
}

function StrokeLayer({ controller }: { controller: RecordingController }) {
  const pen = useFeedback((s) => s.pen);
  const color = useFeedback((s) => s.penColor);
  const strokes = useFeedback((s) => s.strokes);
  const capturing = useFeedback((s) => s.capturing);
  const scroll = useScroll();
  const [drawing, setDrawing] = useState<Array<[number, number]> | null>(null);
  const start = useRef<{ scroll: { x: number; y: number } } | null>(null);

  if (!pen && !strokes.length) return null;

  const finish = () => {
    if (!drawing || !start.current) return;
    if (drawing.length > 1) {
      const stroke: Omit<Stroke, "feedbackId"> = {
        id: newId("stroke_"),
        ts: Date.now(),
        color,
        width: 4,
        points: drawing,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scroll: start.current.scroll,
        url: location.href,
      };
      controller.feedback?.addStroke(stroke);
    }
    setDrawing(null);
    start.current = null;
  };

  return (
    <svg
      className={cn("fixed inset-0 z-0 h-screen w-screen", pen ? "pointer-events-auto cursor-crosshair" : "pointer-events-none")}
      onPointerDown={(event) => {
        if (!pen) return;
        (event.target as Element).setPointerCapture(event.pointerId);
        start.current = { scroll: { x: window.scrollX, y: window.scrollY } };
        setDrawing([[event.clientX, event.clientY]]);
      }}
      onPointerMove={(event) => {
        if (!drawing) return;
        setDrawing([...drawing, [event.clientX, event.clientY]]);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {pen && !capturing && <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.04)" />}
      {strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={strokePath(stroke.points, stroke.scroll.x - scroll.x, stroke.scroll.y - scroll.y)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {drawing && (
        <path d={strokePath(drawing)} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/* ----------------------------------------------------------- Primitives */

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "animate-in fade-in slide-in-from-bottom-1 rounded-2xl border border-white/10 bg-zinc-950/95 p-3 text-zinc-100 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.55)] backdrop-blur-xl duration-150",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-1.5 pr-1 pl-0.5">
      <span className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--brand)] to-fuchsia-500 text-[12px] font-bold text-white">
        T
      </span>
      <span className="text-[13px] font-semibold tracking-tight">TalkContext</span>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-white/10" />;
}

function DockButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white [&_svg]:size-4",
        active && "bg-white/10 text-white",
      )}
    >
      {children}
    </button>
  );
}

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const label = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return <span className="font-mono text-[13px] tabular-nums text-zinc-100">{label}</span>;
}

function AudioIndicator() {
  const audio = useOverlay((s) => s.tab?.recording?.audio);
  const level = useOverlay((s) => s.audioLevel);
  if (audio === "off") {
    return (
      <span title="No microphone" className="flex size-8 items-center justify-center text-zinc-500">
        <MicOffIcon className="size-4" />
      </span>
    );
  }
  if (audio === "denied" || audio === "error") {
    return (
      <span title="Microphone unavailable" className="flex size-8 items-center justify-center text-amber-400">
        <MicOffIcon className="size-4" />
      </span>
    );
  }
  const bars = [0.35, 0.7, 1, 0.7, 0.35];
  return (
    <span title="Microphone active" className="flex h-8 items-center gap-1.5 px-1 text-zinc-300">
      <MicIcon className="size-3.5" />
      <span className="flex h-4 items-center gap-[2px]">
        {bars.map((weight, index) => (
          <span
            key={index}
            className="w-[3px] rounded-full bg-emerald-400 transition-[height] duration-100"
            style={{ height: `${Math.max(3, Math.min(16, level * weight * 22))}px`, opacity: audio === "on" ? 1 : 0.4 }}
          />
        ))}
      </span>
    </span>
  );
}

/** Toggled in the dock - only for the recording it was toggled in, a new one starts from the setting. */
let highlightOverride: { recordingId: string; on: boolean } | null = null;

const highlightFor = (recordingId: string | undefined, configured: boolean) =>
  highlightOverride && highlightOverride.recordingId === recordingId ? highlightOverride.on : configured;

function HighlightToggle() {
  const configured = useOverlay((s) => s.tab?.settings.recorder.highlight ?? false);
  const recordingId = useOverlay((s) => s.tab?.recording?.recordingId);
  const [on, setOn] = useState(() => highlightFor(recordingId, configured));
  return (
    <DockButton
      title={on ? "Turn off element highlight" : "Turn on element highlight"}
      active={on}
      onClick={() => {
        if (recordingId) highlightOverride = { recordingId, on: !on };
        setOn(!on);
        window.dispatchEvent(new CustomEvent("talkcontext:highlight", { detail: !on }));
      }}
    >
      <CrosshairIcon />
    </DockButton>
  );
}

function TargetHighlight({ controller, enabled }: { controller: RecordingController; enabled: boolean }) {
  const [target, setTarget] = useState<TargetInfo | null>(null);
  const recordingId = useOverlay((s) => s.tab?.recording?.recordingId);
  const [on, setOn] = useState(() => highlightFor(recordingId, enabled));
  const capturing = useFeedback((s) => s.capturing);

  useEffect(() => controller.onTarget(setTarget), [controller]);
  useEffect(() => {
    const listener = (event: Event) => setOn((event as CustomEvent<boolean>).detail);
    window.addEventListener("talkcontext:highlight", listener);
    return () => window.removeEventListener("talkcontext:highlight", listener);
  }, []);

  if (capturing || !on || !target || (!target.rect.width && !target.rect.height)) return null;
  const { rect } = target;
  return (
    <div
      className="pointer-events-none fixed rounded-[4px] border-2 border-[var(--brand)] bg-[color-mix(in_oklch,var(--brand)_10%,transparent)] transition-all duration-75"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <span className="absolute -top-5 left-[-2px] max-w-[60vw] truncate rounded-[3px] bg-[var(--brand)] px-1.5 font-mono text-[10px] leading-4 text-white">
        {target.label}
      </span>
    </div>
  );
}
