/**
 * Team presence and live view, host side (protocol: lib/live.ts).
 *
 * Everyone with the overlay open in a visible tab is on the team channel with
 * name and feature. Public members also share their page: teammates can go
 * there, or ask to join - the host approves in a small dialog and the viewer
 * then watches this tab live in an extension tab (rrweb stream).
 */
import { useEffect, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { eventWithTime } from "rrweb";
import { CheckIcon, EyeIcon, GlobeIcon, GlobeLockIcon, LocateFixedIcon, MonitorPlayIcon, XIcon } from "lucide-react";
import { pageKey } from "@/lib/comments";
import { liveTopic, peersOf, sendEvents, TEAM_TOPIC, type JoinReply, type JoinRequest, type Peer } from "@/lib/live";
import { getSettings, saveSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { request } from "./api";
import { commentStore } from "./comments";
import { realtime } from "./realtime";
import { rrwebSnapshot, subscribeRrweb } from "./rrweb-stream";
import { createStore, useStore } from "./store";

interface PresenceState {
  peers: Peer[];
  public: boolean;
  /** Join requests waiting for my answer. */
  requests: JoinRequest[];
  /** Approved viewers currently watching. */
  viewers: Array<{ key: string; name: string }>;
}

const presenceStore = createStore<PresenceState>(() => ({ peers: [], public: false, requests: [], viewers: [] }));
const usePresence = <T,>(selector: (state: PresenceState) => T) => useStore(presenceStore, selector);

/* ------------------------------------------------------------ Tab identity */

// sessionStorage: per tab, survives reloads and same-origin navigation.
// ponytail: a cross-origin navigation forgets the tab key and approvals - viewers then ask again.
function session(key: string, value?: string): string | null {
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const tabKey = session("talkcontext-tab") ?? session("talkcontext-tab", crypto.randomUUID()) ?? crypto.randomUUID();
const approved = new Set<string>(JSON.parse(session("talkcontext-approved") ?? "[]") as string[]);
const saveApproved = () => session("talkcontext-approved", JSON.stringify([...approved]));

/* ------------------------------------------------------------- Host side */

let client: SupabaseClient | null = null;
let team: RealtimeChannel | null = null;
let live: RealtimeChannel | null = null;
let settings: Settings | null = null;
let stopStream: (() => void) | undefined;

const reply = (to: string, ok: boolean) =>
  void team?.send({ type: "broadcast", event: "join-reply", payload: { to, ok } satisfies JoinReply });

/** rrweb runs only while an approved viewer is actually there; events go out in ~150 ms batches. */
function stream(on: boolean) {
  if (on && !stopStream && settings) {
    let batch: eventWithTime[] = [];
    let timer = 0;
    const unsubscribe = subscribeRrweb(settings, (event) => {
      batch.push(event);
      timer ||= window.setTimeout(() => {
        timer = 0;
        const events = batch;
        batch = [];
        if (live) void sendEvents(live, events);
      }, 150);
    });
    stopStream = () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }
  if (!on && stopStream) {
    stopStream();
    stopStream = undefined;
  }
}

function openLive() {
  if (live || !client) return;
  const channel = client.channel(liveTopic(tabKey), { config: { private: true } });
  live = channel;
  const sync = () => {
    const viewers = Object.entries(channel.presenceState<{ name: string }>())
      .filter(([key]) => approved.has(key))
      .map(([key, metas]) => ({ key, name: metas[0]?.name ?? "Someone" }));
    presenceStore.setState({ viewers });
    stream(viewers.length > 0);
  };
  channel
    .on("presence", { event: "sync" }, sync)
    // Someone (re)joined mid-stream: they need a full snapshot to start from.
    .on("presence", { event: "join" }, ({ key }) => approved.has(key) && rrwebSnapshot())
    .subscribe();
}

/** Ends watching for everyone and forgets approvals. */
function endLive() {
  stream(false);
  if (live) {
    void live.send({ type: "broadcast", event: "end", payload: {} });
    void client?.removeChannel(live);
    live = null;
  }
  approved.clear();
  saveApproved();
  presenceStore.setState({ viewers: [] });
}

function onJoinRequest(req: JoinRequest) {
  if (req.to !== tabKey) return;
  if (!presenceStore.getState().public) return reply(req.from, false);
  if (approved.has(req.from)) {
    // Viewer reloaded - already approved.
    openLive();
    return reply(req.from, true);
  }
  const { requests } = presenceStore.getState();
  if (!requests.some((r) => r.from === req.from)) presenceStore.setState({ requests: [...requests, req] });
}

function answer(req: JoinRequest, ok: boolean) {
  presenceStore.setState({ requests: presenceStore.getState().requests.filter((r) => r.from !== req.from) });
  if (ok) {
    approved.add(req.from);
    saveApproved();
    openLive();
  }
  reply(req.from, ok);
}

async function setPublic(value: boolean) {
  presenceStore.setState({ public: value });
  if (!value) {
    for (const req of presenceStore.getState().requests) reply(req.from, false);
    presenceStore.setState({ requests: [] });
    endLive();
  }
  const current = await getSettings();
  await saveSettings({ ...current, team: { ...current.team, public: value } });
}

/* -------------------------------------------------------------------- Layer */

/** Joins the team channel and keeps this tab's entry current. */
export function PresenceLayer({ settings: tabSettings }: { settings: Settings }) {
  const me = useStore(commentStore, (s) => s.session);
  const isPublic = usePresence((s) => s.public);
  const feature = useStore(commentStore, (s) => s.feature);
  const [track, setTrack] = useState<(() => void) | null>(null);

  useEffect(() => {
    presenceStore.setState({ public: tabSettings.team.public });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    settings = tabSettings;
  }, [tabSettings]);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    let joined = false;
    let href = location.href;

    const update = () => {
      if (!team || !joined) return;
      if (document.visibilityState !== "visible") {
        void team.untrack();
        return;
      }
      const shared = presenceStore.getState().public;
      const peer: Peer = {
        key: tabKey,
        userId: me.id,
        name: me.name,
        feature: commentStore.getState().feature,
        public: shared,
        since: Date.now(),
        ...(shared ? { url: location.href, page: pageKey(location.href), title: document.title } : {}),
      };
      void team.track(peer);
    };

    void realtime().then((c) => {
      if (!alive || !c) return;
      client = c;
      const channel = c.channel(TEAM_TOPIC, { config: { private: true, presence: { key: tabKey } } });
      team = channel;
      channel
        .on("presence", { event: "sync" }, () => presenceStore.setState({ peers: peersOf(channel) }))
        .on("broadcast", { event: "join-request" }, ({ payload }) => onJoinRequest(payload as JoinRequest))
        .subscribe((status) => {
          joined = status === "SUBSCRIBED";
          if (joined) update();
        });
      // After a reload: viewers approved before are still watching.
      if (approved.size) openLive();
      setTrack(() => update);
    });

    // SPA navigation.
    const timer = window.setInterval(() => {
      if (location.href === href) return;
      href = location.href;
      update();
    }, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      // Overlay closed (a page unload never gets here): stop being watched.
      endLive();
      if (team) void client?.removeChannel(team);
      team = null;
      setTrack(null);
      presenceStore.setState({ peers: [], requests: [] });
    };
  }, [me]);

  // Feature or public changed: update the entry without rejoining.
  useEffect(() => {
    track?.();
  }, [track, feature, isPublic]);

  return <JoinRequests />;
}

function JoinRequests() {
  const requests = usePresence((s) => s.requests);
  if (!requests.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[3] flex w-80 flex-col gap-2">
      {requests.map((req) => (
        <div
          key={req.from}
          role="alertdialog"
          aria-label={`${req.name} wants to join`}
          className="rounded-2xl border border-white/10 bg-zinc-950/95 p-3 text-zinc-100 shadow-[0_16px_48px_-8px_rgb(0_0_0/0.6)] backdrop-blur-xl"
        >
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <Avatar userId={req.userId} name={req.name} />
            <span className="min-w-0 flex-1 truncate">{req.name} wants to join</span>
          </p>
          <p className="mt-1 text-[12px] text-zinc-400">They'll watch this tab live until you stop it or close the overlay.</p>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              autoFocus
              onClick={() => answer(req, true)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 py-1.5 text-[12px] font-medium text-white hover:brightness-110"
            >
              <CheckIcon className="size-3.5" />
              Allow
            </button>
            <button
              type="button"
              onClick={() => answer(req, false)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/10 py-1.5 text-[12px] hover:bg-white/15"
            >
              <XIcon className="size-3.5" />
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Helpers */

function colorFor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 75% 55%)`;
}

function Avatar({ userId, name, className }: { userId: string; name: string; className?: string }) {
  return (
    <span
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", className)}
      style={{ background: colorFor(userId) }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Others, one per person: prefer a public tab on this page, then any public tab, then the most recent. */
function people(peers: Peer[], me: string | undefined, page: string) {
  const rank = (peer: Peer) => (peer.public ? 2 : 0) + (peer.page === page ? 1 : 0) + peer.since / 1e14;
  const byUser = new Map<string, Peer>();
  for (const peer of peers) {
    if (peer.userId === me) continue;
    const seen = byUser.get(peer.userId);
    if (!seen || rank(peer) > rank(seen)) byUser.set(peer.userId, peer);
  }
  return [...byUser.values()].sort((a, b) => rank(b) - rank(a));
}

const shortUrl = (href: string) => {
  try {
    const url = new URL(href);
    return url.host + url.pathname;
  } catch {
    return href;
  }
};

/* --------------------------------------------------------------------- Dock */

/** Public toggle, who's watching you, and avatars of the team. Hover an avatar: their page, go there, ask to join. */
export function PresenceDock() {
  const me = useStore(commentStore, (s) => s.session?.id);
  const feature = useStore(commentStore, (s) => s.feature);
  const peers = usePresence((s) => s.peers);
  const isPublic = usePresence((s) => s.public);
  const viewers = usePresence((s) => s.viewers);
  if (!me) return null;

  const page = pageKey(location.href);
  const list = people(peers, me, page);
  const inScope = list.filter((peer) => peer.feature === feature).length;
  const here = list.filter((peer) => peer.public && peer.page === page).length;
  const scope = feature ? `#${feature}` : "all features";

  return (
    <div className="flex items-center gap-1.5 pl-1">
      <button
        type="button"
        title={isPublic ? "Public – teammates see your page and can ask to watch. Click to go private." : "Private – go public so teammates see your page and can ask to watch."}
        aria-pressed={isPublic}
        onClick={() => void setPublic(!isPublic)}
        className={cn(
          "flex h-7 items-center gap-1 rounded-full px-2 text-[12px] transition [&_svg]:size-3.5",
          isPublic ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "text-zinc-400 hover:bg-white/10 hover:text-white",
        )}
      >
        {isPublic ? <GlobeIcon /> : <GlobeLockIcon />}
        {isPublic ? "Public" : "Private"}
      </button>
      {viewers.length > 0 && (
        <span className="flex h-7 items-center gap-1 rounded-full bg-red-500/15 pr-1 pl-2 text-[12px] text-red-200">
          <EyeIcon className="size-3.5" />
          <span className="max-w-28 truncate">{viewers.map((v) => v.name).join(", ")}</span>
          <button
            type="button"
            title="Stop – nobody watches anymore"
            aria-label="Stop being watched"
            onClick={endLive}
            className="flex size-5 items-center justify-center rounded-full hover:bg-white/10"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      )}
      {list.length > 0 && (
        <>
          <div className="flex -space-x-1.5">
            {list.slice(0, 4).map((peer) => (
              <PeerAvatar key={peer.userId} peer={peer} here={peer.public && peer.page === page} />
            ))}
          </div>
          <span
            title={`${inScope} teammate${inScope === 1 ? "" : "s"} in ${scope}, ${here} public on this page, ${list.length} online`}
            className="text-[11px] whitespace-nowrap text-zinc-400 tabular-nums"
          >
            {list.length > 4 && `+${list.length - 4} · `}
            {inScope} · {here} here
          </span>
        </>
      )}
    </div>
  );
}

function PeerAvatar({ peer, here }: { peer: Peer; here: boolean }) {
  const where = peer.url ? shortUrl(peer.url) : "";
  const ask = () => void request({ type: "talkcontext:open", page: "live", hostKey: peer.key });

  return (
    <div className="group/peer relative">
      <button
        type="button"
        aria-label={`${peer.name} – ${peer.public ? (here ? "on this page" : where) : "private"}`}
        className={cn("relative block rounded-full border-2 border-zinc-950", !peer.public && "opacity-50")}
      >
        <Avatar userId={peer.userId} name={peer.name} />
        {peer.public && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-zinc-950 bg-emerald-400" />}
      </button>
      {/* pb bridges the gap so the card stays open while the pointer moves up into it. */}
      <div className="invisible absolute bottom-full left-1/2 z-10 -translate-x-1/2 pb-2 opacity-0 transition group-focus-within/peer:visible group-focus-within/peer:opacity-100 group-hover/peer:visible group-hover/peer:opacity-100">
        <div className="w-64 rounded-xl border border-white/10 bg-zinc-950/95 p-2.5 text-zinc-100 shadow-[0_16px_48px_-8px_rgb(0_0_0/0.6)] backdrop-blur-xl">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(peer.userId) }} />
            <span className="truncate">{peer.name}</span>
            <span className="ml-auto shrink-0 truncate text-[11px] font-normal text-zinc-400">{peer.feature ? `#${peer.feature}` : "all features"}</span>
          </p>
          {peer.public && peer.url ? (
            <>
              <p className="mt-1 truncate text-[12px] text-zinc-300" title={peer.title}>
                {here && <span className="text-emerald-400">On this page · </span>}
                {peer.title || where}
              </p>
              <p className="truncate font-mono text-[11px] text-zinc-500" title={peer.url}>
                {where}
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  disabled={here && peer.url === location.href}
                  onClick={() => (location.href = peer.url!)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/10 py-1 text-[12px] hover:bg-white/15 disabled:opacity-40"
                >
                  <LocateFixedIcon className="size-3.5" />
                  Go there
                </button>
                <button
                  type="button"
                  onClick={ask}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1 text-[12px] text-white hover:brightness-110"
                  style={{ background: colorFor(peer.userId) }}
                >
                  <MonitorPlayIcon className="size-3.5" />
                  Ask to join
                </button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-zinc-400">Private – not sharing their page.</p>
          )}
        </div>
      </div>
    </div>
  );
}
