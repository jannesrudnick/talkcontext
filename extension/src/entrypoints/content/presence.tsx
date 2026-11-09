/**
 * Live presence per scope (the feature in the dock): who else is active on it,
 * on which page, and their cursor when they are on this page. Jump to them or
 * follow them. One private Realtime channel per scope, see supabase/setup.sql §5.
 *
 * "Active" = overlay visible (this layer is only mounted then) and tab visible.
 */
import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { EyeIcon, EyeOffIcon, LocateFixedIcon, XIcon } from "lucide-react";
import { pageKey } from "@/lib/comments";
import { selectorFor } from "@/lib/recorder/describe";
import { cn } from "@/lib/utils";
import { commentStore } from "./comments";
import { isOverlayNode } from "./controller";
import { useElementRect } from "./overlay";
import { realtime } from "./realtime";
import { createStore, useStore } from "./store";

interface Peer {
  /** Tab key - stable across reloads of that tab. */
  key: string;
  userId: string;
  name: string;
  url: string;
  page: string;
  title: string;
  since: number;
}

interface Cursor {
  key: string;
  page: string;
  /** Element under the pointer + position inside it (0..1), so it lands right at any viewport size. */
  selector: string;
  rx: number;
  ry: number;
}

interface PresenceState {
  peers: Peer[];
  cursors: Record<string, Cursor>;
  /** Tab key of the peer we follow. */
  following: string | null;
}

/* ------------------------------------------------------------ Tab identity */

const TAB_KEY = "talkcontext-tab";
const FOLLOW_KEY = "talkcontext-follow";

// sessionStorage: per tab, survives reloads and same-origin navigation - which is what following needs.
function session(key: string, value?: string | null): string | null {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const tabKey = session(TAB_KEY) ?? session(TAB_KEY, crypto.randomUUID()) ?? crypto.randomUUID();

const presenceStore = createStore<PresenceState>(() => ({ peers: [], cursors: {}, following: session(FOLLOW_KEY) }));
const usePresence = <T,>(selector: (state: PresenceState) => T) => useStore(presenceStore, selector);

function follow(key: string | null) {
  session(FOLLOW_KEY, key);
  presenceStore.setState({ following: key });
}

/* ------------------------------------------------------------------ Helpers */

export function colorFor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 75% 55%)`;
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

function position(selector: string, rx: number, ry: number) {
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    el = null;
  }
  const rect = el?.getBoundingClientRect();
  return rect ? { left: rect.left + rect.width * rx, top: rect.top + rect.height * ry } : null;
}

/** Same record of the same page? `page` alone matches every meeting series, `url` pins the one they have open. */
const noHash = (href: string) => href.replace(/#.*$/, "");
const samePlace = (peer: Peer) => noHash(peer.url) === noHash(location.href);

/** Same page: scroll their cursor into view. Elsewhere: go to their URL. */
function jumpTo(peer: Peer) {
  if (!samePlace(peer)) {
    location.href = peer.url;
    return;
  }
  const cursor = presenceStore.getState().cursors[peer.key];
  const at = cursor && position(cursor.selector, cursor.rx, cursor.ry);
  if (at) window.scrollBy({ top: at.top - window.innerHeight / 2, behavior: "smooth" });
}

/** Others in the scope, one per person (prefer the tab on this page, else the most recent). */
function people(peers: Peer[], me: string | undefined, page: string) {
  const byUser = new Map<string, Peer>();
  const rank = (peer: Peer) => [peer.page === page ? 1 : 0, peer.since];
  for (const peer of peers) {
    if (peer.userId === me) continue;
    const seen = byUser.get(peer.userId);
    const [a = 0, b = 0] = rank(peer);
    const [c = 0, d = 0] = seen ? rank(seen) : [-1, 0];
    if (a > c || (a === c && b > d)) byUser.set(peer.userId, peer);
  }
  return [...byUser.values()];
}

/* -------------------------------------------------------------------- Layer */

/** Joins the scope's channel, broadcasts this tab's cursor, draws the others'. */
export function PresenceLayer({ feature }: { feature: string }) {
  const me = useStore(commentStore, (s) => s.session);
  const cursors = usePresence((s) => s.cursors);
  const peers = usePresence((s) => s.peers);
  const following = usePresence((s) => s.following);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    let channel: RealtimeChannel | null = null;
    let joined = false;
    let page = pageKey(location.href);

    const track = () => {
      if (!channel || !joined) return;
      if (document.visibilityState !== "visible") {
        void channel.untrack();
        return;
      }
      const peer: Peer = { key: tabKey, userId: me.id, name: me.name, url: location.href, page, title: document.title, since: Date.now() };
      void channel.track(peer);
    };

    // Cursor: anchored to the element under it, at most every 100 ms.
    // ponytail: 10/s per person keeps a small team inside the free plan's message quota; raise with the plan.
    let last: { x: number; y: number } | null = null;
    let lastEl: Element | null = null;
    let lastSelector = "";
    let sentAt = 0;
    let pending = 0;
    const send = () => {
      pending = 0;
      sentAt = Date.now();
      if (!channel || !joined || !last) return;
      const el = document.elementsFromPoint(last.x, last.y).find((node) => !isOverlayNode(node)) ?? document.documentElement;
      if (el !== lastEl) {
        lastEl = el;
        lastSelector = selectorFor(el) || "html";
      }
      const rect = el.getBoundingClientRect();
      const cursor: Cursor = {
        key: tabKey,
        page,
        selector: lastSelector,
        rx: rect.width ? (last.x - rect.left) / rect.width : 0,
        ry: rect.height ? (last.y - rect.top) / rect.height : 0,
      };
      void channel.send({ type: "broadcast", event: "cursor", payload: cursor });
    };
    const schedule = () => {
      if (pending) return;
      pending = window.setTimeout(send, Math.max(0, 100 - (Date.now() - sentAt)));
    };
    const onMove = (event: MouseEvent) => {
      last = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onLeave = (event: MouseEvent) => {
      if (event.relatedTarget || !channel || !joined) return;
      last = null;
      void channel.send({ type: "broadcast", event: "cursor-gone", payload: { key: tabKey } });
    };
    const onScroll = () => last && schedule();
    // Your own scrolling or typing ends following, like in Figma.
    const unfollow = () => presenceStore.getState().following && follow(null);

    void realtime().then((client) => {
      if (!alive || !client) return;
      channel = client.channel(`talkcontext:scope:${feature || "*"}`, {
        config: { private: true, presence: { key: tabKey }, broadcast: { self: false } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel!.presenceState<Peer>();
          const peers = Object.values(state).flatMap((metas) => metas.slice(-1));
          const keys = new Set(peers.map((peer) => peer.key));
          const cursors = Object.fromEntries(Object.entries(presenceStore.getState().cursors).filter(([key]) => keys.has(key)));
          presenceStore.setState({ peers, cursors });
        })
        .on("broadcast", { event: "cursor" }, ({ payload }) => {
          const cursor = payload as Cursor;
          presenceStore.setState({ cursors: { ...presenceStore.getState().cursors, [cursor.key]: cursor } });
        })
        .on("broadcast", { event: "cursor-gone" }, ({ payload }) => {
          const { [(payload as { key: string }).key]: _gone, ...rest } = presenceStore.getState().cursors;
          presenceStore.setState({ cursors: rest });
        })
        .subscribe((status) => {
          joined = status === "SUBSCRIBED";
          if (joined) track();
        });
    });

    // SPA navigation - also to another record of the same page, so followers come along.
    let href = location.href;
    const timer = window.setInterval(() => {
      if (location.href === href) return;
      href = location.href;
      page = pageKey(href);
      track();
    }, 1000);

    document.addEventListener("visibilitychange", track);
    document.addEventListener("mousemove", onMove, { capture: true, passive: true });
    document.addEventListener("mouseout", onLeave, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("wheel", unfollow, { capture: true, passive: true });
    window.addEventListener("keydown", unfollow, true);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearTimeout(pending);
      document.removeEventListener("visibilitychange", track);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseout", onLeave, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", unfollow, true);
      window.removeEventListener("keydown", unfollow, true);
      if (channel) void channel.unsubscribe();
      presenceStore.setState({ peers: [], cursors: {} });
    };
  }, [me, feature]);

  // Following: go where they go, keep their cursor in view.
  const leader = peers.find((peer) => peer.key === following);
  const leaderCursor = following ? cursors[following] : undefined;
  useEffect(() => {
    if (!leader) return;
    if (!samePlace(leader)) {
      location.href = leader.url;
      return;
    }
    if (!leaderCursor) return;
    const at = position(leaderCursor.selector, leaderCursor.rx, leaderCursor.ry);
    const margin = window.innerHeight * 0.15;
    if (at && (at.top < margin || at.top > window.innerHeight - margin)) {
      window.scrollBy({ top: at.top - window.innerHeight / 2, behavior: "smooth" });
    }
  }, [leader, leaderCursor]);

  if (!me) return null;
  const page = pageKey(location.href);
  const others = peers.filter((peer) => peer.userId !== me.id && peer.page === page);

  return (
    <>
      {others.map((peer) => {
        const cursor = cursors[peer.key];
        return cursor && cursor.page === page ? <RemoteCursor key={peer.key} peer={peer} cursor={cursor} /> : null;
      })}
      {following && <FollowFrame peer={peers.find((peer) => peer.key === following)} />}
    </>
  );
}

function RemoteCursor({ peer, cursor }: { peer: Peer; cursor: Cursor }) {
  const rect = useElementRect(cursor.selector);
  if (!rect) return null;
  const color = colorFor(peer.userId);
  return (
    <div
      className="pointer-events-none fixed top-0 left-0 z-[3] transition-transform duration-100 ease-linear"
      style={{ transform: `translate(${rect.left + rect.width * cursor.rx}px, ${rect.top + rect.height * cursor.ry}px)` }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-[0_1px_2px_rgb(0_0_0/0.4)]">
        <path d="M2 1.5 L15.5 8 L9.2 9.6 L6.6 15.8 Z" fill={color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="ml-3.5 -mt-1 block w-max max-w-40 truncate rounded-full px-2 text-[11px] leading-[18px] font-medium text-white" style={{ background: color }}>
        {peer.name}
      </span>
    </div>
  );
}

function FollowFrame({ peer }: { peer: Peer | undefined }) {
  const color = peer ? colorFor(peer.userId) : "rgb(113 113 122)";
  return (
    <div className="pointer-events-none fixed inset-0 z-[3] border-[3px]" style={{ borderColor: color }}>
      <button
        type="button"
        onClick={() => follow(null)}
        className="pointer-events-auto absolute top-0 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-b-lg px-2.5 py-0.5 text-[12px] font-medium text-white"
        style={{ background: color }}
      >
        {peer ? `Following ${peer.name}` : "Waiting for them to come back…"}
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------- Dock */

/** Avatars of everyone else in the scope + "N · M here". Hover: their page, jump, follow. */
export function PresenceDock() {
  const feature = useStore(commentStore, (s) => s.feature);
  const me = useStore(commentStore, (s) => s.session?.id);
  const peers = usePresence((s) => s.peers);
  const following = usePresence((s) => s.following);
  const page = pageKey(location.href);
  const list = people(peers, me, page);
  if (!me || !list.length) return null;
  const here = list.filter((peer) => peer.page === page).length;
  const scope = feature ? `#${feature}` : "all features";

  return (
    <div className="flex items-center gap-1.5 pl-1">
      <div className="flex -space-x-1.5">
        {list.slice(0, 4).map((peer) => (
          <PeerAvatar key={peer.userId} peer={peer} here={peer.page === page} following={peer.key === following} />
        ))}
      </div>
      <span
        title={`${list.length} teammate${list.length === 1 ? "" : "s"} in ${scope}, ${here} on this page`}
        className="text-[11px] whitespace-nowrap text-zinc-400 tabular-nums"
      >
        {list.length > 4 && `+${list.length - 4} · `}
        {list.length} · {here} here
      </span>
    </div>
  );
}

function PeerAvatar({ peer, here, following }: { peer: Peer; here: boolean; following: boolean }) {
  const color = colorFor(peer.userId);
  const where = (() => {
    try {
      const url = new URL(peer.url);
      return url.host + url.pathname;
    } catch {
      return peer.url;
    }
  })();

  return (
    <div className="group/peer relative">
      <button
        type="button"
        aria-label={`${peer.name} – ${here ? "on this page" : where}`}
        onClick={() => jumpTo(peer)}
        className={cn(
          "relative flex size-6 items-center justify-center rounded-full border-2 border-zinc-950 text-[11px] font-semibold text-white",
          following && "ring-2 ring-white",
          !here && "opacity-60",
        )}
        style={{ background: color }}
      >
        {initial(peer.name)}
      </button>
      {/* pb bridges the gap so the card stays open while the pointer moves up into it. */}
      <div className="invisible absolute bottom-full left-1/2 z-10 -translate-x-1/2 pb-2 opacity-0 transition group-focus-within/peer:visible group-focus-within/peer:opacity-100 group-hover/peer:visible group-hover/peer:opacity-100">
        <div className="w-64 rounded-xl border border-white/10 bg-zinc-950/95 p-2.5 text-zinc-100 shadow-[0_16px_48px_-8px_rgb(0_0_0/0.6)] backdrop-blur-xl">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{peer.name}</span>
            {here && <span className="ml-auto shrink-0 text-[11px] font-normal text-emerald-400">on this page</span>}
          </p>
          <p className="mt-1 truncate text-[12px] text-zinc-300" title={peer.title}>
            {peer.title || where}
          </p>
          <p className="truncate font-mono text-[11px] text-zinc-500" title={peer.url}>
            {where}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => jumpTo(peer)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/10 py-1 text-[12px] hover:bg-white/15"
            >
              <LocateFixedIcon className="size-3.5" />
              {here ? "Show" : "Go there"}
            </button>
            <button
              type="button"
              onClick={() => follow(following ? null : peer.key)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1 text-[12px] text-white hover:brightness-110"
              style={{ background: following ? "rgb(63 63 70)" : color }}
            >
              {following ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
              {following ? "Stop following" : "Follow"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
