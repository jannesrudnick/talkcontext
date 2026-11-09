/**
 * On-page comments (Figma-style): pin a thread to an element, discuss in a
 * popover, resolve. Threads live in the team's Supabase project; this script
 * talks to it through the background (see lib/team-bridge.ts).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, HashIcon, Loader2Icon, MessageCirclePlusIcon, RotateCcwIcon, SendIcon, SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import { pageKey, watchComments, type NewThread, type Thread } from "@/lib/comments";
import { describe } from "@/lib/recorder/describe";
import { getSettings, saveSettings } from "@/lib/settings";
import type { CommentOp } from "@/lib/team-bridge";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { request } from "./api";
import { isOverlayNode } from "./controller";
import { useElementRect } from "./overlay";
import { realtime } from "./realtime";
import { createStore, useStore } from "./store";

interface Draft {
  selector: string;
  label: string;
  pin_x: number;
  pin_y: number;
}

interface CommentState {
  /** undefined = not checked yet, null = not signed in. */
  session: { name: string; id: string } | null | undefined;
  threads: Thread[];
  features: string[];
  feature: string;
  placing: boolean;
  draft: Draft | null;
  openId: string | null;
  showResolved: boolean;
  error: string | null;
}

export const commentStore = createStore<CommentState>(() => ({
  session: undefined,
  threads: [],
  features: [],
  feature: "",
  placing: false,
  draft: null,
  openId: null,
  showResolved: false,
  error: null,
}));

const useComments = <T,>(selector: (state: CommentState) => T) => useStore(commentStore, selector);

const call = <T,>(op: CommentOp) => request<T>({ type: "talkcontext:comments", request: op });

async function refresh() {
  const { session, feature } = commentStore.getState();
  if (!session) return;
  try {
    const threads = await call<Thread[]>({ op: "list", url: pageKey(location.href), feature });
    commentStore.setState({ threads, error: null });
  } catch (error) {
    commentStore.setState({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function setFeature(feature: string) {
  commentStore.setState({ feature, openId: null });
  const settings = await getSettings();
  await saveSettings({ ...settings, team: { ...settings.team, feature } });
  void refresh();
}

/** Called by the background: open a thread from the comments list. */
export function openThread(id: string) {
  commentStore.setState({ openId: id, showResolved: true });
  void refresh();
}

/* ------------------------------------------------------------------ Layer */

/** Mounted while the overlay is visible: loads threads, draws pins and popovers. */
export function CommentLayer({ feature }: { feature: string }) {
  const session = useComments((s) => s.session);
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const placing = useComments((s) => s.placing);
  const draft = useComments((s) => s.draft);
  const openId = useComments((s) => s.openId);

  useEffect(() => {
    commentStore.setState({ feature });
  }, [feature]);

  // Session + features once; threads live via Realtime, again on SPA navigation and when the tab comes back.
  useEffect(() => {
    let alive = true;
    let unwatch: (() => void) | undefined;
    let lastUrl = pageKey(location.href);
    let debounce = 0;
    const soon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refresh(), 250);
    };
    void call<{ name: string; id: string } | null>({ op: "session" }).then(
      (session) => {
        if (!alive) return;
        commentStore.setState({ session });
        if (!session) return;
        void refresh();
        void call<string[]>({ op: "features" }).then((features) => alive && commentStore.setState({ features }));
        void realtime().then((client) => {
          if (alive && client) unwatch = watchComments(client, soon);
        });
      },
      () => alive && commentStore.setState({ session: null }),
    );
    const timer = window.setInterval(() => {
      const url = pageKey(location.href);
      if (url === lastUrl) return;
      lastUrl = url;
      commentStore.setState({ openId: null, draft: null });
      void refresh();
    }, 1000);
    // Realtime drops events while the socket is down (sleep, offline) - catch up on return.
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      unwatch?.();
      window.clearInterval(timer);
      window.clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [feature]);

  if (!session) return null;
  const visible = threads.filter((thread) => showResolved || thread.status === "open" || thread.id === openId);

  return (
    <>
      {placing && <PlacementLayer />}
      {visible.map((thread) => (
        <Pin key={thread.id} thread={thread} />
      ))}
      {draft && <DraftPopover draft={draft} />}
    </>
  );
}

/* -------------------------------------------------------------- Placement */

/** Hover outlines the element, click pins a new thread to it. Esc cancels. */
function PlacementLayer() {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const target = (event: Event) => {
      const node = event.composedPath()[0] ?? event.target;
      if (isOverlayNode(node as Node) || !(event.target instanceof Element)) return null;
      return event.target;
    };
    const onMove = (event: MouseEvent) => setRect(target(event)?.getBoundingClientRect() ?? null);
    const swallow = (event: Event) => {
      if (!target(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onClick = (event: MouseEvent) => {
      const el = target(event);
      if (!el) return;
      event.preventDefault();
      event.stopPropagation();
      const box = el.getBoundingClientRect();
      const ref = describe(el, { captureHtml: false, html: false });
      if (!ref) return;
      const name = ref.name ?? ref.text;
      commentStore.setState({
        placing: false,
        openId: null,
        draft: {
          selector: ref.selector,
          label: `${ref.role ?? ref.tag}${name ? ` “${name.slice(0, 60)}”` : ""}`,
          pin_x: box.width ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0.5,
          pin_y: box.height ? Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) : 0.5,
        },
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") commentStore.setState({ placing: false });
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("pointerdown", swallow, true);
    document.addEventListener("mousedown", swallow, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    document.documentElement.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("pointerdown", swallow, true);
      document.removeEventListener("mousedown", swallow, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      document.documentElement.style.cursor = "";
    };
  }, []);

  if (!rect) return null;
  return (
    <div
      className="pointer-events-none fixed rounded-[4px] border-2 border-amber-400 bg-amber-400/10"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />
  );
}

/* -------------------------------------------------------------------- Pins */

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

function pinPosition(rect: DOMRect | null, x: number, y: number) {
  return rect ? { left: rect.left + rect.width * x, top: rect.top + rect.height * y } : null;
}

function Pin({ thread }: { thread: Thread }) {
  const rect = useElementRect(thread.selector);
  const open = useComments((s) => s.openId === thread.id);
  const at = pinPosition(rect, thread.pin_x, thread.pin_y);
  if (!at) return open ? <ThreadPopover thread={thread} at={null} /> : null;
  const resolved = thread.status === "resolved";

  return (
    <>
      <button
        type="button"
        title={`${thread.comments.length} comment${thread.comments.length === 1 ? "" : "s"} · ${thread.feature}`}
        onClick={() => commentStore.setState({ openId: open ? null : thread.id, draft: null })}
        className={cn(
          "fixed z-[1] flex h-7 min-w-7 -translate-y-full items-center justify-center gap-1 rounded-full rounded-bl-none border-2 border-white px-1.5 text-[11px] font-semibold text-white shadow-[0_4px_14px_rgb(0_0_0/0.35)] transition hover:scale-110",
          resolved ? "bg-zinc-500" : "bg-amber-500",
          open && "scale-110 ring-2 ring-amber-300",
        )}
        style={{ left: at.left, top: at.top }}
      >
        {resolved ? <CheckIcon className="size-3.5" /> : initial(thread.created_by_name)}
        {thread.comments.length > 1 && <span className="opacity-80">{thread.comments.length}</span>}
      </button>
      {open && <ThreadPopover thread={thread} at={at} />}
    </>
  );
}

/* ---------------------------------------------------------------- Popovers */

const WIDTH = 340;

function Popover({ at, children }: { at: { left: number; top: number } | null; children: ReactNode }) {
  const margin = 12;
  const left = at ? Math.min(Math.max(margin, at.left + 18), window.innerWidth - WIDTH - margin) : window.innerWidth - WIDTH - 24;
  const top = at ? Math.min(Math.max(margin, at.top - 20), window.innerHeight - 380) : 24;
  return (
    <div
      className="fixed z-[2] flex max-h-[min(480px,80vh)] flex-col rounded-2xl border border-white/10 bg-zinc-950/95 text-zinc-100 shadow-[0_16px_48px_-8px_rgb(0_0_0/0.6)] backdrop-blur-xl"
      style={{ left, top, width: WIDTH }}
    >
      {children}
    </div>
  );
}

function FeatureTag({ feature }: { feature: string }) {
  return (
    <span className="inline-flex max-w-[140px] items-center gap-0.5 truncate rounded-md bg-white/10 px-1.5 text-[11px] leading-[18px] text-zinc-300">
      <HashIcon className="size-3 shrink-0" />
      {feature}
    </span>
  );
}

function Composer({ placeholder, onSend, autoFocus }: { placeholder: string; onSend: (body: string) => Promise<void>; autoFocus?: boolean }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(body);
      setBody("");
    } catch (error) {
      commentStore.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-end gap-2 border-t border-white/10 p-2">
      <textarea
        ref={ref}
        rows={2}
        value={body}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
          if (event.key === "Escape") commentStore.setState({ openId: null, draft: null });
        }}
        className="min-h-[40px] flex-1 resize-none rounded-lg bg-white/5 px-2 py-1.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:bg-white/10"
      />
      <button
        type="button"
        title="Send (⌘↵)"
        disabled={!body.trim() || busy}
        onClick={() => void send()}
        className="flex size-8 items-center justify-center rounded-full bg-amber-500 text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
      </button>
    </div>
  );
}

function ThreadPopover({ thread, at }: { thread: Thread; at: { left: number; top: number } | null }) {
  const me = useComments((s) => s.session?.id);
  const resolved = thread.status === "resolved";
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [thread.comments.length]);

  const act = async (op: CommentOp) => {
    try {
      await call(op);
      if (op.op === "delete") commentStore.setState({ openId: null });
      await refresh();
    } catch (error) {
      commentStore.setState({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <Popover at={at}>
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <FeatureTag feature={thread.feature} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">{at ? thread.element_label : "Element not on this view"}</span>
        <IconButton
          title={resolved ? "Reopen" : "Resolve"}
          onClick={() => void act({ op: "status", threadId: thread.id, status: resolved ? "open" : "resolved" })}
        >
          {resolved ? <RotateCcwIcon /> : <CheckIcon />}
        </IconButton>
        {thread.created_by === me && (
          <IconButton title="Delete thread" onClick={() => void act({ op: "delete", threadId: thread.id })}>
            <Trash2Icon />
          </IconButton>
        )}
        <IconButton title="Close" onClick={() => commentStore.setState({ openId: null })}>
          <XIcon />
        </IconButton>
      </div>
      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        {thread.comments.map((comment) => (
          <div key={comment.id} className="flex gap-2">
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", comment.via_claude ? "bg-[#d97757]" : "bg-amber-500")}>
              {comment.via_claude ? <SparklesIcon className="size-3.5" /> : initial(comment.author_name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-1.5 text-[11px] text-zinc-400">
                <span className="truncate font-medium text-zinc-200">{comment.via_claude ? "Claude" : comment.author_name}</span>
                {comment.via_claude && <span className="truncate">for {comment.author_name}</span>}
                <span className="shrink-0">{formatRelative(new Date(comment.created_at).getTime())}</span>
              </p>
              <p className="text-[13px] leading-[18px] whitespace-pre-wrap break-words text-zinc-100">{comment.body}</p>
            </div>
          </div>
        ))}
        {resolved && (
          <p className="text-center text-[11px] text-zinc-500">
            Resolved by {thread.resolved_by_name ?? "someone"}
            {thread.resolved_at ? ` · ${formatRelative(new Date(thread.resolved_at).getTime())}` : ""}
          </p>
        )}
      </div>
      <Composer placeholder="Reply…" onSend={(body) => act({ op: "reply", threadId: thread.id, body })} autoFocus />
    </Popover>
  );
}

function DraftPopover({ draft }: { draft: Draft }) {
  const feature = useComments((s) => s.feature);
  const features = useComments((s) => s.features);
  const rect = useElementRect(draft.selector);
  const at = pinPosition(rect, draft.pin_x, draft.pin_y);
  const [name, setName] = useState(feature);

  const post = async (body: string) => {
    if (!name.trim()) throw new Error("Pick the feature this comment belongs to.");
    if (name.trim() !== feature) await setFeature(name.trim());
    const thread: NewThread = {
      feature: name.trim(),
      url: pageKey(location.href),
      href: location.origin + location.pathname + location.search,
      page_title: document.title.slice(0, 300),
      selector: draft.selector,
      element_label: draft.label,
      pin_x: draft.pin_x,
      pin_y: draft.pin_y,
      body,
    };
    const created = await call<Thread>({ op: "create", thread });
    commentStore.setState({ draft: null, openId: created.id });
    await refresh();
  };

  return (
    <>
      {at && <span className="fixed z-[1] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500" style={at} />}
      <Popover at={at}>
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <HashIcon className="size-3.5 text-zinc-400" />
          <input
            value={name}
            list="talkcontext-features"
            placeholder="Feature"
            onChange={(event) => setName(event.target.value)}
            className="w-28 rounded-md bg-white/5 px-1.5 text-[12px] leading-[22px] text-zinc-100 outline-none focus:bg-white/10"
          />
          <datalist id="talkcontext-features">
            {features.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">{draft.label}</span>
          <IconButton title="Cancel" onClick={() => commentStore.setState({ draft: null })}>
            <XIcon />
          </IconButton>
        </div>
        <Composer placeholder="Add a comment…" onSend={post} autoFocus />
      </Popover>
    </>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-white [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- Dock */

/** Comment button + feature picker + error line, for the overlay dock. */
export function CommentDockControls({ dockButton }: { dockButton: (props: { title: string; onClick: () => void; active?: boolean; children: ReactNode }) => ReactNode }) {
  const session = useComments((s) => s.session);
  const placing = useComments((s) => s.placing);
  const feature = useComments((s) => s.feature);
  const features = useComments((s) => s.features);
  const showResolved = useComments((s) => s.showResolved);
  const count = useComments((s) => s.threads.filter((t) => t.status === "open").length);
  const [editing, setEditing] = useState(false);
  if (!session) return null;

  return (
    <>
      {dockButton({
        title: placing ? "Cancel (Esc)" : "Comment – click an element",
        active: placing,
        onClick: () => commentStore.setState({ placing: !placing, draft: null, openId: null }),
        children: (
          <span className="relative flex">
            <MessageCirclePlusIcon />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-2 rounded-full bg-amber-500 px-1 text-[9px] leading-[13px] font-semibold text-white">{count}</span>
            )}
          </span>
        ),
      })}
      {editing ? (
        <input
          autoFocus
          defaultValue={feature}
          list="talkcontext-dock-features"
          placeholder="all features"
          onBlur={(event) => {
            setEditing(false);
            void setFeature(event.target.value.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") setEditing(false);
          }}
          className="h-7 w-32 rounded-full bg-white/10 px-2.5 text-[12px] text-zinc-100 outline-none"
        />
      ) : (
        <button
          type="button"
          title="Feature you're working on – new comments go there, pins are filtered by it"
          onClick={() => setEditing(true)}
          className="flex h-7 max-w-36 items-center gap-0.5 truncate rounded-full px-2 text-[12px] text-zinc-300 hover:bg-white/10"
        >
          <HashIcon className="size-3 shrink-0" />
          <span className="truncate">{feature || "all features"}</span>
        </button>
      )}
      <datalist id="talkcontext-dock-features">
        {features.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      {dockButton({
        title: showResolved ? "Hide resolved" : "Show resolved",
        active: showResolved,
        onClick: () => commentStore.setState({ showResolved: !showResolved }),
        children: <CheckIcon />,
      })}
    </>
  );
}

/** Errors from comment actions, shown above the dock. */
export function CommentError() {
  const error = useComments((s) => s.error);
  if (!error) return null;
  return (
    <button
      type="button"
      onClick={() => commentStore.setState({ error: null })}
      className="max-w-[420px] rounded-xl border border-red-400/30 bg-red-950/90 px-3 py-1.5 text-left text-xs text-red-200"
    >
      {error}
    </button>
  );
}
