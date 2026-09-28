import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  CheckIcon,
  CrosshairIcon,
  FlagIcon,
  GripVerticalIcon,
  ListVideoIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  MicIcon,
  MicOffIcon,
  SettingsIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ElementRef } from "@shared/types";
import type { RecordingController, TargetInfo } from "./controller";
import { overlayStore, useOverlay } from "./store";

export function Overlay({ controller }: { controller: RecordingController }) {
  const tab = useOverlay((s) => s.tab);
  const savedId = useOverlay((s) => s.savedId);

  if (!tab) return null;
  const visible = tab.overlayVisible || Boolean(tab.recording) || Boolean(savedId);
  if (!visible) return null;

  return (
    <div className="qey-root dark">
      {tab.recording && <TargetHighlight controller={controller} enabled={tab.settings.recorder.highlight} />}
      <Dock controller={controller} />
    </div>
  );
}

/* ------------------------------------------------------------------ Dock */

function Dock({ controller }: { controller: RecordingController }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

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
      className="pointer-events-none fixed inset-x-0 bottom-5 flex justify-center"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <Panels controller={controller} />
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-zinc-950/92 p-1.5 pl-1 text-zinc-100 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.55),0_0_0_1px_rgb(0_0_0/0.4)] backdrop-blur-xl">
          <button
            type="button"
            title="Verschieben"
            className="flex h-8 w-5 cursor-grab items-center justify-center text-zinc-500 hover:text-zinc-300 active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
          <DockContent />
        </div>
      </div>
    </div>
  );
}

function DockContent() {
  const tab = useOverlay((s) => s.tab)!;
  const busy = useOverlay((s) => s.busy);
  const actions = useOverlay((s) => s.actions);

  if (tab.recording) return <RecordingControls />;

  return (
    <>
      <Logo />
      {tab.environment && <EnvBadge name={tab.environment.name} color={tab.environment.color} />}
      <button
        type="button"
        disabled={busy || tab.busyElsewhere}
        onClick={() => void actions.start()}
        title={tab.busyElsewhere ? "Es läuft bereits eine Aufnahme in einem anderen Tab" : "Aufnahme starten (Alt+Shift+R)"}
        className="ml-1 inline-flex h-8 items-center gap-2 rounded-full bg-[var(--recording)] px-3.5 text-[13px] font-medium text-white shadow-sm transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <span className="size-2.5 rounded-full bg-white" />}
        Aufnahme starten
      </button>
      <Divider />
      <DockButton title="Aufnahmen" onClick={() => actions.open("recordings")}>
        <ListVideoIcon />
      </DockButton>
      <DockButton title="Einstellungen" onClick={() => actions.open("settings")}>
        <SettingsIcon />
      </DockButton>
      <DockButton title="Ausblenden (Alt+Shift+Q)" onClick={actions.hide}>
        <XIcon />
      </DockButton>
    </>
  );
}

function RecordingControls() {
  const tab = useOverlay((s) => s.tab)!;
  const recording = tab.recording!;
  const actions = useOverlay((s) => s.actions);
  const [panel, setPanel] = usePanel();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (recording.stopping) {
    return (
      <div className="flex h-8 items-center gap-2 px-3 text-[13px] text-zinc-300">
        <Loader2Icon className="size-3.5 animate-spin" />
        Aufnahme wird gespeichert …
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 pr-1 pl-1.5">
        <span className="qey-pulse size-2.5 rounded-full bg-[var(--recording)] shadow-[0_0_0_4px_color-mix(in_oklch,var(--recording)_25%,transparent)]" />
        <Timer since={recording.startedAt} />
      </div>
      <AudioIndicator />
      {tab.environment && <EnvBadge name={tab.environment.name} color={tab.environment.color} />}
      <Divider />
      <DockButton title="Notiz zum Element" active={panel === "note"} onClick={() => setPanel(panel === "note" ? null : "note")}>
        <MessageSquarePlusIcon />
      </DockButton>
      <DockButton title="Bug markieren" active={panel === "marker"} onClick={() => setPanel(panel === "marker" ? null : "marker")}>
        <FlagIcon />
      </DockButton>
      <HighlightToggle />
      <Divider />
      {confirmDiscard ? (
        <div className="flex items-center gap-1">
          <span className="px-1 text-xs text-zinc-400">Verwerfen?</span>
          <button
            type="button"
            className="h-7 rounded-full bg-red-500/15 px-2.5 text-xs font-medium text-red-300 hover:bg-red-500/25"
            onClick={() => void actions.discard()}
          >
            Ja, löschen
          </button>
          <DockButton title="Abbrechen" onClick={() => setConfirmDiscard(false)}>
            <XIcon />
          </DockButton>
        </div>
      ) : (
        <>
          <DockButton title="Aufnahme verwerfen" onClick={() => setConfirmDiscard(true)}>
            <Trash2Icon />
          </DockButton>
          <button
            type="button"
            title="Aufnahme beenden (Alt+Shift+R)"
            onClick={() => void actions.stop()}
            className="ml-0.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-medium text-zinc-950 transition hover:bg-zinc-200 active:scale-[0.98]"
          >
            <SquareIcon className="size-3 fill-current" />
            Stopp
          </button>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Panels */

type PanelKind = "note" | "marker" | null;
let panelState: PanelKind = null;
const panelListeners = new Set<() => void>();

function usePanel(): [PanelKind, (next: PanelKind) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    panelListeners.add(listener);
    return () => {
      panelListeners.delete(listener);
    };
  }, []);
  return [
    panelState,
    (next) => {
      panelState = next;
      for (const listener of panelListeners) listener();
    },
  ];
}

function Panels({ controller }: { controller: RecordingController }) {
  const tab = useOverlay((s) => s.tab);
  const savedId = useOverlay((s) => s.savedId);
  const error = useOverlay((s) => s.error);
  const actions = useOverlay((s) => s.actions);
  const [panel, setPanel] = usePanel();

  useEffect(() => {
    if (!tab?.recording) setPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.recording]);

  // Die "Gespeichert"-Karte raeumt sich nach ein paar Sekunden selbst weg.
  useEffect(() => {
    if (!savedId) return;
    const timer = window.setTimeout(() => overlayStore.setState({ savedId: null }), 8000);
    return () => window.clearTimeout(timer);
  }, [savedId]);

  if (tab?.recording && panel) {
    return <NoteComposer key={panel} kind={panel} controller={controller} onClose={() => setPanel(null)} />;
  }
  if (tab?.recording && (tab.recording.audio === "denied" || tab.recording.audio === "error")) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <MicOffIcon className="size-4 shrink-0 text-amber-400" />
          <p className="text-xs text-zinc-300">
            {tab.recording.audio === "denied"
              ? "Mikrofon nicht freigegeben – es wird ohne Ton aufgenommen."
              : `Mikrofon-Fehler: ${tab.recording.audioError ?? "unbekannt"}`}
          </p>
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-[var(--brand)] hover:underline"
            onClick={() => actions.open("settings")}
          >
            Freigeben
          </button>
        </div>
      </Card>
    );
  }
  if (savedId && !tab?.recording) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <CheckIcon className="size-3.5" />
          </span>
          <p className="text-[13px] text-zinc-200">Aufnahme gespeichert</p>
          <button
            type="button"
            className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/15"
            onClick={() => actions.open("recordings", savedId)}
          >
            Ansehen
          </button>
        </div>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <p className="max-w-sm text-xs text-red-300">{error}</p>
      </Card>
    );
  }
  return null;
}

function NoteComposer({
  kind,
  controller,
  onClose,
}: {
  kind: "note" | "marker";
  controller: RecordingController;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [target] = useState<ElementRef | undefined>(() => controller.currentTarget());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = () => {
    const value = text.trim() || (kind === "marker" ? "Bug" : "");
    if (!value) return;
    controller.note(value, kind);
    onClose();
  };

  return (
    <Card className="w-[380px]">
      <div className="mb-2 flex items-center gap-2">
        {kind === "marker" ? (
          <FlagIcon className="size-3.5 text-[var(--recording)]" />
        ) : (
          <MessageSquarePlusIcon className="size-3.5 text-[var(--brand)]" />
        )}
        <span className="text-xs font-medium text-zinc-200">{kind === "marker" ? "Bug markieren" : "Notiz"}</span>
        {target && (
          <span className="ml-auto max-w-[220px] truncate rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {target.selector}
          </span>
        )}
      </div>
      <textarea
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") onClose();
        }}
        rows={3}
        placeholder={kind === "marker" ? "Was ist kaputt? (optional)" : "Was fällt dir hier auf?"}
        className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[var(--brand)]"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">Enter speichert · Esc schließt</span>
        <button
          type="button"
          onClick={save}
          className="rounded-full bg-[var(--brand)] px-3 py-1 text-xs font-medium text-white hover:brightness-110"
        >
          Speichern
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ Bausteine */

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
        q
      </span>
      <span className="text-[13px] font-semibold tracking-tight">qey</span>
    </div>
  );
}

function EnvBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-zinc-300">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
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
      <span title="Ohne Mikrofon" className="flex size-8 items-center justify-center text-zinc-500">
        <MicOffIcon className="size-4" />
      </span>
    );
  }
  if (audio === "denied" || audio === "error") {
    return (
      <span title="Mikrofon nicht verfügbar" className="flex size-8 items-center justify-center text-amber-400">
        <MicOffIcon className="size-4" />
      </span>
    );
  }
  const bars = [0.35, 0.7, 1, 0.7, 0.35];
  return (
    <span title="Mikrofon aktiv" className="flex h-8 items-center gap-1.5 px-1 text-zinc-300">
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

let highlightOverride: boolean | null = null;

function HighlightToggle() {
  const configured = useOverlay((s) => s.tab?.settings.recorder.highlight ?? true);
  const [on, setOn] = useState(highlightOverride ?? configured);
  return (
    <DockButton
      title={on ? "Element-Hervorhebung aus" : "Element-Hervorhebung an"}
      active={on}
      onClick={() => {
        highlightOverride = !on;
        setOn(!on);
        window.dispatchEvent(new CustomEvent("qey:highlight", { detail: !on }));
      }}
    >
      <CrosshairIcon />
    </DockButton>
  );
}

function TargetHighlight({ controller, enabled }: { controller: RecordingController; enabled: boolean }) {
  const [target, setTarget] = useState<TargetInfo | null>(null);
  const [on, setOn] = useState(highlightOverride ?? enabled);

  useEffect(() => controller.onTarget(setTarget), [controller]);
  useEffect(() => {
    const listener = (event: Event) => setOn((event as CustomEvent<boolean>).detail);
    window.addEventListener("qey:highlight", listener);
    return () => window.removeEventListener("qey:highlight", listener);
  }, []);

  if (!on || !target || (!target.rect.width && !target.rect.height)) return null;
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
